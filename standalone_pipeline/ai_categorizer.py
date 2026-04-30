"""
ai_categorizer.py
==================
PHASE 3 — AI Categorization  (Anthropic API, maximum cost control)

Classifies grant records as "Jews", "Non jews", or "Miscellaneous"
by sending batches to claude-3-haiku-20240307.

COST CONTROL MEASURES:
  1. SQLite cache      — MD5(recipient_name + description) lookup before any API call
  2. Batch prompting   — 10 grants per API call (one system prompt covers all 10)
  3. Cheapest model    — claude-3-haiku-20240307
  4. Keyword pre-pass  — ~57 keyword patterns classify confident rows without any API
  5. Dry-run mode      — estimates cost + cache hit rate with zero API calls
  6. Retry decorator   — tenacity handles rate limits and transient failures

Run:
    python ai_categorizer.py --dry-run           # estimate cost, no API calls
    python ai_categorizer.py --limit 500         # process 500 rows (test)
    python ai_categorizer.py                     # full run
    python ai_categorizer.py --reprocess-misc    # redo Miscellaneous rows only
"""

import hashlib
import json
import logging
import re
import sqlite3
import sys
import time
import argparse
from typing import List, Optional, Dict, Tuple

from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

import config
from db_sqlite import get_conn, init_schema

log = logging.getLogger(__name__)

# ── Haiku pricing (as of 2025) ─────────────────────────────────────────────────
COST_INPUT_PER_1K  = 0.00025   # $0.25 / 1M input tokens
COST_OUTPUT_PER_1K = 0.00125   # $1.25 / 1M output tokens
AVG_INPUT_TOKENS_PER_GRANT  = 60   # ~60 tokens of grant text
AVG_SYSTEM_PROMPT_TOKENS    = 250  # amortised across batch of 10


# ══════════════════════════════════════════════════════════════════════════════
# COST CONTROL 1 — Keyword pre-pass (no API needed for these)
# ══════════════════════════════════════════════════════════════════════════════

_JEWISH_PATTERNS = re.compile("|".join([
    r"\bjew(?:ish|s)?\b", r"\bjudaism\b", r"\bhebrew\b", r"\bsemitic\b",
    r"\bisrael(?:i)?\b",
    r"\byeshiva[h]?\b", r"\bsynagogue\b", r"\bshul\b",
    r"\brabbi(?:nical)?\b", r"\bchabad\b", r"\blubavitch\b",
    r"\bhillel\b", r"\bjcc\b", r"\bhadassah\b",
    r"\bb['\u2019]?nai\b", r"\bbnai\b",
    r"\btorah\b", r"\btalmud\b", r"\bkabbalah\b",
    r"\bkosher\b", r"\bkippah\b", r"\byarmulke\b",
    r"\bmitzvah\b", r"\bbar mitzvah\b", r"\bbat mitzvah\b",
    r"\bshabbat\b", r"\bshabbos\b",
    r"\bpassover\b", r"\bpesach\b",
    r"\bhanukkah\b", r"\bchanukah\b",
    r"\brosh hashanah\b", r"\byom kippur\b",
    r"\bsukkot\b", r"\bpurim\b",
    r"\bjerusalem\b", r"\bzion(?:ist|ism)?\b",
    r"\bkibbutz\b", r"\bbirthright\b",
    r"\bholocaust\b", r"\bshoah\b",
    r"\bmenorah\b", r"\bshalom\b", r"\btikva[ht]?\b", r"\bmazel\b",
    r"\bjewish federation\b", r"\bjewish community\b",
    r"\bjewish family\b", r"\bjewish fund\b",
    r"\bjewish foundation\b", r"\bamerican jewish\b",
    r"\bunited jewish\b", r"\bfriends of israel\b",
    r"\bstate of israel\b",
]), re.IGNORECASE)


def keyword_classify(recipient: str, description: str) -> Optional[str]:
    """
    Returns classification if keywords are conclusive, else None.
    None means we need the AI to decide.
    """
    combined = f"{recipient or ''} {description or ''}".strip()
    if not combined or combined.lower() in ("n/a", "nan"):
        return "Miscellaneous"
    if _JEWISH_PATTERNS.search(combined):
        return "Jews"
    return None   # inconclusive → send to AI


# ══════════════════════════════════════════════════════════════════════════════
# COST CONTROL 1 — SQLite cache helpers
# ══════════════════════════════════════════════════════════════════════════════

