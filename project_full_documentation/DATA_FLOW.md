# Data Flow

The repository contains several parallel data flows. The important point is that not all scripts participate in the same end-to-end path.

## Flow A: Local ZIP to CSV / Excel

This is the original local reporting workflow.

```text
IRS bulk ZIP files on disk
  -> XML parsing in root scripts
  -> keyword classification
  -> CSV output
  -> Excel summary / deliverable files
```

Main files involved:

- `master_pipeline.py`
- `form990_to_excel.py`
- `run_streaming_extractor.py`
- `categorize_grants.py`
- `categorize_keywords.py`
- `build_boss_excel.py`
- `build_final_summary.py`
- `create_jewish_master.py`
- `classify_and_split.py`
- `export_to_excel.py`

Input expectations:

- ZIP archives under `workspace_data/Form 990`
- optional mirror / overflow ZIPs under `workspace_data/OneDrive_2026-03-29/new data`

Outputs originally produced:

- CSV extracts
- Jewish grant workbook
- multi-part Excel workbooks
- status and summary workbooks

Current status:

- the code still exists,
- the raw ZIP inputs and generated outputs were deleted on April 24, 2026.

## Flow B: Direct 2023/2024 SQLite extraction

This is a targeted local extraction path for a subset of bulk ZIPs.

```text
2023 and 2024 IRS ZIPs
  -> standalone_pipeline/extract_2023_2024.py
  -> SQLite table irs_grants_2023_2024
  -> dashboard
```

Main files involved:

- `standalone_pipeline/extract_2023_2024.py`
- `project_utils/paths.py`
- `dashboard/data_access.py`

Retained output:

- `workspace_data/databases/irs990_2023_2024.db`

## Flow C: Standalone SQLite multi-phase pipeline

This is the more structured local pipeline.

```text
IRS downloads page / IRS ZIP naming rules
  -> standalone_pipeline/audit_downloader.py
  -> local XML and manifest bookkeeping
  -> standalone_pipeline/extractor.py
  -> SQLite irs_grants table
  -> standalone_pipeline/ai_categorizer.py
```

Supporting modules:

- `standalone_pipeline/config.py`
- `standalone_pipeline/db_sqlite.py`
- `standalone_pipeline/run_pipeline.py`

Data structures:

- `irs_manifest`: what exists and what was downloaded / extracted
- `irs_grants`: parsed grant records
- `ai_cache`: API result deduplication

Current retained database:

- `workspace_data/databases/irs990_pipeline.db`

Current runtime reality:

- manifest rows remain,
- extracted grants are currently absent in that retained DB snapshot.

## Flow D: PostgreSQL warehouse pipeline

This is the warehouse-oriented path.

```text
IRS index and XML sources
  -> irs_pipeline/audit_downloader.py
  -> SQLite manifest and cache
  -> irs_pipeline/extractor.py
  -> irs_db/parser.py
  -> irs_db/loader.py
  -> PostgreSQL irs_filings + irs_grants
  -> irs_db/exporter.py
```

Purpose:

- separate ingestion state from warehouse state,
- keep a normalized store of filing-level and grant-level data,
- support reporting views and safe filtered exports.

Main data structures:

- `pipeline_state` in PostgreSQL
- `irs_filings` in PostgreSQL
- `irs_grants` in PostgreSQL
- `irs_manifest` and `ai_cache` in SQLite for orchestration support

## Flow E: Dashboard runtime flow

This is the main currently usable business surface.

```text
SQLite database(s)
  -> dashboard/data_access.py
  -> parameterized query functions
  -> dashboard/presentation.py
  -> dashboard_app.py
  -> interactive Streamlit UI
  -> optional CSV download of current slice
```

Important runtime safeguards:

- SQLite is opened through a read-only URI,
- dashboard filters are parameterized,
- record explorer row count is capped,
- the UI never writes back into the data stores.

## External APIs and Integrations

### IRS data sources

Current ZIP-oriented source:

- `https://apps.irs.gov/pub/epostcard/990/xml`

Historical / legacy source referenced by some modules:

- `https://s3.amazonaws.com/irs-form-990`

### Anthropic API

Used by:

- `irs_pipeline/ai_categorizer.py`
- `standalone_pipeline/ai_categorizer.py`
- `categorize_grants.py`

Usage pattern:

- send batches of grant text,
- classify into small taxonomy,
- cache results to avoid duplicate spend.

### Databases

- SQLite: local analytical and operational state
- PostgreSQL: warehouse and reporting views
- Neon: experimental remote Postgres target

## Data Movement Summary by Current State

As of this documentation snapshot:

- code for all major flows is present,
- the dashboard flow is immediately usable,
- the direct local ZIP flows are code-complete but blocked by missing raw ZIPs,
- the warehouse flow requires external PostgreSQL and fresh source data,
- the standalone manifest DB remains, but it is not currently the primary analytical source.
