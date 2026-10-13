# Architecture — IRS Form 990 Grant Extraction Pipeline & Analytics Platform

## System Overview

An enterprise-grade, multi-stage data mining and analytical intelligence platform for extracting, classifying, storing, and visualizing grant records from IRS Form 990 electronic XML data. The system combines high-throughput Python ETL processing for the 2019–2024 IRS public S3 archive (9.7M+ filings, $550.2B+ in charitable disbursements) with an interactive, zero-dependency client analytical platform.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DATA ACQUISITION & MINING                       │
│                                                                        │
│  IRS S3 Bulk Electronic Filings (2019–2024 TEOS XML ZIP Archives)      │
│                                │                                       │
│                                ▼                                       │
│                     irs_pipeline/ & master_pipeline.py                 │
│    ├── audit_downloader.py     ← S3 index reconciliation & resumption  │
│    ├── extractor.py            ← Dual-schema Schedule I streaming parser│
│    ├── categorize_keywords.py  ← High-speed regex taxonomic tagging    │
│    └── ai_categorizer.py       ← Optional Claude/Anthropic AI pass     │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      STORAGE & WAREHOUSE LAYER                         │
│                                                                        │
│   SQLite (Local Manifest)  ──► Neon PostgreSQL / DuckDB (Warehouse)    │
│   • grants (Schedule I)        • 12-sector taxonomy tables             │
│   • filings (Return headers)   • pairwise_relationships (F05)          │
│   • organizations (EIN dedupe) • d_decision_log (F12 audit trail)      │
│   • commitments (F04 pledges)  • daf_transfers (F08 anti-inflation)   │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                PRESENTATION & CLIENT ANALYTICS PLATFORM                │
│                                                                        │
│   Grant Atlas & Deborah Platform (docs/index.html & modules)           │
│   ├── Hash Router: #/dashboard, #/sectors, #/relationships, #/decisions │
│   ├── Dual Theme: OLED Obsidian Dark (#0f1117) & Apple Light (#f8fafc) │
│   ├── Interactive Visuals: Chart.js 4.4 trends & vector SVG pipelines │
│   └── Decision Center: Low-confidence review & reversible audit log    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Extraction Pipeline Stages

### Stage 1: Acquisition (`irs_pipeline/audit_downloader.py`)
- Ingests IRS TEOS S3 bulk XML archives spanning tax years 2019 through 2024.
- Maintains a SQLite state manifest to guarantee idempotency and resumption after interruptions.
- Employs worker thread pools with tenacity backoff retry algorithms to handle network fluctuations without corrupting state.

### Stage 2: Streaming Extraction (`irs_pipeline/extractor.py` & `master_pipeline.py`)
- Employs an in-memory ZIP streaming decompressor (`zipfile.ZipFile`) that avoids writing unpacked XML files to disk, eliminating multi-gigabyte disk thrash.
- Dual-Schema XML Support: Schedule I elements evolved over time; the parser automatically detects and normalizes both schema variants:
  - **Legacy Schema (pre-2014):** `GrantOrContributionPdDurYrGrp` with `BusinessName/BusinessNameLine1` and `CashGrantAmt`.
  - **Modern Schema (post-2014):** `RecipientTableGrp` with `RecipientBusinessName/BusinessNameLine1Txt` and `CashGrantAmt`.
- Extracts granular fields: Filer Name & EIN, Grantee Name & EIN (when available), Recipient City, State, Country, Disbursed Amount, Purpose Description, and Filing Tax Year.

### Stage 3: Two-Pass Classification (`categorize_keywords.py` & `ai_categorizer.py`)
- **Pass 1 (Primary - Zero API Cost):** High-speed regex matching across combined text fields (`RecipientName` + `Description` + `PrimarySubject` + `SupportStrategies`). Matches across the 12 approved philanthropic sectors and cultural/communal taxonomy.
- **Pass 2 (AI-Assisted Enrichment):** For records flagged as `Miscellaneous` or ambiguous, the pipeline can route records to Anthropic's Claude API to extract fine-grained intent, program targets, and philanthropic focus.

### Stage 4: Aggregation & Entity Resolution
- Reconciles 9-digit EINs across filers and grantees.
- Separates paid disbursements from future multi-year grant commitments (Requirement F04).
- Isolates intermediary pass-through funding (DAFs) to prevent artificial 200% double-counting (Requirement F08).
- Compiles longitudinal retention cohorts: `New`, `Retained`, and `Not Observed` (Requirement F06).

---

## 2. Web Application & Client Analytics Architecture

The client analytics layer (`docs/index.html`) is structured as a resilient, self-contained single-page application (SPA) optimized for zero latency and instant deployment via GitHub Pages.

### 2.1 Router & State Engine
- **Hash-Based Router:** Uses URL hash fragments (`#/dashboard`, `#/sectors`, `#/relationships`, `#/decisions`, `#/pipeline`) to guarantee clean navigation without requiring server-side fallback rules on static hosts.
- **Scope State Management:** Global toggle supporting both broad US philanthropy analysis and focused communal giving scopes (Requirement F09).
- **Persistent Theme Controller:** Stores user theme preference (`dark` / `light`) in `localStorage` with zero-flash initial paint.

### 2.2 Views and Modules
1. **Overview & Executive Telemetry (`#/dashboard`):** Real-time aggregate KPI cards ($550.2B, 9.7M+ filings, 830K+ EIN matches, 13.8M records), Chart.js longitudinal trends, multi-parameter filter bar, and sortable tables with modal grant record drilldowns.
2. **Sector & Thematic Explorer (`#/sectors` - F01, F10):** Interactive analysis across the 12 approved sectors, year-over-year funding trajectories, top funders/grantees, and geographic distribution.
3. **Relationship & DAF Flow Explorer (`#/relationships` - F05, F06, F08, F11):** Pairwise longitudinal ledgers, retention cohorts (`New`, `Retained`, `Not Observed`), DAF directional flow visualizer with anti-double-counting warnings, and direct entity drawer navigation.
4. **Decision Center & Review Console (`#/decisions` - F02, F12, F13):** Priority review queue for mixed/unresolved grant classifications, requiring reviewer identity, rationale, and policy versioning with a reversible audit trail.
5. **DataOps & Architecture Benchmarks (`#/pipeline` - F14):** Interactive vector SVG pipeline diagram, worker thread benchmarks, and streaming telemetry.

---

## 3. Storage Layer & Backends

| Backend | Location | Role & Schema Responsibilities |
|---|---|---|
| **SQLite (Local Manifest)** | `workspace_data/databases/` | Ingestion tracking, archive indexing, checkpoint resumes, local query scratchpad |
| **PostgreSQL (Neon / Local)** | Remote / DSN Configured | High-concurrency warehouse: `grants`, `filings`, `organizations`, `commitments`, `decisions` |
| **DuckDB (Analytical)** | Embedded Memory / Local | High-speed columnar analytics, cohort window functions, aggregate aggregations |
| **Excel & Parquet** | `workspace_data/exports/` | Part-split deliverables (900K rows/file) for executive stakeholders |
| **Static JSON & Web Client** | `docs/` | Static distribution for GitHub Pages, verified synthetic fixtures, client telemetry |
