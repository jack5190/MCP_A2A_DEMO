"""A2A (agent-to-agent) signal routing.

The README's competitive edge includes event-driven triggers and a
copy-trading marketplace. Both are variations of the same primitive: one agent
publishes a :class:`~autoa2a.models.Signal`, and other agents that *subscribe*
to that signal type/symbol react to it.

This module is the small routing layer that matches published signals to the
subscriber agents that should run because of them.
"""

from __future__ import annotations

from .models import Agent, Signal, TriggerType
from .store import Store


class A2ABus:
    def __init__(self, store: Store) -> None:
        self.store = store

    def publish(self, signal: Signal) -> Signal:
        """Record a signal so it becomes visible to subscribers and the UI."""
        return self.store.record_signal(signal)

    def subscribers(self, signal: Signal) -> list[Agent]:
        """Return enabled SIGNAL-triggered agents that match ``signal``."""
        matches: list[Agent] = []
        for agent in self.store.list_agents():
            if not agent.enabled:
                continue
            if agent.trigger.type != TriggerType.SIGNAL:
                continue
            cfg = agent.trigger.config
            want_type = cfg.get("signal_type")
            want_symbol = cfg.get("symbol")
            if want_type and signal.type != want_type:
                continue
            if want_symbol and signal.symbol and signal.symbol != want_symbol:
                continue
            # Never let an agent react to its own broadcast.
            if agent.id == signal.source_agent_id:
                continue
            matches.append(agent)
        return matches
