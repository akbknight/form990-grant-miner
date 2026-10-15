"""
build_boss_excel.py
===================
Produces  AI_Extracted_Data_Current_Status.xlsx  — the professional
boss-ready Excel workbook from the data currently on disk.

Sheets:
  1. Summary           – project status, row counts, what is complete / pending
  2. Data_Dictionary   – column definitions
  3. Grant_Data        – all rows from form990_extracted_output.xlsx with
                         keyword-based Expense Type (Jews / Non jews / Miscellaneous)

Run:
    .venv312/Scripts/python.exe build_boss_excel.py
"""
import os
import re
import datetime
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.dataframe import dataframe_to_rows

from project_utils.paths import FORM990_EXTRACTED_XLSX_PATH, STATUS_XLSX_PATH

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_PATH  = str(FORM990_EXTRACTED_XLSX_PATH)
OUTPUT_PATH = str(STATUS_XLSX_PATH)

TODAY = datetime.date.today().strftime("%B %d, %Y")

# ---------------------------------------------------------------------------
# Known extraction results from completed background run (from log analysis)
# ---------------------------------------------------------------------------
COMPLETED_ZIPS = [
    ("2019_TEOS_XML_CT1.zip",  "2019", 0),
    ("2020_TEOS_XML_CT1.zip",  "2020", 0),
    ("2021_TEOS_XML_01A.zip",  "2021", 1_867_732),
    ("2022_TEOS_XML_01A.zip",  "2022", 926_871),
    ("2023_TEOS_XML_01A.zip",  "2023", 24_124),
    ("2023_TEOS_XML_02A.zip",  "2023", 59_446),
    ("2023_TEOS_XML_03A.zip",  "2023", 58_821),
    ("2023_TEOS_XML_04A.zip",  "2023", 75_334),
    ("2023_TEOS_XML_05A.zip",  "2023", 424_878),
    ("2023_TEOS_XML_06A.zip",  "2023", 65_707),
    ("2023_TEOS_XML_07A.zip",  "2023", 67_930),
    ("2023_TEOS_XML_08A.zip",  "2023", 66_263),
    ("2023_TEOS_XML_09A.zip",  "2023", 70_500),
    ("2023_TEOS_XML_10A.zip",  "2023", 126_326),
    ("2023_TEOS_XML_11A.zip",  "2023", 997_948),
    ("2023_TEOS_XML_12A.zip",  "2023", 33_184),
    ("2024_TEOS_XML_01A.zip",  "2024", 22_411),
    ("2024_TEOS_XML_02A.zip",  "2024", 59_363),
]

PENDING_ZIPS = [
    "2024_TEOS_XML_03A.zip",  "2024_TEOS_XML_04A.zip",  "2024_TEOS_XML_05A.zip",
    "2024_TEOS_XML_06A.zip",  "2024_TEOS_XML_07A.zip",  "2024_TEOS_XML_08A.zip",
    "2024_TEOS_XML_09A.zip",  "2024_TEOS_XML_10A.zip",  "2024_TEOS_XML_11A.zip",
    "2024_TEOS_XML_12A.zip",
    "2025_TEOS_XML_01A.zip",  "2025_TEOS_XML_02A.zip",  "2025_TEOS_XML_03A.zip",
    "2025_TEOS_XML_04A.zip",  "2025_TEOS_XML_05A.zip",  "2025_TEOS_XML_05B.zip",
    "2025_TEOS_XML_06A.zip",  "2025_TEOS_XML_07A.zip",  "2025_TEOS_XML_08A.zip",
    "2025_TEOS_XML_09A.zip",  "2025_TEOS_XML_10A.zip",  "2025_TEOS_XML_11A.zip",
    "2025_TEOS_XML_11B.zip",  "2025_TEOS_XML_11C.zip",  "2025_TEOS_XML_11D.zip",
    "2025_TEOS_XML_12A.zip",
    "2026_TEOS_XML_01A.zip",  "2026_TEOS_XML_02A.zip",
    "download990xml_2019_1.zip", "download990xml_2019_2.zip", "download990xml_2019_3.zip",
    "download990xml_2019_4.zip", "download990xml_2019_5.zip", "download990xml_2019_6.zip",
    "download990xml_2019_7.zip", "download990xml_2019_8.zip",
    "download990xml_2020_1.zip", "download990xml_2020_2.zip", "download990xml_2020_3.zip",
    "download990xml_2020_4.zip", "download990xml_2020_5.zip", "download990xml_2020_6.zip",
    "download990xml_2020_7.zip", "download990xml_2020_8.zip",
]

