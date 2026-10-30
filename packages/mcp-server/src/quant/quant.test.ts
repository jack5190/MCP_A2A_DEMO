import { test } from "node:test";
import assert from "node:assert/strict";
import { auditSubmission, builtInMiners, createTask, evaluateMiner, generateBars, getDemoTask, metrics, paperReturn, rankEntries, runDemoMiner, runTournament, SCORE_POLICY } from "./index.js";
import type { EvaluationInput, MinerSubmission } from "./types.js";

const near = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

function fixture(): EvaluationInput {
  const bars = generateBars(12, 16);
  // Known alternating +1%, +2% outcomes. No dependency on the generator's returns.
  for (let index = 4; index < 16; index++) {
    bars[index].open = 100;
    bars[index].close = index % 2 === 0 ? 101 : 102;
  }
  const tasks = bars.slice(4).map((bar) => createTask(bars, bar.index - 1));
  return {
    minerId: "known-long", label: "known", tasks,
    futureBars: bars.slice(4), submissions: tasks.map((task) => runDemoMiner("long-only", task)),
    benchmarkReturn: 0, feeBps: 0, slippageBps: 0, foldSize: 4,
  };
}

test("paper fills use next open-to-close returns, charge entry and exit, and cash pays nothing", () => {
  near(paperReturn(0.5, 100, 110, 5, 5), 0.049);
  near(paperReturn(-1, 100, 90, 5, 5), 0.098);
  assert.equal(paperReturn(0, 100, 110, 5, 5), 0);
  assert.throws(() => paperReturn(2, 100, 110, 5, 5), /Invalid/);
});

test("drawdown includes initial equity and compounds independently checked returns", () => {
  const result = metrics([-0.10, 0.20, -0.25], 3);
  near(result.metrics.netReturn, -0.19);
  near(result.metrics.maxDrawdown, 0.25);
  near(metrics([-0.25, 0.1]).metrics.maxDrawdown, 0.25);
  assert.deepEqual(result.equityCurve.map((value) => Number(value.toFixed(6))), [1, 0.9, 1.08, 0.81]);
});

test("Sharpe uses sample volatility and explicit 365-period annualization", () => {
  const actual = metrics([0.01, -0.01, 0.02]);
  const mean = 0.02 / 3;
  const sampleDeviation = Math.sqrt(((0.01 - mean) ** 2 + (-0.01 - mean) ** 2 + (0.02 - mean) ** 2) / 2);
  near(actual.metrics.sharpe, mean / sampleDeviation * Math.sqrt(365));
  near(actual.metrics.volatility, sampleDeviation * Math.sqrt(365));
});

test("cash and constant-return paths have finite zero-variance policy", () => {
  assert.equal(metrics([0, 0, 0]).metrics.sharpe, 0);
  assert.equal(metrics([0.01, 0.01, 0.01]).metrics.sharpe, 0);
  assert.equal(metrics([0]).metrics.maxDrawdown, 0);
  assert.throws(() => metrics([NaN]), /Invalid/);
});

test("task contains only prefix data and is unchanged by future perturbation", () => {
  const bars = generateBars();
  const before = createTask(bars, 120);
  bars[121].close *= 9;
  assert.deepEqual(createTask(bars, 120), before);
  assert.equal(before.history.length, 121);
  assert.equal(before.maxTrainThrough, 119);
  before.history[0].close = 0;
  assert.ok(bars[0].close > 0);
});

test("all built-in decisions are invariant to unavailable future prices", () => {
  const bars = generateBars();
  const task = createTask(bars, 120);
  const originals = builtInMiners().map((miner) => miner.predict(task));
  bars.slice(121).forEach((bar) => { bar.close *= 3; bar.open *= 2; });
  assert.deepEqual(builtInMiners().map((miner) => miner.predict(createTask(bars, 120))), originals);
});

test("future features, future training labels and wrong task identity are rejected", () => {
  const task = getDemoTask();
  const valid = runDemoMiner("ridge", task);
  assert.equal(auditSubmission(task, valid).hardViolation, false);
  for (const override of [
    { featureAsOf: task.asOf + 1 }, { trainedThrough: task.asOf },
    { targetPosition: Infinity }, { targetPosition: 1.01 }, { taskId: "other" },
  ]) assert.equal(auditSubmission(task, { ...valid, ...override }).hardViolation, true);
});

test("missing provenance applies a measurable score penalty, without claiming cryptographic proof", () => {
  const complete = fixture();
  const original = evaluateMiner(complete);
  assert.equal(original.status, "eligible");
  const missing = evaluateMiner({ ...complete, submissions: complete.submissions.map(({ provenance: _provenance, ...rest }) => rest) });
  near(missing.score, original.score * (1 - SCORE_POLICY.missingProvenanceRisk));
  assert.ok(missing.flags.includes("missing-provenance"));
});

