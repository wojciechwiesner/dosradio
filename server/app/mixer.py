"""Mix engine: join two recordings seamlessly with phrase-length DJ crossfades and downbeat bass-swap.

Two distinct boundary regimes exist in DOS Radio streams:
  1. Intra-session (consecutive 30s slices of the same 3-minute Lyria recording, gap <= 45s):
     `join_intra_session` performs a 15 ms equal-power de-click splice without cutting beats.
  2. Inter-session (two different recordings/sessions or station rotation):
     `join_recordings` detects true beat-chain kicks (filtering out syncopated off-beat sub-bass notes),
     overlays a 16-beat (4-bar, ~7.5-9s) phrase with equal-power highs (>150 Hz) and swaps the sub-bass
     (<150 Hz) cleanly on the exact midpoint downbeat kick. Recordings without a steady kick (ambient,
     classical, folk, ethno, cinematic, jazz) receive a lush multi-second equal-power crossfade.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import threading

import numpy as np

from .beat_grid import MIN_FIT_KICKS, BeatGrid, fit_beat_grid, refine_grid_from_audio
from .dj_dsp import tempogram_beat_grid, wsola_stretch, wsola_tempo_glide
from .dj_genres import (
    TECHNIQUES,
    profile_for_stations,
    render_echo_out,
    render_eq_blend,
    render_filter_sweep,
    render_velvet_fade,
)

RATE = 48000
CHANNELS = 2

LOW_PASS_HZ = 150.0
ENVELOPE_SECONDS = 0.020
ENVELOPE_HOP = 96                  # 2 ms at 48 kHz
REFRACTORY_SECONDS = 0.22
PEAK_THRESHOLD = 0.5               # share of the 98th percentile envelope
ATTACK_FRACTION = 0.25             # onset = first sample reaching 25 % of the kick peak
LOOKBACK_SECONDS = 0.08
SEARCH_AFTER_SECONDS = 0.05

MIN_BEAT_SECONDS = 0.33            # up to 181 BPM (covers 174 BPM DnB while rejecting 3/2 aliases of 126 BPM)
MAX_BEAT_SECONDS = 1.05
PERIOD_TOLERANCE = 0.12            # a gap within 12 % of the median is a beat; others are fills or misses
MIN_STEADY_GAPS = 6
MIN_STEADY_SHARE = 0.5

ANALYSIS_SECONDS = 28.0
CROSSFADE_BEATS = 32               # 8 bars (~15.2s at 126 BPM) — real club DJ phrase transition
SWAP_RAMP_SECONDS = 0.008          # 8 ms coherent downbeat bass swap
FALLBACK_FADE_SECONDS = 12.0       # 12s velvet transition for ambient/classical/folk/jazz/B2B
INTRA_DECLICK_MS = 15.0            # 15 ms micro-splice for consecutive slices of the same session
MAX_BPM_DIFF_RATIO = 0.12          # +/- 12% standard Technics/CDJ beatmatch pitch range


@dataclass
class MixerConfig:
    crossfade_beats: int = CROSSFADE_BEATS
    fallback_fade_seconds: float = FALLBACK_FADE_SECONDS
    bass_swap_position: float = 0.5
    equal_power_highs: bool = True
    tempo_lock: bool = True
    intra_declick_ms: float = INTRA_DECLICK_MS
    technique: str = "auto"  # auto | eq_blend | filter_sweep | echo_out | velvet_fade


@dataclass
class MixReport:
    mode: str
    overlap_seconds: float
    beats_mixed: int
    bass_swap_seconds: float
    tail_bpm: float | None
    head_bpm: float | None
    peak_dbfs: float
    sub_rms_db: float
    mid_rms_db: float
    envelope_db: list[float]
    technique: str = "eq_blend"
    bpm_delta_pct: float | None = None
    pitch_locked: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


_config_lock = threading.Lock()
_default_config = MixerConfig()


def get_default_mixer_config() -> MixerConfig:
    with _config_lock:
        return MixerConfig(**asdict(_default_config))


def set_default_mixer_config(cfg: MixerConfig) -> MixerConfig:
    global _default_config
    tech = cfg.technique if cfg.technique in TECHNIQUES else "auto"
    clamped = MixerConfig(
        crossfade_beats=max(4, min(64, int(cfg.crossfade_beats))),
        fallback_fade_seconds=max(0.5, min(22.0, float(cfg.fallback_fade_seconds))),
        bass_swap_position=max(0.0, min(1.0, float(cfg.bass_swap_position))),
        equal_power_highs=bool(cfg.equal_power_highs),
        tempo_lock=bool(cfg.tempo_lock),
        intra_declick_ms=max(2.0, min(80.0, float(cfg.intra_declick_ms))),
        technique=tech,
    )
    with _config_lock:
        _default_config = clamped
    return clamped


def pcm_to_float(raw: bytes) -> np.ndarray:
    """Interleaved s16le stereo bytes -> float32 array of shape (frames, 2)."""
    samples = np.frombuffer(raw, dtype=np.int16)
    return (samples.astype(np.float32) / 32768.0).reshape(-1, CHANNELS)


def float_to_pcm(audio: np.ndarray) -> bytes:
    return np.clip(np.rint(audio * 32768.0), -32768, 32767).astype(np.int16).tobytes()


def _low_pass(mono: np.ndarray, hz: float = LOW_PASS_HZ) -> np.ndarray:
    """Zero-phase low-pass in the frequency domain: the kick attack is not delayed."""
    if len(mono) < 4:
        return mono.astype(np.float32)
    size = 1 << int(np.ceil(np.log2(max(len(mono), 2))))
    spectrum = np.fft.rfft(mono, size)
    freqs = np.fft.rfftfreq(size, 1.0 / RATE)
    spectrum *= 1.0 / (1.0 + (freqs / hz) ** 8)
    return np.fft.irfft(spectrum, size)[: len(mono)].astype(np.float32)


def _envelope(low: np.ndarray) -> np.ndarray:
    """Centred 20 ms moving average of |low|, sampled every ENVELOPE_HOP samples."""
    width = max(1, int(ENVELOPE_SECONDS * RATE))
    padded = np.concatenate([np.zeros(width // 2), np.abs(low), np.zeros(width)])
    cumulative = np.cumsum(padded, dtype=np.float64)
    smoothed = (cumulative[width:] - cumulative[:-width])[: len(low)] / width
    return smoothed[::ENVELOPE_HOP]


def _envelope_peaks(env: np.ndarray) -> list[int]:
    """Strongest envelope maximum per refractory window, above a share of the loud level."""
    if len(env) < 3:
        return []
    p98 = float(np.percentile(env, 98))
    if p98 <= 1e-5:
        return []
    threshold = PEAK_THRESHOLD * p98
    is_peak = np.logical_and(env[1:-1] > threshold, np.logical_and(env[1:-1] >= env[:-2], env[1:-1] > env[2:]))
    refractory = REFRACTORY_SECONDS * RATE / ENVELOPE_HOP
    kept: list[int] = []
    for index in np.where(is_peak)[0] + 1:
        if kept and index - kept[-1] < refractory:
            if env[index] > env[kept[-1]]:
                kept[-1] = int(index)
        else:
            kept.append(int(index))
    return kept


def _attack_time(low: np.ndarray, env: np.ndarray, peak: int) -> float:
    """Seconds of the kick attack: first sample after the preceding trough reaching 25 % of the peak."""
    back = int(LOOKBACK_SECONDS * RATE / ENVELOPE_HOP)
    first = max(0, peak - back)
    trough = first + int(np.argmin(env[first:peak + 1]))
    start = trough * ENVELOPE_HOP
    stop = min(len(low), peak * ENVELOPE_HOP + int(SEARCH_AFTER_SECONDS * RATE))
    window = np.abs(low[start:stop])
    if len(window) == 0 or window.max() <= 0:
        return peak * ENVELOPE_HOP / RATE
    first_hit = int(np.argmax(window >= ATTACK_FRACTION * window.max()))
    return (start + first_hit) / RATE


def kick_onsets(mono: np.ndarray) -> np.ndarray:
    """Kick attack times in seconds (sub-millisecond), empty when the audio has no kick."""
    if len(mono) < RATE // 4:
        return np.array([])
    # Reject near-silent or low-crest steady noise where random bumps are not real drum transients
    rms = float(np.sqrt(np.mean(mono.astype(np.float64) ** 2)))
    if rms < 1e-4:
        return np.array([])
    low = _low_pass(mono.astype(np.float32))
    low_rms = float(np.sqrt(np.mean(low.astype(np.float64) ** 2)))
    low_peak = float(np.percentile(np.abs(low), 99)) if len(low) else 0.0
    if low_rms < 1e-5 or (low_peak / (low_rms + 1e-9)) < 2.35:
        return np.array([])
    env = _envelope(low)
    return np.array([_attack_time(low, env, peak) for peak in _envelope_peaks(env)])


def _grid_aligned_onsets(onsets: np.ndarray, period: float) -> np.ndarray:
    """Return onsets lying on the strongest global metronome grid `t0 + k * period` (+-tol).

    Allows gentle generative tempo drift by tracking phase locally while rejecting random noise
    (where only ~24 % of random peaks fall in a +-12 % phase window).
    """
    if len(onsets) < 2 or period <= 0:
        return np.array([])
    tol = PERIOD_TOLERANCE * period
    best: list[float] = []
    # Test anchors across the clip (handles beatless intros as well as breakdowns)
    step = max(1, len(onsets) // 12)
    for anchor_idx in range(0, len(onsets), step):
        t0 = float(onsets[anchor_idx])
        # Walk backward from anchor
        back_chain = [t0]
        ref = t0
        for cand in reversed(onsets[:anchor_idx]):
            dt = ref - float(cand)
            k = round(dt / period)
            if 1 <= k <= 6 and abs(dt - k * period) <= tol * (1.0 + 0.12 * (k - 1)):
                back_chain.append(float(cand))
                ref = float(cand)
        back_chain.reverse()
        # Walk forward from anchor with adaptive phase tracking
        chain = back_chain
        ref = t0
        for cand in onsets[anchor_idx + 1:]:
            dt = float(cand) - ref
            k = round(dt / period)
            if 1 <= k <= 6 and abs(dt - k * period) <= tol * (1.0 + 0.12 * (k - 1)):
                chain.append(float(cand))
                ref = float(cand)
        if len(chain) > len(best):
            best = chain
    return np.array(best, dtype=np.float64)


def _extract_beat_chain(onsets: np.ndarray, period: float) -> np.ndarray:
    return _grid_aligned_onsets(onsets, period)


def _chain_period(chain: np.ndarray, approx_period: float) -> float | None:
    if len(chain) < MIN_STEADY_GAPS + 1:
        return None
    gaps = np.diff(chain)
    normed: list[float] = []
    for g in gaps:
        k = round(float(g) / approx_period)
        if 1 <= k <= 4 and abs(float(g) - k * approx_period) <= PERIOD_TOLERANCE * approx_period * (1.0 + 0.15 * (k - 1)):
            normed.append(float(g) / k)
    if len(normed) < MIN_STEADY_GAPS:
        return None
    return float(np.median(normed))


def steady_period(onsets: np.ndarray) -> float | None:
    """Beat period in seconds, or None when the kick is not steady enough to mix on.

    Requires at least 48 % of all detected low-band onsets to lock onto a coherent beat grid
    (random noise hits only ~24 %, whereas straight and syncopated grooves hit 55-100 %).
    """
    if len(onsets) < MIN_STEADY_GAPS + 1:
        return None
    total_span = float(onsets[-1] - onsets[0])
    if total_span < MIN_STEADY_GAPS * MIN_BEAT_SECONDS:
        return None

    gaps = np.diff(onsets)
    valid = gaps[np.logical_and(gaps >= MIN_BEAT_SECONDS, gaps <= MAX_BEAT_SECONDS)]
    candidates: list[float] = []
    if len(valid) >= MIN_STEADY_GAPS:
        candidates.append(float(np.median(valid)))
    n = len(onsets)
    for hop in (1, 2, 3):
        if n > hop:
            diffs = onsets[hop:] - onsets[:-hop]
            in_band = diffs[np.logical_and(diffs >= MIN_BEAT_SECONDS, diffs <= MAX_BEAT_SECONDS)]
            candidates.extend(float(x) for x in in_band)
    if not candidates:
        return None

    arr = np.sort(np.array(candidates, dtype=np.float64))
    sample_vals = [candidates[0]] + [float(v) for v in arr[::max(1, len(arr) // 36)]]
    tested: list[float] = []
    best_score = 0.0
    best_period: float | None = None

    for val in sample_vals:
        for cand in (val, val * 0.5):
            if not (MIN_BEAT_SECONDS <= cand <= MAX_BEAT_SECONDS):
                continue
            if any(abs(cand - prev) < 0.025 * cand for prev in tested):
                continue
            tested.append(cand)
            chain = _grid_aligned_onsets(onsets, cand)
            share = len(chain) / len(onsets)
            min_hits = max(MIN_STEADY_GAPS + 1, int(0.45 * total_span / cand))
            if len(chain) < min_hits or share < 0.48 or (chain[-1] - chain[0]) < 0.50 * total_span:
                continue
            refined = _chain_period(chain, cand)
            if refined is None or not (MIN_BEAT_SECONDS <= refined <= MAX_BEAT_SECONDS):
                continue
            # Prefer fundamental quarter-note groove (92..150 BPM) over 3/2 or double-speed sub-harmonics
            unit_steps = np.sum(np.abs(np.diff(chain) - refined) <= PERIOD_TOLERANCE * refined)
            unit_ratio = float(unit_steps) / max(1, len(chain) - 1)
            tempo_prior = 1.22 if 0.40 <= refined <= 0.65 else 0.88
            score = share * (0.60 + 0.40 * unit_ratio) * tempo_prior
            if score > best_score:
                best_score = score
                best_period = refined
    return best_period


def _onsets_of(audio: np.ndarray, from_end: bool) -> np.ndarray:
    """Kick onsets of the last (or first) ANALYSIS_SECONDS, in the time base of the whole recording."""
    span = int(ANALYSIS_SECONDS * RATE)
    offset = max(0, len(audio) - span) if from_end else 0
    return kick_onsets(audio[offset:offset + span].mean(axis=1)) + offset / RATE


def _first_steady_kick(onsets: np.ndarray, period: float) -> float | None:
    """First kick on the beat chain that is followed by another beat a period later."""
    chain = _extract_beat_chain(onsets, period)
    source = chain if len(chain) >= 2 else onsets
    for current, following in zip(source, source[1:]):
        if abs((following - current) - period) <= PERIOD_TOLERANCE * period:
            return float(current)
    return None


def _crossfade(tail: np.ndarray, head: np.ndarray, equal_power: bool) -> np.ndarray:
    if len(tail) == 0:
        return head[:0]
    ramp = np.linspace(0.0, 1.0, len(tail), dtype=np.float32)[:, None]
    if equal_power:
        return tail * np.cos(ramp * np.pi / 2) + head * np.sin(ramp * np.pi / 2)
    return tail * (1.0 - ramp) + head * ramp


def _resample_stereo(audio: np.ndarray, target_frames: int) -> np.ndarray:
    """Smooth linear resampling of stereo slice to `target_frames` for phase-locked transitions."""
    if target_frames <= 0 or len(audio) == 0 or len(audio) == target_frames:
        return audio[:target_frames]
    src_x = np.linspace(0.0, 1.0, len(audio), dtype=np.float64)
    dst_x = np.linspace(0.0, 1.0, target_frames, dtype=np.float64)
    out = np.empty((target_frames, audio.shape[1]), dtype=np.float32)
    for ch in range(audio.shape[1]):
        out[:, ch] = np.interp(dst_x, src_x, audio[:, ch]).astype(np.float32)
    return out


def _apply_ceiling(mixed: np.ndarray, ceiling: float) -> np.ndarray:
    """Ensure the mixed region never exceeds the peak amplitude of its inputs."""
    if len(mixed) == 0 or ceiling <= 0:
        return mixed
    peak = float(np.max(np.abs(mixed)))
    if peak > ceiling:
        return (mixed * (ceiling / peak)).astype(np.float32)
    return mixed


def join_intra_session(tail: np.ndarray, head: np.ndarray, declick_ms: float = INTRA_DECLICK_MS) -> np.ndarray:
    """Splice two consecutive 30s segments from the SAME Lyria session without dropping beats."""
    fade = min(int(round((declick_ms / 1000.0) * RATE)), len(tail) // 4, len(head) // 4)
    if fade <= 0:
        return np.concatenate([tail, head])
    ceiling = max(float(np.max(np.abs(tail[-fade:]))), float(np.max(np.abs(head[:fade]))), 1e-6)
    seam = _apply_ceiling(_crossfade(tail[-fade:], head[:fade], equal_power=True), ceiling)
    return np.concatenate([tail[:-fade], seam, head[fade:]])


def _fallback_join(tail: np.ndarray, head: np.ndarray, fade_seconds: float = FALLBACK_FADE_SECONDS) -> tuple[np.ndarray, int]:
    """Smooth equal-power high-band crossfade with non-overlapping low-band (<150 Hz) bass handoff so unsynced kicks never clash."""
    max_safe = min(len(tail) * 2 // 5, len(head) * 2 // 5)
    fade = min(int(round(fade_seconds * RATE)), max_safe)
    if fade <= 0:
        return np.concatenate([tail, head]), 0
    t_seg = tail[-fade:]
    h_seg = head[:fade]
    ceiling = max(float(np.max(np.abs(t_seg))), float(np.max(np.abs(h_seg))), 1e-6)
    if t_seg.ndim == 2 and fade >= 16:
        t_low, t_high = _split_bands(t_seg)
        h_low, h_high = _split_bands(h_seg)
        highs = _crossfade(t_high, h_high, equal_power=True)
        mid = fade // 2
        w_out = np.cos(np.linspace(0.0, np.pi * 0.5, mid, dtype=np.float32))[:, None]
        w_in = np.sin(np.linspace(0.0, np.pi * 0.5, fade - mid, dtype=np.float32))[:, None]
        lows = np.concatenate([t_low[:mid] * w_out, h_low[mid:] * w_in], axis=0)
        mixed = _apply_ceiling(lows + highs, ceiling)
    else:
        mixed = _apply_ceiling(_crossfade(t_seg, h_seg, equal_power=True), ceiling)
    return np.concatenate([tail[:-fade], mixed, head[fade:]]), fade


def _split_bands(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(low, high) with low + high == audio; the low band is the zero-phase kick/sub band."""
    low = np.stack([_low_pass(audio[:, c]) for c in range(audio.shape[1])], axis=1)
    return low, audio - low


