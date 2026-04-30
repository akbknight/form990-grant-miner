# Grant Atlas 990

IRS Form 990 grant extraction, warehousing, and analytics for large nonprofit filing datasets.

This repository now has three clean layers:

1. `master_pipeline.py` for local bulk extraction from ZIP archives into CSV and Excel deliverables.
2. `irs_db/` and `irs_pipeline/` for database-backed ingestion, extraction, and optional AI categorization.
3. `dashboard_app.py` for a read-only Streamlit dashboard on top of the extracted warehouse.

Large runtime artifacts are now consolidated under `workspace_data/` so the repository root stays usable and storage cleanup happens in one place.

## What changed

- Embedded database credentials were removed from the repository.
- Export filters are now parsed through an allowlist instead of raw SQL string interpolation.
- The dashboard reads SQLite in read-only mode and only exposes parameterized filters.
- The standalone ZIP downloader no longer shares a SQLite connection across worker threads.
- Safer operational defaults were added for `.env`, `.gitignore`, and the SQLite-to-Postgres transfer tool.

## Quick start

### 1. Configure secrets locally

Copy `.env.example` to `.env` and set the values you actually use.

Required for PostgreSQL-backed flows:

```bash
IRS_DB_DSN=postgresql://postgres:change_me@127.0.0.1:5432/irs990
```

Optional:

```bash
ANTHROPIC_API_KEY=your_api_key_here
NEON_DSN=postgresql://user:change_me@your-neon-host/neondb?sslmode=require
FORM990_DASHBOARD_DB=C:\path\to\warehouse.db
```

### 2. Install dependencies

Local extraction:

```bash
pip install pandas openpyxl
```

Database pipeline:

```bash
pip install -r requirements_db.txt
pip install -r requirements_pipeline.txt
```

Dashboard:

```bash
pip install -r requirements_dashboard.txt
```

### 3. Run the dashboard

```bash
streamlit run dashboard_app.py
```

By default the dashboard looks for:

- `workspace_data/databases/irs990_2023_2024.db`
- `workspace_data/databases/irs990_pipeline.db`

If you want a different SQLite file, set `FORM990_DASHBOARD_DB` in `.env`.

## Main entry points

### Local bulk pipeline

```bash
.venv312\Scripts\python.exe master_pipeline.py
```

Outputs:

- `workspace_data/exports/form990_master_output.csv`
- `workspace_data/exports/Jewish_Grants_Master.xlsx`
- `workspace_data/exports/AI_Extracted_Data_Current_Status.xlsx`
- split `workspace_data/exports/AI_Extracted_Data_Full_Part*.xlsx` files

### Database-backed pipeline

Audit and download:

```bash
.venv312\Scripts\python.exe -m irs_pipeline.run_pipeline --phase 1
```

Extract into PostgreSQL:

```bash
.venv312\Scripts\python.exe -m irs_pipeline.run_pipeline --phase 2
```

Optional AI categorization:

```bash
.venv312\Scripts\python.exe -m irs_pipeline.run_pipeline --phase 3 --dry-run
```

### Export

Safe filtered CSV:

```bash
.venv312\Scripts\python.exe -m irs_db.exporter --csv --filter "tax_year=2023 AND expense_type='Jews'"
```

Supported filter fields:

- `tax_year`
- `grant_amount`
- `expense_type`
- `grantmaker_state`
- `grantmaker_name`
- `recipient_name`
- `primary_subject`
- `geography`

Supported operators:

- `=`
- `>=`
- `<=`
- `~` for contains search

Examples:

```bash
.venv312\Scripts\python.exe -m irs_db.exporter --csv --filter "grantmaker_name~foundation"
.venv312\Scripts\python.exe -m irs_db.exporter --csv --filter "grant_amount>=100000"
```

## Project layout

```text
dashboard_app.py              Streamlit UI
dashboard/                    Dashboard data access and presentation helpers
irs_db/                       PostgreSQL schema, loader, exporter, downloader
irs_pipeline/                 Audit/download, extract, AI categorize orchestration
standalone_pipeline/          Local SQLite pipeline variant
master_pipeline.py            CSV and Excel bulk pipeline
sqlite_to_postgres.py         Safer SQLite -> PostgreSQL transfer utility
workspace_data/               Consolidated ZIPs, databases, exports, and logs
```

## Security notes

- Never commit `.env` or `.streamlit/secrets.toml`.
- Use `.env.example` as the template, not as a live credential store.
- The export CLI no longer accepts arbitrary SQL fragments.
- The dashboard is intentionally read-only and does not expose path-based file browsing.

## Verification

Run lightweight tests:

```bash
python -m unittest discover -s tests
```

Syntax check the dashboard and pipeline modules:

```bash
python -m py_compile dashboard_app.py
python -m py_compile irs_pipeline\ai_categorizer.py
python -m py_compile irs_pipeline\extractor.py
python -m py_compile irs_db\exporter.py
```
