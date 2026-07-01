"""In-memory application state: agents, executions, A2A signals, prices, vault.

A single :class:`Store` instance is shared by the execution engine, the MCP
tool layer and the HTTP API. It is intentionally simple (dicts + a lock) so the
demo has zero external infrastructure dependencies.
"""

from __future__ import annotations

import random
from threading import RLock
from typing import Optional

from .models import Agent, Execution, Signal
from .vault import CustodyVault


class PriceFeed:
    """A deterministic-ish simulated market feed (geometric random walk)."""

    def __init__(self, seed: int = 7) -> None:
        self._rng = random.Random(seed)
        self._prices: dict[str, float] = {
            "ETH": 3200.0,
            "BSC": 590.0,
            "BTC": 64000.0,
            "PEPE": 0.0000102,
            "SOL": 145.0,
        }
        self._lock = RLock()

    def price(self, symbol: str) -> float:
        with self._lock:
            return self._prices.get(symbol.upper(), 0.0)

    def all(self) -> dict[str, float]:
        with self._lock:
            return dict(self._prices)

    def set(self, symbol: str, value: float) -> None:
        with self._lock:
            self._prices[symbol.upper()] = value

    def tick(self) -> dict[str, float]:
        """Advance every price by a small random step."""
        with self._lock:
            for sym, px in self._prices.items():
                drift = self._rng.uniform(-0.015, 0.015)
                self._prices[sym] = max(px * (1 + drift), 1e-12)
            return dict(self._prices)


class Store:
    def __init__(self) -> None:
        self._lock = RLock()
        self.agents: dict[str, Agent] = {}
        self.executions: list[Execution] = []
        self.signals: list[Signal] = []
        self.vault = CustodyVault()
        self.prices = PriceFeed()

    # -- agents -------------------------------------------------------------

    def add_agent(self, agent: Agent) -> Agent:
        with self._lock:
            self.agents[agent.id] = agent
            return agent

    def get_agent(self, agent_id: str) -> Optional[Agent]:
        with self._lock:
            return self.agents.get(agent_id)

    def list_agents(self) -> list[Agent]:
        with self._lock:
            return list(self.agents.values())

    def remove_agent(self, agent_id: str) -> bool:
        with self._lock:
            return self.agents.pop(agent_id, None) is not None

    # -- executions ---------------------------------------------------------

    def record_execution(self, execution: Execution) -> Execution:
        with self._lock:
            self.executions.append(execution)
            # keep the log bounded for the demo
            if len(self.executions) > 500:
                self.executions = self.executions[-500:]
            return execution

    def list_executions(self, limit: int = 100) -> list[Execution]:
        with self._lock:
            return list(reversed(self.executions[-limit:]))

    # -- A2A signals --------------------------------------------------------

    def record_signal(self, signal: Signal) -> Signal:
        with self._lock:
            self.signals.append(signal)
            if len(self.signals) > 500:
                self.signals = self.signals[-500:]
            return signal

    def list_signals(self, limit: int = 100) -> list[Signal]:
        with self._lock:
            return list(reversed(self.signals[-limit:]))
