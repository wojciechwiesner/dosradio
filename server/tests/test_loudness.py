"""normalize_loudness: ffmpeg loudnorm should land synthetic audio near the target LUFS."""
from __future__ import annotations

import io
import json
import math
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.news import TARGET_LUFS, normalize_loudness  # noqa: E402

FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None


def _make_sine_wav(duration_s: float = 1.0, rate: int = 24000, freq: float = 440.0, amplitude: float = 0.5) -> bytes:
    """Build a mono 16-bit PCM WAV sine tone using only stdlib wave (no network)."""
    n_samples = int(duration_s * rate)
    samples = [
        int(amplitude * 32767 * math.sin(2 * math.pi * freq * (i / rate)))
        for i in range(n_samples)
    ]
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(rate)
        wav_file.writeframes(struct.pack(f"<{n_samples}h", *samples))
    return buffer.getvalue()


def _measure_integrated_lufs(wav: bytes) -> float:
    """Measure integrated loudness of a WAV blob via ffmpeg's loudnorm analysis pass."""
    cmd = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", "pipe:0",
        "-af", "loudnorm=print_format=json", "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, input=wav, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    stderr = proc.stderr.decode()
    json_start = stderr.rfind("{")
    json_end = stderr.rfind("}") + 1
    assert json_start != -1 and json_end > json_start, f"no loudnorm json in ffmpeg stderr: {stderr[-500:]}"
    stats = json.loads(stderr[json_start:json_end])
    return float(stats["input_i"])


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg not installed")
def test_normalize_loudness_lands_near_target():
    raw = _make_sine_wav(amplitude=0.9)  # loud input, well above target
    normalized = normalize_loudness(raw, target_lufs=TARGET_LUFS)

    assert normalized, "normalize_loudness returned empty audio"
    with wave.open(io.BytesIO(normalized), "rb") as wav_file:
        assert wav_file.getnchannels() == 1
        assert wav_file.getsampwidth() == 2
        assert wav_file.getnframes() > 0

    measured_lufs = _measure_integrated_lufs(normalized)
    assert abs(measured_lufs - TARGET_LUFS) <= 2.0, (
        f"measured {measured_lufs} LUFS, expected within 2 LU of {TARGET_LUFS}"
    )


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg not installed")
def test_normalize_loudness_quiet_input_also_lands_near_target():
    raw = _make_sine_wav(amplitude=0.05)  # quiet input, well below target
    normalized = normalize_loudness(raw, target_lufs=TARGET_LUFS)

    measured_lufs = _measure_integrated_lufs(normalized)
    assert abs(measured_lufs - TARGET_LUFS) <= 2.0, (
        f"measured {measured_lufs} LUFS, expected within 2 LU of {TARGET_LUFS}"
    )


def test_normalize_loudness_falls_back_on_missing_ffmpeg(monkeypatch):
    """If ffmpeg is unavailable, the original audio is returned, never an exception."""
    raw = _make_sine_wav(duration_s=0.1)

    def fake_run(*args, **kwargs):
        raise FileNotFoundError("ffmpeg not found")

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr("app.news.subprocess.run", fake_run)
    result = normalize_loudness(raw)
    assert result == raw
