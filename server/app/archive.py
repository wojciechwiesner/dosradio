"""Archive of recorded Lyria RealTime segments per station.

Segments are 30-second OGG/Opus files at 96 kbps (~360 KB each).
100 hours per station = 12,000 segments = ~4.3 GB (within Borg's 199 GB free disk).
Segments older than the 100-hour cap are rotated out automatically.

Each recording session also gets a `session-<id>.json` sidecar (SessionMeta)
holding its measured beatgrid (see beatgrid.py) and whether it is safe to
beatmatch-mix (U3a — metadata only; the actual mixer is a later unit).
"""
from __future__ import annotations

import json
import logging
import random
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

log = logging.getLogger("dosradio.archive")
TARGET_SEGMENT_SECONDS = 30.0
MAX_HOURS_PER_STATION = 100
MAX_SEGMENTS_PER_STATION = int((MAX_HOURS_PER_STATION * 3600) / TARGET_SEGMENT_SECONDS)  # 12,000
SESSION_META_GLOB = "session-*.json"


@dataclass
class SessionMeta:
    """Beatgrid sidecar for one recording session (one continuous Lyria WS connection)."""

    session_id: str
    station_id: str
    segments: list[str] = field(default_factory=list)
    started_ns: int = 0
    bpm_target: float = 0.0
    bpm_measured: float = 0.0
    beat_period_s: float = 0.0
    first_downbeat_offset_s: float = 0.0
    grid_confidence: float = 0.0
    ended_on_limit: bool = False
    mixable: bool = False


class StationArchive:
    def __init__(self, root: Path, station_id: str, max_segments: int = MAX_SEGMENTS_PER_STATION) -> None:
        self.station_id = station_id
        self.max_segments = max_segments
        self.dir = root / station_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.live_dir = root / station_id / "live"
        self.live_dir.mkdir(parents=True, exist_ok=True)
        self._session_meta_cache: dict[str, SessionMeta] = {}
        self._session_meta_cached_files: set[str] = set()

    def list_segments(self) -> list[Path]:
        return sorted(self.dir.glob("seg-*.opus"), key=lambda p: p.name)

    def total_seconds(self) -> float:
        return len(self.list_segments()) * TARGET_SEGMENT_SECONDS

    def total_hours(self) -> float:
        return round(self.total_seconds() / 3600.0, 2)

    def add_segment(self, opus_bytes: bytes, is_live: bool = True) -> Path:
        """Write a new segment, keep a copy in live/ for the 30% live pool, rotate old files."""
        stamp = time.time_ns()
        path = self.dir / f"seg-{stamp}.opus"
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(opus_bytes)
        tmp.replace(path)
        if is_live:
            live_path = self.live_dir / f"live-{stamp}.opus"
            try:
                live_path.symlink_to(path.name)
            except Exception:
                live_path.write_bytes(opus_bytes)
            # keep only the last 10 live segments (~5 minutes of fresh generation)
            live_segments = sorted(self.live_dir.glob("live-*.opus"))
            for old in live_segments[:-10]:
                try:
                    old.unlink()
                except OSError:
                    pass
        self.enforce_cap()
        return path

    def enforce_cap(self) -> int:
        """Keep at most 100 hours of audio; delete oldest segments first."""
        segments = self.list_segments()
        excess = len(segments) - self.max_segments
        if excess <= 0:
            return 0
        removed = 0
        for old in segments[:excess]:
            try:
                old.unlink()
                removed += 1
            except OSError:
                pass
        return removed

    def pick_next(self, live_probability: float = 0.3, after: str | None = None) -> tuple[Path | None, bool]:
        """Next segment for one listener.

        With `after` (the segment the listener just heard) the recording continues in order, so
        consecutive 30 s pieces form one continuous piece of music. On a fresh start, or at the end
        of the archive, it jumps: 30% to the newest live segment, 70% to a random archive point.
        """
        archive_files = self.list_segments()
        if not archive_files:
            return None, False
        names = [path.name for path in archive_files]
        if after and after in names:
            index = names.index(after) + 1
            if index < len(archive_files):
                return archive_files[index], index >= len(archive_files) - 10
        if random.random() < live_probability:
            start = max(0, len(archive_files) - 10)  # newest ~5 minutes = the live pool
            return archive_files[start], True
        return random.choice(archive_files), False

    def write_session_meta(self, meta: SessionMeta) -> Path:
        """Persist the beatgrid sidecar for a recording session (atomic write)."""
        path = self.dir / f"session-{meta.session_id}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(meta), indent=2))
        tmp.replace(path)
        self._session_meta_cache[path.name] = meta
        self._session_meta_cached_files.add(path.name)
        return path

    def session_meta_for(self, segment_name: str) -> SessionMeta | None:
        """Find the SessionMeta sidecar whose `segments` list contains `segment_name`.

        Sidecar files are small and rarely change once written, so we cache
        parsed results in memory keyed by filename and only re-read files
        we haven't seen yet.
        """
        for meta in self._session_meta_cache.values():
            if segment_name in meta.segments:
                return meta

        for path in sorted(self.dir.glob(SESSION_META_GLOB)):
            if path.name in self._session_meta_cached_files:
                continue
            try:
                raw = json.loads(path.read_text())
                meta = SessionMeta(**raw)
            except (OSError, ValueError, TypeError) as exc:
                log.warning("Skipping unreadable session meta %s: %s", path, exc)
                self._session_meta_cached_files.add(path.name)
                continue
            self._session_meta_cache[path.name] = meta
            self._session_meta_cached_files.add(path.name)
            if segment_name in meta.segments:
                return meta
        return None


class ArchiveRegistry:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.archives: dict[str, StationArchive] = {}

    def get(self, station_id: str) -> StationArchive:
        if station_id not in self.archives:
            self.archives[station_id] = StationArchive(self.root, station_id)
        return self.archives[station_id]

    def stats(self) -> dict[str, dict]:
        return {
            station_id: {
                "segments": len(arch.list_segments()),
                "hours": arch.total_hours(),
                "live_pool": len(list(arch.live_dir.glob("live-*.opus"))),
            }
            for station_id, arch in self.archives.items()
        }
