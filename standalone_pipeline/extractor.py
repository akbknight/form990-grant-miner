"""
extractor.py
============
PHASE 2 — XML Extraction & SQLite Storage  (pure Python, zero AI)

Reads verified XML files from the manifest, extracts target fields,
and upserts grant records into the local SQLite irs_grants table.

Target fields extracted:
  Grantmaker Name, Grantmaker State, Recipient Name, Recipient City,
  Recipient State/Country, Geography, Primary Subject, Support Strategy,
  Tax Year, Grant Amount, Description, EIN

Run:
    python extractor.py                     # extract all verified, unextracted
    python extractor.py --year 2023         # specific year only
    python extractor.py --limit 5000        # limit for testing
    python extractor.py --workers 4         # parallel thread count
"""

import hashlib
import logging
import re
import sqlite3
import sys
import time
import argparse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional, List, Dict, Tuple

import config
from db_sqlite import get_conn, init_schema

log = logging.getLogger(__name__)

# ── XML helpers ────────────────────────────────────────────────────────────────

def _ns(root: ET.Element) -> str:
    """Extract XML namespace from root tag."""
    if root.tag.startswith("{") and "}" in root.tag:
        return root.tag[1:root.tag.index("}")]
    return ""


def _find(elem: ET.Element, path: str, ns: str) -> str:
    """Find a tag by path using namespace, return clean text or empty string."""
    parts = [p for p in path.split("/") if p]
    xpath = ".//" + "/".join(f"{{{ns}}}{p}" if ns else p for p in parts)
    found = elem.find(xpath)
    if found is not None and found.text:
        return re.sub(r"\s+", " ", found.text).strip()
    return ""


def _to_int(text: str) -> Optional[int]:
    try:
        return int(float(text.replace(",", "").replace("$", "").strip()))
    except (ValueError, AttributeError):
        return None


