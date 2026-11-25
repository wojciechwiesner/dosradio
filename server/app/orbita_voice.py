from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .hosts import BORROWED_HOSTS, HOSTS, Host, host_for
from .orbita_scripts import (
    NUDGE_5MIN,
    PODCAST_TITLES,
    STOIC_TITLES,
    intro_lines,
    norm_lang as _norm_lang,
    podcast_script as _podcast_script,
    stoic_script as _stoic_script,
)

logger = logging.getLogger("dosradio.orbita_voice")

Speak = Callable[[str, str, str], Awaitable[bytes]]
CACHE_HEADERS = {"Cache-Control": "public, max-age=86400"}


def _valid_station(station_id: str) -> bool:
    return station_id in HOSTS or station_id in BORROWED_HOSTS


def _showcase_hosts(kind: str) -> tuple[Host, Host]:
    if kind == "stoic":
        return HOSTS["stoa"], HOSTS["lofi-nauka"]
    return HOSTS["dos-groove"], HOSTS["lofi-nauka"]


def _showcase_spoken_turns(kind: str, lang: str) -> list[tuple[str, str]]:
    host_a, host_b = _showcase_hosts(kind)
    raw = _stoic_script(lang) if kind == "stoic" else _podcast_script(host_a.name, host_b.name, lang)
    return [(item[0], item[1]) for item in raw if len(item) == 2]


def _clip_path(orbita_dir: Path, prefix: str, voice: str, text: str) -> Path:
    digest = hashlib.sha1(f"{voice}:{text}".encode("utf-8")).hexdigest()[:8]
    return orbita_dir / f"{prefix}-{digest}.wav"


class _OrbitaVoiceStore:
    def __init__(self, speak: Speak, audio_dir: Path) -> None:
        self._speak = speak
        self._dir = audio_dir / "orbita"
        self._locks: dict[Path, asyncio.Lock] = {}
        self._bg_tasks: set[asyncio.Task[None]] = set()

    def _lock_for(self, path: Path) -> asyncio.Lock:
        lock = self._locks.get(path)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[path] = lock
        return lock

    async def ensure(self, path: Path, text: str, host: Host) -> Path:
        if path.exists() and path.stat().st_size > 44:
            return path
        async with self._lock_for(path):
            if path.exists() and path.stat().st_size > 44:
                return path
            self._dir.mkdir(parents=True, exist_ok=True)
            try:
                wav = await self._speak(text, host.voice, host.style)
            except Exception as exc:
                logger.warning("Orbita clip failed (%s): %s", path.name, exc)
                raise HTTPException(502, f"Nie udało się nagrać głosu: {exc}") from exc
            tmp = path.with_suffix(".wav.tmp")
            tmp.write_bytes(wav)
            tmp.replace(path)
            return path

    def warm_background(self, items: list[tuple[Path, str, Host]]) -> None:
        pending = [(p, txt, h) for p, txt, h in items if not (p.exists() and p.stat().st_size > 44)]
        if not pending:
            return

        async def _runner() -> None:
            for p, txt, h in pending:
                try:
                    await self.ensure(p, txt, h)
                except Exception as exc:
                    logger.debug("Background warm skipped (%s): %s", p.name, exc)

        task = asyncio.create_task(_runner())
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)

    def intro_item(self, station_id: str, index: int, lang: str) -> tuple[Path, str, Host, list[str]]:
        if not _valid_station(station_id):
            raise KeyError(station_id)
        code = _norm_lang(lang)
        host = host_for(station_id)
        lines = intro_lines(host.name, code)
        if index < 0 or index >= len(lines):
            raise KeyError(index)
        text = lines[index]
        path = _clip_path(self._dir, f"intro-{code}-{station_id}-{index}", host.voice, text)
        return path, text, host, lines

    def showcase_item(self, kind: str, index: int, lang: str) -> tuple[Path, str, Host, int]:
        if kind not in {"podcast", "stoic"}:
            raise KeyError(kind)
        code = _norm_lang(lang)
        turns = _showcase_spoken_turns(kind, code)
        if index < 0 or index >= len(turns):
            raise KeyError(index)
        who, text = turns[index]
        host_a, host_b = _showcase_hosts(kind)
        host = host_a if who == "A" else host_b
        path = _clip_path(self._dir, f"showcase-{code}-{kind}-{index}", host.voice, text)
        return path, text, host, len(turns)


