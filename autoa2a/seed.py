"""Demo seed data.

Populates a :class:`~autoa2a.store.Store` with funded accounts and a handful of
agents that showcase every trigger type plus A2A copy-trading, so the dashboard
has something interesting to show immediately.
"""

from __future__ import annotations

from .models import (
    Action,
    ActionType,
    Agent,
    Chain,
    CostTier,
    Trigger,
    TriggerType,
)
from .store import Store


def seed(store: Store) -> None:
    # Fund two demo users' custody vaults + credits (generous runway so the
    # demo can run for a long time without depleting balances).
    for owner in ("demo-user", "copy-trader"):
        store.vault.deposit(owner, "USDC", 100_000.0)
        store.vault.deposit(owner, "ETH", 20.0)
        store.vault.add_credits(owner, 5_000)

    agents = [
        # 1) Time-based DCA into ETH every ~10s.
        Agent(
            name="DCA into ETH (hourly)",
            owner="demo-user",
            chain=Chain.ETH,
            cost_tier=CostTier.MEDIUM,
            trigger=Trigger(type=TriggerType.SCHEDULE, config={"every_seconds": 10}),
            actions=[
                Action(
                    type=ActionType.SWAP,
                    params={"token_in": "USDC", "token_out": "ETH", "amount_in": 200.0},
                )
            ],
        ),
        # 2) Price trigger: buy the dip if ETH < 3100, and broadcast a signal.
        Agent(
            name="Buy the dip (ETH < 3100)",
            owner="demo-user",
            chain=Chain.ETH,
            cost_tier=CostTier.MEDIUM,
            publish_signal="eth_dip_buy",
            trigger=Trigger(
                type=TriggerType.PRICE,
                config={"symbol": "ETH", "op": "lt", "value": 3100},
            ),
            actions=[
                Action(
                    type=ActionType.SWAP,
                    params={"token_in": "USDC", "token_out": "ETH", "amount_in": 500.0},
                ),
                Action(
                    type=ActionType.STAKE,
                    params={"token": "ETH", "amount": 0.1},
                ),
            ],
        ),
        # 3) A2A copy-trader: mirrors the dip-buyer's signal.
        Agent(
            name="Copy-trader: follow ETH dip buys",
            owner="copy-trader",
            chain=Chain.ETH,
            cost_tier=CostTier.LOW,
            trigger=Trigger(
                type=TriggerType.SIGNAL, config={"signal_type": "eth_dip_buy"}
            ),
            actions=[
                Action(
                    type=ActionType.SWAP,
                    params={"token_in": "USDC", "token_out": "ETH", "amount_in": 250.0},
                )
            ],
        ),
        # 4) Webhook (TradingView / KOL) sentiment-gated PEPE buy.
        Agent(
            name="KOL/TradingView webhook -> PEPE",
            owner="demo-user",
            chain=Chain.BSC,
            cost_tier=CostTier.HIGH,
            trigger=Trigger(type=TriggerType.WEBHOOK),
            actions=[
                Action(
                    type=ActionType.SWAP,
                    params={"token_in": "USDC", "token_out": "PEPE", "amount_in": 100.0},
                )
            ],
        ),
    ]
    for agent in agents:
        store.add_agent(agent)
