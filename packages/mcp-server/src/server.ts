import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defiState } from "./defi.js";
import { registerQuantTools } from "./quant-tools.js";

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/**
 * Creates the 0xAuto DeFi MCP server, registering the DeFi tools that agents call.
 * The same factory is used both by the standalone stdio server and by the web
 * executor (over an in-memory transport), so tool behaviour is identical everywhere.
 */
export function createDefiMcpServer(): McpServer {
  const server = new McpServer({
    name: "0xauto-defi",
    version: "0.1.0",
  });

  server.registerTool(
    "list_markets",
    {
      title: "List markets",
      description: "List all tradable markets with their current price (in USDC) and staking APY.",
      inputSchema: {},
    },
    async () => textResult(defiState.listMarkets()),
  );

  server.registerTool(
    "get_price",
    {
      title: "Get price",
      description: "Get the current price of a token symbol (e.g. BTC, ETH, BNB, SOL) quoted in USDC.",
      inputSchema: {
        symbol: z.string().describe("Token symbol, e.g. BTC, ETH, BNB, SOL, USDC"),
      },
    },
    async ({ symbol }) => textResult({ symbol: symbol.toUpperCase(), price: defiState.getPrice(symbol) }),
  );

  server.registerTool(
    "get_portfolio",
    {
      title: "Get portfolio",
      description: "Get the current wallet portfolio: token balances, staked positions and total USD value.",
      inputSchema: {},
    },
    async () => textResult(defiState.getPortfolio()),
  );

  server.registerTool(
    "swap_tokens",
    {
      title: "Swap tokens",
      description: "Swap an amount of one token for another at the current market price.",
      inputSchema: {
        fromSymbol: z.string().describe("Token to sell, e.g. USDC"),
        toSymbol: z.string().describe("Token to buy, e.g. ETH"),
        amount: z.number().positive().describe("Amount of fromSymbol to swap"),
      },
    },
    async ({ fromSymbol, toSymbol, amount }) => textResult(defiState.swap(fromSymbol, toSymbol, amount)),
  );

  server.registerTool(
    "stake",
    {
      title: "Stake",
      description: "Stake an amount of a token to earn yield at its market APY.",
      inputSchema: {
        symbol: z.string().describe("Token to stake, e.g. ETH"),
        amount: z.number().positive().describe("Amount to stake"),
      },
    },
    async ({ symbol, amount }) => textResult(defiState.stake(symbol, amount)),
  );

  registerQuantTools(server);
  return server;
}
