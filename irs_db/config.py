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

from dotenv import load_dotenv

from project_utils.paths import (
    FORM_990_DIR,
    ONEDRIVE_NEW_DATA_DIR,
    PROJECT_ROOT,
)
from project_utils.security import getenv_str, redact_dsn

# ── Database ──────────────────────────────────────────────────────────────────

# Full PostgreSQL connection string.
# Format: postgresql://user:password@host:port/dbname
DB_DSN = getenv_str("IRS_DB_DSN", getenv_str("DATABASE_URL"))

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR = PROJECT_ROOT
load_dotenv(BASE_DIR / ".env")

ZIP_SOURCE_FOLDERS = [
    FORM_990_DIR,
    ONEDRIVE_NEW_DATA_DIR,
]

SCHEMA_FILE = Path(__file__).parent / "schema.sql"

# Where to save downloaded ZIPs (if using downloader.py)
DOWNLOAD_DIR = FORM_990_DIR

# ── Processing ────────────────────────────────────────────────────────────────

BATCH_SIZE_GRANTS   = 1_000   # rows per execute_values call for irs_grants
BATCH_SIZE_FILINGS  =   500   # rows per execute_values call for irs_filings

# ── IRS Download URLs ─────────────────────────────────────────────────────────
# IRS publishes bulk XML on AWS S3. Index CSV lists every filing.
IRS_S3_BASE         = "https://s3.amazonaws.com/irs-form-990"
IRS_INDEX_URL       = IRS_S3_BASE + "/index_{year}.csv"   # one per year
IRS_TEOS_BASE       = "https://apps.irs.gov/pub/epostcard/990/xml"


def get_db_dsn(required: bool = True) -> str:
    """Return the configured warehouse DSN, optionally requiring it."""
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
