import { randomUUID } from "node:crypto";
import { connectDefiClient, callJsonTool } from "./mcpClient";
import type { AgentConfig, A2AMessage, McpCall, ExecutionResult } from "./types";

/**
 * The A2A (Agent-to-Agent) executor.
 *
 * A Coordinator agent receives an agent config and orchestrates two specialised
 * agents by passing messages between them:
 *   - PriceWatcher: reads live market data via MCP and decides whether the trigger fires.
 *   - Trader: if triggered, executes the on-chain action (swap/stake) via MCP.
 *
 * Every A2A message and every MCP tool call is recorded so the UI can render the
 * full decision + execution trace.
 */
export async function runAgent(config: AgentConfig): Promise<ExecutionResult> {
  const messages: A2AMessage[] = [];
  const mcpCalls: McpCall[] = [];
  let step = 0;
  // MCP calls made since the last A2A message; attached to the next message emitted.
  let pending: McpCall[] = [];

  const say = (from: string, to: string, intent: string, detail: string) => {
    step += 1;
    messages.push({ step, from, to, intent, detail, mcpCalls: pending });
    pending = [];
  };

  const record = async (agent: string, tool: string, args: Record<string, unknown>) => {
    const result = await callJsonTool(client, tool, args);
    const call: McpCall = { agent, tool, args, result };
    mcpCalls.push(call);
    pending.push(call);
    return result as any;
  };

  const client = await connectDefiClient();
  const startedAt = new Date().toISOString();

  const portfolioBefore = await record("Coordinator", "get_portfolio", {});

  say("User", "Coordinator", "run_agent", `Kick off agent "${config.name}".`);

  // --- Step 1: Coordinator asks PriceWatcher to evaluate the trigger. ---
  let triggered = false;
  let triggerDetail: string;

  if (config.trigger.type === "schedule") {
    say(
      "Coordinator",
      "PriceWatcher",
      "evaluate_trigger",
      `Schedule trigger (${config.trigger.intervalLabel}) — evaluate readiness.`,
    );
    triggered = true;
    triggerDetail = `Schedule trigger active (${config.trigger.intervalLabel}).`;
    say("PriceWatcher", "Coordinator", "trigger_result", triggerDetail);
  } else {
    const { symbol, direction, threshold } = config.trigger;
    say(
      "Coordinator",
      "PriceWatcher",
      "evaluate_trigger",
      `Check if ${symbol.toUpperCase()} price is ${direction} ${threshold} USDC.`,
    );
    const priceRes = await record("PriceWatcher", "get_price", { symbol });
    const price = priceRes.price as number;
    triggered = direction === "above" ? price > threshold : price < threshold;
    triggerDetail = `${symbol.toUpperCase()} = ${price} USDC, target ${direction} ${threshold} → ${
      triggered ? "TRIGGERED" : "not met"
    }.`;
    say("PriceWatcher", "Coordinator", "trigger_result", triggerDetail);
  }

  // --- Step 2: If triggered, Coordinator delegates execution to the Trader. ---
  let summary: string;
  if (triggered) {
    if (config.action.type === "swap") {
      const { fromSymbol, toSymbol, amount } = config.action;
      say(
        "Coordinator",
        "Trader",
        "execute_action",
        `Swap ${amount} ${fromSymbol.toUpperCase()} → ${toSymbol.toUpperCase()}.`,
      );
      const swap = await record("Trader", "swap_tokens", { fromSymbol, toSymbol, amount });
      summary = `Swapped ${swap.amountIn} ${swap.from} for ${swap.amountOut} ${swap.to} (~$${swap.usdValue}).`;
      say("Trader", "Coordinator", "execution_result", summary);
    } else {
      const { symbol, amount } = config.action;
      say("Coordinator", "Trader", "execute_action", `Stake ${amount} ${symbol.toUpperCase()}.`);
      const pos = await record("Trader", "stake", { symbol, amount });
      summary = `Staked ${pos.amount} ${pos.symbol} at ${(pos.apy * 100).toFixed(1)}% APY.`;
      say("Trader", "Coordinator", "execution_result", summary);
    }
  } else {
    summary = "Trigger condition not met — no action taken.";
    say("Coordinator", "User", "done", summary);
  }

  const portfolioAfter = await record("Coordinator", "get_portfolio", {});
  if (triggered) {
    say("Coordinator", "User", "done", summary);
  }

  await client.close();

  return {
    id: randomUUID(),
    agentName: config.name,
    startedAt,
    triggered,
    summary,
    messages,
    mcpCalls,
    portfolioBefore,
    portfolioAfter,
  };
}
