"""
categorize_grants.py
====================
Reads a grant Excel file (e.g. form990_extracted_output.xlsx), classifies every row
into Jews / Non jews / Miscellaneous via the Anthropic API, and writes the result to
a new file (categorized_grants_output.xlsx).

FEATURES
--------
* Resume-safe  – skips rows where "Expense Type" is already filled.
* Auto-save    – flushes to disk every AUTOSAVE_INTERVAL rows.
* Retry logic  – exponential back-off via `tenacity` on 429 / 529 / network errors.
* JSON mode    – uses assistant-turn pre-fill so the model returns raw JSON, no markdown.
* Non-destructive – input file is never modified.

SETUP
-----
1. Install dependencies:
       pip install anthropic pandas openpyxl tenacity

2. Set your Anthropic API key (choose one method):

   Windows PowerShell:
       $env:ANTHROPIC_API_KEY = "sk-ant-..."

   Windows Command Prompt:
       set ANTHROPIC_API_KEY=sk-ant-...

   macOS / Linux:
       export ANTHROPIC_API_KEY="sk-ant-..."

   Or create a .env file in the same folder and run:
       pip install python-dotenv
   then uncomment the two dotenv lines below.

3. Edit the USER SETTINGS section to point at your actual files, then run:
       python categorize_grants.py
"""

# ---------------------------------------------------------------------------
# IMPORTS
# ---------------------------------------------------------------------------
import json
import logging
import os
import sys
import time

import anthropic
import pandas as pd
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)

# Uncomment these two lines if you store your key in a .env file:
# from dotenv import load_dotenv
# load_dotenv()


# ---------------------------------------------------------------------------
# USER SETTINGS  –  edit these before running
# ---------------------------------------------------------------------------

# Full path to the CSV produced by form990_to_excel.py
INPUT_EXCEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "form990_extracted_output.csv",
)

# Output file – NEVER overwrites the input file
OUTPUT_EXCEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "categorized_grants_output.csv",
)

# Claude model – haiku is fastest/cheapest; switch to claude-3-5-sonnet-20241022 for accuracy
MODEL_ID = "claude-3-haiku-20240307"

# Flush to disk after this many newly processed rows
AUTOSAVE_INTERVAL = 500

# Maximum retries per row before giving up and writing "ERROR" to that row
MAX_ROW_RETRIES = 6

# Base / max wait seconds for exponential back-off (doubles each retry up to MAX_WAIT)
BACKOFF_MIN_WAIT = 2    # seconds before first retry
BACKOFF_MAX_WAIT = 120  # cap


# ---------------------------------------------------------------------------
# LOGGING
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "categorize_grants.log"),
            mode="a",
            encoding="utf-8",
        ),
    ],
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# COLUMNS
# ---------------------------------------------------------------------------
# Columns we send to the API (do NOT include "Grantmaker Name")
API_INPUT_COLUMNS = ["Recipient Name", "Description", "Primary Subject", "Support Strategies"]

# New columns this script creates
OUTPUT_COL_EXPENSE_TYPE  = "Expense Type"
OUTPUT_COL_AI_EXPLANATION = "AI Explanation"

# Allowed category values returned by the model
VALID_CATEGORIES = {"Jews", "Non jews", "Miscellaneous"}


# ---------------------------------------------------------------------------
# HELPER: safe string
# ---------------------------------------------------------------------------

def _safe_str(value) -> str:
    """Convert a cell value to a clean string, returning '' for NaN / None."""
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


# ---------------------------------------------------------------------------
# PROMPT BUILDER
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a grant classification assistant. Given information about a grant recipient,
you MUST classify the grant into EXACTLY ONE of these three categories:

  • Jews        – The recipient organization OR the grant description contains clear
                  indicators of a Jewish or Israeli focus. Keywords include (but are
                  not limited to): Jew, Jewish, Judaism, Hebrew, Yeshiva, Synagogue,
                  Torah, Kosher, Rabbi, Chabad, Hillel, JCC, Israel, Israeli, Zion,
                  Zionist, B'nai, Tikva, Shalom, Hadassah, Lubavitch, Mitzvah,
                  Holocaust, Jerusalem, Kibbutz, Birthright, Menorah, Shabbat,
                  Passover, Hanukkah, Talmud, Kabbalah, Kippah, Bar Mitzvah.

  • Non jews    – The recipient organization and description clearly indicate a
                  secular purpose, general community support, or another faith
                  (Christian, Muslim, Hindu, Buddhist, etc.) with NO Jewish indicators.

  • Miscellaneous – The recipient name and description are too vague, too short, or
                    too ambiguous to confidently assign either of the above categories.

