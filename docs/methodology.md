# Methodology — IRS Form 990 Grant Extraction Pipeline

## Background: IRS Form 990

Form 990 is the annual information return that tax-exempt organizations classified as 501(c)(3) must file with the Internal Revenue Service. It discloses financial data (revenues, expenses, assets), governance information (officers, directors, compensation), and programmatic activity.

The IRS makes Form 990 XML filings publicly available through its Tax Exempt Organization Search (TEOS) bulk data program. Filings are distributed as ZIP archives organized by tax year, hosted on an Amazon S3 bucket at `https://apps.irs.gov/pub/epostcard/990/`. The total corpus for 2013–2023 is approximately 600 GB. Each year contains multiple ZIP archives; each ZIP contains thousands of individual XML files — one file per filing.

## Schedule I (Form 990): Grants

Schedule I is the section of Form 990 titled "Grants and Other Assistance to Organizations, Governments, and Individuals in the United States." Organizations that distributed $5,000 or more in grants during the tax year must attach Schedule I to their Form 990.

**Key fields extracted from Schedule I:**

| XML Element | Data Contained |
|---|---|
| `RecipientBusinessName/BusinessNameLine1Txt` | Legal name of the recipient organization |
| `RecipientPersonNm` | Name of individual grant recipient |
| `EINOfRecipient` | Recipient's Employer Identification Number |
| `RecipientUSAddress/CityNm` | Recipient city |
| `RecipientUSAddress/StateAbbreviationCd` | Recipient U.S. state |
| `RecipientForeignAddress/CountryCd` | Recipient country (foreign grants) |
| `CashGrantAmt` | Dollar amount of the cash grant |
| `PurposeOfGrantTxt` | Freetext purpose/description of the grant |
| `Amt` | Alternate amount field used in some schema versions |

**Parsed parent elements:** `GrantOrContributionPdDurYrGrp` (older schema) and `RecipientTableGrp` (newer schema). The pipeline checks both to handle schema variation across years.

## Data Scale

The IRS publishes bulk data covering approximately 2013–2024. This pipeline focuses on the 2019–2024 tax years:

- Each year: approximately 200,000–400,000 Form 990 filings
- Each filing: anywhere from 0 to hundreds of grant records
- Total grant records extracted (2019–2024): 9.7 million+
- Total committed grant amounts: $550 billion+
- Note: these are grant amounts *committed* in the filing year as reported to the IRS, not necessarily the actual disbursement date

## XML Structure and Schema Evolution

IRS Form 990 XML follows schemas that have evolved over the years. The pipeline uses namespace-agnostic parsing to handle this:

1. The XML namespace URI is extracted from the root element tag
2. All XPath queries are constructed with the detected namespace
3. Multiple field name variants are tried for each target field (e.g., `RecipientNameTxt`, `RecipientPersonNm`, `BusinessNameLine1Txt`)

Approximately 2–5% of XML files in the IRS bulk archives have schema issues — malformed XML, encoding errors, or truncated files. The pipeline catches `xml.etree.ElementTree.ParseError` and other exceptions per file, logs the error, and continues processing without crashing.

## Extraction Methodology

### Local Bulk Pipeline (master_pipeline.py)

1. Recursively scan configured source folders for ZIP archives
2. Deduplicate ZIPs by stripping Windows copy suffixes (e.g., `file (1).zip`)
3. For each ZIP, iterate over XML entries using `zipfile.ZipFile`
4. Parse each XML with Python's built-in `xml.etree.ElementTree` (zero dependencies)
5. Extract grant records from `GrantOrContributionPdDurYrGrp` and `RecipientTableGrp` elements
6. Write each row immediately to a streaming CSV (resume-safe — progress is never lost if interrupted)
7. Buffer rows in memory and write Excel part files every 900,000 rows (Excel's row limit is 1,048,576)

Resume safety: the pipeline checks how many rows already exist in the output CSV and resumes from that count, skipping already-processed data.

### Database-Backed Pipeline (irs_pipeline/)

A three-phase pipeline that uses SQLite for local manifest tracking and PostgreSQL for the grant warehouse:

- **Phase 1 (audit_downloader.py):** Download IRS S3 index CSVs for each target year. Each index CSV lists all available filings (object_id, EIN, taxpayer name, return type). Build or update a local SQLite manifest. Reconcile what is already downloaded locally. Download only missing files using a thread pool, with retry logic via `tenacity`.
- **Phase 2 (extractor.py):** Read verified XML files from the manifest. Parse with `irs_db/parser.py`. Upsert filing and grant records into PostgreSQL using multi-threaded workers. Track extraction state in SQLite.
- **Phase 3 (ai_categorizer.py):** Optional AI-assisted re-categorization pass using the Anthropic API, targeting rows marked as "Miscellaneous" by keyword matching.

### Streaming Neon Pipeline (neon_pipeline/)

A zero-local-storage variant for cloud deployment. Uses `lxml.iterparse` with a custom `_StreamReader` adapter that wraps the HTTP response as a file-like object. XML elements are parsed one at a time and immediately cleared from memory (`elem.clear()`), keeping RAM flat regardless of file size. Grants are streamed directly into Neon PostgreSQL (a serverless Postgres service).

## Classification Methodology

All grant records receive a classification label. Two classification methods exist:

### Keyword Classification (primary — no API required)

Used in `master_pipeline.py` and `standalone_pipeline/`. The combined text of four fields is checked against a compiled regex:

```
combined = RecipientName + Description + PrimarySubject + SupportStrategies
```

- **"Jews"** — combined text matches any keyword in the Jewish keyword list (whole-word, case-insensitive). Categories covered: identity terms (jew, jewish, judaism, hebrew), institutions (yeshiva, synagogue, chabad, JCC, hadassah), religious texts (torah, talmud), holidays (passover, hanukkah, yom kippur), places/history (jerusalem, holocaust, birthright), organizational names (jewish federation, american jewish).
- **"Non jews"** — text has meaningful content but no keyword match
- **"Miscellaneous"** — all fields are empty or N/A

### AI Classification (optional — requires Anthropic API key)

Used in `categorize_grants.py` and `irs_pipeline/ai_categorizer.py`. Sends recipient name + description to Claude via the Anthropic Messages API. Uses assistant-turn prefill (`{"`) to force raw JSON output. The model returns `{"expense_type": "...", "explanation": "..."}`. Retry logic handles rate limits and transient errors. Resume-safe — skips rows where Expense Type is already populated.

## Subject and Strategy Classification

Each grant record is also classified along two orthogonal dimensions using keyword lookup tables (no API needed):

**Primary Subject taxonomy:**
Education, Health, Housing, Employment, Arts and Culture, Food Security, Environment, Civil Rights, Religion, Human Services, Community Development

**Support Strategies taxonomy:**
Conferences and exhibits, Internships, Capacity building, Leadership and professional development, Core support, Research, Direct services, Capital projects

Classification uses first-match logic: the first matching keyword category wins.

## Why 9.7M Records and $550B+

These totals are cumulative across the 2019–2024 tax years in the IRS bulk dataset. "Grant amount" reflects what was reported on Schedule I as committed or authorized during the filing year. The figures are not double-counted across years — each filing covers one tax year. The $550B+ figure represents committed amounts across all grant types including cash grants, non-cash assistance, and program-related investments as reported by filers.
