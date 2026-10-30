import type { EvaluationInput, LeaderboardEntry, Metrics, MinerSubmission, MinerTask, ScoreComponents, ScorePolicy } from "./types.js";

export const SCORE_POLICY: Readonly<ScorePolicy> = Object.freeze({
  version: "ideathon-score-v1",
  periodsPerYear: 365,
  minActiveDecisions: 10,
  excessReturnTarget: 0.10,
  sharpeTarget: 2,
  drawdownLimit: 0.30,
  missingProvenanceRisk: 0.40,
  weights: Object.freeze({ excessReturn: 0.35, riskAdjusted: 0.35, drawdown: 0.20, consistency: 0.10 }),
});

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Position is a fraction of starting equity: enter at open, fully exit at close. */
export function paperReturn(position: number, open: number, close: number, feeBps: number, slippageBps: number): number {
  if (![position, open, close, feeBps, slippageBps].every(Number.isFinite) || Math.abs(position) > 1 ||
      open <= 0 || close <= 0 || feeBps < 0 || slippageBps < 0 || feeBps > 100 || slippageBps > 100) {
    throw new Error("Invalid paper execution input");
  }
  // Simplified symmetric notional cost. No overnight exposure, borrow/funding, or interest.
  return position * (close / open - 1) - 2 * (feeBps + slippageBps) / 10_000 * Math.abs(position);
}

/** Includes the starting equity so the very first loss contributes to drawdown. */
export function metrics(returns: number[], activeDecisions = returns.filter((value) => value !== 0).length): { metrics: Metrics; equityCurve: number[] } {
  if (!returns.length || returns.some((value) => !Number.isFinite(value) || value < -1)) throw new Error("Invalid returns");
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : 0;
  const dailyVolatility = Math.sqrt(variance);
  const equityCurve = [1];
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    const equity = equityCurve[equityCurve.length - 1] * (1 + value);
    equityCurve.push(equity);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
  }
  return {
    metrics: {
      netReturn: equityCurve[equityCurve.length - 1] - 1,
      // No artificial infinity reward for flat/constant-return paths.
      sharpe: dailyVolatility > 1e-12 ? mean / dailyVolatility * Math.sqrt(SCORE_POLICY.periodsPerYear) : 0,
      maxDrawdown,
      volatility: dailyVolatility * Math.sqrt(SCORE_POLICY.periodsPerYear),
      activeDecisions,
      periods: returns.length,
    },
    equityCurve,
  };
}

export function auditSubmission(task: MinerTask, submission: MinerSubmission): { flags: string[]; hardViolation: boolean; leakageRisk: number } {
  const flags: string[] = [];
  if (!submission || typeof submission !== "object") return { flags: ["invalid-submission"], hardViolation: true, leakageRisk: 1 };
  if (submission.taskId !== task.taskId) flags.push("task-id-mismatch");
  if (!Number.isFinite(submission.targetPosition) || Math.abs(submission.targetPosition) > task.maxPosition) flags.push("invalid-position");
  if (!Number.isInteger(submission.featureAsOf) || submission.featureAsOf < 0) flags.push("invalid-feature-time");
  else if (submission.featureAsOf > task.asOf) flags.push("future-feature-leak");
  if (!Number.isInteger(submission.trainedThrough) || submission.trainedThrough < 0) flags.push("invalid-training-time");
  else if (submission.trainedThrough > task.maxTrainThrough) flags.push("training-label-embargo-violation");
  const hardViolation = flags.length > 0;
  const missingProvenance = typeof submission.provenance !== "string" || submission.provenance.trim().length === 0;
  if (missingProvenance) flags.push("missing-provenance");
  return { flags, hardViolation, leakageRisk: hardViolation ? 1 : missingProvenance ? SCORE_POLICY.missingProvenanceRisk : 0 };
}