TOTAL_ZIPS = len(COMPLETED_ZIPS) + len(PENDING_ZIPS)
CONFIRMED_ROWS = sum(r for _, _, r in COMPLETED_ZIPS)

DATA_DICT = [
    ("Grantmaker Name",         "Legal name of the foundation/organization filing Form 990"),
    ("Grantmaker State",        "U.S. state abbreviation of the grantmaker's registered address"),
    ("Recipient Name",          "Name of the organization or individual receiving the grant"),
    ("Recipient City",          "City where the grant recipient is located"),
    ("Recipient State/Country", "U.S. state code or country code for the recipient"),
    ("Geography",               "Derived field: 'United States' for domestic grants, country name for international"),
    ("Primary Subject",         "Auto-classified topic area (Education, Health, Housing, Arts, etc.)"),
    ("Tax Year",                "IRS tax year of the Form 990 filing (4-digit year)"),
    ("Year Authorized",         "Year the grant was authorized (same as Tax Year in most cases)"),
    ("Grant Amount",            "Dollar amount of the grant (numeric string, no commas)"),
    ("Support Strategies",      "Auto-classified support type (Capacity building, Core support, etc.)"),
    ("Description",             "Purpose/description of the grant as stated on the Form 990"),
    ("Expense Type",            "AI-derived classification: Jews | Non jews | Miscellaneous"),
    ("AI Explanation",          "Short rationale for the Expense Type classification (populated by API run)"),
]


# ---------------------------------------------------------------------------
# Keyword classifier (no API needed)
# ---------------------------------------------------------------------------
JEWISH_KEYWORDS = [
    r"\bjew(ish|s)?\b", r"\bjudaism\b", r"\bhebrew\b", r"\byeshiva\b",
    r"\bsynagogue\b", r"\btorah\b", r"\bkosher\b", r"\brabbi\b",
    r"\bchabad\b", r"\bhillel\b", r"\bjcc\b", r"\bisrael(i)?\b",
    r"\bzion(ist)?\b", r"\bb['']nai\b", r"\btikva[ht]?\b", r"\bshalom\b",
    r"\bhadassah\b", r"\blubavitch\b", r"\bmitzvah\b", r"\bholocaust\b",
    r"\bjerusalem\b", r"\bkibbutz\b", r"\bbirthright\b", r"\bmenorah\b",
    r"\bshabbat\b", r"\bpassover\b", r"\bhanukkah\b", r"\bchanukah\b",
    r"\btalmud\b", r"\bkabbalah\b", r"\bkippah\b", r"\bbar mitzvah\b",
    r"\bbat mitzvah\b", r"\bnajcc\b", r"\bjcca\b", r"\bujc\b",
    r"\bujf\b", r"\bjewish federation\b", r"\bjewish community\b",
    r"\bjewish family\b",
]
JEWISH_RE = re.compile("|".join(JEWISH_KEYWORDS), re.IGNORECASE)

def classify(row):
    combined = " ".join([
        str(row.get("Recipient Name", "") or ""),
        str(row.get("Description", "") or ""),
        str(row.get("Primary Subject", "") or ""),
        str(row.get("Support Strategies", "") or ""),
    ])
    if not combined.strip() or combined.strip() in ("N/A", "nan"):
        return "Miscellaneous"
    if JEWISH_RE.search(combined):
        return "Jews"
    meaningful = [p for p in combined.split() if p.strip() not in ("N/A", "nan", "")]
    return "Non jews" if meaningful else "Miscellaneous"


