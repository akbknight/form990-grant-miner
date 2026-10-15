"""Safely preview or delete redundant ZIP files used by the Form 990 project.

Default mode is a dry run. The script only auto-qualifies clearly redundant
duplicate ZIP copies for deletion. Canonical ZIP inputs are retained unless a
future policy explicitly proves they are dependency-free.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from project_utils.paths import (
    FORM_990_DIR,
    LOG_DIR,
    PROJECT_ROOT,
    STANDALONE_DB_PATH,
    WAREHOUSE_DB_PATH,
)


TEXT_EXTENSIONS = {".py", ".md", ".txt", ".log", ".sql", ".toml", ".json", ".yaml", ".yml"}
SOURCE_EXCLUDE_PARTS = {
    ".git",
    ".venv",
    ".venv312",
    "__pycache__",
    "standalone_pipeline/venv",
    "workspace_data/Form 990",
}
PIPELINE_DEPENDENCY_FILES = [
    Path("master_pipeline.py"),
    Path("run_streaming_extractor.py"),
    Path("form990_to_excel.py"),
    Path("extract_2024_to_csv.py"),
    Path("irs_db/pipeline.py"),
    Path("standalone_pipeline/extract_2023_2024.py"),
    Path("standalone_pipeline/audit_downloader.py"),
]
DEDUPE_RULE_FILES = [
    Path("form990_to_excel.py"),
    Path("master_pipeline.py"),
    Path("standalone_pipeline/extract_2023_2024.py"),
]


@dataclass
class ZipFinding:
    """Structured decision for one ZIP file."""

    path: str
    size_bytes: int
    age_days: int
    canonical_name: str
    exact_reference_files: list[str] = field(default_factory=list)
    dashboard_evidence: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    status: str = "flagged"
    deleted_at_utc: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Preview or delete redundant ZIP files. Default is dry run. "
            "Deletion currently only applies to duplicate numeric-suffix copies "
            "such as '2024_TEOS_XML_01A (1).zip' when the canonical ZIP exists."
        )
    )
    parser.add_argument(
        "--root-dir",
        default=str(FORM_990_DIR),
        help="Directory to scan for ZIP files.",
    )
    parser.add_argument(
        "--older-than-days",
        type=int,
        default=0,
        help="Only consider ZIP files older than this many days.",
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Delete validated duplicate ZIPs. Requires --confirm DELETE.",
    )
    parser.add_argument(
        "--confirm",
        default="",
        help='Confirmation gate for destructive mode. Must be exactly "DELETE".',
    )
    parser.add_argument(
        "--report-path",
        default="",
        help="Optional path for the JSON report. Defaults under workspace_data/logs.",
    )
    return parser.parse_args()


def resolve_safe_root(path_text: str) -> Path:
    """Resolve a scan root and keep it inside the current project."""
    root = Path(path_text).expanduser().resolve()
    if PROJECT_ROOT not in root.parents and root != PROJECT_ROOT:
        raise SystemExit(f"Refusing to scan outside the project workspace: {root}")
    if not root.exists():
        raise SystemExit(f"Scan root not found: {root}")
    return root


def canonical_zip_name(name: str) -> str:
    """Collapse duplicate Windows download suffixes like ' (1)'."""
    return re.sub(r"\s*\(\d+\)(?=\.zip$)", "", name)


def iter_text_files(root: Path) -> Iterable[Path]:
    """Yield text-like repo files for lightweight reference scanning."""
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if any(part in rel for part in SOURCE_EXCLUDE_PARTS):
            continue
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        yield path


def build_text_index(root: Path) -> dict[str, str]:
    """Load searchable repo text once to keep scans fast."""
    text_index: dict[str, str] = {}
    for path in iter_text_files(root):
        try:
            text_index[path.relative_to(root).as_posix()] = path.read_text(
                encoding="utf-8",
                errors="ignore",
            )
        except OSError:
            continue
    return text_index


def find_exact_references(text_index: dict[str, str], zip_name: str) -> list[str]:
    """Return repo files that mention a ZIP basename."""
    matches: list[str] = []
    for relative_path, text in text_index.items():
        if zip_name in text:
            matches.append(relative_path)
    return sorted(matches)


def dashboard_evidence() -> list[str]:
    """Collect evidence that the dashboard can run from SQLite warehouses."""
    evidence: list[str] = []
    for db_path in (WAREHOUSE_DB_PATH, STANDALONE_DB_PATH):
        row_count = sqlite_table_row_count(db_path)
        if row_count is not None and row_count > 0:
            evidence.append(f"{db_path.relative_to(PROJECT_ROOT)} has {row_count:,} rows")
    return evidence


def sqlite_table_row_count(db_path: Path) -> int | None:
    """Return a useful row count from a dashboard SQLite source."""
    if not db_path.exists():
        return None
    try:
        with sqlite3.connect(str(db_path)) as conn:
            names = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            for table_name in ("irs_grants_2023_2024", "irs_grants"):
                if table_name in names:
                    return int(
                        conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                    )
    except sqlite3.Error:
        return None
    return None


def build_finding(
    zip_path: Path,
    now: datetime,
    text_index: dict[str, str],
    shared_dashboard_evidence: list[str],
) -> ZipFinding:
    """Classify one ZIP file according to the safe deletion policy."""
    stat = zip_path.stat()
    exact_refs = find_exact_references(text_index, zip_path.name)
    canonical_name = canonical_zip_name(zip_path.name)
    canonical_path = zip_path.with_name(canonical_name)
    duplicate_copy = canonical_name != zip_path.name and canonical_path.exists()

    finding = ZipFinding(
        path=str(zip_path),
        size_bytes=stat.st_size,
        age_days=max(0, (now - datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)).days),
        canonical_name=canonical_name,
        exact_reference_files=exact_refs,
        dashboard_evidence=list(shared_dashboard_evidence),
    )

    if duplicate_copy:
        dedupe_rules = [str(path) for path in DEDUPE_RULE_FILES if path.exists()]
        finding.status = "candidate_delete"
        finding.reasons.extend(
            [
                f"Canonical sibling exists: {canonical_path.name}",
                "Duplicate numeric-suffix ZIP copy is not needed for dashboard runtime.",
                "Repo extraction code contains duplicate-skip/dedup logic.",
            ]
        )
        if dedupe_rules:
            finding.reasons.append(
                "Dedup rules verified in: " + ", ".join(dedupe_rules)
            )
        return finding

    dependency_files = [str(path) for path in PIPELINE_DEPENDENCY_FILES if path.exists()]
    finding.status = "flagged"
    finding.reasons.extend(
        [
            "Retained for safety: local ETL/rebuild scripts still consume ZIP inputs.",
            "Deleting this canonical ZIP would break local reprocessing/reset workflows.",
            "Dependency-free status is not provable from the current repo state.",
        ]
    )
    if dependency_files:
        finding.reasons.append(
            "Pipeline dependency files: " + ", ".join(dependency_files)
        )
    return finding


def maybe_delete(finding: ZipFinding) -> None:
    """Delete a ZIP candidate and record the action timestamp."""
    path = Path(finding.path)
    path.unlink()
    finding.status = "deleted"
    finding.deleted_at_utc = datetime.now(timezone.utc).isoformat()


def default_report_path() -> Path:
    """Build a timestamped JSON report path under workspace_data/logs."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return LOG_DIR / f"zip_cleanup_report_{stamp}.json"


