"""
audit_downloader.py
====================
PHASE 1 -- Audit & Delta Download  (pure Python, zero AI)

IRS NOTE (2025): The old S3 bucket individual-XML URLs no longer work.
The IRS now distributes Form 990 data as ZIP archives at:
    https://apps.irs.gov/pub/epostcard/990/xml/{year}/

This phase:
1. Fetches the IRS index CSV for each year  -> builds local manifest in SQLite
2. Discovers the ZIP archive list for each year from the IRS downloads page
3. Scans local data folder -> marks already-extracted files as verified
4. Downloads missing ZIP archives in parallel
5. Extracts individual XML files from each ZIP directly into the data folder
6. Verifies every extracted file (size + MD5 checksum)

Run:
    python audit_downloader.py                    # audit + download all years
    python audit_downloader.py --audit-only       # build manifest only, no download
    python audit_downloader.py --year 2023 2024   # specific years
    python audit_downloader.py --stats            # print audit table
    python audit_downloader.py --from-local FOLDER  # extract from existing local ZIPs
"""

import csv
import hashlib
import io
import logging
import re
import sqlite3
import sys
import time
import argparse
import zipfile
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
SESSION.headers["User-Agent"] = "IRS990-Research-Pipeline/2.0"


# ── Retry wrapper ──────────────────────────────────────────────────────────────
@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=1,
                          min=config.RETRY_WAIT_MIN,
                          max=config.RETRY_WAIT_MAX),
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def _http_get(url: str, stream: bool = False, timeout: int = 120) -> requests.Response:
    resp = SESSION.get(url, stream=stream, timeout=timeout)
    resp.raise_for_status()
    return resp


# ── Helpers ────────────────────────────────────────────────────────────────────

def _local_path(object_id: str) -> Path:
    """Shard files into 2-char subdirectories (avoids massive flat folders)."""
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
    digits = re.sub(r"\D", "", r.get("EIN", ""))
    return {
        "object_id":     r.get("OBJECT_ID") or r.get("OBJECTID", ""),
        "ein":           digits.zfill(9) if digits else "",
        "tax_period":    r.get("TAX_PERIOD", ""),
        "taxpayer_name": r.get("TAXPAYER_NAME", "")[:255],
        "return_type":   r.get("RETURN_TYPE", "")[:10],
        "filing_type":   r.get("FILING_TYPE", "")[:10],
        "sub_date":      r.get("SUB_DATE", "")[:20],
    }


# ── Step 1: Fetch IRS index CSV ────────────────────────────────────────────────

def fetch_index(year: int) -> List[dict]:
    """Download index_{year}.csv from apps.irs.gov and return normalized rows."""
    url = config.INDEX_URL.format(year=year)
    log.info("Fetching index for year %d ...", year)
    try:
        resp = _http_get(url, timeout=120)
    except requests.HTTPError as e:
        if hasattr(e, "response") and e.response is not None and e.response.status_code == 404:
            log.warning("No index for year %d (404 -- not yet published)", year)
            return []
        raise

    rows   = []
    reader = csv.DictReader(io.StringIO(resp.text))
    for row in reader:
        r = _normalize_row(row)
        if r["object_id"]:
            r["tax_year"] = year
            rows.append(r)

    log.info("  Year %d: %d filings in index", year, len(rows))
    return rows


# ── Step 2: Discover ZIP files for a year ─────────────────────────────────────

def discover_zip_list(year: int) -> List[str]:
    """
    Scrape the IRS downloads page to get the list of ZIP filenames for a year.
    Returns list of ZIP filenames (not full URLs).
    """
    try:
        resp = _http_get(config.IRS_DOWNLOADS_PAGE, timeout=60)
    except Exception as e:
        log.warning("Could not fetch IRS downloads page: %s", e)
        return []

    # Find all ZIP URLs for this specific year
    pattern = rf'apps\.irs\.gov/pub/epostcard/990/xml/{year}/([^"\'  \n]+\.zip)'
    matches = re.findall(pattern, resp.text)
    zips = sorted(set(matches))
    log.info("  Year %d: found %d ZIP archives on IRS website", year, len(zips))
    return zips


# ── Step 3: Upsert manifest ────────────────────────────────────────────────────

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


# ── Step 4: Reconcile local files ─────────────────────────────────────────────