test("missing, duplicate and foreign submissions fail closed; missing days never improve Sharpe", () => {
  const input = fixture();
  for (const submissions of [
    input.submissions.slice(1), [...input.submissions, input.submissions[0]],
    input.submissions.map((submission, index) => index ? submission : { ...submission, taskId: "foreign" }),
  ]) {
    const entry = evaluateMiner({ ...input, submissions });
    assert.equal(entry.status, "disqualified");
    assert.equal(entry.score, 0);
    assert.equal(entry.metrics.periods, 12);
    assert.equal(entry.leakageRisk, 1);
  }
});

test("more execution costs strictly reduce independently recomputed OOS profit", () => {
  const input = fixture();
  const free = evaluateMiner(input);
  const charged = evaluateMiner({ ...input, feeBps: 5, slippageBps: 5 });
  assert.ok(charged.metrics.netReturn < free.metrics.netReturn);
  near(free.metrics.netReturn, (1.01 * 1.02) ** 6 - 1);
  near(charged.metrics.netReturn, (1.008 * 1.018) ** 6 - 1);
});

test("cash cannot collect drawdown points and a losing strategy receives no reward", () => {
  const input = fixture();
  const cash = evaluateMiner({ ...input, submissions: input.submissions.map((submission) => ({ ...submission, targetPosition: 0 })) });
  const short = evaluateMiner({ ...input, submissions: input.submissions.map((submission) => ({ ...submission, targetPosition: -1 })) });
  assert.equal(cash.score, 0);
  assert.equal(cash.status, "ineligible");
  assert.equal(short.score, 0);
  assert.ok(short.metrics.netReturn < 0);
  assert.ok(rankEntries([cash, short]).every((entry) => entry.rewardWeight === 0));
});

test("fixed scoring weights/targets produce an auditable score and normalized local weights", () => {
  const first = evaluateMiner(fixture());
  const second = { ...first, minerId: "z-copy", score: first.score / 2 };
  const expected = 100 * (0.35 * first.components.excessReturn + 0.35 * first.components.riskAdjusted +
    0.20 * first.components.drawdown + 0.10 * first.components.consistency);
  near(first.score, expected);
  const ranking = rankEntries([second, first]);
  near(ranking[0].rewardWeight, 2 / 3);
  near(ranking[1].rewardWeight, 1 / 3);
  assert.equal(ranking[0].rank, 1);
});

test("seed42 stays reproducible, uses all120 OOS periods, and benchmark shares costs", () => {
  const result = runTournament();
  assert.deepEqual(runTournament(), result);
  assert.equal(result.dataFingerprint.length, 64);
  assert.ok(result.leaderboard.every((entry) => entry.metrics.periods === 120 && entry.folds.length === 3));
  assert.deepEqual(result.leaderboard.find((entry) => entry.minerId === "long-only")!.metrics, result.benchmark);
  assert.equal(result.leaderboard.find((entry) => entry.minerId === "future-leak")!.status, "disqualified");
  assert.equal(result.leaderboard.find((entry) => entry.minerId === "cash")!.rewardWeight, 0);
  assert.ok(result.leaderboard.every((entry) => Number.isFinite(entry.score) && Number.isFinite(entry.rewardWeight)));
});

test("later task information cannot rewrite already submitted predictions through shared references", () => {
  let previous: MinerSubmission | undefined;
  const mutating = runTournament({}, [{ id: "reference-attacker", label: "reference attacker", predict(task) {
    // Previous task's outcome is visible now. Attempt to rewrite its returned object.
    if (previous) previous.targetPosition = Math.sign(task.history.at(-1)!.close / task.history.at(-1)!.open - 1);
    previous = { taskId: task.taskId, targetPosition: 0, featureAsOf: task.asOf,
      trainedThrough: task.maxTrainThrough, provenance: "test" };
    return previous;
  } }]);
  assert.equal(mutating.leaderboard[0].metrics.netReturn, 0);
  assert.equal(mutating.leaderboard[0].metrics.activeDecisions, 0);
});

test("miner input mutation and exceptions do not affect peer results", () => {
  const base = runTournament();
  const hostile = runTournament({}, [{ id: "mutator", label: "mutator", predict(task) {
    task.history.forEach((bar) => { bar.close = 0; });
    task.asOf = 999;
    throw new Error("fail");
  } }, ...builtInMiners()]);
  assert.deepEqual(hostile.benchmark, base.benchmark);
  for (const entry of base.leaderboard) {
    const peer = hostile.leaderboard.find((candidate) => candidate.minerId === entry.minerId)!;
    assert.deepEqual(peer.metrics, entry.metrics);
  }
  assert.equal(hostile.leaderboard.find((entry) => entry.minerId === "mutator")!.status, "disqualified");
});

test("invalid numeric run options and duplicate miner IDs are rejected", () => {
  for (const options of [{ seed: -1 }, { seed: 1.5 }, { seed: 2 ** 32 }, { feeBps: NaN }, { slippageBps: -1 }, { feeBps: 101 }]) {
    assert.throws(() => runTournament(options));
  }
  const miner = builtInMiners()[0];
  assert.throws(() => runTournament({}, [miner, miner]), /unique/);
});
