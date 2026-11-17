"""Contract tests for PR4 remediation & approval bridge."""

from pathlib import Path


def test_fused_alert_consumer_persists_proposed_actions_after_escalate_with_action_key():
    root = Path(__file__).resolve().parents[3]
    text = (
        root / "services" / "agents" / "app" / "workers" / "fused_alert_consumer.py"
    ).read_text(encoding="utf-8")

    assert '"action": a.description or a.action_type' in text
    esc_idx = text.index("await self._maybe_escalate(state, writer=writer)")
    after_esc = text[esc_idx : esc_idx + 400]
    assert "if state.proposed_actions:" in after_esc
    assert "await self._record(" in after_esc


def test_approvals_list_supports_case_id_and_alert_id_filters():
    root = Path(__file__).resolve().parents[3]
    text = (
        root / "services" / "api" / "app" / "api" / "v1" / "endpoints" / "approvals.py"
    ).read_text(encoding="utf-8")

    assert "case_id: str | None = Query(default=None)" in text
    assert "alert_id: uuid.UUID | None = Query(default=None)" in text
    assert "AgentApproval.case_id == case_id" in text
    assert "AgentApproval.alert_id == alert_id" in text
