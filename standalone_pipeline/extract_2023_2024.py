"""
extract_2023_2024.py
====================
Dedicated script: extract grant data from 2023 and 2024 ZIP archives
already on disk, store into SQLite, then delete XMLs to save space.

Strategy (low disk usage):
  For each ZIP:
    1. Extract XMLs to a temp folder (~1-4 GB peak)
    2. Parse all XMLs -> insert grants into SQLite
    3. DELETE the temp XMLs immediately
    4. Move to next ZIP

Peak disk usage: ~5 GB (one ZIP extracted at a time)
Final disk usage: SQLite database only (~2-4 GB)

Run:
    python extract_2023_2024.py
    python extract_2023_2024.py --stats    # show DB counts after run
"""

import argparse
import hashlib
import logging
import re
import shutil
import sqlite3
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

from project_utils.paths import FORM_990_DIR, STANDALONE_TEMP_DIR, WAREHOUSE_DB_PATH

# ── Setup ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent.parent   # project root
ZIP_FOLDER = FORM_990_DIR                   # where ZIPs already live
DB_PATH    = WAREHOUSE_DB_PATH
TEMP_DIR   = STANDALONE_TEMP_DIR
BATCH_SIZE = 500
WORKERS    = 6

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)


# ── SQLite schema ──────────────────────────────────────────────────────────────

