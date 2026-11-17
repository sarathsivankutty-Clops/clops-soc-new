"""Tests for `_parse_llm_json` ledger fallback reconstruction in cases.py."""

from __future__ import annotations

from app.services.llm_json import parse_llm_json_payload as _parse_llm_json


def test_parse_llm_json_plain_object() -> None:
    assert _parse_llm_json({"response": '{"iocs": [{"type": "ip", "value": "1.2.3.4"}]}'}) == {
        "iocs": [{"type": "ip", "value": "1.2.3.4"}]
    }


def test_parse_llm_json_strips_markdown_fences() -> None:
    raw = '```json\n{\n  "mitre_techniques": ["T1530"],\n  "summary": "S3 bucket policy changed"\n}\n```'
    assert _parse_llm_json({"response": raw}) == {
        "mitre_techniques": ["T1530"],
        "summary": "S3 bucket policy changed",
    }


def test_parse_llm_json_strips_think_block_and_prose_prefix() -> None:
    raw = (
        "<think>Reasoning about {braces} inside think tag.</think>\n"
        "Here is the structured output:\n"
        '```json\n{"risk_level": "medium", "recommended_actions": [{"priority": 1, "action": "Review policy"}]}\n```'
        "\nLet me know if you need more."
    )
    assert _parse_llm_json({"response": raw}) == {
        "risk_level": "medium",
        "recommended_actions": [{"priority": 1, "action": "Review policy"}],
    }


def test_parse_llm_json_prefixed_without_fences_with_braces_in_string() -> None:
    raw = 'Analysis complete: {"summary": "saw {foo} in log", "confidence": 0.4} trailing note'
    assert _parse_llm_json({"response": raw}) == {
        "summary": "saw {foo} in log",
        "confidence": 0.4,
    }


def test_parse_llm_json_handles_malformed_or_non_dict() -> None:
    assert _parse_llm_json({"response": "not json at all"}) == {}
    assert _parse_llm_json({"response": '["a", "b"]'}) == {}
    assert _parse_llm_json(None) == {}