VARISPEED_MAX_DEVIATION = 0.02    # <= 2 % tempo change: resample like a turntable (exact timing, intact kicks)
MAX_GRID_RESIDUAL_MS = 30.0       # a grid fitting the kicks worse than this is not trusted for tempo lock


def _fit_length(audio: np.ndarray, target_frames: int) -> np.ndarray:
    """Time-scale `audio` to exactly `target_frames`: varispeed for small changes, WSOLA above 2 %."""
    if len(audio) == 0 or target_frames <= 0:
        return audio[:0]
    if abs(target_frames / len(audio) - 1.0) <= VARISPEED_MAX_DEVIATION:
        return _resample_stereo(audio, target_frames)
    return wsola_stretch(audio, target_frames)


def _deck_grid(audio: np.ndarray, rel_kicks: np.ndarray) -> BeatGrid | None:
    """Beat grid of one deck: measured from its audio; a robust fit of its kicks if the audio has no pulse."""
    if len(rel_kicks) < 3:
        return None
    approx = float(np.median(np.diff(rel_kicks)))
    grid = refine_grid_from_audio(audio, approx)
    if grid is not None:
        return grid
    fitted = fit_beat_grid(rel_kicks, approx) if len(rel_kicks) >= MIN_FIT_KICKS else None
    if fitted is None or fitted.residual_ms > MAX_GRID_RESIDUAL_MS:
        return None
    return fitted


