# Setup and Run

## Important Current-State Warning

This repository is not a full raw-data bundle anymore.

On April 24, 2026, the raw IRS ZIP folders, generated exports, and logs were deleted to save disk space. Only the core code and the retained SQLite databases were kept.

Practical effect:

- the dashboard can still run from local SQLite,
- direct full re-extraction from the original ZIP inventory cannot run until the ZIP files are downloaded again,
- historical CSV and Excel deliverables are no longer present.

## Prerequisites

Recommended local environment:

- Windows machine, based on current repository usage
- Python 3.12 preferred
- Git installed
- Git LFS installed if the database files are going to be published to GitHub

Optional infrastructure depending on workflow:

- PostgreSQL for `irs_db/` and `irs_pipeline/`
- Anthropic API key for AI categorization
- Neon Postgres only if reviving `neon_pipeline/`

## Environment Variables

Copy `.env.example` to `.env` and fill in values as needed.

Main variables:

- `IRS_DB_DSN`: PostgreSQL warehouse connection string
- `DATABASE_URL`: fallback DSN source in some modules
- `ANTHROPIC_API_KEY`: required only for AI categorization phases
- `FORM990_DASHBOARD_DB`: optional override for dashboard SQLite source
- `NEON_DSN`: only for `neon_pipeline/`

Example:

```env
IRS_DB_DSN=postgresql://postgres:change_me@127.0.0.1:5432/irs990
ANTHROPIC_API_KEY=your_api_key_here
FORM990_DASHBOARD_DB=C:\path\to\warehouse.db
NEON_DSN=postgresql://user:change_me@host/neondb?sslmode=require
```

## Dependencies

### Dashboard

```powershell
.\.venv312\Scripts\python.exe -m pip install -r requirements_dashboard.txt
```

### PostgreSQL warehouse tools

```powershell
.\.venv312\Scripts\python.exe -m pip install -r requirements_db.txt
.\.venv312\Scripts\python.exe -m pip install -r requirements_pipeline.txt
```

### Standalone SQLite pipeline

```powershell
.\.venv312\Scripts\python.exe -m pip install -r standalone_pipeline\requirements.txt
```

### Neon experiment

```powershell
.\.venv312\Scripts\python.exe -m pip install -r neon_pipeline\requirements.txt
```

## Running the Dashboard

This is the most reliable current runtime path.

Command:

```powershell
.\.venv312\Scripts\python.exe -m streamlit run dashboard_app.py
```

Default source discovery:

- `workspace_data/databases/irs990_2023_2024.db`
- `workspace_data/databases/irs990_pipeline.db`

Override source if needed:

- set `FORM990_DASHBOARD_DB` in `.env`

Current expectation:

- the first database contains the actual grant rows powering the dashboard,
- the second database mainly contains manifest bookkeeping at the moment.

## Running the Local Bulk Pipeline

Main script:

```powershell
.\.venv312\Scripts\python.exe master_pipeline.py
```

This path currently requires restoring ZIP input folders first.

Expected input directories in the current path model:

- `workspace_data/Form 990`
- `workspace_data/OneDrive_2026-03-29/new data`

These folders do not currently exist because they were removed during disk cleanup.

## Running the PostgreSQL Warehouse Pipeline

### Phase 1: audit and download

```powershell
.\.venv312\Scripts\python.exe -m irs_pipeline.run_pipeline --phase 1
```

### Phase 2: extract into PostgreSQL

```powershell
.\.venv312\Scripts\python.exe -m irs_pipeline.run_pipeline --phase 2
```

### Phase 3: AI categorization

Dry run:

```powershell
.\.venv312\Scripts\python.exe -m irs_pipeline.run_pipeline --phase 3 --dry-run
```

Real run:

```powershell
.\.venv312\Scripts\python.exe -m irs_pipeline.run_pipeline --phase 3
```

Notes:

- requires a working PostgreSQL database and valid `IRS_DB_DSN`,
- uses `workspace_data/pipeline_data/irs_pipeline` when raw pipeline artifacts are present,
- current local snapshot no longer has the raw pipeline artifacts from prior runs.

## Running the Standalone SQLite Pipeline

The standalone scripts use local-style imports such as `import config` rather than package-relative imports. For that reason, the safest way to run them is from inside the `standalone_pipeline` directory.

Example:

```powershell
cd standalone_pipeline
..\.venv312\Scripts\python.exe run_pipeline.py --phase 1
```

Other examples:

```powershell
cd standalone_pipeline
..\.venv312\Scripts\python.exe extract_2023_2024.py --stats
..\.venv312\Scripts\python.exe ai_categorizer.py --dry-run
```

## Exporting from PostgreSQL

Create reporting views:

```powershell
.\.venv312\Scripts\python.exe -m irs_db.exporter --powerbi-views
```

Export filtered CSV safely:

```powershell
.\.venv312\Scripts\python.exe -m irs_db.exporter --csv --filter "tax_year=2023 AND expense_type='Jews'"
```

## Tests and Validation

Run unit tests:

```powershell
.\.venv312\Scripts\python.exe -m unittest discover -s tests
```

Syntax check selected modules:

```powershell
.\.venv312\Scripts\python.exe -m py_compile dashboard_app.py
.\.venv312\Scripts\python.exe -m py_compile irs_db\exporter.py
.\.venv312\Scripts\python.exe -m py_compile irs_pipeline\extractor.py
.\.venv312\Scripts\python.exe -m py_compile irs_pipeline\ai_categorizer.py
```

## Moving the Project to Another Machine

To preserve the current dashboard runtime, copy at minimum:

- all source code files,
- `.env.example`,
- `.streamlit/config.toml`,
- `workspace_data/databases/irs990_2023_2024.db`,
- `workspace_data/databases/irs990_pipeline.db`,
- `project_full_documentation/`.

If the destination is GitHub, the database files should be stored with Git LFS or another large-file storage method.
