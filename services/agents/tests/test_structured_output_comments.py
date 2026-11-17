"""Tests for structured_output comment, fence, and trailing-comma tolerance across all LLMs."""

import importlib.util
from pathlib import Path

_MOD_PATH = Path(__file__).resolve().parents[1] / "app" / "llm" / "structured_output.py"
_SPEC = importlib.util.spec_from_file_location("structured_output", _MOD_PATH)
assert _SPEC and _SPEC.loader
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)

parse_json_object = _MOD.parse_json_object
parse_structured = _MOD.parse_structured


def test_parse_json_object_strips_inline_line_comments_and_preserves_urls():
    raw = """<think>Analyzing alert</think>
```json
{
  "iocs": [
    {"type": "ip", "value": "152.57.42.81"},
    {"type": "url", "value": "https://s3.amazonaws.com/bucket//path"}
  ],
  "mitre_techniques": [
    "T1566.001" // Technique: Phishing - Initial Access
  ],
  "threat_actors": [
    "Unknown", // trailing comma below
  ],
  /* block comment with {braces} */
  "note": "keep /* inside */ string"
}
```
"""
    parsed = parse_json_object(raw)
    assert parsed["iocs"][0]["value"] == "152.57.42.81"
    assert parsed["iocs"][1]["value"] == "https://s3.amazonaws.com/bucket//path"
    assert parsed["mitre_techniques"] == ["T1566.001"]
    assert parsed["threat_actors"] == ["Unknown"]
    assert parsed["note"] == "keep /* inside */ string"


def test_parse_structured_also_tolerates_comments_and_trailing_commas():
    raw = 'Here is the JSON:\n{"verdict": "true_positive", // high confidence\n "confidence": 0.9,}\nThanks!'
    res = parse_structured(raw)
    assert res.ok is True
    assert res.value == {"verdict": "true_positive", "confidence": 0.9}