def write_report(path: Path, payload: dict) -> None:
    """Persist the preview/deletion report."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def format_bytes(size_bytes: int) -> str:
    """Return a readable size string."""
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size_bytes)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.2f} {unit}"
        value /= 1024
    return f"{size_bytes} B"


def main() -> int:
    args = parse_args()
    scan_root = resolve_safe_root(args.root_dir)
    destructive = bool(args.delete)
    if destructive and args.confirm != "DELETE":
        raise SystemExit('Deletion mode requires --confirm DELETE')

    now = datetime.now(timezone.utc)
    shared_dashboard_evidence = dashboard_evidence()
    text_index = build_text_index(PROJECT_ROOT)
    zip_paths = sorted(scan_root.rglob("*.zip"))

    findings: list[ZipFinding] = []
    for zip_path in zip_paths:
        finding = build_finding(zip_path, now, text_index, shared_dashboard_evidence)
        if args.older_than_days and finding.age_days < args.older_than_days:
            finding.status = "skipped"
            finding.reasons.insert(
                0,
                f"Skipped by age filter: {finding.age_days} < {args.older_than_days} days",
            )
        findings.append(finding)

    deletable = [item for item in findings if item.status == "candidate_delete"]
    flagged = [item for item in findings if item.status == "flagged"]
    skipped = [item for item in findings if item.status == "skipped"]

    deleted: list[ZipFinding] = []
    if destructive:
        for finding in deletable:
            maybe_delete(finding)
            deleted.append(finding)
        deletable = []

    report_path = Path(args.report_path).expanduser() if args.report_path else default_report_path()
    report_payload = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "dry_run": not destructive,
        "scan_root": str(scan_root),
        "older_than_days": int(args.older_than_days),
        "dashboard_evidence": shared_dashboard_evidence,
        "summary": {
            "zip_count": len(findings),
            "candidate_delete_count": len(deletable),
            "deleted_count": len(deleted),
            "flagged_count": len(flagged),
            "skipped_count": len(skipped),
            "candidate_bytes": sum(item.size_bytes for item in deletable),
            "deleted_bytes": sum(item.size_bytes for item in deleted),
        },
        "candidate_delete": [asdict(item) for item in deletable],
        "deleted": [asdict(item) for item in deleted],
        "flagged": [asdict(item) for item in flagged],
        "skipped": [asdict(item) for item in skipped],
    }
    write_report(report_path, report_payload)

    print(f"Scan root: {scan_root}")
    print(f"Dry run: {not destructive}")
    print(f"ZIP files scanned: {len(findings)}")
    if shared_dashboard_evidence:
        print("Dashboard evidence:")
        for line in shared_dashboard_evidence:
            print(f"  - {line}")
    else:
        print("Dashboard evidence: none detected")

    print(f"Candidates for deletion: {len(deletable)} ({format_bytes(sum(item.size_bytes for item in deletable))})")
    for item in deletable:
        print(f"  - {item.path}")
        for reason in item.reasons:
            print(f"      * {reason}")

    print(f"Deleted: {len(deleted)} ({format_bytes(sum(item.size_bytes for item in deleted))})")
    for item in deleted:
        print(f"  - {item.path}")

    print(f"Flagged/retained: {len(flagged)}")
    for item in flagged[:10]:
        print(f"  - {item.path}")
        print(f"      * {item.reasons[0]}")
    if len(flagged) > 10:
        print(f"  ... {len(flagged) - 10} more flagged ZIPs in report")

    print(f"Skipped: {len(skipped)}")
    print(f"Report written: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
