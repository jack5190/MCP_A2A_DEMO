export interface Bar {
  index: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Sent at close t. Only the validator sees the bar traded at t + 1. */
export interface MinerTask {
  version: "quant-task-v1";
  taskId: string;
  asOf: number;
  asOfTimestamp: string;
  history: Bar[];
  horizon: 1;
  maxPosition: 1;
  maxTrainThrough: number;
}

export interface MinerSubmission {
  taskId: string;
  targetPosition: number;
  featureAsOf: number;
  trainedThrough: number;
  provenance?: string;
}

export interface Miner {
  id: string;
  label: string;
  predict(task: MinerTask): MinerSubmission;
}

export interface TournamentOptions {
  seed?: number;
  feeBps?: number;
  slippageBps?: number;
}

export interface Metrics {
  netReturn: number;
  sharpe: number;
  maxDrawdown: number;
  volatility: number;
  activeDecisions: number;
  periods: number;
}

export interface FoldMetrics extends Metrics { fold: number }

export interface ScoreComponents {
  excessReturn: number;
  riskAdjusted: number;
  drawdown: number;
  consistency: number;
}

export interface LeaderboardEntry {
  rank: number;
  minerId: string;
  label: string;
  status: "eligible" | "ineligible" | "disqualified";
  score: number;
  rewardWeight: number;
  metrics: Metrics;
  folds: FoldMetrics[];
  leakageRisk: number;
  flags: string[];
  components: ScoreComponents;
  equityCurve: number[];
}

export interface TraceEvent {
  from: string;
  to: string;
  intent: string;
  detail: string;
}

export interface ScorePolicy {
  version: string;
  periodsPerYear: number;
  minActiveDecisions: number;
  excessReturnTarget: number;
  sharpeTarget: number;
  drawdownLimit: number;
  missingProvenanceRisk: number;
  weights: Readonly<ScoreComponents>;
}

export interface TournamentResult {
  version: "quant-tournament-v1";
  simulation: true;
  seed: number;
  dataFingerprint: string;
  policy: Readonly<ScorePolicy>;
  costs: { feeBps: number; slippageBps: number };
  split: { trainBars: number; embargoBars: number; oosBars: number; folds: number };
  benchmark: Metrics;
  leaderboard: LeaderboardEntry[];
  trace: TraceEvent[];
  limitations: string[];
}

export interface EvaluationInput {
  minerId: string;
  label: string;
  tasks: MinerTask[];
  futureBars: Bar[];
  submissions: MinerSubmission[];
  benchmarkReturn: number;
  feeBps: number;
  slippageBps: number;
  foldSize: number;
}