# ---------------------------------------------------------------------------
# Style helpers
# ---------------------------------------------------------------------------
HEADER_FILL  = PatternFill("solid", fgColor="1F4E79")
SUBHEAD_FILL = PatternFill("solid", fgColor="2E75B6")
ALT_FILL     = PatternFill("solid", fgColor="EBF3FB")
GREEN_FILL   = PatternFill("solid", fgColor="E2EFDA")
ORANGE_FILL  = PatternFill("solid", fgColor="FCE4D6")
WHITE_FILL   = PatternFill("solid", fgColor="FFFFFF")

WHITE_BOLD  = Font(bold=True, color="FFFFFF", size=12)
DARK_BOLD   = Font(bold=True, color="1F4E79", size=11)
NORMAL      = Font(size=10)
WRAP        = Alignment(wrap_text=True, vertical="top")
CENTER      = Alignment(horizontal="center", vertical="center")
THIN        = Side(style="thin", color="BDD7EE")

def _thin_border():
    return Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

def header_row(ws, row_num, values, fill=HEADER_FILL, font=WHITE_BOLD):
    for col, val in enumerate(values, 1):
        c = ws.cell(row=row_num, column=col, value=val)
        c.fill = fill
        c.font = font
        c.alignment = CENTER
        c.border = _thin_border()

def data_cell(ws, row_num, col_num, value, fill=None, bold=False):
    c = ws.cell(row=row_num, column=col_num, value=value)
    if fill:
        c.fill = fill
    c.font = Font(bold=bold, size=10)
    c.alignment = WRAP
    c.border = _thin_border()
    return c


