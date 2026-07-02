import { NextResponse } from "next/server";
import { connectDefiClient, callJsonTool } from "@/lib/mcpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const client = await connectDefiClient();
  try {
    const markets = await callJsonTool(client, "list_markets", {});
    const portfolio = await callJsonTool(client, "get_portfolio", {});
    return NextResponse.json({ markets, portfolio });
  } finally {
    await client.close();
  }
}
