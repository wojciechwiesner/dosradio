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
import shutil
import signal
from collections.abc import Callable
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from .archive import ArchiveRegistry

log = logging.getLogger("dosradio.stream")

READ_CHUNK = 16 * 1024
MAX_QUEUE_CHUNKS = 16  # ~256 KB; a listener falling behind is dropped
SAMPLE_RATE = 48000

AccessGuard = Callable[[Request], None]


async def _kill(process: asyncio.subprocess.Process) -> None:
    """Kill a subprocess and the children it spawned (ffmpeg filter graphs)."""
    if process.returncode is not None:
        return
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        process.kill()
    await process.wait()


class StationStream:
    """One shared encoder per station; each subscriber gets its own queue."""

    def __init__(self, registry: ArchiveRegistry, station_id: str) -> None:
        self.registry = registry
        self.station_id = station_id
        self._subscribers: set[asyncio.Queue[bytes | None]] = set()
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

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

    async def _feed(self, encoder: asyncio.subprocess.Process) -> None:
        """Decode archive segments to PCM in recording order, looping forever."""
        assert encoder.stdin is not None
        try:
            after: str | None = None
            while self._subscribers:
                archive = self.registry.get(self.station_id)
                path, _live = archive.pick_next(live_probability=0.0, after=after)
                if path is None:
                    await asyncio.sleep(2)
                    continue
                after = None if path.name == after else path.name
                decoder = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-hide_banner", "-loglevel", "error",
                    "-i", str(path), "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "2", "pipe:1",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                    start_new_session=True,
                )
                assert decoder.stdout is not None
                while self._subscribers:
                    pcm = await decoder.stdout.read(READ_CHUNK)
                    if not pcm:
                        break
                    encoder.stdin.write(pcm)
                    await encoder.stdin.drain()
                await _kill(decoder)
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
    async def station_stream(request: Request, station_id: str, seconds: int = 0) -> StreamingResponse:
        """One continuous Ogg/Opus stream of the station's recorded music.

        `seconds` caps the length (16-bit stereo at SAMPLE_RATE); the player
        omits it and listens indefinitely.
        """
        if shutil.which("ffmpeg") is None:
            raise HTTPException(503, "ffmpeg niedostępny")
        if registry.get(station_id).list_segments() == []:
            raise HTTPException(404, f"Nieznana lub pusta stacja: {station_id}")
        require_access(request)
        max_bytes = seconds * SAMPLE_RATE * 2 * 2 if 0 < seconds <= 30 else None
        return StreamingResponse(
            hub.stream_for(station_id).subscribe(max_bytes),
            media_type="audio/ogg",
            headers={"cache-control": "no-store", "x-dosradio-stream": "continuous"},
        )

    return router
