"""FastAPI backend + static dashboard for the 0xAuto / AutoA2A demo."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse

from .engine import ExecutionEngine
from .models import AgentCreate, AgentUpdate, WebhookPayload
from .seed import seed
from .store import Store

_WEB_DIR = Path(__file__).parent / "web"


def create_app(*, seed_data: bool = True, run_scheduler: bool = True) -> FastAPI:
    store = Store()
    engine = ExecutionEngine(store)
    if seed_data:
        seed(store)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if run_scheduler:
            engine.start()
        try:
            yield
        finally:
            if run_scheduler:
                await engine.stop()

    app = FastAPI(
        title="0xAuto / AutoA2A",
        description="Automated crypto strategy execution engine (MCP + A2A) - demo",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.store = store
    app.state.engine = engine

    # -- dashboard ----------------------------------------------------------

    @app.get("/", response_class=HTMLResponse)
    def index() -> str:
        return (_WEB_DIR / "index.html").read_text(encoding="utf-8")

    # -- agents -------------------------------------------------------------

    @app.get("/api/agents")
    def list_agents() -> list[dict[str, Any]]:
        return [a.model_dump(mode="json") for a in store.list_agents()]

    @app.post("/api/agents", status_code=201)
    def create_agent(body: AgentCreate) -> dict[str, Any]:
        agent = store.add_agent(body.to_agent())
        return agent.model_dump(mode="json")

    @app.patch("/api/agents/{agent_id}")
    def update_agent(agent_id: str, body: AgentUpdate) -> dict[str, Any]:
        agent = store.get_agent(agent_id)
        if agent is None:
            raise HTTPException(404, "agent not found")
        if body.enabled is not None:
            agent.enabled = body.enabled
        if body.name is not None:
            agent.name = body.name
        if body.cost_tier is not None:
            agent.cost_tier = body.cost_tier
        return agent.model_dump(mode="json")

    @app.delete("/api/agents/{agent_id}", status_code=204)
    def delete_agent(agent_id: str) -> None:
        if not store.remove_agent(agent_id):
            raise HTTPException(404, "agent not found")

    @app.post("/api/agents/{agent_id}/run")
    def run_agent(agent_id: str) -> dict[str, Any]:
        agent = store.get_agent(agent_id)
        if agent is None:
            raise HTTPException(404, "agent not found")
        execution = engine.run_agent(agent, force=True)
        return execution.model_dump(mode="json")

    # -- webhooks (TradingView / KOL / external signals) --------------------

    @app.post("/api/webhook/{agent_id}")
    def webhook(agent_id: str, payload: WebhookPayload) -> dict[str, Any]:
        try:
            execution = engine.handle_webhook(agent_id, payload.model_dump())
        except KeyError:
            raise HTTPException(404, "agent not found")
        return execution.model_dump(mode="json")

    # -- runtime state ------------------------------------------------------

    @app.get("/api/executions")
    def executions(limit: int = 100) -> list[dict[str, Any]]:
        return [e.model_dump(mode="json") for e in store.list_executions(limit)]

    @app.get("/api/signals")
    def signals(limit: int = 100) -> list[dict[str, Any]]:
        return [s.model_dump(mode="json") for s in store.list_signals(limit)]

    @app.get("/api/prices")
    def prices() -> dict[str, float]:
        return store.prices.all()

    @app.get("/api/vault")
    def vault() -> list[dict[str, Any]]:
        return store.vault.accounts()

    @app.get("/api/tools")
    def tools() -> list[dict[str, Any]]:
        return [
            {"name": t.name, "description": t.description, "schema": t.schema}
            for t in engine.tools.list_tools()
        ]

    @app.post("/api/seed")
    def reseed() -> dict[str, str]:
        seed(store)
        return {"status": "seeded"}

    return app


app = create_app()
