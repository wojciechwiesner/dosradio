"""A listener who joins a station stream that is already running must still get a decodable Ogg/Opus stream.

The encoder emits the Opus headers once, at its start. Without replaying them, every later listener receives
audio pages with no header and the browser's <audio> element waits forever (silence).
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

import pytest

from app.archive import ArchiveRegistry
from app.stream import StationStream, split_ogg_pages

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg missing"),
]

JOIN_AFTER_BYTES = 20_000
LATE_LISTENER_BYTES = 30_000


def _sine_ogg(path: Path, frequency: int, seconds: int = 1) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration={seconds}:sample_rate=48000",
         "-c:a", "libopus", "-b:a", "64k", str(path)],
        check=True,
    )


def _decode_ok(data: bytes) -> tuple[int, int]:
    """Returns (ffmpeg exit code, decoded PCM bytes)."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
        input=data, capture_output=True,
    )
    return proc.returncode, len(proc.stdout)


def test_split_ogg_pages_keeps_every_byte_and_starts_with_both_header_pages(tmp_path: Path) -> None:
    source = tmp_path / "x.ogg"
    _sine_ogg(source, 440, seconds=2)
    raw = source.read_bytes()
    pages, rest = split_ogg_pages(raw)
    assert b"".join(pages) + rest == raw
    assert all(page.startswith(b"OggS") for page in pages)
    assert b"OpusHead" in pages[0]
    assert b"OpusTags" in pages[1]


def test_split_ogg_pages_holds_back_a_partial_page(tmp_path: Path) -> None:
    source = tmp_path / "x.ogg"
    _sine_ogg(source, 440, seconds=2)
    raw = source.read_bytes()
    cut = len(raw) - 10
    pages, rest = split_ogg_pages(raw[:cut])
    assert b"".join(pages) + rest == raw[:cut]
    assert len(rest) > 0
    assert rest.startswith(b"OggS")


async def test_late_listener_gets_headers_and_decodable_audio(tmp_path: Path) -> None:
    registry = ArchiveRegistry(tmp_path)
    directory = tmp_path / "dos-groove"
    directory.mkdir()
    _sine_ogg(directory / "seg-1.opus", 220)
    _sine_ogg(directory / "seg-2.opus", 330)
    stream = StationStream(registry, "dos-groove", pace=False)

    first_bytes = bytearray()

    async def first_listener() -> None:
        async for chunk in stream.subscribe():
            first_bytes.extend(chunk)

    first_task = asyncio.create_task(first_listener())
    try:
        for _ in range(200):
            if len(first_bytes) >= JOIN_AFTER_BYTES:
                break
            await asyncio.sleep(0.05)
        assert len(first_bytes) >= JOIN_AFTER_BYTES, "first listener never received audio"

        late = bytearray()
        async for chunk in stream.subscribe(max_bytes=LATE_LISTENER_BYTES):
            late.extend(chunk)
    finally:
        first_task.cancel()
        if stream._task is not None:
            stream._task.cancel()

    assert bytes(late[:4]) == b"OggS"
    assert b"OpusHead" in bytes(late[:100])
    code, pcm_bytes = _decode_ok(bytes(late))
    assert code == 0
    assert pcm_bytes > 0
