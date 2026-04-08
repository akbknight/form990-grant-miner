"""
run_streaming_extractor.py
==========================
Streams Form 990 grant data ZIP-by-ZIP to CSV — no Excel row-limit crash.
Writes data to disk after EVERY ZIP so progress is never lost.
When complete, auto-splits into Excel part files (~900k rows each) and
applies keyword classification (Jews / Non jews / Miscellaneous).

HOW TO RUN
----------
    .venv312\\Scripts\\python.exe run_streaming_extractor.py

OUTPUT FILES
------------
    form990_streaming_output.csv           – full merged dataset (all ZIPs)
    AI_Extracted_Data_Full_Part1.xlsx      – rows 1 – 900,000
    AI_Extracted_Data_Full_Part2.xlsx      – rows 900,001 – 1,800,000
    … and so on until all rows are covered
    extraction_progress.log               – live progress log
"""

import os, re, csv, sys, zipfile, logging, datetime, xml.etree.ElementTree as ET
from typing import Dict, List, Optional
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_CSV   = os.path.join(BASE_DIR, "form990_streaming_output.csv")
PROGRESS_LOG = os.path.join(BASE_DIR, "extraction_progress.log")
ROWS_PER_EXCEL_PART = 900_000
MISSING_VALUE = "N/A"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(PROGRESS_LOG, mode="a", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

SUPPORTED_ZIP_METHODS = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA}

TARGET_COLUMNS = [
    "Grantmaker Name", "Grantmaker State", "Recipient Name", "Recipient City",
    "Recipient State/Country", "Geography", "Primary Subject", "Tax Year",
    "Year Authorized", "Grant Amount", "Support Strategies", "Description",
    "Expense Type",
]

# ----- ZIP sources (deduped) -----
INPUT_FOLDERS = [
    os.path.join(BASE_DIR, "Form 990"),
    os.path.join(BASE_DIR, r"OneDrive_2026-03-29\new data"),
]

# ----- Keyword classifier -----
JEWISH_RE = re.compile("|".join([
    r"\bjew(ish|s)?\b", r"\bjudaism\b", r"\bhebrew\b", r"\byeshiva\b",
    r"\bsynagogue\b", r"\btorah\b", r"\bkosher\b", r"\brabbi\b",
    r"\bchabad\b", r"\bhillel\b", r"\bjcc\b", r"\bisrael(i)?\b",
    r"\bzion(ist)?\b", r"\bb['']nai\b", r"\btikva[ht]?\b", r"\bshalom\b",
    r"\bhadassah\b", r"\blubavitch\b", r"\bmitzvah\b", r"\bholocaust\b",
    r"\bjerusalem\b", r"\bkibbutz\b", r"\bbirthright\b", r"\bmenorah\b",
    r"\bshabbat\b", r"\bpassover\b", r"\bhanukkah\b", r"\bchanukah\b",
    r"\btalmud\b", r"\bkabbalah\b", r"\bkippah\b", r"\bbar mitzvah\b",
    r"\bbat mitzvah\b", r"\bjewish federation\b", r"\bjewish community\b",
    r"\bjewish family\b",
]), re.IGNORECASE)

def classify(recipient, description, subject, strategies):
    combined = f"{recipient} {description} {subject} {strategies}"
    if not combined.strip():
        return "Miscellaneous"
    if JEWISH_RE.search(combined):
        return "Jews"
    return "Non jews" if combined.strip() else "Miscellaneous"


# ----- XML helpers -----
def _clean(text):
    return re.sub(r"\s+", " ", str(text)).strip() if text else ""

def _ns_uri(root):
    if root.tag.startswith("{") and "}" in root.tag:
        return root.tag[1:root.tag.index("}")]
    return ""

def _find(elem, path, ns):
    parts = [p for p in path.split("/") if p]
    if ns:
        xpath = ".//" + "/".join(f"{{{ns}}}{p}" for p in parts)
    else:
        xpath = ".//" + "/".join(parts)
    found = elem.find(xpath)
    return _clean(found.text) if found is not None and found.text else ""

def _year(text):
    m = re.search(r"(19|20)\d{2}", str(text))
    return m.group(0) if m else ""

def _amount(text):
    text = _clean(text)
    if not text:
        return ""
    try:
        v = float(text.replace(",", ""))
        return str(int(v)) if v.is_integer() else str(v)
    except ValueError:
        return text

def _geography(state_country):
    if not state_country:
        return ""
    up = state_country.strip().upper()
    if up in {"US", "U.S.", "USA", "UNITED STATES"} or len(up) == 2:
        return "United States"
    return state_country

