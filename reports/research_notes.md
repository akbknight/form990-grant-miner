# Research Notes — IRS Form 990 Grant Extraction Pipeline

## IRS Data Infrastructure

### Bulk Data Access
The IRS provides Form 990 XML filings as bulk downloads at:
- `https://apps.irs.gov/pub/epostcard/990/` — official IRS endpoint
- `s3://irs-form-990/` — AWS S3 public dataset (faster, no rate limits)

Filings are organized by tax year. Each year is split into multiple ZIP archives. Total corpus for 2013–2024: approximately 600 GB uncompressed. The pipeline uses the AWS S3 endpoint for its reliability and download throughput.

### Filing Volume by Year (approximate)
- 2019: ~280,000 990 filings
- 2020: ~240,000 (reduced due to IRS deadline extensions during COVID)
- 2021: ~290,000
- 2022: ~310,000
- 2023: ~330,000
- 2024: ~350,000 (partial year at extraction time)

Not all filings contain Schedule I (grants). Organizations with no grant-making in the year omit Schedule I. Approximately 15–25% of 990 filers include a Schedule I with qualifying grants.

---

## Schedule I: Field Quality Issues

Field quality varies considerably across filers:

**`PurposeOfGrantTxt`**: This field is theoretically required but is often filled with generic text ("general charitable purposes", "see attached") that carries no classification signal. Approximately 40% of records have informative purpose text; the remainder require classification from other signals.

**`EINOfRecipient`**: Provided for approximately 70% of records. Missing EINs prevent cross-referencing with the IRS Business Master File for NTEE codes.

**Amount fields**: Two elements carry the grant amount (`CashGrantAmt` and `Amt`) — the pipeline checks both, taking the non-null value. Occasionally both are populated with different values; the pipeline takes `CashGrantAmt` as authoritative.

---

## Scale Engineering Notes

Processing 9.7 million grant records from approximately 1.6 million ZIP-contained XML files required:

1. **Streaming extraction**: XML files are parsed and records inserted to SQLite without loading entire ZIPs into memory
2. **Batch inserts**: Records are buffered in-memory and inserted in batches of 1,000 to minimize SQLite transaction overhead
3. **Resumption state**: The downloader tracks processed ZIP files to allow pipeline restart without reprocessing
4. **Index design**: SQLite indexes on `grantee_state`, `tax_year`, and `is_jewish` support the aggregation queries without full scans

Total pipeline runtime for the full 2019–2024 corpus: approximately 8–12 hours on a standard laptop (I/O bound, not CPU bound).

---

## Jewish Philanthropic Sector: Classification Precision

The keyword classification was validated against a manually curated sample of 500 records. Results:
- Precision (of classified-as-Jewish records, % truly Jewish): ~94%
- Recall (of truly Jewish records, % captured by classifier): ~78%

The recall gap is primarily from major foundations with secular names. This is a known limitation documented in `docs/methodology.md`.
