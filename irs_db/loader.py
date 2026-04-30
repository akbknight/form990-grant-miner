"""
irs_db/loader.py
================
All PostgreSQL I/O. No parsing logic here.

Key functions:
  get_conn()               - returns a psycopg2 connection
  ensure_schema(conn)      - creates tables/indexes if they don't exist
  get_pending_zips()       - returns ZIPs not yet successfully processed
  upsert_filings()         - batch upsert into irs_filings
  insert_grants()          - batch insert into irs_grants
  mark_zip_*()             - update pipeline_state
  delete_partial_zip()     - clean up on error before retry
"""

import logging
from pathlib import Path
from typing import List, Dict, Optional

import psycopg2
import psycopg2.extras
from psycopg2.extras import execute_values

from irs_db.config import (
    BATCH_SIZE_FILINGS,
    BATCH_SIZE_GRANTS,
    SCHEMA_FILE,
    get_db_dsn,
)

log = logging.getLogger(__name__)


# ── Connection ─────────────────────────────────────────────────────────────────

def get_conn():
    """Return a new psycopg2 connection. Caller is responsible for closing."""
    try:
        conn = psycopg2.connect(get_db_dsn())
        conn.autocommit = False
        return conn
    except psycopg2.OperationalError as e:
        log.error("Cannot connect to database: %s", e)
        log.error("Check the IRS_DB_DSN environment variable or your .env file.")
        raise


def ensure_schema(conn):
    """Run schema.sql to create all tables, indexes and views if not exists."""
    sql = Path(SCHEMA_FILE).read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    log.info("Schema verified/created.")


# ── Pipeline state ─────────────────────────────────────────────────────────────

def get_pending_zips(conn, all_zip_paths: List[str]) -> List[str]:
    """
    Return zip paths that have NOT been successfully completed.
    Already-completed ZIPs are silently skipped.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT zip_filename FROM pipeline_state WHERE status = 'complete'"
        )
        done = {row[0] for row in cur.fetchall()}

    pending = [p for p in all_zip_paths if Path(p).name not in done]
    skipped = len(all_zip_paths) - len(pending)
    if skipped:
        log.info("Resuming: %d ZIPs already done, %d remaining.", skipped, len(pending))
    return pending


def mark_zip_processing(conn, zip_name: str, zip_path: str):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO pipeline_state (zip_filename, zip_path, status, started_at)
            VALUES (%s, %s, 'processing', NOW())
            ON CONFLICT (zip_filename) DO UPDATE SET
                status     = 'processing',
                started_at = NOW(),
                error_msg  = NULL
        """, (zip_name, zip_path))
    conn.commit()


def mark_zip_complete(conn, zip_name: str, filings_n: int, grants_n: int):
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE pipeline_state SET
                status         = 'complete',
                filings_loaded = %s,
                grants_loaded  = %s,
                completed_at   = NOW()
            WHERE zip_filename = %s
        """, (filings_n, grants_n, zip_name))
    conn.commit()


def mark_zip_error(conn, zip_name: str, err_msg: str):
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE pipeline_state SET
                status    = 'error',
                error_msg = %s
            WHERE zip_filename = %s
        """, (str(err_msg)[:2000], zip_name))
    conn.commit()


def delete_partial_zip(conn, zip_name: str):
    """Remove any partially-inserted rows for a ZIP before retrying."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM irs_grants  WHERE source_zip = %s", (zip_name,))
        g = cur.rowcount
        cur.execute("DELETE FROM irs_filings WHERE source_zip = %s", (zip_name,))
        f = cur.rowcount
    conn.commit()
    if f or g:
        log.info("  Cleaned up partial data: %d filings, %d grants deleted.", f, g)


# ── Batch upsert: irs_filings ──────────────────────────────────────────────────

_FILING_COLS = [
    "ein", "tax_year", "form_type", "org_name", "org_name_clean",
    "org_state", "org_city", "org_zip", "org_country",
    "gross_receipts", "total_revenue", "total_expenses",
    "total_assets_eoy", "total_liabilities_eoy", "net_assets_eoy",
    "employee_count", "volunteer_count", "source_zip",
]

_FILING_UPSERT = """
    INSERT INTO irs_filings ({cols})
    VALUES %s
    ON CONFLICT (ein, tax_year) DO UPDATE SET
        form_type             = EXCLUDED.form_type,
        org_name              = COALESCE(EXCLUDED.org_name,    irs_filings.org_name),
        org_name_clean        = COALESCE(EXCLUDED.org_name_clean, irs_filings.org_name_clean),
        org_state             = COALESCE(EXCLUDED.org_state,   irs_filings.org_state),
        org_city              = COALESCE(EXCLUDED.org_city,    irs_filings.org_city),
        org_zip               = COALESCE(EXCLUDED.org_zip,     irs_filings.org_zip),
        org_country           = COALESCE(EXCLUDED.org_country, irs_filings.org_country),
        gross_receipts        = COALESCE(EXCLUDED.gross_receipts,        irs_filings.gross_receipts),
        total_revenue         = COALESCE(EXCLUDED.total_revenue,         irs_filings.total_revenue),
        total_expenses        = COALESCE(EXCLUDED.total_expenses,        irs_filings.total_expenses),
        total_assets_eoy      = COALESCE(EXCLUDED.total_assets_eoy,      irs_filings.total_assets_eoy),
        total_liabilities_eoy = COALESCE(EXCLUDED.total_liabilities_eoy, irs_filings.total_liabilities_eoy),
        net_assets_eoy        = COALESCE(EXCLUDED.net_assets_eoy,        irs_filings.net_assets_eoy),
        employee_count        = COALESCE(EXCLUDED.employee_count,        irs_filings.employee_count),
        volunteer_count       = COALESCE(EXCLUDED.volunteer_count,       irs_filings.volunteer_count),
        source_zip            = EXCLUDED.source_zip,
        loaded_at             = NOW()
