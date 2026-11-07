"""Steady tones are detected and notched; moving partials and noise are left alone."""
from __future__ import annotations

import shutil
import subprocess
import time

import numpy as np
import pytest

from app.recorder import encode_pcm_to_opus
from app.tone_clean import (
    MAX_NOTCHES,
    SAMPLE_RATE,
    detect_steady_tones,
    pcm_to_mono,
    tone_notch_chain,
)

SEGMENT_SECONDS = 30
BUDGET_SECONDS = 1.5
TONE_HZ = 469.0
TONE_TOLERANCE_HZ = 10.0
NOISE_LEVEL = 0.02
MUSIC_LIKE_NOISE_LEVEL = 0.25
TONE_LEVEL = 0.2
STEREO = 2

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg missing")


def _time_axis(seconds: float = SEGMENT_SECONDS) -> np.ndarray:
    return np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE


def _noise(size: int, seed: int = 1) -> np.ndarray:
    return NOISE_LEVEL * np.random.default_rng(seed).standard_normal(size)


def _steady_tone(hz: float = TONE_HZ, noise_level: float = NOISE_LEVEL) -> np.ndarray:
    t = _time_axis()
    background = noise_level * np.random.default_rng(1).standard_normal(t.size)
    return (TONE_LEVEL * np.sin(2 * np.pi * hz * t) + background).astype(np.float32)


def _moving_sweep() -> np.ndarray:
    t = _time_axis()
    phase = 2 * np.pi * (200 * t + (3800 / (2 * SEGMENT_SECONDS)) * t * t)
    return (TONE_LEVEL * np.sin(phase) + _noise(t.size)).astype(np.float32)


def _to_stereo_pcm(mono: np.ndarray) -> bytes:
    s16 = np.clip(np.round(mono * 32767), -32768, 32767).astype("<i2")
    return np.repeat(s16[:, None], STEREO, axis=1).tobytes()


def _decode_opus(opus: bytes) -> bytes:
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "s16le",
         "-ar", str(SAMPLE_RATE), "-ac", str(STEREO), "pipe:1"],
        input=opus, capture_output=True, check=True,
    ).stdout


def test_steady_tone_is_detected_at_its_pitch() -> None:
    freqs = detect_steady_tones(_steady_tone())
    assert len(freqs) == 1
    assert abs(freqs[0] - TONE_HZ) < TONE_TOLERANCE_HZ


def test_moving_sweep_is_not_detected() -> None:
    assert detect_steady_tones(_moving_sweep()) == []


def test_noise_and_silence_are_not_detected() -> None:
    assert detect_steady_tones(_noise(SAMPLE_RATE * SEGMENT_SECONDS)) == []
    assert detect_steady_tones(np.zeros(SAMPLE_RATE * SEGMENT_SECONDS, dtype=np.float32)) == []


def test_buffer_shorter_than_one_frame_is_not_analysed() -> None:
    assert detect_steady_tones(np.zeros(100, dtype=np.float32)) == []


def test_at_most_max_notches_are_returned() -> None:
    t = _time_axis()
    mono = sum(0.1 * np.sin(2 * np.pi * hz * t) for hz in (500, 900, 1300, 2100, 3000, 4500))
    freqs = detect_steady_tones((mono + _noise(t.size)).astype(np.float32))
    assert len(freqs) == MAX_NOTCHES


def test_notch_chain_uses_equalizer_with_configured_width_and_gain() -> None:
    chain = tone_notch_chain(_to_stereo_pcm(_steady_tone()), STEREO)
    assert chain.startswith("equalizer=f=")
    assert "t=q:w=30:g=-36" in chain


def test_notch_chain_is_empty_without_tones() -> None:
    assert tone_notch_chain(_to_stereo_pcm(_moving_sweep()), STEREO) == ""


@requires_ffmpeg
def test_encoding_removes_the_steady_tone() -> None:
    pcm = _to_stereo_pcm(_steady_tone(noise_level=MUSIC_LIKE_NOISE_LEVEL))
    assert detect_steady_tones(pcm_to_mono(pcm, STEREO))
    decoded = _decode_opus(encode_pcm_to_opus(pcm))
    assert detect_steady_tones(pcm_to_mono(decoded, STEREO)) == []


def test_detection_fits_the_per_segment_budget() -> None:
    mono = _steady_tone()
    start = time.perf_counter()
    detect_steady_tones(mono)
    elapsed = time.perf_counter() - start
    assert elapsed <= BUDGET_SECONDS, f"detection took {elapsed:.2f}s"
