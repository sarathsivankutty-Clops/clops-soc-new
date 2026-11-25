from app.services.attack_tactics import TECHNIQUE_TACTICS, tactics_for_techniques


def test_technique_only_alert_yields_tactics() -> None:
    # Sub-technique resolves through its parent; multi-tactic techniques keep every tactic.
    assert tactics_for_techniques(["t1059.001", "T1053"]) == ["Execution", "Persistence", "Privilege Escalation"]


def test_unknown_and_junk_are_ignored() -> None:
    assert tactics_for_techniques(["T9999", "", None, 42]) == []


def test_ids_are_parent_techniques() -> None:
    assert all(tid.startswith("T") and "." not in tid and tactics for tid, tactics in TECHNIQUE_TACTICS.items())


def test_sigma_tactic_spellings_collapse_to_one_name() -> None:
    from app.services.attack_tactics import display_tactic

    assert {display_tactic(t) for t in ["TA0005", "defense_evasion", "defense-evasion", "Defense Evasion"]} == {"Defense Evasion"}
