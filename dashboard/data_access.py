"""Read-only data access layer for the Streamlit dashboard."""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from project_utils.paths import STANDALONE_DB_PATH, WAREHOUSE_DB_PATH
from project_utils.security import sqlite_readonly_uri


EXPECTED_TABLES = ("irs_grants", "irs_grants_2023_2024")
REQUIRED_COLUMNS = {
    "tax_year",
    "grantmaker_name",
    "recipient_name",
    "grant_amount",
    "expense_type",
    "description",
}


@dataclass(frozen=True)
class SourceDescriptor:
    """Dashboard-friendly description of a discovered SQLite warehouse."""

    source_id: str
    label: str
    path: Path
    table_name: str
    state_column: str


@dataclass(frozen=True)
class DashboardFilters:
    """Active dashboard filters."""

    years: tuple[int, ...] = ()
    categories: tuple[str, ...] = ()
    states: tuple[str, ...] = ()
    subjects: tuple[str, ...] = ()
    search_text: str = ""


def list_sources(base_dir: Path) -> list[SourceDescriptor]:
    """Discover local read-only SQLite sources the dashboard can safely query."""
    candidates = [
        ("warehouse", "Operational Warehouse", WAREHOUSE_DB_PATH),
        ("standalone", "Standalone Pipeline Cache", STANDALONE_DB_PATH),
    ]

    env_path = os.getenv("FORM990_DASHBOARD_DB", "").strip()
    if env_path:
        candidates.insert(0, ("env", "Custom SQLite Source", Path(env_path)))

    sources: list[SourceDescriptor] = []
    for source_id, label, path in candidates:
        descriptor = _build_source(source_id, label, path)
        if descriptor:
            sources.append(descriptor)
    return sources


def fetch_filter_options(source: SourceDescriptor) -> dict[str, list[Any]]:
    """Return distinct filter options for the selected source."""
    with _connect(source) as conn:
        years = _read_scalar_list(conn, f"SELECT DISTINCT tax_year FROM {source.table_name} WHERE tax_year IS NOT NULL ORDER BY tax_year")
        categories = _read_scalar_list(conn, f"SELECT DISTINCT expense_type FROM {source.table_name} WHERE expense_type IS NOT NULL AND expense_type <> '' ORDER BY expense_type")
        states = _read_scalar_list(conn, f"SELECT DISTINCT {source.state_column} FROM {source.table_name} WHERE {source.state_column} IS NOT NULL AND {source.state_column} <> '' ORDER BY {source.state_column}")
        subjects = _read_scalar_list(conn, f"SELECT DISTINCT primary_subject FROM {source.table_name} WHERE primary_subject IS NOT NULL AND primary_subject <> '' ORDER BY primary_subject")

    return {
        "years": [int(year) for year in years],
        "categories": [str(value) for value in categories],
        "states": [str(value) for value in states],
        "subjects": [str(value) for value in subjects],
    }


def fetch_profile(source: SourceDescriptor) -> dict[str, Any]:
    """Return headline metrics for the dataset backing the dashboard."""
    query = f"""
        SELECT
            COUNT(*) AS total_grants,
            COUNT(DISTINCT grantmaker_name) AS grantmakers,
            COALESCE(SUM(grant_amount), 0) AS total_dollars,
            COALESCE(AVG(grant_amount), 0) AS avg_grant,
            MIN(tax_year) AS first_year,
            MAX(tax_year) AS last_year
        FROM {source.table_name}
    """
    with _connect(source) as conn:
        row = conn.execute(query).fetchone()
    return dict(row)


def fetch_overview_metrics(source: SourceDescriptor, filters: DashboardFilters) -> dict[str, Any]:
    """Return aggregated metrics for the current filter set."""
    where_sql, params = _build_where(source, filters)
    query = f"""
        SELECT
            COUNT(*) AS grants,
            COUNT(DISTINCT grantmaker_name) AS grantmakers,
            COALESCE(SUM(grant_amount), 0) AS total_dollars,
            COALESCE(AVG(grant_amount), 0) AS avg_grant,
            COALESCE(SUM(CASE WHEN expense_type = 'Jews' THEN grant_amount ELSE 0 END), 0) AS jewish_dollars,
            COALESCE(SUM(CASE WHEN expense_type = 'Jews' THEN 1 ELSE 0 END), 0) AS jewish_grants
        FROM {source.table_name}
        {where_sql}
    """
    with _connect(source) as conn:
        row = conn.execute(query, params).fetchone()
    return dict(row)


def fetch_category_mix(source: SourceDescriptor, filters: DashboardFilters) -> pd.DataFrame:
    """Return category-level count and dollar aggregates."""
    where_sql, params = _build_where(source, filters)
    query = f"""
        SELECT
            expense_type,
            COUNT(*) AS grant_count,
            COALESCE(SUM(grant_amount), 0) AS total_dollars
        FROM {source.table_name}
        {where_sql}
        GROUP BY expense_type
        ORDER BY total_dollars DESC, grant_count DESC
    """
    return _read_frame(source, query, params)


def fetch_trend(source: SourceDescriptor, filters: DashboardFilters) -> pd.DataFrame:
    """Return annual category trends."""
    where_sql, params = _build_where(source, filters)
    query = f"""
        SELECT
            tax_year,
            expense_type,
            COUNT(*) AS grant_count,
            COALESCE(SUM(grant_amount), 0) AS total_dollars
        FROM {source.table_name}
        {where_sql}
        GROUP BY tax_year, expense_type
        ORDER BY tax_year, expense_type
    """
    return _read_frame(source, query, params)


