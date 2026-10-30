import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefiMcpServer } from "./server.js";
import { DefiState } from "./defi.js";

async function connectedClient() {
  const server = createDefiMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

test("lists the expected DeFi tools", async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_portfolio", "get_price", "list_markets", "quant_evaluate", "quant_get_task", "quant_miner_predict", "stake", "swap_tokens"]);
});

test("get_price returns a positive number for a known market", async () => {
  const client = await connectedClient();
  const res = await client.callTool({ name: "get_price", arguments: { symbol: "eth" } });
  const data = parse(res);
  assert.equal(data.symbol, "ETH");
  assert.ok(data.price > 0);
});

test("swap_tokens moves balances between assets", async () => {
  const client = await connectedClient();
  const before = parse(await client.callTool({ name: "get_portfolio", arguments: {} }));
  const swap = parse(
    await client.callTool({ name: "swap_tokens", arguments: { fromSymbol: "USDC", toSymbol: "ETH", amount: 1000 } }),
  );
  assert.equal(swap.from, "USDC");
  assert.equal(swap.to, "ETH");
  assert.ok(swap.amountOut > 0);
  const after = parse(await client.callTool({ name: "get_portfolio", arguments: {} }));
  assert.ok(after.balances.USDC < before.balances.USDC);
  assert.ok(after.balances.ETH > before.balances.ETH);
});

test("DefiState rejects swaps larger than the balance", () => {
  const state = new DefiState();
  assert.throws(() => state.swap("USDC", "ETH", 1_000_000), /Insufficient/);
});

test("stake reduces liquid balance and records a position", () => {
  const state = new DefiState();
  const pos = state.stake("ETH", 1);
  assert.equal(pos.symbol, "ETH");
  assert.equal(pos.amount, 1);
  const portfolio = state.getPortfolio();
  assert.equal(portfolio.staked.length, 1);
  assert.equal(portfolio.balances.ETH, 0);
});
