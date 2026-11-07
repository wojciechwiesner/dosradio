"""YouTube "pigułka" (DOS Radio Plus): the most important ~20% of an episode as short audio blocks.

Pipeline, one small function per step: fetch_metadata -> fetch_subtitles -> parse_vtt ->
select_segments (Gemini) -> download_audio + cut_audio -> build_parts (host summary voice +
exact clip, wrapped in intro/outro bumpers). Every external process goes through an injectable
runner with a timeout, so tests run without yt-dlp, ffmpeg or the network.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable
from urllib.parse import parse_qs, urlparse

from .bumpers import Runner, make_voiced_bumper

log = logging.getLogger("dosradio.pill")

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
CHANNEL_PATH_PREFIXES = ("/@", "/channel/", "/c/", "/user/")
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
MAX_DURATION_S = 3 * 3600
TARGET_FRACTION = 0.2
BUDGET_TOLERANCE = 1.25  # stop adding segments once the total passes target * tolerance
MIN_SEGMENT_S = 20.0
MAX_SEGMENT_S = 120.0
PROMPT_WINDOW_S = 15.0
METADATA_TIMEOUT_S = 90


def _find_yt_dlp() -> str:
    """Prefer yt-dlp from the app's own venv: distro builds go stale and YouTube blocks them (403/SABR)."""
    venv_binary = Path(sys.executable).with_name("yt-dlp")
    if venv_binary.exists():
        return str(venv_binary)
    return shutil.which("yt-dlp") or "yt-dlp"


YT_DLP = _find_yt_dlp()
SUBTITLE_TIMEOUT_S = 90
DOWNLOAD_TIMEOUT_S = 900
CUT_TIMEOUT_S = 120
CLIP_BITRATE = "64k"
CLIP_FADE_S = 0.25
NO_SUBTITLES_MESSAGE = "Ten odcinek nie ma napisów, spróbuj innego."

Summarise = Callable[[str], Awaitable[str]]
Speak = Callable[[str], Awaitable[bytes]]


class PillError(Exception):
    """Failure with a message that is safe and useful to show to the listener."""


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    summary: str


# --- url handling ------------------------------------------------------------------------

def validate_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or (parsed.hostname or "") not in YOUTUBE_HOSTS:
        raise PillError("To nie wygląda na link do YouTube. Wklej link do odcinka albo kanału.")
    return parsed.geturl()


def extract_video_id(url: str) -> str | None:
    """Video id of a direct episode link; None for channel links."""
    parsed = urlparse(url)
    if parsed.hostname == "youtu.be":
        candidate = parsed.path.strip("/")
    elif parsed.path == "/watch":
        candidate = (parse_qs(parsed.query).get("v") or [""])[0]
    else:
        candidate = parsed.path.rstrip("/").rsplit("/", 1)[-1] if parsed.path.startswith(("/shorts/", "/live/")) else ""
    return candidate if VIDEO_ID_RE.match(candidate) else None


def is_channel_url(url: str) -> bool:
    return urlparse(url).path.startswith(CHANNEL_PATH_PREFIXES)


# --- step 1: metadata -----------------------------------------------------------------------

def _dump_json(run: Runner, url: str, extra: list[str]) -> dict:
    out = run([YT_DLP, "--dump-single-json", "--no-warnings", *extra, url], METADATA_TIMEOUT_S)
    return json.loads(out)


def fetch_metadata(run: Runner, url: str) -> dict:
    """{"video_id","title","author","duration","source_url"}; a channel URL resolves to its latest upload."""
    target = url
    if is_channel_url(url):
        channel = url.rstrip("/")
        channel = channel if channel.endswith("/videos") else f"{channel}/videos"
        listing = _dump_json(run, channel, ["--flat-playlist", "--playlist-items", "1"])
        entries = listing.get("entries") or []
        if not entries:
            raise PillError("Nie znalazłem żadnego odcinka na tym kanale.")
        entry = entries[0]
        target = entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id', '')}"
    info = _dump_json(run, target, ["--no-playlist"])
    video_id = str(info.get("id") or "")
    if not VIDEO_ID_RE.match(video_id):
        raise PillError("Nie udało się odczytać tego odcinka.")
    duration = float(info.get("duration") or 0)
    if duration <= 0 or duration > MAX_DURATION_S:
        raise PillError("Odcinek jest za długi albo to transmisja. Maksymalnie 3 godziny.")
    return {
        "video_id": video_id,
        "title": str(info.get("title") or "Bez tytułu")[:140],
        "author": str(info.get("channel") or info.get("uploader") or "")[:80],
        "duration": duration,
        "source_url": str(info.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}"),
    }


# --- step 2/3: subtitles -------------------------------------------------------------------------