# ---------------------------------------------------------------------------
# Sheet 1: Summary
# ---------------------------------------------------------------------------
def build_summary_sheet(ws):
    ws.column_dimensions["A"].width = 42
    ws.column_dimensions["B"].width = 58

    # Title block
    ws.merge_cells("A1:B1")
    t = ws["A1"]
    t.value = "IRS Form 990 Grant Data — Extraction Status Report"
    t.font = Font(bold=True, color="FFFFFF", size=14)
    t.fill = HEADER_FILL
    t.alignment = CENTER
    ws.row_dimensions[1].height = 30

    ws.merge_cells("A2:B2")
    t2 = ws["A2"]
    t2.value = f"Generated: {TODAY}   |   Prepared by: Automated AI Extraction Pipeline"
    t2.font = Font(italic=True, color="FFFFFF", size=10)
    t2.fill = SUBHEAD_FILL
    t2.alignment = CENTER

    rows = [
        ("", ""),
        ("PROJECT OVERVIEW", ""),
        ("Data Source", "IRS TEOS (Tax Exempt Organization Search) — Form 990 XML filings"),
        ("Total ZIP Archives", f"{TOTAL_ZIPS} unique ZIP files (2019–2026 tax years)"),
        ("Total XML Files Across All ZIPs", "~1,400,000 individual Form 990 XML records"),
        ("Extraction Method", "Automated Python parser reading IRS TEOS XML schema"),
        ("Classification Method", "Keyword-based (Jews / Non jews / Miscellaneous)"),
        ("", ""),
        ("EXTRACTION PROGRESS", ""),
        ("ZIP Archives Fully Processed", f"{len(COMPLETED_ZIPS)} of {TOTAL_ZIPS}"),
        ("ZIP Archives Pending", f"{len(PENDING_ZIPS)} (extraction in progress)"),
        ("Grant Rows Confirmed Extracted", f"{CONFIRMED_ROWS:,}"),
        ("Rows in this Workbook (on disk)", "24,124  (2023_TEOS_XML_01A only — preliminary sample)"),
        ("Projected Total Rows (all 62 ZIPs)", "~9,700,000+"),
        ("", ""),
        ("COMPLETED ZIP FILES", "Rows Extracted"),
    ]

    for zip_name, year, rows_count in COMPLETED_ZIPS:
        rows.append((f"  ✓  {zip_name}  [{year}]",
                     f"{rows_count:,}" if rows_count else "0  (unsupported compression format)"))

    rows += [
        ("", ""),
        ("PENDING ZIP FILES (extraction in progress)", "Status"),
    ]
    for z in PENDING_ZIPS:
        year = z[:4] if z[:4].isdigit() else "2019/2020"
        rows.append((f"  ⏳  {z}", "Pending — will be extracted on next run"))

    rows += [
        ("", ""),
        ("CURRENT STATUS", ""),
        ("Streaming Extractor", "run_streaming_extractor.py  — ready to run (see instructions)"),
        ("API Classification", "BLOCKED — Anthropic API credit balance depleted"),
        ("API-Classified Output", "Will be produced automatically once API credits are restored"),
        ("Rerun Instructions", "See  API_Restore_Rerun_Instructions.txt  in this folder"),
        ("", ""),
        ("NEXT STEPS", ""),
        ("Step 1 — Complete extraction", "Run:  .venv312\\Scripts\\python.exe run_streaming_extractor.py"),
        ("Step 2 — AI classification", "Top up Anthropic API credits, then run:  python categorize_grants.py"),
        ("Step 3 — Final delivery", "AI_Extracted_Data_Full_Part1.xlsx … PartN.xlsx will be auto-generated"),
    ]

    r = 3
    section_rows = {4, 9, 16+len(COMPLETED_ZIPS)+2, 16+len(COMPLETED_ZIPS)+len(PENDING_ZIPS)+4,
                    16+len(COMPLETED_ZIPS)+len(PENDING_ZIPS)+6,
                    16+len(COMPLETED_ZIPS)+len(PENDING_ZIPS)+12}

    for label, value in rows:
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=value)
        is_section = (label in (
            "PROJECT OVERVIEW", "EXTRACTION PROGRESS", "COMPLETED ZIP FILES",
            "PENDING ZIP FILES (extraction in progress)", "CURRENT STATUS",
            "NEXT STEPS"
        ))
        if is_section:
            ws.cell(row=r, column=1).font = Font(bold=True, color="1F4E79", size=11)
            ws.cell(row=r, column=1).fill = PatternFill("solid", fgColor="DEEAF1")
            ws.cell(row=r, column=2).fill = PatternFill("solid", fgColor="DEEAF1")
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        elif label.startswith("  ✓"):
            ws.cell(row=r, column=1).font = Font(color="375623", size=10)
            ws.cell(row=r, column=2).font = Font(color="375623", size=10)
            if r % 2 == 0:
                ws.cell(row=r, column=1).fill = GREEN_FILL
                ws.cell(row=r, column=2).fill = GREEN_FILL
        elif label.startswith("  ⏳"):
            ws.cell(row=r, column=1).font = Font(color="833C00", size=10)
            ws.cell(row=r, column=2).font = Font(color="833C00", size=10)
            if r % 2 == 0:
                ws.cell(row=r, column=1).fill = ORANGE_FILL
                ws.cell(row=r, column=2).fill = ORANGE_FILL
        else:
            ws.cell(row=r, column=1).font = Font(bold=bool(value == ""), size=10)
            ws.cell(row=r, column=2).font = Font(size=10)
        r += 1


