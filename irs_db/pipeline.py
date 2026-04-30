"""
irs_db/pipeline.py
==================
Main orchestrator. Runs the full pipeline end-to-end:
  ZIP discovery -> XML parse -> DB insert -> progress tracking

Usage:
    # Full pipeline (extract + load into DB)
    .venv312\\Scripts\\python.exe -m irs_db.pipeline

    # Skip index building during initial load (faster), build indexes after
    .venv312\\Scripts\\python.exe -m irs_db.pipeline --skip-indexes

    # Build indexes only (run after initial load is complete)
    .venv312\\Scripts\\python.exe -m irs_db.pipeline --build-indexes-only

    # Print DB stats only
    .venv312\\Scripts\\python.exe -m irs_db.pipeline --stats

    # Reset a specific ZIP (re-process it)
    .venv312\\Scripts\\python.exe -m irs_db.pipeline --reset-zip 2023_TEOS_XML_01A.zip
"""

import re
import sys
import time
import zipfile
import logging
import argparse
from pathlib import Path
from typing import List

from irs_db import config
from irs_db.parser import parse_filing
from irs_db import loader

# ── Logging setup ──────────────────────────────────────────────────────────────

LOG_FILE = config.BASE_DIR / "irs_db_pipeline.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(LOG_FILE), mode="a", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

SUPPORTED_COMPRESS = {
    zipfile.ZIP_STORED,
    zipfile.ZIP_DEFLATED,
    zipfile.ZIP_BZIP2,
    zipfile.ZIP_LZMA,
}


# ── ZIP discovery ──────────────────────────────────────────────────────────────

def collect_zips() -> List[str]:
    """Walk source folders, return unique ZIP paths (deduplicated by base name)."""
    seen: dict = {}
    for folder in config.ZIP_SOURCE_FOLDERS:
        folder = Path(folder)
        if not folder.is_dir():
            log.warning("Source folder not found: %s", folder)
            continue
        for p in folder.rglob("*.zip"):
            canonical = re.sub(r"\s*\(\d+\)(?=\.zip$)", "", p.name.lower())
            is_copy   = canonical != p.name.lower()
            if canonical not in seen:
                seen[canonical] = (str(p), is_copy)
            elif seen[canonical][1] and not is_copy:
                seen[canonical] = (str(p), is_copy)

    result = sorted(path for path, _ in seen.values())
    log.info("Found %d unique ZIP files.", len(result))
    return result


# ── Per-ZIP processing ─────────────────────────────────────────────────────────

def process_zip(conn, zip_path: str) -> tuple:
    """
    Process one ZIP file: parse all XML, insert into DB.
    Returns (filings_count, grants_count, skipped_count).
    """
    zip_name = Path(zip_path).name
    filings_buf: List[dict] = []
    grants_buf:  List[dict] = []
    total_filings = 0
    total_grants  = 0
    skipped       = 0

    def flush_filings():
        nonlocal total_filings
        if filings_buf:
            total_filings += loader.upsert_filings(conn, filings_buf)
            filings_buf.clear()

    def flush_grants():
        nonlocal total_grants
        if grants_buf:
            total_grants += loader.insert_grants(conn, grants_buf)
            grants_buf.clear()

    with zipfile.ZipFile(zip_path, "r") as zf:
        xml_entries = [e for e in zf.infolist() if e.filename.lower().endswith(".xml")]
        log.info("  %s — %d XML files", zip_name, len(xml_entries))

        for entry in xml_entries:
            if entry.compress_type not in SUPPORTED_COMPRESS:
                skipped += 1
                continue
            try:
                xml_bytes = zf.read(entry)
            except Exception:
                skipped += 1
                continue

            filing, grants = parse_filing(xml_bytes, zip_name, entry.filename)

            if filing:
                filings_buf.append(filing)
                if len(filings_buf) >= config.BATCH_SIZE_FILINGS:
                    flush_filings()

            grants_buf.extend(grants)
            if len(grants_buf) >= config.BATCH_SIZE_GRANTS:
                flush_grants()

    # Flush remainder
    flush_filings()
    flush_grants()

    return total_filings, total_grants, skipped


