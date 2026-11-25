"""SQLite-backed telemetry, listener presence, and B2B lead store."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from .db import Database

TELEMETRY_SCHEMA = """
CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL,
    model TEXT NOT NULL,
    feature TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    audio_seconds REAL NOT NULL DEFAULT 0.0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0.0
);
CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);

CREATE TABLE IF NOT EXISTS listener_presence (
    actor_key TEXT PRIMARY KEY,
    user_id INTEGER,
    email TEXT,
    station_id TEXT NOT NULL,
    view_mode TEXT NOT NULL DEFAULT 'classic',
    ramowka INTEGER NOT NULL DEFAULT 0,
    user_agent TEXT NOT NULL DEFAULT '',
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listener_presence_updated_at ON listener_presence(updated_at);

CREATE TABLE IF NOT EXISTS zrobimy_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL,
    company TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    contact TEXT NOT NULL,
    industry TEXT NOT NULL DEFAULT '',
    team_size TEXT NOT NULL DEFAULT '',
    pain_point TEXT NOT NULL DEFAULT '',
    source_spot TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new'
);
"""


def estimate_cost_usd(
    model: str,
    feature: str,
    prompt_tokens: int,
    output_tokens: int,
    audio_seconds: float,
) -> float:
    m_low = (model or "").lower()
    f_low = (feature or "").lower()
    if "lyria" in m_low or f_low == "lyria":
        cost = (max(0.0, audio_seconds) / 60.0) * 0.06 + (max(0, prompt_tokens) / 1_000_000.0) * 0.15
        return round(cost, 6)
    if "tts" in m_low or f_low in ("tts", "voice", "host", "spot"):
        eff_out = max(0, output_tokens)
        if eff_out == 0 and audio_seconds > 0:
            eff_out = int(audio_seconds * 32)
        cost = (max(0, prompt_tokens) / 1_000_000.0) * 0.50 + (eff_out / 1_000_000.0) * 8.00
        return round(cost, 6)
    cost = (max(0, prompt_tokens) / 1_000_000.0) * 0.15 + (max(0, output_tokens) / 1_000_000.0) * 0.60
    return round(cost, 6)


class TelemetryService:
    def __init__(self, db: Database) -> None:
        self.db = db
        with self.db.connect() as conn:
            conn.executescript(TELEMETRY_SCHEMA)

    def record_tokens(
        self,
        model: str,
        feature: str,
        prompt_tokens: int = 0,
        output_tokens: int = 0,
        total_tokens: int | None = None,
        audio_seconds: float = 0.0,
    ) -> None:
        p_tok = max(0, int(prompt_tokens or 0))
        o_tok = max(0, int(output_tokens or 0))
        t_tok = int(total_tokens) if total_tokens is not None else (p_tok + o_tok)
        a_sec = max(0.0, float(audio_seconds or 0.0))
        cost = estimate_cost_usd(model, feature, p_tok, o_tok, a_sec)
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO token_usage "
                "(created_at, model, feature, prompt_tokens, output_tokens, total_tokens, audio_seconds, estimated_cost_usd) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (time.time(), model, feature, p_tok, o_tok, t_tok, a_sec, cost),
            )

    def _window_totals(self, conn: Any, since: float) -> dict[str, Any]:
        row = conn.execute(
            "SELECT COUNT(*) AS calls, "
            "COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, "
            "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
            "COALESCE(SUM(total_tokens), 0) AS total_tokens, "
            "COALESCE(SUM(audio_seconds), 0.0) AS audio_seconds, "
            "COALESCE(SUM(estimated_cost_usd), 0.0) AS estimated_cost_usd "
            "FROM token_usage WHERE created_at >= ?",
            (since,),
        ).fetchone()
        return {
            "calls": int(row["calls"]),
            "prompt_tokens": int(row["prompt_tokens"]),
            "output_tokens": int(row["output_tokens"]),
            "total_tokens": int(row["total_tokens"]),
            "audio_seconds": round(float(row["audio_seconds"]), 2),
            "estimated_cost_usd": round(float(row["estimated_cost_usd"]), 4),
        }

    def token_summary(self, days: int = 30) -> dict[str, Any]:
        now = time.time()
        window_days = max(1, min(365, int(days)))
        since_window = now - window_days * 86400

        with self.db.connect() as conn:
            totals_24h = self._window_totals(conn, now - 86400)
            totals_7d = self._window_totals(conn, now - 7 * 86400)
            totals_30d = self._window_totals(conn, now - 30 * 86400)

            feat_rows = conn.execute(
                "SELECT feature, COUNT(*) AS calls, "
                "COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, "
                "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
                "COALESCE(SUM(total_tokens), 0) AS total_tokens, "
                "COALESCE(SUM(audio_seconds), 0.0) AS audio_seconds, "
                "COALESCE(SUM(estimated_cost_usd), 0.0) AS estimated_cost_usd "
                "FROM token_usage WHERE created_at >= ? "
                "GROUP BY feature ORDER BY estimated_cost_usd DESC, total_tokens DESC",
                (since_window,),
            ).fetchall()

            mod_rows = conn.execute(
                "SELECT model, COUNT(*) AS calls, "
                "COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, "
                "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
                "COALESCE(SUM(total_tokens), 0) AS total_tokens, "
                "COALESCE(SUM(audio_seconds), 0.0) AS audio_seconds, "
                "COALESCE(SUM(estimated_cost_usd), 0.0) AS estimated_cost_usd "
                "FROM token_usage WHERE created_at >= ? "
                "GROUP BY model ORDER BY estimated_cost_usd DESC, total_tokens DESC",
                (since_window,),
            ).fetchall()

            raw_rows = conn.execute(
                "SELECT created_at, prompt_tokens, output_tokens, total_tokens, audio_seconds, estimated_cost_usd "
                "FROM token_usage WHERE created_at >= ? ORDER BY created_at ASC",
                (since_window,),
            ).fetchall()

        daily_map: dict[str, dict[str, Any]] = {}
        for r in raw_rows:
            day_str = datetime.fromtimestamp(float(r["created_at"]), tz=timezone.utc).strftime("%Y-%m-%d")
            bucket = daily_map.get(day_str)
            if bucket is None:
                bucket = {
                    "day": day_str,
                    "calls": 0,
                    "prompt_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                    "audio_seconds": 0.0,
                    "estimated_cost_usd": 0.0,
                }
                daily_map[day_str] = bucket
            bucket["calls"] += 1
            bucket["prompt_tokens"] += int(r["prompt_tokens"])
            bucket["output_tokens"] += int(r["output_tokens"])
            bucket["total_tokens"] += int(r["total_tokens"])
            bucket["audio_seconds"] = round(bucket["audio_seconds"] + float(r["audio_seconds"]), 2)
            bucket["estimated_cost_usd"] = round(bucket["estimated_cost_usd"] + float(r["estimated_cost_usd"]), 4)

        return {
            "totals_24h": totals_24h,
            "totals_7d": totals_7d,
            "totals_30d": totals_30d,
            "by_feature": [
                {
                    "feature": r["feature"],
                    "calls": int(r["calls"]),
                    "prompt_tokens": int(r["prompt_tokens"]),
                    "output_tokens": int(r["output_tokens"]),
                    "total_tokens": int(r["total_tokens"]),
                    "audio_seconds": round(float(r["audio_seconds"]), 2),
                    "estimated_cost_usd": round(float(r["estimated_cost_usd"]), 4),
                }
                for r in feat_rows
            ],
            "by_model": [
                {
                    "model": r["model"],
                    "calls": int(r["calls"]),
                    "prompt_tokens": int(r["prompt_tokens"]),
                    "output_tokens": int(r["output_tokens"]),
                    "total_tokens": int(r["total_tokens"]),
                    "audio_seconds": round(float(r["audio_seconds"]), 2),
                    "estimated_cost_usd": round(float(r["estimated_cost_usd"]), 4),
                }
                for r in mod_rows
            ],
            "daily": [daily_map[k] for k in sorted(daily_map.keys())],
        }

    def touch_presence(
        self,
        actor_key: str,
        station_id: str,
        view_mode: str = "classic",
        ramowka: bool = False,
        user_id: int | None = None,
        email: str | None = None,
        user_agent: str = "",
    ) -> None:
        key = (actor_key or "anon").strip()[:120]
        sid = (station_id or "dos-groove").strip()[:64]
        vmode = "orbita" if (view_mode or "").strip().lower() == "orbita" else "classic"
        now = time.time()
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO listener_presence "
                "(actor_key, user_id, email, station_id, view_mode, ramowka, user_agent, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(actor_key) DO UPDATE SET "
                "user_id=COALESCE(excluded.user_id, listener_presence.user_id), "
                "email=COALESCE(excluded.email, listener_presence.email), "
                "station_id=excluded.station_id, "
                "view_mode=excluded.view_mode, "
                "ramowka=excluded.ramowka, "
                "user_agent=excluded.user_agent, "
                "updated_at=excluded.updated_at",
                (key, user_id, email, sid, vmode, 1 if ramowka else 0, (user_agent or "")[:240], now),
            )

    def active_listeners(self, window_seconds: int = 180) -> dict[str, Any]:
        now = time.time()
        cutoff_now = now - max(10, int(window_seconds))
        cutoff_24h = now - 86400
        with self.db.connect() as conn:
            active_rows = conn.execute(
                "SELECT * FROM listener_presence WHERE updated_at >= ? ORDER BY updated_at DESC",
                (cutoff_now,),
            ).fetchall()
            count_24h = int(
                conn.execute(
                    "SELECT COUNT(*) FROM listener_presence WHERE updated_at >= ?",
                    (cutoff_24h,),
                ).fetchone()[0]
            )

        by_station: dict[str, int] = {}
        by_view: dict[str, int] = {"classic": 0, "orbita": 0}
        ramowka_listeners = 0
        listeners: list[dict[str, Any]] = []

        for r in active_rows:
            sid = r["station_id"]
            by_station[sid] = by_station.get(sid, 0) + 1
            vmode = r["view_mode"] if r["view_mode"] in ("classic", "orbita") else "classic"
            by_view[vmode] = by_view.get(vmode, 0) + 1
            is_ram = bool(r["ramowka"])
            if is_ram:
                ramowka_listeners += 1
            listeners.append(
                {
                    "actor_key": r["actor_key"],
                    "user_id": r["user_id"],
                    "email": r["email"],
                    "station_id": sid,
                    "view_mode": vmode,
                    "ramowka": is_ram,
                    "user_agent": r["user_agent"],
                    "updated_at": float(r["updated_at"]),
                    "seconds_ago": max(0, int(now - float(r["updated_at"]))),
                }
            )

        return {
            "active_now": len(listeners),
            "active_24h": count_24h,
            "by_station": by_station,
            "by_view": by_view,
            "ramowka_listeners": ramowka_listeners,
            "listeners": listeners,
        }

    def _row_to_lead(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "created_at": float(row["created_at"]),
            "company": row["company"],
            "contact_name": row["contact_name"],
            "contact": row["contact"],
            "industry": row["industry"],
            "team_size": row["team_size"],
            "pain_point": row["pain_point"],
            "source_spot": row["source_spot"],
            "notes": row["notes"],
            "status": row["status"],
        }

    def create_lead(
        self,
        company: str | dict[str, Any],
        contact_name: str = "",
        contact: str = "",
        industry: str = "",
        team_size: str = "",
        pain_point: str = "",
        source_spot: str = "",
        notes: str = "",
    ) -> dict[str, Any]:
        if isinstance(company, dict):
            data = company
            comp = str(data.get("company") or "").strip()
            c_name = str(data.get("contact_name") or "").strip()
            c_info = str(data.get("contact") or "").strip()
            ind = str(data.get("industry") or "").strip()
            tsize = str(data.get("team_size") or "").strip()
            pain = str(data.get("pain_point") or "").strip()
            spot = str(data.get("source_spot") or "").strip()
            nts = str(data.get("notes") or "").strip()
        else:
            comp = (company or "").strip()
            c_name = (contact_name or "").strip()
            c_info = (contact or "").strip()
            ind = (industry or "").strip()
            tsize = (team_size or "").strip()
            pain = (pain_point or "").strip()
            spot = (source_spot or "").strip()
            nts = (notes or "").strip()

        if not comp:
            raise ValueError("Nazwa firmy jest wymagana")
        if len(c_info) < 5:
            raise ValueError("Podaj poprawny kontakt (e-mail lub telefon)")

        now = time.time()
        with self.db.connect() as conn:
            cur = conn.execute(
                "INSERT INTO zrobimy_leads "
                "(created_at, company, contact_name, contact, industry, team_size, pain_point, source_spot, notes, status) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')",
                (now, comp[:160], c_name[:120], c_info[:160], ind[:120], tsize[:60], pain[:500], spot[:80], nts[:1000]),
            )
            lead_id = int(cur.lastrowid or 0)
            row = conn.execute("SELECT * FROM zrobimy_leads WHERE id = ?", (lead_id,)).fetchone()
        assert row is not None
        return self._row_to_lead(row)

    def list_leads(self, limit: int = 200) -> list[dict[str, Any]]:
        cap = max(1, min(1000, int(limit)))
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM zrobimy_leads ORDER BY created_at DESC, id DESC LIMIT ?",
                (cap,),
            ).fetchall()
        return [self._row_to_lead(r) for r in rows]

    def update_lead_status(self, lead_id: int, status: str) -> dict[str, Any] | None:
        clean_status = (status or "").strip().lower()[:40]
        if not clean_status:
            raise ValueError("Status jest wymagany")
        with self.db.connect() as conn:
            conn.execute(
                "UPDATE zrobimy_leads SET status = ? WHERE id = ?",
                (clean_status, int(lead_id)),
            )
            row = conn.execute("SELECT * FROM zrobimy_leads WHERE id = ?", (int(lead_id),)).fetchone()
        return self._row_to_lead(row) if row else None
