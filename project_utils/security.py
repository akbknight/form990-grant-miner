"""Security and configuration helpers shared across the repository."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def getenv_str(name: str, default: str = "") -> str:
    """Return a stripped environment variable value."""
    return os.getenv(name, default).strip()


def require_env(name: str, *, example: str | None = None) -> str:
    """Return an environment variable or raise a clear runtime error."""
    value = getenv_str(name)
    if value:
        return value

    message = [f"Environment variable {name} is required."]
    if example:
        message.append(f"Example: {example}")
    raise RuntimeError(" ".join(message))


def redact_dsn(dsn: str) -> str:
    """Mask credentials in a DSN before logging it."""
    value = (dsn or "").strip()
    if not value:
        return "<not set>"

    try:
        parsed = urlsplit(value)
    except ValueError:
        return "<invalid dsn>"

    if not parsed.scheme or not parsed.netloc:
        return value

    hostname = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    username = parsed.username or ""

    if username:
        netloc = f"{username}:***@{hostname}{port}"
    else:
        netloc = f"{hostname}{port}"

    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def sqlite_readonly_uri(path: Path) -> str:
    """Build a read-only SQLite URI for dashboard-style consumers."""
    resolved = Path(path).resolve().as_posix()
    return f"file:{resolved}?mode=ro"

