"""Robust straight-line beat grid fit for DJ transitions.

The mixer used to derive the tempo-lock ratio from ONE detected kick pair and paired kicks by
their position in the detected chain. A single 40 ms onset error (or one missed kick) then skewed
the stretch of a whole half-phrase and the two decks drifted apart audibly. Fitting
`t = origin + k * period` over every kick in the overlap removes per-kick jitter and pairs beats by
grid index, so a missed kick can no longer shift the pairing by a whole beat.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MIN_FIT_KICKS = 6
OUTLIER_SHARE_OF_PERIOD = 0.18     # kicks further than 18 % of a beat from the line are fills/misses
FIT_ITERATIONS = 3


@dataclass(frozen=True)
class BeatGrid:
    origin_s: float      # time of grid beat 0
    period_s: float      # seconds per beat
    residual_ms: float   # p95 |kick - grid| of the kicks kept by the fit
    kicks_used: int

    def beat_time(self, index: int | np.ndarray) -> float | np.ndarray:
        return self.origin_s + np.asarray(index) * self.period_s

    def nearest_index(self, t: float) -> int:
        return int(round((t - self.origin_s) / self.period_s))


def fit_beat_grid(kicks: np.ndarray, approx_period: float) -> BeatGrid | None:
    """Least-squares grid through `kicks`, iteratively rejecting off-grid onsets. None if too sparse."""
    x = np.asarray(kicks, dtype=np.float64)
    if len(x) < MIN_FIT_KICKS or approx_period <= 0:
        return None
    period = float(approx_period)
    origin = float(x[0])
    keep = np.ones(len(x), dtype=bool)
    for _ in range(FIT_ITERATIONS):
        idx = np.round((x - origin) / period)
        resid = x - (origin + idx * period)
        keep = np.abs(resid) <= OUTLIER_SHARE_OF_PERIOD * period
        if keep.sum() < MIN_FIT_KICKS:
            return None
        k = idx[keep]
        if np.ptp(k) < MIN_FIT_KICKS - 1:
            return None
        slope, intercept = np.polyfit(k, x[keep], 1)
        # Never let the fit wander to another tempo family (half/double): stay within 6 % of the estimate
        if not (0.94 * approx_period <= slope <= 1.06 * approx_period):
            return None
        period, origin = float(slope), float(intercept)
    idx = np.round((x[keep] - origin) / period)
    resid_ms = np.abs(x[keep] - (origin + idx * period)) * 1000.0
    return BeatGrid(origin, period, float(np.percentile(resid_ms, 95)), int(keep.sum()))


RATE = 48_000
ENV_HOP = 48                       # 1 ms onset-strength resolution
LOW_BAND_HZ = 150.0
SEARCH_SPAN = 0.015                # refine the tempo within +-1.5 % of the estimate
SEARCH_STEPS = 151
PHASE_BINS = 240
MIN_FOLD_CONTRAST = 1.6            # folded peak / mean: below this the deck has no usable pulse


def _low_onset_envelope(audio: np.ndarray) -> np.ndarray:
    """1 ms low-band (<150 Hz) onset strength: positive log-energy derivative of the kick/sub band."""
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio
    size = 1 << int(np.ceil(np.log2(max(len(mono), 2))))
    spec = np.fft.rfft(mono.astype(np.float64), size)
    freqs = np.fft.rfftfreq(size, 1.0 / RATE)
    low = np.fft.irfft(spec / (1.0 + (freqs / LOW_BAND_HZ) ** 8), size)[: len(mono)]
    frames = len(low) // ENV_HOP
    energy = np.sqrt(np.mean(low[: frames * ENV_HOP].reshape(frames, ENV_HOP) ** 2, axis=1))
    smooth = np.convolve(energy, np.ones(10) / 10, mode="same")  # 10 ms
    return np.maximum(0.0, np.diff(np.log1p(1000.0 * smooth), prepend=0.0))


def _fold(env: np.ndarray, period_frames: float) -> np.ndarray:
    phase = (np.arange(len(env)) % period_frames) / period_frames
    bins = np.minimum((phase * PHASE_BINS).astype(int), PHASE_BINS - 1)
    hist = np.bincount(bins, weights=env, minlength=PHASE_BINS)
    kernel = np.ones(5) / 5  # circular smoothing over ~2 % of a beat
    padded = np.concatenate([hist[-2:], hist, hist[:2]])
    return np.convolve(padded, kernel, mode="valid")


def refine_grid_from_audio(audio: np.ndarray, approx_period: float) -> BeatGrid | None:
    """Precise tempo and beat phase of `audio` by folding its low-band onset envelope.

    Works on rumble techno where no isolated kick onsets exist, and measures the period over the whole
    slice, so a 0.1 % tempo error (20 ms over a 20 s blend) is resolved instead of being guessed.
    """
    if approx_period <= 0 or len(audio) < 8 * approx_period * RATE:
        return None
    env = _low_onset_envelope(audio)
    base = approx_period * RATE / ENV_HOP
    best: tuple[float, float, np.ndarray] | None = None
    for factor in np.linspace(1.0 - SEARCH_SPAN, 1.0 + SEARCH_SPAN, SEARCH_STEPS):
        folded = _fold(env, base * factor)
        contrast = float(folded.max() / (folded.mean() + 1e-12))
        if best is None or contrast > best[0]:
            best = (contrast, base * factor, folded)
    assert best is not None
    contrast, period_frames, folded = best
    if contrast < MIN_FOLD_CONTRAST:
        return None
    k = int(np.argmax(folded))
    # Parabolic interpolation of the phase peak for sub-bin precision
    l, c, r = folded[(k - 1) % PHASE_BINS], folded[k], folded[(k + 1) % PHASE_BINS]
    denom = l - 2 * c + r
    frac = 0.5 * (l - r) / denom if abs(denom) > 1e-12 else 0.0
    origin_frames = ((k + float(np.clip(frac, -0.5, 0.5))) / PHASE_BINS) * period_frames
    period_s = period_frames * ENV_HOP / RATE
    # residual_ms reports peak sharpness: width of the folded peak above half its height
    half = folded.min() + 0.5 * (folded.max() - folded.min())
    width_bins = int(np.sum(folded >= half))
    return BeatGrid(origin_frames * ENV_HOP / RATE, period_s, width_bins / PHASE_BINS * period_s * 500.0, 0)
