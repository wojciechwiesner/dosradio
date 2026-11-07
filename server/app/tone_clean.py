"""Steady-tone detection for recorded Lyria PCM and the ffmpeg notch chain that removes it.

Lyria sessions drift into a steady whine after 30-60 s and the whine is baked into the archive.
A tone is steady when one FFT bin stands out from its local median floor on most frames.
"""
from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

SAMPLE_RATE = 48000
FFT_SIZE = 8192
HOP_SIZE = 8192
FLOOR_HALF_WIDTH_HZ = 300.0
FLOOR_BIN_STEP = 2
PROMINENCE_DB = 12.0
FRAME_SHARE = 0.8
BAND_LOW_HZ = 300.0
BAND_HIGH_HZ = 16000.0
MIN_PEAK_SPACING_BINS = 3
MAX_NOTCHES = 4
NOTCH_GAIN_DB = -36
NOTCH_Q = 30
CHUNK_FRAMES = 16
PCM_SCALE = 32768.0
DB_EPSILON = 1e-9
PCM_DTYPE = "<i2"


def pcm_to_mono(pcm: bytes, channels: int) -> np.ndarray:
    samples = np.frombuffer(pcm, dtype=PCM_DTYPE).astype(np.float32) / PCM_SCALE
    usable = samples.size - samples.size % channels
    return samples[:usable].reshape(-1, channels).mean(axis=1)


def _magnitude_db(mono: np.ndarray) -> np.ndarray:
    frames = sliding_window_view(mono, FFT_SIZE)[::HOP_SIZE]
    window = np.hanning(FFT_SIZE).astype(np.float32)
    spectrum = np.fft.rfft(frames * window, axis=1)
    return 20 * np.log10(np.abs(spectrum) + DB_EPSILON)


def _local_floor(magnitude_db: np.ndarray, low: int, high: int, half_width: int) -> np.ndarray:
    padded = np.pad(magnitude_db, ((0, 0), (half_width, half_width)), mode="edge")
    windows = sliding_window_view(padded, 2 * half_width + 1, axis=1)
    floor = np.empty((magnitude_db.shape[0], high - low), dtype=magnitude_db.dtype)
    for start in range(0, magnitude_db.shape[0], CHUNK_FRAMES):
        stop = start + CHUNK_FRAMES
        floor[start:stop] = np.median(windows[start:stop, low:high, ::FLOOR_BIN_STEP], axis=2)
    return floor


def detect_steady_tones(mono: np.ndarray, rate: int = SAMPLE_RATE) -> list[float]:
    if mono.size < FFT_SIZE:
        return []
    bin_hz = rate / FFT_SIZE
    half_width = round(FLOOR_HALF_WIDTH_HZ / bin_hz)
    magnitude_db = _magnitude_db(mono)
    freqs = np.fft.rfftfreq(FFT_SIZE, 1 / rate)
    low, high = np.searchsorted(freqs, [BAND_LOW_HZ, BAND_HIGH_HZ])
    excess = magnitude_db[:, low:high] - _local_floor(magnitude_db, low, high, half_width)
    share = (excess >= PROMINENCE_DB).mean(axis=0)
    candidates = np.flatnonzero(share >= FRAME_SHARE)
    strength = excess[:, candidates].mean(axis=0)
    ranked = candidates[np.lexsort((-strength, -share[candidates]))]
    picked: list[int] = []
    for index in ranked:
        if all(abs(index - other) >= MIN_PEAK_SPACING_BINS for other in picked):
            picked.append(int(index))
        if len(picked) == MAX_NOTCHES:
            break
    return [float(freqs[low + index]) for index in picked]


def notch_chain(freqs: list[float]) -> str:
    return ",".join(
        f"equalizer=f={freq:.1f}:t=q:w={NOTCH_Q}:g={NOTCH_GAIN_DB}" for freq in freqs
    )


def tone_notch_chain(pcm: bytes, channels: int, rate: int = SAMPLE_RATE) -> str:
    return notch_chain(detect_steady_tones(pcm_to_mono(pcm, channels), rate))