def _cache_key(recipient: str, description: str) -> str:
    text = f"{(recipient or '').lower().strip()}|||{(description or '').lower().strip()}"
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def cache_get(conn: sqlite3.Connection, key: str) -> Optional[Dict]:
    row = conn.execute(
        "SELECT expense_type, ai_explanation FROM ai_cache WHERE cache_key=?",
        (key,)
    ).fetchone()
    return dict(row) if row else None


def cache_put_batch(conn: sqlite3.Connection, entries: List[Dict]):
    conn.executemany("""
        INSERT OR IGNORE INTO ai_cache
            (cache_key, recipient_name, description,
             expense_type, ai_explanation, model_used, tokens_used)
        VALUES
            (:cache_key, :recipient_name, :description,
             :expense_type, :ai_explanation, :model_used, :tokens_used)
    """, entries)
    conn.commit()


# ══════════════════════════════════════════════════════════════════════════════
# COST CONTROL 2 — Batch prompting
# ══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are an expert analyst classifying IRS Form 990 grant records.

Classify each grant into exactly one category:
  "Jews"          — grant explicitly benefits Jewish organizations, communities, causes, or culture
  "Non jews"      — grant benefits non-Jewish organizations or the general public
  "Miscellaneous" — truly insufficient information to determine (very short or empty text)

Decision rules:
  - A Jewish org name (synagogue, yeshiva, JCC, Chabad, Hillel, etc.) → "Jews"
  - Description mentioning Jewish holidays, Hebrew, Israel in Jewish context → "Jews"
  - Secular school, hospital, shelter, arts org → "Non jews"
  - Only use "Miscellaneous" when the text gives you nothing to work with

Return ONLY a valid JSON array. No markdown, no explanation outside the JSON.
Every object must have exactly these keys: "id", "expense_type", "explanation"
"explanation" must be one sentence, maximum 15 words.

