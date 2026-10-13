# Deborah Foundation Dashboard Audit & Strategic Synthesis

**Audit Date:** October 13, 2026  
**Target Repository:** [`form990-grant-miner`](https://github.com/akbknight/form990-grant-miner)  
**Execution Context:** Autonomous Site Reliability, Verification, and Platform Upgrade Directive  
**Governing Documents:** `ANTIGRAVITY_HANDOFF.md`, `WEB_CLONE_BLUEPRINT.md`, `docs/codebase/*.md`

---

## 1. Executive Summary & Purpose

In October 2026, an exhaustive architectural and forensic audit was conducted on the Deborah Foundation Dashboard archive and associated analytical codebase. The audit reconciled the exported static dashboard baseline with the meeting-reported requirements for the next-generation philanthropic intelligence system ("Deborah Next").

This document serves as the authoritative synthesis bridging the high-throughput IRS Form 990 data mining pipeline in `form990-grant-miner` with the institutional analytical web platform, codifying requirements F01 through F15, strict data governance boundaries, and anti-hallucination verification protocols.

---

## 2. Core Architectural Mandate

The system operates across two tightly coupled pillars:

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

1. **Extraction Engine (`irs_pipeline/`, `master_pipeline.py`):**
   - High-throughput ingestion of IRS TEOS Form 990 bulk electronic filings (2019–2024).
   - In-memory decompress-and-stream architecture eliminating disk thrash across 600 GB+ corpus.
   - Dual-schema Schedule I XML parser supporting both legacy (`GrantOrContributionPdDurYrGrp`) and modern (`RecipientTableGrp`) groups.
   - Zero-external-API keyword categorizer coupled with optional Claude/Anthropic classification passes.

2. **Web Analytics Platform (`docs/index.html` on GitHub Pages):**
   - Static, zero-dependency SPA with client-side hash routing (`#/dashboard`, `#/sectors`, `#/relationships`, `#/decisions`, `#/pipeline`).
   - Deep dual-theme system (OLED Obsidian Dark Mode & Apple-Grade Light Mode).
   - Dynamic exploration across foundations, recipients, retention cohorts, and DAF flows.
   - Interactive Decision Center for ambiguous/mixed classifications with reversible audit logging.

---

## 3. Meeting Requirements Traceability Matrix (Features F01–F15)

| Feature ID | Requirement & Context | Operational Implementation & Standard |
|---|---|---|
| **F01** | **12 Expanded Philanthropic Sectors** | Configured canonical taxonomy across 12 approved sectors (Higher Ed, Healthcare, Humanitarian, Civic, Jewish Continuity, Environment, etc.) with year-over-year trends and drilldowns. |
| **F02** | **EIN Identity Resolution** | Normalized 9-digit EIN matching with verification status. Unmatched organizations remain distinctly visible and are never merged purely on similar strings. |
| **F03** | **Financial Profiles & Source Verification** | Strict separation of grant flows, revenues, assets, and liabilities. Every displayed metric carries tax year, filing identifier, and Schedule I locator provenance. |
| **F04** | **Commitments vs. Paid Grants** | Unpaid future grant commitments are segregated from paid grant disbursements. Missing commitment records are recorded as "Not Reported" (never defaulted to $0). |
| **F05** | **Pairwise Funding Relationships** | Filer-to-grantee longitudinal relationship ledgers displaying itemized annual grants, purpose text, and multi-year trajectory. |
| **F06** | **Retention Cohorts** | Organizations categorized across comparative periods into: `New` (first-time grantee), `Retained` (continuous grant recipient), and `Not Observed` (missing in cycle without asserting cessation). |
| **F07** | **Ranked Increases / Decreases** | Dollar-value growth and decline rankings. Percentage changes require a valid nonzero baseline and are flagged if comparative tax years are incomplete. |
| **F08** | **DAF & Intermediary Flow Tracing** | Directional tracing of donor-advised funds (e.g., Vanguard Charitable, Fidelity Charitable, Jewish Communal Fund) with mandatory anti-double-counting warnings. |
| **F09** | **Scope Switcher: All Philanthropy vs. Jewish Focus** | Persistent toggle switching aggregate calculations between overall US philanthropic flows and Jewish-specific communal giving. |
| **F10** | **Sector & Geographic Exploration** | Coordinated multi-dimension filters distinguishing recipient legal location (headquarters) from program beneficiary geography. |
| **F11** | **Direct Profile Navigation** | Context-preserving drilldowns from relationship ledgers and tables directly into detailed entity profile drawers with stateful back-navigation. |
| **F12** | **Decision Center for Mixed/Unresolved Grants** | High-priority governance console for reviewing low-confidence keyword matches and mixed-purpose grants, enforcing mandatory review reasons and reviewer IDs. |
| **F13** | **Taxonomy Neutrality & Scope Labeling** | Replaced rigid binary labels with clear communal scope descriptors (`Jewish Community Focus` vs. `General Philanthropic Scope`). |
| **F14** | **Granular Schedule I Extraction Pipeline** | Documented and visualized 3-tier extraction architecture displaying worker pools, batch states, and database schema partitions. |
| **F15** | **Independent Specialized Research Isolation** | Specialized ad-hoc research modules (such as Department of Education rabbinical school datasets) are strictly isolated from the core 990 schema. |

---

## 4. Fundamental Data Governance Invariants

### 4.1 Anti-Double-Counting Invariant (F08)
When tracking capital through donor-advised funds (DAFs) or community foundation intermediaries:
- Capital deposited into a DAF sponsor (Filer A ➔ DAF Sponsor B) must **NEVER** be summed into the same aggregate pool as the DAF grant out to a final charity (DAF Sponsor B ➔ Charity C).
- Doing so creates an artificial 200% inflation of philanthropic capital.
- The web platform and SQL analytics isolate intermediary pass-through nodes and flag them in all visual ledgers.

### 4.2 Paid Grants vs. Future Commitments (F04)
- Form 990 Schedule I Part II reports grants disbursed or approved for future payment.
- The pipeline rigorously separates `CashGrantAmt` (disbursed cash) from future multi-year grant pledges or commitments.
- Commitments are never counted as current-year liquidity.

### 4.3 Entity Identity Resolution & EIN Hygiene (F02)
- Recipient names in IRS XML filings are unstructured strings subject to abbreviations, typos, and historical mergers (e.g., "AMER COMM FOR WEIZMANN INST", "AMERICAN WEIZMANN COMMITTEE").
- Identity resolution strictly utilizes 9-digit EIN normalization where provided.
- If EIN is omitted on Schedule I, records remain unmerged with an "Unresolved EIN" badge. They are never merged based solely on string proximity without human review in the Decision Center.

---

## 5. Security, Confidentiality & Deployment Protocols

1. **Static Distribution Safety:**
   - GitHub Pages serves static, client-side bundles. Under no circumstances may server-role database keys (e.g., Neon Postgres write credentials, Supabase service roles) be embedded in client JavaScript or committed to git.
2. **Confidentiality Watermark:**
   - The platform displays an unambiguous confidentiality badge ("INTERNAL RESEARCH & VERIFICATION") and indicates when synthetic sample fixtures are active for demonstration purposes.
3. **Link & Asset Integrity:**
   - Zero dead anchor tags (`href="#"`), zero placeholder domains (`example.com`), and 100% verified asset paths referencing local SVG/PNG files in `docs/assets/`.
