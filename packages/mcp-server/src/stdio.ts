import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDefiMcpServer } from "./server.js";

/**
 * Standalone entrypoint: runs the 0xAuto DeFi MCP server over stdio so it can be
 * launched as a real MCP service (e.g. from an MCP-compatible client).
 */
async function main() {
  const server = createDefiMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate over stdio, so log to stderr only.
  console.error("[0xauto-mcp-server] DeFi MCP server running on stdio");
}

main().catch((err) => {
  console.error("[0xauto-mcp-server] fatal error:", err);
  process.exit(1);
});
