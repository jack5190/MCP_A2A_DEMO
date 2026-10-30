import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefiMcpServer } from "./server.js";
import { runQuantRoundWithClient } from "./quant-client.js";
import type { TournamentOptions } from "./quant/index.js";

function parseOptions(args: string[]): { options: TournamentOptions; json: boolean; help: boolean } {
  const options: TournamentOptions = {};
  let json = false;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") { json = true; continue; }
    if (args[i] === "--help" || args[i] === "-h") { help = true; continue; }
    const key = { "--seed": "seed", "--fee-bps": "feeBps", "--slippage-bps": "slippageBps" }[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown option or missing value: ${args[i]}`);
    const value = Number(args[++i]);
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value: ${args[i]}`);
    options[key as keyof TournamentOptions] = value;
  }
  return { options, json, help };
}

async function main() {
  const { options, json, help } = parseOptions(process.argv.slice(2));
  if (help) {
    console.log("Usage: npm run quant:demo -- [--seed 42] [--fee-bps 5] [--slippage-bps 5] [--json]\nLocal synthetic data only. Defaults: seed 42, 5 bps fee + 5 bps slippage per side.");
    return;
  }
  const server = createDefiMcpServer();
  const client = new Client({ name: "autoa2a-quant-demo", version: "0.1.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(st), client.connect(ct)]);
    const result = await runQuantRoundWithClient(client, options);
    if (json) { console.log(JSON.stringify(result, null, 2)); return; }
    const t = result.tournament;
    const pct = (value: number) => `${(100 * value).toFixed(2)}%`;
    console.log(`AutoA2A Quant Subnet | SYNTHETIC / LOCAL ONLY | seed=${t.seed}`);
    console.log(`Data: ${t.dataFingerprint}\nPolicy: ${t.policy.version}; costs/side: fee=${t.costs.feeBps}bps, slippage=${t.costs.slippageBps}bps`);
    console.table(t.leaderboard.map((entry) => ({
      rank: entry.rank, miner: entry.minerId, status: entry.status,
      netOOS: entry.status === "disqualified" ? "rejected" : pct(entry.metrics.netReturn),
      excess: entry.status === "disqualified" ? "rejected" : pct(entry.metrics.netReturn - t.benchmark.netReturn),
      sharpe: entry.status === "disqualified" ? "rejected" : entry.metrics.sharpe.toFixed(2),
      maxDD: entry.status === "disqualified" ? "rejected" : pct(entry.metrics.maxDrawdown),
      leakRisk: entry.leakageRisk.toFixed(2), score: entry.score.toFixed(2), mockWeight: pct(entry.rewardWeight),
    })));
    for (const entry of t.leaderboard) console.log(`${entry.minerId}: ${entry.flags.join("; ") || "No declared-boundary violation; provenance remains unverified."}`);
    console.log("\nA2A / MCP trace:");
    for (const message of result.messages) console.log(`${message.step}. ${message.from} -> ${message.to}: ${message.intent} | ${message.detail}`);
    console.log(`\nMCP tools: ${result.mcpCalls.map((call) => call.tool).join(", ")}`);
    console.log("\nLimitations:");
    for (const limitation of t.limitations) console.log(`- ${limitation}`);
  } finally {
    await client.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
