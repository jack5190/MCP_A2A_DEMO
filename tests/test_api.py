"""Smoke tests for the HTTP API (scheduler disabled for determinism)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from autoa2a.api import create_app


@pytest.fixture()
def client() -> TestClient:
    app = create_app(seed_data=True, run_scheduler=False)
    with TestClient(app) as c:
        yield c


def test_index_served(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    assert "0xAuto" in r.text


def test_seeded_agents_and_tools(client: TestClient) -> None:
    agents = client.get("/api/agents").json()
    assert len(agents) >= 4
    tools = client.get("/api/tools").json()
    names = {t["name"] for t in tools}
    assert {"swap", "stake", "mint", "bridge", "get_price"} <= names


def test_create_run_and_delete_agent(client: TestClient) -> None:
    body = {
        "name": "test-dca",
        "owner": "demo-user",
        "chain": "ETH",
        "cost_tier": "low",
        "trigger": {"type": "schedule", "config": {"every_seconds": 5}},
        "actions": [
            {
                "type": "swap",
                "params": {"token_in": "USDC", "token_out": "ETH", "amount_in": 10.0},
            }
        ],
    }
    created = client.post("/api/agents", json=body)
    assert created.status_code == 201
    agent_id = created.json()["id"]

    run = client.post(f"/api/agents/{agent_id}/run")
    assert run.status_code == 200
    assert run.json()["status"] == "success"

    assert client.delete(f"/api/agents/{agent_id}").status_code == 204
    assert client.post(f"/api/agents/{agent_id}/run").status_code == 404


def test_webhook_endpoint(client: TestClient) -> None:
    agents = client.get("/api/agents").json()
    webhook_agent = next(a for a in agents if a["trigger"]["type"] == "webhook")
    r = client.post(
        f"/api/webhook/{webhook_agent['id']}", json={"text": "moon, breakout, buy"}
    )
    assert r.status_code == 200
    assert r.json()["status"] == "success"
