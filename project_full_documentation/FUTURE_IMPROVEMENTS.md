# Future Improvements

## 1. Consolidate parsing and classification into a single shared library

The highest-value technical improvement is to remove duplicate XML parsing and classification logic from the root scripts, `standalone_pipeline/`, and `irs_db/parser.py`.

Recommended direction:

- one canonical parser package,
- one canonical classification module,
- thin wrappers for each workflow.

## 2. Standardize the source acquisition layer

Some modules use the IRS TEOS ZIP path and others still assume legacy S3 endpoints.

Recommended direction:

- one current IRS source adapter,
- one manifest format,
- explicit deprecation of stale source paths.

## 3. Turn the repository into an installable package with a unified CLI

Current execution is split across many scripts. A unified CLI would reduce operator confusion.

Recommended direction:

- package structure with entry points,
- commands such as `extract`, `download`, `categorize`, `dashboard`, `cleanup`, and `export`,
- consistent configuration loading across all commands.

## 4. Add real integration tests

The current tests are useful but narrow.

Recommended additions:

- fixture-based XML parsing tests,
- SQLite integration tests,
- PostgreSQL integration tests,
- dashboard query tests,
- cleanup dry-run and deletion tests.

## 5. Add schema migration management

The PostgreSQL and SQLite schemas are mostly managed directly in code.

Recommended direction:

- database migration tooling,
- versioned schema changes,
- documented upgrade path.

## 6. Improve dashboard deployment posture

If the dashboard is ever exposed beyond a trusted local machine, it needs a stronger deployment model.

Recommended additions:

- authentication and authorization,
- reverse proxy and TLS,
- environment-specific config,
- metrics and request logging,
- access controls around downloadable data.

## 7. Add data quality and observability

Recommended additions:

- duplicate-rate metrics,
- parse failure rates,
- missing-field dashboards,
- extraction audit summaries per ZIP and per filing year,
- retention and freshness monitoring.

## 8. Separate source code from heavy data artifacts more formally

The current cleanup already moved in this direction.

Recommended next step:

- keep code in Git,
- keep databases in Git LFS or object storage,
- keep reproducible raw data in a documented external archive location.

## 9. Containerize the main runtime surfaces

Recommended targets:

- dashboard container,
- extraction worker container,
- PostgreSQL-backed pipeline container.

This would make handoff and redeployment much simpler.

## 10. Introduce CI and repository hygiene controls

Recommended additions:

- GitHub Actions or equivalent CI,
- linting and formatting,
- unit and integration test gates,
- secret scanning,
- large-file policy enforcement.
