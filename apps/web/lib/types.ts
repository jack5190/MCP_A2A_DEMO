import { z } from "zod";

export const scheduleTriggerSchema = z.object({
  type: z.literal("schedule"),
  intervalLabel: z.string().default("every run"),
});

export const priceTriggerSchema = z.object({
  type: z.literal("price"),
  symbol: z.string().min(1),
  direction: z.enum(["above", "below"]),
  threshold: z.number().positive(),
});

export const swapActionSchema = z.object({
  type: z.literal("swap"),
  fromSymbol: z.string().min(1),
  toSymbol: z.string().min(1),
  amount: z.number().positive(),
});

export const stakeActionSchema = z.object({
  type: z.literal("stake"),
  symbol: z.string().min(1),
  amount: z.number().positive(),
});

export const agentConfigSchema = z.object({
  name: z.string().min(1),
  trigger: z.discriminatedUnion("type", [scheduleTriggerSchema, priceTriggerSchema]),
  action: z.discriminatedUnion("type", [swapActionSchema, stakeActionSchema]),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export interface McpCall {
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface A2AMessage {
  step: number;
  from: string;
  to: string;
  intent: string;
  detail: string;
  /** MCP tool calls made by the sender in order to produce this message. */
  mcpCalls: McpCall[];
}

export interface ExecutionResult {
  id: string;
  agentName: string;
  startedAt: string;
  triggered: boolean;
  summary: string;
  messages: A2AMessage[];
  mcpCalls: McpCall[];
  portfolioBefore: unknown;
  portfolioAfter: unknown;
}
