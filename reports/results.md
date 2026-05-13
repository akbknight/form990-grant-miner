# Pipeline Results — IRS Form 990 Grant Extraction

## Extraction Summary (2019–2024)

| Metric | Value |
|--------|-------|
| ZIP archives processed | ~6,400 |
| XML filings parsed | ~1.6 million |
| Total grant records extracted | 9,693,767 |
| Total grant dollars | $550.2 billion |
| Jewish grant records | 275,446 |
| Jewish grant dollars | $10.6 billion |
| Records with EIN | ~6.8 million (70%) |
| Records with purpose text | ~5.8 million (60%) |

---

## Year-Over-Year Trend

| Year | Records | Dollars |
|------|---------|---------|
| 2019 | ~1.5M | ~$82B |
| 2020 | ~1.6M | ~$97B (COVID emergency giving) |
| 2021 | ~1.6M | ~$91B |
| 2022 | ~1.7M | ~$92B |
| 2023 | ~1.7M | ~$94B |
| 2024 | ~1.6M | ~$94B |

2020 shows elevated total dollars driven by emergency COVID relief grants from major foundations and donor-advised fund sponsors.

---

## Classification Performance

### Subject Classification (NTEE)
Approximately 65% of records have an NTEE code (via grantee EIN cross-reference with IRS Business Master File). The remaining 35% are classified from purpose text or remain in the "Other" category.

### Jewish Classification
- 2.84% of records by count classified as Jewish
- 1.93% by dollar volume
- Concentrated in: New York (38%), California (22%), Florida (11%)

---

## Pipeline Performance

- Full extraction run: 8–12 hours (I/O bound)
- Classification pass: ~45 minutes
- Aggregation and export: ~15 minutes
- Neon migration: ~90 minutes (network limited)
- Total end-to-end: ~12–16 hours

Incremental updates (adding a new tax year) require approximately 2–3 hours for the new year's data only.

---

## Data Quality Observations

1. **Amount accuracy**: Cross-checking spot samples against Candid (Foundation Center) published data shows <2% discrepancy in total dollar amounts, primarily from timing differences in data publication
2. **Grantee deduplication**: Same organization may appear with slightly different name spellings across years. Current pipeline does not deduplicate on name — EIN is the canonical identifier
3. **Schedule I omissions**: Some large foundations use separate foundation returns (990-PF) which have a different grant schedule structure; these are not captured in the current pipeline scope