def reconcile_local(conn: sqlite3.Connection):
    """
    For every manifest row not yet verified, check if the XML file already
    exists locally (e.g. from a previous run or manually extracted ZIP).
    """
    log.info("Reconciling local files with manifest...")
    cur  = conn.execute(
        "SELECT object_id FROM irs_manifest WHERE download_status != 'verified'"
    )
    oids  = [r[0] for r in cur.fetchall()]
    found = 0
    for oid in oids:
        p = _local_path(oid)
        if p.exists() and p.stat().st_size > 200:
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


# ── Step 5: Extract from local ZIP files ──────────────────────────────────────

def extract_from_local_zips(conn: sqlite3.Connection, zip_folder: Path) -> int:
    """
    Scan a folder for .zip files, extract XML files from each one,
    and mark them as verified in the manifest.

    Use this if you already have ZIPs downloaded locally.
    """
    zip_files = list(zip_folder.rglob("*.zip"))
    if not zip_files:
        log.warning("No ZIP files found in %s", zip_folder)
        return 0

    log.info("Extracting from %d local ZIP files in %s ...", len(zip_files), zip_folder)
    total_extracted = 0

    for zip_path in zip_files:
        log.info("  Processing %s ...", zip_path.name)
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                xml_entries = [e for e in zf.namelist() if e.endswith("_public.xml")]
                for entry in xml_entries:
                    # Extract object_id from filename
                    oid = entry.replace("_public.xml", "").split("/")[-1]
                    dest = _local_path(oid)
                    dest.parent.mkdir(parents=True, exist_ok=True)

                    if dest.exists() and dest.stat().st_size > 200:
                        continue   # already extracted

                    # Read from ZIP and write to dest
                    with zf.open(entry) as src, open(dest, "wb") as out:
                        out.write(src.read())

                    # Verify and mark in manifest
                    if dest.stat().st_size > 200:
                        md5 = _md5_file(dest)
                        conn.execute("""
                            UPDATE irs_manifest
                            SET download_status = 'verified',
                                local_path      = ?,
                                file_size       = ?,
                                checksum_md5    = ?
                            WHERE object_id = ?
                        """, (str(dest), dest.stat().st_size, md5, oid))
                        total_extracted += 1

            conn.commit()
            log.info("    Extracted %d XMLs so far", total_extracted)

        except zipfile.BadZipFile:
            log.warning("  Bad ZIP file: %s", zip_path.name)
        except Exception as e:
            log.warning("  Error processing %s: %s", zip_path.name, e)

    log.info("Local ZIP extraction complete: %d files extracted", total_extracted)
    return total_extracted


# ── Step 6: Download ZIPs from apps.irs.gov ───────────────────────────────────

def _download_and_extract_zip(year: int, zip_name: str) -> dict:
    """
    Download one ZIP archive from IRS, extract all XML files from it,
    mark each as verified in the manifest.
    Returns a result dict.
    """
    url      = config.ZIP_URL.format(year=year, zip_name=zip_name)
    tmp_path = config.DATA_DIR / f"_tmp_{zip_name}"
    tmp_path.parent.mkdir(parents=True, exist_ok=True)

    extracted = 0
    errors    = 0

    try:
        # Stream download the ZIP
        resp = SESSION.get(url, stream=True, timeout=300)
        resp.raise_for_status()
        downloaded = 0

        with open(tmp_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=config.DOWNLOAD_CHUNK_SIZE):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

        log.info("  Downloaded %s (%.1f MB)", zip_name, downloaded / 1e6)

        # Extract XML files from the ZIP
        with zipfile.ZipFile(tmp_path, "r") as zf:
            xml_entries = [e for e in zf.namelist() if e.endswith("_public.xml")]
            log.info("  Extracting %d XML files from %s ...", len(xml_entries), zip_name)

            updates = []
            for entry in xml_entries:
                oid  = entry.replace("_public.xml", "").split("/")[-1]
                dest = _local_path(oid)
                dest.parent.mkdir(parents=True, exist_ok=True)

                try:
                    with zf.open(entry) as src:
                        data = src.read()
                    dest.write_bytes(data)

                    if dest.stat().st_size > 200:
                        md5 = hashlib.md5(data).hexdigest()
                        updates.append((str(dest), len(data), md5, oid))
                        extracted += 1
                    else:
                        errors += 1
                except Exception as e:
                    log.debug("  Failed to extract %s: %s", entry, e)
                    errors += 1

        # Clean up temp ZIP
        tmp_path.unlink(missing_ok=True)

        return {
            "zip_name": zip_name,
            "extracted": extracted,
            "errors": errors,
            "updates": updates,
            "error": None,
        }

    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        return {
            "zip_name": zip_name,
            "extracted": 0,
            "errors": 0,
            "updates": [],
            "error": str(e)[:300],
        }


