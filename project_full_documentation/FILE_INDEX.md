# File Index

This index focuses on the files that matter to understanding, running, or extending the project. Very large dependency directories such as `.venv`, `.venv312`, and `standalone_pipeline/venv` are intentionally excluded.

## Root-level project files

- `README.md`: current top-level repository overview.
- `.env.example`: template for local environment variables.
- `.gitignore`: ignore rules for data, secrets, venvs, and workspace artifacts.
- `.streamlit/config.toml`: Streamlit theme and runtime defaults.
- `API_Restore_Rerun_Instructions.txt`: operational note captured on March 31, 2026 for rerunning the extraction and AI pipeline.
- `requirements_db.txt`: dependencies for PostgreSQL warehouse tooling.
- `requirements_pipeline.txt`: dependencies for the multi-phase pipeline.
- `requirements_dashboard.txt`: dependencies for the Streamlit dashboard.
- `import os.py`: accidental stray file; not part of the intended architecture.

## Root-level dashboard and reporting entry points

- `dashboard_app.py`: Streamlit application entry point.
- `master_pipeline.py`: all-in-one local ZIP-to-CSV/XLSX pipeline with keyword classification.
- `form990_to_excel.py`: earlier local extractor that writes tabular output from ZIP/XML inputs.
- `run_streaming_extractor.py`: streaming local extractor intended for very large runs.
- `extract_2024_to_csv.py`: focused extractor for 2024 ZIP batches.
- `export_to_excel.py`: helper for Excel-style export formatting.
- `sqlite_to_postgres.py`: utility to transfer SQLite data into PostgreSQL with safer identifier handling.

## Root-level classification and workbook helpers

- `categorize_grants.py`: AI-based classification pass for extracted tabular data.
- `categorize_keywords.py`: lightweight keyword-only classification helper.
- `classify_and_split.py`: classification and multi-file spreadsheet splitting helper.
- `build_boss_excel.py`: generates presentation-oriented Excel output.
- `build_final_summary.py`: builds final summary workbook artifacts.
- `create_jewish_master.py`: creates Jewish-grants-focused workbook outputs.

## Dashboard package

- `dashboard/__init__.py`: package marker.
- `dashboard/data_access.py`: source discovery, filter options, metrics, trend, subject, geography, and record queries.
- `dashboard/presentation.py`: dashboard theme injection, number formatting, and Plotly chart creation.

## Shared utility package

- `project_utils/__init__.py`: package marker.
- `project_utils/paths.py`: canonical paths for runtime data, exports, logs, and databases.
- `project_utils/security.py`: environment-variable helpers, DSN redaction, read-only SQLite URI builder.
- `project_utils/export_filters.py`: allowlisted SQL filter parser for export surfaces.

## PostgreSQL warehouse package: `irs_db/`

- `irs_db/__init__.py`: package marker.
- `irs_db/config.py`: central configuration for the warehouse-oriented code path.
- `irs_db/schema.sql`: PostgreSQL schema with `pipeline_state`, `irs_filings`, `irs_grants`, and indexes.
- `irs_db/parser.py`: XML parser for filing-level and grant-level extraction.
- `irs_db/loader.py`: warehouse connection management, schema init, inserts, indexes, and pipeline bookkeeping.
- `irs_db/downloader.py`: expected ZIP inventory and download helper for IRS TEOS archives.
- `irs_db/pipeline.py`: orchestrates ZIP processing into PostgreSQL.
- `irs_db/exporter.py`: safe CSV/XLSX export utilities and reporting view creation.

## Multi-phase pipeline package: `irs_pipeline/`

- `irs_pipeline/__init__.py`: package marker.
- `irs_pipeline/config.py`: configuration for the three-phase pipeline.
- `irs_pipeline/db_sqlite.py`: SQLite manifest and AI cache schema for orchestration.
- `irs_pipeline/audit_downloader.py`: index retrieval, manifest population, local reconcile, and delta download.
- `irs_pipeline/extractor.py`: extraction phase into PostgreSQL.
- `irs_pipeline/ai_categorizer.py`: batched AI categorization for warehouse records.
- `irs_pipeline/run_pipeline.py`: master orchestrator for phases 1-3.

