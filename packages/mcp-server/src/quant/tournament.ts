import { createTask, fingerprint, generateBars, SPLIT, validateOptions } from "./data.js";
import { builtInMiners } from "./miners.js";
import { evaluateMiner, metrics, paperReturn, rankEntries, SCORE_POLICY } from "./validator.js";
import type { Miner, TournamentOptions, TournamentResult } from "./types.js";

/** Pure in-memory runner. Never accepts or executes uploaded code or reaches external services. */
export function runTournament(options: TournamentOptions = {}, miners: Miner[] = builtInMiners()): TournamentResult {
  const { seed, feeBps, slippageBps } = validateOptions(options);
  if (!miners.length || new Set(miners.map((miner) => miner.id)).size !== miners.length) throw new Error("Miner IDs must be nonempty and unique");
  const bars = generateBars(seed);
  const firstTarget = SPLIT.trainBars + SPLIT.embargoBars;
  const tasks = bars.slice(firstTarget).map((bar) => createTask(bars, bar.index - 1));
  const futureBars = bars.slice(firstTarget);
  const benchmarkReturns = futureBars.map((bar) => paperReturn(1, bar.open, bar.close, feeBps, slippageBps));
  const benchmark = metrics(benchmarkReturns, benchmarkReturns.length).metrics;
  const leaderboard = rankEntries(miners.map((miner) => {
    const submissions = tasks.flatMap((task) => {
      try {
        // Each miner gets a fresh copy. The original validator task and all labels stay outside.
        const submission = miner.predict(structuredClone(task));
        // Commit a value snapshot now: later tasks must not rewrite earlier decisions.
        return [structuredClone(submission)];
      } catch {
        return []; // Exceptions become auditable missing submissions and disqualification.
      }
    });
    return evaluateMiner({ minerId: miner.id, label: miner.label, tasks, futureBars, submissions,
      benchmarkReturn: benchmark.netReturn, feeBps, slippageBps, foldSize: SPLIT.oosBars / SPLIT.folds });
  }));
  return {
    version: "quant-tournament-v1",
    simulation: true,
    seed,
    dataFingerprint: fingerprint(bars),
    policy: SCORE_POLICY,
    costs: { feeBps, slippageBps },
    split: SPLIT,
    benchmark,
    leaderboard,
    trace: [
      { from: "Coordinator", to: "Validator", intent: "freeze_policy", detail: `${SCORE_POLICY.version}; seed=${seed}; synthetic data fingerprint ${fingerprint(bars)}` },
      { from: "Validator", to: "Miners", intent: "issue_tasks", detail: `${tasks.length} causal tasks each; history through close t; training labels through t-1; trade next open to next close` },
      ...leaderboard.map((entry) => ({ from: entry.minerId, to: "Validator", intent: "score_submission", detail: `${entry.status}; score=${entry.score.toFixed(3)}; flags=${entry.flags.join(",") || "none detected"}` })),
      { from: "Validator", to: "Coordinator", intent: "publish_leaderboard", detail: "Local illustrative weights only; no network, wallet, tokens, or real orders" },
    ],
    limitations: [
      "Public seed and synthetic generator make this a reproducible demonstration, not a secret or adversary-resistant benchmark.",
      "Timestamp/provenance checks detect declared violations, not dishonest metadata, hidden training data, or memorization; leakageRisk=0 means no implemented check fired.",
      "Three contiguous OOS folds summarize one prequential walk-forward path, not independent cross-validation samples or an untouched final holdout. Hyperparameters are fixed; ridge refits on at most 80 prior labels through t-1, including earlier OOS outcomes after observation.",
      "Daily intraday paper positions fully liquidate at close. Costs use symmetric entry notional; overnight gaps, borrow/funding, market impact and fills are simplified.",
      "Sharpe is a descriptive statistic of 120 synthetic daily observations, not evidence of investment skill or statistical significance.",
      "The 30% drawdown parameter is a scoring cutoff, not a hard risk stop. Rewards can include profitable baseline exposure; minimum activity alone does not prevent tiny-position or correlation gaming.",
      "Miner implementations share a local process; use authenticated remote APIs, isolation, deadlines and private rotating holdouts before accepting untrusted competitors.",
      "This is not a Bittensor subnet deployment: no chain registration, validator consensus, staking, emissions, or on-chain weight submission.",
    ],
  };
}
