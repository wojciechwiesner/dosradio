"""Continuous Ogg/Opus stream per station, shared by every listener.

One ffmpeg encoder per station reads decoded archive segments (PCM) and emits a
single Ogg bitstream. Listeners fan out from that bitstream, so the stream is
one uninterrupted piece of audio — what a real <audio> element needs to keep
Android Chrome alive after the browser is closed.
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import shutil
import signal
from collections.abc import Callable
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
import numpy as np

from .archive import ArchiveRegistry
from .hosts import BORROWED_HOSTS
from .mixer import float_to_pcm, join_recordings, pcm_to_float

log = logging.getLogger("dosradio.stream")

READ_CHUNK = 16 * 1024
MAX_QUEUE_CHUNKS = 16  # ~256 KB; a listener falling behind is dropped
SAMPLE_RATE = 48000
MIX_RESERVE_SECONDS = 15.0
CHUNK_FRAMES = 24000  # 0.5s of audio per write to encoder.stdin
SESSION_GAP_NS = 45 * 1_000_000_000  # same gap rule as scripts/scan_steady_tones.py
SEGMENT_STAMP_PREFIX = len("seg-")
SEGMENT_STAMP_SUFFIX = len(".opus")
SEEK_FRESH = "fresh"

AccessGuard = Callable[[Request], None]


def _segment_stamp(path: Path) -> int:
    return int(path.name[SEGMENT_STAMP_PREFIX:-SEGMENT_STAMP_SUFFIX])


def session_starts(paths: list[Path]) -> list[Path]:
    """Segments that open a Lyria session: the first one, or one after a gap over SESSION_GAP_NS.

    Archive files carry no session marker, so the gap between timestamps is the only signal.
    """
    starts: list[Path] = []
    previous: int | None = None
    for path in paths:
        stamp = _segment_stamp(path)
        if previous is None or stamp - previous > SESSION_GAP_NS:
            starts.append(path)
        previous = stamp
    return starts


async def _kill(process: asyncio.subprocess.Process) -> None:
    """Kill a subprocess and the children it spawned (ffmpeg filter graphs)."""
    if process.returncode is not None:
        return
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        process.kill()
    await process.wait()


async def _decode_to_pcm(path: Path) -> np.ndarray | None:
    """Decode an audio segment to float32 stereo PCM at SAMPLE_RATE."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", str(path), "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "2", "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
        assert proc.stdout is not None
        raw = await proc.stdout.read()
        await _kill(proc)
        if not raw:
            return None
        return pcm_to_float(raw)
    except Exception as err:
        log.warning("Failed to decode %s: %s", path, err)
        return None


