"""
categorize.py  —  Phase 3: AI Categorization
=============================================
Pulls uncategorized grants from Neon Postgres, classifies them using
strict regex/keyword matching (zero API credits), updates the DB.

Three categories established from prior sessions:
  • Jews         — grants to Jewish organizations, causes, Israel-related
  • Non-Jews     — grants to clearly non-Jewish organizations
  • Miscellaneous — ambiguous, generic, or unclassifiable

Run:
    python categorize.py                    # categorize all pending
    python categorize.py --limit 50000      # batch limit
    python categorize.py --stats            # show category counts
"""

import logging
import re
import sys
import argparse
from typing import List, Tuple, Optional

import psycopg2
import psycopg2.extras

import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Classification rules
# (57 Jewish keywords — same logic established in prior sessions)
# ═══════════════════════════════════════════════════════════════════════════════

# Jewish regex — matches any of 57+ terms (case-insensitive, whole-word aware)
_JEWISH_TERMS = [
    # Core identity words
    r"\bjew(?:ish|s)?\b",
    r"\bjudai(?:sm|c|st)\b",
    r"\bhebre(?:w|ws)\b",
    r"\bisrael(?:i|is|ite|ites)?\b",
    r"\bzioni(?:sm|st|sts)?\b",
    r"\bsemit(?:ic|ism|e)?\b",

    # Religious institutions
    r"\bsynagog(?:ue|ues)\b",
    r"\bshul\b",
    r"\btemple\b",
    r"\byeshiv(?:a|ah|ot)\b",
    r"\bday school\b",
    r"\bmidrash(?:a|ah)?\b",
    r"\bkosher\b",
    r"\bkashrut\b",
    r"\bsabbath\b",
    r"\bshabbat\b",
    r"\bshabbos\b",
    r"\bpassover\b",
    r"\bpesach\b",
    r"\bhanukkah\b",
    r"\bchanukah\b",
    r"\brosh hashanah\b",
    r"\byom kippur\b",
    r"\bsukkot\b",

    # Organizations / federations
    r"\bjcc\b",
    r"\bjewish federation\b",
    r"\bjewish community\b",
    r"\bjewish fund\b",
    r"\bjewish foundation\b",
    r"\bjewish family\b",
    r"\bjewish board\b",
    r"\bjewish council\b",
    r"\bjewish alliance\b",
    r"\bjewish center\b",
    r"\bjewish agency\b",
    r"\bjewish welfare\b",
    r"\bnational jewish\b",
    r"\bamerican jewish\b",
    r"\bhadassah\b",
    r"\bnei brith\b",
    r"\bb\'nai\b",
    r"\bbnai\b",
    r"\baish\b",
    r"\bchabad\b",
    r"\blubavitch\b",
    r"\borthodox union\b",
    r"\bunion of orthodox\b",
    r"\boj\.org\b",
    r"\bujia?\b",
    r"\bjafi\b",

    # Holocaust / anti-semitism
    r"\bholocaust\b",
    r"\bshoah\b",
    r"\bantisemiti(?:c|sm|st)\b",
    r"\banti-semiti(?:c|sm|st)\b",
    r"\banti-jewish\b",

    # Israel geography / orgs
    r"\btel aviv\b",
    r"\bjerusalem\b",
    r"\bwest bank\b",
    r"\bgaza\b",
    r"\bmossad\b",
    r"\bidf\b",

    # Hebrew terms common in grants
    r"\btikkun olam\b",
    r"\btzedakah\b",
    r"\bkehilla(?:h)?\b",
    r"\bgemach\b",
    r"\brabbini(?:c|cal)\b",
    r"\brabbi\b",
    r"\bcantor\b",
    r"\bbar mitzvah\b",
    r"\bbat mitzvah\b",
    r"\bminyan\b",
]

JEWISH_RE = re.compile("|".join(_JEWISH_TERMS), re.IGNORECASE)


