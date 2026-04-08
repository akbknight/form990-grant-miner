"""
irs_pipeline/ai_categorizer.py
================================
PHASE 3 — AI Categorization  (Anthropic API, strict cost control)

COST SAFEGUARDS (mandatory, as requested):
  1. SQLite cache  — never sends the same recipient+description twice
  2. Batch prompts — 10 grants per API call (reduces system-prompt overhead ~10x)
  3. Cheapest model — claude-haiku (fastest, lowest cost)
  4. Keyword pre-filter — rows already confidently classified by regex are
                          SKIPPED (saves ~95% of API calls)
  5. Retry with backoff — tenacity handles rate limits gracefully
  6. Dry-run mode — estimate cost before spending anything

Run:
    # Dry run — see how many rows need AI + estimated cost
    .venv312\\Scripts\\python.exe -m irs_pipeline.ai_categorizer --dry-run

    # Run on up to 1000 uncategorized rows (test)
    .venv312\\Scripts\\python.exe -m irs_pipeline.ai_categorizer --limit 1000

    # Full run
    .venv312\\Scripts\\python.exe -m irs_pipeline.ai_categorizer

    # Re-run only on Miscellaneous rows (ambiguous ones)
    .venv312\\Scripts\\python.exe -m irs_pipeline.ai_categorizer --reprocess-misc
"""

import hashlib
import json
import logging
import sqlite3
import sys
import time
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional, Dict, Tuple

import psycopg2
import psycopg2.extras

from tenacity import (
    retry, stop_after_attempt, wait_exponential,
    retry_if_exception_type, before_sleep_log,
)

from irs_pipeline import config
from irs_pipeline.db_sqlite import get_sqlite_conn, init_sqlite_schema
from irs_db.loader import get_conn as get_pg_conn

log = logging.getLogger(__name__)

# ── Cost constants (Haiku pricing as of 2025) ──────────────────────────────────
COST_PER_1K_INPUT_TOKENS  = 0.00025   # $0.25 / 1M
COST_PER_1K_OUTPUT_TOKENS = 0.00125   # $1.25 / 1M
AVG_TOKENS_PER_BATCH      = 300       # ~30 tokens per grant input + overhead


# ── Cache helpers ──────────────────────────────────────────────────────────────

def _cache_key(recipient: str, description: str) -> str:
    """MD5 hash of normalized (recipient + description). Used as cache key."""
    text = f"{(recipient or '').lower().strip()}|||{(description or '').lower().strip()}"
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def cache_lookup(sqlite_conn: sqlite3.Connection,
                 key: str) -> Optional[Dict]:
    row = sqlite_conn.execute(
        "SELECT expense_type, ai_explanation FROM ai_cache WHERE cache_key=?",
        (key,)
    ).fetchone()
    return dict(row) if row else None


def cache_store(sqlite_conn: sqlite3.Connection, entries: List[Dict]):
    """Bulk insert new cache entries."""
    sqlite_conn.executemany("""
        INSERT OR IGNORE INTO ai_cache
            (cache_key, recipient_name, description, expense_type,
             ai_explanation, model_used, tokens_used)
        VALUES
            (:cache_key, :recipient_name, :description, :expense_type,
             :ai_explanation, :model_used, :tokens_used)
    """, entries)
    sqlite_conn.commit()


# ── Fetch uncategorized rows from PostgreSQL ───────────────────────────────────

def fetch_uncategorized(pg_conn,
                        limit: Optional[int] = None,
                        reprocess_misc: bool = False) -> List[Dict]:
    """
    Fetch rows from irs_grants that need AI review.
    Keyword classification already handled Non jews / Jews confidently.
    AI is most useful for:
      - Miscellaneous rows (empty/short descriptions — may still be classifiable)
      - Optionally: rows where keyword said 'Non jews' but description is long/complex
    """
    conditions = ["ai_explanation IS NULL"]
    if reprocess_misc:
        conditions.append("expense_type = 'Miscellaneous'")
    else:
        # Focus on rows where description has content but classification is uncertain
        conditions.append("expense_type = 'Miscellaneous' OR "
                          "(expense_type = 'Non jews' AND LENGTH(description) > 50)")

    where = " AND ".join(conditions)
    sql = f"""
        SELECT id, recipient_name, description, grantmaker_name,
               primary_subject, tax_year, expense_type
        FROM irs_grants
        WHERE {where}
        ORDER BY id
        {"LIMIT " + str(limit) if limit else ""}
    """
    with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]


# ── AI prompt builder ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a grant classification expert analyzing IRS Form 990 filings.

Classify each grant as exactly one of:
  - "Jews"          : grant explicitly benefits Jewish organizations, communities, causes, or culture
  - "Non jews"      : grant benefits non-Jewish organizations or general population
  - "Miscellaneous" : insufficient information to determine (very short/empty description)