def fetch_subject_mix(source: SourceDescriptor, filters: DashboardFilters, limit: int = 12) -> pd.DataFrame:
    """Return the top subject areas by total dollars."""
    where_sql, params = _build_where(source, filters)
    query = f"""
        SELECT
            COALESCE(primary_subject, 'Unspecified') AS primary_subject,
            COUNT(*) AS grant_count,
            COALESCE(SUM(grant_amount), 0) AS total_dollars
        FROM {source.table_name}
        {where_sql}
        GROUP BY COALESCE(primary_subject, 'Unspecified')
        ORDER BY total_dollars DESC, grant_count DESC
        LIMIT ?
    """
    return _read_frame(source, query, [*params, int(limit)])


def fetch_state_mix(source: SourceDescriptor, filters: DashboardFilters, limit: int = 12) -> pd.DataFrame:
    """Return the top recipient states/countries by total dollars."""
    where_sql, params = _build_where(source, filters)
    query = f"""
        SELECT
            COALESCE({source.state_column}, 'Unknown') AS geography_label,
            COUNT(*) AS grant_count,
            COALESCE(SUM(grant_amount), 0) AS total_dollars
        FROM {source.table_name}
        {where_sql}
        GROUP BY COALESCE({source.state_column}, 'Unknown')
        ORDER BY total_dollars DESC, grant_count DESC
        LIMIT ?
    """
    return _read_frame(source, query, [*params, int(limit)])


def fetch_top_grantmakers(source: SourceDescriptor, filters: DashboardFilters, limit: int = 15) -> pd.DataFrame:
    """Return the largest grantmakers for the current filter set."""
    where_sql, params = _build_where(source, filters)
    query = f"""
        SELECT
            grantmaker_name,
            COUNT(*) AS grant_count,
            COALESCE(SUM(grant_amount), 0) AS total_dollars
        FROM {source.table_name}
        {where_sql}
        GROUP BY grantmaker_name
        HAVING grantmaker_name IS NOT NULL AND grantmaker_name <> ''
        ORDER BY total_dollars DESC, grant_count DESC
        LIMIT ?
    """
    return _read_frame(source, query, [*params, int(limit)])


def fetch_recent_records(source: SourceDescriptor, filters: DashboardFilters, limit: int = 250) -> pd.DataFrame:
    """Return a slice of filtered rows for the explorer grid and CSV export."""
    where_sql, params = _build_where(source, filters)
    query = f"""
        SELECT
            tax_year,
            grantmaker_name,
            recipient_name,
            COALESCE({source.state_column}, '') AS recipient_location,
            COALESCE(primary_subject, '') AS primary_subject,
            COALESCE(expense_type, '') AS expense_type,
            COALESCE(grant_amount, 0) AS grant_amount,
            COALESCE(description, '') AS description
        FROM {source.table_name}
        {where_sql}
        ORDER BY tax_year DESC, grant_amount DESC, grantmaker_name ASC
        LIMIT ?
    """
    return _read_frame(source, query, [*params, int(limit)])


def _build_source(source_id: str, label: str, path: Path) -> SourceDescriptor | None:
    if not path.exists() or not path.is_file():
        return None

    try:
        with sqlite3.connect(sqlite_readonly_uri(path), uri=True) as conn:
            conn.row_factory = sqlite3.Row
            table_name = _discover_table(conn)
            if not table_name:
                return None
            columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}
    except sqlite3.Error:
        return None

    if not REQUIRED_COLUMNS.issubset(columns):
        return None

    state_column = "recipient_state_country" if "recipient_state_country" in columns else "recipient_state"
    return SourceDescriptor(
        source_id=source_id,
        label=label,
        path=path,
        table_name=table_name,
        state_column=state_column,
    )


def _discover_table(conn: sqlite3.Connection) -> str | None:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    names = {row["name"] for row in rows}
    for table_name in EXPECTED_TABLES:
        if table_name in names:
            return table_name
    return None


def _connect(source: SourceDescriptor) -> sqlite3.Connection:
    conn = sqlite3.connect(sqlite_readonly_uri(source.path), uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _read_frame(source: SourceDescriptor, query: str, params: list[Any]) -> pd.DataFrame:
    with _connect(source) as conn:
        return pd.read_sql_query(query, conn, params=params)


def _read_scalar_list(conn: sqlite3.Connection, query: str) -> list[Any]:
    return [row[0] for row in conn.execute(query).fetchall()]


def _build_where(source: SourceDescriptor, filters: DashboardFilters) -> tuple[str, list[Any]]:
    conditions: list[str] = []
    params: list[Any] = []

    if filters.years:
        placeholders = ", ".join("?" for _ in filters.years)
        conditions.append(f"tax_year IN ({placeholders})")
        params.extend(filters.years)

    if filters.categories:
        placeholders = ", ".join("?" for _ in filters.categories)
        conditions.append(f"expense_type IN ({placeholders})")
        params.extend(filters.categories)

    if filters.states:
        placeholders = ", ".join("?" for _ in filters.states)
        conditions.append(f"{source.state_column} IN ({placeholders})")
        params.extend(filters.states)

    if filters.subjects:
        placeholders = ", ".join("?" for _ in filters.subjects)
        conditions.append(f"primary_subject IN ({placeholders})")
        params.extend(filters.subjects)

    search_text = filters.search_text.strip().lower()
    if search_text:
        pattern = f"%{search_text}%"
        conditions.append(
            "("
            "LOWER(COALESCE(grantmaker_name, '')) LIKE ? "
            "OR LOWER(COALESCE(recipient_name, '')) LIKE ? "
            "OR LOWER(COALESCE(description, '')) LIKE ?"
            ")"
        )
        params.extend([pattern, pattern, pattern])

    if not conditions:
        return "", params

    return "WHERE " + " AND ".join(conditions), params