def _ordinal_swap_times(
    tail_rel_kicks: np.ndarray,
    head_rel_kicks: np.ndarray,
    tail_grid: BeatGrid,
    head_grid: BeatGrid,
    tail_first: float,
    head_beat0: float,
    shift_s: float,
    swap_index: int,
) -> tuple[float, float]:
    """(tail_time, trimmed_head_time) of the bass swap, snapped to the real measured kick on each deck.

    Picking the swap purely from each deck's fitted-line prediction treats the decks independently: each
    grid has its own few-ms residual, so "beat N of the tail" and "beat N of the head" land at idealised
    grid times that are each several ms from the deck's real kick attack, in opposite directions. Swapping
    the bass there crossfades two kicks that do not coincide; through the anti-flam ramp neither survives
    at full strength and the join reads as a dropped/doubled beat. Instead pair kicks by their grid
    ordinal on each deck and swap exactly on the measured kick at that ordinal; fall back to the grid time
    only when that beat has no detected kick.

    head_rel_kicks and head_grid live in the UNTRIMMED head frame while head_beat0 is in the trimmed one
    (trimmed = untrimmed - shift_s), so the target ordinal is computed in the untrimmed frame and the
    matched kick converted back to trimmed time.
    """
    tail_ideal = tail_first + swap_index * tail_grid.period_s
    head_ideal = head_beat0 + swap_index * head_grid.period_s
    tail_kicks = np.asarray(tail_rel_kicks, dtype=np.float64)
    head_kicks = np.asarray(head_rel_kicks, dtype=np.float64)
    tail_candidates = tail_kicks[
        np.round((tail_kicks - tail_grid.origin_s) / tail_grid.period_s) == tail_grid.nearest_index(tail_ideal)
    ]
    head_candidates = head_kicks[
        np.round((head_kicks - head_grid.origin_s) / head_grid.period_s)
        == head_grid.nearest_index(head_ideal + shift_s)
    ]
    t_time = float(tail_candidates[0]) if len(tail_candidates) else tail_ideal
    h_time = float(head_candidates[0]) - shift_s if len(head_candidates) else head_ideal
    return t_time, h_time


