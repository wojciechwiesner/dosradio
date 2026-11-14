"""Radio bumpers (stings): a short music bed with a host voice laid over it.

The bed is cut from the station archive with fade in/out and ducked (sidechain
compression) while the voice speaks. All ffmpeg calls go through an injectable
runner, so tests never need ffmpeg or the network.
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import wave
from pathlib import Path
from typing import Awaitable, Callable

log = logging.getLogger("dosradio.bumpers")

# Runner contract: (argv, timeout seconds) -> stdout text; raises on failure.
Runner = Callable[[list[str], int], str]

FFMPEG_TIMEOUT_S = 60
MIN_BED_SECONDS = 6.0
MAX_BED_SECONDS = 9.0
BED_TAIL_SECONDS = 2.5   # music keeps playing a little after the voice ends
VOICE_DELAY_MS = 1000    # music comes in first, then the host speaks
FADE_SECONDS = 1.5
OPUS_BITRATE = "96k"
SAMPLE_RATE = 48000


def subprocess_runner(args: list[str], timeout: int) -> str:
    """Production runner: run a process, return stdout, raise RuntimeError on non-zero exit."""
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} timed out after {timeout}s") from error
    except FileNotFoundError as error:
        raise RuntimeError(f"{args[0]} is not installed") from error
    if result.returncode != 0:
        raise RuntimeError(f"{args[0]} exited {result.returncode}: {result.stderr.strip()[-300:]}")
    return result.stdout


def wav_duration_seconds(path: Path) -> float:
    """Length of a WAV file; 0.0 when it cannot be read (the bed length then falls back to the minimum)."""
    try:
        with wave.open(str(path), "rb") as handle:
            return handle.getnframes() / float(handle.getframerate())
    except (wave.Error, EOFError, OSError, ZeroDivisionError):
        return 0.0


def bed_seconds(voice_seconds: float) -> float:
    return min(MAX_BED_SECONDS, max(MIN_BED_SECONDS, VOICE_DELAY_MS / 1000 + voice_seconds + BED_TAIL_SECONDS))


def _ducked_mix_filter(bed: float) -> str:
    fade_out_start = max(0.0, bed - FADE_SECONDS)
    return ";".join([
        f"[0:a]atrim=0:{bed:.2f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d={FADE_SECONDS},afade=t=out:st={fade_out_start:.2f}:d={FADE_SECONDS}[bed]",
        f"[1:a]aresample={SAMPLE_RATE},adelay={VOICE_DELAY_MS}|{VOICE_DELAY_MS},"
        f"apad=whole_dur={bed:.2f},asplit=2[voice][key]",
        "[bed][key]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400[ducked]",
        "[ducked][voice]amix=inputs=2:duration=longest:normalize=0[out]",
    ])


def build_bumper(run: Runner, voice_wav: Path, music_segment: Path | None, out_path: Path) -> None:
    """Write `out_path` (opus): music bed + ducked voice, or just the voice when there is no music."""
    if music_segment is None:
        args = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(voice_wav),
                "-af", "afade=t=in:d=0.1", "-c:a", "libopus", "-b:a", OPUS_BITRATE, str(out_path)]
    else:
        bed = bed_seconds(wav_duration_seconds(voice_wav))
        args = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(music_segment), "-i", str(voice_wav),
                "-filter_complex", _ducked_mix_filter(bed), "-map", "[out]",
                "-c:a", "libopus", "-b:a", OPUS_BITRATE, "-ar", str(SAMPLE_RATE), str(out_path)]
    run(args, FFMPEG_TIMEOUT_S)
    if not out_path.exists():
        raise RuntimeError(f"ffmpeg produced no bumper at {out_path.name}")


async def make_voiced_bumper(speak: Callable[[str], Awaitable[bytes]], run: Runner, text: str,
                             music_segment: Path | None, out_path: Path) -> None:
    """Voice `text` with `speak`, then mix it over the music bed into `out_path`."""
    voice_path = out_path.with_suffix(".voice.wav")
    try:
        voice_path.write_bytes(await speak(text))
        await asyncio.to_thread(build_bumper, run, voice_path, music_segment, out_path)
    finally:
        voice_path.unlink(missing_ok=True)