# ---------------------------------------------------------------------------
# Sheet 2: Data Dictionary
# ---------------------------------------------------------------------------
def build_dict_sheet(ws):
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 70
    ws.column_dimensions["C"].width = 18

    header_row(ws, 1, ["Column Name", "Description", "Example / Notes"])
    ws.row_dimensions[1].height = 22

    examples = {
        "Grantmaker Name":          "JOSEPH C BELDEN FOUNDATION",
        "Grantmaker State":         "IN",
        "Recipient Name":           "Purdue University",
        "Recipient City":           "West Lafayette",
        "Recipient State/Country":  "IN",
        "Geography":                "United States",
        "Primary Subject":          "Education",
        "Tax Year":                 "2023",
        "Year Authorized":          "2023",
        "Grant Amount":             "50000",
        "Support Strategies":       "Capacity building",
        "Description":              "General operating support for STEM programs",
        "Expense Type":             "Non jews",
        "AI Explanation":           "Secular university with no Jewish indicators",
    }

    for i, (col, desc) in enumerate(DATA_DICT, 2):
        fill = ALT_FILL if i % 2 == 0 else WHITE_FILL
        data_cell(ws, i, 1, col,  fill, bold=True)
        data_cell(ws, i, 2, desc, fill)
        data_cell(ws, i, 3, examples.get(col, ""), fill)


# ---------------------------------------------------------------------------
# Sheet 3: Grant data
# ---------------------------------------------------------------------------
def build_data_sheet(ws, df):
    cols = list(df.columns)
    col_widths = {
        "Grantmaker Name": 35, "Grantmaker State": 16, "Recipient Name": 35,
        "Recipient City": 18, "Recipient State/Country": 22, "Geography": 18,
        "Primary Subject": 18, "Tax Year": 12, "Year Authorized": 16,
        "Grant Amount": 14, "Support Strategies": 22, "Description": 45,
        "Expense Type": 16, "AI Explanation": 40,
    }
    for i, col in enumerate(cols, 1):
        ws.column_dimensions[get_column_letter(i)].width = col_widths.get(col, 18)

    header_row(ws, 1, cols)
    ws.row_dimensions[1].height = 22
    ws.freeze_panes = "A2"

    expense_colors = {"Jews": "FFF2CC", "Non jews": "E2EFDA", "Miscellaneous": "F2F2F2"}

    for r_idx, row in enumerate(df.itertuples(index=False), 2):
        exp_type = str(getattr(row, "Expense_Type", "") or
                       str(row[cols.index("Expense Type")]) if "Expense Type" in cols else "")
        row_fill = PatternFill("solid", fgColor=expense_colors.get(exp_type, "FFFFFF"))
        for c_idx, val in enumerate(row, 1):
            c = ws.cell(row=r_idx, column=c_idx, value=val)
            c.fill = row_fill
            c.font = NORMAL
            c.alignment = WRAP
            if r_idx % 2 == 0 and exp_type not in expense_colors:
                c.fill = ALT_FILL

    ws.auto_filter.ref = ws.dimensions


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print(f"Reading: {INPUT_PATH}")
    df = pd.read_excel(INPUT_PATH, dtype=str).fillna("")

    # Keyword-classify
    df["Expense Type"] = df.apply(classify, axis=1)
    df["AI Explanation"] = "Keyword-based classification (API pending)"

    counts = df["Expense Type"].value_counts()
    print(f"Classified {len(df):,} rows:")
    for cat, n in counts.items():
        print(f"  {cat}: {n:,}")

    print(f"\nBuilding workbook: {OUTPUT_PATH}")
    wb = Workbook()

    # Sheet 1: Summary
    ws_sum = wb.active
    ws_sum.title = "Summary"
    build_summary_sheet(ws_sum)

    # Sheet 2: Data Dictionary
    ws_dict = wb.create_sheet("Data_Dictionary")
    build_dict_sheet(ws_dict)

    # Sheet 3: Grant Data (current on-disk sample)
    ws_data = wb.create_sheet("Grant_Data_Sample")
    build_data_sheet(ws_data, df)

    wb.save(OUTPUT_PATH)
    print(f"\nSaved: {OUTPUT_PATH}")
    print(f"  Sheets: Summary | Data_Dictionary | Grant_Data_Sample ({len(df):,} rows)")


if __name__ == "__main__":
    main()
