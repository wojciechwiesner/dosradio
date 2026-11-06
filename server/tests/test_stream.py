"""The continuous station stream serves valid Ogg and honours access control."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException, Request
from httpx import ASGITransport, AsyncClient

from app.archive import ArchiveRegistry
from app.stream import build_stream_router

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg missing"),
]


def _opus_segment(directory: Path, name: str, frequency: int) -> None:
    """One second of sine wave, encoded as Ogg/Opus."""
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration=1:sample_rate=48000",
         "-c:a", "libopus", "-b:a", "64k", str(directory / name)],
        check=True,
    )


def _app(tmp_path: Path, allow: bool) -> FastAPI:
    registry = ArchiveRegistry(tmp_path)
    station_dir = tmp_path / "dos-groove"
    station_dir.mkdir()
    _opus_segment(station_dir, "seg-1.opus", 220)
    _opus_segment(station_dir, "seg-2.opus", 330)

    def require_access(request: Request) -> None:
        if not allow:
            raise HTTPException(402, "Trial ended")

    app = FastAPI()
    app.include_router(build_stream_router(registry, require_access))
    return app


async def test_stream_starts_with_ogg_page(tmp_path: Path) -> None:
    app = _app(tmp_path, allow=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://radio", timeout=30) as client:
        response = await client.get("/radio-api/station/dos-groove/stream.ogg?seconds=1")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/ogg")
    assert response.content[:4] == b"OggS"


async def test_stream_rejects_expired_trial(tmp_path: Path) -> None:
    app = _app(tmp_path, allow=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://radio") as client:
        response = await client.get("/radio-api/station/dos-groove/stream.ogg")
    assert response.status_code == 402


async def test_stream_unknown_station_is_404(tmp_path: Path) -> None:
    app = FastAPI()
    app.include_router(build_stream_router(ArchiveRegistry(tmp_path), lambda request: None))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://radio") as client:
        response = await client.get("/radio-api/station/nie-ma/stream.ogg")
    assert response.status_code == 404
