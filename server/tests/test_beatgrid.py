"""Tests for U3a beatgrid analysis and the session sidecar persistence.

All synthetic PCM is generated with pure stdlib (array/math) — zero network,
zero ffmpeg, zero external deps.
"""
from __future__ import annotations

import array
import math
import random
from pathlib import Path

import pytest

from app.archive import ArchiveRegistry, SessionMeta, StationArchive
from app.beatgrid import BeatGrid, analyze_bpm

RATE = 48000
CHANNELS = 2
BPM_TOLERANCE = 2.0
MIN_CONFIDENT_GRID = 0.5


def _click_track_pcm(bpm: float, duration_s: float, amp: int = 28000, click_len: int = 40) -> bytes:
    """Synthesize an interleaved s16le click track: a decaying click every beat."""
    period_s = 60.0 / bpm
    n_total = int(duration_s * RATE)
    samples = array.array("h", [0] * (n_total * CHANNELS))
    t = 0.0
    while t < duration_s:
        start = int(t * RATE)
        for k in range(click_len):
            idx = start + k
            if idx * CHANNELS + 1 >= len(samples):
                break
            value = int(amp * math.exp(-k / 8.0))
            for channel in range(CHANNELS):
                samples[idx * CHANNELS + channel] = value
        t += period_s
    return samples.tobytes()


def _flat_noise_pcm(duration_s: float, amp: int = 8000, seed: int = 42) -> bytes:
    """Synthesize uniform random noise: no periodic structure, low confidence expected."""
    rng = random.Random(seed)
    n_total = int(duration_s * RATE) * CHANNELS
    samples = array.array("h", [rng.randint(-amp, amp) for _ in range(n_total)])
    return samples.tobytes()


def test_analyze_bpm_detects_click_track_within_tolerance():
    pcm = _click_track_pcm(bpm=120.0, duration_s=10.0)
    grid = analyze_bpm(pcm, rate=RATE, channels=CHANNELS, bpm_hint=120.0)

    assert isinstance(grid, BeatGrid)
    assert abs(grid.bpm_measured - 120.0) <= BPM_TOLERANCE
    assert grid.grid_confidence >= MIN_CONFIDENT_GRID
    assert grid.beat_period_s > 0


def test_analyze_bpm_low_confidence_on_flat_noise():
    pcm = _flat_noise_pcm(duration_s=10.0)
    grid = analyze_bpm(pcm, rate=RATE, channels=CHANNELS, bpm_hint=120.0)

    assert grid.grid_confidence < MIN_CONFIDENT_GRID


def test_write_session_meta_and_session_meta_for_roundtrip(tmp_path: Path):
    reg = ArchiveRegistry(tmp_path)
    arch = reg.get("dos-groove")
    for i in range(3):
        arch.add_segment(b"fake-opus-" + str(i).encode(), is_live=False)
    segment_names = [p.name for p in arch.list_segments()]

    meta = SessionMeta(
        session_id="abc123",
        station_id="dos-groove",
        segments=segment_names,
        started_ns=1234567890,
        bpm_target=122.0,
        bpm_measured=121.4,
        beat_period_s=0.4945,
        first_downbeat_offset_s=0.021,
        grid_confidence=0.87,
        ended_on_limit=False,
        mixable=True,
    )
    written_path = arch.write_session_meta(meta)
    assert written_path.exists()
    assert written_path.name == "session-abc123.json"

    found = arch.session_meta_for(segment_names[1])
    assert found is not None
    assert found.session_id == "abc123"
    assert found.mixable is True

    # A different StationArchive instance (fresh cache) must also find it by reading from disk.
    fresh_arch = StationArchive(tmp_path, "dos-groove")
    found_fresh = fresh_arch.session_meta_for(segment_names[2])
    assert found_fresh is not None
    assert found_fresh.bpm_measured == pytest.approx(121.4)

    assert arch.session_meta_for("seg-does-not-exist.opus") is None


def test_list_segments_ignores_session_json_sidecars(tmp_path: Path):
    arch = StationArchive(tmp_path, "dos-groove")
    for i in range(4):
        arch.add_segment(b"opus-" + str(i).encode(), is_live=False)

    meta = SessionMeta(session_id="xyz", station_id="dos-groove", segments=[])
    arch.write_session_meta(meta)

    segments = arch.list_segments()
    assert len(segments) == 4
    assert all(p.suffix == ".opus" for p in segments)
    assert not any(p.name.startswith("session-") for p in segments)