def download_zips(conn: sqlite3.Connection, years: List[int],
                  workers: int = config.DOWNLOAD_WORKERS):
    """Download and extract all ZIP archives for the given years."""
    tasks = []
    for year in years:
        zip_names = discover_zip_list(year)
        for zn in zip_names:
            tasks.append((year, zn))

    if not tasks:
        log.info("No ZIPs found to download.")
        return

    log.info("Downloading %d ZIP archives (%d workers)...", len(tasks), workers)
    t0 = time.time()
    total_extracted = 0
    total_errors    = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_download_and_extract_zip, yr, zn): (yr, zn)
                   for yr, zn in tasks}
        for future in as_completed(futures):
            result = future.result()
            if result["error"]:
                log.warning("ZIP FAIL [%s]: %s", result["zip_name"], result["error"])
            else:
                if result["updates"]:
                    conn.executemany("""
                        UPDATE irs_manifest
                        SET download_status = 'verified',
                            local_path      = ?,
                            file_size       = ?,
                            checksum_md5    = ?
                        WHERE object_id = ?
                    """, result["updates"])
                    conn.commit()
                total_extracted += result["extracted"]
                log.info("  %s: %d XMLs extracted", result["zip_name"], result["extracted"])
            total_errors += result["errors"]

    elapsed = (time.time() - t0) / 60
    log.info("Download complete in %.1f min: %d XML files extracted, %d errors",
             elapsed, total_extracted, total_errors)


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

    # ASCII-only table (avoids Windows cp1252 Unicode errors)
    log.info("")
    log.info("+----------+----------+----------+---------+--------+---------+")
    log.info("|  IRS S3 AUDIT REPORT                                        |")
    log.info("+----------+----------+----------+---------+--------+---------+")
    log.info("|  Year    |  Total   | Verified | Pending | Failed |Extracted|")
    log.info("+----------+----------+----------+---------+--------+---------+")
    if not rows:
        log.info("|  (empty manifest -- run Phase 1 to populate)               |")
    else:
        for r in rows:
            log.info("|  %-7s | %8d | %8d | %7d | %6d | %7d |",
                     r[0], r[1], r[2], r[3], r[4], r[5])
    log.info("+----------+----------+----------+---------+--------+---------+")
    log.info("")


# ── CLI ────────────────────────────────────────────────────────────────────────

def main(args=None):
    parser = argparse.ArgumentParser(
        description="Phase 1: Audit IRS manifest and download/extract XML files"
    )
    parser.add_argument("--year",       type=int, nargs="+",
                        default=config.TARGET_YEARS,
                        help="Years to process (default: 2019-2025)")
    parser.add_argument("--audit-only", action="store_true",
                        help="Build manifest and reconcile only -- no download")
    parser.add_argument("--workers",    type=int, default=config.DOWNLOAD_WORKERS,
                        help=f"Download threads (default: {config.DOWNLOAD_WORKERS})")
    parser.add_argument("--stats",      action="store_true",
                        help="Print audit table and exit")
    parser.add_argument("--from-local", type=str, default=None, metavar="FOLDER",
                        help="Extract XMLs from existing local ZIPs in FOLDER "
                             "(skips download)")
    args = parser.parse_args(args)

    conn = get_conn()
    init_schema(conn)

    if args.stats:
        print_audit_table(conn)
        conn.close()
        return

    # --from-local: user already has ZIPs on disk
    if args.from_local:
        zip_folder = Path(args.from_local)
        if not zip_folder.exists():
            log.error("Folder not found: %s", zip_folder)
            conn.close()
            return
        # Still need the manifest to know what's in each ZIP
        for year in args.year:
            rows = fetch_index(year)
            if rows:
                upsert_manifest(conn, rows)
        extract_from_local_zips(conn, zip_folder)
        print_audit_table(conn)
        conn.close()
        return

    # Normal flow: fetch index + download ZIPs
    for year in args.year:
        rows = fetch_index(year)
        if rows:
            upsert_manifest(conn, rows)

    reconcile_local(conn)
    print_audit_table(conn)

    if args.audit_only:
        log.info("--audit-only set -- skipping download.")
        conn.close()
        return

    download_zips(conn, args.year, workers=args.workers)
    print_audit_table(conn)
    conn.close()


if __name__ == "__main__":
    main()
