from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from .auth import client_ip
from .hosts import Host, host_for

logger = logging.getLogger("dosradio.dedications")

Speak = Callable[[str, str, str], Awaitable[bytes]]
StationLookup = Callable[[str], dict[str, Any] | None]
CACHE_HEADERS = {"Cache-Control": "public, max-age=86400"}
LANGS = {"pl", "en", "ru"}
MAX_PER_HOUR_PER_IP = 20

_STRIP_CTRL_RE = re.compile(r"[\x00-\x1f\x7f<>]")
_EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\U00002700-\U000027BF\U0001F1E6-\U0001F1FF]"
)


def _clean_text(raw: str) -> str:
    cleaned = _EMOJI_RE.sub("", _STRIP_CTRL_RE.sub("", raw))
    return re.sub(r"\s+", " ", cleaned).strip()


class DedicationCreate(BaseModel):
    station_id: str = Field(..., min_length=1, max_length=64)
    to_name: str = Field(..., min_length=1, max_length=40)
    from_name: str = Field(..., min_length=1, max_length=40)
    message: str = Field(default="", max_length=200)
    lang: str = Field(default="pl", max_length=5)

    @field_validator("to_name", "from_name")
    @classmethod
    def _validate_names(cls, v: str) -> str:
        cleaned = _clean_text(v)
        if not cleaned:
            raise ValueError("Imię nie może być puste.")
        if len(cleaned) > 40:
            raise ValueError("Imię może mieć maksymalnie 40 znaków.")
        return cleaned

    @field_validator("message")
    @classmethod
    def _validate_message(cls, v: str) -> str:
        cleaned = _clean_text(v)
        if len(cleaned) > 200:
            raise ValueError("Dedykacja może mieć maksymalnie 200 znaków.")
        return cleaned


def build_dedication_script(
    host_name: str,
    station_name: str,
    to_name: str,
    from_name: str,
    message: str,
    lang: str,
) -> str:
    code = lang if lang in LANGS else "pl"
    if code == "en":
        if message:
            return (
                f"Hey {to_name}! This is {host_name} on AmbiRadio. "
                f"{from_name} sends warm greetings and shares the station {station_name} especially for you, "
                f"with a message: \"{message}\". Make yourself comfortable — this music is playing live for you right now. Enjoy the listen!"
            )
        return (
            f"Hey {to_name}! This is {host_name} on AmbiRadio. "
            f"{from_name} sends warm greetings and invites you to listen to {station_name} together. "
            "Make yourself comfortable — the music is playing live for you right now!"
        )
    if code == "ru":
        if message:
            return (
                f"Привет, {to_name}! Это {host_name} на AmbiRadio. "
                f"{from_name} передаёт тебе тёплый привет и делится станцией {station_name} со словами: «{message}». "
                "Устраивайся поудобнее — эта музыка звучит специально для тебя. Приятного прослушивания!"
            )
        return (
            f"Привет, {to_name}! Это {host_name} на AmbiRadio. "
            f"{from_name} передаёт тебе тёплый привет и приглашает послушать станцию {station_name}. "
            "Устраивайся поудобнее — музыка уже играет для тебя!"
        )
    if message:
        return (
            f"Cześć {to_name}! Tu {host_name} z AmbiRadio. "
            f"Mam dla ciebie gorące pozdrowienia od {from_name}, który udostępnia specjalnie dla ciebie stację {station_name} "
            f"z dedykacją: „{message}”. Rozgość się i podkręć głośność — to jest twoja chwila, zapraszam do słuchania!"
        )
    return (
        f"Cześć {to_name}! Tu {host_name} z AmbiRadio. "
        f"{from_name} przesyła ci gorące pozdrowienia i udostępnia specjalnie dla ciebie stację {station_name}. "
        "Rozgość się i zostań z nami — muzyka gra już specjalnie dla ciebie!"
    )


class DedicationStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS station_dedications (
                    id TEXT PRIMARY KEY,
                    station_id TEXT NOT NULL,
                    station_name TEXT NOT NULL,
                    host_name TEXT NOT NULL,
                    to_name TEXT NOT NULL,
                    from_name TEXT NOT NULL,
                    message TEXT NOT NULL DEFAULT '',
                    lang TEXT NOT NULL DEFAULT 'pl',
                    script TEXT NOT NULL,
                    ip_hash TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL
                )
                """
            )

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def count_recent_by_ip(self, ip_hash: str, window_sec: int = 3600) -> int:
        cutoff = int(time.time()) - window_sec
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM station_dedications WHERE ip_hash = ? AND created_at >= ?",
                (ip_hash, cutoff),
            ).fetchone()
            return int(row["n"]) if row else 0

    def create(
        self,
        *,
        station_id: str,
        station_name: str,
        host_name: str,
        to_name: str,
        from_name: str,
        message: str,
        lang: str,
        script: str,
        ip_hash: str,
    ) -> dict[str, Any]:
        token = secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10]
        if len(token) < 8:
            token = secrets.token_hex(5)
        now = int(time.time())
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO station_dedications
                    (id, station_id, station_name, host_name, to_name, from_name, message, lang, script, ip_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (token, station_id, station_name, host_name, to_name, from_name, message, lang, script, ip_hash, now),
            )
        return self.get(token)  # type: ignore[return-value]

    def get(self, token: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM station_dedications WHERE id = ?",
                (token,),
            ).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "station_id": row["station_id"],
            "station_name": row["station_name"],
            "host_name": row["host_name"],
            "to_name": row["to_name"],
            "from_name": row["from_name"],
            "message": row["message"],
            "lang": row["lang"],
            "script": row["script"],
            "created_at": row["created_at"],
            "audio_url": f"/radio-api/dedications/{row['id']}/greeting.wav",
            "share_url": f"/orbita.html?d={row['id']}",
            "classic_share_url": f"/?d={row['id']}",
        }


def build_dedications_router(
    speak: Speak,
    audio_dir: Path,
    db_path: Path,
    station_lookup: StationLookup,
) -> APIRouter:
    router = APIRouter(prefix="/radio-api")
    store = DedicationStore(db_path)
    out_dir = audio_dir / "dedications"
    locks: dict[str, asyncio.Lock] = {}
    bg_tasks: set[asyncio.Task[None]] = set()

    def _lock(token: str) -> asyncio.Lock:
        lk = locks.get(token)
        if lk is None:
            lk = asyncio.Lock()
            locks[token] = lk
        return lk

    async def _ensure_wav(row: dict[str, Any]) -> Path:
        token = str(row["id"])
        path = out_dir / f"{token}.wav"
        if path.exists() and path.stat().st_size > 44:
            return path
        async with _lock(token):
            if path.exists() and path.stat().st_size > 44:
                return path
            out_dir.mkdir(parents=True, exist_ok=True)
            host: Host = host_for(row["station_id"])
            try:
                wav = await speak(row["script"], host.voice, host.style)
            except Exception as exc:
                logger.warning("Dedication TTS failed (%s): %s", token, exc)
                raise HTTPException(502, f"Nie udało się nagrać pozdrowień: {exc}") from exc
            tmp = path.with_suffix(".wav.tmp")
            tmp.write_bytes(wav)
            tmp.replace(path)
            return path

    @router.post("/dedications", status_code=status.HTTP_201_CREATED)
    async def create_dedication(body: DedicationCreate, request: Request) -> dict[str, Any]:
        st = station_lookup(body.station_id.strip())
        if st is None:
            raise HTTPException(404, "Nieznana stacja")
        ip = client_ip(dict(request.headers), request.client.host if request.client else None)
        ip_hash = hashlib.sha256(f"ded:{ip}".encode("utf-8")).hexdigest()[:16]
        if store.count_recent_by_ip(ip_hash) >= MAX_PER_HOUR_PER_IP:
            raise HTTPException(429, "Zbyt wiele dedykacji w ciągu godziny. Spróbuj za chwilę.")
        lang = body.lang if body.lang in LANGS else "pl"
        host = host_for(st["id"])
        station_name = str(st.get("name") or st["id"])
        script = build_dedication_script(
            host_name=host.name,
            station_name=station_name,
            to_name=body.to_name,
            from_name=body.from_name,
            message=body.message,
            lang=lang,
        )
        created = store.create(
            station_id=st["id"],
            station_name=station_name,
            host_name=host.name,
            to_name=body.to_name,
            from_name=body.from_name,
            message=body.message,
            lang=lang,
            script=script,
            ip_hash=ip_hash,
        )

        async def _warm() -> None:
            try:
                await _ensure_wav(created)
            except Exception as exc:
                logger.debug("Dedication warm skipped (%s): %s", created["id"], exc)

        t = asyncio.create_task(_warm())
        bg_tasks.add(t)
        t.add_done_callback(bg_tasks.discard)
        return created

    @router.get("/dedications/{token}")
    async def get_dedication(token: str) -> dict[str, Any]:
        if not token.isalnum() or len(token) > 24:
            raise HTTPException(404, "Nie znaleziono dedykacji")
        row = store.get(token)
        if not row:
            raise HTTPException(404, "Nie znaleziono dedykacji")
        return row

    @router.get("/dedications/{token}/greeting.wav")
    async def get_dedication_audio(token: str) -> FileResponse:
        if not token.isalnum() or len(token) > 24:
            raise HTTPException(404, "Nie znaleziono dedykacji")
        row = store.get(token)
        if not row:
            raise HTTPException(404, "Nie znaleziono dedykacji")
        path = await _ensure_wav(row)
        return FileResponse(path, media_type="audio/wav", headers=CACHE_HEADERS)

    return router