## Standalone SQLite pipeline package: `standalone_pipeline/`

- `standalone_pipeline/config.py`: configuration for the standalone local pipeline.
- `standalone_pipeline/db_sqlite.py`: SQLite schema for manifest, grants, and AI cache.
- `standalone_pipeline/audit_downloader.py`: audit, download, reconcile, and extraction support around ZIP/XML inputs.
- `standalone_pipeline/extractor.py`: XML-to-SQLite extraction logic.
- `standalone_pipeline/ai_categorizer.py`: AI categorization with cache and keyword pre-pass.
- `standalone_pipeline/extract_2023_2024.py`: dedicated extractor that builds `irs_grants_2023_2024`.
- `standalone_pipeline/run_pipeline.py`: standalone orchestrator.
- `standalone_pipeline/requirements.txt`: dependencies for the standalone pipeline.

## Neon experiment: `neon_pipeline/`

- `neon_pipeline/config.py`: Neon-specific DSN and legacy IRS endpoint configuration.
- `neon_pipeline/schema.sql`: schema for the Neon experiment.
- `neon_pipeline/stream_pipeline.py`: streaming extraction into remote Postgres.
- `neon_pipeline/categorize.py`: remote categorization helper.
- `neon_pipeline/analyze.py`: reporting and plotting layer for the Neon experiment.
- `neon_pipeline/requirements.txt`: dependencies for the Neon experiment.

## Cleanup and artifact-management utilities

- `cleanup_processed_zips.py`: safe ZIP cleanup with dry-run preview and deletion log support.
- `cleanup_dashboard_runtime_artifacts.py`: removes raw runtime artifacts that are no longer needed once databases exist.
- `dashboard_runtime_cleanup_20260424T075547Z.json`: cleanup preview / report artifact.
- `dashboard_runtime_cleanup_20260424T075559Z.json`: runtime cleanup execution log.
- `dashboard_nonruntime_cleanup_20260424T173852Z.json`: non-runtime cleanup execution log.

## Tests

- `tests/test_export_filters.py`: verifies allowlisted export filter parsing and table restrictions.
- `tests/test_security.py`: verifies DSN redaction behavior.

## Retained runtime data

- `workspace_data/databases/irs990_2023_2024.db`: retained SQLite analytical dataset used by the dashboard.
- `workspace_data/databases/irs990_pipeline.db`: retained SQLite manifest/cache database.
- `workspace_data/databases/irs990_2023_2024.db-shm`: transient SQLite shared-memory sidecar, recreated automatically as needed.
- `workspace_data/databases/irs990_2023_2024.db-wal`: transient SQLite write-ahead-log sidecar, recreated automatically as needed.
- `workspace_data/databases/irs990_pipeline.db-shm`: transient SQLite shared-memory sidecar, recreated automatically as needed.
- `workspace_data/databases/irs990_pipeline.db-wal`: transient SQLite write-ahead-log sidecar, recreated automatically as needed.

## Tooling-specific local files

- `.claude/settings.json`: local tool configuration, not business logic.
- `.claude/settings.local.json`: machine-local tool configuration, not business logic.

## Documentation folder created for archival handoff

- `project_full_documentation/README.md`: high-level project summary.
- `project_full_documentation/PROJECT_HISTORY.md`: reconstructed history and rationale.
- `project_full_documentation/ARCHITECTURE.md`: architecture and component relationships.
- `project_full_documentation/SETUP_AND_RUN.md`: setup and run instructions.
- `project_full_documentation/DATA_FLOW.md`: pipeline and integration flow map.
- `project_full_documentation/FILE_INDEX.md`: this file.
- `project_full_documentation/KNOWN_ISSUES_AND_LIMITATIONS.md`: current known gaps.
- `project_full_documentation/FUTURE_IMPROVEMENTS.md`: suggested next iterations.
- `project_full_documentation/AI_CONTEXT.md`: AI handoff context.
