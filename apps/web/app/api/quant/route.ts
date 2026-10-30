import { NextResponse } from "next/server";
import { z } from "zod";
import { runQuantRound } from "@/lib/quantExecutor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionsSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffffffff).optional(),
    feeBps: z.number().finite().min(0).max(100).optional(),
    slippageBps: z.number().finite().min(0).max(100).optional(),
  })
  .strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求必须是有效 JSON。" }, { status: 400 });
  }

  const parsed = optionsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效：seed 须为 0–4294967295 的整数，手续费和滑点须在 0–100 bps。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await runQuantRound(parsed.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Quant simulation failed", error);
    return NextResponse.json({ error: "本地评分轮次未完成，请检查终端日志后重试。" }, { status: 500 });
  }
}