def classify_grant(recipient: Optional[str], description: Optional[str]) -> str:
    """
    Classify a single grant into one of three categories.

    Logic:
      1. Combine recipient + description into one text blob
      2. If ANY Jewish keyword matches → 'Jews'
      3. Otherwise → 'Non-Jews' (most grants are clearly non-Jewish)
      4. If both fields are blank → 'Miscellaneous'
    """
    text = f"{recipient or ''} {description or ''}".strip()

    if not text:
        return "Miscellaneous"

    if JEWISH_RE.search(text):
        return "Jews"

    return "Non-Jews"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Database operations
# ═══════════════════════════════════════════════════════════════════════════════

def get_db_conn():
    from stream_pipeline import get_db_conn as _get
    return _get()


def get_uncategorized_batch(conn, batch_size: int = 5000) -> List[Tuple]:
    """Fetch a batch of uncategorized grants (id, recipient, description)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, recipient, description
            FROM   irs_grants
            WHERE  expense_type = 'Uncategorized'
            LIMIT  %s
        """, (batch_size,))
        return cur.fetchall()


def update_expense_types(conn, updates: List[Tuple[str, int]]):
    """Bulk-update expense_type for a list of (category, id) pairs."""
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            "UPDATE irs_grants SET expense_type = data.cat FROM (VALUES %s) AS data(cat, id) WHERE irs_grants.id = data.id::bigint",
            updates,
            template="(%s, %s)",
            page_size=1000,
        )
    conn.commit()


def print_stats(conn):
    """Print category distribution from the database."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT expense_type, COUNT(*) AS n, SUM(amount) AS total_usd
            FROM   irs_grants
            GROUP  BY expense_type
            ORDER  BY n DESC
        """)
        rows = cur.fetchall()

    log.info("")
    log.info("┌─────────────────────────────────────────────────────┐")
    log.info("│  GRANT CATEGORY DISTRIBUTION                        │")
    log.info("├─────────────────────┬───────────────┬───────────────┤")
    log.info("│  Category           │  Grant Count  │  Total USD    │")
    log.info("├─────────────────────┼───────────────┼───────────────┤")
    for category, count, total in rows:
        amt = f"${total:,.0f}" if total else "N/A"
        log.info("│  %-19s │ %13s │ %13s │",
                 category or "NULL", f"{count:,}", amt)
    log.info("└─────────────────────┴───────────────┴───────────────┘")
    log.info("")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Main loop
# ═══════════════════════════════════════════════════════════════════════════════

def run_categorization(limit: Optional[int] = None):
    """
    Pull uncategorized grants in batches, classify each one using
    keyword regex (free, instant), write results back to Neon.
    """
    conn        = get_db_conn()
    total_done  = 0
    batch_size  = 5000

    log.info("Starting keyword categorization...")

    while True:
        fetch_n = min(batch_size, limit - total_done) if limit else batch_size
        rows    = get_uncategorized_batch(conn, fetch_n)

        if not rows:
            break

        updates = []
        counts  = {"Jews": 0, "Non-Jews": 0, "Miscellaneous": 0}

        for row_id, recipient, description in rows:
            category = classify_grant(recipient, description)
            updates.append((category, row_id))
            counts[category] += 1

        update_expense_types(conn, updates)
        total_done += len(rows)

        log.info(
            "  Batch done: %d rows | Jews=%d  Non-Jews=%d  Misc=%d | Total=%d",
            len(rows), counts["Jews"], counts["Non-Jews"],
            counts["Miscellaneous"], total_done
        )

        if limit and total_done >= limit:
            break

    log.info("Categorization complete. Total classified: %d", total_done)
    print_stats(conn)
    conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Phase 3: Keyword-classify uncategorized grants in Neon Postgres"
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="Max grants to classify (default: all)")
    parser.add_argument("--stats", action="store_true",
                        help="Show category counts and exit")
    args = parser.parse_args()

    conn = get_db_conn()
    if args.stats:
        print_stats(conn)
        conn.close()
        return
    conn.close()

    run_categorization(limit=args.limit)


if __name__ == "__main__":
    main()
