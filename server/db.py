"""SQLite connection + migration runner for Flowdesk.

Migrations are plain SQL files in ../migrations, applied in filename order
and tracked in the schema_migrations table.
"""
from __future__ import annotations

import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATIONS_DIR = os.path.join(BASE_DIR, "migrations")
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "data", "flowdesk.db")

SCHEMA_VERSIONS = (
    "users",
    "customers",
    "conversations",
    "messages",
    "leads",
    "products",
    "inventory",
    "orders",
    "order_items",
    "deliveries",
    "analytics_events",
)

_db_path_override: str | None = None


def set_db_path(path: str | None) -> None:
    """Pin the database path for every subsequent get_db() call in this process."""
    global _db_path_override
    _db_path_override = path


def get_db(db_path: str | None = None) -> sqlite3.Connection:
    """Open a connection with sane defaults (row access, FK enforcement, WAL)."""
    path = db_path or _db_path_override or os.environ.get("FLOWDESK_DB", DEFAULT_DB_PATH)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def applied_migrations(conn: sqlite3.Connection) -> set[str]:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"""
    )
    rows = conn.execute("SELECT name FROM schema_migrations").fetchall()
    return {row["name"] for row in rows}


def init_db(db_path: str | None = None) -> list[str]:
    """Apply all pending migrations in order; returns the list applied this run."""
    if db_path is None:
        db_path = os.environ.get("FLOWDESK_DB", DEFAULT_DB_PATH)
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    conn = get_db(db_path)
    try:
        applied = applied_migrations(conn)
        pending = [
            name
            for name in sorted(os.listdir(MIGRATIONS_DIR))
            if name.endswith(".sql") and name not in applied
        ]
        for name in pending:
            sql = os.path.join(MIGRATIONS_DIR, name)
            with open(sql, "r", encoding="utf-8") as handle:
                conn.executescript(handle.read())
            conn.execute(
                "INSERT INTO schema_migrations (name) VALUES (?)", (name,)
            )
        conn.commit()
        return pending
    finally:
        conn.close()


def table_names(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).fetchall()
    return [row["name"] for row in rows]