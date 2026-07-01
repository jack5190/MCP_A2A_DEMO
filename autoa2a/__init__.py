"""0xAuto / AutoA2A - automated crypto strategy execution engine (demo).

A 7x24 automated execution layer that sits between strategy definition and
on-chain action:

    Trigger (time / market / social / on-chain)
        -> Fast-model analysis
        -> Execution engine
        -> MCP + DeFi protocols
        -> Custody smart-contract vault

This package is a runnable demo of that architecture. All on-chain effects are
simulated against an in-memory custody vault so the whole thing runs locally
with no keys, funds, or live RPC endpoints.
"""

from .models import (
    Action,
    ActionType,
    Agent,
    Chain,
    CostTier,
    Execution,
    Signal,
    Trigger,
    TriggerType,
)

__version__ = "0.1.0"

__all__ = [
    "Action",
    "ActionType",
    "Agent",
    "Chain",
    "CostTier",
    "Execution",
    "Signal",
    "Trigger",
    "TriggerType",
    "__version__",
]
