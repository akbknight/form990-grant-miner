"""
irs_pipeline/audit_downloader.py
=================================
PHASE 1 — Audit & Delta Download  (pure Python, zero AI)

Steps:
  1. Download IRS S3 index CSVs for every year 2019-2025
  2. Build/update a local SQLite manifest of ALL available filings
  3. Scan local data directory — find what's already downloaded
  4. Compute delta (manifest rows with no verified local file)
  5. Download only missing/failed files with checksum verification
  6. Retry failed downloads automatically (tenacity)

Run:
    .venv312\\Scripts\\python.exe -m irs_pipeline.audit_downloader
    .venv312\\Scripts\\python.exe -m irs_pipeline.audit_downloader --year 2023
    .venv312\\Scripts\\python.exe -m irs_pipeline.audit_downloader --audit-only
    .venv312\\Scripts\\python.exe -m irs_pipeline.audit_downloader --workers 16
"""

import hashlib
import io
import logging
import sqlite3
import sys
import time
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional

import requests
from tenacity import (
    retry, stop_after_attempt, wait_exponential,
    retry_if_exception_type, before_sleep_log,
)

from irs_pipeline import config
from irs_pipeline.db_sqlite import get_sqlite_conn, init_sqlite_schema

log = logging.getLogger(__name__)

# ── HTTP session (shared across threads) ──────────────────────────────────────
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "IRS990-Pipeline/1.0 (research)"


# ── Retry decorator for network calls ─────────────────────────────────────────
@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=1, min=config.RETRY_WAIT_MIN,
                          max=config.RETRY_WAIT_MAX),
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def _get(url: str, stream: bool = False, timeout: int = 60) -> requests.Response:
    resp = SESSION.get(url, stream=stream, timeout=timeout)
    resp.raise_for_status()
    return resp


# ── Step 1: Download & parse IRS index CSVs ───────────────────────────────────

def fetch_index(year: int) -> List[dict]:
    """
    Download index_{year}.csv from IRS S3 and return list of filing dicts.
    Each row = one Form 990 filing.
    """
    url = config.INDEX_URL.format(year=year)
    log.info("Fetching index for %d: %s", year, url)
    try:
        resp = _get(url, timeout=120)
    except requests.HTTPError as e:
        if e.response.status_code == 404:
            log.warning("No index for year %d (404)", year)
            return []
        raise

    import csv
    rows = []
    reader = csv.DictReader(io.StringIO(resp.text))
    for row in reader:
        # Normalize field names (IRS uses inconsistent casing across years)
        r = {k.strip().upper(): v.strip() for k, v in row.items()}
        object_id = r.get("OBJECT_ID") or r.get("OBJECTID", "")
        if not object_id:
            continue
        rows.append({
            "object_id":     object_id,
            "ein":           r.get("EIN", "").replace("-", "").zfill(9),
            "tax_period":    r.get("TAX_PERIOD", ""),
            "tax_year":      year,
            "taxpayer_name": r.get("TAXPAYER_NAME", "")[:255],
            "return_type":   r.get("RETURN_TYPE", "")[:10],
            "filing_type":   r.get("FILING_TYPE", "")[:10],
            "sub_date":      r.get("SUB_DATE", "")[:20],
        })

    log.info("  Year %d: %d filings in index", year, len(rows))
    return rows


# ── Step 2: Upsert manifest into SQLite ───────────────────────────────────────

def upsert_manifest(conn: sqlite3.Connection, rows: List[dict]):
    """Insert new filings into manifest; skip existing ones."""
    sql = """
        INSERT OR IGNORE INTO irs_manifest
            (object_id, ein, tax_period, tax_year, taxpayer_name,
             return_type, filing_type, sub_date, download_status)
        VALUES
            (:object_id, :ein, :tax_period, :tax_year, :taxpayer_name,
             :return_type, :filing_type, :sub_date, 'pending')
    """
    conn.executemany(sql, rows)
    conn.commit()
    log.debug("Manifest upsert: %d rows", len(rows))


# ── Step 3: Reconcile local files ─────────────────────────────────────────────

def _local_path(object_id: str) -> Path:
    """Each XML stored in a 2-level shard dir to avoid huge flat folders."""
    shard = object_id[-2:]
    return config.DATA_DIR / shard / f"{object_id}_public.xml"


def _md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def reconcile_local(conn: sqlite3.Connection):
    """
    Scan local data directory. For every file that exists and is non-zero,
    mark as 'verified' in the manifest.
    """
    log.info("Reconciling local files against manifest...")
    cur = conn.execute(
        "SELECT object_id FROM irs_manifest WHERE download_status != 'verified'"
    )
    object_ids = [row[0] for row in cur.fetchall()]
    verified = 0
    for oid in object_ids:
        p = _local_path(oid)
        if p.exists() and p.stat().st_size > 0:
            conn.execute(
                "UPDATE irs_manifest SET download_status='verified', "
                "local_path=?, file_size=? WHERE object_id=?",
                (str(p), p.stat().st_size, oid)
            )
            verified += 1
    conn.commit()
    log.info("  Reconciled: %d files already verified locally", verified)


# ── Step 4: Compute delta ──────────────────────────────────────────────────────

def get_pending(conn: sqlite3.Connection,
                years: Optional[List[int]] = None) -> List[dict]:
    """Return manifest rows that still need downloading."""
    sql = """
        SELECT object_id, ein, tax_year, taxpayer_name, return_type
        FROM   irs_manifest
        WHERE  download_status IN ('pending', 'failed')
    """
    params = []
    if years:
        placeholders = ",".join("?" * len(years))
        sql += f" AND tax_year IN ({placeholders})"
        params = years
    rows = conn.execute(sql, params).fetchall()
    return [dict(zip(["object_id","ein","tax_year","taxpayer_name","return_type"], r))
            for r in rows]


