"""
irs_db/config.py
================
Single source of truth for all configuration.

Set environment variables OR edit the defaults below.
Recommended: create a .env file (never commit it to git).

.env example:
    IRS_DB_DSN=postgresql://postgres:yourpassword@localhost:5432/irs990
"""

import os
from pathlib import Path

# ── Database ──────────────────────────────────────────────────────────────────

# Full PostgreSQL connection string.
# Format: postgresql://user:password@host:port/dbname
DB_DSN = os.getenv(
    "IRS_DB_DSN",
    "postgresql://postgres:Akshay@127.0.0.1:5432/irs990"
)

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent.parent   # project root

ZIP_SOURCE_FOLDERS = [
    BASE_DIR / "Form 990",
    BASE_DIR / "OneDrive_2026-03-29" / "new data",
]

SCHEMA_FILE = Path(__file__).parent / "schema.sql"

# Where to save downloaded ZIPs (if using downloader.py)
DOWNLOAD_DIR = BASE_DIR / "Form 990"

# ── Processing ────────────────────────────────────────────────────────────────

BATCH_SIZE_GRANTS   = 1_000   # rows per execute_values call for irs_grants
BATCH_SIZE_FILINGS  =   500   # rows per execute_values call for irs_filings

# ── IRS Download URLs ─────────────────────────────────────────────────────────
# IRS publishes bulk XML on AWS S3. Index CSV lists every filing.
IRS_S3_BASE         = "https://s3.amazonaws.com/irs-form-990"
IRS_INDEX_URL       = IRS_S3_BASE + "/index_{year}.csv"   # one per year
IRS_TEOS_BASE       = "https://apps.irs.gov/pub/epostcard/990/xml"