def _subject(desc):
    t = desc.lower()
    for subj, kws in [
        ("Education",     ["school","college","university","education","student","scholarship"]),
        ("Health",        ["health","hospital","medical","maternal","mental health","nursing"]),
        ("Housing",       ["housing","shelter","homeless"]),
        ("Employment",    ["workforce","employment","job","career","entrepreneur"]),
        ("Arts And Culture", ["arts","culture","artist","museum","theater"]),
        ("Food Security", ["food","hunger","nutrition"]),
    ]:
        if any(w in t for w in kws):
            return subj
    return ""

def _strategy(desc):
    t = desc.lower()
    for strat, kws in [
        ("Conferences and exhibits",            ["conference","summit","exhibit"]),
        ("Internships",                         ["internship","apprentice"]),
        ("Capacity building",                   ["training","capacity","technical assistance"]),
        ("Leadership and professional development", ["leadership","professional development"]),
        ("Core support",                        ["core support","general support","operating support"]),
    ]:
        if any(w in t for w in kws):
            return strat
    return ""

def extract_rows_from_root(root, source_name=""):
    ns = _ns_uri(root)
    filer = root.find(f".//{{{ns}}}Filer" if ns else ".//Filer") or root
    gmaker_name = (
        _find(filer, "BusinessName/BusinessNameLine1Txt", ns)
        or _find(filer, "Name/BusinessNameLine1Txt", ns)
        or _find(filer, "BusinessNameLine1Txt", ns)
    )
    gmaker_state = (
        _find(filer, "USAddress/StateAbbreviationCd", ns)
        or _find(filer, "ForeignAddress/CountryCd", ns)
    )
    tax_year = _year(_find(root, "TaxYr", ns) or _find(root, "TaxPeriodEndDt", ns)) or _year(source_name)

    rows = []
    for grp_name in ["GrantOrContributionPdDurYrGrp", "RecipientTableGrp"]:
        xpath = f".//{{{ns}}}{grp_name}" if ns else f".//{grp_name}"
        for grp in root.findall(xpath):
            rname = (
                _find(grp, "RecipientBusinessName/BusinessNameLine1Txt", ns)
                or _find(grp, "RecipientPersonNm", ns)
                or _find(grp, "RecipientNameTxt", ns)
            )
            rcity = _find(grp, "RecipientUSAddress/CityNm", ns) or _find(grp, "RecipientAddress/CityNm", ns)
            rstate = (
                _find(grp, "RecipientUSAddress/StateAbbreviationCd", ns)
                or _find(grp, "RecipientForeignAddress/CountryCd", ns)
                or _find(grp, "RecipientAddress/CountryCd", ns)
            )
            amount = _amount(_find(grp, "Amt", ns) or _find(grp, "CashGrantAmt", ns))
            desc = (
                _find(grp, "GrantOrContributionPurposeTxt", ns)
                or _find(grp, "PurposeOfGrantTxt", ns)
                or _find(grp, "PurposeTxt", ns)
            )
            if not any([rname, amount, desc]):
                continue
            subj = _subject(desc)
            strat = _strategy(desc)
            geo   = _geography(rstate)
            exp   = classify(rname, desc, subj, strat)
            rows.append([
                gmaker_name or MISSING_VALUE,
                gmaker_state or MISSING_VALUE,
                rname or MISSING_VALUE,
                rcity or MISSING_VALUE,
                rstate or MISSING_VALUE,
                geo or MISSING_VALUE,
                subj or MISSING_VALUE,
                tax_year or MISSING_VALUE,
                tax_year or MISSING_VALUE,
                amount or MISSING_VALUE,
                strat or MISSING_VALUE,
                desc or MISSING_VALUE,
                exp,
            ])
    return rows


def collect_zips(input_folders):
    zip_seen = {}
    for folder in input_folders:
        if not os.path.isdir(folder):
            log.warning("Folder not found: %s", folder)
            continue
        for root_dir, _, files in os.walk(folder):
            for name in files:
                if not name.lower().endswith(".zip"):
                    continue
                canonical = re.sub(r"\s*\(\d+\)(?=\.zip$)", "", name.lower())
                has_suffix = canonical != name.lower()
                full = os.path.join(root_dir, name)
                if canonical not in zip_seen:
                    zip_seen[canonical] = (full, has_suffix)
                elif zip_seen[canonical][1] and not has_suffix:
                    zip_seen[canonical] = (full, has_suffix)
    return sorted(path for path, _ in zip_seen.values())


