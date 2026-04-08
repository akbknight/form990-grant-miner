# form990-grant-miner

> End-to-end data mining pipeline for IRS Form 990 XML filings — extracts 9.7M+ grant records, classifies them as **Jewish / Non-Jewish / Miscellaneous** using pure Python keyword matching. No API. No AI service. No internet required after setup.

---

## What This Does

The IRS publishes every Form 990 (nonprofit tax return) as raw XML files bundled in ZIP archives. Each filing contains a **grant schedule** listing every grant the organization made — recipient name, amount, purpose, location.

This pipeline:
1. Reads all 62 ZIP archives (IRS TEOS data, tax years 2019–2026)
2. Parses each XML file and extracts grant records
3. Classifies every row using keyword matching
4. Outputs split Excel files (900k rows each) + a single Jewish grants master file
5. Builds a styled summary workbook with statistics

**Total records processed: 9,693,767 rows**

---

## Classification Logic

Every row is classified into one of three categories based on the combined text of: `Recipient Name + Description + Primary Subject + Support Strategies`

| Category | Meaning |
|----------|---------|
| **Jews** | Combined text contains one or more Jewish keywords (see full list below) |
| **Non jews** | Real content present but no Jewish keywords found |
| **Miscellaneous** | All fields are empty or N/A — insufficient data |

### Jewish Keywords (whole-word, case-insensitive)

| Category | Keywords |
|----------|---------|
| Identity | `jew`, `jewish`, `jews`, `judaism`, `hebrew`, `semitic`, `israel`, `israeli` |
| Institutions | `yeshiva`, `synagogue`, `shul`, `chabad`, `lubavitch`, `hillel`, `JCC`, `hadassah`, `B'nai`, `bnai` |
| Leadership | `rabbi`, `rabbinical` |
| Religious texts | `torah`, `talmud`, `kabbalah`, `kosher`, `kippah`, `yarmulke`, `mitzvah`, `shabbat`, `shabbos` |
| Life events | `bar mitzvah`, `bat mitzvah` |
| Holidays | `passover`, `pesach`, `hanukkah`, `chanukah`, `rosh hashanah`, `yom kippur`, `sukkot`, `purim` |
| Places / history | `jerusalem`, `zion`, `zionist`, `kibbutz`, `birthright`, `holocaust`, `shoah` |
| Cultural | `menorah`, `shalom`, `tikva`, `tikvah`, `mazel` |
| Org names | `jewish federation`, `jewish community`, `jewish family`, `jewish fund`, `jewish foundation`, `american jewish`, `united jewish`, `friends of israel`, `state of israel`, `american israel` |

> Classification is **fully auditable** — every "Jews" row contains one of the above words explicitly in the IRS filing text. No inference or AI judgment is used.

---

## Output Files

| File | Description |
|------|-------------|
| `Jewish_Grants_Master.xlsx` | All **270,294** Jewish-classified rows in one Excel file (20 MB) |
| `AI_Extracted_Data_Full_Part1.xlsx` … `Part11.xlsx` | Full 9.7M row dataset split into 900k-row parts |
| `AI_Extracted_Data_Current_Status.xlsx` | Summary workbook with statistics, data dictionary, classification methodology |
| `form990_master_output.csv` | Complete dataset, all rows, ~1.4 GB |
| `pipeline_progress.log` | Detailed extraction log |

> **Why split files?** Excel has a hard row limit of 1,048,576 rows. The full dataset (9.7M rows) requires 11 files. To work with all rows at once, connect to the CSV via Excel Power Query (Data → Get Data → From File → From CSV).

---

## Data Columns

| Column | Description |
|--------|-------------|
| Grantmaker Name | Legal name of the foundation filing Form 990 |
| Grantmaker State | U.S. state of the grantmaker |
| Recipient Name | Organization or person receiving the grant |
| Recipient City | City of the recipient |
| Recipient State/Country | State code or country of the recipient |
| Geography | `United States` for domestic; country name for international |
| Primary Subject | Auto-classified: Education / Health / Housing / Arts / Food Security / Employment / Environment / Civil Rights / Religion / Human Services |
| Tax Year | IRS tax year of the filing |
| Year Authorized | Year grant was authorized |
| Grant Amount | Dollar amount as stated on Form 990 |
| Support Strategies | Auto-classified: Capacity building / Core support / Conferences / Internships / Research / Direct services / Leadership development |
| Description | Grant purpose as written by the grantmaker on Form 990 |
| Expense Type | Classification: `Jews` / `Non jews` / `Miscellaneous` |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `master_pipeline.py` | **START HERE** — single script that runs the full pipeline end-to-end |
| `run_streaming_extractor.py` | ZIP-by-ZIP streaming extractor (resume-safe) |
| `classify_and_split.py` | Applies keyword classification + splits CSV into Excel parts |
| `create_jewish_master.py` | Builds `Jewish_Grants_Master.xlsx` from classified CSV |
| `categorize_grants.py` | Optional: AI-based classification using Anthropic API |
| `build_final_summary.py` | Rebuilds the summary workbook |
| `build_boss_excel.py` | Builds styled Excel deliverable |
| `categorize_keywords.py` | Standalone keyword-only classifier |
| `form990_to_excel.py` | Original extractor script |

---

## How to Run

### Requirements

```bash
pip install pandas openpyxl
```

No API key needed. No internet connection needed after installing packages.

### Run the full pipeline

```bash
.venv312\Scripts\python.exe master_pipeline.py
```

This single command does everything:
- Extracts all ZIP archives
- Classifies every row
- Writes the CSV
- Writes split Excel part files
- Writes `Jewish_Grants_Master.xlsx`
- Writes the summary workbook

### Resume after interruption

Just re-run the same command. The script checks how many rows are already in the CSV and skips completed work automatically.

### Configuration

Edit the top of `master_pipeline.py` to change source folders or output paths:

```python
ZIP_SOURCE_FOLDERS = [
    os.path.join(BASE_DIR, "Form 990"),
    os.path.join(BASE_DIR, "your_other_folder"),
]
```

---

## Data Source

**IRS TEOS — Tax Exempt Organization Search**
https://www.irs.gov/charities-non-profits/tax-exempt-organization-search

Form 990 XML filings are published publicly by the IRS. Data covers tax years 2019–2026.

---

## Results Summary

| Metric | Value |
|--------|-------|
| Total rows extracted | 9,693,767 |
| Jewish-classified rows | 270,294 (2.79%) |
| Non-Jewish rows | 9,419,873 (97.17%) |
| Miscellaneous | 3,600 (0.04%) |
| ZIP archives processed | 62 of 62 (100%) |
| Tax years covered | 2019 – 2026 |
