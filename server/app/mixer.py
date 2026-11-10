"""Mix engine: join two recordings so the kick keeps its beat across the seam.

Kick detection follows the KKiK sampler (synthapse/kkik/js/sampler/beatgrid.js): a zero-phase 150 Hz
low-pass, so the attack is not delayed, then a 20 ms envelope and the first sample at 25 % of the peak.
Unlike a DAW export, Lyria's kick is not a metronome (real archive: gaps 0.44-0.52 s at one tempo),
so no rigid grid is fitted. Instead:
  - the beat period is the median of the plausible kick gaps,
  - the seam is anchored on REAL kicks: a kick near the end of the first recording is laid over the
    first steady kick of the second, then both are crossfaded over a few beats.
Audio without a steady kick (ambient, jazz) gets a short equal-power crossfade instead.
"""
from __future__ import annotations

import numpy as np

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

MIN_BEAT_SECONDS = 0.28
MAX_BEAT_SECONDS = 1.0
PERIOD_TOLERANCE = 0.12            # a gap within 12 % of the median is a beat; others are fills or misses
MIN_STEADY_GAPS = 6
MIN_STEADY_SHARE = 0.5

ANALYSIS_SECONDS = 20.0
CROSSFADE_BEATS = 4
SWAP_RAMP_SECONDS = 0.005
FALLBACK_FADE_SECONDS = 0.5


def pcm_to_float(raw: bytes) -> np.ndarray:
    """Interleaved s16le stereo bytes -> float32 array of shape (frames, 2)."""
    samples = np.frombuffer(raw, dtype=np.int16)
    return (samples.astype(np.float32) / 32768.0).reshape(-1, CHANNELS)


def float_to_pcm(audio: np.ndarray) -> bytes:
    return np.clip(np.rint(audio * 32768.0), -32768, 32767).astype(np.int16).tobytes()


def _low_pass(mono: np.ndarray, hz: float = LOW_PASS_HZ) -> np.ndarray:
    """Zero-phase low-pass in the frequency domain: the kick attack is not delayed."""
    size = 1 << int(np.ceil(np.log2(max(len(mono), 2))))
    spectrum = np.fft.rfft(mono, size)
    freqs = np.fft.rfftfreq(size, 1.0 / RATE)
    spectrum *= 1.0 / (1.0 + (freqs / hz) ** 8)
    return np.fft.irfft(spectrum, size)[: len(mono)].astype(np.float32)


