import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefiMcpServer } from "./server.js";
import { runQuantRoundWithClient } from "./quant-client.js";
import { runTournament } from "./quant/index.js";

async function connect(t: { after: (fn: () => Promise<void>) => void }) {
  const server = createDefiMcpServer();
  const client = new Client({ name: "quant-integration-test", version: "0.1.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test("real MCP round matches independent engine and never mutates mock balances", async (t) => {
  const client = await connect(t);
  const before = await client.callTool({ name: "get_portfolio", arguments: {} });
  const result = await runQuantRoundWithClient(client, { seed: 42, feeBps: 5, slippageBps: 5 });
  assert.deepEqual(result.tournament, runTournament({ seed: 42, feeBps: 5, slippageBps: 5 }));
  const after = await client.callTool({ name: "get_portfolio", arguments: {} });
  const parse = (value: typeof before) => JSON.parse((value.content as { text: string }[])[0].text);
  // Existing get_price advances a deterministic mock quote. Holdings, not mark-to-market value, must stay unchanged.
  assert.deepEqual(parse(after).balances, parse(before).balances);
  assert.deepEqual(parse(after).staked, parse(before).staked);
  assert.deepEqual([...new Set(result.mcpCalls.map((call) => call.tool))], ["get_price", "quant_get_task", "quant_miner_predict", "quant_evaluate"]);
  assert.equal(result.tournament.leaderboard.find((entry) => entry.minerId === "future-leak")?.status, "disqualified");
  assert.ok(result.messages.some((entry) => entry.intent === "evaluate_complete_round"));
});

test("MCP refuses invalid seed, negative fees and non-allowlisted Miners", async (t) => {
  const client = await connect(t);
  for (const options of [{ seed: -1 }, { seed: 0x100000000 }, { feeBps: -1 }, { slippageBps: 101 }]) {
    const result = await client.callTool({ name: "quant_evaluate", arguments: options });
    assert.equal(result.isError, true);
  }
  const taskResult = await client.callTool({ name: "quant_get_task", arguments: {} });
  const task = JSON.parse((taskResult.content as { text: string }[])[0].text);
  const badMiner = await client.callTool({ name: "quant_miner_predict", arguments: { minerId: "remote-url-not-supported", task } });
  assert.equal(badMiner.isError, true);
  const badTask = await client.callTool({ name: "quant_miner_predict", arguments: { minerId: "ridge", task: { ...task, futureReturns: [0.99] } } });
  assert.equal(badTask.isError, true);
  for (const malformed of [
    { ...task, maxTrainThrough: task.asOf },
    { ...task, history: [...task.history, { ...task.history.at(-1), index: task.asOf + 1 }] },
    { ...task, asOfTimestamp: "2099-01-01T00:00:00.000Z" },
    { ...task, history: [task.history[1], task.history[0], ...task.history.slice(2)] },
  ]) {
    const rejected = await client.callTool({ name: "quant_miner_predict", arguments: { minerId: "ridge", task: malformed } });
    assert.equal(rejected.isError, true);
  }
});

test("MCP task contains only available bars and valid Miner response is accepted", async (t) => {
  const client = await connect(t);
  const response = await client.callTool({ name: "quant_get_task", arguments: { seed: 42 } });
  const task = JSON.parse((response.content as { text: string }[])[0].text);
  assert.equal(task.history.at(-1).index, task.asOf);
  assert.ok(task.history.every((bar: { index: number }) => bar.index <= task.asOf));
  assert.ok(task.maxTrainThrough < task.asOf);
  assert.equal("target" in task, false);
  const prediction = await client.callTool({ name: "quant_miner_predict", arguments: { minerId: "ridge", task } });
  assert.notEqual(prediction.isError, true);
});
