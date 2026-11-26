"""HeyGen Voice Turbo via OpenRouter as the second TTS provider (Gemini -> HeyGen -> Grok).

Configuration comes from the environment only:

    DOSRADIO_OPENROUTER_TTS_KEY    bearer key; falls back to OPENROUTER_API_KEY; empty disables
    DOSRADIO_OPENROUTER_TTS_MODEL  default heygen/heygen-voice-1-turbo:free (retired 2026-11-30,
                                   the paid id is heygen/heygen-voice-1-turbo)
    DOSRADIO_OPENROUTER_TTS_URL    default https://openrouter.ai/api/v1

The API returns raw 16-bit little-endian mono PCM at 44100 Hz (not JSON) and accepts at most
5000 characters per request. Voice gender was measured on 2026-11-26 (median F0): female =
nadine, noelle, sabrina, tabitha; male = bram, gareth, lucian, vincent, weston. `meredith`
(155 Hz) is ambiguous and is never mapped.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Mapping

import httpx

from .llm_breaker import CircuitBreaker, ProviderError, parse_retry_after
from .llm_fallback import _error_message
from .news import pcm_to_wav

log = logging.getLogger("dosradio.tts_openrouter")

PROVIDER = "openrouter"
DEFAULT_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "heygen/heygen-voice-1-turbo:free"
DEFAULT_VOICE = "nadine"
PCM_RATE = 44100
MAX_CHARS = 4800  # hard API limit is 5000; keep a margin
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")

HEYGEN_FEMALE_VOICES = ("nadine", "noelle", "sabrina", "tabitha")
HEYGEN_MALE_VOICES = ("bram", "gareth", "lucian", "vincent", "weston")

# Gemini prebuilt voice -> HeyGen voice of the same gender (hosts spread over different voices).
HEYGEN_VOICE_BY_GEMINI: dict[str, str] = {
    # female
    "Kore": "nadine", "Leda": "noelle", "Zephyr": "sabrina", "Aoede": "tabitha",
    "Callirrhoe": "nadine", "Autonoe": "noelle", "Despina": "sabrina", "Erinome": "tabitha",
    "Laomedeia": "noelle", "Achernar": "sabrina", "Gacrux": "nadine", "Pulcherrima": "tabitha",
    "Vindemiatrix": "noelle", "Sulafat": "nadine",
    # male
    "Charon": "bram", "Orus": "gareth", "Puck": "lucian", "Fenrir": "vincent", "Alnilam": "weston",
    "Enceladus": "gareth", "Iapetus": "bram", "Umbriel": "lucian", "Algieba": "weston",
    "Algenib": "vincent", "Rasalgethi": "gareth", "Schedar": "bram", "Achird": "lucian",
    "Zubenelgenubi": "weston", "Sadachbia": "vincent", "Sadaltager": "gareth",
}


@dataclass(frozen=True)
class OpenRouterTtsConfig:
    key: str = ""
    model: str = DEFAULT_MODEL
    url: str = DEFAULT_URL

    @property
    def enabled(self) -> bool:
        return bool(self.key)


def load_openrouter_tts_config(env: Mapping[str, str] = os.environ) -> OpenRouterTtsConfig:
    key = env.get("DOSRADIO_OPENROUTER_TTS_KEY", "").strip() or env.get("OPENROUTER_API_KEY", "").strip()
    return OpenRouterTtsConfig(
        key=key,
        model=env.get("DOSRADIO_OPENROUTER_TTS_MODEL", "").strip() or DEFAULT_MODEL,
        url=(env.get("DOSRADIO_OPENROUTER_TTS_URL", "").strip() or DEFAULT_URL).rstrip("/"),
    )


def heygen_voice_for(gemini_voice: str) -> str:
    """Stable HeyGen voice for a Gemini voice name (case-insensitive, unknown -> default)."""
    wanted = (gemini_voice or "").strip().lower()
    for name, heygen in HEYGEN_VOICE_BY_GEMINI.items():
        if name.lower() == wanted:
            return heygen
    if wanted in HEYGEN_FEMALE_VOICES + HEYGEN_MALE_VOICES:
        return wanted
    return DEFAULT_VOICE


def split_text(text: str, limit: int = MAX_CHARS) -> list[str]:
    """Chunks of at most `limit` characters, cut at sentence boundaries (hard cut as last resort)."""
    chunks: list[str] = []
    current = ""
    for sentence in SENTENCE_END.split(text.strip()):
        while len(sentence) > limit:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(sentence[:limit])
            sentence = sentence[limit:]
        if current and len(current) + 1 + len(sentence) > limit:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks


class OpenRouterTts:
    """Speech through OpenRouter, guarded by the shared breaker under its own provider key."""

    def __init__(self, config: OpenRouterTtsConfig, http: httpx.AsyncClient, breaker: CircuitBreaker) -> None:
        self.config = config
        self.http = http
        self.breaker = breaker

    @property
    def enabled(self) -> bool:
        return self.config.enabled

    async def _chunk_pcm(self, text: str, voice: str) -> bytes:
        model = self.config.model
        self.breaker.guard(PROVIDER, model)
        response = await self.http.post(
            f"{self.config.url}/audio/speech",
            headers={"authorization": f"Bearer {self.config.key}", "content-type": "application/json"},
            json={"model": model, "input": text, "voice": voice, "response_format": "pcm"},
        )
        if response.status_code < 200 or response.status_code >= 300:
            message = _error_message(response)
            log.warning("openrouter tts HTTP %s (generation %s): %s", response.status_code,
                        response.headers.get("x-generation-id", "?"), message)
            error = ProviderError(PROVIDER, model, response.status_code, message,
                                  parse_retry_after(response.headers.get("retry-after")))
            self.breaker.record(error)
            raise error
        if not response.content:
            raise RuntimeError(f"{PROVIDER}/{model} returned no audio "
                               f"(generation {response.headers.get('x-generation-id', '?')})")
        self.breaker.success(PROVIDER, model)
        return response.content

    async def speech(self, text: str, voice: str) -> bytes:
        """WAV (mono, 44100 Hz) for `text`; raises ProviderError / RuntimeError on failure."""
        if not self.enabled:
            raise RuntimeError("OpenRouter TTS disabled (no DOSRADIO_OPENROUTER_TTS_KEY / OPENROUTER_API_KEY)")
        if not text.strip():
            raise RuntimeError("OpenRouter TTS got empty text")
        pcm = b"".join([await self._chunk_pcm(chunk, voice) for chunk in split_text(text)])
        return pcm_to_wav(pcm, PCM_RATE)
