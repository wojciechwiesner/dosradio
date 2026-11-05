"""Archive of recorded Lyria RealTime segments per station.

Segments are 30-second OGG/Opus files at 96 kbps (~360 KB each).
100 hours per station = 12,000 segments = ~4.3 GB (within Borg's 199 GB free disk).
Segments older than the 100-hour cap are rotated out automatically.
"""
from __future__ import annotations

import logging
import random
import time
from pathlib import Path

log = logging.getLogger("dosradio.archive")
TARGET_SEGMENT_SECONDS = 30.0
MAX_HOURS_PER_STATION = 100
MAX_SEGMENTS_PER_STATION = int((MAX_HOURS_PER_STATION * 3600) / TARGET_SEGMENT_SECONDS)  # 12,000


class StationArchive:
    def __init__(self, root: Path, station_id: str, max_segments: int = MAX_SEGMENTS_PER_STATION) -> None:
        self.station_id = station_id
        self.max_segments = max_segments
        self.dir = root / station_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.live_dir = root / station_id / "live"
        self.live_dir.mkdir(parents=True, exist_ok=True)

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

    def pick_next(self, live_probability: float = 0.3) -> tuple[Path | None, bool]:
        """Choose between a fresh live segment (30%) and a recorded archive segment (70%).

        Returns (path, is_live). Falls back to whichever source has audio.
        """
        live_files = sorted(self.live_dir.glob("live-*.opus"))
        archive_files = self.list_segments()
        if not live_files and not archive_files:
            return None, False
        wants_live = random.random() < live_probability
        if wants_live and live_files:
            return random.choice(live_files), True
        if archive_files:
            return random.choice(archive_files), False
        return (live_files[-1], True) if live_files else (None, False)


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
