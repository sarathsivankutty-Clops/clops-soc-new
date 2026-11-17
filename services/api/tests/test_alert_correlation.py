"""Unit & contract tests for PR2 alert correlation persistence, case_id sync, and rail pivots."""

from pathlib import Path

from app.services.alert_correlation import derive_correlation_reasons, shared_entity_labels


def test_shared_entity_labels_finds_user_ip_host_overlap():
    shared = shared_entity_labels(
        ["alice", "bob"],
        ["10.0.0.1"],
        ["web-01"],
        ["bob", "charlie"],
        ["10.0.0.1", "10.0.0.2"],
        ["db-01"],
    )
    assert shared == ["user:bob", "ip:10.0.0.1"]


def test_derive_correlation_reasons_includes_all_present_signals():
    reasons = derive_correlation_reasons(
        incident_id="inc-42",
        case_id="case-9",
        fusion_decision="correlate",
        enrichment_data={"attack_chain": {"stage": "credential_access", "chain_id": "ch-1"}},
        shared_entities=["user:bob", "ip:10.0.0.1"],
    )
    assert "Incident inc-42" in reasons
    assert "Linked to case case-9" in reasons
    assert "Fusion: correlate" in reasons
    assert "Attack chain stage: credential_access" in reasons
    assert "Shared entities: user:bob, ip:10.0.0.1" in reasons


def test_pr2_backend_contracts_and_idempotent_migrations():
    root = Path(__file__).resolve().parents[3]
    cases_text = (root / "services" / "api" / "app" / "api" / "v1" / "endpoints" / "cases.py").read_text(encoding="utf-8")
    assert "UPDATE alerts" in cases_text
    assert "SET case_id = :case_id" in cases_text

    sink_text = (root / "services" / "fusion" / "app" / "services" / "alert_sink.py").read_text(encoding="utf-8")
    assert "incident_id, fusion_decision, enrichment_data" in sink_text

    rail_text = (root / "services" / "api" / "app" / "services" / "alert_rail.py").read_text(encoding="utf-8")
    assert 'return f"/cases/{case_id}?tab=attack-path' in rail_text
    assert 'return f"/alerts?search=' in rail_text

    m161 = (root / "services" / "api" / "migrations" / "161_alert_correlation_fields.sql").read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS incident_id" in m161
    assert "ADD COLUMN IF NOT EXISTS fusion_decision" in m161

    m162 = (root / "services" / "api" / "migrations" / "162_backfill_alerts_case_id.sql").read_text(encoding="utf-8")
    assert "WHERE a.tenant_id = c.tenant_id" in m162
    assert "a.case_id IS NULL" in m162
