import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefiMcpServer } from "@autoa2a/mcp-server";

/**
 * Connects an MCP client to the AutoA2A DeFi MCP server over an in-memory transport.
 *
 * This performs a real MCP initialize handshake and tool discovery, using the exact
 * same server code that the standalone stdio service runs. The in-memory transport
 * keeps the demo robust (no child-process management) while remaining a genuine
 * MCP client/server interaction.
 */
export async function connectDefiClient(): Promise<Client> {
  const server = createDefiMcpServer();
  const client = new Client({ name: "autoa2a-executor", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Calls an MCP tool and parses the JSON text payload the DeFi tools return. */
export async function callJsonTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res: any = await client.callTool({ name, arguments: args });
  const text = res?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Tool ${name} returned no text content`);
  }
  return JSON.parse(text) as T;
}
