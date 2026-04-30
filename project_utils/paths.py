"""Canonical artifact locations for large local datasets and outputs."""

from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORKSPACE_DATA_DIR = PROJECT_ROOT / "workspace_data"

FORM_990_DIR = WORKSPACE_DATA_DIR / "Form 990"
ONEDRIVE_MIRROR_DIR = WORKSPACE_DATA_DIR / "OneDrive_2026-03-29"
ONEDRIVE_NEW_DATA_DIR = ONEDRIVE_MIRROR_DIR / "new data"

DATABASE_DIR = WORKSPACE_DATA_DIR / "databases"
EXPORT_DIR = WORKSPACE_DATA_DIR / "exports"
LOG_DIR = WORKSPACE_DATA_DIR / "logs"
PIPELINE_DATA_DIR = WORKSPACE_DATA_DIR / "pipeline_data"
STANDALONE_PIPELINE_DATA_DIR = PIPELINE_DATA_DIR / "standalone_pipeline"
IRS_PIPELINE_DATA_DIR = PIPELINE_DATA_DIR / "irs_pipeline"
BOSS_DELIVERABLES_DIR = WORKSPACE_DATA_DIR / "Boss_Deliverables"
BOSS_DELIVERABLES_2023_2024_DIR = WORKSPACE_DATA_DIR / "Boss_Deliverables_2023_2024"

WAREHOUSE_DB_PATH = DATABASE_DIR / "irs990_2023_2024.db"
STANDALONE_DB_PATH = DATABASE_DIR / "irs990_pipeline.db"
PIPELINE_SQLITE_DB_PATH = DATABASE_DIR / "irs_pipeline.db"

STANDALONE_XML_DATA_DIR = STANDALONE_PIPELINE_DATA_DIR / "irs_xml_data"
STANDALONE_TEMP_DIR = STANDALONE_PIPELINE_DATA_DIR / "_tmp_xml"
STANDALONE_LOG_DIR = LOG_DIR / "standalone_pipeline"

IRS_PIPELINE_XML_DATA_DIR = IRS_PIPELINE_DATA_DIR / "irs_s3_data"
IRS_PIPELINE_LOG_DIR = LOG_DIR / "irs_pipeline"

EXPORT_2024_CSV_PATH = EXPORT_DIR / "irs990_2024_grants.csv"
FORM990_EXTRACTED_CSV_PATH = EXPORT_DIR / "form990_extracted_output.csv"
FORM990_EXTRACTED_XLSX_PATH = EXPORT_DIR / "form990_extracted_output.xlsx"
FORM990_STREAMING_CSV_PATH = EXPORT_DIR / "form990_streaming_output.csv"
FORM990_MASTER_CSV_PATH = EXPORT_DIR / "form990_master_output.csv"
JEWISH_MASTER_XLSX_PATH = EXPORT_DIR / "Jewish_Grants_Master.xlsx"
JEWISH_MASTER_DB_XLSX_PATH = EXPORT_DIR / "Jewish_Grants_Master_DB.xlsx"
STATUS_XLSX_PATH = EXPORT_DIR / "AI_Extracted_Data_Current_Status.xlsx"
FULL_PART_PREFIX_PATH = EXPORT_DIR / "AI_Extracted_Data_Full_Part"

EXTRACTION_PROGRESS_LOG_PATH = LOG_DIR / "extraction_progress.log"
PIPELINE_PROGRESS_LOG_PATH = LOG_DIR / "pipeline_progress.log"
IRS_DB_PIPELINE_LOG_PATH = LOG_DIR / "irs_db_pipeline.log"
STREAMLIT_STDOUT_LOG_PATH = LOG_DIR / "streamlit-dashboard.log"
STREAMLIT_STDERR_LOG_PATH = LOG_DIR / "streamlit-dashboard.err.log"


def ensure_data_layout() -> None:
    """Create the parent directories used for large runtime artifacts."""
    for path in (
        WORKSPACE_DATA_DIR,
        DATABASE_DIR,
        EXPORT_DIR,
        LOG_DIR,
        PIPELINE_DATA_DIR,
        STANDALONE_PIPELINE_DATA_DIR,
        IRS_PIPELINE_DATA_DIR,
        STANDALONE_LOG_DIR,
        IRS_PIPELINE_LOG_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
