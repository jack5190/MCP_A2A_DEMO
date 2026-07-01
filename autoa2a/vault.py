"""Simulated per-user custody vault + credit ledger.

In the real product this is a smart contract that custodies user funds and
enforces allowance-based permissions (README: "Smart-contract custody instead
of raw key exposure"). Here it is a deterministic in-memory model so the demo
can run with no chain, keys, or funds.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import RLock
from typing import Any


class InsufficientFunds(Exception):
    """Raised when a vault action would overdraw a token balance."""


class InsufficientCredits(Exception):
    """Raised when a user cannot pay for an execution."""


@dataclass
class Account:
    """A single user's custody account."""

    owner: str
    # token symbol -> balance
    balances: dict[str, float] = field(default_factory=dict)
    # execution credits
    credits: int = 0
    # staked positions: token -> amount
    staked: dict[str, float] = field(default_factory=dict)
    # minted NFTs (collection -> count)
    nfts: dict[str, int] = field(default_factory=dict)

    def snapshot(self) -> dict[str, Any]:
        return {
            "owner": self.owner,
            "balances": dict(self.balances),
            "credits": self.credits,
            "staked": dict(self.staked),
            "nfts": dict(self.nfts),
        }


class CustodyVault:
    """Thread-safe registry of user accounts.

    All monetary mutations funnel through this class so that every on-chain
    effect is auditable and consistent, mirroring the "transparent fund flow"
    goal from the README.
    """

    def __init__(self) -> None:
        self._accounts: dict[str, Account] = {}
        self._lock = RLock()

    # -- account lifecycle --------------------------------------------------

    def account(self, owner: str) -> Account:
        with self._lock:
            acct = self._accounts.get(owner)
            if acct is None:
                acct = Account(owner=owner)
                self._accounts[owner] = acct
            return acct

    def accounts(self) -> list[dict[str, Any]]:
        with self._lock:
            return [a.snapshot() for a in self._accounts.values()]

    # -- deposits / credits -------------------------------------------------

    def deposit(self, owner: str, token: str, amount: float) -> None:
        if amount <= 0:
            raise ValueError("deposit amount must be positive")
        with self._lock:
            acct = self.account(owner)
            acct.balances[token] = acct.balances.get(token, 0.0) + amount

    def add_credits(self, owner: str, credits: int) -> None:
        with self._lock:
            self.account(owner).credits += int(credits)

    def charge_credits(self, owner: str, credits: int) -> None:
        with self._lock:
            acct = self.account(owner)
            if acct.credits < credits:
                raise InsufficientCredits(
                    f"{owner} has {acct.credits} credits, needs {credits}"
                )
            acct.credits -= credits

    def balance(self, owner: str, token: str) -> float:
        with self._lock:
            return self.account(owner).balances.get(token, 0.0)

    # -- DeFi primitives ----------------------------------------------------

    def move(self, owner: str, token: str, delta: float) -> float:
        """Apply a signed delta to a token balance, guarding overdrafts."""
        with self._lock:
            acct = self.account(owner)
            new_balance = acct.balances.get(token, 0.0) + delta
            if new_balance < -1e-9:
                raise InsufficientFunds(
                    f"{owner} cannot move {delta} {token}; "
                    f"balance is {acct.balances.get(token, 0.0)}"
                )
            acct.balances[token] = max(new_balance, 0.0)
            return acct.balances[token]

    def stake(self, owner: str, token: str, amount: float) -> None:
        with self._lock:
            self.move(owner, token, -amount)
            acct = self.account(owner)
            acct.staked[token] = acct.staked.get(token, 0.0) + amount

    def mint(self, owner: str, collection: str, count: int = 1) -> None:
        with self._lock:
            acct = self.account(owner)
            acct.nfts[collection] = acct.nfts.get(collection, 0) + count
