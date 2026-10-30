"use client";

import { useState } from "react";
import Link from "next/link";
import type { QuantExecutionResult } from "@/lib/quantExecutor";
import styles from "./quant.module.css";

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number) => `${value > 0 ? "+" : ""}${pct(value)}`;
const number = (value: number) => value.toFixed(2);
const STATUS = { eligible: "参与分配", ineligible: "未达门槛", disqualified: "违规归零" } as const;

function EquityChart({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <p className={styles.hint}>无有效净值曲线。</p>;
  const width = 640;
  const height = 180;
  const low = Math.min(1, ...values);
  const high = Math.max(1, ...values);
  const padding = Math.max((high - low) * 0.12, 0.01);
  const minimum = low - padding;
  const maximum = high + padding;
  const y = (value: number) => 15 + (1 - (value - minimum) / (maximum - minimum)) * (height - 38);
  const points = values.map((value, i) => `${12 + (i / (values.length - 1)) * (width - 24)},${y(value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} 的样本外模拟净值，初始净值为 1`} style={{ width: "100%", display: "block", marginTop: 12 }}>
      <line x1="12" y1={y(1)} x2={width - 12} y2={y(1)} stroke="var(--border)" strokeDasharray="5 5" />
      <polyline points={points} fill="none" stroke="var(--accent-2)" strokeWidth="2" />
      <text x="12" y={height - 3} fill="var(--muted)" fontSize="11">起始 1.00</text>
      <text x={width - 12} y={height - 3} textAnchor="end" fill="var(--muted)" fontSize="11">期末 {values[values.length - 1].toFixed(4)}</text>
    </svg>
  );
}

