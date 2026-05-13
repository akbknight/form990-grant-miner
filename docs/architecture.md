# Architecture — IRS Form 990 Grant Extraction Pipeline

## System Overview

A multi-stage Python pipeline for extracting, classifying, storing, and visualizing grant records from IRS Form 990 bulk XML data. The pipeline processes 2019–2024 filings from the IRS public S3 dataset and produces structured grant records for downstream analysis and dashboard visualization.

```
IRS S3 Bulk Data (XML ZIPs)
        │
        ▼
irs_pipeline/
  ├── audit_downloader.py   ← Downloads ZIP archives from IRS S3
  ├── extractor.py          ← Parses Schedule I from XML, handles schema variants
  ├── ai_categorizer.py     ← AI-assisted grant subject classification
  ├── db_sqlite.py          ← SQLite persistence layer
  └── run_pipeline.py       ← Pipeline orchestrator
        │
        ▼
SQLite DB (irs_db/)
        │
        ├── sqlite_to_postgres.py   ← Exports to Neon (PostgreSQL) for production
        │
        ▼
Neon PostgreSQL
        │
        ├── categorize_grants.py       ← Jewish classification pass
        ├── create_jewish_master.py    ← Master Jewish grant table
        ├── build_final_summary.py     ← Aggregated summary tables
        │
        ▼
Export Layer
  ├── export_to_excel.py     ← Excel outputs for analysis
  ├── form990_to_excel.py    ← Full record Excel export
  └── build_boss_excel.py    ← Executive-level summary workbook
        │
        ▼
Dashboard
  ├── dashboard_app.py       ← Streamlit dashboard (local)
  └── dashboard/             ← Dashboard data access and presentation modules
```

---

## Pipeline Stages

### Stage 1: Acquisition (`irs_pipeline/audit_downloader.py`)
Downloads ZIP archives from the IRS public S3 endpoint for each tax year. Tracks download state in SQLite to enable resumption. Decompresses ZIPs and indexes individual XML filings.

### Stage 2: Extraction (`irs_pipeline/extractor.py`)
Parses each XML filing with Python `ElementTree`. Handles two Schedule I schema variants:
- `GrantOrContributionPdDurYrGrp` (pre-2014 schema)
- `RecipientTableGrp` (current schema)

Extracted fields: grantee name, EIN, city, state, cash grant amount, purpose text, parent organization EIN, tax year.

### Stage 3: Classification (`categorize_grants.py`, `ai_categorizer.py`)
Two-pass classification:
1. **Keyword classification**: Jewish philanthropic identification via curated name matching (`categorize_keywords.py`)
2. **AI-assisted categorization**: Subject and purpose classification using the AI categorizer for records where purpose text is informative

### Stage 4: Aggregation
`build_final_summary.py` generates aggregated tables: totals by year, by state, by subject, by grantmaker, by recipient. These aggregates power the dashboard and Excel reports.

### Stage 5: Export
Multiple export targets: SQLite for local analysis, Neon PostgreSQL for production queries, Excel workbooks for stakeholder distribution, and pre-computed JSON for the `irs990-grant-dashboard` static dashboard.

---

## Standalone Pipeline

`standalone_pipeline/` contains a self-contained version of the pipeline that runs without external database dependencies. Used for one-off reprocessing runs and testing on isolated subsets of data.

---

## Storage Backends

| Backend | Location | Purpose |
|---------|----------|---------|
| SQLite | `irs_db/` | Local extraction and intermediate storage |
| Neon (PostgreSQL) | Remote | Production queries, classification passes |
| Excel | Output files | Stakeholder distribution |
| JSON | Embedded in dashboard | Static dashboard data payload |
