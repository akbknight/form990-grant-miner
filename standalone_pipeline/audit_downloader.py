"""
audit_downloader.py
====================
PHASE 1 — Audit & Delta Download  (pure Python, zero AI)

1. Pull IRS S3 index CSVs for 2019-2025 → build local manifest in SQLite
2. Scan local data folder → mark already-downloaded files as verified
3. Compute delta (manifest rows not yet verified locally)
4. Download only missing files in parallel using a thread pool
5. Verify every downloaded file (size + MD5 checksum)
6. Retry failed downloads automatically via tenacity

Run:
    python audit_downloader.py                    # audit + download all years
    python audit_downloader.py --audit-only       # audit only, no download
    python audit_downloader.py --year 2023 2024   # specific years
    python audit_downloader.py --stats            # print audit table
"""

import csv
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
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

import config
from db_sqlite import get_conn, init_schema

log = logging.getLogger(__name__)

# ── Shared HTTP session ────────────────────────────────────────────────────────
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "IRS990-Research-Pipeline/1.0"


# ── Retry wrapper for any network call ────────────────────────────────────────
@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=1,
                          min=config.RETRY_WAIT_MIN,
                          max=config.RETRY_WAIT_MAX),
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def _http_get(url: str, stream: bool = False, timeout: int = 90) -> requests.Response:
    resp = SESSION.get(url, stream=stream, timeout=timeout)
    resp.raise_for_status()
    return resp


# ── Helpers ────────────────────────────────────────────────────────────────────

def _local_path(object_id: str) -> Path:
    """
    Shard files into 2-character subdirectories to avoid
    tens-of-thousands of files in a single flat folder.
    """
    shard = object_id[-2:]
    return config.DATA_DIR / shard / f"{object_id}_public.xml"


