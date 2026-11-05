"""SQLite storage: users, login sessions and anonymous trials."""
from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS trials (
    key TEXT PRIMARY KEY,          -- 'ip:<hash>' or 'anon:<id>'
    started_at REAL NOT NULL
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # --- users -------------------------------------------------------------
    def create_user(self, email: str, password_hash: str) -> int:
        with self.connect() as conn:
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
                (email, password_hash, time.time()),
            )
            return int(cursor.lastrowid or 0)

    def find_user_by_email(self, email: str) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    def count_users(self) -> int:
        with self.connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])

    # --- sessions ----------------------------------------------------------
    def create_session(self, token_hash: str, user_id: int) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)",
                (token_hash, user_id, time.time()),
            )

    def user_for_session(self, token_hash: str) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute(
                "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()

    def delete_session(self, token_hash: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    # --- trials ------------------------------------------------------------
    def trial_started_at(self, keys: list[str]) -> float | None:
        """Earliest start across all keys, so clearing cookies does not reset the trial."""
        if not keys:
            return None
        placeholders = ",".join("?" for _ in keys)
        with self.connect() as conn:
            row = conn.execute(f"SELECT MIN(started_at) FROM trials WHERE key IN ({placeholders})", keys).fetchone()
            return float(row[0]) if row and row[0] is not None else None

    def start_trial(self, keys: list[str], started_at: float) -> None:
        with self.connect() as conn:
            conn.executemany(
                "INSERT OR IGNORE INTO trials (key, started_at) VALUES (?, ?)",
                [(key, started_at) for key in keys],
            )
