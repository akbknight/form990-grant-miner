"""
sqlite_to_postgres.py
=====================
Transfer a local SQLite grant table into PostgreSQL with safer defaults.

By default the script refuses to replace an existing target table.
Use --replace if you explicitly want the destination rebuilt.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import time
from pathlib import Path

import psycopg2
import psycopg2.extras

from project_utils.paths import WAREHOUSE_DB_PATH
from project_utils.security import redact_dsn, require_env

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_SQLITE_PATH = WAREHOUSE_DB_PATH
DEFAULT_SOURCE_TABLE = "irs_grants_2023_2024"
DEFAULT_TARGET_TABLE = "irs_grants_2023_2024"
BATCH_SIZE = 2000


def build_schema_sql(table_name: str, replace: bool) -> str:
    statements = []
    if replace:
        statements.append(f"DROP TABLE IF EXISTS {table_name};")

    statements.append(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id               BIGSERIAL PRIMARY KEY,
            object_id        TEXT,
            ein              TEXT,
            tax_year         SMALLINT,
            grantmaker_name  TEXT,
            grantmaker_state TEXT,
            recipient_name   TEXT,
            recipient_city   TEXT,
            recipient_state  TEXT,
            geography        TEXT,
            primary_subject  TEXT,
            support_strategy TEXT,
            grant_amount     BIGINT,
            description      TEXT,
            expense_type     TEXT DEFAULT 'Uncategorized',
            inserted_at      TIMESTAMPTZ DEFAULT now()
        );
        """
    )
    return "\n".join(statements)


def validate_identifier(value: str, label: str) -> str:
    """Restrict table identifiers to plain SQL-safe names."""
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value or ""):
        raise SystemExit(f"Invalid {label}: {value!r}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="Load SQLite grant data into PostgreSQL.")
    parser.add_argument("--sqlite-path", default=str(DEFAULT_SQLITE_PATH), help="Path to the SQLite file")
    parser.add_argument("--source-table", default=DEFAULT_SOURCE_TABLE, help="Source SQLite table")
    parser.add_argument("--target-table", default=DEFAULT_TARGET_TABLE, help="Target PostgreSQL table")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Drop and recreate the target table before loading",
    )
    args = parser.parse_args()

    dsn = require_env(
        "IRS_DB_DSN",
        example="IRS_DB_DSN=postgresql://postgres:change_me@127.0.0.1:5432/irs990",
    )
    sqlite_path = Path(args.sqlite_path).resolve()
    source_table = validate_identifier(args.source_table, "source table")
    target_table = validate_identifier(args.target_table, "target table")

    if not sqlite_path.exists():
        raise SystemExit(f"SQLite file not found: {sqlite_path}")

    print(f"Connecting to PostgreSQL {redact_dsn(dsn)}")
    pg = psycopg2.connect(dsn)
    pg.autocommit = False

    print(f"Preparing target table {target_table}")
    with pg.cursor() as cur:
        cur.execute(build_schema_sql(target_table, args.replace))
    pg.commit()

    sq = sqlite3.connect(str(sqlite_path))
    sq.row_factory = sqlite3.Row

    total = sq.execute(f"SELECT COUNT(*) FROM {source_table}").fetchone()[0]
    print(f"Transferring {total:,} rows from {source_table}")

    columns = [
        "object_id",
        "ein",
        "tax_year",
        "grantmaker_name",
        "grantmaker_state",
        "recipient_name",
        "recipient_city",
        "recipient_state",
        "geography",
        "primary_subject",
        "support_strategy",
        "grant_amount",
        "description",
        "expense_type",
    ]
    insert_sql = f"INSERT INTO {target_table} ({','.join(columns)}) VALUES %s"

    started_at = time.time()
    done = 0
    cursor = sq.execute(f"SELECT {','.join(columns)} FROM {source_table}")

    while True:
        rows = cursor.fetchmany(BATCH_SIZE)
        if not rows:
            break

        batch = [tuple(row) for row in rows]
        with pg.cursor() as cur:
            psycopg2.extras.execute_values(cur, insert_sql, batch, page_size=BATCH_SIZE)
        pg.commit()

        done += len(batch)
        if done % 100000 == 0:
            elapsed = time.time() - started_at
            rate = done / elapsed if elapsed else 0
            print(f"  {done:>10,} / {total:,} | {rate:.0f} rows/sec")

    sq.close()

    print("Building indexes...")
    with pg.cursor() as cur:
        cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{target_table}_tax_year ON {target_table} (tax_year);")
        cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{target_table}_expense_type ON {target_table} (expense_type);")
        cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{target_table}_grantmaker ON {target_table} (grantmaker_name);")
        cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{target_table}_recipient ON {target_table} (recipient_name);")
        cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{target_table}_grant_amount ON {target_table} (grant_amount);")
        cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{target_table}_ein ON {target_table} (ein);")
    pg.commit()

    with pg.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {target_table}")
        pg_count = cur.fetchone()[0]

    pg.close()
    print("=" * 55)
    print(f"Transfer complete in {(time.time() - started_at) / 60:.1f} min")
    print(f"Rows in PostgreSQL: {pg_count:,}")
    print("=" * 55)


if __name__ == "__main__":
    main()