def write_excel_part(rows_chunk, part_num, total_so_far):
    out_path = os.path.join(BASE_DIR, f"AI_Extracted_Data_Full_Part{part_num}.xlsx")
    log.info("Writing Excel Part %d (%d rows) → %s", part_num, len(rows_chunk), out_path)
    df = pd.DataFrame(rows_chunk, columns=TARGET_COLUMNS)

    wb = Workbook()
    ws = wb.active
    ws.title = f"Grants_Part{part_num}"

    HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
    expense_colors = {"Jews": "FFF2CC", "Non jews": "E2EFDA", "Miscellaneous": "F2F2F2"}
    col_widths = [35,16,35,18,22,18,18,12,16,14,22,45,16]

    for i, col in enumerate(TARGET_COLUMNS, 1):
        ws.column_dimensions[get_column_letter(i)].width = col_widths[i-1]
        c = ws.cell(row=1, column=i, value=col)
        c.fill = HEADER_FILL
        c.font = Font(bold=True, color="FFFFFF", size=11)
        c.alignment = Alignment(horizontal="center", vertical="center")

    ws.freeze_panes = "A2"

    for r_idx, row in enumerate(df.itertuples(index=False), 2):
        exp_type = row[-1]
        row_fill = PatternFill("solid", fgColor=expense_colors.get(exp_type, "FFFFFF"))
        for c_idx, val in enumerate(row, 1):
            c = ws.cell(row=r_idx, column=c_idx, value=val)
            c.fill = row_fill
            c.font = Font(size=10)
            c.alignment = Alignment(wrap_text=True, vertical="top")

    ws.auto_filter.ref = ws.dimensions
    wb.save(out_path)
    log.info("  Saved Part %d: %s", part_num, out_path)


def main():
    zip_files = collect_zips(INPUT_FOLDERS)
    log.info("Found %d unique ZIP files", len(zip_files))

    # Open CSV for streaming write
    csv_exists = os.path.exists(OUTPUT_CSV)
    csv_file = open(OUTPUT_CSV, "a", newline="", encoding="utf-8-sig")
    writer = csv.writer(csv_file)
    if not csv_exists:
        writer.writerow(TARGET_COLUMNS)

    total_rows = 0
    part_num = 1
    part_buffer = []

    # Count existing CSV rows to resume correctly
    if csv_exists:
        with open(OUTPUT_CSV, "r", encoding="utf-8-sig") as f:
            total_rows = sum(1 for _ in f) - 1  # minus header
        log.info("Resuming — CSV already has %d rows", total_rows)
        part_num = (total_rows // ROWS_PER_EXCEL_PART) + 1

    for zip_idx, zip_path in enumerate(zip_files, 1):
        zip_name = os.path.basename(zip_path)
        log.info("[%d/%d] Processing: %s", zip_idx, len(zip_files), zip_name)
        zip_rows = 0
        skipped = 0

        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                xml_infos = [i for i in zf.infolist() if i.filename.lower().endswith(".xml")]
                for info in xml_infos:
                    if info.compress_type not in SUPPORTED_ZIP_METHODS:
                        skipped += 1
                        continue
                    try:
                        root = ET.fromstring(zf.read(info))
                        rows = extract_rows_from_root(root, source_name=info.filename)
                        for row in rows:
                            writer.writerow(row)
                            part_buffer.append(row)
                            zip_rows += 1
                            total_rows += 1
                            # Flush Excel part when buffer hits limit
                            if len(part_buffer) >= ROWS_PER_EXCEL_PART:
                                write_excel_part(part_buffer, part_num, total_rows)
                                part_num += 1
                                part_buffer = []
                    except (ET.ParseError, NotImplementedError):
                        skipped += 1
                    except Exception as exc:
                        log.warning("  Skip %s: %s", info.filename, exc)
                        skipped += 1
        except zipfile.BadZipFile:
            log.error("Bad ZIP: %s", zip_name)
        except Exception as exc:
            log.error("Error processing %s: %s", zip_name, exc)

        csv_file.flush()
        if skipped:
            log.info("  Skipped %d entries (unsupported format)", skipped)
        log.info("  Done %s: %d rows  |  Total so far: %d", zip_name, zip_rows, total_rows)

    csv_file.close()

    # Write final partial Excel part
    if part_buffer:
        write_excel_part(part_buffer, part_num, total_rows)

    log.info("=" * 60)
    log.info("COMPLETE. Total rows: %d", total_rows)
    log.info("CSV: %s", OUTPUT_CSV)
    log.info("Excel parts: AI_Extracted_Data_Full_Part1.xlsx ... Part%d.xlsx", part_num)
    log.info("=" * 60)


if __name__ == "__main__":
    main()
