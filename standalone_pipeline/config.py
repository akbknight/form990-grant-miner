"""
config.py
=========
Centralized settings for all pipeline phases.
Edit this file OR set environment variables.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
DATA_DIR    = BASE_DIR / "irs_xml_data"        # downloaded XML files
DB_PATH     = BASE_DIR / "irs990_pipeline.db"  # SQLite database
LOG_DIR     = BASE_DIR / "logs"

# ── IRS S3 ─────────────────────────────────────────────────────────────────────
S3_BUCKET       = "irs-form-990"
S3_BASE_URL     = f"https://s3.amazonaws.com/{S3_BUCKET}"
INDEX_URL       = S3_BASE_URL + "/index_{year}.csv"
FILING_URL      = S3_BASE_URL + "/{object_id}_public.xml"
TARGET_YEARS    = list(range(2019, 2026))       # 2019 – 2025

# ── Download ───────────────────────────────────────────────────────────────────
DOWNLOAD_WORKERS    = 8
DOWNLOAD_CHUNK_SIZE = 524288                    # 512 KB
MAX_RETRIES         = 5
RETRY_WAIT_MIN      = 2
RETRY_WAIT_MAX      = 30

# ── Extraction ─────────────────────────────────────────────────────────────────
EXTRACT_BATCH_SIZE  = 500

# ── Anthropic ──────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY   = os.getenv("ANTHROPIC_API_KEY", "")
AI_MODEL            = "claude-3-haiku-20240307"
AI_BATCH_SIZE       = 10
AI_MAX_TOKENS       = 1024

# ── Create dirs ────────────────────────────────────────────────────────────────
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)
