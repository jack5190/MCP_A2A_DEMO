"""Domain models for the 0xAuto / AutoA2A execution engine.

These pydantic models describe the *strategy* side of the system: agents,
their triggers, and the on-chain actions they perform. Runtime artefacts
(executions, A2A signals) are modelled here too so the API can serialise them
directly.
"""

from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _now() -> float:
    return time.time()


class Chain(str, Enum):
    """Supported chains for the MVP (ETH + BSC per the README)."""

    ETH = "ETH"
    BSC = "BSC"


class ActionType(str, Enum):
    """MCP-native DeFi actions the execution engine can perform."""

    SWAP = "swap"
    STAKE = "stake"
    MINT = "mint"
    BRIDGE = "bridge"


class TriggerType(str, Enum):
    """How an agent decides *when* to run.

    - SCHEDULE: fixed cadence (every N seconds).
    - PRICE: market-data trigger evaluated by the fast model.
    - WEBHOOK: external signal (e.g. TradingView alert) via HTTP.
    - SIGNAL: A2A trigger - reacts to signals published by another agent.
    """

    SCHEDULE = "schedule"
    PRICE = "price"
    WEBHOOK = "webhook"
    SIGNAL = "signal"


class CostTier(str, Enum):
    """Credit-based execution tiers (README billing model)."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


#: Credits deducted from the user's balance per successful execution.
TIER_COST: dict[CostTier, int] = {
    CostTier.LOW: 1,
    CostTier.MEDIUM: 5,
    CostTier.HIGH: 20,
}


class Action(BaseModel):
    """A single MCP tool call the agent will attempt when it fires."""

    type: ActionType
    params: dict[str, Any] = Field(default_factory=dict)


class Trigger(BaseModel):
    """Trigger configuration.

    The meaning of ``config`` depends on ``type``:

    - SCHEDULE: ``{"every_seconds": 60}``
    - PRICE:    ``{"symbol": "ETH", "op": "lt"|"gt"|"lte"|"gte", "value": 3000}``
    - WEBHOOK:  ``{}`` (matched by agent id / provided key)
    - SIGNAL:   ``{"signal_type": "kol_bullish", "symbol": "PEPE"}``
    """

    type: TriggerType
    config: dict[str, Any] = Field(default_factory=dict)


class Agent(BaseModel):
    """A configured automation agent."""

    id: str = Field(default_factory=lambda: _new_id("agent"))
    name: str
    owner: str = "demo-user"
    chain: Chain = Chain.ETH
    trigger: Trigger
    actions: list[Action] = Field(default_factory=list)
    cost_tier: CostTier = CostTier.LOW
    enabled: bool = True

    # A2A: if set, a signal of this type is published after a successful run so
    # other agents (or copy-traders) can react to it.
    publish_signal: Optional[str] = None

    created_at: float = Field(default_factory=_now)
    last_run_at: Optional[float] = None

    def cost(self) -> int:
        return TIER_COST[self.cost_tier]


class ActionResult(BaseModel):
    """Result of executing a single action via an MCP tool."""

    type: ActionType
    ok: bool
    detail: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


class ExecutionStatus(str, Enum):
    SUCCESS = "success"
    SKIPPED = "skipped"
    FAILED = "failed"
    INSUFFICIENT_CREDITS = "insufficient_credits"


class Execution(BaseModel):
    """An immutable record of one agent evaluation."""

    id: str = Field(default_factory=lambda: _new_id("exec"))
    agent_id: str
    agent_name: str
    timestamp: float = Field(default_factory=_now)
    status: ExecutionStatus
    trigger_reason: str
    confidence: float = 0.0
    credits_spent: int = 0
    results: list[ActionResult] = Field(default_factory=list)


class Signal(BaseModel):
    """An A2A message: one agent broadcasting a decision to others."""

    id: str = Field(default_factory=lambda: _new_id("sig"))
    source_agent_id: str
    source_agent_name: str
    type: str
    symbol: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: float = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# API request bodies
# ---------------------------------------------------------------------------


class AgentCreate(BaseModel):
    name: str
    owner: str = "demo-user"
    chain: Chain = Chain.ETH
    trigger: Trigger
    actions: list[Action] = Field(default_factory=list)
    cost_tier: CostTier = CostTier.LOW
    enabled: bool = True
    publish_signal: Optional[str] = None

    def to_agent(self) -> Agent:
        return Agent(**self.model_dump())


class AgentUpdate(BaseModel):
    enabled: Optional[bool] = None
    name: Optional[str] = None
    cost_tier: Optional[CostTier] = None


class WebhookPayload(BaseModel):
    """Payload for an inbound webhook (e.g. TradingView)."""

    symbol: Optional[str] = None
    text: Optional[str] = None
    data: dict[str, Any] = Field(default_factory=dict)
