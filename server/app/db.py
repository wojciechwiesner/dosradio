"""SQLite storage: users, login sessions, anonymous trials and Plus news preferences."""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SECONDS_PER_DAY = 86400

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at REAL NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 1,
    verify_token_hash TEXT,
    verify_expires REAL,
    plan TEXT NOT NULL DEFAULT 'free',
    plus_until REAL
);
CREATE TABLE IF NOT EXISTS news_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    keywords TEXT NOT NULL DEFAULT '[]',
    rss_feeds TEXT NOT NULL DEFAULT '[]',
    updated_at REAL NOT NULL DEFAULT 0
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
CREATE TABLE IF NOT EXISTS aired_items (
    user_id INTEGER NOT NULL REFERENCES users(id),
    day TEXT NOT NULL,
    item_id TEXT NOT NULL,
    PRIMARY KEY (user_id, day, item_id)
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            self._migrate(conn)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        """Add email verification columns to databases created before v1.1.0."""
        columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        if "email_verified" not in columns:
            # Pre-verification users are treated as already verified.
            conn.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1")
        if "verify_token_hash" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN verify_token_hash TEXT")
        if "verify_expires" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN verify_expires REAL")
        if "plan" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'")
        if "plus_until" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN plus_until REAL")

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

    # --- email verification --------------------------------------------------
    def set_email_verification(self, user_id: int, token_hash: str, expires_at: float) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE users SET email_verified = 0, verify_token_hash = ?, verify_expires = ? WHERE id = ?",
                (token_hash, expires_at, user_id),
            )

    def find_user_by_verify_token(self, token_hash: str) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute(
                "SELECT * FROM users WHERE verify_token_hash = ? AND email_verified = 0",
                (token_hash,),
            ).fetchone()

    def verify_email(self, user_id: int) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE users SET email_verified = 1, verify_token_hash = NULL, verify_expires = NULL WHERE id = ?",
                (user_id,),
            )

    def grant_welcome_plus(self, user_id: int, days: int) -> None:
        """Give a free account `days` of Plus; paid or unlimited plans are never touched."""
        with self.connect() as conn:
            conn.execute(
                "UPDATE users SET plan = 'plus', plus_until = ? WHERE id = ? AND plan = 'free'",
                (time.time() + days * SECONDS_PER_DAY, user_id),
            )

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

    # --- news preferences (Plus) ---------------------------------------------
    def set_news_preferences(self, user_id: int, keywords: list[str], rss_feeds: list[str]) -> float:
        updated_at = time.time()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO news_preferences (user_id, keywords, rss_feeds, updated_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET keywords=excluded.keywords, "
                "rss_feeds=excluded.rss_feeds, updated_at=excluded.updated_at",
                (user_id, json.dumps(keywords, ensure_ascii=False), json.dumps(rss_feeds), updated_at),
            )
        return updated_at

    def get_news_preferences(self, user_id: int) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT keywords, rss_feeds, updated_at FROM news_preferences WHERE user_id = ?", (user_id,)
            ).fetchone()
        if row is None:
            return None
        return {
            "keywords": json.loads(row["keywords"]),
            "rss_feeds": json.loads(row["rss_feeds"]),
            "updated_at": float(row["updated_at"]),
        }

    def all_news_preferences(self) -> list[tuple[int, dict]]:
        """Every stored preference row (for the hourly personalized digest cycle)."""
        with self.connect() as conn:
            rows = conn.execute("SELECT user_id, keywords, rss_feeds FROM news_preferences").fetchall()
        return [
            (int(row["user_id"]), {"keywords": json.loads(row["keywords"]), "rss_feeds": json.loads(row["rss_feeds"])})
            for row in rows
        ]

    # --- ramówka aired items (nothing repeats within a day) -----------------
    def aired_ids(self, user_id: int, day: str) -> list[str]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT item_id FROM aired_items WHERE user_id = ? AND day = ? ORDER BY item_id",
                (user_id, day),
            ).fetchall()
        return [row["item_id"] for row in rows]

    def add_aired_ids(self, user_id: int, day: str, item_ids: list[str]) -> None:
        with self.connect() as conn:
            conn.executemany(
                "INSERT OR IGNORE INTO aired_items (user_id, day, item_id) VALUES (?, ?, ?)",
                [(user_id, day, item_id) for item_id in item_ids],
            )

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