Rules:
  - Base your decision ONLY on the text provided (recipient name + description)
  - If the recipient name clearly identifies a Jewish org (synagogue, JCC, Chabad, yeshiva, etc.) → "Jews"
  - If description mentions Jewish holidays, Hebrew, Israel in a Jewish context → "Jews"
  - If ambiguous but leans secular → "Non jews"
  - Only use "Miscellaneous" if truly impossible to determine

Return ONLY a valid JSON array. No explanation outside the JSON.
Each object must have exactly these keys: "id", "expense_type", "explanation"
"explanation" must be ONE sentence max (under 20 words).

Example response:
[
  {"id": 1, "expense_type": "Jews", "explanation": "Recipient is a Jewish Community Center providing cultural programs."},
  {"id": 2, "expense_type": "Non jews", "explanation": "General education grant to a public school district."}
]"""


def _build_user_message(batch: List[Dict]) -> str:
    items = []
    for i, row in enumerate(batch, 1):
        items.append({
            "id":             i,
            "recipient_name": (row.get("recipient_name") or "")[:100],
            "description":    (row.get("description")    or "")[:300],
            "grantmaker":     (row.get("grantmaker_name") or "")[:80],
            "subject":        (row.get("primary_subject") or ""),
        })
    return "Classify these grants:\n" + json.dumps(items, indent=2)


# ── Anthropic API call ─────────────────────────────────────────────────────────

@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=2, min=5, max=60),
    retry=retry_if_exception_type(Exception),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def call_anthropic(batch: List[Dict]) -> Tuple[List[Dict], int]:
    """
    Send a batch to Anthropic API. Returns (results_list, tokens_used).
    """
    try:
        import anthropic
    except ImportError:
        raise ImportError("Run: pip install anthropic")

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    message = client.messages.create(
        model=config.AI_MODEL,
        max_tokens=config.AI_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_user_message(batch)}],
    )

    tokens = message.usage.input_tokens + message.usage.output_tokens
    raw    = message.content[0].text.strip()

    # Parse JSON — handle edge cases where model adds markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    results = json.loads(raw)
    if not isinstance(results, list):
        raise ValueError(f"Expected JSON array, got: {type(results)}")

    return results, tokens


# ── Process one batch ──────────────────────────────────────────────────────────

def process_batch(batch: List[Dict],
                  sqlite_conn: sqlite3.Connection) -> Tuple[List[Dict], int]:
    """
    For a batch of grant rows:
      1. Check cache — skip rows already classified
      2. Call API for uncached rows
      3. Store results in cache
      4. Return (pg_update_list, tokens_used)
    """
    uncached  = []
    updates   = []
    tokens    = 0

    # Step 1: Check cache
    for row in batch:
        key    = _cache_key(row.get("recipient_name",""), row.get("description",""))
        cached = cache_lookup(sqlite_conn, key)
        if cached:
            updates.append({
                "id":             row["id"],
                "expense_type":   cached["expense_type"],
                "ai_explanation": cached["ai_explanation"],
                "from_cache":     True,
            })
        else:
            row["_cache_key"] = key
            uncached.append(row)

    # Step 2: Call API only for uncached
    if uncached:
        try:
            api_results, tokens = call_anthropic(uncached)
        except Exception as e:
            log.error("API call failed for batch: %s", e)
            return updates, 0

        # Map results back by position (API returns indexed 1..N)
        cache_entries = []
        for res in api_results:
            idx = res.get("id", 1) - 1   # 1-indexed → 0-indexed
            if 0 <= idx < len(uncached):
                orig = uncached[idx]
                expense_type   = res.get("expense_type", "Miscellaneous")
                ai_explanation = res.get("explanation", "")

                updates.append({
                    "id":             orig["id"],
                    "expense_type":   expense_type,
                    "ai_explanation": ai_explanation,
                    "from_cache":     False,
                })
                cache_entries.append({
                    "cache_key":      orig["_cache_key"],
                    "recipient_name": orig.get("recipient_name",""),
                    "description":    orig.get("description",""),
                    "expense_type":   expense_type,
                    "ai_explanation": ai_explanation,
                    "model_used":     config.AI_MODEL,
                    "tokens_used":    tokens // len(uncached),
                })

        # Step 3: Store in cache
        if cache_entries:
            cache_store(sqlite_conn, cache_entries)

    return updates, tokens


# ── Apply updates to PostgreSQL ────────────────────────────────────────────────

def apply_updates(pg_conn, updates: List[Dict]):
    """Batch update irs_grants with AI results."""
    if not updates:
        return
    # Ensure ai_explanation column exists
    with pg_conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE irs_grants
            ADD COLUMN IF NOT EXISTS ai_explanation TEXT
        """)
    pg_conn.commit()

    with pg_conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, """
            UPDATE irs_grants AS g SET
                expense_type   = v.expense_type,
                ai_explanation = v.ai_explanation
            FROM (VALUES %s) AS v(id, expense_type, ai_explanation)
            WHERE g.id = v.id::BIGINT
        """, [(u["id"], u["expense_type"], u["ai_explanation"]) for u in updates],
        template="(%s, %s, %s)")
    pg_conn.commit()


