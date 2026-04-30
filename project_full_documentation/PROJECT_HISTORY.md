# Project History

This history is reconstructed from the current repository contents, embedded file comments, filenames, timestamps, and cleanup logs. It is not derived from a trustworthy git commit history because the local git worktree is currently dirty and contains historical staging noise.

## 1. Initial local extraction stage

The earliest architecture visible in the repository is a collection of direct local scripts:

- `form990_to_excel.py`
- `run_streaming_extractor.py`
- `categorize_grants.py`
- `categorize_keywords.py`
- `build_boss_excel.py`
- `build_final_summary.py`
- `create_jewish_master.py`
- `classify_and_split.py`

The design assumption in this stage was simple: local IRS ZIP files already exist on disk, so parse them directly, classify the rows, and write spreadsheet deliverables.

Key characteristics of this stage:

- heavy emphasis on CSV and Excel outputs,
- multiple scripts solving adjacent pieces of the same workflow,
- minimal shared infrastructure,
- duplicated XML parsing and classification logic across several files.

## 2. Streaming and resume-safe extraction

By March 31, 2026, the project had a more robust local extraction path documented in `API_Restore_Rerun_Instructions.txt`.

That document records:

- extraction in progress from `run_streaming_extractor.py`,
- 18 of 62 ZIP archives processed at that time,
- about 4.95 million rows confirmed extracted,
- a projected full dataset of more than 9.7 million rows,
- AI classification blocked at that time by Anthropic credit availability.

The important design decision here was to make extraction resume-safe and chunked, so long-running jobs could survive interruptions without losing completed work.

## 3. SQLite-based structured pipeline

A later milestone introduced the `standalone_pipeline/` package. This was a step up from the ad hoc root scripts.

It added:

- a manifest database (`irs_manifest`),
- a grant table (`irs_grants`),
- an AI cache table (`ai_cache`),
- a three-phase execution model,
- optional download and reconciliation logic,
- an explicit categorization stage with cost controls.

The major reasoning behind this change was operational control. Instead of relying on flat CSV progress or manual file tracking, the pipeline could track download status, extraction status, and AI cache reuse in SQLite.

## 4. PostgreSQL warehouse pipeline

Another major milestone introduced `irs_db/` and `irs_pipeline/`, which together form the database-backed warehouse path.

This added:

- `irs_db/schema.sql` for warehouse tables and indexes,
- `irs_db/parser.py` for filing and grant extraction,
- `irs_db/loader.py` for warehouse inserts and pipeline state management,
- `irs_db/exporter.py` for controlled exports and reporting views,
- `irs_pipeline/audit_downloader.py` for manifest and delta downloads,
- `irs_pipeline/extractor.py` for XML-to-PostgreSQL extraction,
- `irs_pipeline/ai_categorizer.py` for batched AI classification.

This stage reflects a move toward a more enterprise-friendly architecture: normalized storage, reporting views, operational state tables, and clearer separation between download, parse, load, and export responsibilities.

## 5. Neon experiment

The `neon_pipeline/` directory shows an additional experimental branch of work intended for remote Postgres / Neon usage with streaming extraction and downstream analysis.

The reasoning appears to have been:

- reduce local storage dependence,
- stream XML directly into a remote database,
- run lighter-weight remote analytics.

This branch is still useful as historical context, but it is not the current primary path.

## 6. Security and dashboard overhaul

A major modernization pass happened on April 20-21, 2026, based on file timestamps and current code state.

Main changes from that pass:

- hardcoded database credentials were removed from code and replaced with environment-based configuration,
- DSN redaction helpers were added in `project_utils/security.py`,
- export filtering was rewritten to use allowlisted parsing in `project_utils/export_filters.py`,
- artifact paths were centralized in `project_utils/paths.py`,
- a read-only Streamlit dashboard was added in `dashboard_app.py` and `dashboard/`,
- tests were added for DSN redaction and export filter safety,
- several reliability issues were corrected in downloader and pipeline modules.

The reasoning is clear: make the project safer to operate, easier to navigate, and more usable for interactive analysis.

## 7. Storage consolidation and disk cleanup

On April 23-24, 2026, the project was explicitly restructured for disk management.

Milestones from that stage:

- `cleanup_processed_zips.py` was added on April 23, 2026,
- `cleanup_dashboard_runtime_artifacts.py` was added on April 24, 2026,
- all large runtime artifacts were consolidated under `workspace_data/`,
- raw ZIP folders, logs, exports, and deliverable folders were deleted after confirming the dashboard could still run from retained databases.

The cleanup logs record:

- `dashboard_runtime_cleanup_20260424T075559Z.json`: about 20.00 GiB freed
- `dashboard_nonruntime_cleanup_20260424T173852Z.json`: about 2.30 GiB freed

The core tradeoff was intentional:

- keep the databases that power the current dashboard,
- remove raw archives and derivative files that can be regenerated or re-downloaded later.

## 8. Current project state

The repository is now best understood as a cleaned runtime snapshot:

- code is present,
- the current dashboard databases are present,
- raw archives are not present,
- historical exports are not present,
- the codebase contains both current and legacy workflows.

## Problems Encountered and Solutions Applied

### Secret exposure risk

Problem:
earlier code paths embedded or expected direct DSN values in code.

Solution:
move configuration to `.env` / environment variables and redact DSNs before logging.

### Unsafe export filtering

Problem:
export surfaces previously allowed raw SQL-like filter behavior.

Solution:
implement allowlisted filter parsing in `project_utils/export_filters.py` and use bound parameters in `irs_db/exporter.py`.

### Large artifact sprawl

Problem:
ZIPs, databases, exports, logs, and deliverables were scattered and consumed large disk space.

Solution:
centralize artifact paths under `workspace_data/`, then perform validated cleanup once dashboard runtime only needed SQLite databases.

### SQLite thread safety risk

Problem:
one pipeline path performed SQLite state updates in an unsafe multi-threaded pattern.

Solution:
move SQLite mutation back to a safe execution path and keep concurrent network work separate from DB writes.

### Logic duplication

Problem:
XML parsing and classification rules exist in several scripts and packages.

Solution:
only partial progress has been made. The current documentation marks this as an outstanding architectural issue rather than claiming it is fully solved.
