"""`POST /dlq/replay` is service-only.

The route is reachable from the browser through the console's
`/api/v1/fusion/*` rewrite. Operators replay through the API door
(`POST /api/v1/health/dead-letters/replay`), which checks the permission and
writes the audit row before calling here with the service token.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from app.api import router as router_mod
from app.api.router import router
from app.security.tenant_scope import TenantPrincipal, require_console_or_service_auth
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

_TENANT = UUID("11111111-1111-1111-1111-111111111111")
_BODY = {"topic": "aisoc.raw_events.dlq", "partition": 0, "start_offset": 0}


def _client(principal: TenantPrincipal) -> AsyncClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_console_or_service_auth] = lambda: principal
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://fusion")


@pytest.mark.asyncio
async def test_a_console_principal_is_refused_before_the_broker_is_touched(monkeypatch):
    async def _must_not_run(**_kwargs):
        raise AssertionError("replay_from_offset ran for a console principal")

    monkeypatch.setattr(router_mod, "replay_from_offset", _must_not_run)
    console = TenantPrincipal(tenant_ids=frozenset({_TENANT}), subject="analyst", role="admin")
    async with _client(console) as client:
        resp = await client.post("/dlq/replay", json=_BODY)

    assert resp.status_code == 403
    assert "service-only" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_a_service_principal_reaches_the_replay(monkeypatch):
    calls: list[dict] = []

    async def _fake_replay(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(as_dict=lambda: {"executed": False, "read": 0})

    monkeypatch.setattr(router_mod, "replay_from_offset", _fake_replay)
    service = TenantPrincipal(tenant_ids=frozenset({_TENANT}), subject="service", delegated=True)
    async with _client(service) as client:
        resp = await client.post("/dlq/replay", json=_BODY)

    assert resp.status_code == 200, resp.text
    assert calls and calls[0]["execute"] is False


@pytest.mark.asyncio
async def test_a_broker_fault_does_not_leak_its_text(monkeypatch):
    async def _boom(**_kwargs):
        raise ConnectionError("kafka:29092 refused, internal detail")

    monkeypatch.setattr(router_mod, "replay_from_offset", _boom)
    service = TenantPrincipal(tenant_ids=frozenset({_TENANT}), subject="service", delegated=True)
    async with _client(service) as client:
        resp = await client.post("/dlq/replay", json=_BODY)

    assert resp.status_code == 502
    assert "kafka:29092" not in resp.json()["detail"]
