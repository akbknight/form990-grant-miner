"""
classify_and_split.py
=====================
Reads the full 9.7M-row form990_extracted_output.csv, applies keyword-based
classification (Jews / Non jews / Miscellaneous), and writes split Excel files:
    AI_Extracted_Data_Full_Part1.xlsx  (rows 1-900,000)
    AI_Extracted_Data_Full_Part2.xlsx  (rows 900,001-1,800,000)
    ... etc.

No API needed. Pure Python + pandas.
Run:
    .venv312\\Scripts\\python.exe classify_and_split.py
"""

import os, re, sys, time
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
INPUT_CSV   = os.path.join(BASE_DIR, "form990_extracted_output.csv")
ROWS_PER_PART = 900_000
CHUNK_SIZE    = 100_000   # rows read at a time (keeps RAM low)

TARGET_COLUMNS = [
    "Grantmaker Name", "Grantmaker State", "Recipient Name", "Recipient City",
    "Recipient State/Country", "Geography", "Primary Subject", "Tax Year",
    "Year Authorized", "Grant Amount", "Support Strategies", "Description",
    "Expense Type",
]

# ── Keyword classifier ──────────────────────────────────────────────────────
JEWISH_RE = re.compile("|".join([
    r"\bjew(?:ish|s)?\b", r"\bjudaism\b", r"\bhebrew\b", r"\byeshiva\b",
    r"\bsynagogue\b", r"\btorah\b", r"\bkosher\b", r"\brabbi\b",
    r"\bchabad\b", r"\bhillel\b", r"\bjcc\b", r"\bisrael(?:i)?\b",
    r"\bzion(?:ist)?\b", r"\bb['\u2019]nai\b", r"\btikva[ht]?\b", r"\bshalom\b",
    r"\bhadassah\b", r"\blubavitch\b", r"\bmitzvah\b", r"\bholocaust\b",
    r"\bjerusalem\b", r"\bkibbutz\b", r"\bbirthright\b", r"\bmenorah\b",
    r"\bshabbat\b", r"\bpassover\b", r"\bhanukkah\b", r"\bchanukah\b",
    r"\btalmud\b", r"\bkabbalah\b", r"\bkippah\b", r"\bbar mitzvah\b",
    r"\bbat mitzvah\b", r"\bjewish federation\b", r"\bjewish community\b",
    r"\bjewish family\b", r"\bjewish fund\b", r"\bfriends of israel\b",
]), re.IGNORECASE)

def classify_series(df: pd.DataFrame) -> pd.Series:
    combined = (
        df.get("Recipient Name", "").fillna("").astype(str) + " " +
        df.get("Description",    "").fillna("").astype(str) + " " +
        df.get("Primary Subject","").fillna("").astype(str) + " " +
        df.get("Support Strategies","").fillna("").astype(str)
    )
    result = combined.apply(
        lambda t: "Jews" if JEWISH_RE.search(t)
                  else ("Miscellaneous" if not t.strip() or t.strip() in ("N/A","nan")
                        else "Non jews")
    )
    return result


# ── Excel writer ────────────────────────────────────────────────────────────
HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
EXPENSE_COLORS = {"Jews": "FFF2CC", "Non jews": "E2EFDA", "Miscellaneous": "F2F2F2"}
COL_WIDTHS = [35,16,35,18,22,18,18,12,16,14,22,45,16]

