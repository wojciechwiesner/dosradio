"""Genre-aware DJ mixing profiles & transition techniques grounded in club/radio DJ practice."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .dj_dsp import (
    RATE,
    dj_filter_sweep,
    dub_echo_tail,
    split_3band_isolator,
)

TECHNIQUES = ("auto", "eq_blend", "filter_sweep", "echo_out", "velvet_fade")


@dataclass(frozen=True)
class GenreMixProfile:
    family: str
    technique: str  # default DJ transition when within +/-12% BPM
    mismatch_technique: str  # transition when BPM differs by >12% or no steady kick
    phrase_beats: int  # ideal DJ transition length in beats (32 = 8 bars, 48 = 12 bars, 64 = 16 bars)
    min_phrase_beats: int  # fallback phrase length when segment buffer is tighter
    bass_swap_pos: float  # 0.5 = exact midpoint downbeat swap
    velvet_seconds: float  # duration in seconds for beatless / >12% atmospheric blends


PROFILES: dict[str, GenreMixProfile] = {
    "techno": GenreMixProfile("techno", "eq_blend", "echo_out", 48, 32, 0.50, 14.0),
    "house": GenreMixProfile("house", "eq_blend", "echo_out", 32, 32, 0.50, 14.0),
    "trance_rave": GenreMixProfile("trance_rave", "filter_sweep", "echo_out", 32, 32, 0.50, 13.0),
    "dnb_breaks": GenreMixProfile("dnb_breaks", "eq_blend", "echo_out", 32, 16, 0.50, 10.0),
    "hiphop_dub_funk": GenreMixProfile("hiphop_dub_funk", "echo_out", "echo_out", 16, 16, 0.50, 10.0),
    "ambient_acoustic": GenreMixProfile("ambient_acoustic", "velvet_fade", "velvet_fade", 32, 16, 0.50, 16.0),
}

STATION_FAMILY: dict[str, str] = {
    # Techno & Rave
    "berlin-bcco-techno": "techno",
    "raw-techno": "techno",
    "hypnotic-techno": "techno",
    "minimal-techno": "techno",
    "detroit-techno": "techno",
    "tribal-techno": "techno",
    "etno-techno": "techno",
    "deep-tech": "techno",
    "dub-techno": "techno",
    "goa-trance": "trance_rave",
    "trance": "trance_rave",
    "hard-dance": "trance_rave",
    "tekk": "trance_rave",
    # House & Club
    "dos-groove": "house",
    "micro-house": "house",
    "deep-house": "house",
    "organic-house": "house",
    "tech-house": "house",
    "melodic-house": "house",
    "progressive-house": "house",
    "afro-house": "house",
    "club-dance": "trance_rave",
    "italo-disco": "house",
    # Synth
    "synthwave": "trance_rave",
    "stranger-synth": "trance_rave",
    "cyber-noir": "trance_rave",
    "cyberpunk": "trance_rave",
    "french-touch": "house",
    "elektronika": "house",
    # DnB & Breaks
    "drum-and-bass": "dnb_breaks",
    "liquid-dnb": "dnb_breaks",
    "breakbeat": "dnb_breaks",
    # Hip-Hop, Lo-Fi, Funk, Dub
    "poranna-kawa": "house",
    "lofi-nauka": "hiphop_dub_funk",
    "groove-funk": "hiphop_dub_funk",
    "trip-hop": "hiphop_dub_funk",
    "nocny-dub": "hiphop_dub_funk",
    # Ambient, Jazz, Classical, Folk & B2B Venues
    "stoa": "ambient_acoustic",
    "deep-ambient": "ambient_acoustic",
    "warm-jazz": "ambient_acoustic",
    "muzyka-klasyczna": "ambient_acoustic",
    "instrumentalna-akustyczna": "ambient_acoustic",
    "fortepian": "ambient_acoustic",
    "smyczki": "ambient_acoustic",
    "muzyka-filmowa": "ambient_acoustic",
    "gitara-akustyczna": "ambient_acoustic",
    "etno-world": "ambient_acoustic",
    "slowianski-folk": "ambient_acoustic",
    "salon-beauty-spa": "ambient_acoustic",
    "lobby-hotelowe": "ambient_acoustic",
    "poczekalnia": "ambient_acoustic",
    "sklep-showroom": "house",
    "kawiarnia-bistro": "ambient_acoustic",
    "silownia-fitness": "trance_rave",
}


def profile_for_stations(station_a: str | None, station_b: str | None) -> GenreMixProfile:
    fam_b = STATION_FAMILY.get(station_b or "", "")
    fam_a = STATION_FAMILY.get(station_a or "", "")
    if fam_a and fam_b and fam_a != fam_b:
        # Cross-genre family transition: use Dual LPF/HPF Filter Sweep to prevent harmonic/timbral clash
        base = PROFILES[fam_b]
        return GenreMixProfile(
            base.family, "filter_sweep", base.mismatch_technique, base.phrase_beats, base.min_phrase_beats, 0.50, base.velvet_seconds
        )
    return PROFILES[fam_b or fam_a or "house"]


def _bass_swap_envelope(length: int, swap_frame: int, ramp_frames: int) -> tuple[np.ndarray, np.ndarray]:
    """Clean DJ isolator low-band swap around `swap_frame` (zero simultaneous double-kick)."""
    half = max(2, ramp_frames // 2)
    s0 = max(0, swap_frame - half)
    s1 = min(length, swap_frame + half)
    span = max(1, s1 - s0)

    a_low = np.ones(length, dtype=np.float32)
    b_low = np.zeros(length, dtype=np.float32)
    theta = np.linspace(0.0, np.pi * 0.5, span, dtype=np.float32)
    a_low[s0:s1] = np.cos(theta) ** 2
    a_low[s1:] = 0.0
    b_low[s0:s1] = np.sin(theta) ** 2
    b_low[s1:] = 1.0
    return a_low, b_low


def render_eq_blend(
    t_seg: np.ndarray,
    h_seg: np.ndarray,
    swap_frame: int,
    beat_frames: int,
) -> np.ndarray:
    """Classic 3-band DJ Isolator EQ blend: Highs lead in, Mids weave, Low swaps cleanly on the phrase downbeat."""
    n = len(t_seg)
    shape = (-1, 1) if t_seg.ndim == 2 else (-1,)
    p = np.linspace(0.0, 1.0, n, dtype=np.float32)

    t_low, t_mid, t_high = split_3band_isolator(t_seg)
    h_low, h_mid, h_high = split_3band_isolator(h_seg)

    # Highs (>3.2 kHz): incoming hats enter early (0 -> 0.55), outgoing hats exit smoothly (0.35 -> 1.0)
    h_hi_g = np.sin(np.clip(p / 0.65, 0.0, 1.0) * (np.pi * 0.5)).reshape(shape)
    t_hi_g = np.cos(np.clip((p - 0.30) / 0.70, 0.0, 1.0) * (np.pi * 0.5)).reshape(shape)

    # Mids (150-3200 Hz): gradual equal-power S-curve weave with slight -1.5 dB center dip so vocals/stabs don't crowd
    theta = p * (np.pi * 0.5)
    dip = (1.0 - 0.14 * np.sin(p * np.pi)).reshape(shape)
    t_mid_g = np.cos(theta).reshape(shape) * dip
    h_mid_g = np.sin(theta).reshape(shape) * dip

    # Lows (<150 Hz): crisp 1-beat isolator bass swap at the phrase boundary
    a_lo, b_lo = _bass_swap_envelope(n, swap_frame, max(int(0.04 * RATE), beat_frames // 2))
    low = t_low * a_lo.reshape(shape) + h_low * b_lo.reshape(shape)
    mid = t_mid * t_mid_g + h_mid * h_mid_g
    high = t_high * t_hi_g + h_high * h_hi_g
    return (low + mid + high).astype(np.float32)


def render_filter_sweep(
    t_seg: np.ndarray,
    h_seg: np.ndarray,
    swap_frame: int,
    beat_frames: int,
) -> np.ndarray:
    """Dual DJ Filter Sweep: incoming opens HPF (1100 Hz -> 22 Hz), outgoing closes LPF (18 kHz -> 280 Hz) + bass swap."""
    n = len(t_seg)
    shape = (-1, 1) if t_seg.ndim == 2 else (-1,)
    p = np.linspace(0.0, 1.0, n, dtype=np.float32)

    t_filt = dj_filter_sweep(t_seg, "lpf", start_hz=18_000.0, end_hz=280.0, resonance=0.16)
    h_filt = dj_filter_sweep(h_seg, "hpf", start_hz=1_100.0, end_hz=22.0, resonance=0.18)

    t_low, t_mid, t_high = split_3band_isolator(t_filt)
    h_low, h_mid, h_high = split_3band_isolator(h_filt)

    a_lo, b_lo = _bass_swap_envelope(n, swap_frame, max(int(0.04 * RATE), beat_frames // 2))
    theta = p * (np.pi * 0.5)
    t_top = (t_mid + t_high) * np.cos(theta).reshape(shape)
    h_top = (h_mid + h_high) * np.sin(theta).reshape(shape)
    low = t_low * a_lo.reshape(shape) + h_low * b_lo.reshape(shape)
    return (low + t_top + h_top).astype(np.float32)


def render_echo_out(
    t_seg: np.ndarray,
    h_seg: np.ndarray,
    beat_period_s: float,
) -> np.ndarray:
    """Dub Echo-Out + Downbeat Drop: Deck A washes into a 3/4-beat band-passed echo tail while Deck B drops clean."""
    n = len(t_seg)
    shape = (-1, 1) if t_seg.ndim == 2 else (-1,)
    drop_idx = max(1, int(round(n * 0.45)))  # Deck B drops cleanly just before midpoint while echo tail shimmers over it

    # Dry Deck A plays up to drop_idx with bass rolling off in the last 30% before the drop
    t_low, t_mid, t_high = split_3band_isolator(t_seg[:drop_idx])
    p_a = np.linspace(0.0, 1.0, drop_idx, dtype=np.float32)
    low_duck = np.cos(np.clip((p_a - 0.55) / 0.45, 0.0, 1.0) * (np.pi * 0.5)).reshape(shape)
    top_duck = np.cos(np.clip((p_a - 0.70) / 0.30, 0.0, 1.0) * (np.pi * 0.5)).reshape(shape)
    dry_a = t_low * low_duck + (t_mid + t_high) * top_duck

    # 3/4-beat dub echo generated from Deck A's pre-drop phrase, ringing out over the remaining (n - drop_idx) frames
    echo_full = dub_echo_tail(t_seg[:drop_idx], beat_period_s, tail_frames=n - drop_idx, feedback=0.52, wet_mix=0.60)

    out = echo_full.copy()
    out[:drop_idx] += dry_a

    # Deck B enters crisply at drop_idx with a 25 ms declick ramp on the downbeat
    b_len = n - drop_idx
    b_seg = h_seg[:b_len].copy()
    ramp = min(b_len, int(0.025 * RATE))
    if ramp > 1:
        w = np.sin(np.linspace(0.0, np.pi * 0.5, ramp, dtype=np.float32)).reshape(shape)
        b_seg[:ramp] *= w
    out[drop_idx:] += b_seg
    return out.astype(np.float32)


def render_velvet_fade(t_seg: np.ndarray, h_seg: np.ndarray) -> np.ndarray:
    """Long S-curve 3-band spectral fade for Ambient, Jazz, Classical & B2B Spaces (zero low-end boom)."""
    n = len(t_seg)
    shape = (-1, 1) if t_seg.ndim == 2 else (-1,)
    p = np.linspace(0.0, 1.0, n, dtype=np.float32)
    # Smooth cosine S-curve progression
    s = 0.5 - 0.5 * np.cos(p * np.pi)
    theta = s * (np.pi * 0.5)

    t_low, t_mid, t_high = split_3band_isolator(t_seg)
    h_low, h_mid, h_high = split_3band_isolator(h_seg)

    mid = n // 2
    w_out = np.cos(np.linspace(0.0, np.pi * 0.5, mid, dtype=np.float32)).reshape(shape)
    w_in = np.sin(np.linspace(0.0, np.pi * 0.5, n - mid, dtype=np.float32)).reshape(shape)
    low = np.concatenate([t_low[:mid] * w_out, h_low[mid:] * w_in], axis=0)
    highs = (t_mid + t_high) * np.cos(theta).reshape(shape) + (h_mid + h_high) * np.sin(theta).reshape(shape)
    return (low + highs).astype(np.float32)
