"""keycloak_sync: unconfigured is reported, group push only touches managed groups, pull is scoped."""

from __future__ import annotations

import httpx
import pytest

from app.services import keycloak_sync

pytestmark = pytest.mark.asyncio

GROUPS = [
    {"id": "g-admin", "name": "soc-admins", "subGroups": []},
    {"id": "g-an", "name": "soc-analysts", "subGroups": [{"id": "g-sub", "name": "tier2", "subGroups": []}]},
    {"id": "g-x", "name": "other", "subGroups": []},
]
FLAT = [{"id": "g-admin", "name": "soc-admins"}, {"id": "g-an", "name": "soc-analysts"}, {"id": "g-x", "name": "other"}, {"id": "g-sub", "name": "tier2"}]


@pytest.fixture(autouse=True)
def _clear_token_cache():
    keycloak_sync._token_cache.clear()
    yield
    keycloak_sync._token_cache.clear()


def _install(monkeypatch, calls, member=None, users=None):
    state = {"member": set(member if member is not None else {"soc-analysts", "other"})}
    users = users if users is not None else {"u1": {"id": "u1", "enabled": True, "email": "a@x.io", "firstName": "A"}}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        calls.append((req.method, path))
        if path.endswith("/protocol/openid-connect/token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 300})
        if path.endswith("/groups") and "/users/" not in path:
            return httpx.Response(200, json=GROUPS)
        if "/users/" in path and path.endswith("/groups"):
            return httpx.Response(200, json=[g for g in FLAT if g["name"] in state["member"]])
        if "/users/" in path and "/groups/" in path:
            name = next(g["name"] for g in FLAT if g["id"] == path.rsplit("/", 1)[1])
            (state["member"].add if req.method == "PUT" else state["member"].discard)(name)
            return httpx.Response(204)
        if "/users/" in path and req.method == "GET":
            uid = path.rsplit("/", 1)[1]
            return httpx.Response(200, json=users[uid]) if uid in users else httpx.Response(404)
        return httpx.Response(204)

    real = httpx.AsyncClient
    monkeypatch.setattr(keycloak_sync.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def _creds(monkeypatch):
    monkeypatch.delenv("KEYCLOAK_SYNC_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_SYNC_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("KEYCLOAK_ADMIN_USER", "a")
    monkeypatch.setenv("KEYCLOAK_ADMIN_PASSWORD", "b")


async def test_unconfigured(monkeypatch):
    for k in ("KEYCLOAK_ADMIN_USER", "KEYCLOAK_ADMIN_PASSWORD", "KEYCLOAK_SYNC_CLIENT_ID", "KEYCLOAK_SYNC_CLIENT_SECRET"):
        monkeypatch.delenv(k, raising=False)
    assert (await keycloak_sync.push_user("u1", enabled=False)).status == "unconfigured"


async def test_push_swaps_only_managed_groups(monkeypatch):
    _creds(monkeypatch)
    calls: list[tuple[str, str]] = []
    _install(monkeypatch, calls)
    res = await keycloak_sync.push_user(
        "u1", enabled=True, groups_to_have={"soc-admins"}, managed_groups={"soc-admins", "soc-analysts"}
    )
    assert res.status == "synced"
    assert res.groups == ["other", "soc-admins"]  # analysts removed, unmanaged "other" untouched
    assert ("POST", "/admin/realms/clopssoc/users/u1/logout") in calls


async def test_push_reaches_subgroups_and_keeps_user_fields(monkeypatch):
    _creds(monkeypatch)
    calls: list[tuple[str, str]] = []
    _install(monkeypatch, calls, member=set())
    res = await keycloak_sync.push_user("u1", enabled=False, groups_to_have={"tier2"}, managed_groups={"tier2"})
    assert res.groups == ["tier2"]  # nested group found and joined
    assert ("PUT", "/admin/realms/clopssoc/users/u1") in calls

async def test_pull_is_scoped_and_reports_enabled(monkeypatch):
    _creds(monkeypatch)
    calls: list[tuple[str, str]] = []
    _install(monkeypatch, calls, users={"u1": {"id": "u1", "enabled": False}, "other-tenant": {"id": "other-tenant"}})
    res, out = await keycloak_sync.pull_realm({"u1", "missing"})
    assert res.status == "synced"
    assert out == {"u1": (False, ["other", "soc-analysts"])}  # `missing` omitted, other tenant never read
    assert not any("other-tenant" in p for _, p in calls)


async def test_service_account_preferred_and_token_cached(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_SYNC_CLIENT_ID", "clopssoc-sync")
    monkeypatch.setenv("KEYCLOAK_SYNC_CLIENT_SECRET", "s")
    calls: list[tuple[str, str]] = []
    _install(monkeypatch, calls)
    await keycloak_sync.check_health()
    await keycloak_sync.check_health()
    tokens = [p for _, p in calls if p.endswith("/openid-connect/token")]
    assert tokens == ["/realms/clopssoc/protocol/openid-connect/token"]  # client_credentials in-realm, fetched once


async def test_failure_is_reported_not_raised(monkeypatch):
    _creds(monkeypatch)
    real = httpx.AsyncClient
    monkeypatch.setattr(
        keycloak_sync.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(lambda r: httpx.Response(500)), **kw)
    )
    assert (await keycloak_sync.check_health()).status == "failed"