# ── Main ───────────────────────────────────────────────────────────────────────

def run_ai_categorization(limit: Optional[int] = None,
                           reprocess_misc: bool = False,
                           dry_run: bool = False):
    if not config.ANTHROPIC_API_KEY:
        log.error("ANTHROPIC_API_KEY not set. Cannot run AI categorization.")
        log.error("Set it with:  set ANTHROPIC_API_KEY=your_key_here")
        sys.exit(1)

    sqlite_conn = get_sqlite_conn()
    init_sqlite_schema(sqlite_conn)
    pg_conn     = get_pg_conn()

    log.info("Fetching uncategorized rows from PostgreSQL...")
    rows = fetch_uncategorized(pg_conn, limit=limit,
                               reprocess_misc=reprocess_misc)
    log.info("Found %d rows needing AI review", len(rows))

    if not rows:
        log.info("Nothing to do — all rows already AI-classified.")
        return

    # Estimate cost
    n_batches       = (len(rows) + config.AI_BATCH_SIZE - 1) // config.AI_BATCH_SIZE
    est_tokens      = n_batches * AVG_TOKENS_PER_BATCH
    est_cost_usd    = (est_tokens / 1000) * COST_PER_1K_INPUT_TOKENS
    log.info("Estimated: %d batches, ~%d tokens, ~$%.4f USD",
             n_batches, est_tokens, est_cost_usd)

    if dry_run:
        log.info("DRY RUN — no API calls made.")
        # Show cache hit rate
        cached = sum(
            1 for r in rows
            if cache_lookup(sqlite_conn,
                            _cache_key(r.get("recipient_name",""),
                                       r.get("description","")))
        )
        log.info("Cache hits: %d / %d (%.1f%%)",
                 cached, len(rows), cached/len(rows)*100 if rows else 0)
        pg_conn.close()
        sqlite_conn.close()
        return

    # Process in batches
    t0             = time.time()
    total_tokens   = 0
    total_updated  = 0
    cache_hits     = 0
    api_calls      = 0

    # Split into batches
    batches = [rows[i:i+config.AI_BATCH_SIZE]
               for i in range(0, len(rows), config.AI_BATCH_SIZE)]

    for batch_idx, batch in enumerate(batches, 1):
        updates, tokens = process_batch(batch, sqlite_conn)
        apply_updates(pg_conn, updates)

        total_tokens  += tokens
        total_updated += len(updates)
        cache_hits    += sum(1 for u in updates if u.get("from_cache"))
        if tokens > 0:
            api_calls += 1

        if batch_idx % 10 == 0:
            elapsed  = time.time() - t0
            cost_so_far = (total_tokens / 1000) * COST_PER_1K_INPUT_TOKENS
            log.info(
                "  Batch %d/%d | updated=%d | tokens=%d | "
                "cost=$%.4f | cache_hits=%d | %.1fs elapsed",
                batch_idx, len(batches), total_updated, total_tokens,
                cost_so_far, cache_hits, elapsed,
            )
        # Small delay between API calls to respect rate limits
        if api_calls > 0 and tokens > 0:
            time.sleep(0.3)

    elapsed   = time.time() - t0
    total_cost = (total_tokens / 1000) * COST_PER_1K_INPUT_TOKENS
    log.info("=" * 60)
    log.info("AI Categorization complete in %.1f min", elapsed / 60)
    log.info("  Rows updated  : %d", total_updated)
    log.info("  API calls     : %d", api_calls)
    log.info("  Cache hits    : %d (saved ~$%.4f)", cache_hits,
             cache_hits / config.AI_BATCH_SIZE * est_cost_usd / len(batches)
             if batches else 0)
    log.info("  Tokens used   : %d", total_tokens)
    log.info("  Total cost    : $%.4f USD", total_cost)
    log.info("=" * 60)

    pg_conn.close()
    sqlite_conn.close()


def main():
    parser = argparse.ArgumentParser(description="Phase 3: AI Categorization")
    parser.add_argument("--limit",           type=int, default=None,
                        help="Max rows to process (for testing)")
    parser.add_argument("--reprocess-misc",  action="store_true",
                        help="Re-process only Miscellaneous rows")
    parser.add_argument("--dry-run",         action="store_true",
                        help="Estimate cost without making API calls")
    args = parser.parse_args()

    run_ai_categorization(
        limit          = args.limit,
        reprocess_misc = args.reprocess_misc,
        dry_run        = args.dry_run,
    )


if __name__ == "__main__":
    main()
