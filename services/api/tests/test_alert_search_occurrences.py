"""Unit tests for PR1b alert search escaping, occurrence_count normalization, and endpoint contract."""

import ast
from pathlib import Path

from app.services.alert_search import (
    build_ilike_pattern,
    escape_ilike,
    normalize_occurrence_count,
)


def test_escape_ilike_escapes_wildcards_and_backslash():
    assert escape_ilike("100%_admin\\test") == "100\\%\\_admin\\\\test"


def test_build_ilike_pattern_handles_blank_and_trimmed():
    assert build_ilike_pattern(None) is None
    assert build_ilike_pattern("   ") is None
    assert build_ilike_pattern("  s3_bucket%  ") == "%s3\\_bucket\\%%"


def test_normalize_occurrence_count_defaults_to_one():
    assert normalize_occurrence_count(None) == 1
    assert normalize_occurrence_count(0) == 1
    assert normalize_occurrence_count(1) == 1
    assert normalize_occurrence_count(14) == 14


def test_alerts_endpoint_declares_search_connector_type_and_occurrences_join():
    src = Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "endpoints" / "alerts.py"
    text = src.read_text(encoding="utf-8")
    tree = ast.parse(text)

    list_fn = next(
        n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "list_alerts"
    )
    arg_names = {a.arg for a in list_fn.args.args}
    assert "connector_type" in arg_names
    assert "search" in arg_names

    assert "occurrence_count: int = 1" in text
    assert "_alert_occurrences_tbl" in text
    assert ".outerjoin(" in text
    assert "Alert.rule_name.ilike(" in text
    assert "Alert.connector_type == connector_type" in text