def build_orbita_voice_router(speak: Speak, audio_dir: Path) -> APIRouter:
    router = APIRouter(prefix="/radio-api")
    store = _OrbitaVoiceStore(speak, audio_dir)

    @router.get("/orbita/intro/{station_id}/{index}.wav")
    async def get_orbita_intro(station_id: str, index: int, lang: str = "pl") -> FileResponse:
        code = _norm_lang(lang)
        try:
            path, text, host, lines = store.intro_item(station_id, index, code)
        except KeyError as exc:
            raise HTTPException(404, "Nieznana stacja lub indeks powitania") from exc
        if index == 0:
            next_items = [store.intro_item(station_id, i, code)[:3] for i in range(1, len(lines))]
            store.warm_background(next_items)
        out = await store.ensure(path, text, host)
        return FileResponse(out, media_type="audio/wav", headers=CACHE_HEADERS)

    @router.get("/orbita/nudge/{slug}.wav")
    async def get_orbita_nudge(slug: str, station: str = "dos-groove", lang: str = "pl") -> FileResponse:
        if slug != "5min":
            raise HTTPException(404, "Nieznany komunikat")
        if not _valid_station(station):
            raise HTTPException(404, "Nieznana stacja")
        code = _norm_lang(lang)
        host = host_for(station)
        text = NUDGE_5MIN[code]
        path = _clip_path(store._dir, f"nudge-{code}-{station}-{slug}", host.voice, text)
        out = await store.ensure(path, text, host)
        return FileResponse(out, media_type="audio/wav", headers=CACHE_HEADERS)

    @router.get("/showcase")
    async def get_showcase(lang: str = "pl") -> dict[str, object]:
        code = _norm_lang(lang)

        def _pack(kind: str, item_id: str, title: str) -> dict[str, object]:
            host_a, host_b = _showcase_hosts(kind)
            raw = _stoic_script(code) if kind == "stoic" else _podcast_script(host_a.name, host_b.name, code)
            parts: list[dict[str, object]] = []
            voice_idx = 0
            for entry in raw:
                if entry[0] == "music":
                    parts.append({"kind": "music", "sec": 5})
                else:
                    parts.append({
                        "kind": "voice",
                        "who": entry[0],
                        "text": entry[1],
                        "url": f"/radio-api/showcase/{kind}/{voice_idx}.wav?lang={code}",
                    })
                    voice_idx += 1
            return {"id": item_id, "title": title, "parts": parts}

        return {
            "podcast": _pack("podcast", "showcase-podcast", PODCAST_TITLES[code]),
            "stoic": _pack("stoic", "showcase-stoic", STOIC_TITLES[code]),
        }

    @router.get("/showcase/{kind}/{index}.wav")
    async def get_showcase_clip(kind: str, index: int, lang: str = "pl") -> FileResponse:
        code = _norm_lang(lang)
        try:
            path, text, host, total = store.showcase_item(kind, index, code)
        except KeyError as exc:
            raise HTTPException(404, "Nieznany odcinek pokazowy") from exc
        ahead = [
            store.showcase_item(kind, nxt, code)[:3]
            for nxt in (index + 1, index + 2)
            if nxt < total
        ]
        store.warm_background(ahead)
        out = await store.ensure(path, text, host)
        return FileResponse(out, media_type="audio/wav", headers=CACHE_HEADERS)

    return router


async def prewarm_orbita_voice(speak: Speak, audio_dir: Path) -> None:
    store = _OrbitaVoiceStore(speak, audio_dir)
    for idx in range(4):
        try:
            p, txt, h, _ = store.intro_item("dos-groove", idx, "pl")
            await store.ensure(p, txt, h)
        except Exception as exc:
            logger.warning("Prewarm dos-groove intro %d failed: %s", idx, exc)
    for kind in ("podcast", "stoic"):
        turns = _showcase_spoken_turns(kind, "pl")
        for idx in range(len(turns)):
            try:
                p, txt, h, _ = store.showcase_item(kind, idx, "pl")
                await store.ensure(p, txt, h)
            except Exception as exc:
                logger.warning("Prewarm showcase %s/%d failed: %s", kind, idx, exc)
