"""
db_sqlite.py
============
SQLite schema and connection helper.

Tables:
  irs_manifest  — one row per IRS S3 filing (audit + download tracking)
  irs_grants    — extracted grant records from parsed XML
  ai_cache      — MD5-keyed cache of AI categorization results
"""

import sqlite3
import config


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection):
    conn.executescript("""

    -- ── Manifest: tracks every filing available on IRS S3 ────────────────────
    CREATE TABLE IF NOT EXISTS irs_manifest (
        object_id        TEXT    PRIMARY KEY,
        ein              TEXT,
        tax_period       TEXT,
        tax_year         INTEGER,
        taxpayer_name    TEXT,
        return_type      TEXT,
        filing_type      TEXT,
        sub_date         TEXT,
        local_path       TEXT,
        file_size        INTEGER,
        expected_size    INTEGER,
        checksum_md5     TEXT,
        download_status  TEXT    NOT NULL DEFAULT 'pending',
        error_msg        TEXT,
        downloaded_at    TEXT,
        extracted        INTEGER NOT NULL DEFAULT 0,
        extracted_at     TEXT,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_manifest_year    ON irs_manifest (tax_year);
    CREATE INDEX IF NOT EXISTS idx_manifest_status  ON irs_manifest (download_status);
    CREATE INDEX IF NOT EXISTS idx_manifest_extract ON irs_manifest (extracted);
    CREATE INDEX IF NOT EXISTS idx_manifest_ein     ON irs_manifest (ein);

    -- ── Grants: extracted grant records (one row per grant) ──────────────────
    CREATE TABLE IF NOT EXISTS irs_grants (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id        TEXT    NOT NULL,
        ein              TEXT,
        tax_year         INTEGER,
        grantmaker_name  TEXT,
        grantmaker_state TEXT,
        recipient_name   TEXT,
        recipient_city   TEXT,
        recipient_state  TEXT,
        geography        TEXT,
        primary_subject  TEXT,
        support_strategy TEXT,
        grant_amount     INTEGER,
        description      TEXT,
        expense_type     TEXT    DEFAULT 'Uncategorized',
        ai_explanation   TEXT,
        categorized_at   TEXT,
        inserted_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (object_id) REFERENCES irs_manifest(object_id)
    );

    CREATE INDEX IF NOT EXISTS idx_grants_object_id  ON irs_grants (object_id);
    CREATE INDEX IF NOT EXISTS idx_grants_ein        ON irs_grants (ein);
    CREATE INDEX IF NOT EXISTS idx_grants_tax_year   ON irs_grants (tax_year);
    CREATE INDEX IF NOT EXISTS idx_grants_expense    ON irs_grants (expense_type);
    CREATE INDEX IF NOT EXISTS idx_grants_uncat ON irs_grants (expense_type)
        WHERE expense_type = 'Uncategorized';

    -- ── AI cache: keyed by MD5(recipient_name + description) ─────────────────
    -- Prevents ever sending the same text to the API twice.
    CREATE TABLE IF NOT EXISTS ai_cache (
        cache_key       TEXT    PRIMARY KEY,
        recipient_name  TEXT,
        description     TEXT,
        expense_type    TEXT    NOT NULL,
        ai_explanation  TEXT,
        model_used      TEXT,
        tokens_used     INTEGER,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cache_type ON ai_cache (expense_type);

    """)
    conn.commit()
