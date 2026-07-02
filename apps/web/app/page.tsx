"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentConfig, ExecutionResult } from "@/lib/types";

interface MarketsResponse {
  markets: { symbol: string; name: string; price: number; stakingApy: number }[];
  portfolio: { balances: Record<string, number>; totalValueUsd: number; staked: any[] };
}

const SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "USDC"];

export default function Home() {
  const [name, setName] = useState("ETH Dip Buyer");
  const [triggerType, setTriggerType] = useState<"schedule" | "price">("price");
  const [priceSymbol, setPriceSymbol] = useState("ETH");
  const [direction, setDirection] = useState<"above" | "below">("below");
  const [threshold, setThreshold] = useState(4000);

  const [actionType, setActionType] = useState<"swap" | "stake">("swap");
  const [fromSymbol, setFromSymbol] = useState("USDC");
  const [toSymbol, setToSymbol] = useState("ETH");
  const [swapAmount, setSwapAmount] = useState(1000);
  const [stakeSymbol, setStakeSymbol] = useState("ETH");
  const [stakeAmount, setStakeAmount] = useState(1);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [history, setHistory] = useState<ExecutionResult[]>([]);
  const [markets, setMarkets] = useState<MarketsResponse | null>(null);

  const refreshMarkets = useCallback(async () => {
    const res = await fetch("/api/markets", { cache: "no-store" });
    if (res.ok) setMarkets(await res.json());
  }, []);

  const refreshHistory = useCallback(async () => {
    const res = await fetch("/api/history", { cache: "no-store" });
    if (res.ok) setHistory((await res.json()).executions);
  }, []);

  useEffect(() => {
    refreshMarkets();
    refreshHistory();
  }, [refreshMarkets, refreshHistory]);

  const buildConfig = (): AgentConfig => {
    const trigger =
      triggerType === "schedule"
        ? { type: "schedule" as const, intervalLabel: "every run" }
        : { type: "price" as const, symbol: priceSymbol, direction, threshold: Number(threshold) };
    const action =
      actionType === "swap"
        ? { type: "swap" as const, fromSymbol, toSymbol, amount: Number(swapAmount) }
        : { type: "stake" as const, symbol: stakeSymbol, amount: Number(stakeAmount) };
    return { name, trigger, action };
  };

  const runAgent = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildConfig()),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Execution failed");
      } else {
        setResult(data);
        await Promise.all([refreshMarkets(), refreshHistory()]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="container">
      <header className="hero">
        <div className="brand">
          <span className="pill">MCP + A2A · live demo</span>
          <h1>AutoA2A</h1>
          <div className="tag">
            Automate your strategy, powered by the Model Context Protocol. Configure an agent, and a Coordinator
            delegates to specialised PriceWatcher and Trader agents that call DeFi tools over MCP.
          </div>
        </div>
        <div className="card" style={{ minWidth: 220 }}>
          <div className="muted">Portfolio value</div>
          <div className="stat">${markets?.portfolio.totalValueUsd?.toLocaleString() ?? "…"}</div>
          <div className="markets section-gap">
            {markets?.markets
              .filter((m) => m.symbol !== "USDC")
              .map((m) => (
                <span className="chip" key={m.symbol}>
                  {m.symbol} <b>${m.price.toLocaleString()}</b>
                </span>
              ))}
          </div>
        </div>
      </header>

      <div className="grid">
        {/* Agent builder */}
        <div className="card">
          <h2>Agent builder</h2>
          <label>Agent name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />

          <label>Trigger</label>
          <div className="seg">
            <button className={triggerType === "price" ? "active" : ""} onClick={() => setTriggerType("price")}>
              Price threshold
            </button>
            <button className={triggerType === "schedule" ? "active" : ""} onClick={() => setTriggerType("schedule")}>
              Schedule
            </button>
          </div>

          {triggerType === "price" && (
            <>
              <div className="row">
                <div>
                  <label>Symbol</label>
                  <select value={priceSymbol} onChange={(e) => setPriceSymbol(e.target.value)}>
                    {SYMBOLS.filter((s) => s !== "USDC").map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Direction</label>
                  <select value={direction} onChange={(e) => setDirection(e.target.value as "above" | "below")}>
                    <option value="below">below</option>
                    <option value="above">above</option>
                  </select>
                </div>
              </div>
              <label>Threshold (USDC)</label>
              <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </>
          )}

          <label>Action</label>
          <div className="seg">
            <button className={actionType === "swap" ? "active" : ""} onClick={() => setActionType("swap")}>
              Swap
            </button>
            <button className={actionType === "stake" ? "active" : ""} onClick={() => setActionType("stake")}>
              Stake
            </button>
          </div>

          {actionType === "swap" ? (
            <>
              <div className="row">
                <div>
                  <label>From</label>
                  <select value={fromSymbol} onChange={(e) => setFromSymbol(e.target.value)}>
                    {SYMBOLS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>To</label>
                  <select value={toSymbol} onChange={(e) => setToSymbol(e.target.value)}>
                    {SYMBOLS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label>Amount ({fromSymbol})</label>
              <input type="number" value={swapAmount} onChange={(e) => setSwapAmount(Number(e.target.value))} />
            </>
          ) : (
            <>
              <div className="row">
                <div>
                  <label>Symbol</label>
                  <select value={stakeSymbol} onChange={(e) => setStakeSymbol(e.target.value)}>
                    {SYMBOLS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Amount</label>
                  <input type="number" value={stakeAmount} onChange={(e) => setStakeAmount(Number(e.target.value))} />
                </div>
              </div>
            </>
          )}

          <button className="run" onClick={runAgent} disabled={running}>
            {running ? "Running agent…" : "▶ Run agent"}
          </button>
          {error && <div className="error">Error: {error}</div>}
        </div>

        {/* Execution trace */}
        <div>
          <div className="card">
            <h2>Execution trace {result && <span className="muted">· {result.agentName}</span>}</h2>
            {!result && <div className="muted">Run an agent to see the A2A message flow and MCP tool calls.</div>}
            {result && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <span className={`badge ${result.triggered ? "ok" : "no"}`}>
                    {result.triggered ? "TRIGGERED" : "NOT TRIGGERED"}
                  </span>{" "}
                  <span className="muted">{result.summary}</span>
                </div>
                {result.messages.map((m) => (
                  <div className="trace-msg" key={`${m.step}-${m.from}`}>
                    <div className="who">
                      {m.from} <span className="arrow">→</span> {m.to} <span className="muted">· {m.intent}</span>
                    </div>
                    <div className="detail">{m.detail}</div>
                    {m.mcpCalls.map((call, i) => (
                      <div className="mcp" key={i}>
                        <b>MCP</b> {call.agent} called {call.tool}({JSON.stringify(call.args)}) →{" "}
                        {JSON.stringify(call.result)}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="card section-gap">
            <h2>Execution history</h2>
            {history.length === 0 && <div className="muted">No runs yet.</div>}
            {history.map((h) => (
              <div className="hist-item" key={h.id}>
                <div className="top">
                  <b>{h.agentName}</b>
                  <span className={`badge ${h.triggered ? "ok" : "no"}`}>{h.triggered ? "executed" : "skipped"}</span>
                </div>
                <div className="muted">{h.summary}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {new Date(h.startedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