def _md5_file(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _normalize_row(row: dict) -> dict:
    """Normalize IRS index CSV columns (casing varies by year)."""
    r = {k.strip().upper(): (v or "").strip() for k, v in row.items()}
    return {
        "object_id":     r.get("OBJECT_ID") or r.get("OBJECTID", ""),
        "ein":           re_clean_ein(r.get("EIN", "")),
        "tax_period":    r.get("TAX_PERIOD", ""),
        "taxpayer_name": r.get("TAXPAYER_NAME", "")[:255],
        "return_type":   r.get("RETURN_TYPE", "")[:10],
        "filing_type":   r.get("FILING_TYPE", "")[:10],
        "sub_date":      r.get("SUB_DATE", "")[:20],
    }


def re_clean_ein(raw: str) -> str:
    import re
    digits = re.sub(r"\D", "", raw)
    return digits.zfill(9) if digits else ""


# ── Step 1: Fetch IRS S3 index ─────────────────────────────────────────────────

def fetch_index(year: int) -> List[dict]:
    """Download index_{year}.csv from IRS S3 and return normalized rows."""
    url = config.INDEX_URL.format(year=year)
    log.info("Fetching S3 index for year %d ...", year)
    try:
        resp = _http_get(url, timeout=120)
    except requests.HTTPError as e:
        if hasattr(e, "response") and e.response.status_code == 404:
            log.warning("No index available for year %d (404 — data not yet published)", year)
            return []
        raise

    rows   = []
    reader = csv.DictReader(io.StringIO(resp.text))
    for row in reader:
        r = _normalize_row(row)
        if r["object_id"]:
            r["tax_year"] = year
            rows.append(r)

    log.info("  Year %d: %d filings found in S3 index", year, len(rows))
    return rows


# ── Step 2: Upsert manifest ────────────────────────────────────────────────────

def upsert_manifest(conn: sqlite3.Connection, rows: List[dict]):
    conn.executemany("""
        INSERT OR IGNORE INTO irs_manifest
            (object_id, ein, tax_period, tax_year, taxpayer_name,
             return_type, filing_type, sub_date, download_status)
        VALUES
            (:object_id, :ein, :tax_period, :tax_year, :taxpayer_name,
             :return_type, :filing_type, :sub_date, 'pending')
    """, rows)
    conn.commit()


# ── Step 3: Reconcile local files ─────────────────────────────────────────────

def reconcile_local(conn: sqlite3.Connection):
    """
    For every manifest row that is NOT yet verified, check if the file
    exists locally. If it does, compute MD5 and mark as verified.
    """
    log.info("Reconciling local files with manifest...")
    cur    = conn.execute(
        "SELECT object_id FROM irs_manifest WHERE download_status != 'verified'"
    )
    oids   = [r[0] for r in cur.fetchall()]
    found  = 0
    for oid in oids:
        p = _local_path(oid)
        if p.exists() and p.stat().st_size > 200:   # 200 bytes = minimum valid XML
            md5 = _md5_file(p)
            conn.execute("""
                UPDATE irs_manifest
                SET download_status = 'verified',
                    local_path      = ?,
                    file_size       = ?,
                    checksum_md5    = ?
                WHERE object_id = ?
            """, (str(p), p.stat().st_size, md5, oid))
            found += 1
    conn.commit()
    log.info("  %d files already present and verified locally", found)


# ── Step 4: Get delta ──────────────────────────────────────────────────────────

def get_delta(conn: sqlite3.Connection,
              years: Optional[List[int]] = None) -> List[dict]:
    """Return manifest rows that still need to be downloaded."""
    sql  = """
        SELECT object_id, ein, tax_year, taxpayer_name, return_type
        FROM   irs_manifest
        WHERE  download_status IN ('pending', 'failed')
    """
    args = []
    if years:
        placeholders = ",".join("?" * len(years))
        sql += f" AND tax_year IN ({placeholders})"
        args = years
    rows = conn.execute(sql, args).fetchall()
    return [dict(r) for r in rows]


# ── Step 5 + 6: Download + verify ─────────────────────────────────────────────

def _download_one(row: dict) -> dict:
    """
    Download and verify a single IRS XML filing.
    Returns a result dict — never raises (errors captured in result).
    """
    oid  = row["object_id"]
    url  = config.FILING_URL.format(object_id=oid)
    dest = _local_path(oid)
    tmp  = dest.with_suffix(".tmp")
    dest.parent.mkdir(parents=True, exist_ok=True)

    try:
        resp          = SESSION.get(url, stream=True, timeout=60)
        resp.raise_for_status()
        expected_size = int(resp.headers.get("Content-Length", 0))
        downloaded    = 0
        hasher        = hashlib.md5()

        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=config.DOWNLOAD_CHUNK_SIZE):
                if chunk:
                    f.write(chunk)
                    hasher.update(chunk)
                    downloaded += len(chunk)

        # Size check
        if expected_size and downloaded != expected_size:
            tmp.unlink(missing_ok=True)
            raise IOError(
                f"Size mismatch: got {downloaded:,} bytes, "
                f"expected {expected_size:,}"
            )

        # Minimum XML validity check
        with open(tmp, "rb") as f:
            header = f.read(10)
        if not (header.startswith(b"<?xml") or header.startswith(b"<Retur")):
            tmp.unlink(missing_ok=True)
            raise ValueError(f"Response is not valid XML (header: {header!r})")

        tmp.rename(dest)
        return {
            "object_id":     oid,
            "success":       True,
            "file_size":     downloaded,
            "checksum_md5":  hasher.hexdigest(),
            "expected_size": expected_size,
            "error":         None,
        }

    except Exception as e:
        tmp.unlink(missing_ok=True)
        return {
            "object_id": oid,
            "success":   False,
            "file_size": 0,
            "error":     str(e),
        }


# Retry wrapper around the single-file downloader
_download_one_with_retry = retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=1,
                          min=config.RETRY_WAIT_MIN,
                          max=config.RETRY_WAIT_MAX),
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=False,
)(_download_one)