Example:
[
  {"id": 1, "expense_type": "Jews", "explanation": "Recipient is a Jewish community center."},
  {"id": 2, "expense_type": "Non jews", "explanation": "General operating grant to a public library."},
  {"id": 3, "expense_type": "Miscellaneous", "explanation": "No recipient or description provided."}
]"""


def _build_user_message(batch: List[Dict]) -> str:
    items = [
        {
            "id":             i + 1,
            "recipient_name": (row.get("recipient_name") or "")[:120],
            "description":    (row.get("description")    or "")[:300],
            "grantmaker":     (row.get("grantmaker_name") or "")[:80],
            "subject":        (row.get("primary_subject") or ""),
        }
        for i, row in enumerate(batch)
    ]
    return "Classify these grants:\n" + json.dumps(items, ensure_ascii=False)


# ══════════════════════════════════════════════════════════════════════════════
# Anthropic API call with tenacity retry
# ══════════════════════════════════════════════════════════════════════════════

@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=2, min=5, max=60),
    retry=retry_if_exception_type(Exception),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def _call_api(batch: List[Dict]) -> Tuple[List[Dict], int]:
    """
    Send a batch of grants to claude-3-haiku-20240307.
    Returns (results_list, total_tokens_used).
    """
    try:
        import anthropic
    except ImportError:
        raise ImportError("Run: pip install anthropic")

    if not config.ANTHROPIC_API_KEY:
        raise EnvironmentError(
            "ANTHROPIC_API_KEY not set. "
            "Add it to your .env file or set as environment variable."
        )

    client  = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    message = client.messages.create(
        model      = config.AI_MODEL,
        max_tokens = config.AI_MAX_TOKENS,
        system     = SYSTEM_PROMPT,
        messages   = [{"role": "user", "content": _build_user_message(batch)}],
    )

    tokens = message.usage.input_tokens + message.usage.output_tokens
    raw    = message.content[0].text.strip()

    # Strip markdown code fences if model added them
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).strip()

    results = json.loads(raw)
    if not isinstance(results, list):
        raise ValueError(f"Expected JSON array from API, got {type(results).__name__}")

    return results, tokens


# ══════════════════════════════════════════════════════════════════════════════
# Process one batch
# ══════════════════════════════════════════════════════════════════════════════

def process_batch(
    batch: List[Dict],
    conn: sqlite3.Connection,
) -> Tuple[List[Dict], int, int]:
    """
    Apply cost controls to one batch:
      1. Keyword pre-pass (free)
      2. Cache lookup (free)
      3. API call only for remaining rows
      4. Store API results in cache

    Returns: (pg_updates, tokens_used, cache_hits)
    """
    updates    = []
    need_api   = []
    cache_hits = 0
    tokens     = 0

    for row in batch:
        rid  = row["id"]
        rec  = row.get("recipient_name", "")
        desc = row.get("description", "")

        # Step 1: keyword pre-pass
        kw_result = keyword_classify(rec, desc)
        if kw_result:
            updates.append({
                "id":             rid,
                "expense_type":   kw_result,
                "ai_explanation": "Classified by keyword matching.",
                "from_cache":     False,
            })
            continue

        # Step 2: cache lookup
        key    = _cache_key(rec, desc)
        cached = cache_get(conn, key)
        if cached:
            cache_hits += 1
            updates.append({
                "id":             rid,
                "expense_type":   cached["expense_type"],
                "ai_explanation": cached["ai_explanation"],
                "from_cache":     True,
            })
            continue

        # Not in cache — mark for API call
        row["_cache_key"] = key
        need_api.append(row)

    # Step 3: API call for remaining rows
    if need_api:
        try:
            api_results, tokens = _call_api(need_api)
        except Exception as e:
            log.error("API call failed: %s", e)
            # Fall back to Miscellaneous for this batch on API failure
            for row in need_api:
                updates.append({
                    "id":             row["id"],
                    "expense_type":   "Miscellaneous",
                    "ai_explanation": f"API error: {str(e)[:100]}",
                    "from_cache":     False,
                })
            return updates, 0, cache_hits

        cache_entries = []
        for res in api_results:
            idx = res.get("id", 1) - 1    # 1-indexed → 0-indexed
            if 0 <= idx < len(need_api):
                orig    = need_api[idx]
                exp     = res.get("expense_type", "Miscellaneous")
                explain = res.get("explanation", "")

                # Validate the value
                if exp not in ("Jews", "Non jews", "Miscellaneous"):
                    exp = "Miscellaneous"

                updates.append({
                    "id":             orig["id"],
                    "expense_type":   exp,
                    "ai_explanation": explain,
                    "from_cache":     False,
                })
                cache_entries.append({
                    "cache_key":      orig["_cache_key"],
                    "recipient_name": orig.get("recipient_name", ""),
                    "description":    orig.get("description", ""),
                    "expense_type":   exp,
                    "ai_explanation": explain,
                    "model_used":     config.AI_MODEL,
                    "tokens_used":    max(1, tokens // len(need_api)),
                })

        # Step 4: store in cache
        if cache_entries:
            cache_put_batch(conn, cache_entries)

    return updates, tokens, cache_hits


# ══════════════════════════════════════════════════════════════════════════════
# Apply updates to SQLite
# ══════════════════════════════════════════════════════════════════════════════

def apply_updates(conn: sqlite3.Connection, updates: List[Dict]):
    conn.executemany("""
        UPDATE irs_grants
        SET expense_type   = :expense_type,
            ai_explanation = :ai_explanation,
            categorized_at = datetime('now')
        WHERE id = :id
    """, updates)
    conn.commit()


# ══════════════════════════════════════════════════════════════════════════════
# Fetch uncategorized rows
# ══════════════════════════════════════════════════════════════════════════════

def fetch_uncategorized(conn: sqlite3.Connection,
                        limit: Optional[int] = None,
                        reprocess_misc: bool = False) -> List[Dict]:
    if reprocess_misc:
        where = "expense_type = 'Miscellaneous'"
    else:
        where = "expense_type = 'Uncategorized'"

    sql = f"""
        SELECT id, recipient_name, description,
               grantmaker_name, primary_subject, tax_year, expense_type
        FROM irs_grants
        WHERE {where}
        ORDER BY id
        {"LIMIT " + str(limit) if limit else ""}
    """
    return [dict(r) for r in conn.execute(sql).fetchall()]


# ══════════════════════════════════════════════════════════════════════════════
# COST CONTROL 3 — Dry run cost estimator
# ══════════════════════════════════════════════════════════════════════════════

def estimate_cost(conn: sqlite3.Connection,
                  rows: List[Dict]) -> Dict:
    """
    Calculate estimated API cost without making any calls.
    Accounts for keyword pre-pass and cache hits.
    """
    kw_classified  = 0
    cache_hits     = 0
    needs_api      = 0

    for row in rows:
        rec  = row.get("recipient_name", "")
        desc = row.get("description", "")

        if keyword_classify(rec, desc) is not None:
            kw_classified += 1
            continue

        key = _cache_key(rec, desc)
        if cache_get(conn, key):
            cache_hits += 1
            continue

        needs_api += 1

    n_batches   = (needs_api + config.AI_BATCH_SIZE - 1) // config.AI_BATCH_SIZE
    est_tokens  = n_batches * (
        AVG_SYSTEM_PROMPT_TOKENS +
        (config.AI_BATCH_SIZE * AVG_INPUT_TOKENS_PER_GRANT)
    )
    est_cost    = (est_tokens / 1000) * COST_INPUT_PER_1K

    return {
        "total_rows":    len(rows),
        "kw_classified": kw_classified,
        "cache_hits":    cache_hits,
        "needs_api":     needs_api,
        "n_batches":     n_batches,
        "est_tokens":    est_tokens,
        "est_cost_usd":  est_cost,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

def run_ai_categorization(limit: Optional[int] = None,
                           reprocess_misc: bool = False,
                           dry_run: bool = False):
    conn = get_conn()
    init_schema(conn)

    log.info("Fetching rows to categorize...")
    rows = fetch_uncategorized(conn, limit=limit,
                               reprocess_misc=reprocess_misc)

    if not rows:
        log.info("No rows need categorization.")
        conn.close()
        return

    log.info("Found %d rows to process.", len(rows))

    # ── Cost estimation (always shown) ────────────────────────────────────────
    est = estimate_cost(conn, rows)
    log.info("─" * 55)
    log.info("COST ESTIMATE")
    log.info("  Total rows      : %d", est["total_rows"])
    log.info("  Keyword (free)  : %d", est["kw_classified"])
    log.info("  Cache hits      : %d", est["cache_hits"])
    log.info("  Needs API       : %d", est["needs_api"])
    log.info("  API batches     : %d  (@ %d rows each)",
             est["n_batches"], config.AI_BATCH_SIZE)
    log.info("  Est. tokens     : ~%d", est["est_tokens"])
    log.info("  Est. cost       : ~$%.4f USD", est["est_cost_usd"])
    log.info("─" * 55)

    if dry_run:
        log.info("--dry-run mode: no API calls made.")
        conn.close()
        return

    if not config.ANTHROPIC_API_KEY:
        log.error("ANTHROPIC_API_KEY not set. Cannot call API.")
        log.error("Add to .env:  ANTHROPIC_API_KEY=your_key")
        conn.close()
        sys.exit(1)

    # ── Process ───────────────────────────────────────────────────────────────
    batches      = [rows[i:i+config.AI_BATCH_SIZE]
                    for i in range(0, len(rows), config.AI_BATCH_SIZE)]
    t0           = time.time()
    total_tokens = 0
    total_updated= 0
    total_cache  = 0
    api_calls    = 0

    for i, batch in enumerate(batches, 1):
        updates, tokens, cache_hits = process_batch(batch, conn)
        apply_updates(conn, updates)

        total_tokens  += tokens
        total_updated += len(updates)
        total_cache   += cache_hits
        if tokens > 0:
            api_calls += 1

        if i % 10 == 0 or i == len(batches):
            elapsed    = time.time() - t0
            cost_so_far = (total_tokens / 1000) * COST_INPUT_PER_1K
            log.info(
                "  Batch %d/%d | updated=%d | api_calls=%d | "
                "cache=%d | tokens=%d | cost=$%.4f",
                i, len(batches), total_updated, api_calls,
                total_cache, total_tokens, cost_so_far,
            )

        # Small delay between real API calls to avoid rate limiting
        if tokens > 0:
            time.sleep(0.25)

    elapsed    = time.time() - t0
    total_cost = (total_tokens / 1000) * COST_INPUT_PER_1K
    log.info("═" * 55)
    log.info("AI Categorization complete in %.1f min", elapsed/60)
    log.info("  Rows updated   : %d", total_updated)
    log.info("  API calls made : %d", api_calls)
    log.info("  Cache hits     : %d", total_cache)
    log.info("  Tokens used    : %d", total_tokens)
    log.info("  Actual cost    : $%.4f USD", total_cost)
    log.info("═" * 55)
    conn.close()


# ── CLI ────────────────────────────────────────────────────────────────────────

def main(args=None):
    parser = argparse.ArgumentParser(
        description="Phase 3: AI Categorization with cost controls"
    )
    parser.add_argument("--dry-run",        action="store_true",
                        help="Estimate cost without any API calls")
    parser.add_argument("--limit",          type=int, default=None,
                        help="Max rows to process (for testing)")
    parser.add_argument("--reprocess-misc", action="store_true",
                        help="Re-categorize rows marked Miscellaneous")
    args = parser.parse_args(args)

    run_ai_categorization(
        limit          = args.limit,
        reprocess_misc = args.reprocess_misc,
        dry_run        = args.dry_run,
    )


if __name__ == "__main__":
    main()