def _envelope(low: np.ndarray) -> np.ndarray:
    """Centred 20 ms moving average of |low|, sampled every ENVELOPE_HOP samples."""
    width = int(ENVELOPE_SECONDS * RATE)
    padded = np.concatenate([np.zeros(width // 2), np.abs(low), np.zeros(width)])
    cumulative = np.cumsum(padded, dtype=np.float64)
    smoothed = (cumulative[width:] - cumulative[:-width])[: len(low)] / width
    return smoothed[::ENVELOPE_HOP]


def _envelope_peaks(env: np.ndarray) -> list[int]:
    """Strongest envelope maximum per refractory window, above a share of the loud level."""
    if len(env) < 3:
        return []
    threshold = PEAK_THRESHOLD * np.percentile(env, 98)
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
    low = _low_pass(mono.astype(np.float32))
    env = _envelope(low)
    return np.array([_attack_time(low, env, peak) for peak in _envelope_peaks(env)])


def steady_period(onsets: np.ndarray) -> float | None:
    """Beat period in seconds, or None when the kick is not steady enough to mix on."""
    gaps = np.diff(onsets)
    gaps = gaps[np.logical_and(gaps >= MIN_BEAT_SECONDS, gaps <= MAX_BEAT_SECONDS)]
    if len(gaps) < MIN_STEADY_GAPS:
        return None
    centre = float(np.median(gaps))
    steady = gaps[np.abs(gaps - centre) <= PERIOD_TOLERANCE * centre]
    if len(steady) < MIN_STEADY_GAPS or len(steady) / len(gaps) < MIN_STEADY_SHARE:
        return None
    return float(np.median(steady))


def _onsets_of(audio: np.ndarray, from_end: bool) -> np.ndarray:
    """Kick onsets of the last (or first) ANALYSIS_SECONDS, in the time base of the whole recording."""
    span = int(ANALYSIS_SECONDS * RATE)
    offset = max(0, len(audio) - span) if from_end else 0
    return kick_onsets(audio[offset:offset + span].mean(axis=1)) + offset / RATE


def _first_steady_kick(onsets: np.ndarray, period: float) -> float | None:
    """First kick that is followed by another one a beat later: the start of a steady run."""
    for current, following in zip(onsets, onsets[1:]):
        if abs((following - current) - period) <= PERIOD_TOLERANCE * period:
            return float(current)
    return None


def _crossfade(tail: np.ndarray, head: np.ndarray, equal_power: bool) -> np.ndarray:
    ramp = np.linspace(0.0, 1.0, len(tail), dtype=np.float32)[:, None]
    if equal_power:
        return tail * np.cos(ramp * np.pi / 2) + head * np.sin(ramp * np.pi / 2)
    return tail * (1.0 - ramp) + head * ramp   # coherent kicks: the sum must not exceed the inputs


def _fallback_join(tail: np.ndarray, head: np.ndarray) -> np.ndarray:
    fade = min(int(FALLBACK_FADE_SECONDS * RATE), len(tail), len(head))
    if fade == 0:
        return np.concatenate([tail, head])
    mixed = _crossfade(tail[-fade:], head[:fade], equal_power=True)
    return np.concatenate([tail[:-fade], mixed, head[fade:]])


def _split_bands(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(low, high) with low + high == audio; the low band is the zero-phase kick band."""
    low = np.stack([_low_pass(audio[:, c]) for c in range(audio.shape[1])], axis=1)
    return low, audio - low


def _bass_swap(tail: np.ndarray, head: np.ndarray, fade: int) -> np.ndarray:
    """Mix `fade` frames: highs crossfade, the kick band switches to `head` exactly on its kick.

    Two kicks a few ms apart would cancel or leave a hole when summed, so only one of them is ever
    audible in the low band. Both kicks start on their attack, so they are coherent: a LINEAR ramp
    keeps the level, an equal-power one would add up to +3 dB.
    """
    tail_low, tail_high = _split_bands(tail)
    head_low, head_high = _split_bands(head)
    highs = _crossfade(tail_high, head_high, equal_power=False)
    ramp = min(int(SWAP_RAMP_SECONDS * RATE), fade)
    lows = head_low.copy()
    weight = np.linspace(0.0, 1.0, ramp, dtype=np.float32)[:, None]
    lows[:ramp] = tail_low[:ramp] * (1.0 - weight) + head_low[:ramp] * weight
    return lows + highs


def join_recordings(tail: np.ndarray, head: np.ndarray) -> np.ndarray:
    """Append `head` to `tail`; the first steady kick of `head` lands on a real kick of `tail`."""
    tail_onsets, head_onsets = _onsets_of(tail, from_end=True), _onsets_of(head, from_end=False)
    period = steady_period(tail_onsets)
    if period is None or steady_period(head_onsets) is None:
        return _fallback_join(tail, head)
    head_kick = _first_steady_kick(head_onsets, period)
    fade = int(round(CROSSFADE_BEATS * period * RATE))
    room = len(tail) / RATE - fade / RATE
    tail_kicks = tail_onsets[tail_onsets <= room]
    if head_kick is None or len(tail_kicks) == 0:
        return _fallback_join(tail, head)
    tail_cut, head_cut = int(round(tail_kicks[-1] * RATE)), int(round(head_kick * RATE))
    if len(head) - head_cut < fade or len(tail) - tail_cut < fade:
        return _fallback_join(tail, head)
    mixed = _bass_swap(tail[tail_cut:tail_cut + fade], head[head_cut:head_cut + fade], fade)
    return np.concatenate([tail[:tail_cut], mixed, head[head_cut + fade:]])
