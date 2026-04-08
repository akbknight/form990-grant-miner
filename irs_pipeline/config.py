"""
irs_pipeline/config.py
======================
Single source of truth for all configuration across all three phases.
"""

import os
from pathlib import Path

BASE_DIR  = Path(__file__).parent.parent
DATA_DIR  = BASE_DIR / "irs_s3_data"          # where individual XML files live
DB_SQLITE = BASE_DIR / "irs_pipeline.db"      # SQLite for manifest + AI cache
LOG_DIR   = BASE_DIR / "logs"

# ── PostgreSQL (existing database) ────────────────────────────────────────────
DB_DSN = os.getenv(
    "IRS_DB_DSN",
    "postgresql://postgres:Akshay@127.0.0.1:5432/irs990"
)

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

# Create needed directories
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)
