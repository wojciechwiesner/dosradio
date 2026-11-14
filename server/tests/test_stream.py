"""The continuous station stream serves valid Ogg and honours access control."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException, Request
from httpx import ASGITransport, AsyncClient

from app.archive import ArchiveRegistry
from app.stream import StationStream, build_stream_router, session_starts

FIRST_SESSION_START = 1_700_000_000 * 1_000_000_000
SECOND_SESSION_START = FIRST_SESSION_START + 120 * 1_000_000_000
SESSION_SEGMENT_GAP = 30 * 1_000_000_000

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
    app.include_router(build_stream_router(registry, require_access, pace=False))
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
    app.include_router(build_stream_router(ArchiveRegistry(tmp_path), lambda request: None, pace=False))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://radio") as client:
        response = await client.get("/radio-api/station/nie-ma/stream.ogg")
    assert response.status_code == 404


def _archive_with_two_sessions(tmp_path: Path) -> ArchiveRegistry:
    registry = ArchiveRegistry(tmp_path)
    directory = registry.get("dos-groove").dir
    stamps = [
        FIRST_SESSION_START,
        FIRST_SESSION_START + SESSION_SEGMENT_GAP,
        SECOND_SESSION_START,
        SECOND_SESSION_START + SESSION_SEGMENT_GAP,
    ]
    for stamp in stamps:
        (directory / f"seg-{stamp}.opus").write_bytes(b"")
    return registry


def test_session_starts_are_first_segment_and_segments_after_long_gaps(tmp_path: Path) -> None:
    segments = _archive_with_two_sessions(tmp_path).get("dos-groove").list_segments()
    starts = session_starts(segments)
    assert [path.name for path in starts] == [
        f"seg-{FIRST_SESSION_START}.opus",
        f"seg-{SECOND_SESSION_START}.opus",
    ]


def test_fresh_start_is_taken_once_from_a_session_start(tmp_path: Path) -> None:
    registry = _archive_with_two_sessions(tmp_path)
    archive = registry.get("dos-groove")
    fresh = StationStream(registry, "dos-groove", fresh_start=True)
    first = fresh._take_fresh_start(archive)
    assert first is not None
    assert first.name in {f"seg-{FIRST_SESSION_START}.opus", f"seg-{SECOND_SESSION_START}.opus"}
    assert fresh._take_fresh_start(archive) is None


def test_shared_stream_never_takes_a_fresh_start(tmp_path: Path) -> None:
    registry = _archive_with_two_sessions(tmp_path)
    shared = StationStream(registry, "dos-groove")
    assert shared._take_fresh_start(registry.get("dos-groove")) is None


@pytest.mark.anyio
async def test_seek_fresh_serves_ogg(tmp_path: Path) -> None:
    app = _app(tmp_path, allow=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://radio", timeout=30) as client:
        response = await client.get("/radio-api/station/dos-groove/stream.ogg?seconds=1&seek=fresh&t=1")
    assert response.status_code == 200
    assert response.content[:4] == b"OggS"


@pytest.mark.anyio
async def test_empty_borrowed_station_falls_back_to_parent_station(tmp_path: Path) -> None:
    """A new station whose archive has not been recorded yet seamlessly borrows from its parent station."""
    app = _app(tmp_path, allow=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://radio", timeout=30) as client:
        response = await client.get("/radio-api/station/deep-tech/stream.ogg?seconds=1&t=1")
    assert response.status_code == 200
    assert response.content[:4] == b"OggS"