export default function QuantPage() {
  const [seed, setSeed] = useState("42");
  const [feeBps, setFeeBps] = useState("5");
  const [slippageBps, setSlippageBps] = useState("5");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuantExecutionResult | null>(null);
  const [selectedMiner, setSelectedMiner] = useState("");

  async function runRound(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/quant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed: Number(seed), feeBps: Number(feeBps), slippageBps: Number(slippageBps) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "评分请求失败。");
      const execution = data as QuantExecutionResult;
      setResult(execution);
      const entries = execution.tournament.leaderboard;
      setSelectedMiner(
        (entries.find((entry) => entry.status === "eligible") ??
          entries.find((entry) => entry.minerId === "ridge" && entry.status !== "disqualified") ??
          entries.find((entry) => entry.status !== "disqualified"))?.minerId ?? "",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法连接本地演示服务。");
    } finally {
      setRunning(false);
    }
  }

  const tournament = result?.tournament;
  const selected = tournament?.leaderboard.find((entry) => entry.minerId === selectedMiner);
  const rewardCount = tournament?.leaderboard.filter((entry) => entry.rewardWeight > 0).length ?? 0;
  const rejectedCount = tournament?.leaderboard.filter((entry) => entry.status === "disqualified").length ?? 0;
  const policy = tournament?.policy;

  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="页面导航">
        <Link href="/">← AutoA2A Agent Demo</Link>
        <span>Mini Ideathon · 机制演示</span>
      </nav>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>AutoA2A / Quant Subnet Lab</div>
          <h1>让策略竞争，让证据决定分数。</h1>
          <p>Miner 提交下一期仓位，Validator 独立回放同一组样本外数据。比较净收益、收益风险、最大回撤和数据泄露风险，查看每一分从何而来。</p>
        </div>
        <span className={styles.badge}>本地模拟 · 合成数据 · 无真实交易</span>
      </header>

      <section className={styles.panel} aria-label="模拟轮次参数">
        <form onSubmit={runRound}>
          <div className={styles.controls}>
            <div>
              <label htmlFor="quant-seed">数据种子 Seed</label>
              <input id="quant-seed" type="number" min="0" max="4294967295" step="1" required value={seed} onChange={(event) => setSeed(event.target.value)} disabled={running} />
            </div>
            <div>
              <label htmlFor="quant-fee">单边手续费 / bps</label>
              <input id="quant-fee" type="number" min="0" max="100" step="0.1" required value={feeBps} onChange={(event) => setFeeBps(event.target.value)} disabled={running} />
            </div>
            <div>
              <label htmlFor="quant-slippage">单边滑点 / bps</label>
              <input id="quant-slippage" type="number" min="0" max="100" step="0.1" required value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)} disabled={running} />
            </div>
            <button type="submit" className={styles.runButton} disabled={running}>{running ? "正在回放与评分…" : "运行一轮 Miner 竞争 →"}</button>
          </div>
          <p className={styles.hint}>相同种子与成本可复现同一结果。每期次日开盘建仓、收盘平仓，扣除双边成本；1 bps = 0.01%。</p>
          <div className={styles.presets}>
            <button type="button" className={styles.presetButton} disabled={running} onClick={() => { setFeeBps("0"); setSlippageBps("0"); }}>零成本对照：设为 0 / 0</button>
            <button type="button" className={styles.presetButton} disabled={running} onClick={() => { setFeeBps("5"); setSlippageBps("5"); }}>恢复默认成本 5 / 5</button>
            <span>仅设置参数，需点击运行。零成本是忽略交易摩擦的诊断对照。</span>
          </div>
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </form>
      </section>

      <div className={styles.notice}>这是一套 Bittensor 风格的评分实验。排行榜权重只表示本地模拟分配比例，不涉及链上奖励。活动公开说明无需代码或 Demo，本页面用于说明你的机制设计。</div>

      {!tournament && !running && (
        <section className={`${styles.panel} ${styles.empty}`}>
          <strong>用同一把尺，评价不同的 Miner。</strong>
          <p>运行后可比较模型、规则策略、现金与做多基准，并观察未来数据违规样本被归零。</p>
          <p className={styles.hint}>现场演示：运行默认轮次 → 同一种子设置 0 / 0 并运行 → 恢复 5 / 5 并运行，观察交易成本如何改变收益与奖励。</p>
        </section>
      )}
      {running && <div role="status" className={`${styles.panel} ${styles.empty}`}>Coordinator 正在通过 MCP 发出任务，并调用 Validator…</div>}

      {tournament && policy && result && (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}><span>样本外评估</span><strong>{tournament.split.oosBars} 期 / {tournament.split.folds} 折</strong></div>
            <div className={styles.stat}><span>训练 / 隔离区间</span><strong>{tournament.split.trainBars} / {tournament.split.embargoBars} 期</strong></div>
            <div className={styles.stat}><span>获得模拟分配</span><strong>{rewardCount} / {tournament.leaderboard.length} Miner</strong></div>
            <div className={styles.stat}><span>数据与接口违规</span><strong className={rejectedCount ? styles.negative : undefined}>{rejectedCount} 个归零</strong></div>
          </div>

          <section className={styles.panel} aria-label="模拟策略排行榜">
            <div className={styles.sectionTitle}>
              <h2>模拟策略排行榜</h2>
              <span>实际参数：Seed {tournament.seed} · 手续费 {tournament.costs.feeBps} + 滑点 {tournament.costs.slippageBps} bps / 单边</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>#</th><th>Miner</th><th>状态</th><th>样本外净收益</th><th>超额收益</th><th>Sharpe</th><th>最大回撤</th><th>泄露风险</th><th>评分 / 100</th><th>模拟权重</th></tr></thead>
                <tbody>
                  {tournament.leaderboard.map((entry) => (
                    <tr key={entry.minerId} className={entry.rank === 1 && entry.rewardWeight > 0 ? styles.winner : undefined}>
                      <td>{entry.rank}</td>
                      <td><span className={styles.name}>{entry.label}</span><span className={styles.sub}>{entry.minerId}</span></td>
                      <td><span className={`${styles.status} ${entry.status === "eligible" ? styles.positive : entry.status === "disqualified" ? styles.negative : styles.warning}`}>{STATUS[entry.status]}</span></td>
                      <td className={entry.status === "disqualified" ? undefined : entry.metrics.netReturn >= 0 ? styles.positive : styles.negative}>{entry.status === "disqualified" ? "—" : signedPct(entry.metrics.netReturn)}</td>
                      <td>{entry.status === "disqualified" ? "—" : signedPct(entry.metrics.netReturn - tournament.benchmark.netReturn)}</td>
                      <td>{entry.status === "disqualified" ? "—" : number(entry.metrics.sharpe)}</td>
                      <td>{entry.status === "disqualified" ? "—" : pct(entry.metrics.maxDrawdown)}</td>
                      <td className={entry.leakageRisk > 0 ? styles.warning : undefined}>{pct(entry.leakageRisk, 0)}</td>
                      <td className={styles.score}>{number(entry.score)}</td>
                      <td>{pct(entry.rewardWeight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.hint}>超额收益 = 策略累计净收益 − 相同成本下逐日做多基准净收益（{signedPct(tournament.benchmark.netReturn)}）。Sharpe 按 {policy.periodsPerYear} 期年化；泄露风险是规则惩罚系数，不是统计概率。</p>
            {rejectedCount > 0 && <p className={styles.hint}>“—”表示违规提交不采信收益指标，不能解读为零收益或跑赢基准。</p>}
            {rewardCount === 0 && <p className={styles.warning}>本轮无人达到分配门槛，全部权重为 0，不强行产生获奖策略。</p>}
          </section>

          <div className={styles.twoCols}>
            <section className={styles.panel}>
              <h2>查看策略证据</h2>
              <label htmlFor="quant-miner">选择 Miner</label>
              <select id="quant-miner" value={selectedMiner} onChange={(event) => setSelectedMiner(event.target.value)}>
                {tournament.leaderboard.map((entry) => <option key={entry.minerId} value={entry.minerId}>{entry.label} · {STATUS[entry.status]}</option>)}
              </select>
              {selected && (
                <>
                  {selected.status === "disqualified" ? (
                    <p className={styles.warning}>违规提交不采信收益指标。该 Miner 的分数与模拟权重归零；不展示净值曲线或分段收益。</p>
                  ) : (
                    <>
                      <EquityChart values={selected.equityCurve} label={selected.label} />
                      <div className={styles.tableWrap}>
                        <table className={`${styles.table} ${styles.foldTable}`}>
                          <thead><tr><th>顺序样本外区段</th><th>净收益</th><th>Sharpe</th><th>最大回撤</th><th>非零仓位期数</th></tr></thead>
                          <tbody>{selected.folds.map((fold) => <tr key={fold.fold}><td>第 {fold.fold} 折</td><td>{signedPct(fold.netReturn)}</td><td>{number(fold.sharpe)}</td><td>{pct(fold.maxDrawdown)}</td><td>{fold.activeDecisions} / {fold.periods}</td></tr>)}</tbody>
                        </table>
                      </div>
                      <p className={styles.hint}>逐期预测、逐期揭晓。已观察到的 OOS 历史允许进入后续训练，三个区段用于汇总，不是三份始终封闭的测试集。</p>
                    </>
                  )}
                  <details className={styles.disclosure} open>
                    <summary>{selected.status === "disqualified" ? "Validator 违规检查" : "Validator 检查与评分分量"}</summary>
                    {selected.flags.length > 0 ? <ul className={styles.plainList}>{selected.flags.map((flag, index) => <li key={index}>{flag}</li>)}</ul> : <p>本轮未触发已实现的违规检查。时间戳自报信息不能证明外部训练数据没有泄露。</p>}
                    <pre className={styles.code}>{JSON.stringify(selected.status === "disqualified" ? { status: selected.status, leakageRisk: selected.leakageRisk, score: selected.score, rewardWeight: selected.rewardWeight } : { status: selected.status, components: selected.components, leakageRisk: selected.leakageRisk, activeDecisions: selected.metrics.activeDecisions }, null, 2)}</pre>
                  </details>
                </>
              )}
            </section>

            <section className={styles.panel}>
              <h2>评分如何计算</h2>
              <div className={styles.formula}>
                分数 = 100 × ({pct(policy.weights.excessReturn, 0)} × 超额收益分 + {pct(policy.weights.riskAdjusted, 0)} × Sharpe 分 + {pct(policy.weights.drawdown, 0)} × 回撤分 + {pct(policy.weights.consistency, 0)} × 稳定分) × (1 − 泄露风险)
              </div>
              <ul className={styles.plainList}>
                <li>超额收益分：正超额收益 ÷ {pct(policy.excessReturnTarget, 0)}，限制在 0–1。</li>
                <li>Sharpe 分：正 Sharpe ÷ {policy.sharpeTarget}，限制在 0–1。</li>
                <li>回撤分：1 − 最大回撤 ÷ {pct(policy.drawdownLimit, 0)}，限制在 0–1。</li>
                <li>稳定分：净收益为正的 OOS 折占比。</li>
                <li>分配门槛：净收益与 Sharpe 均为正，至少 {policy.minActiveDecisions} 期非零仓位；违规样本归零。</li>
                <li>缺少来源说明：泄露风险至少 {pct(policy.missingProvenanceRisk, 0)}；未来特征或越界训练标签直接取消资格。</li>
                <li>本地权重 = 本 Miner 分数 ÷ 合格 Miner 分数之和；总分为 0 时所有权重均为 0。</li>
              </ul>
              <p className={styles.hint}>这些权重是原型的可讨论设计，不是活动官方评审权重，也不是 OpenRoboto 或 Bittensor 的通用评分规则。</p>
              <details className={styles.disclosure}>
                <summary>可复现记录与适用边界</summary>
                <pre className={styles.code}>{JSON.stringify({ version: tournament.version, dataFingerprint: tournament.dataFingerprint, seed: tournament.seed, split: tournament.split, costs: tournament.costs, policy: tournament.policy }, null, 2)}</pre>
                <ul className={styles.plainList}>{tournament.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
              </details>
            </section>
          </div>

          <section className={styles.panel}>
            <div className={styles.sectionTitle}><h2>Coordinator → Miner → Validator</h2><span>A2A 消息与真实 MCP 工具调用</span></div>
            <div className={styles.trace}>{result.messages.map((message) => (
              <div className={styles.step} key={message.step}>
                <span className={styles.stepNumber}>{message.step}</span>
                <div><strong>{message.from} → {message.to} · {message.intent}</strong><p>{message.detail}</p></div>
              </div>
            ))}</div>
            <details className={styles.disclosure}>
              <summary>展开 {result.mcpCalls.length} 次 MCP 调用</summary>
              <p>任务与预测调用用于展示接口，完整排行榜由 Validator 在同一冻结配置下运行独立轮次计算。</p>
              {result.mcpCalls.map((call, index) => (
                <details className={styles.disclosure} key={`${call.tool}-${index}`}>
                  <summary>{index + 1}. {call.agent} · {call.tool}</summary>
                  <pre className={styles.code}>{JSON.stringify({ args: call.args, result: call.result }, null, 2)}</pre>
                </details>
              ))}
            </details>
          </section>
        </>
      )}

      <footer className={styles.footer}>
        合成市场数据用于检验机制与代码。反复选择表现最好的种子会产生选择偏差；演示结果不代表真实投资能力。<br />
        <a href="https://luma.com/hackquest-e3ip" target="_blank" rel="noreferrer">活动公开说明</a> · <a href="https://github.com/jack5190/MCP_A2A_DEMO" target="_blank" rel="noreferrer">AutoA2A 仓库</a>
      </footer>
    </main>
  );
}
