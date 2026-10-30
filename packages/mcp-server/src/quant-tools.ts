import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDemoTask, MINER_IDS, runDemoMiner, runTournament } from "./quant/index.js";

const barSchema = z.object({
  index: z.number().int().min(0).max(1000),
  timestamp: z.string().datetime(),
  open: z.number().finite().positive(),
  high: z.number().finite().positive(),
  low: z.number().finite().positive(),
  close: z.number().finite().positive(),
}).strict().refine((bar) => bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close), {
  message: "OHLC range is inconsistent",
});

export const minerTaskSchema = z.object({
  version: z.literal("quant-task-v1"),
  taskId: z.string().min(1).max(200),
  asOf: z.number().int().min(0).max(1000),
  asOfTimestamp: z.string().datetime(),
  maxTrainThrough: z.number().int().min(0).max(1000),
  history: z.array(barSchema).min(2).max(1000),
  horizon: z.literal(1),
  maxPosition: z.literal(1),
}).strict().superRefine((task, context) => {
  const fail = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (task.history.length !== task.asOf + 1 || task.history.some((bar, index) => bar.index !== index)) {
    fail("History must be an ordered prefix ending exactly at asOf");
  }
  if (task.history.at(-1)?.timestamp !== task.asOfTimestamp || task.history.some((bar, index) =>
    Date.parse(bar.timestamp) > Date.parse(task.asOfTimestamp) || (index > 0 && Date.parse(bar.timestamp) <= Date.parse(task.history[index - 1].timestamp)))) {
    fail("History timestamps must increase and end at asOfTimestamp");
  }
  if (task.maxTrainThrough !== task.asOf - 1) fail("Training cutoff must preserve the one-bar embargo");
});

const optionsSchema = {
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  feeBps: z.number().finite().min(0).max(100).optional(),
  slippageBps: z.number().finite().min(0).max(100).optional(),
};

function json(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

/** Educational, local tools only. Prediction previews are never accepted as a scored round. */
export function registerQuantTools(server: McpServer) {
  server.registerTool("quant_get_task", {
    title: "Preview a causal Miner task",
    description: "Return the first synthetic OOS decision task. History ends at asOf; no future outcomes. Public seed is for reproducibility, not secrecy.",
    inputSchema: optionsSchema,
  }, async (options) => json(getDemoTask(options)));

  server.registerTool("quant_miner_predict", {
    title: "Run a built-in Miner preview",
    description: "Run one local, allowlisted Miner on a bounded history prefix. This preview is not a validated submission or a trade.",
    inputSchema: {
      minerId: z.string().refine((id) => MINER_IDS.includes(id as typeof MINER_IDS[number]), "Unknown built-in Miner"),
      task: minerTaskSchema,
    },
  }, async ({ minerId, task }) => json(runDemoMiner(minerId, task)));

  server.registerTool("quant_evaluate", {
    title: "Evaluate a complete synthetic round",
    description: "Validator runs every built-in Miner on identical sequential tasks and independently computes net OOS metrics, leakage gates, scores and local mock weights. Does not trust preview PnL or mutate a portfolio.",
    inputSchema: optionsSchema,
  }, async (options) => json(runTournament(options)));
}
