"""
irs_pipeline/ai_categorizer.py
==============================
Phase 3: apply tightly scoped AI categorization with caching and cost controls.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sqlite3
import sys
import time
from typing import Dict, List, Optional, Tuple

import psycopg2.extras
from tenacity import before_sleep_log, retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from irs_pipeline import config
from irs_pipeline.db_sqlite import get_sqlite_conn, init_sqlite_schema
from irs_db.loader import get_conn as get_pg_conn

log = logging.getLogger(__name__)

COST_PER_1K_INPUT_TOKENS = 0.00025
COST_PER_1K_OUTPUT_TOKENS = 0.00125
AVG_TOKENS_PER_BATCH = 300
ALLOWED_EXPENSE_TYPES = {"Jews", "Non jews", "Miscellaneous"}


def _cache_key(recipient: str, description: str) -> str:
    """Return a deterministic cache key for a grant text pair."""
    text = f"{(recipient or '').lower().strip()}|||{(description or '').lower().strip()}"
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def cache_lookup(sqlite_conn: sqlite3.Connection, key: str) -> Optional[Dict]:
    """Look up a cached AI decision by cache key."""
    row = sqlite_conn.execute(
        "SELECT expense_type, ai_explanation FROM ai_cache WHERE cache_key=?",
        (key,),
    ).fetchone()
    return dict(row) if row else None


def cache_store(sqlite_conn: sqlite3.Connection, entries: List[Dict]) -> None:
    """Persist newly generated cache entries."""
    sqlite_conn.executemany(
        """
        INSERT OR IGNORE INTO ai_cache
            (cache_key, recipient_name, description, expense_type,
             ai_explanation, model_used, tokens_used)
        VALUES
            (:cache_key, :recipient_name, :description, :expense_type,
             :ai_explanation, :model_used, :tokens_used)
        """,
        entries,
    )
    sqlite_conn.commit()


def fetch_uncategorized(
    pg_conn,
    limit: Optional[int] = None,
    reprocess_misc: bool = False,
) -> List[Dict]:
    """Fetch grants that still benefit from AI review."""
    conditions = ["ai_explanation IS NULL"]
    if reprocess_misc:
        conditions.append("expense_type = 'Miscellaneous'")
    else:
        conditions.append(
            "expense_type = 'Miscellaneous' "
            "OR (expense_type = 'Non jews' AND LENGTH(description) > 50)"
        )

    sql = f"""
        SELECT id, recipient_name, description, grantmaker_name,
               primary_subject, tax_year, expense_type
        FROM irs_grants
        WHERE {' AND '.join(conditions)}
        ORDER BY id
        {'LIMIT ' + str(int(limit)) if limit else ''}
    """

    with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql)
        return [dict(row) for row in cur.fetchall()]


SYSTEM_PROMPT = """You are a grant classification analyst working on IRS Form 990 data.

Classify each grant as exactly one of:
  - "Jews"
  - "Non jews"
  - "Miscellaneous"

Rules:
  - Use only the supplied grant text.
  - A clearly Jewish organization, community, culture, holiday, or Israel context means "Jews".
  - A clearly secular or non-Jewish recipient means "Non jews".
  - Use "Miscellaneous" only when the text is genuinely too sparse to classify.

Return only valid JSON.
Each JSON object must contain: "id", "expense_type", "explanation".
Keep "explanation" to one short sentence.
"""


def _build_user_message(batch: List[Dict]) -> str:
    """Build the user message for a single batch."""
    items = []
    for index, row in enumerate(batch, 1):
        items.append(
            {
                "id": index,
                "recipient_name": (row.get("recipient_name") or "")[:120],
                "description": (row.get("description") or "")[:320],
                "grantmaker": (row.get("grantmaker_name") or "")[:90],
                "subject": (row.get("primary_subject") or "")[:60],
            }
        )
    return "Classify these grants:\n" + json.dumps(items, indent=2)


@retry(
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=2, min=5, max=60),
    retry=retry_if_exception_type(Exception),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def call_anthropic(batch: List[Dict]) -> Tuple[List[Dict], int]:
    """Send one batch to Anthropic and return parsed JSON plus token usage."""
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover - operational dependency
        raise ImportError("Install the `anthropic` package to run AI categorization.") from exc

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    message = client.messages.create(
        model=config.AI_MODEL,
        max_tokens=config.AI_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_user_message(batch)}],
    )

    tokens = message.usage.input_tokens + message.usage.output_tokens
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").replace("json\n", "", 1).strip()

    results = json.loads(raw)
    if not isinstance(results, list):
        raise ValueError(f"Expected a JSON array, received {type(results).__name__}")

    return results, tokens


def process_batch(batch: List[Dict], sqlite_conn: sqlite3.Connection) -> Tuple[List[Dict], int]:
    """Process a batch using cache first, then the API only for misses."""
    uncached: List[Dict] = []
    updates: List[Dict] = []
    tokens = 0

    for row in batch:
        key = _cache_key(row.get("recipient_name", ""), row.get("description", ""))
        cached = cache_lookup(sqlite_conn, key)
        if cached:
            updates.append(
                {
                    "id": row["id"],
                    "expense_type": cached["expense_type"],
                    "ai_explanation": cached["ai_explanation"],
                    "from_cache": True,
                }
            )
        else:
            row["_cache_key"] = key
            uncached.append(row)

    if uncached:
        try:
            api_results, tokens = call_anthropic(uncached)
        except Exception as exc:  # pragma: no cover - operational fallback
            log.error("API call failed for batch: %s", exc)
            return updates, 0

        cache_entries: List[Dict] = []
        for result in api_results:
            raw_id = result.get("id", 1)
            try:
                offset = int(raw_id) - 1
            except (TypeError, ValueError):
                continue
            if not 0 <= offset < len(uncached):
                continue

            original = uncached[offset]
            expense_type = result.get("expense_type", "Miscellaneous")
            if expense_type not in ALLOWED_EXPENSE_TYPES:
                expense_type = "Miscellaneous"
            explanation = str(result.get("explanation", ""))[:240]

            updates.append(
                {
                    "id": original["id"],
                    "expense_type": expense_type,
                    "ai_explanation": explanation,
                    "from_cache": False,
                }
            )
            cache_entries.append(
                {
                    "cache_key": original["_cache_key"],
                    "recipient_name": original.get("recipient_name", ""),
                    "description": original.get("description", ""),
                    "expense_type": expense_type,
                    "ai_explanation": explanation,
                    "model_used": config.AI_MODEL,
                    "tokens_used": max(1, tokens // len(uncached)),
                }
            )

        if cache_entries:
            cache_store(sqlite_conn, cache_entries)

    return updates, tokens


def apply_updates(pg_conn, updates: List[Dict]) -> None:
    """Persist AI decisions back into PostgreSQL."""
    if not updates:
        return

    with pg_conn.cursor() as cur:
        cur.execute(
            """
            ALTER TABLE irs_grants
            ADD COLUMN IF NOT EXISTS ai_explanation TEXT
            """
        )
    pg_conn.commit()

    payload = [
        (update["id"], update["expense_type"], update["ai_explanation"])
        for update in updates
    ]
    with pg_conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            UPDATE irs_grants AS grants
            SET expense_type = values.expense_type,
                ai_explanation = values.ai_explanation
            FROM (VALUES %s) AS values(id, expense_type, ai_explanation)
            WHERE grants.id = values.id::BIGINT
            """,
            payload,
            template="(%s, %s, %s)",
        )
    pg_conn.commit()


