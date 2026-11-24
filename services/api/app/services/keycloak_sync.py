"""Keycloak admin client for the two-way user sync.

Credentials come from the environment only (`KEYCLOAK_ADMIN_USER`,
`KEYCLOAK_ADMIN_PASSWORD`) and are never logged or returned. The URL is the
internal Docker address, so the call never leaves the compose network.
Every public function returns a `SyncResult` rather than raising: a Keycloak
outage must not turn a local role edit into a 500, it is reported back to the
operator as `failed` / `unconfigured`.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(8.0, connect=3.0)


@dataclass
class SyncResult:
    status: str  # synced | failed | unconfigured | skipped
    detail: str = ""
    groups: list[str] = field(default_factory=list)


def _cfg() -> tuple[str, str, str, str] | None:
    user = os.getenv("KEYCLOAK_ADMIN_USER", "")
    password = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "")
    if not user or not password:
        return None
    base = os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080").rstrip("/")
    realm = os.getenv("KEYCLOAK_REALM", "clopssoc")
    return base, realm, user, password


def realm_name() -> str:
    return os.getenv("KEYCLOAK_REALM", "clopssoc")


def is_configured() -> bool:
    return _cfg() is not None


class _Admin:
    def __init__(self, client: httpx.AsyncClient, base: str, realm: str, token: str) -> None:
        self.c, self.base, self.realm = client, base, realm
        self.h = {"Authorization": f"Bearer {token}"}

    def _u(self, path: str) -> str:
        return f"{self.base}/admin/realms/{self.realm}{path}"

    async def get(self, path: str, **params: Any) -> Any:
        r = await self.c.get(self._u(path), headers=self.h, params=params or None)
        r.raise_for_status()
        return r.json()

    async def send(self, method: str, path: str, **kw: Any) -> None:
        r = await self.c.request(method, self._u(path), headers=self.h, **kw)
        r.raise_for_status()

    async def user_by_subject(self, subject: str) -> dict[str, Any] | None:
        r = await self.c.get(self._u(f"/users/{subject}"), headers=self.h)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    async def user_groups(self, subject: str) -> list[dict[str, Any]]:
        return await self.get(f"/users/{subject}/groups")


async def _login(client: httpx.AsyncClient) -> _Admin | None:
    cfg = _cfg()
    if cfg is None:
        return None
    base, realm, user, password = cfg
    r = await client.post(
        f"{base}/realms/master/protocol/openid-connect/token",
        data={"grant_type": "password", "client_id": "admin-cli", "username": user, "password": password},
    )
    r.raise_for_status()
    return _Admin(client, base, realm, r.json()["access_token"])


async def _run(fn):  # type: ignore[no-untyped-def]
    if not is_configured():
        return SyncResult("unconfigured", "KEYCLOAK_ADMIN_USER / KEYCLOAK_ADMIN_PASSWORD not set")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            admin = await _login(client)
            assert admin is not None
            return await fn(admin)
    except Exception as exc:  # noqa: BLE001 — reported, never raised; secrets are not in the message
        logger.warning("keycloak_sync.failed error=%s", type(exc).__name__)
        return SyncResult("failed", type(exc).__name__)


async def check_health() -> SyncResult:
    async def go(admin: _Admin) -> SyncResult:
        await admin.get("")  # realm representation
        return SyncResult("synced", "reachable")

    return await _run(go)


async def push_user(subject: str, *, enabled: bool | None = None, groups_to_have: set[str] | None = None,
                    managed_groups: set[str] | None = None, revoke_sessions: bool = True) -> SyncResult:
    """Push enabled flag and managed group membership for one Keycloak user.

    Only groups named in `managed_groups` (the keys of the connection's
    `group_role_mapping`) are added or removed; any other group is left alone.
    """

    async def go(admin: _Admin) -> SyncResult:
        if await admin.user_by_subject(subject) is None:
            return SyncResult("failed", "user not found in realm")
        if enabled is not None:
            await admin.send("PUT", f"/users/{subject}", json={"enabled": enabled})
        if groups_to_have is not None and managed_groups:
            all_groups = {g["name"]: g["id"] for g in await admin.get("/groups", max=500)}
            current = {g["name"] for g in await admin.user_groups(subject)}
            for name in managed_groups & groups_to_have - current:
                if name in all_groups:
                    await admin.send("PUT", f"/users/{subject}/groups/{all_groups[name]}")
            for name in (managed_groups & current) - groups_to_have:
                if name in all_groups:
                    await admin.send("DELETE", f"/users/{subject}/groups/{all_groups[name]}")
        if revoke_sessions:
            await admin.send("POST", f"/users/{subject}/logout")
        final = [g["name"] for g in await admin.user_groups(subject)]
        return SyncResult("synced", groups=sorted(final))

    return await _run(go)


async def pull_realm() -> tuple[SyncResult, dict[str, list[str]]]:
    """Return `{subject: [group names]}` for every user in the realm."""
    out: dict[str, list[str]] = {}

    async def go(admin: _Admin) -> SyncResult:
        first = 0
        while True:
            page = await admin.get("/users", first=first, max=200)
            if not page:
                break
            for u in page:
                out[u["id"]] = sorted(g["name"] for g in await admin.user_groups(u["id"]))
            if len(page) < 200:
                break
            first += 200
        return SyncResult("synced", f"{len(out)} users")

    return await _run(go), out
