# Project Documentation: Grant Atlas 990

This folder is the self-contained documentation set for the Form 990 grant extraction and dashboard project in this repository.

## Project Overview

Grant Atlas 990 is a Python-based data engineering and analytics project for working with IRS Form 990 bulk XML data. Its main purpose is to extract grant records from IRS filings, classify those grants into a small business taxonomy, store the results in queryable databases, and expose the results through exports and a local dashboard.

The repository contains several generations of the same idea:

1. direct ZIP-to-CSV and ZIP-to-Excel scripts,
2. a more structured SQLite-based local pipeline,
3. a PostgreSQL-backed warehouse pipeline,
4. a read-only Streamlit dashboard for interactive analysis.

## Purpose and Goals

The practical goals of the project are:

- turn very large IRS bulk filing archives into usable grant-level records,
- classify grants into `Jews`, `Non jews`, or `Miscellaneous` / `Uncategorized`,
- support both offline local workflows and database-backed workflows,
- provide exportable datasets for spreadsheet consumers,
- provide a dashboard for fast exploration of the extracted data.

## Key Features

- XML extraction from IRS Form 990 bulk archives.
- Heuristic classification based on recipient names and grant descriptions.
- Optional AI-assisted categorization through Anthropic for ambiguous records.
- PostgreSQL warehouse schema for filings and grants.
- SQLite caches for manifests, AI deduplication, and dashboard-friendly datasets.
- Safe export utilities with allowlisted filters instead of raw SQL interpolation.
- Read-only Streamlit dashboard with KPI cards, trends, category mix, geography, and record explorer.
- Cleanup utilities to remove raw artifacts after the retained databases are built.

## Current Outcomes and State

This repository is no longer a full raw-data archive. On April 24, 2026, the raw ZIP sources, generated exports, and runtime logs were intentionally removed to free disk space. What remains is the codebase plus the retained SQLite databases under `workspace_data/databases`.

Current retained databases:

- `workspace_data/databases/irs990_2023_2024.db`
  - table `irs_grants_2023_2024`
  - `3,784,396` rows at documentation time
- `workspace_data/databases/irs990_pipeline.db`
  - table `irs_manifest`
  - `4,244,922` manifest rows at documentation time
  - `irs_grants` currently contains `0` rows

This means the dashboard is still usable, but full raw reprocessing is not possible until the IRS ZIP source files are downloaded again.

## Tech Stack

Core technologies used in the repository:

- Python 3.x, with the current local environment centered on Python 3.12
- SQLite for local manifests, caches, and dashboard datasets
- PostgreSQL for the warehouse-oriented pipeline
- Pandas for tabular transformations
- OpenPyXL for styled Excel output
- Requests and Tenacity for HTTP retrieval and retries
- Streamlit and Plotly for the dashboard
- Anthropic API for optional AI categorization
- Git and Git LFS for source control and large artifact publishing

## Documentation Map

- `project_full_documentation/README.md`: high-level summary
- `project_full_documentation/PROJECT_HISTORY.md`: reconstructed build history
- `project_full_documentation/ARCHITECTURE.md`: system design and component relationships
- `project_full_documentation/SETUP_AND_RUN.md`: setup and runbook
- `project_full_documentation/DATA_FLOW.md`: end-to-end data movement
- `project_full_documentation/FILE_INDEX.md`: file-by-file guide
- `project_full_documentation/KNOWN_ISSUES_AND_LIMITATIONS.md`: current gaps and constraints
- `project_full_documentation/FUTURE_IMPROVEMENTS.md`: recommended next improvements
- `project_full_documentation/AI_CONTEXT.md`: handoff notes for future AI systems
