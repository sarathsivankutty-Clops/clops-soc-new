"""Keycloak admin client for the two-way user sync.

Credentials come from the environment only and are never logged or returned.
Preferred: a realm service-account client (`KEYCLOAK_SYNC_CLIENT_ID` /
`KEYCLOAK_SYNC_CLIENT_SECRET`, `client_credentials`, `realm-management` roles
only). Fallback: the master-realm admin (`KEYCLOAK_ADMIN_USER` /
`KEYCLOAK_ADMIN_PASSWORD`, password grant). Access tokens are cached until
shortly before they expire. The URL is the
internal Docker address, so the call never leaves the compose network.
Every public function returns a `SyncResult` rather than raising: a Keycloak
outage must not turn a local role edit into a 500, it is reported back to the
operator as `failed` / `unconfigured`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(8.0, connect=3.0)
_PULL_CONCURRENCY = 8
_token_cache: dict[str, tuple[str, float]] = {}  # token url + client -> (token, expiry)


@dataclass
class SyncResult:
    status: str  # synced | failed | unconfigured | skipped
    detail: str = ""
    groups: list[str] = field(default_factory=list)


def _cfg() -> tuple[str, str, str, dict[str, str]] | None:
    """`(base, realm, token_url, form)`, or None when no credentials are set."""
    base = os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080").rstrip("/")
    realm = realm_name()
    cid, secret = os.getenv("KEYCLOAK_SYNC_CLIENT_ID", ""), os.getenv("KEYCLOAK_SYNC_CLIENT_SECRET", "")
    if cid and secret:
        form = {"grant_type": "client_credentials", "client_id": cid, "client_secret": secret}
        return base, realm, f"{base}/realms/{realm}/protocol/openid-connect/token", form
    user, password = os.getenv("KEYCLOAK_ADMIN_USER", ""), os.getenv("KEYCLOAK_ADMIN_PASSWORD", "")
    if user and password:
        form = {"grant_type": "password", "client_id": "admin-cli", "username": user, "password": password}
        return base, realm, f"{base}/realms/master/protocol/openid-connect/token", form
    return None


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

    async def group_ids(self) -> dict[str, str]:
        """Group name -> id across the whole tree (subgroups included)."""
        out: dict[str, str] = {}

        def walk(groups: list[dict[str, Any]]) -> None:
            for g in groups:
                out.setdefault(g["name"], g["id"])
                walk(g.get("subGroups") or [])

        walk(await self.get("/groups", max=500, briefRepresentation="false"))
        return out


async def _login(client: httpx.AsyncClient, cfg: tuple[str, str, str, dict[str, str]]) -> _Admin:
    base, realm, token_url, form = cfg
    key = f"{token_url}|{form.get('client_id')}|{form.get('username', '')}"
    token, expires = _token_cache.get(key, ("", 0.0))
    if not token or expires <= time.monotonic():
        r = await client.post(token_url, data=form)
        r.raise_for_status()
        body = r.json()
        token = body["access_token"]
        _token_cache[key] = (token, time.monotonic() + max(int(body.get("expires_in", 60)) - 30, 0))
    return _Admin(client, base, realm, token)


async def _run(fn):  # type: ignore[no-untyped-def]
    cfg = _cfg()
    if cfg is None:
        return SyncResult("unconfigured", "KEYCLOAK_ADMIN_USER / KEYCLOAK_ADMIN_PASSWORD not set")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            return await fn(await _login(client, cfg))
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
        rep = await admin.user_by_subject(subject)
        if rep is None:
            return SyncResult("failed", "user not found in realm")
        if enabled is not None:
            # Send the whole representation: a partial PUT can fail declarative UserProfile validation.
            await admin.send("PUT", f"/users/{subject}", json={**rep, "enabled": enabled})
        if groups_to_have is not None and managed_groups:
            all_groups = await admin.group_ids()
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


async def pull_realm(subjects: set[str]) -> tuple[SyncResult, dict[str, tuple[bool, list[str]]]]:
    """Return `{subject: (enabled, [group names])}` for the given Keycloak subjects.

    Only the caller's bound subjects are read (tenant-scoped, no realm-wide
    scan); subjects missing from the realm are omitted. Reads run concurrently.
    """
    out: dict[str, tuple[bool, list[str]]] = {}

    async def go(admin: _Admin) -> SyncResult:
        gate = asyncio.Semaphore(_PULL_CONCURRENCY)

        async def one(sub: str) -> None:
            async with gate:
                rep = await admin.user_by_subject(sub)
                if rep is not None:
                    out[sub] = (bool(rep.get("enabled", True)), sorted(g["name"] for g in await admin.user_groups(sub)))

        await asyncio.gather(*(one(s) for s in subjects))
        return SyncResult("synced", f"{len(out)} users")

    return await _run(go), out
