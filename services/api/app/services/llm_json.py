"""Pure-stdlib JSON extraction helper for LLM agent ledger responses."""

from __future__ import annotations

import json
import re
from typing import Any

_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_CODE_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_first_json_object(text_val: str) -> str | None:
    """Return the first balanced `{...}` JSON object substring, respecting strings."""
    start = text_val.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text_val)):
        ch = text_val[idx]
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text_val[start : idx + 1]
    return None


def parse_llm_json_payload(payload: Any) -> dict[str, Any]:
    """Extract a JSON object from an `llm_response` event payload.

    Agents return a JSON string in `payload["response"]`; the API's jsonb
    column already deserialises the envelope, so we only parse the inner
    string. Strips `<think>` reasoning blocks and markdown code fences, then
    extracts the first balanced `{...}` object before `json.loads`.
    """
    if not isinstance(payload, dict):
        return {}
    raw = payload.get("response")
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}

    cleaned = _THINK_BLOCK_RE.sub("", raw).strip()
    fence_match = _CODE_FENCE_RE.search(cleaned)
    if fence_match:
        cleaned = fence_match.group(1).strip()

    for candidate in (cleaned, extract_first_json_object(cleaned)):
        if not candidate:
            continue
        try:
            obj = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict):
            return obj
    return {}
