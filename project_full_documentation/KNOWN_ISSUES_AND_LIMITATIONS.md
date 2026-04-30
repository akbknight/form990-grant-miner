# Known Issues and Limitations

## 1. Raw source archives were intentionally removed

On April 24, 2026, the raw ZIP source folders were deleted to save space. This means:

- local rebuilds from prior ZIP inventories cannot run immediately,
- historical extraction runs are reproducible only after re-downloading the IRS source archives,
- some legacy scripts still point to paths that no longer exist in the current snapshot.

## 2. The retained standalone pipeline database is not a full analytical store right now

`workspace_data/databases/irs990_pipeline.db` currently contains:

- `4,244,922` rows in `irs_manifest`,
- `0` rows in `irs_grants`,
- `0` rows in `ai_cache`.

Practical implication:

- it is useful as orchestration history,
- it is not currently the main dashboard dataset.

## 3. Tax-year semantics and ZIP-year semantics are not the same thing

Several scripts are organized around filing bundle years such as `2024_TEOS_XML_*.zip`. That does not guarantee every extracted record has `tax_year = 2024`.

Practical implication:

- users should distinguish between source bundle year and parsed `tax_year`,
- filters should always be applied at the data-column level, not inferred from filename alone.

## 4. Logic duplication remains significant

XML parsing, geography derivation, subject derivation, and classification rules appear in several places:

- root scripts,
- `irs_db/parser.py`,
- `standalone_pipeline/extractor.py`,
- `standalone_pipeline/extract_2023_2024.py`.

Practical implication:

- bug fixes in one parser do not automatically propagate everywhere,
- behavior may drift across workflows.

## 5. Neon pipeline is likely stale

`neon_pipeline/` still references legacy IRS S3 endpoints. That branch should be treated as experimental and likely requires rework before current production use.

## 6. Standalone pipeline import style is fragile

The `standalone_pipeline/` scripts use local imports such as `import config` and `from db_sqlite import ...`.

Practical implication:

- running them with `python -m standalone_pipeline...` is not consistently safe,
- the safest execution pattern is from inside the `standalone_pipeline` directory.

## 7. Test coverage is narrow

The automated tests currently cover only:

- DSN redaction,
- export filter parsing.

Missing coverage areas include:

- XML parsing correctness,
- SQLite/PostgreSQL integration,
- dashboard query behavior,
- cleanup script edge cases,
- end-to-end pipeline orchestration.

## 8. The dashboard is safe for trusted local use, not fully production-hardened for internet exposure

Good current properties:

- read-only SQLite access,
- parameterized filters,
- no ad hoc SQL UI,
- no secret display.

Remaining limitation:

- there is no application authentication, authorization, or reverse-proxy hardening in the repository.

## 9. GitHub publishing of the retained databases requires large-file handling

The two retained `.db` files are approximately:

- `1.23 GB` for `irs990_2023_2024.db`
- `0.92 GB` for `irs990_pipeline.db`

Plain GitHub pushes will reject these files. They require Git LFS or an external artifact storage approach.

## 10. The current git worktree is not a clean source of truth

The local repository has a dirty worktree and staged historical artifact noise, including prior references to removed ZIPs and a tracked virtual environment path under `standalone_pipeline/venv`.

Practical implication:

- do not trust `git status` in the current repo as a clean publishing boundary,
- create a clean archival snapshot when publishing.

## 11. SQLite sidecar files are ephemeral

Files ending in `-shm` and `-wal` are runtime sidecars. They can appear and disappear when the databases are opened.

Practical implication:

- they should not be treated as canonical project outputs,
- publishing only the main `.db` files is usually sufficient.