# ── Main pipeline ──────────────────────────────────────────────────────────────

def run_pipeline(skip_indexes: bool = False):
    log.info("=" * 70)
    log.info("IRS Form 990 -> PostgreSQL Pipeline")
    log.info("DB: %s", config.redacted_db_dsn())
    log.info("=" * 70)

    conn = loader.get_conn()
    loader.ensure_schema(conn)

    all_zips  = collect_zips()
    pending   = loader.get_pending_zips(conn, all_zips)

    if not pending:
        log.info("All ZIPs already processed. Run --stats to see counts.")
        loader.print_stats(conn)
        conn.close()
        return

    t_start          = time.time()
    total_filings    = 0
    total_grants     = 0
    processed        = 0

    for z_idx, zip_path in enumerate(pending, 1):
        zip_name = Path(zip_path).name
        log.info("[%d/%d] Processing: %s", z_idx, len(pending), zip_name)

        # Clean up any leftover partial data from a previous failed attempt
        loader.delete_partial_zip(conn, zip_name)
        loader.mark_zip_processing(conn, zip_name, zip_path)

        t_zip = time.time()
        try:
            f_count, g_count, skipped = process_zip(conn, zip_path)
            loader.mark_zip_complete(conn, zip_name, f_count, g_count)

            total_filings += f_count
            total_grants  += g_count
            processed     += 1

            elapsed    = time.time() - t_zip
            rate       = g_count / elapsed if elapsed > 0 else 0
            cumulative = time.time() - t_start
            log.info(
                "  Done: %d filings, %d grants  |  %.0f rows/s  |  skipped %d  |  total %d grants so far",
                f_count, g_count, rate, skipped, total_grants,
            )

        except zipfile.BadZipFile as e:
            log.error("  Bad ZIP file: %s", e)
            conn.rollback()
            loader.mark_zip_error(conn, zip_name, str(e))
        except Exception as e:
            log.error("  Error in %s: %s", zip_name, e, exc_info=True)
            conn.rollback()   # must rollback before any further DB calls
            loader.mark_zip_error(conn, zip_name, str(e))
            loader.delete_partial_zip(conn, zip_name)

    elapsed = time.time() - t_start
    log.info("=" * 70)
    log.info("Pipeline complete in %.1f minutes.", elapsed / 60)
    log.info("Inserted: %d filings, %d grants", total_filings, total_grants)

    if not skip_indexes:
        log.info("Building indexes...")
        loader.build_indexes(conn)

    loader.print_stats(conn)
    conn.close()


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="IRS Form 990 -> PostgreSQL pipeline")
    parser.add_argument("--skip-indexes",       action="store_true",
                        help="Skip index creation after load (build manually later)")
    parser.add_argument("--build-indexes-only", action="store_true",
                        help="Only build indexes, skip data loading")
    parser.add_argument("--stats",              action="store_true",
                        help="Print database stats and exit")
    parser.add_argument("--reset-zip",          metavar="ZIP_NAME",
                        help="Reset a ZIP so it gets re-processed (e.g. 2023_TEOS_XML_01A.zip)")
    args = parser.parse_args()

    conn = loader.get_conn()

    if args.stats:
        loader.ensure_schema(conn)
        loader.print_stats(conn)
        conn.close()
        return

    if args.reset_zip:
        loader.ensure_schema(conn)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE pipeline_state SET status='pending', error_msg=NULL WHERE zip_filename=%s",
                (args.reset_zip,)
            )
            if cur.rowcount == 0:
                log.warning("ZIP not found in pipeline_state: %s", args.reset_zip)
            else:
                log.info("Reset ZIP: %s", args.reset_zip)
        conn.commit()
        loader.delete_partial_zip(conn, args.reset_zip)
        conn.close()
        return

    if args.build_indexes_only:
        loader.ensure_schema(conn)
        log.info("Building indexes...")
        loader.build_indexes(conn)
        conn.close()
        return

    conn.close()
    run_pipeline(skip_indexes=args.skip_indexes)


if __name__ == "__main__":
    main()
