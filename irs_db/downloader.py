"""
irs_db/downloader.py
====================
Downloads IRS TEOS bulk XML ZIP files for a given year range.

IRS publishes an index CSV for each year listing every filing:
    https://s3.amazonaws.com/irs-form-990/index_{year}.csv

Each ZIP is downloaded from:
    https://apps.irs.gov/pub/epostcard/990/xml/{year}/

Usage:
    # Download missing ZIPs for all years 2019-2025
    .venv312\\Scripts\\python.exe -m irs_db.downloader

    # Download for specific years
    .venv312\\Scripts\\python.exe -m irs_db.downloader --years 2023 2024 2025

    # List available files without downloading
    .venv312\\Scripts\\python.exe -m irs_db.downloader --list-only
"""

import re
import sys
import time
import logging
import argparse
import hashlib
from pathlib import Path
from typing import List, Optional

try:
    import requests
    from tqdm import tqdm
except ImportError:
    print("Missing packages. Run:  pip install requests tqdm")
    sys.exit(1)

from irs_db import config

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])

# IRS TEOS base URL — files are organized by year
TEOS_BASE = "https://apps.irs.gov/pub/epostcard/990/xml"

# Known ZIP file patterns by year
# IRS naming changed around 2022 from download990xml_YEAR_N to YEAR_TEOS_XML_NNA
YEAR_FILE_PATTERNS = {
    2019: [f"download990xml_2019_{n}.zip" for n in range(1, 9)],
    2020: [f"download990xml_2020_{n}.zip" for n in range(1, 9)],
    2021: [f"2021_TEOS_XML_{n:02d}A.zip" for n in range(1, 13)],
    2022: [f"2022_TEOS_XML_{n:02d}A.zip" for n in range(1, 13)],
    2023: [f"2023_TEOS_XML_{n:02d}A.zip" for n in range(1, 13)],
    2024: [f"2024_TEOS_XML_{n:02d}A.zip" for n in range(1, 13)],
    2025: [
        *[f"2025_TEOS_XML_{n:02d}A.zip" for n in range(1, 11)],
        "2025_TEOS_XML_11A.zip",
        "2025_TEOS_XML_11B.zip",
        "2025_TEOS_XML_11C.zip",
        "2025_TEOS_XML_11D.zip",
        "2025_TEOS_XML_12A.zip",
    ],
}


def _get_url(year: int, filename: str) -> str:
    return f"{TEOS_BASE}/{year}/{filename}"


def _already_downloaded(filename: str) -> Optional[Path]:
    """Check if file exists in any source folder. Return path if found."""
    for folder in config.ZIP_SOURCE_FOLDERS:
        p = Path(folder) / filename
        if p.exists():
            return p
        # Also check without copy suffix
        clean = re.sub(r"\s*\(\d+\)(?=\.zip$)", "", filename)
        p2 = Path(folder) / clean
        if p2.exists():
            return p2
    return None


def _download_file(url: str, dest: Path) -> bool:
    """
    Download a file with a progress bar.
    Returns True on success, False on failure.
    """
    try:
        resp = requests.get(url, stream=True, timeout=60)
        if resp.status_code == 404:
            log.warning("  Not found (404): %s", url)
            return False
        resp.raise_for_status()

        total = int(resp.headers.get("content-length", 0))
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")

        with open(tmp, "wb") as f, tqdm(
            total=total, unit="B", unit_scale=True,
            desc=dest.name, leave=False
        ) as bar:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                bar.update(len(chunk))

        tmp.rename(dest)
        size_mb = dest.stat().st_size / 1024 / 1024
        log.info("  Downloaded: %s  (%.0f MB)", dest.name, size_mb)
        return True

    except requests.RequestException as e:
        log.error("  Download failed for %s: %s", url, e)
        if tmp.exists():
            tmp.unlink()
        return False


def list_available(years: List[int]):
    """Print all expected file URLs without downloading."""
    for year in years:
        files = YEAR_FILE_PATTERNS.get(year, [])
        print(f"\n=== {year} ({len(files)} files) ===")
        for fname in files:
            exists = _already_downloaded(fname)
            status = f"EXISTS: {exists}" if exists else f"URL: {_get_url(year, fname)}"
            print(f"  {fname:40s}  {status}")


def download_missing(years: List[int]) -> dict:
    """
    Download all missing ZIPs for the given years.
    Returns summary: {year: {downloaded: N, skipped: N, failed: N}}
    """
    dest_folder = Path(config.DOWNLOAD_DIR)
    dest_folder.mkdir(parents=True, exist_ok=True)

    summary = {}
    for year in years:
        files    = YEAR_FILE_PATTERNS.get(year, [])
        dl_count = 0
        sk_count = 0
        fa_count = 0

        log.info("Year %d: checking %d files...", year, len(files))
        for fname in files:
            existing = _already_downloaded(fname)
            if existing:
                log.debug("  Exists: %s", fname)
                sk_count += 1
                continue

            url  = _get_url(year, fname)
            dest = dest_folder / fname
            ok   = _download_file(url, dest)
            if ok:
                dl_count += 1
            else:
                fa_count += 1

            time.sleep(0.5)  # Be polite to IRS servers

        log.info("  Year %d: %d downloaded, %d skipped (exist), %d failed",
                 year, dl_count, sk_count, fa_count)
        summary[year] = {"downloaded": dl_count, "skipped": sk_count, "failed": fa_count}

    return summary


def main():
    parser = argparse.ArgumentParser(description="Download IRS TEOS ZIP files")
    parser.add_argument("--years", type=int, nargs="+",
                        default=list(range(2019, 2026)),
                        help="Years to download (default: 2019-2025)")
    parser.add_argument("--list-only", action="store_true",
                        help="List expected files without downloading")
    args = parser.parse_args()

    if args.list_only:
        list_available(args.years)
        return

    log.info("Downloading IRS TEOS data for years: %s", args.years)
    log.info("Destination: %s", config.DOWNLOAD_DIR)
    summary = download_missing(args.years)

    total_dl = sum(v["downloaded"] for v in summary.values())
    total_fa = sum(v["failed"]     for v in summary.values())
    log.info("Done. %d files downloaded, %d failed.", total_dl, total_fa)


if __name__ == "__main__":
    main()
