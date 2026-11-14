"""Host jingles and chatter clips: listed per station, voiced on first request, then cached forever."""
from __future__ import annotations

from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .hosts import BORROWED_HOSTS, HOSTS, Host, host_for

SpeakFn = Callable[[str, str, str], Awaitable[bytes]]

CLIP_CACHE_CONTROL = "public, max-age=604800"


def _host_or_404(station_id: str) -> Host:
    if station_id in HOSTS or station_id in BORROWED_HOSTS:
        return host_for(station_id)
    raise HTTPException(404, "no such station")


def _lines_or_404(host: Host, kind: str) -> tuple[str, ...]:
    if kind == "jingle":
        return host.jingles
    if kind == "chatter":
        return host.chatter
    raise HTTPException(404, "no such clip kind")


def _position_or_404(index: str, lines: tuple[str, ...]) -> int:
    if not (index.isascii() and index.isdigit()) or int(index) >= len(lines):
        raise HTTPException(404, "no such clip")
    return int(index)


def _clip_urls(station_id: str, kind: str, lines: tuple[str, ...]) -> list[str]:
    return [f"/radio-api/host-clip/{station_id}/{kind}/{position}.wav" for position in range(len(lines))]


def build_router(speak: SpeakFn, audio_dir: Path) -> APIRouter:
    router = APIRouter(prefix="/radio-api")

    @router.get("/host-clips/{station_id}")
    def list_clips(station_id: str) -> dict:
        host = _host_or_404(station_id)
        return {
            "jingles": _clip_urls(station_id, "jingle", host.jingles),
            "chatter": _clip_urls(station_id, "chatter", host.chatter),
        }

    @router.api_route("/host-clip/{station_id}/{kind}/{index}.wav", methods=["GET", "HEAD"])
    async def clip_audio(station_id: str, kind: str, index: str) -> FileResponse:
        host = _host_or_404(station_id)
        lines = _lines_or_404(host, kind)
        position = _position_or_404(index, lines)
        path = audio_dir / f"{kind}-{station_id}-{position}.wav"
        if not path.exists():
            try:
                audio = await speak(lines[position], host.voice, host.style)
            except Exception as error:
                raise HTTPException(502, f"Nie udało się nagrać klipu: {error}") from error
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(audio)
            tmp.replace(path)
        return FileResponse(path, media_type="audio/wav", headers={"cache-control": CLIP_CACHE_CONTROL})

    return router
