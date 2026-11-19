"""Tests for +/-12% WSOLA pitch-locked beatmatching and genre-aware DJ transition techniques."""
from __future__ import annotations

import numpy as np

from app.dj_dsp import split_3band_isolator, wsola_stretch
from app.dj_genres import profile_for_stations
from app.mixer import RATE, MixerConfig, mix_with_report


def _musical_club_track(bpm: float, seconds: float, lead_hz: float = 440.0, offset_s: float = 0.2) -> np.ndarray:
    """Synthesize a realistic 4/4 club track with 58 Hz sub kicks, offbeat hats, and a continuous lead pad."""
    n = int(round(seconds * RATE))
    t = np.arange(n, dtype=np.float32) / RATE
    mono = 0.22 * np.sin(2.0 * np.pi * lead_hz * t).astype(np.float32)

    period = 60.0 / bpm
    kick_len = int(0.11 * RATE)
    kt = np.arange(kick_len, dtype=np.float32) / RATE
    kick = (0.72 * np.sin(2.0 * np.pi * 58.0 * kt) * np.exp(-kt / 0.032)).astype(np.float32)

    hat_len = int(0.04 * RATE)
    rng = np.random.default_rng(42)
    hat = (0.12 * rng.standard_normal(hat_len).astype(np.float32) * np.exp(-np.arange(hat_len, dtype=np.float32) / (0.012 * RATE)))

    beat_t = offset_s
    while beat_t + 0.12 < seconds:
        k0 = int(round(beat_t * RATE))
        mono[k0 : k0 + kick_len] += kick
        h0 = int(round((beat_t + 0.5 * period) * RATE))
        if h0 + hat_len < n:
            mono[h0 : h0 + hat_len] += hat
        beat_t += period

    return np.stack([mono, mono], axis=1)


def _dominant_freq_hz(stereo: np.ndarray, f_lo: float = 300.0, f_hi: float = 700.0) -> float:
    mono = stereo.mean(axis=1).astype(np.float64)
    windowed = mono * np.hanning(len(mono))
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(mono), d=1.0 / RATE)
    mask = (freqs >= f_lo) & (freqs <= f_hi)
    return float(freqs[mask][int(np.argmax(spec[mask]))])


def test_wsola_preserves_pitch_at_plus_11_percent_stretch():
    """Stretching by +11% (within +/-12% CDJ range) changes duration without shifting 440 Hz pitch."""
    t = np.arange(RATE * 3, dtype=np.float32) / RATE
    tone = (0.5 * np.sin(2.0 * np.pi * 440.0 * t)).astype(np.float32)
    stereo = np.stack([tone, tone], axis=1)

    target_frames = int(round(len(stereo) * 1.11))
    stretched = wsola_stretch(stereo, target_frames)

    assert len(stretched) == target_frames
    dom_hz = _dominant_freq_hz(stretched)
    # Naive resampling would drop 440 Hz -> 396.4 Hz (-43.6 Hz!); WSOLA keeps 440 Hz +/- 3 Hz
    assert abs(dom_hz - 440.0) <= 3.5


def test_isolator_3band_reconstructs_unity_flat():
    rng = np.random.default_rng(7)
    audio = (0.25 * rng.standard_normal((RATE * 2, 2))).astype(np.float32)
    lo, mid, hi = split_3band_isolator(audio)
    reconstructed = lo + mid + hi
    err_rms = float(np.sqrt(np.mean((audio - reconstructed) ** 2)))
    assert err_rms < 1e-5


def test_bpm_match_within_12_percent_uses_pitch_locked_dj_phrase():
    """124 BPM -> 137 BPM (+10.5%, inside +/-12%) beatmatches across a full 48-beat techno phrase (~23s)."""
    tail = _musical_club_track(124.0, seconds=42.0, lead_hz=440.0, offset_s=0.15)
    head = _musical_club_track(137.0, seconds=42.0, lead_hz=523.25, offset_s=0.28)

    joined, report = mix_with_report(
        tail, head, station_a="berlin-bcco-techno", station_b="hypnotic-techno"
    )
    assert report.mode == "beatmatched_bass_swap"
    assert report.technique == "eq_blend"
    assert report.beats_mixed >= 32
    assert report.overlap_seconds >= 14.5  # Real DJ phrase duration (~15.5-23.2s), not a quick 3s radio fade
    assert report.pitch_locked is True
    assert report.bpm_delta_pct is not None and 9.0 <= report.bpm_delta_pct <= 12.0
    assert np.max(np.abs(joined)) <= 1.0


def test_bpm_outside_12_percent_never_stretches_and_uses_dub_echo_or_velvet():
    """120 BPM -> 146 BPM (+21.7%, outside +/-12%) refuses to warp tempo and drops cleanly via echo_out."""
    tail = _musical_club_track(120.0, seconds=30.0, lead_hz=330.0, offset_s=0.10)
    head = _musical_club_track(146.0, seconds=30.0, lead_hz=440.0, offset_s=0.22)

    joined, report = mix_with_report(
        tail, head, station_a="nocny-dub", station_b="drum-and-bass"
    )
    assert report.mode == "dj_echo_out_drop"
    assert report.technique == "echo_out"
    assert report.bpm_delta_pct is not None and report.bpm_delta_pct > 12.0
    assert np.max(np.abs(joined)) <= 1.0


def test_genre_profiles_route_to_authentic_dj_techniques():
    assert profile_for_stations("berlin-bcco-techno", "raw-techno").technique == "eq_blend"
    assert profile_for_stations("berlin-bcco-techno", "raw-techno").phrase_beats == 48
    assert profile_for_stations("goa-trance", "goa-trance").technique == "filter_sweep"
    assert profile_for_stations("nocny-dub", "trip-hop").technique == "echo_out"
    assert profile_for_stations("deep-ambient", "warm-jazz").technique == "velvet_fade"
    # Cross-group transition defaults to Dual Filter Sweep
    assert profile_for_stations("berlin-bcco-techno", "warm-jazz").technique == "filter_sweep"
