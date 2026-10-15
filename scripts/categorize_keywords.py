"""
categorize_keywords.py
======================
Pure-Python keyword-based classification — no API needed.
Reads form990_extracted_output.xlsx, adds "Expense Type" column,
writes categorized_grants_output.xlsx.
"""
import os
import re
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_PATH  = os.path.join(BASE_DIR, "form990_extracted_output.xlsx")
OUTPUT_PATH = os.path.join(BASE_DIR, "categorized_grants_output.xlsx")

# Keywords that indicate Jewish / Israel focus
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
    r"\bjewish family\b", r"\bjewish voice\b", r"\bjewish fund\b",
    r"\bfriends of israel\b", r"\bstate of israel\b",
]

JEWISH_RE = re.compile("|".join(JEWISH_KEYWORDS), re.IGNORECASE)


def classify(row: pd.Series) -> str:
    text_parts = [
        str(row.get("Recipient Name", "") or ""),
        str(row.get("Description", "") or ""),
        str(row.get("Primary Subject", "") or ""),
        str(row.get("Support Strategies", "") or ""),
    ]
    combined = " ".join(text_parts)

    if not combined.strip() or combined.strip() in ("N/A", "nan"):
        return "Miscellaneous"

    if JEWISH_RE.search(combined):
        return "Jews"

    # Require at least some real content to call it Non-Jews
    meaningful = [p for p in text_parts if p.strip() and p.strip() not in ("N/A", "nan")]
    if meaningful:
        return "Non jews"

    return "Miscellaneous"


def main():
    print(f"Reading: {INPUT_PATH}")
    df = pd.read_excel(INPUT_PATH, dtype=str)
    df = df.fillna("")
    print(f"Rows loaded: {len(df)}")

    df["Expense Type"] = df.apply(classify, axis=1)

    counts = df["Expense Type"].value_counts()
    print("\nCategory counts:")
    for cat, n in counts.items():
        print(f"  {cat}: {n:,}")

    df.to_excel(OUTPUT_PATH, index=False)
    print(f"\nDone. Wrote {len(df):,} rows to:\n  {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
