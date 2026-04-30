"""
stream_pipeline.py  —  Phase 1 + Phase 2
=========================================
ZERO LOCAL STORAGE: streams IRS Form 990 XML files directly from the public
IRS S3 bucket into Neon Postgres. Nothing is written to disk.

Memory model:
  HTTP bytes → RawIOBase wrapper → lxml iterparse (one element at a time)
  → elem.clear() after each grant → RAM stays flat regardless of file size

Run:
    python stream_pipeline.py                      # all years
    python stream_pipeline.py --year 2023 2024     # specific years
    python stream_pipeline.py --limit 500          # test with 500 filings
    python stream_pipeline.py --workers 4          # parallel threads
"""

import csv
import io
import logging
import re
import sys
import time
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterator, List, Dict, Optional, Tuple

import psycopg2
import psycopg2.extras
import requests
from lxml import etree
from tenacity import (
    retry, stop_after_attempt, wait_exponential,
    retry_if_exception_type, before_sleep_log,
)

import config

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — HTTP + Streaming helpers
# ═══════════════════════════════════════════════════════════════════════════════

# Shared session — re-used across all requests (connection pooling)
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "IRS990-Research-Pipeline/2.0"


class _StreamReader(io.RawIOBase):
    """
    Wraps a requests streaming response as a file-like object.

    lxml's iterparse() needs a file-like object with a .read() method.
    This adapter feeds HTTP chunks directly into lxml without buffering
    the entire response — RAM stays flat no matter how large the XML is.
    """
    def __init__(self, response: requests.Response):
        self._iter = response.iter_content(chunk_size=config.STREAM_CHUNK_SIZE)
        self._buf  = b""

    def readable(self) -> bool:
        return True

    def readinto(self, b: bytearray) -> int:
        """Fill buffer b with up to len(b) bytes from the stream."""
        target = len(b)
        while len(self._buf) < target:
            try:
                chunk = next(self._iter)
                if chunk:
                    self._buf += chunk
            except StopIteration:
                break   # stream exhausted

        # Copy what we have into the output buffer
        out = self._buf[:target]
        self._buf = self._buf[target:]
        n = len(out)
        b[:n] = out
        return n


