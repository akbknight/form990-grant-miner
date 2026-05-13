# Decision Log — IRS Form 990 Grant Extraction Pipeline

## Decision 1: ElementTree over lxml for XML parsing

**Decision:** Use Python's built-in `xml.etree.ElementTree` for parsing IRS 990 XML files rather than lxml or a custom XML library.

**Rationale:** ElementTree is sufficient for the IRS 990 XML schema, which uses a flat-ish structure without complex namespaced XPath requirements. lxml's performance advantage is meaningful for very large XML documents; individual 990 filings are small (10–500KB). The zero-dependency approach eliminates installation friction across different environments.

**Tradeoff:** ElementTree is slower than lxml for large documents and has less expressive XPath support. For the IRS use case neither is a bottleneck — the I/O cost of downloading and decompressing ZIPs dwarfs the parse time.

---

## Decision 2: Dual-schema handling for Schedule I variants

**Decision:** The extractor checks both `GrantOrContributionPdDurYrGrp` and `RecipientTableGrp` element paths for every filing rather than branching by filing year.

**Rationale:** The IRS schema changed the Schedule I element name across filing years, but the transition was not clean — some older organizations continued filing with the pre-2014 schema for years after the official change. Year-based branching would miss these. Checking both paths and taking whichever has records is more robust.

**Tradeoff:** Slightly more parse work per filing. Not measurable at scale.

---

## Decision 3: SQLite for local storage, Neon for production

**Decision:** Use SQLite as the local extraction and intermediate storage layer, with `sqlite_to_postgres.py` to migrate to Neon (managed PostgreSQL) for production queries.

**Rationale:** SQLite requires no server, no credentials, and no configuration — ideal for the extraction phase where the pipeline runs locally against downloaded ZIPs. Once extraction is complete and data is validated locally, migrating to Neon enables multi-user access, complex queries, and a stable connection for dashboard use.

**Tradeoff:** The two-database architecture adds a migration step. The benefit is that local extraction is robust to network failures and doesn't require a cloud database connection during the compute-intensive parsing phase.

---

## Decision 4: Keyword classification over ML for Jewish identification

**Decision:** Classify Jewish philanthropic organizations via a curated keyword list rather than training a text classifier.

**Rationale:** A text classifier would require labeled training data, validation set curation, and ongoing monitoring. The keyword list is auditable, reproducible, and sufficient for the task: Jewish organizational names follow predictable patterns (Hebrew terms, federation naming conventions, well-known foundation names). The error rate is acceptable given that the analysis is used for macro-level trend analysis, not individual grant adjudication.

**Tradeoff:** Name-based classification misses organizations with secular names and over-classifies coincidental matches. Documented in methodology.md.

---

## Decision 5: Multiple output formats (SQLite, Excel, JSON, Postgres)

**Decision:** Support multiple export formats rather than standardizing on a single output.

**Rationale:** Different consumers need different formats. The dashboard needs pre-computed JSON. Stakeholders need Excel. The production query layer needs Postgres. Building format-specific export scripts (`export_to_excel.py`, `build_boss_excel.py`, `sqlite_to_postgres.py`) keeps each consumer's output clean without contaminating the core pipeline with format-specific logic.

**Tradeoff:** More scripts to maintain. Justified by the fact that the formats serve genuinely different consumers with different tooling requirements.