export function evaluateMiner(input: EvaluationInput): LeaderboardEntry {
  const { tasks, futureBars, submissions, feeBps, slippageBps, foldSize } = input;
  if (!tasks.length || tasks.length !== futureBars.length || !Number.isInteger(foldSize) || foldSize < 1 || tasks.length % foldSize) {
    throw new Error("Validator tasks/labels/folds are inconsistent");
  }
  if (!Number.isFinite(input.benchmarkReturn)) throw new Error("Invalid benchmark return");
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length || tasks.some((task, i) =>
    futureBars[i].index !== task.asOf + 1 || (i > 0 && task.asOf !== tasks[i - 1].asOf + 1))) {
    throw new Error("Validator labels are not chronological one-step targets");
  }
  const flags = new Set<string>();
  let hardViolation = false;
  let leakageRisk = 0;
  const byTask = new Map<string, MinerSubmission>();
  const knownTasks = new Set(tasks.map((task) => task.taskId));
  for (const submission of submissions) {
    if (!submission || typeof submission !== "object" || !knownTasks.has(submission.taskId)) {
      flags.add("unknown-task-submission"); hardViolation = true; continue;
    }
    if (byTask.has(submission.taskId)) { flags.add("duplicate-submission"); hardViolation = true; }
    byTask.set(submission.taskId, submission);
  }
  let returns: number[] = [];
  let positions: number[] = [];
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const submission = byTask.get(task.taskId);
    if (!submission) {
      flags.add("missing-submission"); hardViolation = true; returns.push(0); positions.push(0); continue;
    }
    const audit = auditSubmission(task, submission);
    audit.flags.forEach((flag) => flags.add(flag));
    hardViolation ||= audit.hardViolation;
    leakageRisk = Math.max(leakageRisk, audit.leakageRisk);
    const position = audit.hardViolation ? 0 : submission.targetPosition;
    const future = futureBars[index];
    returns.push(paperReturn(position, future.open, future.close, feeBps, slippageBps));
    positions.push(position);
  }
  if (hardViolation) {
    leakageRisk = 1;
    // Rejected submissions have no valid performance claim; never advertise oracle P&L.
    returns = returns.map(() => 0);
    positions = positions.map(() => 0);
  }
  const active = (values: number[]) => values.filter((value) => Math.abs(value) > 1e-9).length;
  const measured = metrics(returns, active(positions));
  const folds = Array.from({ length: returns.length / foldSize }, (_, fold) => ({
    fold: fold + 1,
    ...metrics(returns.slice(fold * foldSize, (fold + 1) * foldSize), active(positions.slice(fold * foldSize, (fold + 1) * foldSize))).metrics,
  }));
  const performance = measured.metrics;
  const components: ScoreComponents = {
    excessReturn: clamp01((performance.netReturn - input.benchmarkReturn) / SCORE_POLICY.excessReturnTarget),
    riskAdjusted: clamp01(performance.sharpe / SCORE_POLICY.sharpeTarget),
    drawdown: clamp01(1 - performance.maxDrawdown / SCORE_POLICY.drawdownLimit),
    consistency: folds.filter((fold) => fold.netReturn > 0).length / folds.length,
  };
  if (performance.netReturn <= 0) flags.add("non-positive-net-return");
  if (performance.sharpe <= 0) flags.add("non-positive-or-undefined-sharpe");
  if (performance.activeDecisions < SCORE_POLICY.minActiveDecisions) flags.add("insufficient-active-decisions");
  const eligible = !hardViolation && performance.netReturn > 0 && performance.sharpe > 0 && performance.activeDecisions >= SCORE_POLICY.minActiveDecisions;
  const score = eligible ? 100 * (Object.keys(components) as (keyof ScoreComponents)[])
    .reduce((sum, key) => sum + SCORE_POLICY.weights[key] * components[key], 0) * (1 - leakageRisk) : 0;
  return {
    rank: 0,
    minerId: input.minerId,
    label: input.label,
    status: hardViolation ? "disqualified" : eligible ? "eligible" : "ineligible",
    score,
    rewardWeight: 0,
    metrics: performance,
    folds,
    leakageRisk,
    flags: [...flags].sort(),
    components,
    equityCurve: measured.equityCurve,
  };
}

/** Local reward illustration only; never writes Bittensor weights or pays tokens. */
export function rankEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const order = { eligible: 0, ineligible: 1, disqualified: 2 };
  const sorted = [...entries].sort((a, b) => b.score - a.score || order[a.status] - order[b.status] || (a.minerId < b.minerId ? -1 : a.minerId > b.minerId ? 1 : 0));
  const total = sorted.reduce((sum, entry) => sum + entry.score, 0);
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1, rewardWeight: total > 0 ? entry.score / total : 0 }));
}
