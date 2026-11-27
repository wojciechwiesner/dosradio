"""Data retention promised in the privacy policy (public/prywatnosc.html, section 4).

Once a day, rows older than RETENTION_DAYS are deleted from tables that hold listener
traces: trial markers (IP hash / browser id), presence, comments, dedications and
friend identities. Accounts, settings and billing data are not touched here.
`trial_owners` is kept on purpose: anonymous listeners' podcasts and sources hang on it.
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
import time

from .db import Database

log = logging.getLogger("dosradio.retention")

RETENTION_DAYS = 365
DAY = 86400

# table -> timestamp column (all store unix seconds, REAL or INTEGER)
RETAINED: dict[str, str] = {
    "trials": "started_at",
    "listener_presence": "updated_at",
    "social_presence": "updated_at",
    "social_identities": "updated_at",
    "listener_comments": "created_at",
    "station_dedications": "created_at",
    "referral_opens": "created_at",
}


def purge_expired(db: Database, now: float | None = None, days: int = RETENTION_DAYS) -> dict[str, int]:
    """Delete expired rows; returns deleted row counts per table (missing tables are skipped)."""
    cutoff = (now or time.time()) - days * DAY
    deleted: dict[str, int] = {}
    with db.connect() as conn:
        for table, column in RETAINED.items():
            try:
                cursor = conn.execute(f"DELETE FROM {table} WHERE {column} < ?", (cutoff,))
            except sqlite3.OperationalError:  # table not created yet on this install
                continue
            deleted[table] = cursor.rowcount
    return deleted


async def retention_loop(db: Database, interval: float = DAY) -> None:
    while True:
        try:
            deleted = await asyncio.to_thread(purge_expired, db)
            if any(deleted.values()):
                log.info("Retention purge: %s", deleted)
        except Exception:  # never let housekeeping take the API down
            log.exception("Retention purge failed")
        await asyncio.sleep(interval)
