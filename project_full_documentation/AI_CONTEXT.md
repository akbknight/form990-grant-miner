# AI Context

This file is written specifically for future AI systems that may continue work on this repository.

## What This Project Is

This repository is a multi-generation Python project for extracting, classifying, storing, exporting, and visualizing grant records from IRS Form 990 bulk XML data.

It is not a single clean application. It is a layered codebase containing:

- legacy direct extraction scripts,
- a standalone SQLite pipeline,
- a PostgreSQL warehouse pipeline,
- an experimental Neon pipeline,
- a read-only Streamlit dashboard.

## What Has Been Completed

The following major work is already in place:

- environment-based configuration replaced hardcoded database credentials,
- DSN redaction helper exists in `project_utils/security.py`,
- export filter hardening exists in `project_utils/export_filters.py`,
- runtime artifact paths are centralized in `project_utils/paths.py`,
- a Streamlit dashboard exists in `dashboard_app.py` and `dashboard/`,
- targeted tests exist for DSN redaction and filter parsing,
- cleanup utilities exist for ZIP and non-runtime artifact cleanup,
- the retained dashboard datasets are stored in SQLite under `workspace_data/databases`.

## Current State of the Repository

Treat the repository as a cleaned runtime snapshot, not a full rebuild snapshot.

Current retained databases and counts at documentation time:

- `workspace_data/databases/irs990_2023_2024.db`
  - table `irs_grants_2023_2024`
  - `3,784,396` rows
- `workspace_data/databases/irs990_pipeline.db`
  - table `irs_manifest`: `4,244,922` rows
  - table `irs_grants`: `0` rows
  - table `ai_cache`: `0` rows

Raw source directories and generated exports were deleted on April 24, 2026 to free disk space.

Deleted categories included:

- raw ZIP sources,
- old logs,
- pipeline temp folders,
- export folders,
- boss deliverable folders.

The cleanup reports that document this are:

- `dashboard_runtime_cleanup_20260424T075559Z.json`
- `dashboard_nonruntime_cleanup_20260424T173852Z.json`

## Assumptions Used to Build This Documentation

These docs were reconstructed from:

- current source code,
- file names,
- code comments and usage strings,
- retained cleanup logs,
- current database contents.

These docs were not reconstructed from a clean git history. The local git worktree is noisy and should not be treated as a trustworthy history source.

## What You Should Treat as the Current Canonical Code

If you need to continue engineering work, prioritize these areas first:

1. `project_utils/`
2. `dashboard/` and `dashboard_app.py`
3. `irs_db/`
4. `irs_pipeline/`

Treat these as legacy or workflow-specific rather than canonical:

- most root scripts,
- `standalone_pipeline/`,
- `neon_pipeline/`.

They are still important, but they contain more duplicated logic and more operational assumptions.

## What You Should Not Misunderstand

- A ZIP bundle year is not the same thing as the parsed `tax_year` column.
- The presence of `irs990_pipeline.db` does not mean extracted grants are available there now.
- The current dashboard is powered primarily by `irs990_2023_2024.db`.
- The repository is not currently self-sufficient for raw-data reprocessing because the source ZIPs were removed.
- `workspace_data/databases/*.db-shm` and `*.db-wal` are runtime sidecars, not canonical databases.
- The current local git index is polluted with unrelated historical staging noise and should not be used as a clean publish boundary.

## If You Need to Continue Development

Recommended first steps:

1. read `project_full_documentation/ARCHITECTURE.md`,
2. inspect `project_utils/paths.py` to understand current path conventions,
3. inspect `dashboard/data_access.py` to understand the active runtime dataset shape,
4. inspect `irs_db/schema.sql` and `irs_db/parser.py` if working on warehouse ingestion,
5. decide whether the task belongs to the current dashboard/runtime path or to a legacy extraction path.

## If You Need to Restore Full Rebuild Capability

You will need to:

- re-download the IRS ZIP archives,
- recreate the expected `workspace_data` source folders,
- decide which pipeline path is canonical going forward,
- regenerate exports if business users still require spreadsheet deliverables.

## If You Need to Publish or Back Up This Project

The retained databases are too large for a normal GitHub push. Use one of these approaches:

- Git LFS,
- external object storage with documented retrieval links,
- a release archive strategy that keeps code and databases separate.

If creating a clean publication snapshot, do not publish from the current dirty git index. Instead, build a fresh snapshot directory from the working tree and explicitly control which files are included.

## If You Need to Harden Security Further

Do not undo the existing safety improvements.

Preserve these constraints:

- no hardcoded secrets,
- no raw SQL filter interpolation,
- dashboard SQLite access should remain read-only,
- `.env` and secrets files should stay out of Git,
- path discovery should continue to flow through `project_utils/paths.py`.

## Best Continuation Strategy

The most defensible next architectural move is to consolidate parser and classification logic into shared modules, then make the legacy scripts call those shared modules instead of maintaining divergent copies.
