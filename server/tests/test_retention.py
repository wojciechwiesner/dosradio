"""Retention purge keeps the 12-month promise of the privacy policy."""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import Database  # noqa: E402
from app.retention import RETAINED, purge_expired  # noqa: E402

DAY = 86400


def make_db(tmp_path) -> Database:
    db = Database(tmp_path / "r.db")
    with db.connect() as conn:
        for table, column in RETAINED.items():
            if table == "trials":
                continue  # created by Database's own schema
            conn.execute(f"CREATE TABLE IF NOT EXISTS {table} (id TEXT, {column} REAL NOT NULL)")
    return db


def test_purge_deletes_only_rows_older_than_a_year(tmp_path):
    db = make_db(tmp_path)
    now = time.time()
    with db.connect() as conn:
        conn.execute("INSERT INTO trials (key, started_at) VALUES ('ip:old', ?), ('ip:new', ?)", (now - 400 * DAY, now - 10 * DAY))
        for table, column in RETAINED.items():
            if table == "trials":
                continue
            conn.execute(f"INSERT INTO {table} (id, {column}) VALUES ('old', ?), ('new', ?)", (now - 366 * DAY, now - DAY))
    deleted = purge_expired(db, now=now)
    assert set(deleted) == set(RETAINED)
    assert all(count == 1 for count in deleted.values())
    with db.connect() as conn:
        assert [r[0] for r in conn.execute("SELECT key FROM trials")] == ["ip:new"]
        for table in RETAINED:
            if table != "trials":
                assert [r[0] for r in conn.execute(f"SELECT id FROM {table}")] == ["new"]


def test_purge_skips_missing_tables_and_keeps_accounts(tmp_path):
    db = Database(tmp_path / "bare.db")  # only the core schema
    user_id = db.create_user("old@test.pl", "x")
    with db.connect() as conn:
        conn.execute("UPDATE users SET created_at = ? WHERE id = ?", (time.time() - 900 * DAY, user_id))
        conn.execute("INSERT INTO trial_owners (key, created_at) VALUES ('anon:x', ?)", (time.time() - 900 * DAY,))
    deleted = purge_expired(db)
    assert "listener_comments" not in deleted
    assert db.find_user_by_email("old@test.pl") is not None
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM trial_owners").fetchone()[0] == 1  # podcasts hang on it
