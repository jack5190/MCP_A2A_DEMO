"""Model Context Protocol server exposing the DeFi tools.

This is the "MCP-native" half of the demo: the same swap / stake / mint /
bridge / price / balance implementations used by the in-process execution
engine are also published as real MCP tools over stdio, so any MCP client
(Claude Desktop, Cursor, an A2A agent, ...) can drive the custody vault.

Run it with::

    python -m autoa2a.mcp_server        # stdio transport
    autoa2a-mcp                          # console-script equivalent

The server keeps its own in-process :class:`~autoa2a.store.Store`. Point a
persistent store here if you want it to share state with the web app.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from . import mcp_tools
from .store import Store

_store = Store()
mcp = FastMCP("autoa2a-defi")


@mcp.tool()
def get_price(symbol: str) -> dict[str, Any]:
    """Get the current market price for a token symbol (e.g. ETH, PEPE)."""
    return mcp_tools.tool_get_price(_store, symbol)


@mcp.tool()
def get_balance(owner: str, token: str) -> dict[str, Any]:
    """Get an owner's custody-vault balance for a token."""
    return mcp_tools.tool_get_balance(_store, owner, token)


@mcp.tool()
def swap(
    owner: str, chain: str, token_in: str, token_out: str, amount_in: float
) -> dict[str, Any]:
    """Swap one token for another at the current market rate."""
    return mcp_tools.tool_swap(_store, owner, chain, token_in, token_out, amount_in)


@mcp.tool()
def stake(owner: str, chain: str, token: str, amount: float) -> dict[str, Any]:
    """Stake a token amount from the custody vault."""
    return mcp_tools.tool_stake(_store, owner, chain, token, amount)


@mcp.tool()
def mint(owner: str, chain: str, collection: str, count: int = 1) -> dict[str, Any]:
    """Mint NFTs from a collection."""
    return mcp_tools.tool_mint(_store, owner, chain, collection, count)


@mcp.tool()
def bridge(
    owner: str, token: str, amount: float, from_chain: str, to_chain: str
) -> dict[str, Any]:
    """Bridge a token amount between two chains."""
    return mcp_tools.tool_bridge(_store, owner, token, amount, from_chain, to_chain)


@mcp.tool()
def deposit(owner: str, token: str, amount: float) -> dict[str, Any]:
    """Deposit funds into an owner's custody vault (demo faucet)."""
    _store.vault.deposit(owner, token.upper(), amount)
    return mcp_tools.tool_get_balance(_store, owner, token)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
