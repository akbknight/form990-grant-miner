"""
extract_2024_to_csv.py
======================
Reads all 2024_TEOS_XML_*.zip files from the "Form 990" folder,
parses the XML grant data, and writes everything to:

    irs990_2024_grants.csv

Processes one ZIP at a time to keep disk usage low.

Run:
    python extract_2024_to_csv.py
"""

import csv
import logging
import re
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from typing import List, Dict, Optional

from project_utils.paths import EXPORT_2024_CSV_PATH, FORM_990_DIR

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
ZIP_FOLDER = FORM_990_DIR
OUT_CSV    = EXPORT_2024_CSV_PATH

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── CSV columns ────────────────────────────────────────────────────────────────
COLUMNS = [
    "object_id", "ein", "tax_year",
    "grantmaker_name", "grantmaker_state",
    "recipient_name", "recipient_city", "recipient_state",
    "geography", "primary_subject", "support_strategy",
    "grant_amount", "description", "expense_type",
]

# ── Classification tables ──────────────────────────────────────────────────────
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


# ── Helpers ────────────────────────────────────────────────────────────────────

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
    if up in {"US", "USA", "U.S.", "UNITED STATES"} or (len(up) == 2 and up.isalpha()):
        return "United States"
    return state


def _categorize(recipient: str, description: str) -> str:
    text = f"{recipient or ''} {description or ''}"
    if not text.strip():
        return "Miscellaneous"
    if _JEWISH_RE.search(text):
        return "Jews"
    return "Non-Jews"


def parse_xml(xml_bytes: bytes, object_id: str) -> List[Dict]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []

    ns = _ns(root)
    filer = root.find(f".//{{{ns}}}Filer" if ns else ".//Filer") or root

    ein = re.sub(r"\D", "", _find(filer, "EIN", ns) or _find(root, "EIN", ns) or "")
    ein = ein.zfill(9) if ein else ""
    gmaker_name  = (_find(filer, "BusinessName/BusinessNameLine1Txt", ns)
                    or _find(filer, "BusinessNameLine1Txt", ns))
    gmaker_state = (_find(filer, "USAddress/StateAbbreviationCd", ns)
                    or _find(filer, "ForeignAddress/CountryCd", ns))
    m = re.search(r"(19|20)\d{2}", _find(root, "TaxYr", ns) or _find(root, "TaxPeriodEndDt", ns) or "")
    tax_year = int(m.group(0)) if m else None

    grants = []
    for tag in _GRANT_TAGS:
        xpath = f".//{{{ns}}}{tag}" if ns else f".//{tag}"
        for grp in root.findall(xpath):
            recipient = (
                _find(grp, "RecipientBusinessName/BusinessNameLine1Txt", ns)
                or _find(grp, "RecipientPersonNm", ns)
                or _find(grp, "RecipientNameTxt", ns)
                or _find(grp, "BusinessNameLine1Txt", ns)
            )
            city  = (_find(grp, "RecipientUSAddress/CityNm", ns)
                     or _find(grp, "RecipientForeignAddress/CityNm", ns))
            state = (_find(grp, "RecipientUSAddress/StateAbbreviationCd", ns)
                     or _find(grp, "RecipientForeignAddress/CountryCd", ns))
            amount = _to_int(
                _find(grp, "Amt", ns)
                or _find(grp, "CashGrantAmt", ns)
                or _find(grp, "GrantOrContributionAmt", ns)
            )
            desc = (_find(grp, "GrantOrContributionPurposeTxt", ns)
                    or _find(grp, "PurposeOfGrantTxt", ns)
                    or _find(grp, "PurposeTxt", ns))

            if not any([recipient, amount, desc]):
                continue

            combo = f"{recipient} {desc}"
            grants.append({
                "object_id":        object_id,
                "ein":              ein or "",
                "tax_year":         tax_year or "",
                "grantmaker_name":  gmaker_name or "",
                "grantmaker_state": gmaker_state[:2] if gmaker_state else "",
                "recipient_name":   recipient or "",
                "recipient_city":   city or "",
                "recipient_state":  state or "",
                "geography":        _geography(state) or "",
                "primary_subject":  _classify(combo, _SUBJECTS) or "",
                "support_strategy": _classify(combo, _STRATEGIES) or "",
                "grant_amount":     amount or "",
                "description":      desc or "",
                "expense_type":     _categorize(recipient, desc),
            })
    return grants


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    # Find all 2024 ZIPs (skip duplicates like "(1)")
    zips = sorted(
        p for p in ZIP_FOLDER.glob("2024_TEOS_XML_*.zip")
        if "(" not in p.name
    )

    if not zips:
        log.error(f"No 2024 ZIP files found in {ZIP_FOLDER}")
        sys.exit(1)

    log.info(f"Found {len(zips)} ZIP files for 2024:")
    for z in zips:
        log.info(f"  {z.name}  ({z.stat().st_size / 1e9:.2f} GB)")

    t0          = time.time()
    total_rows  = 0

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()

        for i, zip_path in enumerate(zips, 1):
            log.info(f"[{i}/{len(zips)}] Processing {zip_path.name} ...")
            zip_rows = 0
            zip_t0   = time.time()

            try:
                with zipfile.ZipFile(zip_path, "r") as zf:
                    xml_names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
                    log.info(f"  {len(xml_names):,} XML files inside")

                    for xml_name in xml_names:
                        object_id = Path(xml_name).stem.replace("_public", "")
                        try:
                            xml_bytes = zf.read(xml_name)
                        except Exception:
                            continue

                        grants = parse_xml(xml_bytes, object_id)
                        if grants:
                            writer.writerows(grants)
                            zip_rows += len(grants)

            except zipfile.BadZipFile:
                log.warning(f"  Skipping bad ZIP: {zip_path.name}")
                continue

            total_rows += zip_rows
            elapsed = time.time() - zip_t0
            log.info(f"  Done — {zip_rows:,} grants in {elapsed:.0f}s  |  running total: {total_rows:,}")

    total_elapsed = time.time() - t0
    log.info("=" * 55)
    log.info(f"COMPLETE in {total_elapsed / 60:.1f} min")
    log.info(f"Total grants written: {total_rows:,}")
    log.info(f"Output file: {OUT_CSV}")
    log.info("=" * 55)


if __name__ == "__main__":
    main()
