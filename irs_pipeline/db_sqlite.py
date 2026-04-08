"""
irs_pipeline/db_sqlite.py
==========================
SQLite schema for:
  - irs_manifest  : audit/download tracking for every IRS filing
  - ai_cache      : caches AI categorization results to avoid duplicate API calls
"""

import sqlite3
from irs_pipeline import config


def get_sqlite_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(config.DB_SQLITE), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")    # safe concurrent writes
    conn.execute("PRAGMA synchronous=NORMAL")  # faster than FULL, still safe
    return conn


def init_sqlite_schema(conn: sqlite3.Connection):
    conn.executescript("""
    -- ── Manifest: one row per IRS filing ─────────────────────────────────────
    CREATE TABLE IF NOT EXISTS irs_manifest (
        object_id       TEXT PRIMARY KEY,
        ein             TEXT,
        tax_period      TEXT,
        tax_year        INTEGER,
        taxpayer_name   TEXT,
        return_type     TEXT,
        filing_type     TEXT,
        sub_date        TEXT,
        local_path      TEXT,
        file_size       INTEGER,
        download_status TEXT NOT NULL DEFAULT 'pending',
        error_msg       TEXT,
        downloaded_at   TEXT,
        extracted       INTEGER NOT NULL DEFAULT 0,
        extracted_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_manifest_year   ON irs_manifest (tax_year);
    CREATE INDEX IF NOT EXISTS idx_manifest_status ON irs_manifest (download_status);
    CREATE INDEX IF NOT EXISTS idx_manifest_ein    ON irs_manifest (ein);
    CREATE INDEX IF NOT EXISTS idx_manifest_extract ON irs_manifest (extracted);

    -- ── AI cache: hash(recipient_name + description) -> classification ────────
    -- NEVER send the same grant text to the API twice.
    CREATE TABLE IF NOT EXISTS ai_cache (
        cache_key       TEXT PRIMARY KEY,   -- md5(normalize(recipient+description))
        recipient_name  TEXT,
        description     TEXT,
        expense_type    TEXT NOT NULL,      -- Jews | Non jews | Miscellaneous
        ai_explanation  TEXT,
        model_used      TEXT,
        tokens_used     INTEGER,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cache_expense ON ai_cache (expense_type);
    """)
    conn.commit()
