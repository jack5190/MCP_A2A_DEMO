import type { Miner, MinerSubmission, MinerTask } from "./types.js";

export const MINER_IDS = Object.freeze(["ridge", "momentum", "mean-reversion", "long-only", "cash", "future-leak"] as const);
export type MinerId = (typeof MINER_IDS)[number];

const clamp = (value: number, limit = 1) => Math.max(-limit, Math.min(limit, value));
const barReturn = (task: MinerTask, index: number) => task.history[index].close / task.history[index].open - 1;

/** Fixed regularization/position scale. No fitting on the final leaderboard. */
function ridgePosition(task: MinerTask): number {
  const end = Math.min(task.maxTrainThrough, task.history.length - 1);
  const pairs: { x: number; y: number }[] = [];
  for (let label = Math.max(1, end - 79); label <= end; label++) {
    pairs.push({ x: barReturn(task, label - 1), y: barReturn(task, label) });
  }
  if (pairs.length < 20) return 0;
  const meanX = pairs.reduce((sum, point) => sum + point.x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, point) => sum + point.y, 0) / pairs.length;
  const covariance = pairs.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const variance = pairs.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  const slope = covariance / (variance + 0.001);
  return clamp((meanY + slope * (barReturn(task, task.asOf) - meanX)) / 0.008);
}

const labels: Record<MinerId, string> = {
  ridge: "Causal ridge model",
  momentum: "Momentum (5 bars)",
  "mean-reversion": "Mean reversion (5 bars)",
  "long-only": "Long-only benchmark",
  cash: "Cash baseline",
  "future-leak": "Future timestamp (invalid fixture)",
};

export function runDemoMiner(minerId: string, task: MinerTask): MinerSubmission {
  if (!MINER_IDS.includes(minerId as MinerId)) throw new Error(`Unknown miner: ${minerId}`);
  const id = minerId as MinerId;
  const tail = task.history.slice(-5);
  const meanReturn = tail.reduce((sum, bar) => sum + bar.close / bar.open - 1, 0) / tail.length;
  const momentum = clamp(meanReturn / 0.006);
  const positions: Record<MinerId, () => number> = {
    ridge: () => ridgePosition(task),
    momentum: () => momentum,
    "mean-reversion": () => -momentum,
    "long-only": () => 1,
    cash: () => 0,
    "future-leak": () => 1,
  };
  return {
    taskId: task.taskId,
    targetPosition: positions[id](),
    featureAsOf: id === "future-leak" ? task.asOf + 1 : task.asOf,
    trainedThrough: task.maxTrainThrough,
    provenance: `builtin:${id}:v1; chronological OHLC only; parameters fixed`,
  };
}

export function builtInMiners(): Miner[] {
  return MINER_IDS.map((id) => ({ id, label: labels[id], predict: (task) => runDemoMiner(id, task) }));
}
