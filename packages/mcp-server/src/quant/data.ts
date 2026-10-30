import { createHash } from "node:crypto";
import type { Bar, MinerTask, TournamentOptions } from "./types.js";

export const SPLIT = Object.freeze({ trainBars: 120, embargoBars: 1, oosBars: 120, folds: 3 });

export function validateOptions(options: TournamentOptions = {}) {
  const { seed = 42, feeBps = 5, slippageBps = 5 } = options;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("seed must be a uint32 integer");
  }
  for (const [name, value] of Object.entries({ feeBps, slippageBps })) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`${name} must be a finite number between 0 and 100`);
    }
  }
  return { seed, feeBps, slippageBps };
}

/** Reproducible PUBLIC synthetic data, deliberately not a secret evaluation set. */
export function generateBars(seed = 42, count = SPLIT.trainBars + SPLIT.embargoBars + SPLIT.oosBars): Bar[] {
  validateOptions({ seed });
  if (!Number.isInteger(count) || count < 2 || count > 10_000) throw new Error("invalid bar count");
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  let price = 100;
  let previousReturn = 0;
  return Array.from({ length: count }, (_, index) => {
    const regime = Math.floor(index / 40) % 3;
    const drift = [0.0018, -0.0012, 0.0002][regime];
    const persistence = [0.55, 0.50, -0.40][regime];
    const innovation = (random() + random() + random() - 1.5) * 0.025;
    const dailyReturn = Math.max(-0.15, Math.min(0.15, drift + persistence * previousReturn + innovation));
    const open = price * (1 + (random() - 0.5) * 0.003);
    const close = open * (1 + dailyReturn);
    const spread = random() * 0.005;
    price = close;
    previousReturn = dailyReturn;
    return {
      index,
      timestamp: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
      open,
      high: Math.max(open, close) * (1 + spread),
      low: Math.min(open, close) * (1 - spread),
      close,
    };
  });
}

export function fingerprint(bars: Bar[]): string {
  return createHash("sha256").update(JSON.stringify(bars)).digest("hex");
}

/** Copies only the visible prefix: modifying a miner's task cannot change validator data. */
export function createTask(bars: Bar[], asOf: number): MinerTask {
  if (!Number.isInteger(asOf) || asOf < 1 || asOf >= bars.length) throw new Error("invalid asOf");
  const history = bars.slice(0, asOf + 1).map((bar) => ({ ...bar }));
  const visibleFingerprint = fingerprint(history).slice(0, 16);
  return {
    version: "quant-task-v1",
    taskId: `task-${asOf}-${visibleFingerprint}`,
    asOf,
    asOfTimestamp: history[history.length - 1].timestamp,
    history,
    horizon: 1,
    maxPosition: 1,
    // One bar between the last admitted training label and the next traded bar.
    maxTrainThrough: asOf - 1,
  };
}

export function getDemoTask(options: TournamentOptions = {}): MinerTask {
  const { seed } = validateOptions(options);
  return createTask(generateBars(seed), SPLIT.trainBars + SPLIT.embargoBars - 1);
}
