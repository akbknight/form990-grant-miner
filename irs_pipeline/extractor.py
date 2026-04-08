"""
irs_pipeline/extractor.py
==========================
PHASE 2 — Extraction & Storage  (pure Python, zero AI)

Reads verified XML files from the manifest, parses them using the
existing irs_db/parser.py logic, and upserts into PostgreSQL.

Run:
    .venv312\\Scripts\\python.exe -m irs_pipeline.extractor
    .venv312\\Scripts\\python.exe -m irs_pipeline.extractor --year 2023
    .venv312\\Scripts\\python.exe -m irs_pipeline.extractor --workers 4
    .venv312\\Scripts\\python.exe -m irs_pipeline.extractor --limit 10000
"""

import logging
import sqlite3
import sys
import time
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional

import psycopg2
import psycopg2.extras
from psycopg2.extras import execute_values

from irs_pipeline import config
from irs_pipeline.db_sqlite import get_sqlite_conn, init_sqlite_schema
from irs_db.parser import parse_filing
from irs_db.loader import get_conn as get_pg_conn, upsert_filings, insert_grants

log = logging.getLogger(__name__)


# ── Get unextracted verified files from manifest ───────────────────────────────

def get_unextracted(conn: sqlite3.Connection,
                    years: Optional[List[int]] = None,
                    limit: Optional[int] = None) -> List[dict]:
    sql = """
        SELECT object_id, local_path, ein, tax_year, return_type
        FROM   irs_manifest
        WHERE  download_status = 'verified'
        AND    extracted = 0
        AND    local_path IS NOT NULL
    """
    params = []
    if years:
        placeholders = ",".join("?" * len(years))
        sql += f" AND tax_year IN ({placeholders})"
        params.extend(years)
    if limit:
        sql += f" LIMIT {int(limit)}"

    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# ── Parse and buffer ───────────────────────────────────────────────────────────

def parse_one(row: dict) -> dict:
    """Parse a single XML file. Returns {filing, grants, object_id, error}."""
    oid  = row["object_id"]
    path = Path(row["local_path"])
    try:
        xml_bytes = path.read_bytes()
        filing, grants = parse_filing(xml_bytes, f"s3:{oid}", path.name)
        return {"object_id": oid, "filing": filing,
                "grants": grants, "error": None}
    except Exception as e:
        return {"object_id": oid, "filing": None,
                "grants": [], "error": str(e)}


# ── Mark extracted in SQLite ───────────────────────────────────────────────────

def mark_extracted(sqlite_conn: sqlite3.Connection, object_ids: List[str]):
    sqlite_conn.executemany(
        "UPDATE irs_manifest SET extracted=1, extracted_at=datetime('now') "
        "WHERE object_id=?",
        [(oid,) for oid in object_ids]
    )
    sqlite_conn.commit()


def mark_extract_error(sqlite_conn: sqlite3.Connection,
                       object_id: str, error: str):
    sqlite_conn.execute(
        "UPDATE irs_manifest SET error_msg=? WHERE object_id=?",
        (error[:500], object_id)
    )
    sqlite_conn.commit()


# ── Main extraction loop ───────────────────────────────────────────────────────

def run_extraction(years: Optional[List[int]] = None,
                   workers: int = 4,
                   limit: Optional[int] = None):
    sqlite_conn = get_sqlite_conn()
    init_sqlite_schema(sqlite_conn)
    pg_conn     = get_pg_conn()

    pending = get_unextracted(sqlite_conn, years, limit)
    if not pending:
        log.info("Nothing to extract — all verified files already extracted.")
        return

    log.info("Extracting %d XML files into PostgreSQL...", len(pending))
    t0            = time.time()
    done          = 0
    filings_total = 0
    grants_total  = 0
    errors        = 0

    filings_buf: List[dict] = []
    grants_buf:  List[dict] = []
    done_ids:    List[str]  = []

    def flush():
        nonlocal filings_total, grants_total
        if filings_buf:
            filings_total += upsert_filings(pg_conn, filings_buf)
            filings_buf.clear()
        if grants_buf:
            grants_total += insert_grants(pg_conn, grants_buf)
            grants_buf.clear()
        if done_ids:
            mark_extracted(sqlite_conn, done_ids)
            done_ids.clear()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(parse_one, row): row for row in pending}
        for future in as_completed(futures):
            result = future.result()
            done  += 1

            if result["error"]:
                errors += 1
                log.debug("Parse error %s: %s",
                           result["object_id"], result["error"])
                mark_extract_error(sqlite_conn,
                                   result["object_id"], result["error"])
                continue

            if result["filing"]:
                filings_buf.append(result["filing"])
            grants_buf.extend(result["grants"])
            done_ids.append(result["object_id"])

            # Flush when buffers are full
            if len(grants_buf) >= config.EXTRACT_BATCH_SIZE:
                flush()

            if done % 1000 == 0:
                flush()
                elapsed = time.time() - t0
                rate    = done / elapsed
                log.info("  %d/%d parsed  |  %.0f files/s  |  "
                         "filings=%d grants=%d errors=%d",
                         done, len(pending), rate,
                         filings_total, grants_total, errors)

    # Final flush
    flush()

    elapsed = time.time() - t0
    log.info("=" * 60)
    log.info("Extraction complete in %.1f min", elapsed / 60)
    log.info("  Files parsed : %d", done)
    log.info("  Filings      : %d", filings_total)
    log.info("  Grants       : %d", grants_total)
    log.info("  Errors       : %d", errors)
    log.info("=" * 60)

    pg_conn.close()
    sqlite_conn.close()


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Phase 2: Extract & load into PostgreSQL")
    parser.add_argument("--year",    type=int, nargs="+",
                        default=None, help="Years to extract (default: all)")
    parser.add_argument("--workers", type=int, default=4,
                        help="Parallel parse threads (default: 4)")
    parser.add_argument("--limit",   type=int, default=None,
                        help="Max files to process (for testing)")
    args = parser.parse_args()
    run_extraction(years=args.year, workers=args.workers, limit=args.limit)


if __name__ == "__main__":
    main()
