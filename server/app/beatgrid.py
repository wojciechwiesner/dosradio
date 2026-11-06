"""Measure the real BPM and beat grid of a recorded Lyria session.

Pure stdlib implementation (array/math only — no numpy/librosa). The method:

1. Split the mono-downmixed PCM into fixed-size frames and compute per-frame
   energy (sum of squared samples).
2. Build an onset envelope as the positive first difference of energy
   (a rising energy edge = an onset candidate).
3. Autocorrelate the onset envelope over a lag range that covers
   `bpm_hint` +/-40% (clamped to 60..200 BPM) to find the dominant beat
   period.
4. `grid_confidence` is the autocorrelation peak normalised against the
   mean autocorrelation score across the search window (0..1).
5. `first_downbeat_offset_s` is the first onset that clears
   mean + 1 std-dev of the onset envelope (falls back to the single
   strongest onset if nothing clears the threshold).

This is intentionally simple and deterministic, not a research-grade
tempo tracker — good enough to classify "mixable vs not" per recording.
"""
from __future__ import annotations

import array
import math
from dataclasses import dataclass

FRAME_SIZE = 1024  # samples per channel per analysis frame
MIN_BPM = 60.0
MAX_BPM = 200.0
BPM_HINT_WINDOW_RATIO = 0.4  # search bpm_hint +/- 40%
MIN_USABLE_FRAMES = 8
CONFIDENCE_RATIO_SCALE = 3.0  # peak/mean ratio that maps to grid_confidence == 1.0
ONSET_THRESHOLD_STD_MULTIPLIER = 1.0


@dataclass
class BeatGrid:
    bpm_measured: float
    beat_period_s: float
    first_downbeat_offset_s: float
    grid_confidence: float


def _downmix_to_mono_energies(pcm_s16le: bytes, rate: int, channels: int) -> tuple[list[float], float]:
    """Return (per-frame energy, frame_duration_s) for interleaved s16le PCM."""
    samples = array.array("h")
    bytes_per_sample = 2 * channels
    usable_len = len(pcm_s16le) - (len(pcm_s16le) % bytes_per_sample)
    samples.frombytes(pcm_s16le[:usable_len])

    frame_len = FRAME_SIZE * channels
    n_frames = len(samples) // frame_len
    frame_duration_s = FRAME_SIZE / rate

    energies = []
    for i in range(n_frames):
        start = i * frame_len
        chunk = samples[start:start + frame_len]
        energies.append(sum(v * v for v in chunk) / frame_len)
    return energies, frame_duration_s


def _onset_envelope(energies: list[float]) -> list[float]:
    """Positive first difference of energy: rising edges = onset candidates."""
    onset = [0.0] * len(energies)
    for i in range(1, len(energies)):
        delta = energies[i] - energies[i - 1]
        onset[i] = delta if delta > 0 else 0.0
    return onset


def _autocorrelate_lag_range(onset: list[float], min_lag: int, max_lag: int) -> dict[int, float]:
    scores: dict[int, float] = {}
    for lag in range(min_lag, max_lag + 1):
        count = len(onset) - lag
        if count <= 0:
            continue
        total = 0.0
        for i in range(count):
            total += onset[i] * onset[i + lag]
        scores[lag] = total / count
    return scores


def _refine_peak_lag(scores: dict[int, float], best_lag: int) -> float:
    """Parabolic interpolation around the integer peak for sub-frame precision."""
    if best_lag - 1 not in scores or best_lag + 1 not in scores:
        return float(best_lag)
    s_minus, s_peak, s_plus = scores[best_lag - 1], scores[best_lag], scores[best_lag + 1]
    denom = s_minus - 2 * s_peak + s_plus
    if abs(denom) < 1e-12:
        return float(best_lag)
    delta = 0.5 * (s_minus - s_plus) / denom
    delta = max(-1.0, min(1.0, delta))
    return best_lag + delta


def _first_strong_onset_s(onset: list[float], frame_duration_s: float) -> float:
    mean_onset = sum(onset) / len(onset)
    variance = sum((value - mean_onset) ** 2 for value in onset) / len(onset)
    std_onset = math.sqrt(variance)
    threshold = mean_onset + ONSET_THRESHOLD_STD_MULTIPLIER * std_onset

    for index, value in enumerate(onset):
        if value > threshold and value > 0:
            return round(index * frame_duration_s, 4)

    # Nothing clears the threshold (near-silent/flat signal): use the single
    # strongest onset candidate so the field is still meaningful.
    strongest_index = max(range(len(onset)), key=lambda i: onset[i])
    return round(strongest_index * frame_duration_s, 4)


def analyze_bpm(pcm_s16le: bytes, rate: int = 48000, channels: int = 2, bpm_hint: float = 120.0) -> BeatGrid:
    """Estimate BPM, beat period, first downbeat offset and grid confidence.

    Deterministic, stdlib-only: frame energy -> onset envelope ->
    autocorrelation around `bpm_hint` (+/-40%, clamped to 60..200 BPM).
    """
    fallback_period_s = 60.0 / bpm_hint

    energies, frame_duration_s = _downmix_to_mono_energies(pcm_s16le, rate, channels)
    if len(energies) < MIN_USABLE_FRAMES:
        return BeatGrid(
            bpm_measured=bpm_hint,
            beat_period_s=fallback_period_s,
            first_downbeat_offset_s=0.0,
            grid_confidence=0.0,
        )

    onset = _onset_envelope(energies)

    search_min_bpm = max(MIN_BPM, bpm_hint * (1 - BPM_HINT_WINDOW_RATIO))
    search_max_bpm = min(MAX_BPM, bpm_hint * (1 + BPM_HINT_WINDOW_RATIO))
    if search_min_bpm >= search_max_bpm:
        search_min_bpm, search_max_bpm = MIN_BPM, MAX_BPM

    min_lag = max(1, round((60.0 / search_max_bpm) / frame_duration_s))
    max_lag = max(min_lag + 1, round((60.0 / search_min_bpm) / frame_duration_s))
    max_lag = min(max_lag, len(onset) - 1)
    if max_lag <= min_lag:
        return BeatGrid(
            bpm_measured=bpm_hint,
            beat_period_s=fallback_period_s,
            first_downbeat_offset_s=0.0,
            grid_confidence=0.0,
        )

    scores = _autocorrelate_lag_range(onset, min_lag, max_lag)
    if not scores:
        return BeatGrid(
            bpm_measured=bpm_hint,
            beat_period_s=fallback_period_s,
            first_downbeat_offset_s=0.0,
            grid_confidence=0.0,
        )

    best_lag = max(scores, key=lambda lag: scores[lag])
    best_score = scores[best_lag]
    mean_score = sum(scores.values()) / len(scores)

    refined_lag = _refine_peak_lag(scores, best_lag)
    beat_period_s = refined_lag * frame_duration_s
    bpm_measured = 60.0 / beat_period_s if beat_period_s > 0 else bpm_hint

    ratio = best_score / (mean_score + 1e-9)
    grid_confidence = max(0.0, min(1.0, (ratio - 1.0) / CONFIDENCE_RATIO_SCALE))

    first_downbeat_offset_s = _first_strong_onset_s(onset, frame_duration_s)

    return BeatGrid(
        bpm_measured=round(bpm_measured, 3),
        beat_period_s=round(beat_period_s, 6),
        first_downbeat_offset_s=first_downbeat_offset_s,
        grid_confidence=round(grid_confidence, 4),
    )