@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=1, min=config.RETRY_WAIT_MIN, max=config.RETRY_WAIT_MAX),
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def _http_get_stream(url: str) -> requests.Response:
    """Open a streaming HTTP connection with automatic retry on failure."""
    resp = SESSION.get(url, stream=True, timeout=config.HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp


@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=1, min=config.RETRY_WAIT_MIN, max=config.RETRY_WAIT_MAX),
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def _http_get_text(url: str) -> str:
    """Fetch small text content (index CSVs) with retry."""
    resp = SESSION.get(url, timeout=config.HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.text


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — XML Parsing (in-memory streaming)
# ═══════════════════════════════════════════════════════════════════════════════

def _text(elem: etree._Element, local_tag: str) -> str:
    """
    Find a child element by local tag name (ignoring XML namespace).
    Returns cleaned text or empty string.
    """
    # Use XPath with local-name() to be namespace-agnostic
    result = elem.xpath(f".//*[local-name()='{local_tag}']/text()")
    if result:
        return re.sub(r"\s+", " ", str(result[0])).strip()
    return ""


def _to_int(text: str) -> Optional[int]:
    """Parse a dollar amount string to integer cents/dollars."""
    if not text:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", text)
    try:
        return int(float(cleaned))
    except (ValueError, TypeError):
        return None


def _clean_ein(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    return digits.zfill(9) if digits else ""


# Keyword tables for subject + strategy classification
_SUBJECTS = [
    ("Education",      ["school","college","university","education","student",
                        "scholarship","academic","literacy","tutoring"]),
    ("Health",         ["health","hospital","medical","clinic","disease",
                        "cancer","mental health","nursing","wellness"]),
    ("Housing",        ["housing","shelter","homeless","affordable housing",
                        "rent","transitional","eviction"]),
    ("Employment",     ["workforce","employment","job","career","vocational",
                        "training","entrepreneur","apprentice"]),
    ("Arts & Culture", ["arts","culture","artist","museum","theater","theatre",
                        "dance","music","film","gallery","heritage"]),
    ("Food Security",  ["food","hunger","nutrition","meals","pantry",
                        "feeding","grocery","harvest"]),
    ("Environment",    ["environment","climate","conservation","water","land",
                        "wildlife","sustainability","green"]),
    ("Civil Rights",   ["civil rights","justice","equity","discrimination",
                        "advocacy","policy","legal aid","voting"]),
    ("Religion",       ["church","mosque","temple","faith","ministry",
                        "congregation","diocese","synagogue","spiritual"]),
    ("Human Services", ["family","youth","children","seniors","elderly",
                        "disability","veterans","refugee","immigrant"]),
    ("Community Dev",  ["community","neighborhood","development","revitalization",
                        "urban","rural","civic"]),
]

_STRATEGIES = [
    ("Conferences",       ["conference","summit","exhibit","symposium","convention"]),
    ("Internships",       ["internship","apprentice","fellowship","practicum"]),
    ("Capacity building", ["training","capacity","technical assistance","coaching"]),
    ("Leadership dev",    ["leadership","professional development","executive"]),
    ("Core support",      ["core support","general support","operating support",
                           "general operating","unrestricted"]),
    ("Research",          ["research","study","evaluation","assessment","survey"]),
    ("Direct services",   ["direct service","program services","client services",
                           "case management","outreach","hotline"]),
    ("Capital projects",  ["capital","construction","renovation","equipment",
                           "facility","building","infrastructure"]),
]


def _classify(text: str, table: list) -> str:
    t = (text or "").lower()
    for label, keywords in table:
        if any(kw in t for kw in keywords):
            return label
    return ""


def parse_grants_from_stream(
    response: requests.Response,
    object_id: str,
    meta: Dict,
) -> Iterator[Dict]:
    """
    Core streaming parser.

    Feeds the HTTP response byte-by-byte into lxml iterparse.
    For each grant element found, yields one dict and immediately
    clears the element from memory (elem.clear()).

    RAM usage = O(one_element), not O(entire_file).
    """
    reader  = io.BufferedReader(_StreamReader(response), buffer_size=config.STREAM_CHUNK_SIZE)
    context = etree.iterparse(reader, events=("end",), recover=True)

    # Extract namespace-aware filer metadata from first few elements
    ein          = meta.get("ein", "")
    gmaker_name  = meta.get("taxpayer_name", "")
    gmaker_state = meta.get("gmaker_state", "")
    tax_year     = meta.get("tax_year")

    # Build set of target tags (without namespace prefix for matching)
    target_tags = set(config.GRANT_TAGS)

    for event, elem in context:
        # Strip namespace: "{http://...}TagName" → "TagName"
        local = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag

        # ── Grab filer EIN / name from Filer element ──────────────────────
        if local == "Filer" and not ein:
            ein = _clean_ein(
                _text(elem, "EIN") or meta.get("ein", "")
            )
            gmaker_name = (
                _text(elem, "BusinessNameLine1Txt")
                or gmaker_name
            )
            gmaker_state = (
                _text(elem, "StateAbbreviationCd")
                or _text(elem, "CountryCd")
                or gmaker_state
            )[:2]

        # ── Process grant row ─────────────────────────────────────────────
        if local in target_tags:
            recipient = (
                _text(elem, "BusinessNameLine1Txt")
                or _text(elem, "RecipientPersonNm")
                or _text(elem, "RecipientNameTxt")
            )
            city  = _text(elem, "CityNm")
            state = (
                _text(elem, "StateAbbreviationCd")
                or _text(elem, "CountryCd")
            )
            amount = _to_int(
                _text(elem, "Amt")
                or _text(elem, "CashGrantAmt")
                or _text(elem, "GrantOrContributionAmt")
            )
            description = (
                _text(elem, "GrantOrContributionPurposeTxt")
                or _text(elem, "PurposeOfGrantTxt")
                or _text(elem, "PurposeTxt")
            )

            # Skip completely empty rows
            if recipient or amount or description:
                combo = f"{recipient} {description}"
                yield {
                    "object_id":        object_id,
                    "ein":              ein or None,
                    "tax_year":         tax_year,
                    "grantmaker":       gmaker_name  or None,
                    "grantmaker_state": gmaker_state or None,
                    "recipient":        recipient    or None,
                    "city":             city         or None,
                    "state":            state        or None,
                    "amount":           amount,
                    "description":      description  or None,
                    "subject":          _classify(combo, _SUBJECTS)   or None,
                    "strategy":         _classify(combo, _STRATEGIES) or None,
                    "expense_type":     "Uncategorized",
                }

        # ── CRITICAL: clear element immediately to free RAM ───────────────
        elem.clear()
        # Also clear references kept by iterparse itself
        while elem.getprevious() is not None:
            del elem.getparent()[0]


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Neon Postgres helpers
# ═══════════════════════════════════════════════════════════════════════════════

def get_db_conn() -> psycopg2.extensions.connection:
    """Open a connection to Neon Postgres. Raises clearly if DSN is missing."""
    if not config.NEON_DSN:
        raise RuntimeError(
            "NEON_DSN is not set.\n"
            "Create neon_pipeline/.env with:\n"
            "  NEON_DSN=postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require"
        )
    conn = psycopg2.connect(config.NEON_DSN)
    conn.autocommit = False
    return conn


def init_schema(conn):
    """Create tables if they don't exist (idempotent)."""
    schema_path = __file__.replace("stream_pipeline.py", "schema.sql")
    with open(schema_path, "r") as f:
        sql = f.read()
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    log.info("Schema initialised.")


def get_processed_ids(conn, year: int) -> set:
    """Return set of object_ids already in irs_progress for this year."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT object_id FROM irs_progress WHERE tax_year = %s",
            (year,)
        )
        return {row[0] for row in cur.fetchall()}


def insert_grants_batch(conn, batch: List[Dict]) -> int:
    """Bulk-insert a list of grant dicts using execute_values (fast)."""
    if not batch:
        return 0
    cols = [
        "object_id","ein","tax_year","grantmaker","grantmaker_state",
        "recipient","city","state","amount","description",
        "subject","strategy","expense_type",
    ]
    rows = [tuple(g[c] for c in cols) for g in batch]
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            f"""
            INSERT INTO irs_grants ({','.join(cols)})
            VALUES %s
            ON CONFLICT DO NOTHING
            """,
            rows,
            page_size=500,
        )
    return len(rows)


def mark_progress(conn, object_id: str, tax_year: int,
                  status: str, grant_count: int = 0, error: str = None):
    """Upsert a progress row so we can resume safely on restart."""
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO irs_progress (object_id, tax_year, status, grant_count, error_msg)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (object_id) DO UPDATE
            SET status=EXCLUDED.status, grant_count=EXCLUDED.grant_count,
                error_msg=EXCLUDED.error_msg, processed_at=now()
        """, (object_id, tax_year, status, grant_count, error))


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Index download + main loop
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_index(year: int) -> List[Dict]:
    """Download the IRS S3 index CSV for one year and return normalized rows."""
    url = config.INDEX_URL.format(year=year)
    log.info("Fetching index for %d ...", year)
    try:
        text = _http_get_text(url)
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            log.warning("No index for year %d (not yet published)", year)
            return []
        raise

    rows = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        # Normalize column names (IRS varies by year)
        r = {k.strip().upper(): (v or "").strip() for k, v in row.items()}
        oid = r.get("OBJECT_ID") or r.get("OBJECTID", "")
        if oid:
            rows.append({
                "object_id":     oid,
                "ein":           re.sub(r"\D", "", r.get("EIN","")).zfill(9),
                "taxpayer_name": r.get("TAXPAYER_NAME","")[:255],
                "tax_year":      year,
                "gmaker_state":  "",   # filled during XML parse
            })
    log.info("  Year %d: %d filings in index", year, len(rows))
    return rows


def _process_one_filing(row: Dict) -> Dict:
    """
    Download + stream-parse one IRS XML filing.
    Returns a result dict — never raises (errors captured).

    This function runs in a thread pool worker.
    """
    oid = row["object_id"]
    url = config.FILING_URL.format(object_id=oid)
    grants = []

    try:
        # Open streaming HTTP connection (retried automatically)
        response = _http_get_stream(url)

        # Stream-parse: yields one grant dict at a time, clears XML from RAM
        for grant in parse_grants_from_stream(response, oid, row):
            grants.append(grant)

        response.close()
        return {"object_id": oid, "tax_year": row["tax_year"],
                "grants": grants, "error": None}

    except Exception as e:
        return {"object_id": oid, "tax_year": row["tax_year"],
                "grants": [], "error": str(e)[:500]}


def run_pipeline(
    years: Optional[List[int]] = None,
    workers: int = 4,
    limit: Optional[int] = None,
):
    """
    Main pipeline loop.

    For each year:
      1. Download index CSV (tiny, ~2MB)
      2. Skip object_ids already in irs_progress
      3. Stream-parse each XML filing in a thread pool
      4. Batch-insert grants into Neon Postgres
      5. Mark progress — safe to restart at any time
    """
    years = years or config.TARGET_YEARS
    conn  = get_db_conn()
    init_schema(conn)

    total_grants  = 0
    total_filings = 0
    total_errors  = 0

    for year in years:
        index_rows = fetch_index(year)
        if not index_rows:
            continue

        # Resume: skip already-processed filings
        done_ids = get_processed_ids(conn, year)
        pending  = [r for r in index_rows if r["object_id"] not in done_ids]

        if limit:
            pending = pending[:limit]

        if not pending:
            log.info("Year %d: nothing to do (all %d already processed)",
                     year, len(index_rows))
            continue

        log.info("Year %d: processing %d/%d filings (%d workers)...",
                 year, len(pending), len(index_rows), workers)

        t0          = time.time()
        year_grants = 0
        year_errors = 0
        done_count  = 0
        grant_buf:  List[Dict] = []

        def _flush():
            nonlocal year_grants
            if grant_buf:
                n = insert_grants_batch(conn, grant_buf)
                year_grants += n
                grant_buf.clear()
            conn.commit()

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_process_one_filing, row): row
                       for row in pending}

            for future in as_completed(futures):
                result     = future.result()
                done_count += 1
                oid        = result["object_id"]
                yr         = result["tax_year"]

                if result["error"]:
                    year_errors += 1
                    mark_progress(conn, oid, yr, "failed", 0, result["error"])
                    log.debug("FAIL [%s]: %s", oid, result["error"])
                else:
                    g_count = len(result["grants"])
                    status  = "done" if g_count > 0 else "no_grants"
                    grant_buf.extend(result["grants"])
                    mark_progress(conn, oid, yr, status, g_count)

                # Flush to DB every batch_size grants or every 1000 filings
                if len(grant_buf) >= config.INSERT_BATCH_SIZE:
                    _flush()
                if done_count % 1000 == 0:
                    _flush()
                    elapsed = time.time() - t0
                    rate    = done_count / elapsed if elapsed else 0
                    log.info(
                        "  [%d] %d/%d filings | %.0f/s | %d grants | %d errors",
                        year, done_count, len(pending),
                        rate, year_grants, year_errors
                    )

        _flush()
        elapsed = time.time() - t0
        log.info(
            "Year %d done in %.1f min: %d filings, %d grants, %d errors",
            year, elapsed / 60, done_count, year_grants, year_errors
        )
        total_filings += done_count
        total_grants  += year_grants
        total_errors  += year_errors

    log.info("")
    log.info("═" * 60)
    log.info("PIPELINE COMPLETE")
    log.info("  Total filings processed : %d", total_filings)
    log.info("  Total grants inserted   : %d", total_grants)
    log.info("  Total errors            : %d", total_errors)
    log.info("═" * 60)
    conn.close()


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Zero-storage IRS 990 streaming pipeline → Neon Postgres"
    )
    parser.add_argument("--year",    type=int, nargs="+", default=None,
                        help="Tax years to process (default: 2019-2025)")
    parser.add_argument("--workers", type=int, default=4,
                        help="Parallel download threads (default: 4)")
    parser.add_argument("--limit",   type=int, default=None,
                        help="Max filings per year (for testing)")
    args = parser.parse_args()
    run_pipeline(years=args.year, workers=args.workers, limit=args.limit)


if __name__ == "__main__":
    main()
