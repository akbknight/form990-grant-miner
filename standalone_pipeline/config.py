"""
config.py
=========
Centralized settings for all pipeline phases.
Edit this file OR set environment variables.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

from project_utils.paths import (
    PROJECT_ROOT,
    STANDALONE_DB_PATH,
    STANDALONE_LOG_DIR,
    STANDALONE_XML_DATA_DIR,
    ensure_data_layout,
)

load_dotenv()

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR = PROJECT_ROOT
DATA_DIR = STANDALONE_XML_DATA_DIR        # downloaded XML files
DB_PATH = STANDALONE_DB_PATH              # SQLite database
LOG_DIR = STANDALONE_LOG_DIR

# ── IRS Downloads (migrated from S3 to apps.irs.gov in 2025) ───────────────────
# Old S3 URLs (no longer work as of 2025):
#   https://s3.amazonaws.com/irs-form-990/index_{year}.csv
#   https://s3.amazonaws.com/irs-form-990/{object_id}_public.xml
#
# New URLs — index CSVs and ZIP archives only (no individual XMLs):
IRS_BASE_URL    = "https://apps.irs.gov/pub/epostcard/990/xml"
INDEX_URL       = IRS_BASE_URL + "/{year}/index_{year}.csv"
ZIP_URL         = IRS_BASE_URL + "/{year}/{zip_name}"
TARGET_YEARS    = list(range(2019, 2026))       # 2019 – 2025

# ZIP file naming patterns differ by year:
#   2019:       download990xml_2019_1.zip ... download990xml_2019_8.zip
#               + 2019_TEOS_XML_CT1.zip
#   2020:       download990xml_2020_1.zip ... + 2020_TEOS_XML_CT1.zip
#   2021-2026:  {year}_TEOS_XML_01A.zip, {year}_TEOS_XML_02A.zip, ...
IRS_DOWNLOADS_PAGE = "https://www.irs.gov/charities-non-profits/form-990-series-downloads"

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
ensure_data_layout()
DATA_DIR.mkdir(parents=True, exist_ok=True)