def _grid_swap_anchors(
    tail_slice: np.ndarray,
    head_slice: np.ndarray,
    tail_rel_kicks: np.ndarray,
    head_rel_kicks: np.ndarray,
    cfg: MixerConfig,
) -> tuple[int, int, float, int, int] | None:
    """Swap anchors taken from beat grids measured on the overlap audio itself, not from single kicks.

    Returns (t_swap, h_swap, period_ratio, beats, head_shift): the caller drops the first `head_shift`
    head frames so that, after a linear time-scale by `period_ratio`, every head beat lands on a tail beat.
    """
    tail_frames, head_frames = len(tail_slice), len(head_slice)
    tail_grid = _deck_grid(tail_slice, tail_rel_kicks)
    head_grid = _deck_grid(head_slice, head_rel_kicks)
    if tail_grid is None or head_grid is None:
        return None
    ratio = tail_grid.period_s / head_grid.period_s
    if not (1.0 - MAX_BPM_DIFF_RATIO <= ratio <= 1.0 + MAX_BPM_DIFF_RATIO):
        return None

    # First grid beat inside each slice; the head is trimmed so its beat sits at tail_first / ratio
    tail_first = tail_grid.origin_s % tail_grid.period_s
    head_first = head_grid.origin_s % head_grid.period_s
    head_beat0 = tail_first / ratio
    shift_s = (head_first - head_beat0) % head_grid.period_s
    head_shift = int(round(shift_s * RATE))

    beats_in_tail = int((tail_frames / RATE - tail_first) / tail_grid.period_s)
    if beats_in_tail < 4:
        return None
    swap_index = max(1, int(round(cfg.bass_swap_position * beats_in_tail)))
    t_swap_time, h_swap_time = _ordinal_swap_times(
        tail_rel_kicks, head_rel_kicks, tail_grid, head_grid, tail_first, head_beat0, shift_s, swap_index
    )
    t_swap = int(round(t_swap_time * RATE))
    h_swap = int(round(h_swap_time * RATE))
    if not (0 < t_swap < tail_frames and 0 < h_swap < head_frames - head_shift):
        return None
    return t_swap, h_swap, ratio, beats_in_tail, head_shift


