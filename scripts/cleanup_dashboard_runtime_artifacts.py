"""Delete raw artifacts not needed for the current dashboard runtime.

Default mode is a dry run. Destructive mode only removes validated artifact
paths under ``workspace_data`` plus the tiny root Streamlit logs. The dashboard
SQLite databases are preserved.
"""

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from project_utils.paths import (
    FORM_990_DIR,
    LOG_DIR,
    ONEDRIVE_MIRROR_DIR,
    PIPELINE_DATA_DIR,
    PROJECT_ROOT,
    STANDALONE_DB_PATH,
    WAREHOUSE_DB_PATH,
)


@dataclass
class RemovalItem:
    """One file or directory selected for cleanup."""

    path: str
    kind: str
    size_bytes: int
    reason: str
    deleted_at_utc: str | None = None


ROOT_LOG_FILES = [
    PROJECT_ROOT / "streamlit-dashboard.log",
    PROJECT_ROOT / "streamlit-dashboard.err.log",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Preview or delete raw ZIP inputs, temp folders, and logs that are "
            "not needed for the current dashboard runtime."
        )
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help='Perform deletion. Requires --confirm DELETE.',
    )
    parser.add_argument(
        "--confirm",
        default="",
        help='Confirmation text for delete mode. Must be exactly "DELETE".',
    )
    parser.add_argument(
        "--report-path",
        default="",
        help="Optional JSON report path. Defaults under workspace_data/logs.",
    )
    return parser.parse_args()


def bytes_for_path(path: Path) -> int:
    """Return total bytes occupied by a file or directory."""
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    return sum(child.stat().st_size for child in path.rglob("*") if child.is_file())


def ensure_workspace_target(path: Path) -> None:
    """Refuse to operate outside the project workspace."""
    resolved = path.resolve(strict=False)
    if PROJECT_ROOT not in resolved.parents and resolved != PROJECT_ROOT:
        raise SystemExit(f"Refusing to touch path outside project workspace: {resolved}")


def build_candidates() -> list[RemovalItem]:
    """Return validated raw artifact targets safe to remove for dashboard use."""
    dashboard_db_evidence = []
    for db_path in (WAREHOUSE_DB_PATH, STANDALONE_DB_PATH):
        if db_path.exists():
            dashboard_db_evidence.append(db_path)

    if not dashboard_db_evidence:
        raise SystemExit("No dashboard SQLite database found; refusing cleanup.")

    candidates: list[RemovalItem] = []

    if FORM_990_DIR.exists():
        candidates.append(
            RemovalItem(
                path=str(FORM_990_DIR),
                kind="dir",
                size_bytes=bytes_for_path(FORM_990_DIR),
                reason=(
                    "Raw ZIP source archive folder. Dashboard reads SQLite databases, "
                    "not ZIP inputs."
                ),
            )
        )

    if ONEDRIVE_MIRROR_DIR.exists():
        candidates.append(
            RemovalItem(
                path=str(ONEDRIVE_MIRROR_DIR),
                kind="dir",
                size_bytes=bytes_for_path(ONEDRIVE_MIRROR_DIR),
                reason=(
                    "Mirror/error-sync artifact folder. Not used by the dashboard at runtime."
                ),
            )
        )

    if PIPELINE_DATA_DIR.exists():
        candidates.append(
            RemovalItem(
                path=str(PIPELINE_DATA_DIR),
                kind="dir",
                size_bytes=bytes_for_path(PIPELINE_DATA_DIR),
                reason=(
                    "Temporary/local pipeline cache folders. Not required once SQLite "
                    "databases already exist."
                ),
            )
        )

    if LOG_DIR.exists():
        candidates.append(
            RemovalItem(
                path=str(LOG_DIR),
                kind="dir",
                size_bytes=bytes_for_path(LOG_DIR),
                reason="Operational logs. Not required for dashboard runtime.",
            )
        )

    for path in ROOT_LOG_FILES:
        if path.exists():
            candidates.append(
                RemovalItem(
                    path=str(path),
                    kind="file",
                    size_bytes=bytes_for_path(path),
                    reason="Transient Streamlit launch log. Not required for dashboard runtime.",
                )
            )

    return candidates


def delete_item(item: RemovalItem) -> None:
    """Delete one validated file or directory."""
    path = Path(item.path)
    ensure_workspace_target(path)
    if not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()
    item.deleted_at_utc = datetime.now(timezone.utc).isoformat()


def default_report_path() -> Path:
    """Write the cleanup report outside the deleted logs folder."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return PROJECT_ROOT / f"dashboard_runtime_cleanup_{stamp}.json"


def write_report(path: Path, payload: dict) -> None:
    """Persist JSON cleanup metadata."""
    ensure_workspace_target(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def format_bytes(size_bytes: int) -> str:
    """Return a readable byte size string."""
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size_bytes)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.2f} {unit}"
        value /= 1024
    return f"{size_bytes} B"


def main() -> int:
    args = parse_args()
    destructive = bool(args.delete)
    if destructive and args.confirm != "DELETE":
        raise SystemExit('Delete mode requires --confirm DELETE')

    candidates = build_candidates()
    deleted: list[RemovalItem] = []
    for item in candidates:
        if destructive:
            delete_item(item)
            deleted.append(item)

    report_path = Path(args.report_path).expanduser() if args.report_path else default_report_path()
    report_payload = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "dry_run": not destructive,
        "dashboard_databases_retained": [
            str(path)
            for path in (WAREHOUSE_DB_PATH, STANDALONE_DB_PATH)
            if path.exists()
        ],
        "summary": {
            "candidate_count": len(candidates),
            "deleted_count": len(deleted),
            "candidate_bytes": sum(item.size_bytes for item in candidates),
            "deleted_bytes": sum(item.size_bytes for item in deleted),
        },
        "candidates": [asdict(item) for item in candidates],
        "deleted": [asdict(item) for item in deleted],
    }
    write_report(report_path, report_payload)

    print(f"Dry run: {not destructive}")
    print("Dashboard databases retained:")
    for path in report_payload["dashboard_databases_retained"]:
        print(f"  - {path}")
    print(
        f"Candidates: {len(candidates)} "
        f"({format_bytes(sum(item.size_bytes for item in candidates))})"
    )
    for item in candidates:
        print(f"  - {item.path}")
        print(f"      * {item.reason}")
    print(
        f"Deleted: {len(deleted)} "
        f"({format_bytes(sum(item.size_bytes for item in deleted))})"
    )
    print(f"Report written: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
