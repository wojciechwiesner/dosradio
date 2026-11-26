"""Continuous Ogg/Opus stream per station or music group, shared by every listener.

One ffmpeg encoder per channel reads decoded archive segments (PCM) and emits a
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
import time
from collections.abc import Callable
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
import numpy as np

from .archive import ArchiveRegistry, StationArchive
from .hosts import BORROWED_HOSTS
from .mixer import float_to_pcm, join_intra_session, join_recordings, pcm_to_float

log = logging.getLogger("dosradio.stream")

READ_CHUNK = 16 * 1024
MAX_QUEUE_CHUNKS = 16  # ~256 KB; a listener falling behind is dropped
SAMPLE_RATE = 48000
MIX_RESERVE_SECONDS = 26.0
CHUNK_FRAMES = 24000  # 0.5s of audio per write to encoder.stdin
MIN_INTRA_GAP_NS = 15 * 1_000_000_000
SESSION_GAP_NS = 45 * 1_000_000_000  # same gap rule as scripts/scan_steady_tones.py
GROUP_ROTATE_SEGMENTS = 6            # rotate to next station in group every ~3 minutes
SEGMENT_STAMP_PREFIX = len("seg-")
SEGMENT_STAMP_SUFFIX = len(".opus")
SEEK_FRESH = "fresh"
OGG_CAPTURE = b"OggS"
OGG_PAGE_HEADER_BYTES = 27
OGG_SEGMENT_COUNT_OFFSET = 26
OGG_HEADER_PAGES = 2  # OpusHead + OpusTags: a decoder cannot start without both

AccessGuard = Callable[[Request], None]
GroupResolver = Callable[[str], list[str]]


def split_ogg_pages(data: bytes) -> tuple[list[bytes], bytes]:
    """Split a byte stream into complete Ogg pages plus the trailing partial page (kept for the next call)."""
    pages: list[bytes] = []
    pos = 0
    while True:
        if len(data) - pos < OGG_PAGE_HEADER_BYTES:
            break
        if data[pos:pos + 4] != OGG_CAPTURE:
            nxt = data.find(OGG_CAPTURE, pos + 1)
            if nxt < 0:
                return pages, b""
            pos = nxt
            continue
        segments = data[pos + OGG_SEGMENT_COUNT_OFFSET]
        header_len = OGG_PAGE_HEADER_BYTES + segments
        if len(data) - pos < header_len:
            break
        body_len = sum(data[pos + OGG_PAGE_HEADER_BYTES:pos + header_len])
        end = pos + header_len + body_len
        if len(data) < end:
            break
        pages.append(data[pos:end])
        pos = end
    return pages, data[pos:]


def _segment_stamp(path: Path) -> int:
    try:
        return int(path.name[SEGMENT_STAMP_PREFIX:-SEGMENT_STAMP_SUFFIX])
    except ValueError:
        return 0


def is_intra_session_step(prev_stamp: int | None, next_stamp: int) -> bool:
    """True when `next_stamp` is the immediate 30s continuation of the same Lyria take."""
    if prev_stamp is None or prev_stamp <= 0 or next_stamp <= prev_stamp:
        return False
    gap = next_stamp - prev_stamp
    return MIN_INTRA_GAP_NS <= gap <= SESSION_GAP_NS


def session_starts(paths: list[Path]) -> list[Path]:
    """Segments that open a Lyria session: the first one, or one after a gap over SESSION_GAP_NS."""
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


def _playable_archive_for(registry: ArchiveRegistry, station_id: str) -> StationArchive | None:
    arch = registry.get(station_id)
    if arch.list_segments():
        return arch
    fallback_sid = BORROWED_HOSTS.get(station_id, (None, None))[0]
    if fallback_sid:
        fb = registry.get(fallback_sid)
        if fb.list_segments():
            return fb
    return None


class StationStream:
    """One shared encoder per station or group; each subscriber gets its own queue."""

    def __init__(
        self,
        registry: ArchiveRegistry,
        station_id: str,
        fresh_start: bool = False,
        pace: bool = True,
        station_pool_fn: Callable[[], list[str]] | None = None,
        codec: str = "ogg",
    ) -> None:
        self.registry = registry
        self.station_id = station_id
        self._station_pool_fn = station_pool_fn
        self.codec = codec if codec in ("ogg", "mp3") else "ogg"
        self._subscribers: set[asyncio.Queue[bytes | None]] = set()
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._fresh_start_pending = fresh_start
        self.pace = pace
        self._header_pages: list[bytes] = []
        self._page_tail = b""

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def subscribe(self, max_bytes: int | None = None) -> AsyncIterator[bytes]:
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=MAX_QUEUE_CHUNKS)
        async with self._lock:
            if self._task is not None and not self._task.done() and len(self._header_pages) >= OGG_HEADER_PAGES:
                queue.put_nowait(b"".join(self._header_pages))
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
        if chunk is None:
            self._header_pages = []
            self._page_tail = b""
            for queue in list(self._subscribers):
                self._offer(queue, None)
            return
        if self.codec == "mp3":
            for queue in list(self._subscribers):
                self._offer(queue, chunk)
            return
        pages, self._page_tail = split_ogg_pages(self._page_tail + chunk)
        if not pages:
            return
        if len(self._header_pages) < OGG_HEADER_PAGES:
            self._header_pages.extend(pages[:OGG_HEADER_PAGES - len(self._header_pages)])
        whole = b"".join(pages)
        for queue in list(self._subscribers):
            self._offer(queue, whole)

    def _offer(self, queue: asyncio.Queue[bytes | None], chunk: bytes | None) -> None:
        try:
            queue.put_nowait(chunk)
        except asyncio.QueueFull:
            # REGRESSION INVARIANT: never raise here. The queue that overflowed is still full, so the
            # end-of-stream marker needs room first; a raise would kill `_run` for every listener.
            self._subscribers.discard(queue)
            while not queue.empty():
                queue.get_nowait()
            queue.put_nowait(None)

    async def _run(self) -> None:
        enc_args = (
            ["-c:a", "libmp3lame", "-b:a", "160k", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1"]
            if self.codec == "mp3"
            else ["-c:a", "libopus", "-b:a", "96k", "-f", "ogg", "pipe:1"]
        )
        encoder = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0",
            *enc_args,
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

    def _pick_pool_station(self, exclude: str | None = None) -> str:
        if not self._station_pool_fn:
            return self.station_id
        pool = [sid for sid in self._station_pool_fn() if _playable_archive_for(self.registry, sid) is not None]
        if not pool:
            return self.station_id
        others = [sid for sid in pool if sid != exclude]
        return random.choice(others or pool)

    async def _feed(self, encoder: asyncio.subprocess.Process) -> None:
        """Decode and mix archive segments to PCM, streaming seamlessly forever."""
        assert encoder.stdin is not None
        try:
            current_sid = self._pick_pool_station()
            after: str | None = None
            prev_stamp: int | None = None
            prev_arch_id: str | None = None
            segments_on_current = 0
            buffer: np.ndarray | None = None
            reserve_frames = int(MIX_RESERVE_SECONDS * SAMPLE_RATE)

            next_deadline = time.monotonic()
            while self._subscribers:
                if self._station_pool_fn and segments_on_current >= GROUP_ROTATE_SEGMENTS:
                    next_sid = self._pick_pool_station(exclude=current_sid)
                    if next_sid != current_sid:
                        current_sid = next_sid
                        after = None
                        segments_on_current = 0
                        self._fresh_start_pending = True

                archive = _playable_archive_for(self.registry, current_sid) or self.registry.get(current_sid)

                if buffer is None or len(buffer) <= reserve_frames:
                    path = self._take_fresh_start(archive)
                    if path is None:
                        path, _live = archive.pick_next(live_probability=0.0, after=after)
                    if path is not None:
                        after = None if path.name == after else path.name
                        stamp = _segment_stamp(path)
                        new_pcm = await _decode_to_pcm(path)
                        if new_pcm is not None and len(new_pcm) > 0:
                            same_take = (
                                prev_arch_id == archive.station_id
                                and is_intra_session_step(prev_stamp, stamp)
                            )
                            if buffer is None or len(buffer) == 0:
                                buffer = new_pcm
                            elif same_take:
                                buffer = await asyncio.to_thread(join_intra_session, buffer, new_pcm)
                            else:
                                buffer = await asyncio.to_thread(
                                    join_recordings, buffer, new_pcm, None, prev_arch_id, archive.station_id
                                )
                            prev_stamp = stamp
                            prev_arch_id = archive.station_id
                            segments_on_current += 1

                if buffer is None or len(buffer) == 0:
                    await asyncio.sleep(1)
                    next_deadline = time.monotonic()
                    continue

                chunk_size = min(CHUNK_FRAMES, len(buffer))
                chunk = buffer[:chunk_size]
                buffer = buffer[chunk_size:]
                encoder.stdin.write(float_to_pcm(chunk))
                await encoder.stdin.drain()

                if self.pace:
                    chunk_dur = len(chunk) / SAMPLE_RATE
                    next_deadline += chunk_dur
                    delay = next_deadline - time.monotonic()
                    if delay > 0:
                        await asyncio.sleep(delay)
                    elif delay < -1.0:
                        next_deadline = time.monotonic()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            encoder.stdin.close()


class StreamHub:
    def __init__(self, registry: ArchiveRegistry, pace: bool = True, group_resolver: GroupResolver | None = None) -> None:
        self.registry = registry
        self.pace = pace
        self.group_resolver = group_resolver
        self._streams: dict[str, StationStream] = {}

    def stream_for(self, station_id: str, codec: str = "ogg") -> StationStream:
        key = station_id if codec == "ogg" else f"{station_id}:{codec}"
        stream = self._streams.get(key)
        if stream is None:
            stream = StationStream(self.registry, station_id, pace=self.pace, codec=codec)
            self._streams[key] = stream
        return stream

    def group_stream_for(self, group_id: str, codec: str = "ogg") -> StationStream:
        key = f"group:{group_id}" if codec == "ogg" else f"group:{group_id}:{codec}"
        stream = self._streams.get(key)
        if stream is None:
            resolver = self.group_resolver
            stream = StationStream(
                self.registry,
                station_id=key,
                fresh_start=True,
                pace=self.pace,
                station_pool_fn=(lambda gid=group_id: resolver(gid) if resolver else []),
                codec=codec,
            )
            self._streams[key] = stream
        return stream

    def active_counts(self) -> dict[str, int]:
        return {k: s.subscriber_count for k, s in self._streams.items() if s.subscriber_count > 0}


def build_stream_router(
    registry: ArchiveRegistry,
    require_access: AccessGuard,
    pace: bool = True,
    group_resolver: GroupResolver | None = None,
    hub_out: list[StreamHub] | None = None,
) -> APIRouter:
    router = APIRouter()
    hub = StreamHub(registry, pace=pace, group_resolver=group_resolver)
    if hub_out is not None:
        hub_out.append(hub)

    @router.get("/radio-api/station/{station_id}/stream.{ext}")
    async def station_stream(
        request: Request, station_id: str, ext: str, seconds: int = 0, seek: str = ""
    ) -> StreamingResponse:
        """One continuous DJ-mixed Ogg/Opus or MP3 stream of the station's recorded music."""
        if ext not in ("ogg", "mp3"):
            raise HTTPException(404, f"Nieobsługiwany format streamu: {ext}")
        if shutil.which("ffmpeg") is None:
            raise HTTPException(503, "ffmpeg niedostępny")
        if _playable_archive_for(registry, station_id) is None:
            raise HTTPException(404, f"Nieznana lub pusta stacja: {station_id}")
        require_access(request)
        max_bytes = seconds * SAMPLE_RATE * 2 * 2 if 0 < seconds <= 30 else None
        if seek == SEEK_FRESH:
            stream = StationStream(registry, station_id, fresh_start=True, pace=pace, codec=ext)
        else:
            stream = hub.stream_for(station_id, codec=ext)
        return StreamingResponse(
            stream.subscribe(max_bytes),
            media_type="audio/mpeg" if ext == "mp3" else "audio/ogg",
            headers={"cache-control": "no-store", "x-dosradio-stream": "continuous"},
        )

    @router.get("/radio-api/group/{group_id}/stream.{ext}")
    async def group_stream(
        request: Request, group_id: str, ext: str, seconds: int = 0
    ) -> StreamingResponse:
        """Continuous DJ-mixed Ogg/Opus or MP3 stream rotating across all playable stations in a music group."""
        if ext not in ("ogg", "mp3"):
            raise HTTPException(404, f"Nieobsługiwany format streamu: {ext}")
        if shutil.which("ffmpeg") is None:
            raise HTTPException(503, "ffmpeg niedostępny")
        stations = group_resolver(group_id) if group_resolver else []
        playable = [sid for sid in stations if _playable_archive_for(registry, sid) is not None]
        if not playable:
            raise HTTPException(404, f"Nieznana lub pusta grupa muzyczna: {group_id}")
        require_access(request)
        max_bytes = seconds * SAMPLE_RATE * 2 * 2 if 0 < seconds <= 30 else None
        stream = hub.group_stream_for(group_id, codec=ext)
        return StreamingResponse(
            stream.subscribe(max_bytes),
            media_type="audio/mpeg" if ext == "mp3" else "audio/ogg",
            headers={"cache-control": "no-store", "x-dosradio-stream": "group-continuous", "x-dosradio-group": group_id},
        )

    return router
