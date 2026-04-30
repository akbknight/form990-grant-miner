# Architecture

## System Summary

The repository contains one business domain implemented through multiple workflow styles. The domain is IRS Form 990 grant intelligence. The workflows differ mainly by storage backend and output style.

The current architecture can be divided into five layers:

1. source acquisition,
2. XML parsing and classification,
3. storage and warehousing,
4. exports and presentation,
5. operational support utilities.

## Layer 1: Source Acquisition

Source acquisition is split across several code paths.

### Current IRS bulk ZIP path

The current bulk ZIP-oriented logic points to the IRS TEOS ZIP endpoints under `https://apps.irs.gov/pub/epostcard/990/xml`.

Relevant files:

- `irs_db/downloader.py`
- `standalone_pipeline/config.py`
- `standalone_pipeline/audit_downloader.py`
- `extract_2024_to_csv.py`
- `master_pipeline.py`
- `form990_to_excel.py`

### Legacy IRS S3 path

Some warehouse-oriented and Neon-oriented modules still reference historical S3 endpoints.

Relevant files:

- `irs_pipeline/config.py`
- `irs_pipeline/audit_downloader.py`
- `neon_pipeline/config.py`
- `neon_pipeline/stream_pipeline.py`

This is important because not every pipeline path is aligned to the same IRS delivery mechanism.

## Layer 2: XML Parsing and Classification

Parsing logic exists in several forms.

### Shared parsing patterns

Across the repository, parsers generally do the same work:

- detect XML namespace,
- locate filing metadata,
- identify grant group elements,
- derive recipient, geography, amount, description, subject, and support strategy,
- classify rows into a limited category set.

### Main parsing implementations

- `irs_db/parser.py`: warehouse parser for filings and grants
- `standalone_pipeline/extractor.py`: standalone pipeline parser
- `standalone_pipeline/extract_2023_2024.py`: direct ZIP-to-SQLite extractor for 2023/2024
- `master_pipeline.py`: local bulk parser with CSV/Excel output
- `run_streaming_extractor.py`: streaming local parser
- `form990_to_excel.py`: earlier local extractor
- `extract_2024_to_csv.py`: targeted 2024 extraction script

Classification logic is also duplicated:

- keyword-based classifiers live in several root scripts,
- `standalone_pipeline/ai_categorizer.py` and `irs_pipeline/ai_categorizer.py` add optional AI classification,
- the warehouse exporter and dashboard consume the final category values but do not classify data themselves.

## Layer 3: Storage and Warehousing

The project uses three storage modes.

### A. Local SQLite analytical database

`workspace_data/databases/irs990_2023_2024.db`

Purpose:
retain extracted grant rows for the current dashboard.

Current known tables:

- `irs_grants_2023_2024`
- `zip_progress`

Current row count at documentation time:

- `irs_grants_2023_2024`: `3,784,396`

### B. Local SQLite manifest / cache database

`workspace_data/databases/irs990_pipeline.db`

Purpose:
support manifest tracking, extraction bookkeeping, and AI deduplication for the standalone pipeline family.

Current known tables:

- `irs_manifest`
- `irs_grants`
- `ai_cache`

Current row counts at documentation time:

- `irs_manifest`: `4,244,922`
- `irs_grants`: `0`
- `ai_cache`: `0`

### C. PostgreSQL warehouse

Defined in `irs_db/schema.sql`.

Primary tables:

- `pipeline_state`
- `irs_filings`
- `irs_grants`

Reporting views created by `irs_db/exporter.py`:

- `v_grants_powerbi`
- `v_filing_summary`
- `v_stats`

Operational components:

- `irs_db/loader.py` handles schema initialization, inserts, indexes, and pipeline state.
- `irs_db/pipeline.py` orchestrates ZIP processing into PostgreSQL.
- `sqlite_to_postgres.py` provides a transfer utility from SQLite to PostgreSQL.

## Layer 4: Exports and Presentation

### Export surfaces

- `master_pipeline.py`: full CSV plus multi-part Excel output
- `export_to_excel.py`: spreadsheet output helper
- `build_boss_excel.py`, `build_final_summary.py`, `create_jewish_master.py`: specialized workbook builders
- `irs_db/exporter.py`: PostgreSQL CSV and Excel exports, plus reporting views

### Dashboard surface

- `dashboard_app.py`: Streamlit entry point
- `dashboard/data_access.py`: read-only source discovery and query functions
- `dashboard/presentation.py`: CSS, formatting, and Plotly chart builders
- `.streamlit/config.toml`: dashboard theme and runtime settings

The dashboard is intentionally decoupled from PostgreSQL. It reads SQLite files in read-only mode.

## Layer 5: Operational Support Utilities

- `project_utils/paths.py`: canonical artifact locations
- `project_utils/security.py`: environment handling, DSN redaction, read-only SQLite URI builder
- `project_utils/export_filters.py`: allowlisted export filter parser
- `cleanup_processed_zips.py`: safe preview/delete tool for redundant ZIP copies
- `cleanup_dashboard_runtime_artifacts.py`: safe cleanup tool for non-runtime artifacts
- `tests/test_export_filters.py`, `tests/test_security.py`: targeted unit tests

## Folder and File Organization

```text
.streamlit/                  Streamlit configuration
dashboard/                   Dashboard query and rendering helpers
irs_db/                      PostgreSQL schema, parser, loader, exporter, ZIP pipeline
irs_pipeline/                Multi-phase manifest/download/extract/AI pipeline
neon_pipeline/               Experimental remote Postgres pipeline
project_utils/               Shared path, security, and filter helpers
standalone_pipeline/         Local SQLite pipeline variant
tests/                       Small unit test suite
workspace_data/databases/    Retained SQLite runtime databases
```

## Component Interactions

### Dashboard path

```text
SQLite database
  -> dashboard/data_access.py
  -> dashboard/presentation.py
  -> dashboard_app.py
  -> browser session
```

### PostgreSQL pipeline path

```text
IRS index / XML
  -> irs_pipeline/audit_downloader.py
  -> irs_pipeline/db_sqlite.py (manifest + cache)
  -> irs_pipeline/extractor.py
  -> irs_db/parser.py
  -> irs_db/loader.py
  -> PostgreSQL warehouse
  -> irs_db/exporter.py
```

### Local bulk path

```text
Local ZIP archives
  -> master_pipeline.py or run_streaming_extractor.py
  -> CSV / Excel deliverables
```

### Standalone SQLite path

```text
IRS ZIPs or extracted XML
  -> standalone_pipeline/audit_downloader.py
  -> standalone_pipeline/extractor.py or extract_2023_2024.py
  -> SQLite database
  -> standalone_pipeline/ai_categorizer.py
```

## Security Architecture

The most important security boundaries now in place are:

- secrets come from environment variables or `.env`, not hardcoded source,
- DSNs are redacted before logging,
- dashboard reads SQLite in read-only mode,
- dashboard query filters are parameterized,
- PostgreSQL export filters are allowlisted and parameterized,
- `.gitignore` blocks `.env`, local secrets, venvs, ZIPs, databases, and workspace artifacts by default.

## Architectural Assessment

The repository has a useful core and real business value, but it is not a single clean monolith. It is a layered codebase with both current and legacy workflows. The current maintainable center of gravity is:

- `dashboard/`
- `dashboard_app.py`
- `project_utils/`
- `irs_db/`
- `irs_pipeline/`

The root scripts and `standalone_pipeline/` remain important for history, operations, and specific local workflows, but they are not as well normalized as the newer layers.
