"""The shared extractor must survive prose on both sides of the JSON.

It trimmed everything before the first ``{`` and nothing after the last ``}``,
so a model that answered correctly and then added a closing pleasantry was
scored unparseable. Small local models do this constantly.

The module also advertised itself as the replacement for the agents' ad-hoc
parsers while nothing in production imported it. These tests pin both halves:
the extraction behaviour, and that auto-triage actually calls it.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest
from app.llm.structured_output import extract_json_block, parse_json_object, parse_structured, sanitize_log_sample

AGENT_SOURCE = Path(__file__).resolve().parent.parent / "app" / "agents" / "auto_triage_agent.py"


@pytest.mark.parametrize(
    ("reply", "expected"),
    [
        ('{"a": 1}', {"a": 1}),
        ('{"a": 1}\n\nHope that helps!', {"a": 1}),
        ('Sure! Here is the verdict:\n{"a": 1}\nLet me know.', {"a": 1}),
        ('```json\n{"a": 1}\n```', {"a": 1}),
        ('```json\n{"a": 1}\n```\nAnything else?', {"a": 1}),
        ('[{"a": 1}]\ntrailing', [{"a": 1}]),
        # A brace inside a string is not the end of the object.
        ('{"note": "he typed }"}\nbye', {"note": "he typed }"}),
        # An escaped quote must not end the string scan early.
        ('{"note": "say \\"hi\\" }"}\nbye', {"note": 'say "hi" }'}),
        # Nesting.
        ('{"o": {"i": [1, 2]}}\nthanks', {"o": {"i": [1, 2]}}),
    ],
)
def test_extracts_the_body_whatever_surrounds_it(reply: str, expected: object) -> None:
    assert json.loads(extract_json_block(reply)) == expected
    assert parse_structured(reply).ok


def test_an_unclosed_object_is_left_for_the_parser_to_report() -> None:
    """Truncation must surface as a parse failure, not a silent trim.

    Returning the remainder means json reports where it ran out; trimming to
    the last balanced point would invent an object the model never closed.
    """
    result = parse_structured('{"a": 1, "b": "unterminated')
    assert not result.ok
    assert "invalid JSON" in result.error


def test_prose_with_no_json_at_all_still_fails() -> None:
    assert not parse_structured("I think this alert is fine, honestly").ok


def test_auto_triage_uses_the_shared_extractor() -> None:
    """The wiring, read from source.

    The module documented itself as the single parser while having no
    production caller. This fails if auto-triage goes back to its own
    fence-stripping.
    """
    tree = ast.parse(AGENT_SOURCE.read_text())
    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == "app.llm.structured_output"
        for alias in node.names
    }
    assert "extract_json_block" in imported, "auto-triage no longer shares the extractor"


def test_parse_json_object_fenced() -> None:
    reply = "```json\n{\"iocs\": [\"10.0.0.1\"], \"mitre\": \"T1078\"}\n```"
    assert parse_json_object(reply) == {"iocs": ["10.0.0.1"], "mitre": "T1078"}


def test_parse_json_object_prefixed() -> None:
    reply = "Here is the structured analysis:\n{\"iocs\": [\"10.0.0.1\"], \"summary\": \"Suspicious IP\"}\nPlease review."
    assert parse_json_object(reply) == {"iocs": ["10.0.0.1"], "summary": "Suspicious IP"}


def test_parse_json_object_think_tags() -> None:
    reply = "<think>Evaluating {nested: false} indicators and confidence.</think>{\"threat_actors\": [\"APT29\"], \"confidence\": 0.9}"
    assert parse_json_object(reply) == {"threat_actors": ["APT29"], "confidence": 0.9}


def test_parse_json_object_think_tags_with_fences_and_prefix() -> None:
    reply = (
        "<think>\nNeed to extract IOCs: {ip: '10.0.0.1'}\n</think>\n"
        "Here is the result:\n```json\n{\"status\": \"confirmed\", \"count\": 1}\n```\nDone."
    )
    assert parse_json_object(reply) == {"status": "confirmed", "count": 1}


def test_sanitize_log_sample_truncates_and_redacts() -> None:
    secret_text = "Error reply api_key='sk-1234567890123456' with more padding " + "x" * 350
    sampled = sanitize_log_sample(secret_text, 300)
    assert len(sampled) <= 300
    assert "sk-1234567890123456" not in sampled
    assert "[REDACTED:SECRET]" in sampled


@pytest.mark.asyncio
async def test_recon_agent_retries_on_parse_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """ReconAgent retries once with a valid JSON nudge before falling back."""
    from types import SimpleNamespace
    from app.investigator.recon_agent import _llm_recon
    from app.investigator.state import InvestigatorState

    calls: list[list[Any]] = []

    class _MockLLM:
        async def ainvoke(self, messages, **kwargs):
            calls.append(list(messages))
            if len(calls) == 1:
                # First attempt: invalid JSON with think tag and unclosed brace
                return SimpleNamespace(content="<think>thinking</think>not json at all {broken")
            # Retry attempt: valid JSON
            return SimpleNamespace(content="```json\n{\"iocs\": [], \"mitre_techniques\": [\"T1059\"]}\n```")

    monkeypatch.setattr("app.investigator.recon_agent.make_chat_model", lambda *a, **k: _MockLLM())
    # Bypass prompt registry if needed, or state
    state = InvestigatorState(case_id="C-1", tenant_id="t", alert_summary="Suspicious PowerShell")
    res = await _llm_recon(state)
    assert res.get("mitre_techniques") == ["T1059"]
    assert len(calls) == 2
    # Verify the nudge message was sent in second call
    nudge_msg = calls[1][-1]
    assert nudge_msg.content == "Reply with valid JSON only."


@pytest.mark.asyncio
async def test_forensic_agent_retries_on_parse_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """ForensicAgent retries once with a valid JSON nudge before falling back."""
    from types import SimpleNamespace
    from app.investigator.forensic_agent import _llm_forensic
    from app.investigator.state import InvestigatorState

    calls: list[list[Any]] = []

    class _MockLLM:
        async def ainvoke(self, messages, **kwargs):
            calls.append(list(messages))
            if len(calls) == 1:
                return SimpleNamespace(content="<think>analysis</think>invalid {broken")
            return SimpleNamespace(content="```json\n{\"root_cause_hypothesis\": \"Compromised credentials\", \"confidence\": 0.85}\n```")

    monkeypatch.setattr("app.investigator.forensic_agent.make_chat_model", lambda *a, **k: _MockLLM())
    state = InvestigatorState(case_id="C-1", tenant_id="t", alert_summary="Suspicious PowerShell")
    res = await _llm_forensic(state)
    assert res.get("root_cause_hypothesis") == "Compromised credentials"
    assert len(calls) == 2
    assert calls[1][-1].content == "Reply with valid JSON only."


@pytest.mark.asyncio
async def test_responder_agent_retries_on_parse_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """ResponderAgent retries once with a valid JSON nudge before falling back."""
    from types import SimpleNamespace
    from app.investigator.responder_agent import _llm_responder
    from app.investigator.state import InvestigatorState

    calls: list[list[Any]] = []

    class _MockLLM:
        async def ainvoke(self, messages, **kwargs):
            calls.append(list(messages))
            if len(calls) == 1:
                return SimpleNamespace(content="<think>planning</think>not json {bad")
            return SimpleNamespace(content="```json\n{\"risk_level\": \"high\", \"containment_steps\": [\"Isolate host\"]}\n```")

    monkeypatch.setattr("app.investigator.responder_agent.make_chat_model", lambda *a, **k: _MockLLM())
    state = InvestigatorState(case_id="C-1", tenant_id="t", alert_summary="Suspicious PowerShell")
    res = await _llm_responder(state)
    assert res.get("risk_level") == "high"
    assert len(calls) == 2
    assert calls[1][-1].content == "Reply with valid JSON only."
