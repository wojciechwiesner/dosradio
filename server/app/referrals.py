"""Referral attribution: which shared link brought a visitor, and did they make an account.

Shared links: dedication (`?d=<id>`), greeting drop (`?w=w_...`), url-podcast drop (`?p=p_...`).
When a visitor who is not the sender opens one, we store one row per (link, visitor) and set a
`dr_ref` cookie ("<kind>:<token>", first link wins, 30 days). Registration copies the cookie into
`users.referred_by`. Nothing here identifies a person: the visitor key is the anon cookie / client id
or an HMAC of the IP, the same keys the trial already uses.
"""
from __future__ import annotations

import re
import time
from typing import Any

from fastapi import Request, Response

from .db import Database

REF_COOKIE = "dr_ref"
REF_COOKIE_MAX_AGE = 30 * 86400
KINDS = {"d": "dedykacja", "w": "pozdrowienie", "p": "podcast ze strony"}
_REF_RE = re.compile(r"^([dwp]):([A-Za-z0-9_]{4,24})$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS referral_opens (
    kind TEXT NOT NULL,
    token TEXT NOT NULL,
    visitor_key TEXT NOT NULL,
    member INTEGER NOT NULL DEFAULT 0,   -- 1 when the visitor already had an account
    created_at REAL NOT NULL,
    PRIMARY KEY (kind, token, visitor_key)
);
"""


def ensure_schema(db: Database) -> None:
    with db.connect() as conn:
        conn.executescript(SCHEMA)


def parse_ref(value: str | None) -> str | None:
    """A valid `<kind>:<token>` reference or None (forged or junk cookies are ignored)."""
    if not value:
        return None
    return value if _REF_RE.match(value) else None


def record_open(
    db: Database,
    request: Request,
    response: Response,
    *,
    kind: str,
    token: str,
    visitor_key: str,
    is_sender: bool,
    is_member: bool,
) -> bool:
    """Count one open of a shared link; returns True when a new (link, visitor) pair was stored."""
    ref = f"{kind}:{token}"
    if is_sender or parse_ref(ref) is None:
        return False
    with db.connect() as conn:
        conn.executescript(SCHEMA)
        cursor = conn.execute(
            "INSERT OR IGNORE INTO referral_opens (kind, token, visitor_key, member, created_at) VALUES (?, ?, ?, ?, ?)",
            (kind, token, visitor_key, 1 if is_member else 0, time.time()),
        )
    if not is_member and parse_ref(request.cookies.get(REF_COOKIE)) is None:
        response.set_cookie(REF_COOKIE, ref, max_age=REF_COOKIE_MAX_AGE, httponly=True, secure=True,
                            samesite="lax", path="/")
        request.cookies[REF_COOKIE] = ref  # the same request may go on to register
    return cursor.rowcount > 0


def summary(db: Database, since: float | None = None) -> dict[str, Any]:
    """Funnel per link type: opened by newcomers -> accounts -> confirmed e-mail."""
    since = since or 0.0
    with db.connect() as conn:
        conn.executescript(SCHEMA)
        opens = conn.execute(
            "SELECT kind, SUM(member = 0) AS newcomers, SUM(member = 1) AS members FROM referral_opens"
            " WHERE created_at >= ? GROUP BY kind",
            (since,),
        ).fetchall()
        users = conn.execute(
            "SELECT substr(referred_by, 1, 1) AS kind, COUNT(*) AS signups, SUM(email_verified) AS verified"
            " FROM users WHERE referred_by IS NOT NULL AND created_at >= ? GROUP BY kind",
            (since,),
        ).fetchall()
    by_kind: dict[str, dict[str, Any]] = {
        k: {"label": label, "opened": 0, "opened_by_members": 0, "signups": 0, "verified": 0} for k, label in KINDS.items()
    }
    for row in opens:
        if row["kind"] in by_kind:
            by_kind[row["kind"]]["opened"] = int(row["newcomers"] or 0)
            by_kind[row["kind"]]["opened_by_members"] = int(row["members"] or 0)
    for row in users:
        if row["kind"] in by_kind:
            by_kind[row["kind"]]["signups"] = int(row["signups"] or 0)
            by_kind[row["kind"]]["verified"] = int(row["verified"] or 0)
    total = {key: sum(v[key] for v in by_kind.values()) for key in ("opened", "opened_by_members", "signups", "verified")}
    return {**total, "by_kind": by_kind}
