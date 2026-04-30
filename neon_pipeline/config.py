"""
config.py  —  Neon Pipeline Settings
=====================================
All settings read from environment variables or a .env file.

Create a .env file in this folder:
    NEON_DSN=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require

Get your DSN from: https://console.neon.tech  → your project → Connection Details
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from this folder
load_dotenv(Path(__file__).parent / ".env")

# ── Neon Postgres ──────────────────────────────────────────────────────────────
NEON_DSN = os.getenv("NEON_DSN", "")   # required — set in .env

# ── IRS S3 (public, no auth) ───────────────────────────────────────────────────
S3_BASE      = "https://s3.amazonaws.com/irs-form-990"
INDEX_URL    = S3_BASE + "/index_{year}.csv"
FILING_URL   = S3_BASE + "/{object_id}_public.xml"
TARGET_YEARS = list(range(2019, 2026))   # 2019 – 2025

# ── Streaming / parsing ────────────────────────────────────────────────────────
STREAM_CHUNK_SIZE  = 65_536      # 64 KB per read — keeps RAM flat
INSERT_BATCH_SIZE  = 500         # rows per DB round-trip
HTTP_TIMEOUT       = 90          # seconds per request

# ── Retry policy ──────────────────────────────────────────────────────────────
MAX_RETRIES    = 5
RETRY_WAIT_MIN = 2
RETRY_WAIT_MAX = 30

# ── Grant XML element tags to search for ──────────────────────────────────────
# IRS uses slightly different tag names across filing years — try all of them.
GRANT_TAGS = [
    "GrantOrContributionPdDurYrGrp",
    "GrantOrContriPdDurYrGrp",
    "GrantOrContributionPaidDuringYearGrp",
    "RecipientTableGrp",
]
