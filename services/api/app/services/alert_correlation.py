"""Pure helpers for alert correlation explanations and shared-entity matching."""

from typing import Any


def shared_entity_labels(
    base_users: list[str] | None,
    base_ips: list[str] | None,
    base_hosts: list[str] | None,
    other_users: list[str] | None,
    other_ips: list[str] | None,
    other_hosts: list[str] | None,
) -> list[str]:
    """Return sorted human-readable shared entity labels between two alerts."""
    shared: list[str] = []
    for prefix, left, right in (
        ("user", base_users, other_users),
        ("ip", base_ips, other_ips),
        ("host", base_hosts, other_hosts),
    ):
        lset = {str(x) for x in (left or []) if x}
        rset = {str(x) for x in (right or []) if x}
        for val in sorted(lset & rset):
            shared.append(f"{prefix}:{val}")
    return shared


def derive_correlation_reasons(
    *,
    incident_id: str | None = None,
    case_id: Any = None,
    fusion_decision: str | None = None,
    enrichment_data: dict[str, Any] | None = None,
    shared_entities: list[str] | None = None,
) -> list[str]:
    """Build concise 'why grouped' reasons from persisted correlation fields."""
    reasons: list[str] = []
    if incident_id:
        reasons.append(f"Incident {incident_id}")
    if case_id:
        reasons.append(f"Linked to case {case_id}")
    if fusion_decision:
        reasons.append(f"Fusion: {fusion_decision}")
    chain = (enrichment_data or {}).get("attack_chain")
    if isinstance(chain, dict):
        stage = chain.get("stage") or chain.get("tactic")
        chain_id = chain.get("chain_id") or chain.get("id")
        if stage:
            reasons.append(f"Attack chain stage: {stage}")
        elif chain_id:
            reasons.append(f"Attack chain {chain_id}")
    if shared_entities:
        reasons.append(f"Shared entities: {', '.join(shared_entities[:4])}")
    return reasons