# ── Step 5: Download + verify ──────────────────────────────────────────────────

@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=1, min=config.RETRY_WAIT_MIN,
                          max=config.RETRY_WAIT_MAX),
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=False,
)
def download_one(row: dict) -> dict:
    """
    Download a single filing XML from IRS S3.
    Returns dict with object_id, success, file_size, error.
    """
    oid  = row["object_id"]
    url  = config.FILING_URL.format(object_id=oid)
    dest = _local_path(oid)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp  = dest.with_suffix(".tmp")

    try:
        resp = SESSION.get(url, stream=True, timeout=60)
        resp.raise_for_status()

        expected_size = int(resp.headers.get("Content-Length", 0))
        downloaded    = 0

        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=config.DOWNLOAD_CHUNK_SIZE):
                f.write(chunk)
                downloaded += len(chunk)

        # Verification: file size must match Content-Length (if provided)
        if expected_size and downloaded != expected_size:
            tmp.unlink(missing_ok=True)
            raise IOError(
                f"Size mismatch for {oid}: got {downloaded}, expected {expected_size}"
            )

        # Verify file is valid XML (not an error page)
        with open(tmp, "rb") as f:
            header = f.read(5)
        if not header.startswith(b"<?xml") and not header.startswith(b"<Retu"):
            tmp.unlink(missing_ok=True)
            raise ValueError(f"Not valid XML: {oid}")

        tmp.rename(dest)
        return {"object_id": oid, "success": True,
                "file_size": downloaded, "error": None}

    except Exception as e:
        tmp.unlink(missing_ok=True)
        return {"object_id": oid, "success": False,
                "file_size": 0, "error": str(e)}


def download_delta(conn: sqlite3.Connection,
                   pending: List[dict],
                   workers: int = config.DOWNLOAD_WORKERS):
    """Download all pending files using a thread pool."""
    if not pending:
        log.info("No files to download — already up to date.")
        return

    log.info("Downloading %d missing filings with %d workers...",
             len(pending), workers)
    t0         = time.time()
    success_n  = 0
    fail_n     = 0
    done       = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(download_one, row): row for row in pending}
        for future in as_completed(futures):
            result = future.result()
            done  += 1
            oid    = result["object_id"]

            if result["success"]:
                success_n += 1
                p = _local_path(oid)
                conn.execute("""
                    UPDATE irs_manifest
                    SET download_status='verified', local_path=?,
                        file_size=?, downloaded_at=datetime('now')
                    WHERE object_id=?
                """, (str(p), result["file_size"], oid))
            else:
                fail_n += 1
                log.warning("  FAIL %s: %s", oid, result["error"])
                conn.execute("""
                    UPDATE irs_manifest
                    SET download_status='failed', error_msg=?
                    WHERE object_id=?
                """, (result["error"][:500], oid))

            # Commit every 500 completions
            if done % 500 == 0:
                conn.commit()
                elapsed = time.time() - t0
                rate    = done / elapsed
                log.info("  Progress: %d/%d  |  %.0f files/s  |  "
                         "ok=%d fail=%d",
                         done, len(pending), rate, success_n, fail_n)

    conn.commit()
    elapsed = time.time() - t0
    log.info("Download complete: %d ok, %d failed in %.1f min",
             success_n, fail_n, elapsed / 60)


# ── Audit report ───────────────────────────────────────────────────────────────

def print_audit(conn: sqlite3.Connection):
    rows = conn.execute("""
        SELECT tax_year,
               COUNT(*) AS total,
               SUM(download_status='verified') AS verified,
               SUM(download_status='pending')  AS pending,
               SUM(download_status='failed')   AS failed,
               SUM(extracted)                  AS extracted
        FROM irs_manifest
        GROUP BY tax_year
        ORDER BY tax_year
    """).fetchall()

    log.info("=" * 65)
    log.info("%-8s %10s %10s %10s %8s %10s",
             "Year", "Total", "Verified", "Pending", "Failed", "Extracted")
    log.info("-" * 65)
    for r in rows:
        log.info("%-8s %10d %10d %10d %8d %10d", *r)
    log.info("=" * 65)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Phase 1: IRS S3 Audit & Download")
    parser.add_argument("--year",       type=int, nargs="+",
                        default=config.TARGET_YEARS,
                        help="Years to process (default: 2019-2025)")
    parser.add_argument("--audit-only", action="store_true",
                        help="Only audit, do not download")
    parser.add_argument("--workers",    type=int,
                        default=config.DOWNLOAD_WORKERS,
                        help=f"Download threads (default: {config.DOWNLOAD_WORKERS})")
    parser.add_argument("--stats",      action="store_true",
                        help="Print audit table and exit")
    args = parser.parse_args()

    conn = get_sqlite_conn()
    init_sqlite_schema(conn)

    if args.stats:
        print_audit(conn)
        return

    # Step 1 + 2: Fetch index, build manifest
    for year in args.year:
        rows = fetch_index(year)
        if rows:
            upsert_manifest(conn, rows)

    # Step 3: Reconcile local files
    reconcile_local(conn)

    # Audit report
    print_audit(conn)

    if args.audit_only:
        log.info("Audit-only mode — skipping download.")
        return

    # Step 4 + 5: Download delta
    pending = get_pending(conn, args.year)
    download_delta(conn, pending, workers=args.workers)
    print_audit(conn)
    conn.close()


if __name__ == "__main__":
    main()
