# Data Dictionary — IRS Form 990 Grant Mining & Analytics Platform

## 1. Core Grant Record Schema (`grants`)

Every row extracted from IRS Form 990 Schedule I represents an individual grant disbursement or authorized transfer.

| Field Name | Type | Nullable | Source in IRS Form 990 XML | Description & Invariant Rules |
|---|---|---|---|---|
| `id` | `VARCHAR(64)` | No | Internal / Pipeline Key | Deterministic unique grant identifier (`{filer_ein}_{tax_year}_{seq}`). |
| `grantor_ein` | `CHAR(9)` | No | Header: `EIN` | 9-digit EIN of the filing organization. |
| `grantor_name` | `VARCHAR(255)` | No | Header: `BusinessNameLine1Txt` | Legal entity name of the filing organization. |
| `grantee_name` | `VARCHAR(255)` | No | Schedule I: `RecipientBusinessName/BusinessNameLine1Txt` | Raw legal name of grantee as declared on Schedule I. |
| `grantee_ein` | `CHAR(9)` | Yes | Schedule I: `EINOfRecipient` | 9-digit EIN of recipient. If omitted, marked `Unresolved EIN`. |
| `grantee_city` | `VARCHAR(100)` | Yes | Schedule I: `RecipientUSAddress/CityNm` | City of recipient legal address. |
| `grantee_state` | `CHAR(2)` | Yes | Schedule I: `RecipientUSAddress/StateAbbreviationCd` | 2-letter US state code of recipient address. |
| `grantee_country` | `CHAR(2)` | Yes | Schedule I: `RecipientForeignAddress/CountryCd` | 2-letter ISO country code for foreign grant disbursements. |
| `grant_amount` | `BIGINT` | No | Schedule I: `CashGrantAmt` or `Amt` | Actual cash amount disbursed in USD during filing year. |
| `purpose_text` | `TEXT` | Yes | Schedule I: `PurposeOfGrantTxt` | Narrative explanation of grant purpose provided by filer. |
| `tax_year` | `INTEGER` | No | Header: `TaxYr` | IRS tax year of return (e.g. 2019, 2020, 2021, 2022, 2023, 2024). |
| `schedule_locator` | `VARCHAR(50)` | No | XML XPath Locator | Provenance pointer (e.g., `SchedI/PartII/Row[14]`). |
| `sector_category` | `VARCHAR(50)` | No | Derived (Keyword / Classifier) | Mapped to one of the 12 approved philanthropic sectors. |
| `communal_scope` | `VARCHAR(50)` | No | Derived (Keyword / Classifier) | Scope tag: `Jewish Community Focus` vs. `General Philanthropy`. |
| `is_intermediary` | `BOOLEAN` | No | Derived (Entity Registry) | Flag set to `TRUE` if recipient is a DAF sponsor / intermediary. |

---

## 2. Organization Master & Identity Resolution (`organizations` - F02)

| Field Name | Type | Nullable | Description & Verification Standard |
|---|---|---|---|
| `org_id` | `VARCHAR(64)` | No | Unique normalized system identifier. |
| `normalized_ein` | `CHAR(9)` | Yes | IRS Employer Identification Number (9 digits, unhyphenated). |
| `legal_name` | `VARCHAR(255)` | No | Primary canonical legal name. |
| `alias_names` | `TEXT[]` | Yes | Array of historical or alternate names encountered in XML filings. |
| `entity_type` | `VARCHAR(50)` | No | `Private Foundation`, `Public Charity`, `DAF Sponsor`, `Community Foundation`. |
| `hq_state` | `CHAR(2)` | Yes | 2-letter state abbreviation of organization headquarters. |
| `ein_match_status` | `VARCHAR(30)` | No | `Verified EIN`, `Unmatched String`, `Under Review`. |
| `ein_match_method` | `VARCHAR(50)` | No | `Direct Header EIN`, `Schedule I EIN Match`, `Manual Review`. |

> **Invariant F02:** Organizations with missing EINs must remain distinct entities. Never merge two organizations solely based on string similarity without verified human review.

---

## 3. Future Grant Commitments (`commitments` - F04)

| Field Name | Type | Nullable | Description & Accounting Standard |
|---|---|---|---|
| `commitment_id` | `VARCHAR(64)` | No | Unique identifier for the commitment record. |
| `grantor_ein` | `CHAR(9)` | No | EIN of the committing foundation. |
| `grantee_ein` | `CHAR(9)` | Yes | EIN of the intended recipient. |
| `approved_amount` | `BIGINT` | Yes | Total approved commitment amount in USD. |
| `payable_period` | `VARCHAR(50)` | Yes | Multi-year schedule (e.g., `2025–2028`). |
| `status` | `VARCHAR(30)` | No | `Approved Future`, `Pledged`, `Contingent`, `Not Reported`. |
| `source_filing_id` | `VARCHAR(64)` | No | Filing ID containing the Schedule I Part II commitment notes. |

