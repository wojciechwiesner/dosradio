"""Grok speech as the Gemini TTS fallback: one voice table and MP3 -> WAV conversion.

Every Gemini prebuilt voice maps to one fixed Grok voice of the same gender, so a host
keeps one consistent voice whichever provider served the clip. Grok voice gender was
measured on 2026-11-23 (median F0 of the same Polish sentence): eve 211 Hz, ara 220 Hz,
una 207 Hz (female); rex 133 Hz, leo 138 Hz, sal 129 Hz (male).
"""
from __future__ import annotations

import io
import subprocess
import tempfile
import wave
from pathlib import Path

GROK_FEMALE_VOICES = ("eve", "ara", "una")
GROK_MALE_VOICES = ("rex", "leo", "sal")
DEFAULT_GROK_VOICE = "ara"
WAV_RATE = 24000
FFMPEG_TIMEOUT_S = 30

# Gemini prebuilt voice -> Grok voice. The single source of truth for the fallback.
GROK_VOICE_BY_GEMINI: dict[str, str] = {
    # female
    "Kore": "ara", "Leda": "eve", "Zephyr": "eve", "Aoede": "una", "Callirrhoe": "ara",
    "Autonoe": "una", "Despina": "eve", "Erinome": "ara", "Laomedeia": "eve",
    "Achernar": "una", "Gacrux": "ara", "Pulcherrima": "eve", "Vindemiatrix": "una",
    "Sulafat": "ara",
    # male
    "Charon": "rex", "Orus": "leo", "Puck": "sal", "Fenrir": "rex", "Alnilam": "leo",
    "Enceladus": "sal", "Iapetus": "rex", "Umbriel": "sal", "Algieba": "leo",
    "Algenib": "rex", "Rasalgethi": "leo", "Schedar": "rex", "Achird": "sal",
    "Zubenelgenubi": "leo", "Sadachbia": "sal", "Sadaltager": "leo",
}


def grok_voice_for(gemini_voice: str) -> str:
    """Stable Grok voice for a Gemini voice name (case-insensitive, unknown -> default)."""
    wanted = (gemini_voice or "").strip().lower()
    for name, grok in GROK_VOICE_BY_GEMINI.items():
        if name.lower() == wanted:
            return grok
    if wanted in GROK_FEMALE_VOICES + GROK_MALE_VOICES:
        return wanted  # already a Grok voice
    return DEFAULT_GROK_VOICE


def mp3_to_wav(mp3: bytes, rate: int = WAV_RATE) -> bytes:
    """Decode MP3 to 16-bit mono PCM WAV (the format Gemini TTS yields). Raises on failure.

    Seekable temp files, not pipes, so ffmpeg writes a plain WAV header the `wave`
    module can read (same reason as news.normalize_loudness).
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        src, dst = Path(tmp_dir) / "in.mp3", Path(tmp_dir) / "out.wav"
        src.write_bytes(mp3)
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
             "-ar", str(rate), "-ac", "1", "-sample_fmt", "s16", "-c:a", "pcm_s16le", str(dst)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=FFMPEG_TIMEOUT_S,
        )
        if proc.returncode != 0 or not dst.exists():
            raise RuntimeError(f"mp3 decode failed (exit {proc.returncode}): {proc.stderr.decode()[:200]}")
        wav = dst.read_bytes()
    wav_seconds(wav)  # autocheck spot: the result must be a readable WAV
    return wav


def wav_seconds(wav: bytes) -> float:
    with wave.open(io.BytesIO(wav), "rb") as reader:
        return reader.getnframes() / float(reader.getframerate() or WAV_RATE)
