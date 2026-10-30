import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { MINER_IDS } from "./quant/index.js";
import type { MinerTask, MinerSubmission, TournamentOptions, TournamentResult } from "./quant/index.js";

export interface QuantMessage {
  step: number;
  from: string;
  to: string;
  intent: string;
  detail: string;
}

export interface QuantExecutionResult {
  tournament: TournamentResult;
  messages: QuantMessage[];
  mcpCalls: { agent: string; tool: string; args: Record<string, unknown>; result: unknown }[];
}

/** Uses a genuine connected MCP client; no wallet, order placement or chain calls. */
export async function runQuantRoundWithClient(
  client: Client,
  options: TournamentOptions = {},
): Promise<QuantExecutionResult> {
  const messages: QuantMessage[] = [];
  const mcpCalls: QuantExecutionResult["mcpCalls"] = [];
  const say = (from: string, to: string, intent: string, detail: string) =>
    messages.push({ step: messages.length + 1, from, to, intent, detail });
  const call = async <T>(agent: string, tool: string, args: Record<string, unknown>): Promise<T> => {
    const response = await client.callTool({ name: tool, arguments: args });
    if (response.isError) throw new Error(`MCP tool ${tool} rejected the request`);
    const block = (response.content as { type: string; text?: string }[]).find((entry) => entry.type === "text");
    if (!block?.text) throw new Error(`MCP tool ${tool} returned no JSON text`);
    const result: T = JSON.parse(block.text);
    // Keep trace small; the full prefix exists in the tool payload, not duplicated per Miner in the UI.
    const traceArgs = tool === "quant_miner_predict"
      ? { minerId: args.minerId, taskId: (args.task as MinerTask).taskId, asOf: (args.task as MinerTask).asOf }
      : args;
    const traceResult = tool === "quant_get_task"
      ? { taskId: (result as MinerTask).taskId, asOf: (result as MinerTask).asOf, visibleBars: (result as MinerTask).history.length }
      : tool === "quant_evaluate"
        ? { version: (result as TournamentResult).version, dataFingerprint: (result as TournamentResult).dataFingerprint, miners: (result as TournamentResult).leaderboard.length }
        : result;
    mcpCalls.push({ agent, tool, args: traceArgs, result: traceResult });
    return result;
  };

  say("Coordinator", "PriceWatcher", "mock_market_context", "读取原有 MCP 模拟报价；仅作市场背景，评分使用独立合成序列。");
  const quote = await call<{ price: number }>("PriceWatcher", "get_price", { symbol: "ETH" });
  say("PriceWatcher", "Coordinator", "context_ready", `ETH 模拟报价 ${quote.price} USDC；不用于生成样本外收益。`);

  const task = await call<MinerTask>("Coordinator", "quant_get_task", { ...options });
  for (const minerId of MINER_IDS) {
    say("Coordinator", minerId, "predict_preview", `演示首个任务 ${task.taskId}；只允许读取截至 ${task.asOfTimestamp} 的数据。`);
    const submission = await call<MinerSubmission>(minerId, "quant_miner_predict", { minerId, task });
    say(minerId, "Validator", "preview_returned", `预览仓位 ${submission.targetPosition.toFixed(3)}，特征截至索引 ${submission.featureAsOf}；预览不直接计分。`);
  }
  say("Coordinator", "Validator", "evaluate_complete_round", "固定策略代码，在相同数据和费用下逐时回放全部任务，由 Validator 独立重算；不接受自报收益。");
  const tournament = await call<TournamentResult>("Validator", "quant_evaluate", { ...options });
  const eligible = tournament.leaderboard.filter((entry) => entry.status === "eligible").length;
  say("Validator", "Coordinator", "leaderboard_ready", `${eligible} 个 Miner 获得本地模拟奖励资格。所有分数为零时，奖励权重全为零；没有链上分发。`);
  return { tournament, messages, mcpCalls };
}
