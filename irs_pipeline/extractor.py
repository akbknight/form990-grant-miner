"""
irs_pipeline/extractor.py
=========================
Phase 2: parse verified XML filings and upsert them into PostgreSQL.
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional

from irs_pipeline import config
from irs_pipeline.db_sqlite import get_sqlite_conn, init_sqlite_schema
from irs_db.loader import get_conn as get_pg_conn, insert_grants, upsert_filings
from irs_db.parser import parse_filing

log = logging.getLogger(__name__)


def get_unextracted(
    conn: sqlite3.Connection,
    years: Optional[List[int]] = None,
    limit: Optional[int] = None,
) -> List[dict]:
    """Return verified manifest rows that still need extraction."""
    sql = """
        SELECT object_id, local_path, ein, tax_year, return_type
        FROM   irs_manifest
        WHERE  download_status = 'verified'
        AND    extracted = 0
        AND    local_path IS NOT NULL
    """
    params: list[object] = []
    if years:
        placeholders = ",".join("?" * len(years))
        sql += f" AND tax_year IN ({placeholders})"
        params.extend(years)
    if limit:
        sql += f" LIMIT {int(limit)}"

    rows = conn.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def parse_one(row: dict) -> dict:
    """Parse a single XML file into filing and grant payloads."""
    object_id = row["object_id"]
    path = Path(row["local_path"])
    try:
        xml_bytes = path.read_bytes()
        filing, grants = parse_filing(xml_bytes, f"s3:{object_id}", path.name)
        return {
            "object_id": object_id,
            "filing": filing,
            "grants": grants,
            "error": None,
        }
    except Exception as exc:  # pragma: no cover - passthrough for operational logs
        return {
            "object_id": object_id,
            "filing": None,
            "grants": [],
            "error": str(exc),
        }


def mark_extracted(sqlite_conn: sqlite3.Connection, object_ids: List[str]) -> None:
    """Mark manifest rows as extracted."""
    sqlite_conn.executemany(
        "UPDATE irs_manifest SET extracted=1, extracted_at=datetime('now') WHERE object_id=?",
        [(object_id,) for object_id in object_ids],
    )
    sqlite_conn.commit()


def mark_extract_error(sqlite_conn: sqlite3.Connection, object_id: str, error: str) -> None:
    """Persist an extraction error on the manifest row."""
    sqlite_conn.execute(
        "UPDATE irs_manifest SET error_msg=? WHERE object_id=?",
        (error[:500], object_id),
    )
    sqlite_conn.commit()


def run_extraction(
    years: Optional[List[int]] = None,
    workers: int = 4,
    limit: Optional[int] = None,
) -> None:
    """Extract pending XML filings into PostgreSQL."""
    sqlite_conn = get_sqlite_conn()
    init_sqlite_schema(sqlite_conn)
    pg_conn = get_pg_conn()

    try:
        pending = get_unextracted(sqlite_conn, years, limit)
        if not pending:
            log.info("Nothing to extract - all verified files already extracted.")
            return

        log.info("Extracting %d XML files into PostgreSQL...", len(pending))
        started_at = time.time()
        done = 0
        filings_total = 0
        grants_total = 0
        errors = 0

        filings_buffer: List[dict] = []
        grants_buffer: List[dict] = []
        completed_ids: List[str] = []

        def flush() -> None:
            nonlocal filings_total, grants_total
            if filings_buffer:
                filings_total += upsert_filings(pg_conn, filings_buffer)
                filings_buffer.clear()
            if grants_buffer:
                grants_total += insert_grants(pg_conn, grants_buffer)
                grants_buffer.clear()
            if completed_ids:
                mark_extracted(sqlite_conn, completed_ids)
                completed_ids.clear()

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(parse_one, row): row for row in pending}
            for future in as_completed(futures):
                result = future.result()
                done += 1

                if result["error"]:
                    errors += 1
                    log.debug("Parse error %s: %s", result["object_id"], result["error"])
                    mark_extract_error(sqlite_conn, result["object_id"], result["error"])
                    continue

                if result["filing"]:
                    filings_buffer.append(result["filing"])
                grants_buffer.extend(result["grants"])
                completed_ids.append(result["object_id"])

                if len(grants_buffer) >= config.EXTRACT_BATCH_SIZE:
                    flush()

                if done % 1000 == 0:
                    flush()
                    elapsed = time.time() - started_at
                    rate = done / elapsed if elapsed else 0
                    log.info(
                        "  %d/%d parsed  |  %.0f files/s  |  filings=%d grants=%d errors=%d",
                        done,
                        len(pending),
                        rate,
                        filings_total,
                        grants_total,
                        errors,
                    )

        flush()

        elapsed = time.time() - started_at
        log.info("=" * 60)
        log.info("Extraction complete in %.1f min", elapsed / 60)
        log.info("  Files parsed : %d", done)
        log.info("  Filings      : %d", filings_total)
        log.info("  Grants       : %d", grants_total)
        log.info("  Errors       : %d", errors)
        log.info("=" * 60)
    finally:
        pg_conn.close()
        sqlite_conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 2: extract and load verified XML files")
    parser.add_argument("--year", type=int, nargs="+", default=None, help="Years to extract")
    parser.add_argument("--workers", type=int, default=4, help="Parallel parse threads")
    parser.add_argument("--limit", type=int, default=None, help="Max files to process")
    args = parser.parse_args()

    run_extraction(years=args.year, workers=args.workers, limit=args.limit)


if __name__ == "__main__":
    main()
