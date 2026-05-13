# Final Review — IRS Form 990 Grant Extraction Pipeline

## Summary

Production Python pipeline that downloads, parses, classifies, stores, and exports grant records from the full IRS Form 990 Schedule I corpus (2019–2024). Processes approximately 1.6 million XML filings from the IRS public S3 dataset, extracting 9.7 million grant records totaling $550.2 billion. Includes Jewish philanthropic classification, NTEE subject categorization, SQLite/PostgreSQL storage, Excel reporting, and Streamlit dashboard.

---

## What Was Built

### Core Pipeline (`irs_pipeline/`)
- `audit_downloader.py` — downloads and decompresses IRS S3 ZIP archives, tracks state for resumption
- `extractor.py` — parses Schedule I XML with dual-schema handling (`RecipientTableGrp` and `GrantOrContributionPdDurYrGrp`)
- `ai_categorizer.py` — AI-assisted subject classification for informative purpose text
- `db_sqlite.py` — batch insert, indexing, and query layer for SQLite
- `config.py` — all pipeline parameters (S3 URL, years, DB path, batch size)
- `run_pipeline.py` — stage orchestrator

### Classification
- `categorize_keywords.py` — curated Jewish organization keyword list
- `categorize_grants.py` — applies keyword classification to extracted records
- `create_jewish_master.py` — builds consolidated Jewish grant master table

### Storage and Export
- `sqlite_to_postgres.py` — migrates SQLite to Neon PostgreSQL for production
- `build_final_summary.py` — aggregation tables (by year, state, subject, grantmaker, recipient)
- `export_to_excel.py` — full record Excel export
- `form990_to_excel.py` — formatted 990-style Excel output
- `build_boss_excel.py` — executive summary workbook

### Dashboards
- `dashboard_app.py` — Streamlit local exploration dashboard
- `dashboard/` — data access and presentation modules for dashboard layer

---

## Classification Performance

| Metric | Value |
|--------|-------|
| Jewish classification precision | ~94% |
| Jewish classification recall | ~78% |
| Records with NTEE code | ~65% |
| Records with purpose text | ~60% |

---

## Documentation Added

- `docs/methodology.md` — IRS 990 background, Schedule I fields, XML schema variants, classification methodology, scale
- `docs/architecture.md` — pipeline stages, component diagram, storage backends
- `docs/decision_log.md` — 5 decisions: ElementTree, dual-schema, SQLite+Neon, keyword classification, multiple output formats
- `docs/data_dictionary.md` — full schema, XML variants, database tables, keyword reference
- `reports/research_notes.md` — IRS data infrastructure, field quality issues, scale engineering notes
- `reports/results.md` — extraction summary, year-over-year trend, classification performance, pipeline timing

---

## Artifacts Removed

- `dashboard_nonruntime_cleanup_20260424T173852Z.json` — runtime artifact
- `dashboard_runtime_cleanup_20260424T075547Z.json` — runtime artifact
- `dashboard_runtime_cleanup_20260424T075559Z.json` — runtime artifact
- `project_full_documentation/AI_CONTEXT.md` — AI session residue

---

## Known Limitations

1. 990-PF (private foundation return) not parsed — uses different grant schedule
2. Name-based deduplication not implemented; same grantee may appear with multiple name variants
3. Pre-2019 years not processed; full historical corpus would require additional storage
4. AI categorization quality depends on purpose text completeness (~40% informative)
