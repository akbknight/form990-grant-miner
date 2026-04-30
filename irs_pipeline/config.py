"""
irs_pipeline/config.py
======================
Single source of truth for all configuration across all three phases.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

from project_utils.paths import (
    IRS_PIPELINE_LOG_DIR,
    IRS_PIPELINE_XML_DATA_DIR,
    PIPELINE_SQLITE_DB_PATH,
    PROJECT_ROOT,
    ensure_data_layout,
)
from project_utils.security import getenv_str, redact_dsn

BASE_DIR = PROJECT_ROOT
DATA_DIR = IRS_PIPELINE_XML_DATA_DIR          # where individual XML files live
DB_SQLITE = PIPELINE_SQLITE_DB_PATH           # SQLite for manifest + AI cache
LOG_DIR = IRS_PIPELINE_LOG_DIR
load_dotenv(BASE_DIR / ".env")

# ── PostgreSQL (existing database) ────────────────────────────────────────────
DB_DSN = getenv_str("IRS_DB_DSN", getenv_str("DATABASE_URL"))

# ── IRS S3 ─────────────────────────────────────────────────────────────────────
S3_BUCKET        = "irs-form-990"
S3_BASE_URL      = f"https://s3.amazonaws.com/{S3_BUCKET}"
INDEX_URL        = S3_BASE_URL + "/index_{year}.csv"
FILING_URL       = S3_BASE_URL + "/{object_id}_public.xml"
TARGET_YEARS     = list(range(2019, 2026))     # 2019 – 2025

# ── Download settings ──────────────────────────────────────────────────────────
DOWNLOAD_WORKERS    = 8        # parallel download threads
DOWNLOAD_CHUNK_SIZE = 1024 * 512  # 512 KB streaming chunks
MAX_RETRIES         = 5
RETRY_WAIT_MIN      = 2        # seconds
RETRY_WAIT_MAX      = 30

# ── Extraction / DB ────────────────────────────────────────────────────────────
EXTRACT_BATCH_SIZE  = 500      # rows per PostgreSQL upsert

# ── Anthropic API ──────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY   = os.getenv("ANTHROPIC_API_KEY", "")
AI_MODEL            = "claude-haiku-4-5-20251001"   # cheapest model, fast
AI_BATCH_SIZE       = 10       # grants per API call (reduces system-prompt overhead)
AI_MAX_TOKENS       = 1024
AI_WORKERS          = 3        # parallel API threads (stay under rate limit)


def get_db_dsn(required: bool = True) -> str:
    """Return the configured Postgres DSN, optionally requiring it."""
    if DB_DSN:
        return DB_DSN
    if required:
        raise RuntimeError(
            "IRS_DB_DSN is not set. Add it to your environment or .env file."
        )
    return ""


def redacted_db_dsn() -> str:
    """Return a masked DSN for logs and status output."""
    return redact_dsn(DB_DSN)

# Create needed directories
ensure_data_layout()
DATA_DIR.mkdir(parents=True, exist_ok=True)