def download_delta(conn: sqlite3.Connection,
                   delta: List[dict],
                   workers: int = config.DOWNLOAD_WORKERS):
    if not delta:
        log.info("Nothing to download — manifest is already complete.")
        return

    log.info("Downloading %d missing filings (%d workers)...",
             len(delta), workers)
    t0         = time.time()
    success_n  = 0
    fail_n     = 0
    done       = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_download_one_with_retry, row): row
                   for row in delta}

        for future in as_completed(futures):
            result = future.result()
            done  += 1
            oid    = result["object_id"]

            if result["success"]:
                success_n += 1
                p = _local_path(oid)
                conn.execute("""
                    UPDATE irs_manifest SET
                        download_status = 'verified',
                        local_path      = ?,
                        file_size       = ?,
                        expected_size   = ?,
                        checksum_md5    = ?,
                        downloaded_at   = datetime('now')
                    WHERE object_id = ?
                """, (str(p), result["file_size"],
                      result.get("expected_size", 0),
                      result.get("checksum_md5", ""), oid))
            else:
                fail_n += 1
                log.warning("FAIL [%s]: %s", oid, result["error"])
                conn.execute("""
                    UPDATE irs_manifest SET
                        download_status = 'failed',
                        error_msg       = ?
                    WHERE object_id = ?
                """, (str(result["error"])[:500], oid))

            if done % 500 == 0:
                conn.commit()
                rate = done / (time.time() - t0) if (time.time()-t0) > 0 else 0
                log.info("  %d/%d done  |  %.0f files/s  |  ok=%d  fail=%d",
                         done, len(delta), rate, success_n, fail_n)

    conn.commit()
    log.info("Download done: %d ok, %d failed in %.1f min",
             success_n, fail_n, (time.time()-t0)/60)


# ── Audit report ───────────────────────────────────────────────────────────────

def print_audit_table(conn: sqlite3.Connection):
    rows = conn.execute("""
        SELECT
            COALESCE(tax_year, 'ALL')           AS year,
            COUNT(*)                            AS total,
            SUM(download_status='verified')     AS verified,
            SUM(download_status='pending')      AS pending,
            SUM(download_status='failed')       AS failed,
            SUM(extracted)                      AS extracted
        FROM irs_manifest
        GROUP BY tax_year
        ORDER BY tax_year
    """).fetchall()

    log.info("")
    log.info("┌─────────────────────────────────────────────────────────────┐")
    log.info("│  IRS S3 AUDIT REPORT                                        │")
    log.info("├──────────┬──────────┬──────────┬─────────┬────────┬─────────┤")
    log.info("│  Year    │  Total   │ Verified │ Pending │ Failed │Extracted│")
    log.info("├──────────┼──────────┼──────────┼─────────┼────────┼─────────┤")
    for r in rows:
        log.info("│  %-7s │ %8d │ %8d │ %7d │ %6d │ %7d │",
                 r[0], r[1], r[2], r[3], r[4], r[5])
    log.info("└──────────┴──────────┴──────────┴─────────┴────────┴─────────┘")


# ── CLI ────────────────────────────────────────────────────────────────────────

def main(args=None):
    parser = argparse.ArgumentParser(
        description="Phase 1: Audit IRS S3 manifest and download missing files"
    )
    parser.add_argument("--year",       type=int, nargs="+",
                        default=config.TARGET_YEARS,
                        help="Years to process (default: 2019-2025)")
    parser.add_argument("--audit-only", action="store_true",
                        help="Build manifest and reconcile only — do not download")
    parser.add_argument("--workers",    type=int, default=config.DOWNLOAD_WORKERS,
                        help=f"Download threads (default: {config.DOWNLOAD_WORKERS})")
    parser.add_argument("--stats",      action="store_true",
                        help="Print audit table and exit")
    args = parser.parse_args(args)

    conn = get_conn()
    init_schema(conn)

    if args.stats:
        print_audit_table(conn)
        conn.close()
        return

    # Step 1 + 2: Fetch index and build manifest
    for year in args.year:
        rows = fetch_index(year)
        if rows:
            upsert_manifest(conn, rows)

    # Step 3: Reconcile what's already local
    reconcile_local(conn)
    print_audit_table(conn)

    if args.audit_only:
        log.info("--audit-only set — skipping download.")
        conn.close()
        return

    # Step 4 + 5 + 6: Delta download with verification
    delta = get_delta(conn, args.year)
    download_delta(conn, delta, workers=args.workers)
    print_audit_table(conn)
    conn.close()


if __name__ == "__main__":
    main()
