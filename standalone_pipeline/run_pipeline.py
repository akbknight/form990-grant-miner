"""
run_pipeline.py
===============
MASTER ORCHESTRATOR — IRS Form 990 Grant Data Pipeline

Runs all three phases independently or end-to-end.

Usage examples:
    python run_pipeline.py --all                          # full run (phases 1+2+3)
    python run_pipeline.py --phase 1                      # download only
    python run_pipeline.py --phase 1 --audit-only         # build manifest, no download
    python run_pipeline.py --phase 2                      # extract XML → SQLite
    python run_pipeline.py --phase 3                      # AI categorize uncategorized grants
    python run_pipeline.py --phase 3 --dry-run            # estimate AI cost, no API calls
    python run_pipeline.py --all --year 2023 2024         # specific years only
    python run_pipeline.py --all --limit 1000             # test run (1000 files)
    python run_pipeline.py --stats                        # show current pipeline status

Phases:
    1 — Audit + Download   (audit_downloader.py)
    2 — XML Extraction     (extractor.py)
    3 — AI Categorization  (ai_categorizer.py)
"""

import argparse
import logging
import sys
import time
from pathlib import Path

import config
from db_sqlite import get_conn, init_schema


# ── Logging setup ──────────────────────────────────────────────────────────────

def setup_logging(verbose: bool = False):
    """Configure logging to both file and console."""
    level = logging.DEBUG if verbose else logging.INFO

    log_file = config.LOG_DIR / "pipeline.log"

    # Force UTF-8 on stdout to prevent cp1252 errors on Windows
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    handlers = [
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_file, encoding="utf-8"),
    ]

    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )

    # Quiet noisy third-party loggers
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("requests").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("anthropic").setLevel(logging.WARNING)


log = logging.getLogger(__name__)


# ── Status report ──────────────────────────────────────────────────────────────

def print_status(conn):
    """Print a summary of current pipeline state across all phases."""
    log.info("")
    log.info("=" * 68)
    log.info("  PIPELINE STATUS REPORT")
    log.info("=" * 68)

    # Manifest / download stats
    manifest_total = conn.execute(
        "SELECT COUNT(*) FROM irs_manifest"
    ).fetchone()[0]

    if manifest_total == 0:
        log.info("  Manifest:    empty — run Phase 1 to build it")
    else:
        rows = conn.execute("""
            SELECT
                COALESCE(tax_year,'ALL') AS yr,
                COUNT(*)                AS total,
                SUM(download_status='verified') AS verified,
                SUM(download_status='pending')  AS pending,
                SUM(download_status='failed')   AS failed,
                SUM(extracted)                  AS extracted
            FROM irs_manifest
            GROUP BY tax_year
            ORDER BY tax_year
        """).fetchall()

        log.info("  %-6s  %8s  %8s  %7s  %6s  %9s",
                 "Year", "Total", "Verified", "Pending", "Failed", "Extracted")
        log.info("  " + "-" * 60)
        for r in rows:
            log.info("  %-6s  %8d  %8d  %7d  %6d  %9d",
                     r[0], r[1], r[2], r[3], r[4], r[5])

    # Grant stats
    grant_total = conn.execute(
        "SELECT COUNT(*) FROM irs_grants"
    ).fetchone()[0]

    if grant_total > 0:
        log.info("")
        log.info("  Grants extracted:  {:,}".format(grant_total))

        cat_rows = conn.execute("""
            SELECT expense_type, COUNT(*) AS n
            FROM   irs_grants
            GROUP  BY expense_type
            ORDER  BY n DESC
        """).fetchall()
        for r in cat_rows:
            label = r[0] or "Uncategorized"
            log.info("    %-25s %10s", label, "{:,}".format(r[1]))

    # AI cache stats
    cache_total = conn.execute(
        "SELECT COUNT(*) FROM ai_cache"
    ).fetchone()[0]
    if cache_total:
        log.info("")
        log.info("  AI cache entries:  {:,}".format(cache_total))

    log.info("=" * 68)
    log.info("")


# ── Phase runners ──────────────────────────────────────────────────────────────

def run_phase1(args):
    """Phase 1: Audit IRS S3 manifest and download missing files."""
    log.info("---  PHASE 1: AUDIT + DOWNLOAD  ---")
    t0 = time.time()

    import audit_downloader
    phase1_args = []

    if args.year:
        phase1_args += ["--year"] + [str(y) for y in args.year]
    if args.workers:
        phase1_args += ["--workers", str(args.workers)]
    if args.audit_only:
        phase1_args += ["--audit-only"]

    audit_downloader.main(phase1_args)
    log.info("Phase 1 complete in %.1f min", (time.time() - t0) / 60)


