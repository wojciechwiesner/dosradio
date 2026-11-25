"""Daily podcast quota shared by the Plus panel and the website-link (url-podcast) endpoints.

Rule: one NEW generation per actor per calendar day in Europe/Warsaw, unless the actor is a
signed-in user with an active *paid* Plus (users.plus_paid_until in the future).
A slot is reserved before generation starts and released when the generation fails, so a
failed run never uses up the day. Replaying an existing episode never reserves a slot.
"""
from __future__ import annotations

import time
from datetime import datetime, time as dtime, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

from fastapi.responses import JSONResponse

from .db import Database
from .podcast import PodcastService

QUOTA_TZ = ZoneInfo("Europe/Warsaw")
DAILY_PODCAST_LIMIT = 1
LIMIT_MESSAGE = "Darmowy Plus: 1 podcast dziennie. Kolejny jutro albo wykup Plus."
USER_KEY_PREFIX = "u:"

SCHEMA = """
CREATE TABLE IF NOT EXISTS podcast_quota_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_key TEXT NOT NULL,
    day TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_podcast_quota_actor_day ON podcast_quota_uses(actor_key, day);
"""


class PodcastQuota:
    def __init__(self, db: Database, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.clock = clock
        with db.connect() as conn:
            conn.executescript(SCHEMA)

    # --- calendar -------------------------------------------------------------
    def _local_now(self) -> datetime:
        return datetime.fromtimestamp(self.clock(), QUOTA_TZ)

    def day_key(self) -> str:
        return self._local_now().date().isoformat()

    def reset_at(self) -> float:
        """Unix timestamp of the next Warsaw midnight."""
        tomorrow = self._local_now().date() + timedelta(days=1)
        return datetime.combine(tomorrow, dtime.min, tzinfo=QUOTA_TZ).timestamp()

    # --- rule -----------------------------------------------------------------
    def is_unlimited(self, actor_key: str) -> bool:
        if not actor_key.startswith(USER_KEY_PREFIX):
            return False
        try:
            user_id = int(actor_key[len(USER_KEY_PREFIX):])
        except ValueError:
            return False
        with self.db.connect() as conn:
            row = conn.execute("SELECT plus_paid_until FROM users WHERE id = ?", (user_id,)).fetchone()
        return bool(row and row["plus_paid_until"] and row["plus_paid_until"] > self.clock())

    def reserve(self, actor_key: str) -> int | None:
        """Take today's slot. Returns a reservation id (0 = unlimited, nothing stored), None when over the limit."""
        if self.is_unlimited(actor_key):
            return 0
        day = self.day_key()
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")  # check + insert atomically across concurrent requests
            used = conn.execute(
                "SELECT COUNT(*) FROM podcast_quota_uses WHERE actor_key = ? AND day = ?", (actor_key, day)
            ).fetchone()[0]
            if used >= DAILY_PODCAST_LIMIT:
                return None
            cursor = conn.execute(
                "INSERT INTO podcast_quota_uses (actor_key, day, created_at) VALUES (?, ?, ?)",
                (actor_key, day, self.clock()),
            )
            return int(cursor.lastrowid or 0)

    def release(self, reservation: int | None) -> None:
        """Give the slot back after a failed generation."""
        if not reservation:
            return
        with self.db.connect() as conn:
            conn.execute("DELETE FROM podcast_quota_uses WHERE id = ?", (reservation,))

    def is_replay(self, podcasts: PodcastService, topic: str | None) -> bool:
        """True when this (topic, today) episode already exists: serving it costs nothing."""
        return podcasts.load_manifest(podcasts.episode_id(topic)) is not None

    def limit_response(self) -> JSONResponse:
        return JSONResponse(status_code=429, content={"detail": LIMIT_MESSAGE, "reset_at": self.reset_at()})
