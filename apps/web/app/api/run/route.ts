import { NextResponse } from "next/server";
import { agentConfigSchema } from "@/lib/types";
import { runAgent } from "@/lib/executor";
import { addExecution } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = agentConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid agent config", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await runAgent(parsed.data);
    addExecution(result);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown execution error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