def init_db(conn: sqlite3.Connection):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS irs_grants_2023_2024 (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id        TEXT    NOT NULL,
        ein              TEXT,
        tax_year         INTEGER,
        grantmaker_name  TEXT,
        grantmaker_state TEXT,
        recipient_name   TEXT,
        recipient_city   TEXT,
        recipient_state  TEXT,
        geography        TEXT,
        primary_subject  TEXT,
        support_strategy TEXT,
        grant_amount     INTEGER,
        description      TEXT,
        expense_type     TEXT    DEFAULT 'Uncategorized',
        inserted_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ein        ON irs_grants_2023_2024 (ein);
    CREATE INDEX IF NOT EXISTS idx_tax_year   ON irs_grants_2023_2024 (tax_year);
    CREATE INDEX IF NOT EXISTS idx_expense    ON irs_grants_2023_2024 (expense_type);
    CREATE INDEX IF NOT EXISTS idx_amount     ON irs_grants_2023_2024 (grant_amount);
    CREATE INDEX IF NOT EXISTS idx_recipient  ON irs_grants_2023_2024 (recipient_name);
    CREATE INDEX IF NOT EXISTS idx_grantmaker ON irs_grants_2023_2024 (grantmaker_name);

    CREATE TABLE IF NOT EXISTS zip_progress (
        zip_name    TEXT PRIMARY KEY,
        status      TEXT NOT NULL,
        grant_count INTEGER DEFAULT 0,
        processed_at TEXT DEFAULT (datetime('now'))
    );
    """)
    conn.commit()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-64000")   # 64 MB cache
    return conn


# ── XML parsing (same logic as extractor.py) ──────────────────────────────────

_GRANT_TAGS = [
    "GrantOrContributionPdDurYrGrp",
    "RecipientTableGrp",
    "GrantOrContriPdDurYrGrp",
    "GrantOrContributionPaidDuringYearGrp",
]

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

_JEWISH_RE = re.compile(
    r"\bjew(?:ish|s)?\b|\bjudai(?:sm|c)\b|\bhebre(?:w|ws)\b|\bisrael(?:i|is)?\b"
    r"|\bsynagog(?:ue|ues)\b|\bshul\b|\byeshiv(?:a|ah)\b|\bkosher\b"
    r"|\bholocaust\b|\bshoah\b|\bhadassah\b|\bchabad\b|\blubavitch\b"
    r"|\bb\'nai\b|\bbnai\b|\bjcc\b|\bjewish federation\b|\bjewish community\b"
    r"|\brabbi\b|\bsynagogue\b|\bbar mitzvah\b|\bbat mitzvah\b|\btikkun olam\b"
    r"|\banti-semiti(?:c|sm)\b|\bantisemiti(?:c|sm)\b|\btzedakah\b"
    r"|\bpassover\b|\bhanukkah\b|\bchanukah\b|\byom kippur\b|\brosh hashanah\b",
    re.IGNORECASE,
)


def _ns(root: ET.Element) -> str:
    if root.tag.startswith("{") and "}" in root.tag:
        return root.tag[1:root.tag.index("}")]
    return ""


def _find(elem: ET.Element, path: str, ns: str) -> str:
    parts = [p for p in path.split("/") if p]
    xpath = ".//" + "/".join(f"{{{ns}}}{p}" if ns else p for p in parts)
    found = elem.find(xpath)
    if found is not None and found.text:
        return re.sub(r"\s+", " ", found.text).strip()
    return ""


def _to_int(text: str) -> Optional[int]:
    try:
        return int(float(re.sub(r"[^\d.\-]", "", text or "")))
    except (ValueError, TypeError):
        return None


def _classify(text: str, table: list) -> str:
    t = (text or "").lower()
    for label, kws in table:
        if any(k in t for k in kws):
            return label
    return ""


def _geography(state: str) -> str:
    up = (state or "").strip().upper()
    if not up:
        return ""
    if up in {"US","USA","U.S.","UNITED STATES"} or (len(up)==2 and up.isalpha()):
        return "United States"
    return state


def _categorize(recipient: str, description: str) -> str:
    text = f"{recipient or ''} {description or ''}"
    if not text.strip():
        return "Miscellaneous"
    if _JEWISH_RE.search(text):
        return "Jews"
    return "Non-Jews"


def parse_xml_file(xml_path: Path) -> List[Dict]:
    """Parse one Form 990 XML file, return list of grant dicts."""
    try:
        root = ET.fromstring(xml_path.read_bytes())
    except ET.ParseError:
        return []

    ns  = _ns(root)
    oid = xml_path.stem.replace("_public", "")

    # Filer metadata
    filer = root.find(f".//{{{ns}}}Filer" if ns else ".//Filer") or root
    ein   = re.sub(r"\D", "", _find(filer,"EIN",ns) or _find(root,"EIN",ns) or "")
    ein   = ein.zfill(9) if ein else ""
    gmaker_name  = (_find(filer,"BusinessName/BusinessNameLine1Txt",ns)
                    or _find(filer,"BusinessNameLine1Txt",ns))
    gmaker_state = (_find(filer,"USAddress/StateAbbreviationCd",ns)
                    or _find(filer,"ForeignAddress/CountryCd",ns))
    m = re.search(r"(19|20)\d{2}", _find(root,"TaxYr",ns) or _find(root,"TaxPeriodEndDt",ns) or "")
    tax_year = int(m.group(0)) if m else None

    grants = []
    for tag in _GRANT_TAGS:
        xpath = f".//{{{ns}}}{tag}" if ns else f".//{tag}"
        for grp in root.findall(xpath):
            recipient = (
                _find(grp,"RecipientBusinessName/BusinessNameLine1Txt",ns)
                or _find(grp,"RecipientPersonNm",ns)
                or _find(grp,"RecipientNameTxt",ns)
                or _find(grp,"BusinessNameLine1Txt",ns)
            )
            city  = (_find(grp,"RecipientUSAddress/CityNm",ns)
                     or _find(grp,"RecipientForeignAddress/CityNm",ns))
            state = (_find(grp,"RecipientUSAddress/StateAbbreviationCd",ns)
                     or _find(grp,"RecipientForeignAddress/CountryCd",ns))
            amount = _to_int(
                _find(grp,"Amt",ns)
                or _find(grp,"CashGrantAmt",ns)
                or _find(grp,"GrantOrContributionAmt",ns)
            )
            desc = (_find(grp,"GrantOrContributionPurposeTxt",ns)
                    or _find(grp,"PurposeOfGrantTxt",ns)
                    or _find(grp,"PurposeTxt",ns))

            if not any([recipient, amount, desc]):
                continue

            combo = f"{recipient} {desc}"
            grants.append({
                "object_id":        oid,
                "ein":              ein or None,
                "tax_year":         tax_year,
                "grantmaker_name":  gmaker_name  or None,
                "grantmaker_state": gmaker_state[:2] if gmaker_state else None,
                "recipient_name":   recipient    or None,
                "recipient_city":   city         or None,
                "recipient_state":  state        or None,
                "geography":        _geography(state) or None,
                "primary_subject":  _classify(combo, _SUBJECTS) or None,
                "support_strategy": _classify(combo, _STRATEGIES) or None,
                "grant_amount":     amount,
                "description":      desc         or None,
                "expense_type":     _categorize(recipient, desc),
            })
    return grants


# ── Core: process one ZIP ──────────────────────────────────────────────────────

def process_zip(zip_path: Path, conn: sqlite3.Connection) -> int:
    """
    Extract XMLs from one ZIP -> parse -> insert into DB -> delete XMLs.
    Returns number of grants inserted.
    """
    zip_name  = zip_path.name
    temp_dir  = TEMP_DIR / zip_path.stem
    temp_dir.mkdir(parents=True, exist_ok=True)

    log.info("  Extracting %s ...", zip_name)
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            xml_names = [e for e in zf.namelist() if e.endswith("_public.xml")]
            zf.extractall(temp_dir, members=xml_names)
    except zipfile.BadZipFile:
        log.warning("  Bad ZIP: %s", zip_name)
        shutil.rmtree(temp_dir, ignore_errors=True)
        return 0

    xml_files = list(temp_dir.rglob("*_public.xml"))
    log.info("  Parsing %d XML files from %s ...", len(xml_files), zip_name)

    grants_total = 0
    grants_buf: List[Dict] = []

    def _flush():
        nonlocal grants_total
        if grants_buf:
            cols = [
                "object_id","ein","tax_year","grantmaker_name","grantmaker_state",
                "recipient_name","recipient_city","recipient_state","geography",
                "primary_subject","support_strategy","grant_amount","description",
                "expense_type",
            ]
            conn.executemany(
                f"INSERT OR IGNORE INTO irs_grants_2023_2024 ({','.join(cols)}) "
                f"VALUES ({','.join(':'+c for c in cols)})",
                grants_buf,
            )
            conn.commit()
            grants_total += len(grants_buf)
            grants_buf.clear()

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(parse_xml_file, p): p for p in xml_files}
        done = 0
        for future in as_completed(futures):
            grants_buf.extend(future.result())
            done += 1
            if len(grants_buf) >= BATCH_SIZE:
                _flush()
            if done % 5000 == 0:
                _flush()
                log.info("    %d/%d files parsed | %d grants so far",
                         done, len(xml_files), grants_total)

    _flush()

    # Delete extracted XMLs immediately to reclaim disk space
    shutil.rmtree(temp_dir, ignore_errors=True)
    log.info("  Done %s: %d grants inserted, temp XMLs deleted", zip_name, grants_total)
    return grants_total


# ── Stats report ───────────────────────────────────────────────────────────────

def print_stats(conn: sqlite3.Connection):
    total = conn.execute("SELECT COUNT(*) FROM irs_grants_2023_2024").fetchone()[0]
    log.info("")
    log.info("=" * 65)
    log.info("  GRANT DATABASE SUMMARY (2023-2024)")
    log.info("=" * 65)
    log.info("  Total grant rows: {:,}".format(total))
    log.info("")

    log.info("  By Year:")
    for r in conn.execute("""
        SELECT tax_year, COUNT(*) n, SUM(grant_amount) total
        FROM irs_grants_2023_2024
        GROUP BY tax_year ORDER BY tax_year
    """).fetchall():
        log.info("    %s : %10s grants | $%s total",
                 r[0], f"{r[1]:,}", f"{(r[2] or 0):,.0f}")

    log.info("")
    log.info("  By Category:")
    for r in conn.execute("""
        SELECT expense_type, COUNT(*) n, SUM(grant_amount) total
        FROM irs_grants_2023_2024
        GROUP BY expense_type ORDER BY n DESC
    """).fetchall():
        log.info("    %-20s : %10s grants | $%s total",
                 r[0], f"{r[1]:,}", f"{(r[2] or 0):,.0f}")

    log.info("")
    log.info("  By Subject Area (top 10):")
    for r in conn.execute("""
        SELECT primary_subject, COUNT(*) n
        FROM irs_grants_2023_2024
        WHERE primary_subject IS NOT NULL
        GROUP BY primary_subject ORDER BY n DESC LIMIT 10
    """).fetchall():
        log.info("    %-25s : %s grants", r[0], f"{r[1]:,}")

    log.info("")
    log.info("  Database file: %s", DB_PATH)
    log.info("  DB size: %.2f GB", DB_PATH.stat().st_size / 1e9 if DB_PATH.exists() else 0)
    log.info("=" * 65)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Extract 2023-2024 Form 990 grants from local ZIPs into SQLite"
    )
    parser.add_argument("--stats", action="store_true",
                        help="Show DB stats and exit")
    parser.add_argument("--zip-folder", type=str, default=str(ZIP_FOLDER),
                        help=f"Folder containing ZIP files (default: {ZIP_FOLDER})")
    args = parser.parse_args()

    conn = get_conn()
    init_db(conn)

    if args.stats:
        print_stats(conn)
        conn.close()
        return

    zip_folder = Path(args.zip_folder)
    zips_2023  = sorted(zip_folder.glob("2023_TEOS_XML_*.zip"))
    zips_2024  = sorted(zip_folder.glob("2024_TEOS_XML_*.zip"))
    all_zips   = zips_2023 + zips_2024

    if not all_zips:
        log.error("No 2023/2024 ZIPs found in %s", zip_folder)
        conn.close()
        return

    # Skip ZIPs already processed (resume support)
    done_zips = {r[0] for r in conn.execute(
        "SELECT zip_name FROM zip_progress WHERE status='done'"
    ).fetchall()}
    pending = [z for z in all_zips if z.name not in done_zips
               and z.name != "2024_TEOS_XML_01A (1).zip"]  # skip duplicate

    log.info("Found %d ZIPs (%d already done, %d to process)",
             len(all_zips), len(done_zips), len(pending))
    log.info("Database: %s", DB_PATH)
    log.info("")

    t0 = time.time()
    grand_total = 0

    for i, zip_path in enumerate(pending, 1):
        import shutil as _sh
        _, _, free = _sh.disk_usage("C:/")
        log.info("[%d/%d] %s | Free disk: %.1f GB",
                 i, len(pending), zip_path.name, free/1e9)

        if free < 3_000_000_000:   # < 3 GB free — stop safely
            log.error("STOPPING: less than 3 GB free disk space remaining!")
            break

        n = process_zip(zip_path, conn)
        grand_total += n

        conn.execute(
            "INSERT OR REPLACE INTO zip_progress (zip_name, status, grant_count) "
            "VALUES (?, 'done', ?)", (zip_path.name, n)
        )
        conn.commit()

        elapsed = time.time() - t0
        log.info("  Running total: {:,} grants | {:.1f} min elapsed".format(
            grand_total, elapsed/60))
        log.info("")

    elapsed = time.time() - t0
    log.info("All ZIPs processed in %.1f min. Total grants: {:,}".format(grand_total), elapsed/60)
    print_stats(conn)
    conn.close()


if __name__ == "__main__":
    main()
