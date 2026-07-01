"""MCP-native DeFi tool layer.

This module defines the DeFi "tools" the execution engine can call. Each tool
operates against a :class:`~autoa2a.store.Store` (its custody vault + price
feed). The exact same implementations are exposed:

* in-process, via :class:`ToolRegistry`, for the execution engine, and
* over the Model Context Protocol, via :mod:`autoa2a.mcp_server`.

That is what "MCP-native DeFi actions" means in the README: swap / stake /
mint / bridge are real MCP tools, not bespoke code paths.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .store import Store

# A rough conversion table (USD-ish) so swaps produce sensible output amounts.
_USD_PRICE_FALLBACK: dict[str, float] = {
    "USDC": 1.0,
    "USDT": 1.0,
    "DAI": 1.0,
}


def _usd_price(store: Store, symbol: str) -> float:
    symbol = symbol.upper()
    if symbol in _USD_PRICE_FALLBACK:
        return _USD_PRICE_FALLBACK[symbol]
    px = store.prices.price(symbol)
    return px if px > 0 else 1.0


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


def tool_get_price(store: Store, symbol: str) -> dict[str, Any]:
    """Return the current market price for ``symbol``."""
    return {"symbol": symbol.upper(), "price": store.prices.price(symbol)}


def tool_get_balance(store: Store, owner: str, token: str) -> dict[str, Any]:
    """Return the custody-vault balance of ``token`` for ``owner``."""
    return {
        "owner": owner,
        "token": token.upper(),
        "balance": store.vault.balance(owner, token.upper()),
    }


def tool_swap(
    store: Store,
    owner: str,
    chain: str,
    token_in: str,
    token_out: str,
    amount_in: float,
) -> dict[str, Any]:
    """Swap ``amount_in`` of ``token_in`` into ``token_out`` at market rate."""
    token_in = token_in.upper()
    token_out = token_out.upper()
    price_in = _usd_price(store, token_in)
    price_out = _usd_price(store, token_out)
    fee_bps = 30  # 0.30% simulated pool fee
    gross_out = (amount_in * price_in) / price_out
    amount_out = gross_out * (1 - fee_bps / 10_000)

    store.vault.move(owner, token_in, -amount_in)
    store.vault.move(owner, token_out, amount_out)
    return {
        "chain": chain,
        "token_in": token_in,
        "token_out": token_out,
        "amount_in": amount_in,
        "amount_out": round(amount_out, 8),
        "fee_bps": fee_bps,
    }


def tool_stake(
    store: Store, owner: str, chain: str, token: str, amount: float
) -> dict[str, Any]:
    """Stake ``amount`` of ``token`` from the vault balance."""
    token = token.upper()
    store.vault.stake(owner, token, amount)
    return {
        "chain": chain,
        "token": token,
        "amount": amount,
        "staked_total": store.vault.account(owner).staked.get(token, 0.0),
    }


def tool_mint(
    store: Store, owner: str, chain: str, collection: str, count: int = 1
) -> dict[str, Any]:
    """Mint ``count`` NFTs from ``collection``."""
    store.vault.mint(owner, collection, count)
    return {
        "chain": chain,
        "collection": collection,
        "minted": count,
        "owned_total": store.vault.account(owner).nfts.get(collection, 0),
    }


def tool_bridge(
    store: Store,
    owner: str,
    token: str,
    amount: float,
    from_chain: str,
    to_chain: str,
) -> dict[str, Any]:
    """Bridge ``amount`` of ``token`` between chains (balance stays; metadata only)."""
    token = token.upper()
    # Ensure funds exist, then re-credit on the destination (single ledger here).
    store.vault.move(owner, token, -amount)
    store.vault.move(owner, token, amount)
    return {
        "token": token,
        "amount": amount,
        "from_chain": from_chain,
        "to_chain": to_chain,
    }


# ---------------------------------------------------------------------------
# Registry (in-process transport)
# ---------------------------------------------------------------------------


@dataclass
class Tool:
    name: str
    description: str
    schema: dict[str, Any]
    fn: Callable[..., dict[str, Any]]


class ToolRegistry:
    """Registry that binds tool functions to a :class:`Store` instance."""

    def __init__(self, store: Store) -> None:
        self.store = store
        self._tools: dict[str, Tool] = {}
        self._register_defaults()

    def _register_defaults(self) -> None:
        self.register(
            "get_price",
            "Get the current market price for a token symbol.",
            {"symbol": "str"},
            tool_get_price,
        )
        self.register(
            "get_balance",
            "Get an owner's custody-vault balance for a token.",
            {"owner": "str", "token": "str"},
            tool_get_balance,
        )
        self.register(
            "swap",
            "Swap one token for another at the current market rate.",
            {
                "owner": "str",
                "chain": "str",
                "token_in": "str",
                "token_out": "str",
                "amount_in": "float",
            },
            tool_swap,
        )
        self.register(
            "stake",
            "Stake a token amount from the custody vault.",
            {"owner": "str", "chain": "str", "token": "str", "amount": "float"},
            tool_stake,
        )
        self.register(
            "mint",
            "Mint NFTs from a collection.",
            {"owner": "str", "chain": "str", "collection": "str", "count": "int"},
            tool_mint,
        )
        self.register(
            "bridge",
            "Bridge a token amount between two chains.",
            {
                "owner": "str",
                "token": "str",
                "amount": "float",
                "from_chain": "str",
                "to_chain": "str",
            },
            tool_bridge,
        )

    def register(
        self,
        name: str,
        description: str,
        schema: dict[str, Any],
        fn: Callable[..., dict[str, Any]],
    ) -> None:
        self._tools[name] = Tool(name, description, schema, fn)

    def list_tools(self) -> list[Tool]:
        return list(self._tools.values())

    def call(self, name: str, **kwargs: Any) -> dict[str, Any]:
        tool = self._tools.get(name)
        if tool is None:
            raise KeyError(f"unknown tool: {name}")
        return tool.fn(self.store, **kwargs)
