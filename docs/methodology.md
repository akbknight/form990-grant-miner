# Methodology — IRS Form 990 Grant Extraction Pipeline & Analytics Engine

## 1. Background: IRS Form 990 Electronic Filings

Form 990 is the annual information return that federally tax-exempt organizations classified under Section 501(c)(3) must file with the Internal Revenue Service. It discloses financial metrics (revenues, expenditures, net assets, executive compensation), organizational governance, and programmatic grant distributions.

The IRS makes electronically filed Form 990 XML data publicly available through its Tax Exempt Organization Search (TEOS) bulk data initiative, hosted in public Amazon S3 buckets at `https://apps.irs.gov/pub/epostcard/990/`. The electronic corpus spanning 2013–2024 comprises over 600 GB of compressed XML data across thousands of multi-gigabyte ZIP archives.

---

## 2. Schedule I (Form 990): Grants & Assistance

Schedule I ("Grants and Other Assistance to Organizations, Governments, and Individuals in the United States") is mandatory for any organization that disbursed $5,000 or more in domestic grants during the tax period.

### 2.1 XML Element Mapping & Schema Evolution
IRS schemas evolved significantly across tax years. The extraction engine supports both major schema eras:

| Field Name | Legacy Schema (Pre-2014) | Modern Schema (Post-2014) | Notes |
|---|---|---|---|
| **Recipient Name** | `BusinessName/BusinessNameLine1` | `RecipientBusinessName/BusinessNameLine1Txt` | Unstructured corporate string |
| **Recipient EIN** | `EINOfRecipient` | `EINOfRecipient` | Often missing or unverified |
| **Recipient City** | `USAddress/CityNm` | `RecipientUSAddress/CityNm` | City name |
| **Recipient State** | `USAddress/StateAbbreviationCd` | `RecipientUSAddress/StateAbbreviationCd` | 2-letter state code |
| **Cash Grant Amount** | `CashGrantAmt` or `Amt` | `CashGrantAmt` | Disbursed USD |
| **Purpose Text** | `PurposeOfGrantTxt` | `PurposeOfGrantTxt` | Freeform purpose description |

Parent container elements:
- Legacy: `GrantOrContributionPdDurYrGrp`
- Modern: `RecipientTableGrp`

---

## 3. High-Throughput Ingestion Methodology

### 3.1 In-Memory Stream Processing (`master_pipeline.py`)
1. Recursively locates IRS TEOS ZIP archives.
2. Streams raw compressed entries via `zipfile.ZipFile` in memory without staging uncompressed XML files on physical disk.
3. Parses XML DOM trees via Python's built-in `xml.etree.ElementTree` with namespace-tolerant tag matching.
4. Flushes structured rows immediately to indexed CSV streams and partitioned SQLite tables.
5. Employs 8-worker process pools capable of parsing 2,500+ filings per minute per core.

### 3.2 Database Warehouse Ingestion (`irs_pipeline/`)
1. **Phase 1 (Acquisition & Reconciliation):** Downloads annual index CSV manifests; validates checksums and logs missing object IDs in SQLite.
2. **Phase 2 (Streaming Extraction):** Dispatches verified files to extraction workers with transactional batching (10,000 rows/batch) into PostgreSQL / DuckDB.
3. **Phase 3 (Enrichment):** Applies classification rules and flags ambiguous records for human governance.

---

## 4. Key Analytical & Data Governance Methodologies

### 4.1 Anti-Double-Counting Invariant (F08)
When tracking philanthropic flows through financial intermediaries—such as Donor-Advised Fund (DAF) sponsors (e.g., Vanguard Charitable, Fidelity Charitable, Jewish Communal Fund) or Community Foundations:
- **The Core Risk:** In standard rollups, if Foundation A grants $10M to a DAF sponsor, and that DAF subsequently grants $10M to Charity C, summing both reports results in $20M in reported charitable capital—an artificial 100% inflation.
- **The Protocol:** The pipeline flags all known intermediary and DAF entities with `is_intermediary = TRUE`. The platform isolates intermediary transfers into dedicated flow views and explicitly excludes them from top-level aggregate calculations unless viewing direct pass-through ledgers.

### 4.2 Paid Grants vs. Future Commitments (F04)
- Schedule I instructions allow organizations to disclose grants approved for future payment.
- The pipeline rigorously decouples:
  - `CashGrantAmt`: Actual cash disbursed during the filing tax year.
  - `FutureCommitment`: Multi-year pledges or future conditional commitments.
- Missing commitment records are cataloged as `Not Reported` rather than defaulted to zero.

### 4.3 Identity Resolution & EIN Matching (F02)
- Recipient names in IRS filings lack universal normalization (e.g., "AMER FRIENDS OF TEL AVIV UNIV", "AMERICAN FRIENDS OF TEL AVIV UNIVERSITY INC").
- The pipeline prioritizes 9-digit `EINOfRecipient` matching against the IRS master business file.
- When an EIN is absent or invalid:
  - The record is flagged as `Unresolved EIN`.
  - Records are **never** automatically merged based purely on string distance or Levenshtein similarity. Unresolved entities remain isolated until human review in the Decision Center.

### 4.4 Longitudinal Retention Cohorts (F06)
To analyze funding stability between any two comparative periods (e.g., Period $T_1$ vs. Period $T_2$):
- **`New` Grantee:** Funded in Period $T_2$, but had zero documented grants from the funder in Period $T_1$.
- **`Retained` Grantee:** Funded in both Period $T_1$ and Period $T_2$.
- **`Not Observed` Grantee:** Funded in Period $T_1$, but absent in Period $T_2$.
  - *Critical Rule:* Absence in a filing cycle must **never** be reported as "Terminated" or "Lost" without external verification, because filing delays or multi-year grant disbursement cycles frequently produce intermittent reporting.

### 4.5 The 12-Sector Classification Taxonomy (F01)
Grants are categorized into 12 mutually exclusive philanthropic domains using a deterministic keyword hierarchy:
1. Higher Education & Academic Research
2. Humanitarian & Disaster Relief
3. Healthcare & Biomedical Science
4. Civic Engagement & Civil Rights
5. Arts, Culture & Heritage
6. Jewish Community & Continuity
7. Environment & Conservation
8. Human Services & Poverty Alleviation
9. Community Foundations & Regional Giving
10. K-12 Education & Youth Literacy
11. International Development & Global Health
12. Public Policy & Economic Research

If a grant satisfies keywords across multiple sectors, it is routed to the **Decision Center (F12)** for human verification and audit logging.
