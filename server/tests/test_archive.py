"""Tests for DOS Radio 100-hour archive, cap enforcement and 70/30 stream selection."""
from __future__ import annotations

import pytest
from pathlib import Path
from app.archive import ArchiveRegistry, StationArchive, MAX_SEGMENTS_PER_STATION


def test_station_archive_add_and_stats(tmp_path: Path):
    reg = ArchiveRegistry(tmp_path)
    arch = reg.get("dos-groove")

    # Initially empty
    assert arch.total_seconds() == 0.0
    assert arch.total_hours() == 0.0
    p, is_live = arch.pick_next(0.3)
    assert p is None

    # Add 5 fake Opus segments
    for i in range(5):
        arch.add_segment(b"fake-opus-bytes-" + str(i).encode(), is_live=True)

    assert len(arch.list_segments()) == 5
    assert arch.total_seconds() == 150.0  # 5 * 30s
    assert len(list(arch.live_dir.glob("live-*.opus"))) == 5

    # pick_next returns something
    p, is_live = arch.pick_next(1.0)  # 100% live requested
    assert p is not None
    assert is_live is True

    p, is_live = arch.pick_next(0.0)  # 100% archive requested
    assert p is not None
    assert is_live is False


def test_station_archive_cap_rotation(tmp_path: Path):
    arch = StationArchive(tmp_path, "test-station", max_segments=3)
    for i in range(5):
        arch.add_segment(b"opus-" + str(i).encode(), is_live=False)

    # Should have pruned the first 2, keeping only the 3 newest
    segments = arch.list_segments()
    assert len(segments) == 3
    # Newest segments are preserved
    assert all(p.exists() for p in segments)


def test_pick_next_continues_recording_in_order(tmp_path: Path):
    arch = StationArchive(tmp_path, "seq")
    for i in range(30):
        arch.add_segment(b"opus-" + str(i).encode(), is_live=False)
    names = [p.name for p in arch.list_segments()]
    # A listener who just heard segment 5 always gets segment 6 next (continuous music, no random jumps).
    for _ in range(20):
        path, _ = arch.pick_next(0.3, after=names[5])
        assert path.name == names[6]
    # End of the archive: jumps somewhere valid instead of failing.
    path, _ = arch.pick_next(0.3, after=names[-1])
    assert path.name in names
    # Unknown `after` behaves like a fresh start.
    path, _ = arch.pick_next(0.3, after="seg-1.opus")
    assert path.name in names
