# IRS Form 990 Grant Intelligence Platform & Bulk ETL Pipeline

[![IRS 990 Mining Engine](https://img.shields.io/badge/IRS%20990-XML%20Bulk%20Extraction-blue.svg)](https://github.com/akbknight/form990-grant-miner)
[![GitHub Pages](https://img.shields.io/badge/Live%20Platform-GitHub%20Pages-success.svg)](https://akbknight.github.io/form990-grant-miner/)
[![Coverage](https://img.shields.io/badge/Filings%20Indexed-9.7M%2B%20Filings-emerald.svg)](https://akbknight.github.io/form990-grant-miner/#/pipeline)
[![Taxonomy](https://img.shields.io/badge/Taxonomy-12%20Philanthropic%20Sectors-indigo.svg)](https://akbknight.github.io/form990-grant-miner/#/sectors)
[![Zero API Extraction](https://img.shields.io/badge/Core%20ETL-Zero%20API%20Cost-gray.svg)](https://github.com/akbknight/form990-grant-miner)

An end-to-end Python data pipeline and philanthropic intelligence platform for extracting, warehousing, and analyzing grant disbursements from IRS Form 990 electronic XML filings (2019–2024). Standardizes multi-year institutional grant distribution, recipient taxonomies, and charitable capital flows across the United States.

The platform operates across two synchronized pillars:
1. **High-Throughput Streaming ETL Engine**: Streams bulk IRS S3 electronic filing ZIP archives directly in memory without disk thrash, parsing Schedule I / Part IX grant records across legacy and modern XML schemas into SQLite, DuckDB, and PostgreSQL.
2. **Grant Atlas Analytics Platform (`docs/`)**: An interactive Single Page Application deployed to GitHub Pages, featuring multi-view exploration across 12 sectors (Higher Education, Health, Public Policy, Environment, Community Welfare), funder–recipient relationship cohorts, DAF pass-through flow tracing, and a priority Decision Center for grant classification governance.

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PILLAR 1: DATA PIPELINE & WAREHOUSE                  │
│                                                                        │
│  IRS S3 XML Archives ──► Streaming In-Memory Parser ──► SQLite/Neon PG │
│  (9.7M+ Filings)          (Schedule I / Part IX)       (Columnar Store)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Normalized Schemas & Provenance
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               PILLAR 2: GRANT ATLAS & ANALYTICS PLATFORM               │
│                                                                        │
│  Multi-View SPA Router ──► 12-Sector Explorer ──► Relationship Cohorts │
│  Decision Center (F12) ──► DAF Flow Tracer    ──► Anti-Double-Counting │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features & Meeting Addendum Capabilities (F01–F15)

- **12 Approved Philanthropic Sectors (F01 & F10):** Exhaustive thematic mapping spanning Higher Education, Biomedical Health, Humanitarian Relief, Civic Rights, Jewish Community & Continuity, Environment, and Public Policy with longitudinal trajectories.
- **EIN Identity Resolution (F02):** Strict 9-digit EIN normalization. Unmatched organization records remain distinct and visible—never merged purely on string similarity.
- **Commitments vs. Paid Grants Separation (F04):** Unpaid future multi-year grant commitments are strictly tracked separately from current-year cash grant disbursements (`CashGrantAmt`). Unknown commitment values are logged as "Not Reported", never defaulted to zero.
- **Longitudinal Relationship Ledgers (F05 & F11):** Year-wise pairwise funding histories with full Schedule I purpose text, itemized grant listings, and context-preserving recipient profile drawers.
- **Retention Cohort Analysis (F06):** Tracks institutional funding continuity across periods into `New` (first-time grantees), `Retained` (continuous support), and `Not Observed` (not seen in cycle; flagged without asserting cessation).
- **DAF & Intermediary Flow Tracing (F08):** Directional tracking of Donor-Advised Funds (Vanguard Charitable, Fidelity Charitable, Jewish Communal Fund) with mandatory **Anti-Double-Counting Invariants** preventing pass-through inflation.
- **Scope Switcher (F09 & F13):** Dynamic toggle between aggregate US charitable distributions and focused communal giving scopes.
- **Decision Center for Mixed / Unresolved Grants (F12):** Priority governance console for reviewing ambiguous classifications, enforcing required reviewer identity, justification reasons, and reversible audit logs.
- **Interactive DataOps Architecture (F14):** Inline vector SVG architecture diagram with worker benchmarks and database partition specifications.

---

## Live Web Application

The interactive web analytics platform is hosted statically via GitHub Pages from `docs/`:

- **Live URL:** [https://akbknight.github.io/form990-grant-miner/](https://akbknight.github.io/form990-grant-miner/)
- **Routes:**
  - `#/dashboard` — Executive Telemetry, KPI Summary Cards, Longitudinal Trends, Sortable Funder & Recipient Tables.
  - `#/sectors` — 12-Sector Thematic Explorer, Trajectories, Top Grantmakers & Grantees.
  - `#/relationships` — Funder ↔ Grantee Ledgers, Retention Cohorts, DAF Flow Tracing, and Recipient Profile Drawer.
  - `#/decisions` — Priority Decision Center for Unresolved & Mixed Classifications.
  - `#/pipeline` — 3-Tier Streaming Architecture Diagram, Worker Benchmarks, Database Partition Specs.
- **Themes:** Supports OLED Obsidian Dark Mode (`#0f1117`) and Apple-Grade Light Mode (`#f8fafc`) with persistent state.

---

## Quick Start: Python Pipeline & Local Warehouse

### 1. Configure Secrets Locally

Copy `.env.example` to `.env` and configure the database connection you wish to use:

```bash
# Required for PostgreSQL-backed flows:
IRS_DB_DSN=postgresql://postgres:change_me@127.0.0.1:5432/irs990

# Optional:
ANTHROPIC_API_KEY=your_api_key_here
NEON_DSN=postgresql://user:change_me@your-neon-host/neondb?sslmode=require
FORM990_DASHBOARD_DB=workspace_data/databases/irs990_pipeline.db
```

### 2. Install Dependencies

Local extraction & bulk Excel generation:
```bash
pip install pandas openpyxl
```

Database warehouse pipeline:
```bash
pip install -r requirements_db.txt
pip install -r requirements_pipeline.txt
```

Streamlit dashboard:
```bash
pip install -r requirements_dashboard.txt
```

### 3. Run the Local Streamlit Dashboard

```bash
streamlit run dashboard_app.py
```

---

## Main Entry Points & CLI Operations

### Local Bulk Extraction Pipeline
Processes raw TEOS XML ZIP archives directly into clean CSV and Excel deliverables:

```bash
python master_pipeline.py
```

Generated deliverables in `workspace_data/exports/`:
- `form990_master_output.csv` — Full extracted grant matrix.
- `Jewish_Grants_Master.xlsx` — Partitioned communal scope dataset.
- `AI_Extracted_Data_Current_Status.xlsx` — Classified metadata.
- `AI_Extracted_Data_Full_Part*.xlsx` — Chunked workbooks (900,000 rows each).

### Database-Backed Ingestion Pipeline
Phase 1: Audit and download missing IRS XML archives:
```bash
python -m irs_pipeline.run_pipeline --phase 1
```

Phase 2: Extract Schedule I grants into PostgreSQL / SQLite:
```bash
python -m irs_pipeline.run_pipeline --phase 2
```

Phase 3: Optional AI-assisted categorization pass:
```bash
python -m irs_pipeline.run_pipeline --phase 3 --dry-run
```

### Safe Parameterized Exporter
Export filtered subsets without raw SQL string interpolation:

```bash
python -m irs_db.exporter --csv --filter "tax_year=2023 AND expense_type='Jews'"
python -m irs_db.exporter --csv --filter "grantmaker_name~foundation"
python -m irs_db.exporter --csv --filter "grant_amount>=100000"
```

---

## Project Structure

```text
├── dashboard_app.py              # Streamlit local warehouse UI
├── dashboard/                    # Data access and presentation helpers
├── irs_db/                       # PostgreSQL schema, loader, exporter, downloader
├── irs_pipeline/                 # S3 audit/downloader, extractor, AI categorizer
├── scripts/                      # Dedicated data preparation, export, and migration utilities
├── standalone_pipeline/          # Self-contained SQLite pipeline
├── master_pipeline.py            # High-speed in-memory ZIP bulk extractor
├── sqlite_to_postgres.py         # Transactional SQLite to PostgreSQL transfer utility
├── workspace_data/               # Consolidated runtime data (ZIPs, DBs, exports, logs)
│
└── docs/                         # Live GitHub Pages Web Platform & Documentation
    ├── index.html                # Interactive SPA platform (5 hash views, dual theme)
    ├── assets/                   # Vector logos (brand-logo.png, kff-logo.png, etc.)
    ├── DEBORAH_AUDIT_SYNTHESIS.md# October 2026 audit synthesis & F01-F15 specifications
    ├── architecture.md           # End-to-end multi-pillar architecture & pipeline specs
    ├── methodology.md            # Extraction logic, anti-double-counting, & cohort rules
    ├── data_dictionary.md        # Comprehensive schema specifications & 12-sector taxonomy
    └── decision_log.md           # System audit and structural decision log
```

---

## Governance & Security Policies

1. **Anti-Double-Counting Invariant:** DAF sponsor inflows and final charity outflows are never merged into the same aggregate pool.
2. **Confidentiality & Provenance:** Production database server credentials must never be committed or embedded in client static assets. Sample records displayed on static web tiers serve as synthetic validation fixtures until authorized backend DSNs are bound.
3. **No Unchecked Merges:** Organizations lacking verified EINs are preserved as independent records with review tags to prevent inaccurate entity resolution.

---

## Verification & Testing

Execute unit tests:
```bash
python -m unittest discover -s tests
```

Validate Python module syntax:
```bash
python -m py_compile dashboard_app.py
python -m py_compile irs_pipeline/ai_categorizer.py
python -m py_compile irs_pipeline/extractor.py
python -m py_compile irs_db/exporter.py
```

---

## 👤 Author & Strategic Portfolio

**Akshay Kumar**  
STEM MBA Candidate · Business Analytics & AI · American University Kogod School of Business  
Business Analyst, U.S. Embassy, India  
- **Executive Portfolio:** [https://akbknight.github.io/](https://akbknight.github.io/)  
- **LinkedIn Profile:** [linkedin.com/in/akshaykumardl](https://www.linkedin.com/in/akshaykumardl/)  
- **Direct Résumé:** [Download PDF (369 KB)](https://akbknight.github.io/assets/Akshay_Resume.pdf)  
- **Email:** [ak8335a@american.edu](mailto:ak8335a@american.edu)