def save_part(rows_buffer: list, part_num: int):
    out = os.path.join(BASE_DIR, f"AI_Extracted_Data_Full_Part{part_num}.xlsx")
    print(f"\n  Writing Part {part_num}: {len(rows_buffer):,} rows -> {out}")
    t0 = time.time()

    wb = Workbook(write_only=False)
    ws = wb.active
    ws.title = f"Grants_Part{part_num}"
    ws.freeze_panes = "A2"

    for i, col in enumerate(TARGET_COLUMNS, 1):
        ws.column_dimensions[get_column_letter(i)].width = COL_WIDTHS[i-1]
        c = ws.cell(row=1, column=i, value=col)
        c.fill = HEADER_FILL
        c.font = Font(bold=True, color="FFFFFF", size=11)
        c.alignment = Alignment(horizontal="center", vertical="center")

    for r_idx, row in enumerate(rows_buffer, 2):
        exp = row[-1]
        fill = PatternFill("solid", fgColor=EXPENSE_COLORS.get(exp, "FFFFFF"))
        alt  = PatternFill("solid", fgColor="F2F2F2") if r_idx % 2 == 0 else None
        for c_idx, val in enumerate(row, 1):
            c = ws.cell(row=r_idx, column=c_idx, value=val)
            c.fill = fill
            c.font = Font(size=10)
            c.alignment = Alignment(wrap_text=False, vertical="top")

    ws.auto_filter.ref = ws.dimensions
    wb.save(out)
    print(f"  Saved Part {part_num} in {time.time()-t0:.0f}s")


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    if not os.path.exists(INPUT_CSV):
        print(f"ERROR: Input not found: {INPUT_CSV}")
        sys.exit(1)

    # Count total rows for progress display
    print("Counting rows in CSV...")
    with open(INPUT_CSV, "r", encoding="utf-8-sig", errors="replace") as f:
        total_rows = sum(1 for _ in f) - 1  # minus header
    print(f"Total rows: {total_rows:,}")

    part_num    = 1
    part_buffer = []
    processed   = 0
    jews = non_jews = misc = 0
    t_start = time.time()

    reader = pd.read_csv(
        INPUT_CSV,
        dtype=str,
        chunksize=CHUNK_SIZE,
        encoding="utf-8-sig",
        on_bad_lines="skip",
    )

    for chunk_num, chunk in enumerate(reader, 1):
        chunk = chunk.fillna("")

        # Ensure Expense Type column exists (may already be set)
        chunk["Expense Type"] = classify_series(chunk)

        # Ensure all target columns present
        for col in TARGET_COLUMNS:
            if col not in chunk.columns:
                chunk[col] = "N/A"

        chunk_data = chunk[TARGET_COLUMNS].values.tolist()

        for row in chunk_data:
            exp = row[-1]
            if exp == "Jews":       jews += 1
            elif exp == "Non jews": non_jews += 1
            else:                   misc += 1

            part_buffer.append(row)
            processed += 1

            if len(part_buffer) >= ROWS_PER_PART:
                save_part(part_buffer, part_num)
                part_num += 1
                part_buffer = []

        elapsed = time.time() - t_start
        pct = processed / total_rows * 100
        rate = processed / elapsed if elapsed > 0 else 0
        eta  = (total_rows - processed) / rate if rate > 0 else 0
        print(
            f"  Chunk {chunk_num:4d} | {processed:>9,}/{total_rows:,} ({pct:5.1f}%) | "
            f"{rate:,.0f} rows/s | ETA {eta/60:.1f} min",
            end="\r", flush=True,
        )

    # Final partial part
    if part_buffer:
        save_part(part_buffer, part_num)

    elapsed = time.time() - t_start
    print(f"\n\nDONE in {elapsed/60:.1f} minutes")
    print(f"  Total rows classified : {processed:,}")
    print(f"  Jews                  : {jews:,}  ({jews/processed*100:.2f}%)")
    print(f"  Non jews              : {non_jews:,}  ({non_jews/processed*100:.2f}%)")
    print(f"  Miscellaneous         : {misc:,}  ({misc/processed*100:.2f}%)")
    print(f"  Excel parts written   : {part_num}")
    print(f"\nFiles:")
    for i in range(1, part_num + 1):
        p = os.path.join(BASE_DIR, f"AI_Extracted_Data_Full_Part{i}.xlsx")
        if os.path.exists(p):
            size_mb = os.path.getsize(p) / 1024 / 1024
            print(f"  AI_Extracted_Data_Full_Part{i}.xlsx  ({size_mb:.0f} MB)")


if __name__ == "__main__":
    main()