# Subtitle attempts in order of quality. Auto-translated captions (e.g. en -> pl) are skipped on
# purpose: YouTube rate-limits them (HTTP 429) and they are worse than the original language.
SUBTITLE_ATTEMPTS: tuple[tuple[str, str], ...] = (
    ("--write-subs", "pl,en"),          # human-made subtitles
    ("--write-auto-subs", ".*-orig"),   # automatic captions in the video's own language
    ("--write-auto-subs", "en"),        # last resort
)


def fetch_subtitles(run: Runner, source_url: str, workdir: Path) -> str | None:
    """Return VTT text from the first subtitle source that works, or None when the video has none.

    Each attempt is isolated: one failing track (429, missing language) never aborts the pill.
    """
    for flag, langs in SUBTITLE_ATTEMPTS:
        try:
            run([YT_DLP, "--skip-download", flag, "--sub-langs", langs, "--sub-format", "vtt",
                 "--no-playlist", "--no-warnings", "-o", str(workdir / "subs"), source_url],
                SUBTITLE_TIMEOUT_S)
        except Exception as error:  # yt-dlp exits 1 when any requested track fails
            log.warning("subtitle attempt %s %s failed: %s", flag, langs, error)
        found = sorted(workdir.glob("subs.*.vtt"))
        if found:
            return found[0].read_text(encoding="utf-8", errors="replace")
    return None


_TIMING_RE = re.compile(r"((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})")
_TAG_RE = re.compile(r"<[^>]+>")


def _to_seconds(stamp: str) -> float:
    pieces = [float(piece) for piece in stamp.split(":")]
    while len(pieces) < 3:
        pieces.insert(0, 0.0)
    return pieces[0] * 3600 + pieces[1] * 60 + pieces[2]


def parse_vtt(vtt: str) -> list[Cue]:
    """Cues with markup stripped; auto-subtitle rolling lines repeated from the previous cue are dropped."""
    cues: list[Cue] = []
    previous_lines: set[str] = set()
    for block in re.split(r"\n\s*\n", vtt.replace("\r\n", "\n")):
        lines = block.strip().split("\n")
        timing_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        timing = _TIMING_RE.search(lines[timing_index]) if timing_index is not None else None
        if timing is None:
            continue
        text_lines = [_TAG_RE.sub("", line).strip() for line in lines[timing_index + 1:]]
        text_lines = [line for line in text_lines if line]
        fresh = [line for line in text_lines if line not in previous_lines]
        previous_lines = set(text_lines)
        if fresh:
            cues.append(Cue(_to_seconds(timing.group(1)), _to_seconds(timing.group(2)), " ".join(fresh)))
    return cues


# --- step 4: segment selection ----------------------------------------------------------------------

def _clock(seconds: float) -> str:
    return f"{int(seconds) // 60}:{int(seconds) % 60:02d}"


