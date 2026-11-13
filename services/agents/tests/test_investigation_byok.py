"""Unit and regression tests for Investigation BYOK support."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch
import pytest

from app.api import investigate as investigate_mod
from app.investigator.orchestrator import InvestigatorOrchestrator
from app.llm.factory import _llm_override, make_chat_model
from app.security.llm_resolver import LlmConfig


@pytest.mark.asyncio
async def test_resolve_tenant_llm_override_with_tenant_credentials(monkeypatch):
    """Test that tenant BYOK fields are correctly extracted."""
    fake_config = LlmConfig(
        allowed=True,
        base_url="https://api.groq.com/openai/v1",
        model="groq/llama-3.3-70b-versatile",
        api_key="gsk-test-key",
        source="tenant",
        reason="",
        model_from_tenant=True,
        base_url_from_tenant=True,
        api_key_from_tenant=True,
    )
    monkeypatch.setattr(
        investigate_mod,
        "resolve_llm_config",
        AsyncMock(return_value=fake_config),
    )

    byok = await investigate_mod._resolve_tenant_llm_override("tenant-groq")
    assert byok == {
        "api_key": "gsk-test-key",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "groq/llama-3.3-70b-versatile",
    }


@pytest.mark.asyncio
async def test_resolve_tenant_llm_override_without_byok(monkeypatch):
    """Test backward compatibility: default/unconfigured tenant yields empty override."""
    fake_config = LlmConfig(
        allowed=True,
        base_url="http://litellm:4000/v1",
        model="aisoc-investigation",
        api_key="sk-aisoc-local",
        source="env",
        reason="",
        model_from_tenant=False,
        base_url_from_tenant=False,
        api_key_from_tenant=False,
    )
    monkeypatch.setattr(
        investigate_mod,
        "resolve_llm_config",
        AsyncMock(return_value=fake_config),
    )

    byok = await investigate_mod._resolve_tenant_llm_override("default")
    assert byok == {
        "api_key": None,
        "base_url": None,
        "model": None,
    }


@pytest.mark.asyncio
async def test_investigation_stream_propagates_byok_override(monkeypatch):
    """Test that _run_and_store sets llm_override during graph stream execution."""
    fake_config = LlmConfig(
        allowed=True,
        base_url="https://api.groq.com/openai/v1",
        model="groq/llama-3.3-70b-versatile",
        api_key="gsk-test-key",
        source="tenant",
        reason="",
        model_from_tenant=True,
        base_url_from_tenant=True,
        api_key_from_tenant=True,
    )
    monkeypatch.setattr(
        investigate_mod,
        "resolve_llm_config",
        AsyncMock(return_value=fake_config),
    )

    observed_override = {}

    async def fake_stream(**kwargs):
        nonlocal observed_override
        observed_override = dict(_llm_override.get() or {})
        yield {"type": "step", "summary": "step 1"}
        yield {"type": "done", "state": {"status": "completed"}}

    monkeypatch.setattr(investigate_mod, "_investigate_stream", fake_stream)
    monkeypatch.setattr(investigate_mod.ledger, "start_run", AsyncMock(return_value=None))
    monkeypatch.setattr(investigate_mod.ledger, "complete_run", AsyncMock(return_value=None))

    req = investigate_mod.InvestigateRequest(
        alert_summary="Test alert",
        raw_alert={},
        tenant_id="tenant-groq",
    )
    await investigate_mod._run_and_store("run-1", "case-1", req)

    assert observed_override == {
        "api_key": "gsk-test-key",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "groq/llama-3.3-70b-versatile",
    }


@pytest.mark.asyncio
async def test_concurrent_tenant_isolation():
    """Verify contextvar isolation between concurrent investigations."""
    from app.llm.factory import llm_override

    results = {}

    async def run_tenant(t_id: str, model_name: str | None):
        override = {"model": model_name} if model_name else {}
        with llm_override(**override):
            await asyncio.sleep(0.01)
            chat = make_chat_model("investigation")
            results[t_id] = chat.model_name

    await asyncio.gather(
        run_tenant("tenant-groq", "groq/llama-3.3-70b-versatile"),
        run_tenant("tenant-openai", "openai/gpt-4o"),
        run_tenant("tenant-default", None),
    )

    assert results["tenant-groq"] == "groq/llama-3.3-70b-versatile"
    assert results["tenant-openai"] == "openai/gpt-4o"
    assert results["tenant-default"] == "aisoc-investigation"
