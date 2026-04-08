"""
irs_pipeline/run_pipeline.py
=============================
Master orchestrator. Runs all three phases in sequence or individually.

Usage:
    # Run all three phases end-to-end
    .venv312\\Scripts\\python.exe -m irs_pipeline.run_pipeline --all

    # Run only Phase 1 (audit + download)
    .venv312\\Scripts\\python.exe -m irs_pipeline.run_pipeline --phase 1

    # Run only Phase 2 (extract into PostgreSQL)
    .venv312\\Scripts\\python.exe -m irs_pipeline.run_pipeline --phase 2

    # Run only Phase 3 (AI categorization)
    .venv312\\Scripts\\python.exe -m irs_pipeline.run_pipeline --phase 3

    # Dry run Phase 3 to see cost estimate before spending anything
    .venv312\\Scripts\\python.exe -m irs_pipeline.run_pipeline --phase 3 --dry-run

    # Specific year
    .venv312\\Scripts\\python.exe -m irs_pipeline.run_pipeline --all --year 2023 2024

    # Check status of everything
    .venv312\\Scripts\\python.exe -m irs_pipeline.run_pipeline --status
"""

import argparse
import logging
import sys
import time
from pathlib import Path

from irs_pipeline import config
from irs_pipeline.db_sqlite import get_sqlite_conn, init_sqlite_schema

# ── Logging: file + console ────────────────────────────────────────────────────
config.LOG_DIR.mkdir(parents=True, exist_ok=True)
log_file = config.LOG_DIR / "pipeline.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)-25s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(log_file), mode="a", encoding="utf-8"),
    ],
)
log = logging.getLogger("run_pipeline")


# ── Status report ──────────────────────────────────────────────────────────────

def print_status():
    conn = get_sqlite_conn()
    init_sqlite_schema(conn)

    log.info("=" * 70)
    log.info("PIPELINE STATUS")
    log.info("=" * 70)

    # Manifest stats
    rows = conn.execute("""
        SELECT tax_year,
               COUNT(*)                             AS total,
               SUM(download_status='verified')      AS downloaded,
               SUM(download_status='pending')       AS pending,
               SUM(download_status='failed')        AS failed,
               SUM(extracted)                       AS extracted
        FROM irs_manifest
        GROUP BY tax_year ORDER BY tax_year
    """).fetchall()

    if rows:
        log.info("%-6s %8s %10s %8s %8s %10s",
                 "Year","Total","Downloaded","Pending","Failed","Extracted")
        log.info("-" * 60)
        for r in rows:
            log.info("%-6s %8d %10d %8d %8d %10d", *r)
    else:
        log.info("No manifest yet — run Phase 1 first.")

    # AI cache stats
    cache_count = conn.execute("SELECT COUNT(*) FROM ai_cache").fetchone()[0]
    log.info("\nAI Cache entries: %d", cache_count)

    # PostgreSQL stats
    try:
        from irs_db.loader import get_conn as get_pg, print_stats
        pg = get_pg()
        print_stats(pg)
        pg.close()
    except Exception as e:
        log.warning("Could not connect to PostgreSQL: %s", e)

    conn.close()


# ── Phase runners ──────────────────────────────────────────────────────────────

def run_phase1(years=None, audit_only=False, workers=None):
    from irs_pipeline.audit_downloader import (
        fetch_index, upsert_manifest, reconcile_local,
        get_pending, download_delta, print_audit
    )
    conn = get_sqlite_conn()
    init_sqlite_schema(conn)

    for year in (years or config.TARGET_YEARS):
        rows = fetch_index(year)
        if rows:
            upsert_manifest(conn, rows)

    reconcile_local(conn)
    print_audit(conn)

    if not audit_only:
        pending = get_pending(conn, years)
        kw = {}
        if workers:
            kw["workers"] = workers
        download_delta(conn, pending, **kw)
        print_audit(conn)

    conn.close()


def run_phase2(years=None, workers=4, limit=None):
    from irs_pipeline.extractor import run_extraction
    run_extraction(years=years, workers=workers, limit=limit)


def run_phase3(limit=None, reprocess_misc=False, dry_run=False):
    from irs_pipeline.ai_categorizer import run_ai_categorization
    run_ai_categorization(limit=limit,
                          reprocess_misc=reprocess_misc,
                          dry_run=dry_run)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="IRS Form 990 Full Pipeline — Audit → Extract → AI Classify"
    )
    parser.add_argument("--all",            action="store_true",
                        help="Run all three phases")
    parser.add_argument("--phase",          type=int, choices=[1, 2, 3],
                        help="Run a specific phase only")
    parser.add_argument("--year",           type=int, nargs="+",
                        default=None, help="Limit to specific years")
    parser.add_argument("--audit-only",     action="store_true",
                        help="Phase 1: audit only, no download")
    parser.add_argument("--workers",        type=int, default=None,
                        help="Download/parse thread count")
    parser.add_argument("--limit",          type=int, default=None,
                        help="Max rows/files to process (testing)")
    parser.add_argument("--reprocess-misc", action="store_true",
                        help="Phase 3: reprocess Miscellaneous rows")
    parser.add_argument("--dry-run",        action="store_true",
                        help="Phase 3: estimate cost without API calls")
    parser.add_argument("--status",         action="store_true",
                        help="Print status and exit")
    args = parser.parse_args()

    if args.status:
        print_status()
        return

    if not args.all and not args.phase:
        parser.print_help()
        return

    t_start = time.time()
    phases  = [1, 2, 3] if args.all else [args.phase]

    for phase in phases:
        log.info("")
        log.info("=" * 70)
        log.info("PHASE %d START", phase)
        log.info("=" * 70)
        t_phase = time.time()

        if phase == 1:
            run_phase1(
                years      = args.year,
                audit_only = args.audit_only,
                workers    = args.workers,
            )
        elif phase == 2:
            run_phase2(
                years   = args.year,
                workers = args.workers or 4,
                limit   = args.limit,
            )
        elif phase == 3:
            run_phase3(
                limit          = args.limit,
                reprocess_misc = args.reprocess_misc,
                dry_run        = args.dry_run,
            )

        log.info("Phase %d done in %.1f min", phase, (time.time()-t_phase)/60)

    log.info("")
    log.info("All phases complete in %.1f min", (time.time()-t_start)/60)


if __name__ == "__main__":
    main()
