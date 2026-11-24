"""keycloak_sync: unconfigured is reported, group push only touches managed groups."""

from __future__ import annotations

import httpx
import pytest

from app.services import keycloak_sync

pytestmark = pytest.mark.asyncio

GROUPS = [{"id": "g-admin", "name": "soc-admins"}, {"id": "g-an", "name": "soc-analysts"}, {"id": "g-x", "name": "other"}]


def _install(monkeypatch, calls):
    state = {"member": {"soc-analysts", "other"}}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        calls.append((req.method, path))
        if path.endswith("/protocol/openid-connect/token"):
            return httpx.Response(200, json={"access_token": "t"})
        if path.endswith("/groups") and "/users/" not in path:
            return httpx.Response(200, json=GROUPS)
        if path.endswith("/users/u1"):
            return httpx.Response(200, json={"id": "u1"})
        if path.endswith("/users/u1/groups"):
            return httpx.Response(200, json=[g for g in GROUPS if g["name"] in state["member"]])
        if "/users/u1/groups/" in path:
            name = next(g["name"] for g in GROUPS if g["id"] == path.rsplit("/", 1)[1])
            (state["member"].add if req.method == "PUT" else state["member"].discard)(name)
            return httpx.Response(204)
        return httpx.Response(204)

    real = httpx.AsyncClient
    monkeypatch.setattr(keycloak_sync.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


async def test_unconfigured(monkeypatch):
    monkeypatch.delenv("KEYCLOAK_ADMIN_USER", raising=False)
    monkeypatch.delenv("KEYCLOAK_ADMIN_PASSWORD", raising=False)
    assert (await keycloak_sync.push_user("u1", enabled=False)).status == "unconfigured"


async def test_push_swaps_only_managed_groups(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_ADMIN_USER", "a")
    monkeypatch.setenv("KEYCLOAK_ADMIN_PASSWORD", "b")
    calls: list[tuple[str, str]] = []
    _install(monkeypatch, calls)
    res = await keycloak_sync.push_user(
        "u1", enabled=True, groups_to_have={"soc-admins"}, managed_groups={"soc-admins", "soc-analysts"}
    )
    assert res.status == "synced"
    assert res.groups == ["other", "soc-admins"]  # analysts removed, unmanaged "other" untouched
    assert ("POST", "/admin/realms/clopssoc/users/u1/logout") in calls


async def test_failure_is_reported_not_raised(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_ADMIN_USER", "a")
    monkeypatch.setenv("KEYCLOAK_ADMIN_PASSWORD", "b")
    real = httpx.AsyncClient
    monkeypatch.setattr(
        keycloak_sync.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(lambda r: httpx.Response(500)), **kw)
    )
    assert (await keycloak_sync.check_health()).status == "failed"
