"""Pure helpers for alert search escaping and occurrence-count normalization."""


def escape_ilike(term: str) -> str:
    """Escape LIKE/ILIKE metacharacters (`\\`, `%`, `_`) using `\\` as escape char."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_ilike_pattern(raw_search: str | None) -> str | None:
    """Return a parameterized `%term%` pattern or None when search is blank."""
    if raw_search is None:
        return None
    stripped = raw_search.strip()
    if not stripped:
        return None
    return f"%{escape_ilike(stripped)}%"


def normalize_occurrence_count(value: int | None) -> int:
    """Absent `alert_occurrences` row means exactly 1 sighting."""
    if value is None or value < 1:
        return 1
    return int(value)
