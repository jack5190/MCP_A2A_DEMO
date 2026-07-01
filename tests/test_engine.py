"""Tests for the execution engine, MCP tools, credits and A2A fan-out."""

from __future__ import annotations

import pytest

from autoa2a.engine import ExecutionEngine
from autoa2a.mcp_tools import ToolRegistry
from autoa2a.models import (
    Action,
    ActionType,
    Agent,
    Chain,
    CostTier,
    ExecutionStatus,
    Trigger,
    TriggerType,
)
from autoa2a.store import Store
from autoa2a.vault import InsufficientCredits, InsufficientFunds


@pytest.fixture()
def store() -> Store:
    s = Store()
    s.vault.deposit("demo-user", "USDC", 1_000.0)
    s.vault.add_credits("demo-user", 100)
    return s


def test_tool_swap_moves_balances(store: Store) -> None:
    reg = ToolRegistry(store)
    store.prices.set("ETH", 2000.0)
    result = reg.call(
        "swap",
        owner="demo-user",
        chain="ETH",
        token_in="USDC",
        token_out="ETH",
        amount_in=1000.0,
    )
    # 1000 USDC / 2000 = 0.5 ETH minus 0.30% fee.
    assert result["amount_out"] == pytest.approx(0.5 * 0.997, rel=1e-6)
    assert store.vault.balance("demo-user", "USDC") == pytest.approx(0.0)
    assert store.vault.balance("demo-user", "ETH") == pytest.approx(0.4985)


def test_swap_overdraft_raises(store: Store) -> None:
    reg = ToolRegistry(store)
    with pytest.raises(InsufficientFunds):
        reg.call(
            "swap",
            owner="demo-user",
            chain="ETH",
            token_in="USDC",
            token_out="ETH",
            amount_in=5000.0,
        )


def test_schedule_agent_executes_and_charges_credits(store: Store) -> None:
    engine = ExecutionEngine(store)
    agent = Agent(
        name="dca",
        cost_tier=CostTier.MEDIUM,
        trigger=Trigger(type=TriggerType.SCHEDULE, config={"every_seconds": 1}),
        actions=[
            Action(
                type=ActionType.SWAP,
                params={"token_in": "USDC", "token_out": "ETH", "amount_in": 100.0},
            )
        ],
    )
    store.add_agent(agent)
    exe = engine.run_agent(agent, force=True)
    assert exe.status == ExecutionStatus.SUCCESS
    assert exe.credits_spent == 5
    assert store.vault.account("demo-user").credits == 95


def test_price_trigger_gating(store: Store) -> None:
    engine = ExecutionEngine(store)
    store.prices.set("ETH", 4000.0)
    agent = Agent(
        name="dip",
        trigger=Trigger(
            type=TriggerType.PRICE, config={"symbol": "ETH", "op": "lt", "value": 3100}
        ),
        actions=[],
    )
    store.add_agent(agent)
    # 4000 !< 3100 -> skipped.
    assert engine.run_agent(agent).status == ExecutionStatus.SKIPPED
    # Drop the price -> executes.
    store.prices.set("ETH", 3000.0)
    assert engine.run_agent(agent).status == ExecutionStatus.SUCCESS


def test_insufficient_credits(store: Store) -> None:
    engine = ExecutionEngine(store)
    store.vault._accounts["demo-user"].credits = 0
    agent = Agent(
        name="poor",
        cost_tier=CostTier.HIGH,
        trigger=Trigger(type=TriggerType.SCHEDULE),
        actions=[],
    )
    store.add_agent(agent)
    exe = engine.run_agent(agent, force=True)
    assert exe.status == ExecutionStatus.INSUFFICIENT_CREDITS


def test_webhook_sentiment(store: Store) -> None:
    engine = ExecutionEngine(store)
    agent = Agent(
        name="kol",
        trigger=Trigger(type=TriggerType.WEBHOOK),
        actions=[
            Action(
                type=ActionType.SWAP,
                params={"token_in": "USDC", "token_out": "PEPE", "amount_in": 50.0},
            )
        ],
    )
    store.add_agent(agent)
    bullish = engine.handle_webhook(agent.id, {"text": "ape in, breakout, moon"})
    assert bullish.status == ExecutionStatus.SUCCESS
    bearish = engine.handle_webhook(agent.id, {"text": "rug, dump, avoid this scam"})
    assert bearish.status == ExecutionStatus.SKIPPED


def test_a2a_fan_out_to_copy_trader(store: Store) -> None:
    store.vault.deposit("copy-trader", "USDC", 1_000.0)
    store.vault.add_credits("copy-trader", 100)
    engine = ExecutionEngine(store)

    publisher = Agent(
        name="dip-buyer",
        owner="demo-user",
        publish_signal="eth_dip_buy",
        trigger=Trigger(
            type=TriggerType.PRICE, config={"symbol": "ETH", "op": "lt", "value": 9e9}
        ),
        actions=[
            Action(
                type=ActionType.SWAP,
                params={"token_in": "USDC", "token_out": "ETH", "amount_in": 100.0},
            )
        ],
    )
    follower = Agent(
        name="copycat",
        owner="copy-trader",
        trigger=Trigger(
            type=TriggerType.SIGNAL, config={"signal_type": "eth_dip_buy"}
        ),
        actions=[
            Action(
                type=ActionType.SWAP,
                params={"token_in": "USDC", "token_out": "ETH", "amount_in": 50.0},
            )
        ],
    )
    store.add_agent(publisher)
    store.add_agent(follower)

    engine.run_agent(publisher)

    # Publisher broadcast a signal...
    assert any(s.type == "eth_dip_buy" for s in store.list_signals())
    # ...and the follower executed off the back of it.
    assert store.vault.balance("copy-trader", "ETH") > 0
    follower_execs = [
        e
        for e in store.list_executions()
        if e.agent_name == "copycat" and e.status == ExecutionStatus.SUCCESS
    ]
    assert follower_execs