def _clean_ein(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    return digits.zfill(9) if digits else ""


def _year_from_text(text: str) -> Optional[int]:
    m = re.search(r"(19|20)\d{2}", str(text or ""))
    return int(m.group(0)) if m else None


def _geography(state_country: str) -> str:
    up = (state_country or "").strip().upper()
    if not up:
        return ""
    if up in {"US", "USA", "U.S.", "UNITED STATES"} or \
       (len(up) == 2 and up.isalpha()):
        return "United States"
    return state_country


# ── Subject + Strategy classifiers ────────────────────────────────────────────

_SUBJECTS = [
    ("Education",       ["school","college","university","education","student",
                         "scholarship","academic","literacy","tutoring"]),
    ("Health",          ["health","hospital","medical","clinic","disease",
                         "cancer","mental health","nursing","maternal","wellness"]),
    ("Housing",         ["housing","shelter","homeless","affordable housing","rent",
                         "transitional","eviction"]),
    ("Employment",      ["workforce","employment","job","career","vocational",
                         "training","entrepreneur","apprentice"]),
    ("Arts & Culture",  ["arts","culture","artist","museum","theater","theatre",
                         "dance","music","film","gallery","heritage"]),
    ("Food Security",   ["food","hunger","nutrition","meals","pantry",
                         "feeding","grocery","harvest"]),
    ("Environment",     ["environment","climate","conservation","water","land",
                         "wildlife","sustainability","green"]),
    ("Civil Rights",    ["civil rights","justice","equity","discrimination",
                         "advocacy","policy","legal aid","voting"]),
    ("Religion",        ["church","mosque","temple","faith","ministry",
                         "congregation","diocese","synagogue","spiritual"]),
    ("Human Services",  ["family","youth","children","seniors","elderly",
                         "disability","veterans","refugee","immigrant"]),
    ("Community Dev",   ["community","neighborhood","development","revitalization",
                         "urban","rural","civic"]),
]

_STRATEGIES = [
    ("Conferences",         ["conference","summit","exhibit","symposium","convention"]),
    ("Internships",         ["internship","apprentice","fellowship","practicum"]),
    ("Capacity building",   ["training","capacity","technical assistance",
                             "organizational","coaching","mentoring"]),
    ("Leadership dev",      ["leadership","professional development","executive",
                             "management","board development"]),
    ("Core support",        ["core support","general support","operating support",
                             "general operating","unrestricted"]),
    ("Research",            ["research","study","evaluation","assessment",
                             "investigation","survey","analysis"]),
    ("Direct services",     ["direct service","program services","client services",
                             "case management","outreach","hotline"]),
    ("Capital projects",    ["capital","construction","renovation","equipment",
                             "facility","building","infrastructure"]),
]


def _classify_subject(text: str) -> str:
    t = text.lower()
    for label, keywords in _SUBJECTS:
        if any(kw in t for kw in keywords):
            return label
    return ""


def _classify_strategy(text: str) -> str:
    t = text.lower()
    for label, keywords in _STRATEGIES:
        if any(kw in t for kw in keywords):
            return label
    return ""


# ── Grant extraction from XML ──────────────────────────────────────────────────

_GRANT_GROUP_TAGS = [
    "GrantOrContributionPdDurYrGrp",
    "RecipientTableGrp",
    "GrantOrContriPdDurYrGrp",
    "GrantOrContributionPaidDuringYearGrp",
]


def extract_grants_from_xml(
    xml_bytes: bytes,
    object_id: str,
) -> Tuple[Optional[Dict], List[Dict]]:
    """
    Parse Form 990 XML bytes.
    Returns (filing_meta, [grant_records]).
    Both can be empty if the file has no grant schedule.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        log.debug("XML parse error for %s: %s", object_id, e)
        return None, []

    ns = _ns(root)

    # ── Filer / org metadata ─────────────────────────────────────────────────
    filer = root.find(f".//{{{ns}}}Filer" if ns else ".//Filer") or root

    ein = _clean_ein(
        _find(filer, "EIN", ns) or _find(root, "EIN", ns)
    )
    gmaker_name = (
        _find(filer, "BusinessName/BusinessNameLine1Txt", ns)
        or _find(filer, "BusinessNameLine1Txt", ns)
        or _find(filer, "Name/BusinessNameLine1Txt", ns)
    )
    gmaker_state = (
        _find(filer, "USAddress/StateAbbreviationCd", ns)
        or _find(filer, "ForeignAddress/CountryCd", ns)
    )
    tax_year = (
        _year_from_text(_find(root, "TaxYr", ns))
        or _year_from_text(_find(root, "TaxPeriodEndDt", ns))
    )

    meta = {
        "ein":           ein,
        "gmaker_name":   gmaker_name,
        "gmaker_state":  gmaker_state[:2] if gmaker_state else "",
        "tax_year":      tax_year,
    }

    # ── Grant schedule ────────────────────────────────────────────────────────
    grants = []
    for tag in _GRANT_GROUP_TAGS:
        xpath = f".//{{{ns}}}{tag}" if ns else f".//{tag}"
        for grp in root.findall(xpath):
            recipient_name = (
                _find(grp, "RecipientBusinessName/BusinessNameLine1Txt", ns)
                or _find(grp, "RecipientPersonNm", ns)
                or _find(grp, "RecipientNameTxt", ns)
                or _find(grp, "BusinessNameLine1Txt", ns)
            )
            recipient_city = (
                _find(grp, "RecipientUSAddress/CityNm", ns)
                or _find(grp, "RecipientForeignAddress/CityNm", ns)
                or _find(grp, "RecipientAddress/CityNm", ns)
            )
            recipient_state = (
                _find(grp, "RecipientUSAddress/StateAbbreviationCd", ns)
                or _find(grp, "RecipientForeignAddress/CountryCd", ns)
                or _find(grp, "RecipientAddress/CountryCd", ns)
            )
            amount = _to_int(
                _find(grp, "Amt", ns)
                or _find(grp, "CashGrantAmt", ns)
                or _find(grp, "GrantOrContributionAmt", ns)
            )
            description = (
                _find(grp, "GrantOrContributionPurposeTxt", ns)
                or _find(grp, "PurposeOfGrantTxt", ns)
                or _find(grp, "PurposeTxt", ns)
            )

            # Skip completely empty rows
            if not any([recipient_name, amount, description]):
                continue

            subject  = _classify_subject(description)
            strategy = _classify_strategy(description)
            geo      = _geography(recipient_state)

            grants.append({
                "object_id":        object_id,
                "ein":              ein,
                "tax_year":         tax_year,
                "grantmaker_name":  gmaker_name  or None,
                "grantmaker_state": gmaker_state[:2] if gmaker_state else None,
                "recipient_name":   recipient_name  or None,
                "recipient_city":   recipient_city  or None,
                "recipient_state":  recipient_state or None,
                "geography":        geo             or None,
                "primary_subject":  subject         or None,
                "support_strategy": strategy        or None,
                "grant_amount":     amount,
                "description":      description     or None,
            })

    return meta, grants


# ── SQLite upsert helpers ──────────────────────────────────────────────────────

def upsert_grants(conn: sqlite3.Connection, grants: List[Dict]):
    """Insert grants. Uses INSERT OR IGNORE on a unique index to prevent dupes."""
    if not grants:
        return 0
    conn.executemany("""
        INSERT OR IGNORE INTO irs_grants
            (object_id, ein, tax_year, grantmaker_name, grantmaker_state,
             recipient_name, recipient_city, recipient_state, geography,
             primary_subject, support_strategy, grant_amount, description)
        VALUES
            (:object_id, :ein, :tax_year, :grantmaker_name, :grantmaker_state,
             :recipient_name, :recipient_city, :recipient_state, :geography,
             :primary_subject, :support_strategy, :grant_amount, :description)
    """, grants)
    return len(grants)


def mark_extracted(conn: sqlite3.Connection, object_ids: List[str]):
    conn.executemany("""
        UPDATE irs_manifest
        SET extracted = 1, extracted_at = datetime('now')
        WHERE object_id = ?
    """, [(oid,) for oid in object_ids])
    conn.commit()


# ── Get unextracted files ──────────────────────────────────────────────────────

def get_unextracted(conn: sqlite3.Connection,
                    years: Optional[List[int]] = None,
                    limit: Optional[int] = None) -> List[Dict]:
    sql = """
        SELECT object_id, local_path, ein, tax_year
        FROM   irs_manifest
        WHERE  download_status = 'verified'
        AND    extracted = 0
        AND    local_path IS NOT NULL
    """
    args = []
    if years:
        sql += " AND tax_year IN ({})".format(",".join("?" * len(years)))
        args.extend(years)
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


# ── Worker: parse one file ─────────────────────────────────────────────────────

def _parse_one(row: Dict) -> Dict:
    oid  = row["object_id"]
    path = Path(row["local_path"])
    try:
        xml_bytes        = path.read_bytes()
        meta, grants     = extract_grants_from_xml(xml_bytes, oid)
        return {"object_id": oid, "grants": grants, "error": None}
    except Exception as e:
        return {"object_id": oid, "grants": [], "error": str(e)}


# ── Main extraction loop ───────────────────────────────────────────────────────

def run_extraction(years: Optional[List[int]] = None,
                   workers: int = 4,
                   limit: Optional[int] = None):
    conn = get_conn()
    init_schema(conn)

    pending = get_unextracted(conn, years, limit)
    if not pending:
        log.info("Nothing to extract — all verified files already processed.")
        conn.close()
        return

    log.info("Extracting %d XML files into SQLite...", len(pending))
    t0            = time.time()
    done          = 0
    grants_total  = 0
    errors        = 0
    grants_buf:   List[Dict] = []
    done_ids:     List[str]  = []

    def _flush():
        nonlocal grants_total
        if grants_buf:
            upsert_grants(conn, grants_buf)
            grants_total += len(grants_buf)
            grants_buf.clear()
        if done_ids:
            mark_extracted(conn, done_ids)
            done_ids.clear()
        conn.commit()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_parse_one, row): row for row in pending}
        for future in as_completed(futures):
            result = future.result()
            done  += 1

            if result["error"]:
                errors += 1
                log.debug("Parse error [%s]: %s",
                           result["object_id"], result["error"])
            else:
                grants_buf.extend(result["grants"])
                done_ids.append(result["object_id"])

            if len(grants_buf) >= config.EXTRACT_BATCH_SIZE:
                _flush()

            if done % 2000 == 0:
                _flush()
                elapsed = time.time() - t0
                log.info("  %d/%d files | %.0f files/s | %d grants | %d errors",
                         done, len(pending),
                         done / elapsed if elapsed else 0,
                         grants_total, errors)

    _flush()
    elapsed = time.time() - t0
    log.info("Extraction complete in %.1f min: "
             "%d files, %d grants inserted, %d errors",
             elapsed/60, done, grants_total, errors)
    conn.close()


# ── CLI ────────────────────────────────────────────────────────────────────────

def main(args=None):
    parser = argparse.ArgumentParser(
        description="Phase 2: Extract XML files into SQLite"
    )
    parser.add_argument("--year",    type=int, nargs="+",
                        default=None, help="Years to extract")
    parser.add_argument("--workers", type=int, default=4,
                        help="Parallel parse threads (default: 4)")
    parser.add_argument("--limit",   type=int, default=None,
                        help="Max files to process (for testing)")
    args = parser.parse_args(args)
    run_extraction(years=args.year, workers=args.workers, limit=args.limit)


if __name__ == "__main__":
    main()
