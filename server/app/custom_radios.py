"""Custom User & Creator (YouTuber) Live Radios with curated Pills."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .auth import AccessService, client_ip
from .db import Database
from .hosts import BORROWED_HOSTS

SCHEMA = """
CREATE TABLE IF NOT EXISTS custom_radios (
    slug TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    name TEXT NOT NULL,
    creator_name TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'describe',
    description TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    base_station_id TEXT NOT NULL,
    bpm INTEGER NOT NULL DEFAULT 120,
    density REAL NOT NULL DEFAULT 0.55,
    brightness REAL NOT NULL DEFAULT 0.55,
    host TEXT NOT NULL DEFAULT 'Kuba',
    pills_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_radios_created ON custom_radios(created_at DESC);
"""

KEYWORD_STATION_MAP: list[tuple[tuple[str, ...], str, int]] = [
    (("bcco", "berlin", "rumble"), "berlin-bcco-techno", 140),
    (("raw techno", "industrial", "dark techno"), "raw-techno", 138),
    (("hypnotic", "hipnotycz"), "hypnotic-techno", 135),
    (("detroit",), "detroit-techno", 130),
    (("tribal", "plemien"), "tribal-techno", 136),
    (("etno techno", "ethno techno"), "etno-techno", 132),
    (("goa", "psytrance", "trance"), "goa-trance", 142),
    (("tekk", "hardtekk"), "tekk", 158),
    (("hard dance", "rave", "hardstyle"), "hard-dance", 150),
    (("dnb", "drum and bass", "jungle", "liquid"), "drum-and-bass", 174),
    (("synth", "cyber", "retro", "80s", "stranger"), "stranger-synth", 112),
    (("jazz", "saksofon", "swing"), "warm-jazz", 88),
    (("ambient", "medytac", "sen", "kosmos", "cisza"), "deep-ambient", 70),
    (("klasycz", "fortepian", "piano", "smyczki"), "muzyka-klasyczna", 82),
    (("lofi", "lo-fi", "nauka", "kodowan", "praca", "study"), "lofi-nauka", 86),
    (("dub", "reggae", "noc"), "nocny-dub", 110),
    (("trip-hop", "triphop", "chill"), "stoa", 78),
    (("folk", "etno", "słowiań", "slowian"), "etno-world", 108),
    (("deep house", "plaża", "sunset", "lounge"), "deep-house", 120),
    (("techno", "klub", "club"), "minimal-techno", 128),
]


def resolve_actor_key(request: Request, access: AccessService | None = None, db: Database | None = None) -> str:
    ip = client_ip({k.lower(): v for k, v in request.headers.items()}, request.client.host if request.client else None)
    if access is not None and db is not None:
        current = access.resolve(request.cookies, ip)
        if current.registered and current.email:
            u = db.find_user_by_email(current.email)
            if u is not None and u["id"] is not None:
                return f"u:{u['id']}"
    cid = re.sub(r"[^a-zA-Z0-9_-]", "", (request.headers.get("x-client-id") or ""))[:64]
    if cid:
        return f"c:{cid}"
    return "ip:" + hashlib.sha256(ip.encode()).hexdigest()[:16]


def _slugify(text: str) -> str:
    tr = str.maketrans("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ")
    base = re.sub(r"[^a-z0-9]+", "-", text.translate(tr).lower()).strip("-")
    return (base[:36] or "moje-radio") + "-" + secrets.token_hex(2)


def match_base_station(text: str, explicit_base: str | None = None, valid_ids: set[str] | None = None) -> tuple[str, int]:
    if explicit_base and (not valid_ids or explicit_base in valid_ids):
        return explicit_base, 120
    low = (text or "").lower()
    for keys, sid, bpm in KEYWORD_STATION_MAP:
        if any(k in low for k in keys):
            if not valid_ids or sid in valid_ids:
                return sid, bpm
    return ("dos-groove" if not valid_ids or "dos-groove" in valid_ids else next(iter(valid_ids))), 118


class PillItemInput(BaseModel):
    title: str = Field(default="", max_length=160)
    url: str = Field(default="", max_length=500)
    note: str = Field(default="", max_length=500)


class CreateCustomRadioBody(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    creator_name: str = Field(default="", max_length=60)
    mode: str = Field(default="describe", max_length=16)
    description: str = Field(default="", max_length=600)
    prompt: str = Field(default="", max_length=800)
    base_station_id: Optional[str] = Field(default=None, max_length=64)
    bpm: Optional[int] = Field(default=None, ge=55, le=190)
    density: float = Field(default=0.55, ge=0.0, le=1.0)
    brightness: float = Field(default=0.55, ge=0.0, le=1.0)
    host: str = Field(default="Kuba", max_length=32)
    pills: list[PillItemInput] = Field(default_factory=list, max_length=25)


class CustomRadioService:
    def __init__(self, db: Database, catalog_service: Any = None) -> None:
        self.db = db
        self.catalog = catalog_service
        with self.db.connect() as conn:
            conn.executescript(SCHEMA)

    def _valid_station_ids(self) -> set[str]:
        if self.catalog is not None:
            try:
                cat = self.catalog.public_catalog()
                return {s["id"] for s in cat.get("stations", [])}
            except Exception:
                pass
        return set(BORROWED_HOSTS.keys()) | {"dos-groove", "berlin-bcco-techno", "warm-jazz", "deep-ambient", "lofi-nauka", "stranger-synth"}

    def _row_to_dict(self, row: Any) -> dict[str, Any]:
        d = dict(row)
        try:
            d["pills"] = json.loads(d.pop("pills_json", "[]") or "[]")
        except Exception:
            d["pills"] = []
        return d

    def create(self, owner_key: str, body: CreateCustomRadioBody) -> dict[str, Any]:
        valid_ids = self._valid_station_ids()
        explicit = body.base_station_id if body.mode == "modify" or body.base_station_id else None
        base_id, auto_bpm = match_base_station(f"{body.name} {body.description} {body.prompt}", explicit, valid_ids)
        bpm = body.bpm or auto_bpm
        slug = _slugify(body.name)
        prompt = (body.prompt or body.description or body.name).strip()
        pills = [
            {"title": p.title.strip(), "url": p.url.strip(), "note": p.note.strip()}
            for p in body.pills
            if p.url.strip() or p.note.strip() or p.title.strip()
        ]
        now = int(time.time())
        with self.db.connect() as conn:
            conn.execute(
                """INSERT INTO custom_radios
                   (slug, owner_key, name, creator_name, mode, description, prompt,
                    base_station_id, bpm, density, brightness, host, pills_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    slug, owner_key, body.name.strip(), body.creator_name.strip(),
                    body.mode if body.mode in ("describe", "modify") else "describe",
                    body.description.strip(), prompt, base_id, int(bpm),
                    float(body.density), float(body.brightness),
                    body.host.strip() or "Kuba", json.dumps(pills, ensure_ascii=False), now,
                ),
            )
            row = conn.execute("SELECT * FROM custom_radios WHERE slug = ?", (slug,)).fetchone()
        return self._row_to_dict(row)

    def get(self, slug: str) -> dict[str, Any] | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM custom_radios WHERE slug = ?", (slug,)).fetchone()
        return self._row_to_dict(row) if row else None

    def list_recent(self, limit: int = 30) -> list[dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM custom_radios ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def add_pill(self, slug: str, owner_key: str, pill: PillItemInput) -> dict[str, Any]:
        cur = self.get(slug)
        if not cur:
            raise KeyError(slug)
        if cur["owner_key"] != owner_key:
            raise PermissionError("Tylko twórca stacji może dodawać do niej stałe pigułki")
        pills = list(cur.get("pills") or [])
        pills.insert(0, {"title": pill.title.strip(), "url": pill.url.strip(), "note": pill.note.strip()})
        pills = pills[:30]
        with self.db.connect() as conn:
            conn.execute("UPDATE custom_radios SET pills_json = ? WHERE slug = ?", (json.dumps(pills, ensure_ascii=False), slug))
        return self.get(slug) or cur


def build_custom_radios_router(service: CustomRadioService, access: AccessService | None = None) -> APIRouter:
    router = APIRouter(prefix="/radio-api/custom-radios", tags=["custom-radios"])
    public_base = os.environ.get("DOSRADIO_PUBLIC_URL", "https://dosradio.theones.io").rstrip("/")

    @router.get("")
    async def list_radios() -> dict[str, Any]:
        items = service.list_recent(30)
        for it in items:
            it["share_url"] = f"{public_base}/orbita.html?r={it['slug']}"
            it["classic_url"] = f"{public_base}/?r={it['slug']}"
        return {"radios": items}

    @router.post("")
    async def create_radio(body: CreateCustomRadioBody, request: Request) -> dict[str, Any]:
        owner = resolve_actor_key(request, access, service.db)
        radio = service.create(owner, body)
        share_url = f"{public_base}/orbita.html?r={radio['slug']}"
        classic_url = f"{public_base}/?r={radio['slug']}"
        return {"slug": radio["slug"], "radio": radio, "share_url": share_url, "classic_url": classic_url}

    @router.get("/{slug}")
    async def get_radio(slug: str) -> dict[str, Any]:
        radio = service.get(slug)
        if not radio:
            raise HTTPException(404, "Nie znaleziono tej stacji autorskiej")
        radio["share_url"] = f"{public_base}/orbita.html?r={slug}"
        radio["classic_url"] = f"{public_base}/?r={slug}"
        return {"radio": radio}

    @router.post("/{slug}/pills")
    async def append_radio_pill(slug: str, body: PillItemInput, request: Request) -> dict[str, Any]:
        owner = resolve_actor_key(request, access, service.db)
        try:
            updated = service.add_pill(slug, owner, body)
        except KeyError:
            raise HTTPException(404, "Nie znaleziono stacji")
        except PermissionError as exc:
            raise HTTPException(403, str(exc))
        return {"radio": updated}

    return router