You MUST respond with a raw JSON object ONLY – no markdown, no extra text:
{"expense_type": "<Jews|Non jews|Miscellaneous>", "explanation": "<one concise sentence>"}
"""


def _build_user_message(row: pd.Series) -> str:
    """Construct the user-turn message from a DataFrame row."""
    parts = []
    for col in API_INPUT_COLUMNS:
        value = _safe_str(row.get(col, ""))
        label = col.upper().replace(" ", "_")
        parts.append(f"{label}: {value if value else '(not provided)'}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# RETRYABLE API CALL
# ---------------------------------------------------------------------------

def _is_retryable(exc: BaseException) -> bool:
    """Return True for transient Anthropic errors worth retrying."""
    if isinstance(exc, anthropic.RateLimitError):          # HTTP 429
        return True
    if isinstance(exc, anthropic.APIStatusError):
        # 529 Overloaded or any 5xx server error
        return exc.status_code >= 500
    if isinstance(exc, (anthropic.APIConnectionError, anthropic.APITimeoutError)):
        return True
    return False


@retry(
    retry=retry_if_exception(_is_retryable),
    stop=stop_after_attempt(MAX_ROW_RETRIES),
    wait=wait_exponential(multiplier=1, min=BACKOFF_MIN_WAIT, max=BACKOFF_MAX_WAIT),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def _call_api(client: anthropic.Anthropic, user_message: str) -> dict:
    """
    Call the Anthropic Messages API with assistant-turn pre-fill of '{'
    so the model is forced to complete raw JSON rather than wrapping it in
    markdown code fences or adding conversational text.

    Returns a dict with keys 'expense_type' and 'explanation'.
    """
    response = client.messages.create(
        model=MODEL_ID,
        max_tokens=256,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user",      "content": user_message},
            # Pre-fill forces the model to continue from '{', guaranteeing raw JSON.
            {"role": "assistant", "content": "{"},
        ],
    )

    # The model continues from '{', so prepend it back before parsing.
    raw_text = "{" + response.content[0].text.strip()

    # Strip trailing markdown fences in case the model still adds them
    if raw_text.endswith("```"):
        raw_text = raw_text[: raw_text.rfind("```")].strip()

    parsed = json.loads(raw_text)

    # Validate category; fall back to Miscellaneous for unexpected values
    if parsed.get("expense_type") not in VALID_CATEGORIES:
        log.warning("Unexpected category '%s'; defaulting to Miscellaneous", parsed.get("expense_type"))
        parsed["expense_type"] = "Miscellaneous"

    return parsed


# ---------------------------------------------------------------------------
# STATE MANAGEMENT – load / save
# ---------------------------------------------------------------------------

def _read_file(path: str) -> pd.DataFrame:
    """Read a CSV or Excel file into a DataFrame."""
    if path.lower().endswith(".csv"):
        return pd.read_csv(path, dtype=str, encoding="utf-8-sig")
    return pd.read_excel(path, dtype=str)


def _load_or_init_dataframe() -> pd.DataFrame:
    """
    If the output file exists, load it (it may be partially processed).
    Otherwise load the input file and add the two new output columns.
    """
    if os.path.exists(OUTPUT_EXCEL_PATH):
        log.info("Resuming from existing output file: %s", OUTPUT_EXCEL_PATH)
        df = _read_file(OUTPUT_EXCEL_PATH)

        # Ensure both output columns exist (handles first-run edge case)
        if OUTPUT_COL_EXPENSE_TYPE not in df.columns:
            df[OUTPUT_COL_EXPENSE_TYPE] = ""
        if OUTPUT_COL_AI_EXPLANATION not in df.columns:
            df[OUTPUT_COL_AI_EXPLANATION] = ""
    else:
        log.info("No output file found. Loading input: %s", INPUT_EXCEL_PATH)
        if not os.path.exists(INPUT_EXCEL_PATH):
            log.error("Input file not found: %s", INPUT_EXCEL_PATH)
            sys.exit(1)

        df = _read_file(INPUT_EXCEL_PATH)
        df[OUTPUT_COL_EXPENSE_TYPE]  = ""
        df[OUTPUT_COL_AI_EXPLANATION] = ""

    # Normalise all cells: replace NaN strings / literal "nan" / "N/A" with ""
    df = df.fillna("")
    for col in df.columns:
        df[col] = df[col].replace({"nan": "", "NaN": "", "N/A": ""})

    return df


def _save_dataframe(df: pd.DataFrame) -> None:
    """Write the DataFrame to the output file (CSV or Excel)."""
    if OUTPUT_EXCEL_PATH.lower().endswith(".csv"):
        df.to_csv(OUTPUT_EXCEL_PATH, index=False, encoding="utf-8-sig")
    else:
        df.to_excel(OUTPUT_EXCEL_PATH, index=False)
    log.info("Auto-saved → %s", OUTPUT_EXCEL_PATH)


# ---------------------------------------------------------------------------
# MAIN PROCESSING LOOP
# ---------------------------------------------------------------------------

def main() -> None:
    # ── API key check ─────────────────────────────────────────────────────
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        log.error(
            "ANTHROPIC_API_KEY environment variable is not set.\n"
            "  Windows PowerShell : $env:ANTHROPIC_API_KEY = 'sk-ant-...'\n"
            "  Windows CMD        : set ANTHROPIC_API_KEY=sk-ant-...\n"
            "  macOS / Linux      : export ANTHROPIC_API_KEY='sk-ant-...'"
        )
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    # ── Load data ─────────────────────────────────────────────────────────
    df = _load_or_init_dataframe()
    total_rows = len(df)
    log.info("Total rows in dataset: %d", total_rows)

    # Identify rows that still need processing (Expense Type is blank)
    pending_mask = df[OUTPUT_COL_EXPENSE_TYPE].str.strip() == ""
    pending_indices = df.index[pending_mask].tolist()
    log.info("Rows already processed : %d", total_rows - len(pending_indices))
    log.info("Rows to process now    : %d", len(pending_indices))

    if not pending_indices:
        log.info("Nothing to do – all rows already categorised. Output: %s", OUTPUT_EXCEL_PATH)
        return

    # ── Processing loop ───────────────────────────────────────────────────
    newly_processed = 0
    errors = 0

    for position, idx in enumerate(pending_indices, start=1):
        row = df.loc[idx]
        user_message = _build_user_message(row)

        recipient = _safe_str(row.get("Recipient Name", ""))
        log.info(
            "[%d/%d] idx=%d  Recipient: %s",
            position, len(pending_indices), idx, recipient[:60] or "(blank)",
        )

        try:
            result = _call_api(client, user_message)
            df.at[idx, OUTPUT_COL_EXPENSE_TYPE]  = result["expense_type"]
            df.at[idx, OUTPUT_COL_AI_EXPLANATION] = result.get("explanation", "")
            newly_processed += 1

        except anthropic.RateLimitError:
            # All retries exhausted on rate-limit – mark and continue
            log.error("Rate limit – all retries exhausted for idx=%d. Marking as ERROR.", idx)
            df.at[idx, OUTPUT_COL_EXPENSE_TYPE]  = "ERROR"
            df.at[idx, OUTPUT_COL_AI_EXPLANATION] = "Rate limit – max retries exceeded"
            errors += 1

        except anthropic.APIStatusError as exc:
            log.error("API error (HTTP %d) for idx=%d: %s", exc.status_code, idx, exc.message)
            df.at[idx, OUTPUT_COL_EXPENSE_TYPE]  = "ERROR"
            df.at[idx, OUTPUT_COL_AI_EXPLANATION] = f"API error {exc.status_code}"
            errors += 1

        except json.JSONDecodeError as exc:
            log.error("JSON parse failure for idx=%d: %s", idx, exc)
            df.at[idx, OUTPUT_COL_EXPENSE_TYPE]  = "ERROR"
            df.at[idx, OUTPUT_COL_AI_EXPLANATION] = "JSON parse error"
            errors += 1

        except Exception as exc:  # noqa: BLE001
            log.error("Unexpected error for idx=%d: %s", idx, exc)
            df.at[idx, OUTPUT_COL_EXPENSE_TYPE]  = "ERROR"
            df.at[idx, OUTPUT_COL_AI_EXPLANATION] = f"Unexpected error: {exc}"
            errors += 1

        # ── Auto-save every AUTOSAVE_INTERVAL newly processed rows ────────
        if newly_processed > 0 and newly_processed % AUTOSAVE_INTERVAL == 0:
            _save_dataframe(df)

    # ── Final save ────────────────────────────────────────────────────────
    _save_dataframe(df)

    log.info("=" * 60)
    log.info("Processing complete.")
    log.info("  Total rows      : %d", total_rows)
    log.info("  Processed this run : %d", newly_processed)
    log.info("  Errors this run    : %d", errors)
    log.info("  Output file     : %s", OUTPUT_EXCEL_PATH)
    log.info("=" * 60)


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    main()