def _bass_swap_phrase(
    tail_slice: np.ndarray,
    head_slice: np.ndarray,
    tail_rel_kicks: np.ndarray,
    head_rel_kicks: np.ndarray,
    cfg: MixerConfig,
) -> tuple[np.ndarray, int, int]:
    """Phrase crossfade with downbeat bass-swap and piecewise tempo lock so zero kicks flam.

    Returns (mixed_audio, consumed_head_frames, swap_frame_in_mixed).
    """
    fade_target = len(tail_slice)
    head_shift = 0
    ceiling = max(float(np.max(np.abs(tail_slice))), float(np.max(np.abs(head_slice))), 1e-6)

    # Choose swap beat index near cfg.bass_swap_position where both tracks have corresponding kicks
    pair_count = min(len(tail_rel_kicks), len(head_rel_kicks))
    swap_beat = int(round(cfg.bass_swap_position * max(0, pair_count - 1))) if pair_count >= 3 else 0

    grid_anchors = _grid_swap_anchors(tail_slice, head_slice, tail_rel_kicks, head_rel_kicks, cfg)
    t_swap = h_swap = 0
    period_ratio = 1.0
    if cfg.tempo_lock and grid_anchors is not None:
        t_swap, h_swap, period_ratio, pair_count, head_shift = grid_anchors
        head_slice = head_slice[head_shift:]
        anchors_ok = True
    elif cfg.tempo_lock and swap_beat > 0 and pair_count >= swap_beat + 1:
        t_swap = int(round(tail_rel_kicks[swap_beat] * RATE))
        h_swap = int(round(head_rel_kicks[swap_beat] * RATE))
        period_ratio = (t_swap / max(1, h_swap)) if h_swap > 0 else 1.0
        anchors_ok = True
    else:
        anchors_ok = False

    if anchors_ok:
        ratio = period_ratio
        if 0.875 <= ratio <= 1.143 and 0 < t_swap < fade_target and 0 < h_swap < len(head_slice):
            rem_tail = fade_target - t_swap
            rem_head = min(len(head_slice) - h_swap, int(round(rem_tail / ratio)))
            if rem_tail > RATE // 4 and rem_head > RATE // 4:
                # Before the swap the head locks to the tail tempo; after it the tail locks to the head tempo
                tail_pre = tail_slice[:t_swap]
                head_pre_warped = _fit_length(head_slice[:h_swap], t_swap)
                head_post = head_slice[h_swap : h_swap + rem_head]
                tail_post_warped = _fit_length(tail_slice[t_swap : t_swap + rem_tail], rem_head)

                t_aligned = np.concatenate([tail_pre, tail_post_warped], axis=0)
                h_aligned = np.concatenate([head_pre_warped, head_post], axis=0)

                _, high_probe = _split_bands(t_aligned[: min(len(t_aligned), RATE)])
                has_musical_top = float(np.sqrt(np.mean(high_probe**2))) > 1e-3
                beat_frames = max(1, len(t_aligned) // max(1, pair_count))
                tech = cfg.technique if cfg.technique != "auto" else "eq_blend"

                if has_musical_top and tech == "filter_sweep":
                    raw_mix = render_filter_sweep(t_aligned, h_aligned, t_swap, beat_frames)
                elif has_musical_top and tech == "echo_out":
                    period_s = (len(t_aligned) / RATE) / max(1, pair_count)
                    raw_mix = render_echo_out(t_aligned, h_aligned, period_s)
                elif has_musical_top and tech == "velvet_fade":
                    raw_mix = render_velvet_fade(t_aligned, h_aligned)
                elif has_musical_top and tech == "eq_blend":
                    raw_mix = render_eq_blend(t_aligned, h_aligned, t_swap, beat_frames)
                else:
                    t_low, t_high = _split_bands(t_aligned)
                    h_low, h_high = _split_bands(h_aligned)
                    highs = _crossfade(t_high, h_high, equal_power=cfg.equal_power_highs)
                    lows = np.empty_like(t_low)
                    lows[:t_swap] = t_low[:t_swap]
                    lows[t_swap:] = h_low[t_swap:]
                    ramp = min(int(SWAP_RAMP_SECONDS * RATE), len(lows) - t_swap)
                    if ramp > 1:
                        w = np.linspace(0.0, 1.0, ramp, dtype=np.float32)[:, None]
                        lows[t_swap : t_swap + ramp] = t_low[t_swap : t_swap + ramp] * (1.0 - w) + h_low[t_swap : t_swap + ramp] * w
                    raw_mix = lows + highs

                mixed = _apply_ceiling(raw_mix, ceiling)
                return mixed, head_shift + h_swap + rem_head, t_swap

    # Fallback frame-0 aligned bass-swap (used when swap_position == 0 or kicks are sparse)
    n = min(len(tail_slice), len(head_slice))
    t_low, t_high = _split_bands(tail_slice[:n])
    h_low, h_high = _split_bands(head_slice[:n])
    highs = _crossfade(t_high, h_high, equal_power=cfg.equal_power_highs)
    ramp = min(int(SWAP_RAMP_SECONDS * RATE), n)
    lows = h_low.copy()
    if ramp > 1:
        w = np.linspace(0.0, 1.0, ramp, dtype=np.float32)[:, None]
        lows[:ramp] = t_low[:ramp] * (1.0 - w) + h_low[:ramp] * w
    mixed = _apply_ceiling(lows + highs, ceiling)
    return mixed, n, 0


def _db(rms_val: float) -> float:
    return round(float(20.0 * np.log10(max(rms_val, 1e-6))), 2)


def _compute_report(
    mixed_region: np.ndarray,
    mode: str,
    beats_mixed: int,
    swap_frame: int,
    tail_period: float | None,
    head_period: float | None,
) -> MixReport:
    if len(mixed_region) == 0:
        return MixReport(mode, 0.0, 0, 0.0, None, None, -96.0, -96.0, -96.0, [])
    low, high = _split_bands(mixed_region)
    peak_db = _db(float(np.max(np.abs(mixed_region))))
    sub_rms = _db(float(np.sqrt(np.mean(low.astype(np.float64) ** 2))))
    mid_rms = _db(float(np.sqrt(np.mean(high.astype(np.float64) ** 2))))
    bins = min(64, max(8, len(mixed_region) // 2400))
    chunks = np.array_split(mixed_region, bins)
    env_db = [_db(float(np.sqrt(np.mean(c.astype(np.float64) ** 2)))) for c in chunks if len(c)]
    return MixReport(
        mode=mode,
        overlap_seconds=round(len(mixed_region) / RATE, 3),
        beats_mixed=beats_mixed,
        bass_swap_seconds=round(swap_frame / RATE, 3),
        tail_bpm=round(60.0 / tail_period, 1) if tail_period else None,
        head_bpm=round(60.0 / head_period, 1) if head_period else None,
        peak_dbfs=peak_db,
        sub_rms_db=sub_rms,
        mid_rms_db=mid_rms,
        envelope_db=env_db,
    )


def mix_with_report(
    tail: np.ndarray,
    head: np.ndarray,
    config: MixerConfig | None = None,
    station_a: str | None = None,
    station_b: str | None = None,
) -> tuple[np.ndarray, MixReport]:
    """Join two recordings using +/-12% pitch-locked WSOLA beatmatching and genre-aware DJ transitions."""
    base_cfg = config or get_default_mixer_config()
    prof = profile_for_stations(station_a, station_b)
    resolved_tech = base_cfg.technique if base_cfg.technique != "auto" else prof.technique
    target_beats = (
        prof.phrase_beats
        if (config is None and (station_a or station_b))
        else base_cfg.crossfade_beats
    )
    cfg = MixerConfig(
        crossfade_beats=target_beats,
        fallback_fade_seconds=prof.velvet_seconds if (config is None and (station_a or station_b)) else base_cfg.fallback_fade_seconds,
        bass_swap_position=base_cfg.bass_swap_position,
        equal_power_highs=base_cfg.equal_power_highs,
        tempo_lock=base_cfg.tempo_lock,
        intra_declick_ms=base_cfg.intra_declick_ms,
        technique=resolved_tech,
    )

    tail_raw_onsets = _onsets_of(tail, from_end=True)
    head_raw_onsets = _onsets_of(head, from_end=False)
    tail_period = steady_period(tail_raw_onsets)
    head_period = steady_period(head_raw_onsets)

    tail_from_tg = False
    head_from_tg = False
    if tail_period is None and resolved_tech != "velvet_fade":
        tail_period, tg_tail = tempogram_beat_grid(tail, from_end=True, analysis_seconds=ANALYSIS_SECONDS)
        if tail_period is not None:
            tail_raw_onsets = tg_tail
            tail_from_tg = True
    if head_period is None and resolved_tech != "velvet_fade":
        head_period, tg_head = tempogram_beat_grid(head, from_end=False, analysis_seconds=ANALYSIS_SECONDS)
        if head_period is not None:
            head_raw_onsets = tg_head
            head_from_tg = True

    bpm_delta_pct: float | None = None
    within_12pct = False
    if tail_period is not None and head_period is not None:
        tail_bpm_val = 60.0 / tail_period
        head_bpm_val = 60.0 / head_period
        rel_diff = abs(head_bpm_val - tail_bpm_val) / max(1e-6, tail_bpm_val)
        bpm_delta_pct = round(((head_bpm_val - tail_bpm_val) / max(1e-6, tail_bpm_val)) * 100.0, 2)
        within_12pct = rel_diff <= MAX_BPM_DIFF_RATIO

    # Outside +/-12% BPM or beatless: use Dub Echo-Out + Drop for rhythmic transitions, Velvet Fade for atmospheric
    if tail_period is None or head_period is None or not within_12pct or resolved_tech == "velvet_fade":
        mismatch_tech = (
            base_cfg.technique
            if base_cfg.technique in ("echo_out", "velvet_fade")
            else (prof.mismatch_technique if (tail_period is not None and (station_a or station_b)) else "velvet_fade")
        )
        if mismatch_tech == "echo_out" and tail_period is not None and len(tail) >= 4 * RATE and len(head) >= 4 * RATE:
            fade = min(int(round(16 * tail_period * RATE)), len(tail) * 2 // 5, len(head) * 2 // 5)
            ceiling = max(float(np.max(np.abs(tail[-fade:]))), float(np.max(np.abs(head[:fade]))), 1e-6)
            mixed = _apply_ceiling(render_echo_out(tail[-fade:], head[:fade], tail_period), ceiling)
            joined = np.concatenate([tail[:-fade], mixed, head[fade:]])
            rep = _compute_report(mixed, "dj_echo_out_drop", 16, int(fade * 0.45), tail_period, head_period)
            rep.technique = "echo_out"
            rep.bpm_delta_pct = bpm_delta_pct
            rep.pitch_locked = True
            return joined, rep

        joined, fade = _fallback_join(tail, head, cfg.fallback_fade_seconds)
        seam = joined[len(tail) - fade : len(tail)] if fade > 0 else joined[:0]
        rep = _compute_report(seam, "equal_power_fallback", 0, fade // 2, tail_period, head_period)
        rep.technique = "velvet_fade"
        rep.bpm_delta_pct = bpm_delta_pct
        rep.pitch_locked = True
        return joined, rep

    tail_chain = tail_raw_onsets if tail_from_tg else _extract_beat_chain(tail_raw_onsets, tail_period)
    head_chain = head_raw_onsets if head_from_tg else _extract_beat_chain(head_raw_onsets, head_period)
    if len(tail_chain) < 4:
        tail_chain = tail_raw_onsets
    if len(head_chain) < 4:
        head_chain = head_raw_onsets

    head_kick = _first_steady_kick(head_chain, head_period)
    if head_kick is None:
        joined, fade = _fallback_join(tail, head, cfg.fallback_fade_seconds)
        seam = joined[len(tail) - fade : len(tail)] if fade > 0 else joined[:0]
        rep = _compute_report(seam, "equal_power_fallback", 0, fade // 2, tail_period, head_period)
        rep.technique = "velvet_fade"
        rep.bpm_delta_pct = bpm_delta_pct
        return joined, rep

    # Pick the longest bar-aligned DJ phrase crossfade up to cfg.crossfade_beats that fits both recordings
    candidate_beats = sorted({cfg.crossfade_beats, 48, 32, 24, 16, 12, 8, 4}, reverse=True)
    candidate_beats = [b for b in candidate_beats if b <= cfg.crossfade_beats] or [cfg.crossfade_beats]

    chosen_beats = 0
    tail_cut = 0
    head_cut = int(round(head_kick * RATE))
    fade = 0
    for beats in candidate_beats:
        trial_fade = int(round(beats * tail_period * RATE))
        room = len(tail) / RATE - trial_fade / RATE
        eligible = tail_chain[tail_chain <= room]
        if len(eligible) == 0:
            continue
        t_cut = int(round(eligible[-1] * RATE))
        if len(tail) - t_cut >= trial_fade and len(head) - head_cut >= int(round(beats * head_period * RATE)):
            chosen_beats = beats
            tail_cut = t_cut
            fade = trial_fade
            break

    if chosen_beats == 0 or fade <= 0:
        joined, fb_fade = _fallback_join(tail, head, cfg.fallback_fade_seconds)
        seam = joined[len(tail) - fb_fade : len(tail)] if fb_fade > 0 else joined[:0]
        rep = _compute_report(seam, "equal_power_fallback", 0, fb_fade // 2, tail_period, head_period)
        rep.technique = "velvet_fade"
        rep.bpm_delta_pct = bpm_delta_pct
        return joined, rep

    head_span = min(len(head) - head_cut, max(fade, int(round(chosen_beats * head_period * RATE)) + RATE // 2))
    t_rel = tail_chain[(tail_chain >= tail_cut / RATE - 1e-4) & (tail_chain <= (tail_cut + fade) / RATE - 1e-3)] - tail_cut / RATE
    h_rel = head_chain[(head_chain >= head_cut / RATE - 1e-4) & (head_chain <= (head_cut + head_span) / RATE - 1e-3)] - head_cut / RATE

    mixed, head_consumed, swap_frame = _bass_swap_phrase(
        tail[tail_cut : tail_cut + fade],
        head[head_cut : head_cut + head_span],
        t_rel,
        h_rel,
        cfg,
    )
    joined = np.concatenate([tail[:tail_cut], mixed, head[head_cut + head_consumed :]])
    report = _compute_report(mixed, "beatmatched_bass_swap", chosen_beats, swap_frame, tail_period, head_period)
    report.technique = cfg.technique
    report.bpm_delta_pct = bpm_delta_pct
    report.pitch_locked = cfg.tempo_lock
    return joined, report


def join_recordings(
    tail: np.ndarray,
    head: np.ndarray,
    config: MixerConfig | None = None,
    station_a: str | None = None,
    station_b: str | None = None,
) -> np.ndarray:
    """Append `head` to `tail` using +/-12% pitch-locked DJ beatmatching and genre-aware transitions."""
    joined, _ = mix_with_report(tail, head, config=config, station_a=station_a, station_b=station_b)
    return joined