class StationStream:
    """One shared encoder per station; each subscriber gets its own queue."""

    def __init__(self, registry: ArchiveRegistry, station_id: str, fresh_start: bool = False) -> None:
        self.registry = registry
        self.station_id = station_id
        self._subscribers: set[asyncio.Queue[bytes | None]] = set()
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._fresh_start_pending = fresh_start

    async def subscribe(self, max_bytes: int | None = None) -> AsyncIterator[bytes]:
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=MAX_QUEUE_CHUNKS)
        async with self._lock:
            self._subscribers.add(queue)
            if self._task is None or self._task.done():
                self._task = asyncio.create_task(self._run())
        sent = 0
        try:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    return
                yield chunk
                sent += len(chunk)
                if max_bytes is not None and sent >= max_bytes:
                    return
        finally:
            self._subscribers.discard(queue)

    async def _publish(self, chunk: bytes | None) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(chunk)
            except asyncio.QueueFull:
                self._subscribers.discard(queue)
                queue.put_nowait(None)

    async def _run(self) -> None:
        encoder = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0",
            "-c:a", "libopus", "-b:a", "96k", "-f", "ogg", "pipe:1",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            await asyncio.gather(self._feed(encoder), self._drain(encoder))
        finally:
            await _kill(encoder)
            await self._publish(None)

    async def _drain(self, encoder: asyncio.subprocess.Process) -> None:
        assert encoder.stdout is not None
        while True:
            chunk = await encoder.stdout.read(READ_CHUNK)
            if not chunk:
                return
            await self._publish(chunk)

    def _take_fresh_start(self, archive: StationArchive) -> Path | None:
        if not self._fresh_start_pending:
            return None
        self._fresh_start_pending = False
        starts = session_starts(archive.list_segments())
        return random.choice(starts) if starts else None

    async def _feed(self, encoder: asyncio.subprocess.Process) -> None:
        """Decode and mix archive segments to PCM, streaming seamlessly forever."""
        assert encoder.stdin is not None
        try:
            after: str | None = None
            buffer: np.ndarray | None = None
            reserve_frames = int(MIX_RESERVE_SECONDS * SAMPLE_RATE)

            while self._subscribers:
                archive = self.registry.get(self.station_id)

                # Keep buffer filled with at least reserve_frames ahead
                if buffer is None or len(buffer) <= reserve_frames:
                    path = self._take_fresh_start(archive) if buffer is None else None
                    if path is None:
                        path, _live = archive.pick_next(live_probability=0.0, after=after)
                    if path is None:
                        fallback_sid = BORROWED_HOSTS.get(self.station_id, (None, None))[0]
                        if fallback_sid:
                            fb_archive = self.registry.get(fallback_sid)
                            path = self._take_fresh_start(fb_archive) if buffer is None else None
                            if path is None:
                                path, _live = fb_archive.pick_next(live_probability=0.0, after=after)
                    if path is not None:
                        after = None if path.name == after else path.name
                        new_pcm = await _decode_to_pcm(path)
                        if new_pcm is not None and len(new_pcm) > 0:
                            if buffer is None or len(buffer) == 0:
                                buffer = new_pcm
                            else:
                                buffer = await asyncio.to_thread(join_recordings, buffer, new_pcm)

                if buffer is None or len(buffer) == 0:
                    await asyncio.sleep(1)
                    continue

                chunk_size = min(CHUNK_FRAMES, len(buffer))
                chunk = buffer[:chunk_size]
                buffer = buffer[chunk_size:]
                encoder.stdin.write(float_to_pcm(chunk))
                await encoder.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            encoder.stdin.close()


class StreamHub:
    def __init__(self, registry: ArchiveRegistry) -> None:
        self.registry = registry
        self._streams: dict[str, StationStream] = {}

    def stream_for(self, station_id: str) -> StationStream:
        stream = self._streams.get(station_id)
        if stream is None:
            stream = StationStream(self.registry, station_id)
            self._streams[station_id] = stream
        return stream


def build_stream_router(registry: ArchiveRegistry, require_access: AccessGuard) -> APIRouter:
    router = APIRouter()
    hub = StreamHub(registry)

    @router.get("/radio-api/station/{station_id}/stream.ogg")
    async def station_stream(
        request: Request, station_id: str, seconds: int = 0, seek: str = ""
    ) -> StreamingResponse:
        """One continuous Ogg/Opus stream of the station's recorded music.

        `seconds` caps the length (16-bit stereo at SAMPLE_RATE); the player
        omits it and listens indefinitely. `seek=fresh` opens a private stream
        that starts at a Lyria session start instead of the shared position.
        """
        if shutil.which("ffmpeg") is None:
            raise HTTPException(503, "ffmpeg niedostępny")
        archive = registry.get(station_id)
        if not archive.list_segments():
            fallback_sid = BORROWED_HOSTS.get(station_id, (None, None))[0]
            if not fallback_sid or not registry.get(fallback_sid).list_segments():
                raise HTTPException(404, f"Nieznana lub pusta stacja: {station_id}")
        require_access(request)
        max_bytes = seconds * SAMPLE_RATE * 2 * 2 if 0 < seconds <= 30 else None
        if seek == SEEK_FRESH:
            stream = StationStream(registry, station_id, fresh_start=True)
        else:
            stream = hub.stream_for(station_id)
        return StreamingResponse(
            stream.subscribe(max_bytes),
            media_type="audio/ogg",
            headers={"cache-control": "no-store", "x-dosradio-stream": "continuous"},
        )

    return router
