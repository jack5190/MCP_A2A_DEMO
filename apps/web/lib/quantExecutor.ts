import { runQuantRoundWithClient } from "@0xauto/mcp-server";
import type { QuantExecutionResult, TournamentOptions } from "@0xauto/mcp-server";
import { connectDefiClient } from "./mcpClient";

export type { QuantExecutionResult } from "@0xauto/mcp-server";

export async function runQuantRound(options: TournamentOptions = {}): Promise<QuantExecutionResult> {
  const client = await connectDefiClient();
  try {
    return await runQuantRoundWithClient(client, options);
  } finally {
    await client.close();
  }
}
