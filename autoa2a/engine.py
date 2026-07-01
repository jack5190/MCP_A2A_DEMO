"""Execution engine + scheduler.

This is the runtime that turns agent configuration into (simulated) on-chain
action:

    trigger fires -> fast-model analysis -> charge credits ->
    call MCP DeFi tools -> record execution -> (optionally) publish A2A signal
                                            -> fan out to subscriber agents

The engine is transport-agnostic about *how* a trigger fires: the scheduler
loop drives SCHEDULE + PRICE agents, HTTP webhooks drive WEBHOOK agents, and
published signals drive SIGNAL agents via the :class:`~autoa2a.a2a.A2ABus`.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from .a2a import A2ABus
from .fast_model import Decision, FastModel
from .mcp_tools import ToolRegistry
from .models import (
    Action,
    ActionResult,
    ActionType,
    Agent,
    Execution,
    ExecutionStatus,
    Signal,
    TriggerType,
)
from .store import Store
from .vault import InsufficientCredits, InsufficientFunds


class ExecutionEngine:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.tools = ToolRegistry(store)
        self.fast_model = FastModel(store)
        self.bus = A2ABus(store)
        self._schedule_last: dict[str, float] = {}
        # Edge-trigger state for PRICE agents: True means "armed" (ready to fire
        # again). We only fire on the rising edge of the condition and re-arm
        # once it clears, so a persistently-true threshold doesn't re-fire every
        # tick and drain the vault.
        self._price_armed: dict[str, bool] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self.tick_seconds = 2.0

    # -- action dispatch ----------------------------------------------------

    def _run_action(self, agent: Agent, action: Action) -> ActionResult:
        try:
            params = dict(action.params)
            params.setdefault("owner", agent.owner)
            if action.type in (ActionType.SWAP, ActionType.STAKE, ActionType.MINT):
                params.setdefault("chain", agent.chain.value)

            if action.type == ActionType.SWAP:
                detail = self.tools.call("swap", **params)
            elif action.type == ActionType.STAKE:
                detail = self.tools.call("stake", **params)
            elif action.type == ActionType.MINT:
                detail = self.tools.call("mint", **params)
            elif action.type == ActionType.BRIDGE:
                params.setdefault("from_chain", agent.chain.value)
                detail = self.tools.call("bridge", **params)
            else:
                return ActionResult(
                    type=action.type, ok=False, error=f"unsupported action {action.type}"
                )
            return ActionResult(type=action.type, ok=True, detail=detail)
        except (InsufficientFunds, KeyError, TypeError, ValueError) as exc:
            return ActionResult(type=action.type, ok=False, error=str(exc))

    # -- single evaluation --------------------------------------------------

    def run_agent(
        self,
        agent: Agent,
        *,
        webhook: Optional[dict[str, Any]] = None,
        signal: Optional[Signal] = None,
        force: bool = False,
    ) -> Execution:
        """Evaluate one agent and, if it should fire, execute its actions.

        Returns the recorded :class:`Execution`. Also fans out any A2A signal
        this agent publishes to its subscribers.
        """
        agent.last_run_at = time.time()

        if force:
            decision = Decision(True, 1.0, "manual trigger")
        else:
            decision = self.fast_model.evaluate(agent, webhook=webhook, signal=signal)

        if not decision.should_execute:
            return self.store.record_execution(
                Execution(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    status=ExecutionStatus.SKIPPED,
                    trigger_reason=decision.reason,
                    confidence=decision.confidence,
                )
            )

        # Credit-based execution tiers.
        cost = agent.cost()
        try:
            self.store.vault.charge_credits(agent.owner, cost)
        except InsufficientCredits as exc:
            return self.store.record_execution(
                Execution(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    status=ExecutionStatus.INSUFFICIENT_CREDITS,
                    trigger_reason=f"{decision.reason} | {exc}",
                    confidence=decision.confidence,
                )
            )

        results = [self._run_action(agent, a) for a in agent.actions]
        ok = all(r.ok for r in results) if results else True
        status = ExecutionStatus.SUCCESS if ok else ExecutionStatus.FAILED

        execution = self.store.record_execution(
            Execution(
                agent_id=agent.id,
                agent_name=agent.name,
                status=status,
                trigger_reason=decision.reason,
                confidence=decision.confidence,
                credits_spent=cost,
                results=results,
            )
        )

        if status == ExecutionStatus.SUCCESS and agent.publish_signal:
            self._publish_and_fan_out(agent, decision)

        return execution

    def _publish_and_fan_out(self, agent: Agent, decision: Decision) -> None:
        symbol = None
        if agent.trigger.type == TriggerType.PRICE:
            symbol = agent.trigger.config.get("symbol")
        elif agent.actions:
            symbol = agent.actions[0].params.get("token_out") or agent.actions[
                0
            ].params.get("token")

        signal = Signal(
            source_agent_id=agent.id,
            source_agent_name=agent.name,
            type=agent.publish_signal or "generic",
            symbol=symbol,
            payload={"confidence": decision.confidence, "reason": decision.reason},
        )
        self.bus.publish(signal)
        for subscriber in self.bus.subscribers(signal):
            # Copy-trading / event fan-out: run the subscriber with this signal.
            self.run_agent(subscriber, signal=signal)

    # -- webhook entrypoint -------------------------------------------------

    def handle_webhook(self, agent_id: str, payload: dict[str, Any]) -> Execution:
        agent = self.store.get_agent(agent_id)
        if agent is None:
            raise KeyError(f"unknown agent: {agent_id}")
        return self.run_agent(agent, webhook=payload)

    # -- scheduler loop -----------------------------------------------------

    def _due_scheduled(self, agent: Agent, now: float) -> bool:
        every = float(agent.trigger.config.get("every_seconds", 60))
        last = self._schedule_last.get(agent.id, 0.0)
        if now - last >= every:
            self._schedule_last[agent.id] = now
            return True
        return False

    def tick(self) -> list[Execution]:
        """Advance the market and evaluate all time/market-driven agents."""
        self.store.prices.tick()
        now = time.time()
        executed: list[Execution] = []
        for agent in self.store.list_agents():
            if not agent.enabled:
                continue
            if agent.trigger.type == TriggerType.SCHEDULE:
                if self._due_scheduled(agent, now):
                    executed.append(self.run_agent(agent))
            elif agent.trigger.type == TriggerType.PRICE:
                decision = self.fast_model.evaluate(agent)
                armed = self._price_armed.get(agent.id, True)
                if decision.should_execute:
                    # Rising edge only: fire once, then wait for the condition
                    # to clear before it can fire again.
                    if armed:
                        self._price_armed[agent.id] = False
                        executed.append(self.run_agent(agent))
                else:
                    self._price_armed[agent.id] = True
        return executed

    async def _loop(self) -> None:
        while self._running:
            try:
                self.tick()
            except Exception:  # keep the demo alive on any per-tick error
                pass
            await asyncio.sleep(self.tick_seconds)

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
