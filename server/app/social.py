"""Social Graph, Live Airwave Presence, Friend Drops & Website-Podcast Links."""
from __future__ import annotations

import os
import re
import secrets
import time
from typing import Any
from urllib.parse import quote

from .db import Database

SOCIAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS social_identities (
    actor_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    email_norm TEXT NOT NULL DEFAULT '',
    phone_norm TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soc_id_email ON social_identities(email_norm);
CREATE INDEX IF NOT EXISTS idx_soc_id_phone ON social_identities(phone_norm);

CREATE TABLE IF NOT EXISTS social_friends (
    id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    friend_key TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    email_norm TEXT NOT NULL DEFAULT '',
    phone_norm TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soc_friends_owner ON social_friends(owner_key);

CREATE TABLE IF NOT EXISTS social_presence (
    actor_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    station_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS social_drops (
    token TEXT PRIMARY KEY,
    from_key TEXT NOT NULL,
    from_name TEXT NOT NULL,
    to_friend_id TEXT NOT NULL DEFAULT '',
    to_key TEXT NOT NULL DEFAULT '',
    to_name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    station_id TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    site_title TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    dedication_token TEXT NOT NULL DEFAULT '',
    pill_text TEXT NOT NULL DEFAULT '',
    podcast_id TEXT NOT NULL DEFAULT '',
    podcast_status TEXT NOT NULL DEFAULT '',
    podcast_error TEXT NOT NULL DEFAULT '',
    delivered_live INTEGER NOT NULL DEFAULT 0,
    claimed_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soc_drops_to_key ON social_drops(to_key, delivered_live);
"""

ONLINE_TTL_SECONDS = 45


def normalize_email(email: str | None) -> str:
    val = (email or "").strip().lower()
    return val if ("@" in val and "." in val.split("@")[-1]) else ""


def normalize_phone(phone: str | None) -> str:
    raw = re.sub(r"[^\d+]", "", (phone or "").strip())
    if not raw:
        return ""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 9:
        return f"+48{digits}"
    if len(digits) >= 8:
        return f"+{digits}"
    return ""


def make_initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", (name or "").strip()) if p]
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    return ((name or "ZN").strip()[:2]).upper() or "ZN"


def build_share_links(
    query_param: str,
    token: str,
    invite_text: str,
    email: str = "",
    phone: str = "",
) -> dict[str, str]:
    public_base = os.environ.get("DOSRADIO_PUBLIC_URL", "https://dosradio.theones.io").rstrip("/")
    share_url = f"{public_base}/orbita.html?{query_param}={token}"
    classic_url = f"{public_base}/?{query_param}={token}"
    full_msg = f"{invite_text.strip()} {share_url}".strip()
    digits = re.sub(r"\D", "", phone)
    wa = f"https://wa.me/{digits}?text={quote(full_msg)}" if digits else f"https://wa.me/?text={quote(full_msg)}"
    tg = f"https://t.me/share/url?url={quote(share_url)}&text={quote(invite_text.strip())}"
    mailto = f"mailto:{email}?subject={quote('Wrzutka dla Ciebie na antenie DOS Radio')}&body={quote(invite_text.strip() + chr(10) + chr(10) + share_url)}"
    sms = f"sms:{phone}?body={quote(full_msg)}"
    return {
        "share_url": share_url,
        "classic_url": classic_url,
        "whatsapp_url": wa,
        "telegram_url": tg,
        "mailto_url": mailto,
        "sms_url": sms,
    }


class SocialService:
    def __init__(self, db: Database) -> None:
        self.db = db
        with self.db.connect() as conn:
            conn.executescript(SOCIAL_SCHEMA)

    def upsert_identity(self, actor_key: str, display_name: str = "", email: str = "", phone: str = "") -> None:
        em = normalize_email(email)
        ph = normalize_phone(phone)
        now = int(time.time())
        with self.db.connect() as conn:
            cur = conn.execute("SELECT * FROM social_identities WHERE actor_key = ?", (actor_key,)).fetchone()
            dn = display_name.strip() or (cur["display_name"] if cur else "")
            em_f = em or (cur["email_norm"] if cur else "")
            ph_f = ph or (cur["phone_norm"] if cur else "")
            conn.execute(
                """INSERT INTO social_identities (actor_key, display_name, email_norm, phone_norm, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(actor_key) DO UPDATE SET
                   display_name=excluded.display_name, email_norm=excluded.email_norm,
                   phone_norm=excluded.phone_norm, updated_at=excluded.updated_at""",
                (actor_key, dn, em_f, ph_f, now),
            )
            if em_f or ph_f:
                conn.execute(
                    """UPDATE social_friends SET friend_key = ?
                       WHERE friend_key = '' AND ((? != '' AND email_norm = ?) OR (? != '' AND phone_norm = ?))""",
                    (actor_key, em_f, em_f, ph_f, ph_f),
                )

    def resolve_contact_key(self, email_norm: str, phone_norm: str) -> str:
        with self.db.connect() as conn:
            if email_norm:
                u = self.db.find_user_by_email(email_norm)
                if u is not None and u["id"] is not None:
                    return f"u:{u['id']}"
                row = conn.execute("SELECT actor_key FROM social_identities WHERE email_norm = ? LIMIT 1", (email_norm,)).fetchone()
                if row:
                    return str(row["actor_key"])
            if phone_norm:
                row = conn.execute("SELECT actor_key FROM social_identities WHERE phone_norm = ? LIMIT 1", (phone_norm,)).fetchone()
                if row:
                    return str(row["actor_key"])
        return ""

    def add_friend(self, owner_key: str, name: str, email: str = "", phone: str = "", channel: str = "whatsapp", friend_key: str = "") -> dict[str, Any]:
        em = normalize_email(email)
        ph = normalize_phone(phone)
        fk = friend_key or self.resolve_contact_key(em, ph)
        now = int(time.time())
        ch = channel if channel in ("whatsapp", "telegram", "email", "sms") else "whatsapp"
        with self.db.connect() as conn:
            existing = None
            if fk:
                existing = conn.execute("SELECT * FROM social_friends WHERE owner_key = ? AND friend_key = ?", (owner_key, fk)).fetchone()
            if not existing and em:
                existing = conn.execute("SELECT * FROM social_friends WHERE owner_key = ? AND email_norm = ?", (owner_key, em)).fetchone()
            if not existing and ph:
                existing = conn.execute("SELECT * FROM social_friends WHERE owner_key = ? AND phone_norm = ?", (owner_key, ph)).fetchone()
            if existing:
                fid = str(existing["id"])
                conn.execute(
                    "UPDATE social_friends SET name=?, friend_key=COALESCE(NULLIF(?,''), friend_key), email_norm=COALESCE(NULLIF(?,''), email_norm), phone_norm=COALESCE(NULLIF(?,''), phone_norm), channel=? WHERE id=?",
                    (name.strip(), fk, em, ph, ch, fid),
                )
            else:
                fid = "fr_" + secrets.token_hex(5)
                conn.execute(
                    "INSERT INTO social_friends (id, owner_key, friend_key, name, email_norm, phone_norm, channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (fid, owner_key, fk, name.strip(), em, ph, ch, now),
                )
        return next((f for f in self.list_friends(owner_key) if f["id"] == fid), {"id": fid, "name": name.strip()})

    def list_friends(self, owner_key: str) -> list[dict[str, Any]]:
        cutoff = int(time.time()) - ONLINE_TTL_SECONDS
        with self.db.connect() as conn:
            rows = conn.execute(
                """SELECT f.*, p.station_id AS live_station, p.updated_at AS seen_at
                   FROM social_friends f
                   LEFT JOIN social_presence p ON (f.friend_key != '' AND p.actor_key = f.friend_key)
                   WHERE f.owner_key = ?
                   ORDER BY (CASE WHEN p.updated_at >= ? THEN 1 ELSE 0 END) DESC, f.created_at DESC""",
                (owner_key, cutoff),
            ).fetchall()
        out = []
        for r in rows:
            online = bool(r["seen_at"] and int(r["seen_at"]) >= cutoff)
            out.append({
                "id": r["id"],
                "friend_key": r["friend_key"],
                "name": r["name"],
                "initials": make_initials(r["name"]),
                "email": r["email_norm"],
                "phone": r["phone_norm"],
                "channel": r["channel"],
                "online": online,
                "station_id": r["live_station"] if online else None,
            })
        return out

    def heartbeat(self, actor_key: str, station_id: str, display_name: str = "") -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        now = int(time.time())
        dn = (display_name or "").strip() or "Słuchacz"
        with self.db.connect() as conn:
            conn.execute(
                """INSERT INTO social_presence (actor_key, display_name, station_id, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(actor_key) DO UPDATE SET display_name=excluded.display_name, station_id=excluded.station_id, updated_at=excluded.updated_at""",
                (actor_key, dn, station_id, now),
            )
            pending = conn.execute(
                "SELECT * FROM social_drops WHERE to_key = ? AND delivered_live = 0 ORDER BY created_at ASC LIMIT 5",
                (actor_key,),
            ).fetchall()
            if pending:
                tokens = [str(r["token"]) for r in pending]
                q = ",".join("?" for _ in tokens)
                conn.execute(f"UPDATE social_drops SET delivered_live = 1 WHERE token IN ({q})", tokens)
        friends_online = [f for f in self.list_friends(actor_key) if f["online"]]
        return friends_online, [dict(r) for r in pending]

    def create_drop(self, prefix: str = "w", **fields: Any) -> dict[str, Any]:
        token = f"{prefix}_{secrets.token_urlsafe(7).replace('-', '').replace('_', '')[:9]}"
        now = int(time.time())
        cols = [
            "token", "from_key", "from_name", "to_friend_id", "to_key", "to_name",
            "kind", "station_id", "message", "source_url", "site_title", "comment",
            "dedication_token", "pill_text", "podcast_id", "podcast_status", "created_at",
        ]
        vals = [
            token, fields.get("from_key", ""), fields.get("from_name", "Znajomy"),
            fields.get("to_friend_id", ""), fields.get("to_key", ""), fields.get("to_name", ""),
            fields.get("kind", "greeting"), fields.get("station_id", "dos-groove"),
            fields.get("message", ""), fields.get("source_url", ""), fields.get("site_title", ""),
            fields.get("comment", ""), fields.get("dedication_token", ""), fields.get("pill_text", ""),
            fields.get("podcast_id", ""), fields.get("podcast_status", ""), now,
        ]
        with self.db.connect() as conn:
            conn.execute(f"INSERT INTO social_drops ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})", vals)
            row = conn.execute("SELECT * FROM social_drops WHERE token = ?", (token,)).fetchone()
        return dict(row)

    def update_drop_podcast(self, token: str, podcast_id: str = "", status: str = "ready", error: str = "") -> None:
        with self.db.connect() as conn:
            conn.execute(
                "UPDATE social_drops SET podcast_id = COALESCE(NULLIF(?,''), podcast_id), podcast_status = ?, podcast_error = ? WHERE token = ?",
                (podcast_id, status, error[:240], token),
            )

    def get_drop(self, token: str) -> dict[str, Any] | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM social_drops WHERE token = ?", (token,)).fetchone()
        return dict(row) if row else None

    def claim_drop(self, token: str, claimer_key: str, claimer_name: str = "") -> dict[str, Any] | None:
        drop = self.get_drop(token)
        if not drop:
            return None
        now = int(time.time())
        with self.db.connect() as conn:
            conn.execute("UPDATE social_drops SET claimed_at = ?, delivered_live = 1 WHERE token = ?", (now, token))
        sender_key = drop["from_key"]
        paired = False
        if sender_key and claimer_key and sender_key != claimer_key:
            self.add_friend(claimer_key, drop["from_name"] or "Znajomy", friend_key=sender_key)
            self.add_friend(sender_key, claimer_name.strip() or drop["to_name"] or "Znajomy", friend_key=claimer_key)
            paired = True
        updated = self.get_drop(token) or drop
        updated["auto_paired"] = paired
        return updated
