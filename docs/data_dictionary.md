# Data Dictionary — IRS Form 990 Grant Extraction Pipeline

## Core Grant Record Schema

| Field | Type | Description | Source |
|-------|------|-------------|--------|
| `id` | integer | Auto-increment primary key | Pipeline |
| `grantor_ein` | string(9) | EIN of the filing (granting) organization | 990 header: `EIN` |
| `grantor_name` | string | Legal name of the granting organization | 990 header: `BusinessNameLine1Txt` |
| `grantee_name` | string | Legal name of the recipient organization | Schedule I: `RecipientBusinessName` |
| `grantee_ein` | string(9) | EIN of the recipient (may be null) | Schedule I: `EINOfRecipient` |
| `grantee_city` | string | Recipient city | Schedule I: `RecipientUSAddress/CityNm` |
| `grantee_state` | string(2) | Recipient state abbreviation | Schedule I: `RecipientUSAddress/StateAbbreviationCd` |
| `grantee_country` | string | Recipient country (foreign grants) | Schedule I: `RecipientForeignAddress/CountryCd` |
| `grant_amount` | integer | Cash grant amount in USD | Schedule I: `CashGrantAmt` or `Amt` |
| `purpose_text` | string | Freetext description of grant purpose | Schedule I: `PurposeOfGrantTxt` |
| `tax_year` | integer | Tax year of the 990 filing | 990 header: `TaxYr` |
| `is_jewish` | boolean | Keyword-based Jewish philanthropic classification | Derived |
| `subject_category` | string | NTEE-based or AI-classified subject area | Derived |

---

## XML Schema Variants

### Current Schema (post-2014)
```
IRS990ScheduleI/
  RecipientTableGrp/
    EINOfRecipient
    RecipientBusinessName/BusinessNameLine1Txt
    RecipientUSAddress/CityNm
    RecipientUSAddress/StateAbbreviationCd
    CashGrantAmt
    PurposeOfGrantTxt
```

### Legacy Schema (pre-2014, still used by some filers)
```
IRS990ScheduleI/
  GrantOrContributionPdDurYrGrp/
    EINOfRecipient
    BusinessName/BusinessNameLine1
    USAddress/CityNm
    USAddress/StateAbbreviationCd
    CashGrantAmt
    PurposeOfGrantTxt
```

---

## Database Tables (SQLite / Neon PostgreSQL)

| Table | Purpose |
|-------|---------|
| `grants` | Core grant records (schema above) |
| `jewish_grants` | Subset of grants where `is_jewish = true` |
| `grant_summary_by_year` | Total count and dollars by tax year |
| `grant_summary_by_state` | Total count and dollars by grantee state |
| `grant_summary_by_subject` | Total count and dollars by subject category |
| `top_grantmakers` | Top-N organizations by total grant dollars |
| `top_recipients` | Top-N recipients by total dollars received |

---

## Keyword Classification Reference

Jewish classification applies to grantee names containing (case-insensitive):

**Religious/Cultural Terms**: `jewish`, `hebrew`, `yiddish`, `judaism`, `jewish community`, `jewish federation`

**Organizational Patterns**: `hillel`, `jcc`, `jfs` (Jewish Family Service), `federation` (in context)

**Named Foundations**: Curated list maintained in `categorize_keywords.py`

**Israel-Related**: `israel` (with organizational context filter to exclude non-philanthropic mentions)

---

## Pipeline Configuration (`irs_pipeline/config.py`)

| Parameter | Description |
|-----------|-------------|
| `IRS_S3_BASE_URL` | Base URL for IRS bulk download endpoint |
| `TAX_YEARS` | List of years to process (default: 2019–2024) |
| `DB_PATH` | Path to local SQLite database file |
| `BATCH_SIZE` | Records per database insert batch |
| `MIN_GRANT_AMOUNT` | Minimum grant amount filter (default: $5,000 per IRS requirement) |
