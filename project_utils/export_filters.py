"""Safe filter parsing for the database export surfaces."""

from __future__ import annotations

import re
from typing import Any, Iterable

ALLOWED_EXPORT_TABLES = {
    "irs_grants",
    "v_grants_powerbi",
    "v_filing_summary",
}

ALLOWED_EXPENSE_TYPES = {
    "Jews",
    "Non jews",
    "Miscellaneous",
    "Uncategorized",
}

_CLAUSE_RE = re.compile(
    r"^\s*(?P<field>[a-z_]+)\s*(?P<operator>=|>=|<=|~)\s*(?P<value>.+?)\s*$",
    re.IGNORECASE,
)

_TEXT_FIELDS = {
    "grantmaker_name": "grantmaker_name",
    "recipient_name": "recipient_name",
    "primary_subject": "primary_subject",
    "geography": "geography",
    "grantmaker_state": "grantmaker_state",
    "expense_type": "expense_type",
}

_NUMERIC_FIELDS = {
    "tax_year": "tax_year",
    "grant_amount": "grant_amount",
}


def ensure_allowed_table(name: str) -> str:
    """Return an allowlisted table/view name or raise."""
    if name not in ALLOWED_EXPORT_TABLES:
        allowed = ", ".join(sorted(ALLOWED_EXPORT_TABLES))
        raise ValueError(f"Unsupported export target {name!r}. Allowed: {allowed}")
    return name


def build_safe_where_clause(filter_expr: str) -> tuple[str, list[Any]]:
    """
    Parse a safe, limited filter expression into SQL and bound parameters.

    Supported examples:
      tax_year=2023
      expense_type='Jews'
      grantmaker_state=NY
      grantmaker_name~foundation AND grant_amount>=100000
    """
    text = (filter_expr or "").strip()
    if not text:
        return "", []

    sql_parts: list[str] = []
    params: list[Any] = []

    for raw_clause in _split_clauses(text):
        match = _CLAUSE_RE.match(raw_clause)
        if not match:
            raise ValueError(f"Invalid filter clause: {raw_clause!r}")

        field = match.group("field").lower()
        operator = match.group("operator")
        raw_value = _strip_quotes(match.group("value").strip())

        if field in _NUMERIC_FIELDS:
            if operator not in {"=", ">=", "<="}:
                raise ValueError(f"Unsupported operator {operator!r} for {field}")
            try:
                numeric = int(raw_value)
            except ValueError as exc:
                raise ValueError(f"{field} must be an integer") from exc
            sql_parts.append(f"{_NUMERIC_FIELDS[field]} {operator} %s")
            params.append(numeric)
            continue

        if field == "expense_type":
            if operator != "=":
                raise ValueError("expense_type only supports '='")
            if raw_value not in ALLOWED_EXPENSE_TYPES:
                allowed = ", ".join(sorted(ALLOWED_EXPENSE_TYPES))
                raise ValueError(f"Unsupported expense_type {raw_value!r}. Allowed: {allowed}")
            sql_parts.append("expense_type = %s")
            params.append(raw_value)
            continue

        if field == "grantmaker_state":
            if operator != "=":
                raise ValueError("grantmaker_state only supports '='")
            state = raw_value.upper()
            if len(state) != 2 or not state.isalpha():
                raise ValueError("grantmaker_state must be a 2-letter code")
            sql_parts.append("grantmaker_state = %s")
            params.append(state)
            continue

        if field in _TEXT_FIELDS:
            column = _TEXT_FIELDS[field]
            if operator == "=":
                sql_parts.append(f"{column} = %s")
                params.append(raw_value)
            elif operator == "~":
                sql_parts.append(f"{column} ILIKE %s")
                params.append(f"%{raw_value}%")
            else:
                raise ValueError(f"Unsupported operator {operator!r} for {field}")
            continue

        allowed_fields = ", ".join(sorted({*list(_TEXT_FIELDS), *list(_NUMERIC_FIELDS)}))
        raise ValueError(f"Unsupported field {field!r}. Allowed: {allowed_fields}")

    return " AND ".join(sql_parts), params


def _split_clauses(text: str) -> Iterable[str]:
    """Split clauses on commas or AND while keeping the syntax intentionally simple."""
    normalized = re.sub(r"\s+AND\s+", ",", text, flags=re.IGNORECASE)
    return [part.strip() for part in normalized.split(",") if part.strip()]


def _strip_quotes(value: str) -> str:
    """Remove a single matching pair of wrapping quotes."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value