""".format(cols=", ".join(_FILING_COLS))


def upsert_filings(conn, filings: List[Dict]):
    """Batch upsert a list of filing dicts into irs_filings."""
    if not filings:
        return 0
    # Deduplicate within the batch — PostgreSQL ON CONFLICT DO UPDATE
    # cannot affect the same (ein, tax_year) twice in one statement.
    # Keep last occurrence (tends to have most complete data).
    seen: dict = {}
    for f in filings:
        key = (f.get("ein"), f.get("tax_year"))
        seen[key] = f
    rows = [tuple(f.get(c) for c in _FILING_COLS) for f in seen.values()]
    with conn.cursor() as cur:
        execute_values(cur, _FILING_UPSERT, rows, page_size=BATCH_SIZE_FILINGS)
    conn.commit()
    return len(rows)


# ── Batch insert: irs_grants ───────────────────────────────────────────────────

_GRANT_COLS = [
    "ein", "tax_year", "grantmaker_name", "grantmaker_state",
    "recipient_name", "recipient_city", "recipient_state_country",
    "geography", "primary_subject", "support_strategy",
    "grant_amount", "description", "expense_type",
    "source_zip", "source_xml",
]

_GRANT_INSERT = "INSERT INTO irs_grants ({cols}) VALUES %s".format(
    cols=", ".join(_GRANT_COLS)
)


def insert_grants(conn, grants: List[Dict]):
    """Batch insert a list of grant dicts into irs_grants."""
    if not grants:
        return 0
    rows = [tuple(g.get(c) for c in _GRANT_COLS) for g in grants]
    with conn.cursor() as cur:
        execute_values(cur, _GRANT_INSERT, rows, page_size=BATCH_SIZE_GRANTS)
    conn.commit()
    return len(rows)


# ── Index management ───────────────────────────────────────────────────────────

def build_indexes(conn):
    """
    Build all indexes. Run AFTER the initial bulk load for maximum speed.
    Uses CONCURRENTLY so existing data remains queryable during index build.
    Note: CONCURRENTLY cannot run inside a transaction block.
    """
    conn.autocommit = True
    indexes = [
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_ein          ON irs_grants (ein)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_tax_year     ON irs_grants (tax_year)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_expense_type ON irs_grants (expense_type)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_grantmaker   ON irs_grants (grantmaker_name)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_subject      ON irs_grants (primary_subject)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_source_zip   ON irs_grants (source_zip)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_amount       ON irs_grants (grant_amount)",
        """CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_jewish
           ON irs_grants (grantmaker_name, tax_year, grant_amount)
           WHERE expense_type = 'Jews'""",
    ]
    with conn.cursor() as cur:
        for sql in indexes:
            log.info("Building: %s", sql.split("idx_")[1].split(" ")[0])
            cur.execute(sql)
    conn.autocommit = False
    log.info("All indexes built.")


# ── Quick stats ────────────────────────────────────────────────────────────────

def print_stats(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM irs_filings")
        filings = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM irs_grants")
        grants = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM irs_grants WHERE expense_type = 'Jews'")
        jewish = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM pipeline_state WHERE status = 'complete'")
        zips_done = cur.fetchone()[0]

    log.info("=== Database Stats ===")
    log.info("  ZIPs processed : %d", zips_done)
    log.info("  irs_filings    : %s", f"{filings:,}")
    log.info("  irs_grants     : %s", f"{grants:,}")
    log.info("  Jewish grants  : %s  (%.2f%%)", f"{jewish:,}",
             jewish / grants * 100 if grants else 0)
