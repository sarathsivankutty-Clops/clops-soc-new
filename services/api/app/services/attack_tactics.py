"""ATT&CK Enterprise parent technique -> tactic(s), for alerts tagged with techniques only.

Neither detection engine sets ``mitre_tactics`` (the ruleset carries technique
ids only), so anything that ranks alerts by tactic has to derive them. A
technique can sit under several tactics; the first listed is its primary one.

Static on purpose: deterministic, works air-gapped, no STIX bundle download.
shortcut: covers the common parent techniques, not every ATT&CK entry, and
derives at read time. The deeper fix is fusion stamping ``mitre_tactics`` when
it creates an alert (from ingest's STIX index), after which the read-time
fallback in /metrics can go. The web's apps/web/src/lib/mitreTactics.ts keeps
a parallel table; keep the two in step.
"""

from __future__ import annotations

from collections.abc import Iterable

from app.services.detections.sigma_import import _MITRE_TACTIC_LOOKUP

IA, EXE, PER, PE, DE = "Initial Access", "Execution", "Persistence", "Privilege Escalation", "Defense Evasion"
CA, DIS, LM, COL = "Credential Access", "Discovery", "Lateral Movement", "Collection"
C2, EXF, IMP = "Command and Control", "Exfiltration", "Impact"

# fmt: off
TECHNIQUE_TACTICS: dict[str, tuple[str, ...]] = {
    # Initial Access
    "T1189": (IA,), "T1190": (IA,), "T1133": (IA, PER), "T1200": (IA,), "T1566": (IA,),
    "T1091": (IA, LM), "T1195": (IA,), "T1199": (IA,), "T1078": (IA, PER, PE, DE),
    # Execution
    "T1059": (EXE,), "T1203": (EXE,), "T1559": (EXE,), "T1106": (EXE,), "T1053": (EXE, PER, PE),
    "T1129": (EXE,), "T1072": (EXE, LM), "T1569": (EXE,), "T1204": (EXE,), "T1047": (EXE,),
    "T1610": (EXE, DE), "T1609": (EXE,), "T1651": (EXE,),
    # Persistence
    "T1098": (PER, PE), "T1197": (PER, DE), "T1547": (PER, PE), "T1037": (PER, PE), "T1136": (PER,),
    "T1543": (PER, PE), "T1546": (PER, PE), "T1574": (PER, PE, DE), "T1525": (PER,),
    "T1556": (CA, DE, PER), "T1137": (PER,), "T1542": (PER, DE), "T1505": (PER,), "T1205": (PER, DE, C2),
    # Privilege Escalation
    "T1548": (PE, DE), "T1134": (PE, DE), "T1484": (PE, DE), "T1611": (PE,), "T1068": (PE,), "T1055": (PE, DE),
    # Defense Evasion
    "T1140": (DE,), "T1006": (DE,), "T1480": (DE,), "T1211": (DE,), "T1222": (DE,), "T1564": (DE,),
    "T1562": (DE,), "T1070": (DE,), "T1202": (DE,), "T1036": (DE,), "T1578": (DE,), "T1112": (DE,),
    "T1601": (DE,), "T1599": (DE,), "T1027": (DE,), "T1647": (DE,), "T1620": (DE,), "T1207": (DE,),
    "T1014": (DE,), "T1553": (DE,), "T1218": (DE,), "T1216": (DE,), "T1221": (DE,), "T1127": (DE,),
    "T1535": (DE,), "T1550": (DE, LM), "T1497": (DE, DIS), "T1600": (DE,), "T1220": (DE,),
    # Credential Access
    "T1557": (CA, COL), "T1110": (CA,), "T1555": (CA,), "T1212": (CA,), "T1187": (CA,), "T1606": (CA,),
    "T1056": (CA, COL), "T1111": (CA,), "T1621": (CA,), "T1040": (CA, DIS), "T1003": (CA,), "T1528": (CA,),
    "T1649": (CA,), "T1558": (CA,), "T1539": (CA,), "T1552": (CA,),
    # Discovery
    "T1087": (DIS,), "T1010": (DIS,), "T1217": (DIS,), "T1580": (DIS,), "T1538": (DIS,), "T1526": (DIS,),
    "T1619": (DIS,), "T1613": (DIS,), "T1482": (DIS,), "T1083": (DIS,), "T1615": (DIS,), "T1046": (DIS,),
    "T1135": (DIS,), "T1201": (DIS,), "T1120": (DIS,), "T1069": (DIS,), "T1057": (DIS,), "T1012": (DIS,),
    "T1018": (DIS,), "T1518": (DIS,), "T1082": (DIS,), "T1614": (DIS,), "T1016": (DIS,), "T1049": (DIS,),
    "T1033": (DIS,), "T1007": (DIS,), "T1124": (DIS,),
    # Lateral Movement
    "T1210": (LM,), "T1534": (LM,), "T1570": (LM,), "T1563": (LM,), "T1021": (LM,), "T1080": (LM,),
    # Collection
    "T1560": (COL,), "T1123": (COL,), "T1119": (COL,), "T1185": (COL,), "T1115": (COL,), "T1530": (COL,),
    "T1602": (COL,), "T1213": (COL,), "T1005": (COL,), "T1039": (COL,), "T1025": (COL,), "T1074": (COL,),
    "T1114": (COL,), "T1113": (COL,), "T1125": (COL,),
    # Command and Control
    "T1071": (C2,), "T1092": (C2,), "T1132": (C2,), "T1001": (C2,), "T1568": (C2,), "T1573": (C2,),
    "T1008": (C2,), "T1105": (C2,), "T1104": (C2,), "T1095": (C2,), "T1571": (C2,), "T1572": (C2,),
    "T1090": (C2,), "T1219": (C2,), "T1102": (C2,),
    # Exfiltration
    "T1020": (EXF,), "T1030": (EXF,), "T1048": (EXF,), "T1041": (EXF,), "T1011": (EXF,), "T1052": (EXF,),
    "T1567": (EXF,), "T1029": (EXF,), "T1537": (EXF,),
    # Impact
    "T1531": (IMP,), "T1485": (IMP,), "T1486": (IMP,), "T1565": (IMP,), "T1491": (IMP,), "T1561": (IMP,),
    "T1499": (IMP,), "T1495": (IMP,), "T1490": (IMP,), "T1498": (IMP,), "T1496": (IMP,), "T1489": (IMP,),
    "T1529": (IMP,), "T1657": (IMP,),
}
# fmt: on


# Imported Sigma rules store tactics as TA-codes (TA0005) or tag form
# (defense_evasion); derived ones are display names. One spelling per tactic.
_TACTIC_DISPLAY: dict[str, str] = {
    **{key: name for key, (_, name) in _MITRE_TACTIC_LOOKUP.items()},
    **dict(_MITRE_TACTIC_LOOKUP.values()),
}


def display_tactic(tactic: str) -> str:
    """``TA0005`` / ``defense_evasion`` / ``defense-evasion`` -> ``Defense Evasion``; names pass through."""
    key = tactic.strip()
    return _TACTIC_DISPLAY.get(key.upper()) or _TACTIC_DISPLAY.get(key.lower().replace("-", "_")) or key


def parent_technique(technique: str) -> str:
    """``t1059.001`` -> ``T1059``."""
    return technique.split(".")[0].strip().upper()


def tactics_for_techniques(techniques: Iterable[object]) -> list[str]:
    """Every tactic the given techniques map to, deduplicated, in first-seen order."""
    out: dict[str, None] = {}
    for tech in techniques:
        if isinstance(tech, str) and tech:
            for tactic in TECHNIQUE_TACTICS.get(parent_technique(tech), ()):
                out[tactic] = None
    return list(out)