def run_phase2(args):
    """Phase 2: Parse verified XML files and store grants in SQLite."""
    log.info("---  PHASE 2: XML EXTRACTION  ---")
    t0 = time.time()

    import extractor
    phase2_args = []

    if args.year:
        phase2_args += ["--year"] + [str(y) for y in args.year]
    if args.workers:
        phase2_args += ["--workers", str(args.workers)]
    if args.limit:
        phase2_args += ["--limit", str(args.limit)]

    extractor.main(phase2_args)
    log.info("Phase 2 complete in %.1f min", (time.time() - t0) / 60)


def run_phase3(args):
    """Phase 3: AI-classify uncategorized grants (with keyword pre-pass)."""
    log.info("---  PHASE 3: AI CATEGORIZATION  ---")
    t0 = time.time()

    import ai_categorizer
    phase3_args = []

    if args.dry_run:
        phase3_args += ["--dry-run"]
    if args.limit:
        phase3_args += ["--limit", str(args.limit)]

    ai_categorizer.main(phase3_args)

    if not args.dry_run:
        log.info("Phase 3 complete in %.1f min", (time.time() - t0) / 60)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="run_pipeline.py",
        description="IRS Form 990 Grant Data Pipeline — master orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_pipeline.py --all                     full pipeline, all years
  python run_pipeline.py --phase 1 --audit-only    build manifest only
  python run_pipeline.py --phase 1 --year 2023     download 2023 only
  python run_pipeline.py --phase 2 --limit 5000    extract 5,000 test files
  python run_pipeline.py --phase 3 --dry-run       estimate AI cost
  python run_pipeline.py --stats                   show current status
        """,
    )

    # ── Phase selection ──────────────────────────────────────────────────────
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--all",
        action="store_true",
        help="Run all three phases end-to-end (1 → 2 → 3)",
    )
    mode.add_argument(
        "--phase",
        type=int,
        choices=[1, 2, 3],
        metavar="{1,2,3}",
        help="Run a single phase: 1=download, 2=extract, 3=AI categorize",
    )
    mode.add_argument(
        "--stats",
        action="store_true",
        help="Print pipeline status and exit",
    )

    # ── Phase 1 flags ────────────────────────────────────────────────────────
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="(Phase 1) Build manifest and reconcile local files — do not download",
    )
    parser.add_argument(
        "--year",
        type=int,
        nargs="+",
        default=None,
        metavar="YEAR",
        help="Limit to specific tax year(s), e.g. --year 2023 2024",
    )

    # ── Phase 3 flags ────────────────────────────────────────────────────────
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="(Phase 3) Estimate API cost without making any API calls",
    )

    # ── Shared flags ─────────────────────────────────────────────────────────
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        metavar="N",
        help="Parallel worker threads (default: 4 for extract, 8 for download)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Max files/grants to process (useful for testing)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable DEBUG-level logging",
    )

    args = parser.parse_args()

    # ── Logging ──────────────────────────────────────────────────────────────
    setup_logging(verbose=args.verbose)

    log.info("IRS Form 990 Grant Pipeline")
    log.info("DB path : %s", config.DB_PATH)
    log.info("Data dir: %s", config.DATA_DIR)
    log.info("Log dir : %s", config.LOG_DIR)
    log.info("")

    # Initialise DB schema (safe to call on every run)
    conn = get_conn()
    init_schema(conn)

    # ── Dispatch ─────────────────────────────────────────────────────────────
    if args.stats:
        print_status(conn)
        conn.close()
        return

    conn.close()   # individual phases open their own connections

    t_total = time.time()

    try:
        if args.all:
            run_phase1(args)
            if not args.audit_only:
                run_phase2(args)
                run_phase3(args)

        elif args.phase == 1:
            run_phase1(args)

        elif args.phase == 2:
            if args.audit_only:
                parser.error("--audit-only only applies to --phase 1 or --all")
            if args.dry_run:
                parser.error("--dry-run only applies to --phase 3 or --all")
            run_phase2(args)

        elif args.phase == 3:
            if args.audit_only:
                parser.error("--audit-only only applies to --phase 1 or --all")
            run_phase3(args)

    except KeyboardInterrupt:
        log.warning("Interrupted by user — progress saved, safe to resume.")
        sys.exit(1)
    except Exception as e:
        log.exception("Pipeline error: %s", e)
        sys.exit(1)

    elapsed = (time.time() - t_total) / 60
    log.info("")
    log.info("All done in %.1f min.", elapsed)

    # Final status snapshot
    conn2 = get_conn()
    print_status(conn2)
    conn2.close()


if __name__ == "__main__":
    main()