> **Invariant F04:** Commitments represent future pledges and must **never** be conflated with or added to current-year paid cash grants (`CashGrantAmt`). Unknown commitment values are recorded as `Not Reported`, never defaulted to $0.

---

## 4. DAF & Intermediary Flow Tracing (`daf_transfers` - F08)

| Field Name | Type | Nullable | Description & Anti-Double-Counting Rules |
|---|---|---|---|
| `transfer_id` | `VARCHAR(64)` | No | Unique transfer event identifier. |
| `origin_funder_ein` | `CHAR(9)` | No | Original donor foundation EIN. |
| `intermediary_ein` | `CHAR(9)` | No | Intermediary / DAF sponsor EIN (e.g., Vanguard, Fidelity, JCF). |
| `final_grantee_ein` | `CHAR(9)` | Yes | Ultimate operating charity recipient (if traceable). |
| `transfer_amount` | `BIGINT` | No | Dollar amount transferred in USD. |
| `tax_year` | `INTEGER` | No | Tax year of transaction. |
| `flow_stage` | `VARCHAR(30)` | No | `Inflow to DAF` vs. `Outflow from DAF to Charity`. |
| `double_count_flag` | `BOOLEAN` | No | Set to `TRUE` to mandate exclusion from aggregate charitable totals. |

> **Invariant F08:** Inflows into DAFs and subsequent outflows from DAFs must never be summed together in any top-level philanthropic denominator.

---

## 5. Decision Center & Audit Trail (`d_decision_log` - F12, F13)

| Field Name | Type | Nullable | Description & Governance Requirement |
|---|---|---|---|
| `decision_id` | `VARCHAR(64)` | No | Unique decision log entry ID. |
| `target_record_id` | `VARCHAR(64)` | No | References `grants.id` or `organizations.org_id`. |
| `decision_table` | `VARCHAR(50)` | No | `classification`, `allocation`, `intermediary`, `identity_review`. |
| `prior_state` | `VARCHAR(50)` | No | Classification state before review. |
| `new_state` | `VARCHAR(50)` | No | Applied classification state after review. |
| `decision_reason` | `TEXT` | No | **Mandatory:** Specific justification entered by reviewer. |
| `reviewer_id` | `VARCHAR(100)` | No | System user ID or reviewer name. |
| `policy_version` | `VARCHAR(30)` | No | Governing policy rulebook (e.g., `v2026.4`). |
| `is_reversible` | `BOOLEAN` | No | Default `TRUE`; enables complete undo and state rollback. |
| `decided_at` | `TIMESTAMP` | No | Exact ISO 8601 UTC timestamp of action. |

---

## 6. Approved 12-Sector Philanthropic Taxonomy (F01)

| Code | Sector Name | Description & Typical Focus Areas |
|---|---|---|
| `SEC-01` | **Higher Education & Academic Research** | Universities, clinical institutes, endowments, academic chairs, scientific fellowships. |
| `SEC-02` | **Humanitarian & Disaster Relief** | Emergency response, food distribution, refugee aid, international crisis relief. |
| `SEC-03` | **Healthcare & Biomedical Science** | Hospitals, disease research, oncology clinics, medical equipment, mental health centers. |
| `SEC-04` | **Civic Engagement & Civil Rights** | Voting rights, legal defense funds, civil liberties, transparency, public advocacy. |
| `SEC-05` | **Arts, Culture & Heritage** | Museums, performing arts, historical societies, public media, cultural centers. |
| `SEC-06` | **Jewish Community & Continuity** | Synagogues, JCCs, Federations, Day Schools, youth engagement, camp scholarships. |
| `SEC-07` | **Environment & Conservation** | Land trusts, climate research, clean energy advocacy, biodiversity preservation. |
| `SEC-08` | **Human Services & Poverty Alleviation** | Housing, homeless shelters, job training, youth development, social safety net programs. |
| `SEC-09` | **Community Foundations & Regional Giving** | Place-based grantmakers, regional trust funds, civic endowments. |
| `SEC-10` | **K-12 Education & Youth Literacy** | Charter schools, STEM programs, after-school tutoring, teacher development. |
| `SEC-11` | **International Development & Global Health** | Clean water initiatives, microfinance, global agricultural sustainability. |
| `SEC-12` | **Public Policy & Economic Research** | Nonpartisan think tanks, economic analysis, governance research institutes. |
