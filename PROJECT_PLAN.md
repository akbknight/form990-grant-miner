# Project Plan — IRS Form 990 Grant Extraction Pipeline

## Objective

Build a production-grade Python pipeline to extract, classify, store, and export grant records from IRS Form 990 Schedule I filings (2019–2024). The pipeline processes the full IRS bulk XML dataset (~600 GB), producing structured grant records for downstream analysis: a Streamlit dashboard, Excel reporting workbooks, and a static JSON payload for the `irs990-grant-dashboard` GitHub Pages site.

---

## Scope

### In Scope
- Bulk XML download from IRS S3 public dataset
- Schedule I extraction with dual-schema handling (pre-2014 and current schema)
- Jewish philanthropic classification via curated keyword list
- AI-assisted subject categorization for records with informative purpose text
- SQLite local storage with Neon (PostgreSQL) production migration
- Excel export (multiple workbook formats for different stakeholders)
- Streamlit dashboard for local exploration

### Out of Scope
- 990-PF (private foundation return) parsing
- Pre-2019 historical data (pipeline focused on 2019–2024)
- Real-time or near-real-time data feeds

---

## Pipeline Architecture

```
Download → Extract → Classify → Store → Aggregate → Export
```

Each stage is implemented as a separate Python module under `irs_pipeline/`. A `standalone_pipeline/` directory contains a self-contained version for isolated runs.

---

## Key Files

| File | Purpose |
|------|---------|
| `irs_pipeline/run_pipeline.py` | Main pipeline orchestrator |
| `irs_pipeline/audit_downloader.py` | IRS S3 bulk download with resumption |
| `irs_pipeline/extractor.py` | Schedule I XML parser, dual-schema |
| `irs_pipeline/ai_categorizer.py` | AI subject classification |
| `irs_pipeline/db_sqlite.py` | SQLite persistence layer |
| `categorize_grants.py` | Jewish classification pass |
| `master_pipeline.py` | End-to-end pipeline runner |
| `sqlite_to_postgres.py` | Neon migration |
| `build_final_summary.py` | Aggregation tables |
| `export_to_excel.py` | Excel output |
| `dashboard_app.py` | Streamlit dashboard |

---

## Execution Phases

### Phase 1 — Extraction (Complete)
- [x] IRS S3 downloader with ZIP resumption
- [x] ElementTree XML parser with dual-schema handling
- [x] SQLite persistence, batch inserts
- [x] 9.7M records extracted, $550B in grants

### Phase 2 — Classification (Complete)
- [x] Jewish keyword classification (94% precision)
- [x] NTEE subject classification via IRS BMF cross-reference
- [x] AI-assisted categorization for informative purpose text
- [x] Master Jewish grant table

### Phase 3 — Export and Reporting (Complete)
- [x] Neon (PostgreSQL) migration
- [x] Excel workbook exports
- [x] Streamlit dashboard
- [x] JSON payload for static IRS990 dashboard

### Phase 4 — Documentation (Complete)
- [x] docs/methodology.md — IRS data source, Schedule I schema, classification methodology
- [x] docs/architecture.md — pipeline stages, storage backends, data flow
- [x] docs/decision_log.md — 5 key decisions with rationale
- [x] docs/data_dictionary.md — schema, XML variants, keyword list reference

---

## Success Criteria

- [x] Full 2019–2024 corpus processed
- [x] Dual-schema handling covers all filing variants
- [x] Jewish classification precision ≥ 90%
- [x] Pipeline resumable from any interrupted stage
- [x] No AI-generated residue in codebase