def build_selection_prompt(title: str, cues: list[Cue], duration: float) -> str:
    windows: dict[int, list[str]] = {}
    for cue in cues:
        windows.setdefault(int(cue.start // PROMPT_WINDOW_S), []).append(cue.text)
    transcript = "\n".join(f"[{int(index * PROMPT_WINDOW_S)}s] {' '.join(texts)}" for index, texts in sorted(windows.items()))
    target = int(duration * TARGET_FRACTION)
    return "\n".join([
        f"Odcinek: {title}. Długość: {int(duration)} s. Poniżej transkrypt z czasami w sekundach.",
        f"Wybierz najważniejsze fragmenty, łącznie około {target} s (około 20% odcinka), po kolei w czasie.",
        f"Każdy fragment trwa od {int(MIN_SEGMENT_S)} do {int(MAX_SEGMENT_S)} s i jest zrozumiały bez reszty odcinka.",
        'Dla każdego napisz jedno zdanie po polsku (maks. 25 słów), o czym jest, bez emoji i markdownu.',
        'Zwróć WYŁĄCZNIE JSON: {"segments":[{"start":12,"end":80,"summary":"..."}]}',
        "", transcript,
    ])


def snap_window(start: float, end: float, cues: list[Cue], duration: float) -> tuple[float, float]:
    """Move a proposed window onto cue boundaries and force the 20-120 s length limits."""
    snapped_start = min((cue.start for cue in cues), key=lambda value: abs(value - start))
    wanted_end = min(max(end, snapped_start + MIN_SEGMENT_S), snapped_start + MAX_SEGMENT_S)
    ends = [cue.end for cue in cues if snapped_start + MIN_SEGMENT_S <= cue.end <= snapped_start + MAX_SEGMENT_S]
    snapped_end = min(ends, key=lambda value: abs(value - wanted_end)) if ends else min(snapped_start + MAX_SEGMENT_S, duration)
    return snapped_start, min(snapped_end, duration)


def parse_selection(reply: str, cues: list[Cue], duration: float) -> list[Segment]:
    start, end = reply.find("{"), reply.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("selection reply has no JSON object")
    budget = duration * TARGET_FRACTION * BUDGET_TOLERANCE
    segments: list[Segment] = []
    total = 0.0
    for item in sorted((i for i in json.loads(reply[start:end + 1]).get("segments", []) if isinstance(i, dict)),
                       key=lambda i: float(i.get("start", 0))):
        seg_start, seg_end = snap_window(float(item.get("start", 0)), float(item.get("end", 0)), cues, duration)
        if seg_end - seg_start < 1 or (segments and seg_start < segments[-1].end):
            continue  # degenerate or overlapping with the previous pick
        if segments and total + (seg_end - seg_start) > budget:
            break
        summary = str(item.get("summary") or "").strip()[:300] or "Kolejny ważny fragment odcinka."
        segments.append(Segment(seg_start, seg_end, summary))
        total += seg_end - seg_start
    if not segments:
        raise ValueError("no usable segments selected")
    return segments


async def select_segments(summarise: Summarise, title: str, cues: list[Cue], duration: float) -> list[Segment]:
    """Ask Gemini for ordered segments; retry once because the reply is free-form JSON."""
    prompt = build_selection_prompt(title, cues, duration)
    last_error: Exception | None = None
    for _ in range(2):
        try:
            return parse_selection(await summarise(prompt), cues, duration)
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            last_error = error
            log.warning("pill segment selection attempt failed: %s", error)
    raise PillError("Nie udało się wybrać najważniejszych fragmentów. Spróbuj innego odcinka.") from last_error


# --- step 5: audio -----------------------------------------------------------------------------------

def download_audio(run: Runner, source_url: str, workdir: Path) -> Path:
    run([YT_DLP, "-f", "bestaudio", "--no-playlist", "--no-warnings", "-o", str(workdir / "source.%(ext)s"), source_url],
        DOWNLOAD_TIMEOUT_S)
    found = [path for path in workdir.glob("source.*") if path.suffix != ".part"]
    if not found:
        raise RuntimeError("yt-dlp produced no audio file")
    return found[0]


def cut_audio(run: Runner, source: Path, start: float, end: float, out_path: Path) -> None:
    """Cut exactly [start, end] into opus with tiny fades so the edges do not click."""
    length = end - start
    fade = f"afade=t=in:d={CLIP_FADE_S},afade=t=out:st={max(0.0, length - CLIP_FADE_S):.2f}:d={CLIP_FADE_S}"
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-t", f"{length:.2f}", "-i", str(source),
         "-vn", "-af", fade, "-c:a", "libopus", "-b:a", CLIP_BITRATE, str(out_path)], CUT_TIMEOUT_S)
    if not out_path.exists():
        raise RuntimeError(f"ffmpeg produced no clip {out_path.name}")


# --- step 6: parts ------------------------------------------------------------------------------------

async def build_parts(speak: Speak, run: Runner, workdir: Path, source: Path, meta: dict,
                      segments: list[Segment], music: Path | None) -> list[dict]:
    """Parts in play order: intro bumper, (host summary, exact clip) per segment, outro bumper.

    Returns [{"kind": "bumper"|"voice"|"clip", "file": name}]; a failed bumper is skipped.
    """
    parts: list[dict] = []

    async def add_bumper(text: str) -> None:
        name = f"b{len(parts):02d}.opus"
        try:
            await make_voiced_bumper(speak, run, text, music, workdir / name)
            parts.append({"kind": "bumper", "file": name})
        except Exception as error:
            log.warning("pill bumper %r skipped: %s", text, error)

    await add_bumper(f"Pigułka z YouTube. {meta['title']}, autor: {meta['author']}." if meta["author"]
                     else f"Pigułka z YouTube. {meta['title']}.")
    for segment in segments:
        voice_name, clip_name = f"v{len(parts):02d}.wav", f"c{len(parts) + 1:02d}.opus"
        try:
            (workdir / voice_name).write_bytes(await speak(segment.summary))
            await asyncio.to_thread(cut_audio, run, source, segment.start, segment.end, workdir / clip_name)
        except Exception as error:
            log.warning("pill segment %.0f-%.0f skipped: %s", segment.start, segment.end, error)
            continue
        parts.extend([{"kind": "voice", "file": voice_name}, {"kind": "clip", "file": clip_name}])
    if not any(part["kind"] == "clip" for part in parts):
        raise RuntimeError("pill produced no clips")
    await add_bumper("To była pigułka z YouTube. Gramy dalej!")
    return parts