def run_ai_categorization(
    limit: Optional[int] = None,
    reprocess_misc: bool = False,
    dry_run: bool = False,
) -> None:
    """Run cached, rate-limited AI classification on eligible rows."""
    if not config.ANTHROPIC_API_KEY:
        log.error("ANTHROPIC_API_KEY is not set. Cannot run AI categorization.")
        log.error("Set it in your environment or .env file before running this step.")
        sys.exit(1)

    sqlite_conn = get_sqlite_conn()
    init_sqlite_schema(sqlite_conn)
    pg_conn = get_pg_conn()

    try:
        log.info("Fetching uncategorized rows from PostgreSQL...")
        rows = fetch_uncategorized(pg_conn, limit=limit, reprocess_misc=reprocess_misc)
        log.info("Found %d rows needing AI review", len(rows))

        if not rows:
            log.info("Nothing to do - all rows already AI-classified.")
            return

        batch_count = (len(rows) + config.AI_BATCH_SIZE - 1) // config.AI_BATCH_SIZE
        estimated_tokens = batch_count * AVG_TOKENS_PER_BATCH
        estimated_cost = (estimated_tokens / 1000) * COST_PER_1K_INPUT_TOKENS
        log.info(
            "Estimated: %d batches, ~%d tokens, ~$%.4f USD",
            batch_count,
            estimated_tokens,
            estimated_cost,
        )

        if dry_run:
            cached = sum(
                1
                for row in rows
                if cache_lookup(
                    sqlite_conn,
                    _cache_key(row.get("recipient_name", ""), row.get("description", "")),
                )
            )
            log.info(
                "DRY RUN - cache hits: %d / %d (%.1f%%)",
                cached,
                len(rows),
                cached / len(rows) * 100 if rows else 0,
            )
            return

        batches = [
            rows[index:index + config.AI_BATCH_SIZE]
            for index in range(0, len(rows), config.AI_BATCH_SIZE)
        ]

        started_at = time.time()
        total_tokens = 0
        total_updated = 0
        cache_hits = 0
        api_calls = 0

        for batch_index, batch in enumerate(batches, 1):
            updates, tokens = process_batch(batch, sqlite_conn)
            apply_updates(pg_conn, updates)

            total_tokens += tokens
            total_updated += len(updates)
            cache_hits += sum(1 for update in updates if update.get("from_cache"))
            if tokens > 0:
                api_calls += 1

            if batch_index % 10 == 0 or batch_index == len(batches):
                elapsed = time.time() - started_at
                log.info(
                    "  Batch %d/%d | updated=%d | tokens=%d | cache_hits=%d | cost=$%.4f | %.1fs elapsed",
                    batch_index,
                    len(batches),
                    total_updated,
                    total_tokens,
                    cache_hits,
                    (total_tokens / 1000) * COST_PER_1K_INPUT_TOKENS,
                    elapsed,
                )

            if tokens > 0:
                time.sleep(0.3)

        total_cost = (total_tokens / 1000) * COST_PER_1K_INPUT_TOKENS
        log.info("=" * 60)
        log.info("AI Categorization complete in %.1f min", (time.time() - started_at) / 60)
        log.info("  Rows updated  : %d", total_updated)
        log.info("  API calls     : %d", api_calls)
        log.info("  Cache hits    : %d", cache_hits)
        log.info("  Tokens used   : %d", total_tokens)
        log.info("  Total cost    : $%.4f USD", total_cost)
        log.info("=" * 60)
    finally:
        pg_conn.close()
        sqlite_conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 3: AI categorization")
    parser.add_argument("--limit", type=int, default=None, help="Max rows to process")
    parser.add_argument(
        "--reprocess-misc",
        action="store_true",
        help="Re-run only rows currently marked Miscellaneous",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Estimate cost without making any API calls",
    )
    args = parser.parse_args()

    run_ai_categorization(
        limit=args.limit,
        reprocess_misc=args.reprocess_misc,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
