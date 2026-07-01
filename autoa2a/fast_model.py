"""Fast-model analysis layer.

The README describes a "Fast Model Analysis" stage that inspects an incoming
event and decides whether the agent should actually execute. In production this
is an LLM / ML pipeline (KOL NLP, K-line pattern recognition, sentiment). Here
it is a fast, deterministic heuristic so the demo is reproducible and offline.

Every trigger type resolves to a :class:`Decision`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from .models import Agent, Signal, TriggerType
from .store import Store

_BULLISH = {
    "buy", "long", "moon", "bullish", "breakout", "pump", "accumulate",
    "send", "ape", "gem", "up", "rally", "surge",
}
_BEARISH = {
    "sell", "short", "dump", "bearish", "rug", "down", "crash", "exit",
    "avoid", "scam", "correction",
}


@dataclass
class Decision:
    should_execute: bool
    confidence: float
    reason: str


def _score_text(text: str) -> tuple[float, list[str]]:
    """Return a sentiment score in [-1, 1] plus the matched keywords."""
    tokens = [t.strip(".,!?#@").lower() for t in text.split()]
    hits: list[str] = []
    score = 0
    for tok in tokens:
        if tok in _BULLISH:
            score += 1
            hits.append(f"+{tok}")
        elif tok in _BEARISH:
            score -= 1
            hits.append(f"-{tok}")
    total = len(hits) or 1
    return score / total, hits


class FastModel:
    """Decides whether an agent should fire for a given event."""

    def __init__(self, store: Store) -> None:
        self.store = store

    def evaluate(
        self,
        agent: Agent,
        *,
        webhook: Optional[dict[str, Any]] = None,
        signal: Optional[Signal] = None,
    ) -> Decision:
        ttype = agent.trigger.type
        if ttype == TriggerType.SCHEDULE:
            return self._eval_schedule(agent)
        if ttype == TriggerType.PRICE:
            return self._eval_price(agent)
        if ttype == TriggerType.WEBHOOK:
            return self._eval_webhook(agent, webhook or {})
        if ttype == TriggerType.SIGNAL:
            return self._eval_signal(agent, signal)
        return Decision(False, 0.0, f"unknown trigger type: {ttype}")

    # -- per-trigger logic --------------------------------------------------

    def _eval_schedule(self, agent: Agent) -> Decision:
        return Decision(True, 1.0, "scheduled cadence elapsed")

    def _eval_price(self, agent: Agent) -> Decision:
        cfg = agent.trigger.config
        symbol = str(cfg.get("symbol", "ETH"))
        op = str(cfg.get("op", "lt"))
        target = float(cfg.get("value", 0))
        price = self.store.prices.price(symbol)
        ops = {
            "lt": price < target,
            "lte": price <= target,
            "gt": price > target,
            "gte": price >= target,
        }
        met = ops.get(op, False)
        # Confidence scales with how far past the threshold we are.
        distance = abs(price - target) / target if target else 0.0
        confidence = min(1.0, 0.5 + distance * 5) if met else 0.0
        reason = f"{symbol} {price:.6g} {op} {target:g} -> {'MET' if met else 'not met'}"
        return Decision(met, round(confidence, 3), reason)

    def _eval_webhook(self, agent: Agent, webhook: dict[str, Any]) -> Decision:
        text = str(webhook.get("text", ""))
        if not text:
            # No text => treat as an explicit fire (e.g. TradingView pings URL).
            return Decision(True, 0.6, "webhook received (no text payload)")
        score, hits = _score_text(text)
        met = score > 0
        reason = f"webhook sentiment {score:+.2f} [{', '.join(hits) or 'neutral'}]"
        return Decision(met, round(abs(score), 3), reason)

    def _eval_signal(self, agent: Agent, signal: Optional[Signal]) -> Decision:
        if signal is None:
            return Decision(False, 0.0, "no signal supplied")
        cfg = agent.trigger.config
        want_type = cfg.get("signal_type")
        want_symbol = cfg.get("symbol")
        if want_type and signal.type != want_type:
            return Decision(False, 0.0, f"signal type {signal.type} != {want_type}")
        if want_symbol and signal.symbol and signal.symbol != want_symbol:
            return Decision(
                False, 0.0, f"signal symbol {signal.symbol} != {want_symbol}"
            )
        conf = float(signal.payload.get("confidence", 0.75))
        return Decision(
            True,
            round(conf, 3),
            f"A2A signal '{signal.type}'"
            + (f" for {signal.symbol}" if signal.symbol else "")
            + f" from {signal.source_agent_name}",
        )
