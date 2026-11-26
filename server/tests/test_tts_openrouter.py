"""HeyGen Voice Turbo (OpenRouter) in the TTS chain Gemini -> HeyGen -> Grok. No network."""
from __future__ import annotations

import asyncio
import io
import json
import shutil
import subprocess
import wave

import httpx
import pytest

from app.gemini_client import GeminiClient
from app.llm_breaker import CircuitBreaker
from app.llm_fallback import FallbackConfig, FallbackLLM
from app.tts_fallback import GROK_VOICE_BY_GEMINI
from app.tts_openrouter import (
    DEFAULT_MODEL, HEYGEN_FEMALE_VOICES, HEYGEN_MALE_VOICES, HEYGEN_VOICE_BY_GEMINI, MAX_CHARS, PCM_RATE,
    OpenRouterTts, OpenRouterTtsConfig, heygen_voice_for, load_openrouter_tts_config, split_text,
)

GEMINI_FEMALE = {"Zephyr", "Kore", "Leda", "Aoede", "Callirrhoe", "Autonoe", "Despina", "Erinome", "Laomedeia",
                 "Achernar", "Gacrux", "Pulcherrima", "Vindemiatrix", "Sulafat"}
FFMPEG = shutil.which("ffmpeg") is not None
PCM_ONE_SECOND = b"\x10\x00" * PCM_RATE


class Calls:
    def __init__(self, openrouter_status: int = 200, long_audio: bytes = PCM_ONE_SECOND) -> None:
        self.status, self.audio = openrouter_status, long_audio
        self.openrouter: list[dict] = []
        self.grok = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "generativelanguage.googleapis.com":
            return httpx.Response(429, json={"error": {"message": "quota"}})
        if request.url.host == "openrouter.test":
            self.openrouter.append({"auth": request.headers["authorization"], **json.loads(request.content)})
            if self.status != 200:
                return httpx.Response(self.status, json={"error": {"message": "model gone"}},
                                      headers={"x-generation-id": "gen-1"})
            return httpx.Response(200, content=self.audio)
        self.grok += 1
        return httpx.Response(200, content=sine_mp3())


def sine_mp3() -> bytes:
    return subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1",
         "-ac", "1", "-ar", "24000", "-f", "mp3", "pipe:1"], capture_output=True, check=True,
    ).stdout


def build(calls: Calls, key: str = "or-key", grok: bool = True) -> tuple[GeminiClient, CircuitBreaker, list]:
    http = httpx.AsyncClient(transport=httpx.MockTransport(calls))
    breaker, usage = CircuitBreaker(), []
    fallback = FallbackLLM(FallbackConfig(url="https://f.test/v1", token="t" if grok else ""), http, breaker)
    tts = OpenRouterTts(OpenRouterTtsConfig(key=key, url="https://openrouter.test/api/v1"), http, breaker)
    client = GeminiClient("k", "m", "gemini-tts", lambda *row: usage.append(row), fallback=fallback,
                          breaker=breaker, http=http, openrouter_tts=tts)
    return client, breaker, usage


def wav_info(wav: bytes) -> tuple[int, int]:
    with wave.open(io.BytesIO(wav), "rb") as reader:
        return reader.getframerate(), reader.getnframes()


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed (loudness normalization)")
def test_gemini_429_is_served_by_heygen_with_the_mapped_voice() -> None:
    calls = Calls()
    client, _, usage = build(calls)
    wav = asyncio.run(client.speak("Dzień dobry.", "Kore", "ignored style"))
    assert calls.openrouter == [{"auth": "Bearer or-key", "model": DEFAULT_MODEL, "input": "Dzień dobry.",
                                 "voice": "nadine", "response_format": "pcm"}]
    rate, frames = wav_info(wav)  # speak() ends in the shared loudness step, which resamples to 24 kHz
    assert rate == 24000 and frames > 24000 // 2
    assert calls.grok == 0 and client.last_tts_model == DEFAULT_MODEL
    assert usage[-1][:3] == ("tts_voice", DEFAULT_MODEL, len("Dzień dobry."))


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
@pytest.mark.parametrize("status", [404, 429])
def test_heygen_failure_falls_to_grok_and_opens_the_breaker(status: int) -> None:
    calls = Calls(openrouter_status=status)
    client, breaker, _ = build(calls)
    asyncio.run(client.speak("Pierwszy.", "Charon"))
    assert client.last_tts_model == "grok-tts" and calls.grok == 1
    key = f"openrouter/{DEFAULT_MODEL}"
    if status == 429:
        assert breaker.remaining("openrouter", DEFAULT_MODEL) > 0, key
        asyncio.run(client.speak("Drugi.", "Charon"))
        assert len(calls.openrouter) == 1  # cooling down: no second network call
        assert calls.grok == 2


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
def test_no_key_skips_heygen_and_uses_grok() -> None:
    calls = Calls()
    client, _, _ = build(calls, key="")
    asyncio.run(client.speak("Cześć.", "Kore"))
    assert calls.openrouter == [] and client.last_tts_model == "grok-tts"


def test_heygen_error_without_grok_propagates() -> None:
    client, _, _ = build(Calls(openrouter_status=404), grok=False)
    with pytest.raises(Exception, match="HTTP 404"):
        asyncio.run(client.speak("Cześć.", "Kore"))


def test_long_text_is_split_at_sentences_and_pcm_is_joined() -> None:
    sentence = "To jest zdanie testowe numer jeden. "
    text = sentence * 300
    chunks = split_text(text)
    assert len(chunks) > 1 and all(len(c) <= MAX_CHARS for c in chunks)
    assert " ".join(chunks) == text.strip()
    assert all(c.endswith(".") for c in chunks)
    calls = Calls()
    http = httpx.AsyncClient(transport=httpx.MockTransport(calls))
    tts = OpenRouterTts(OpenRouterTtsConfig(key="k", url="https://openrouter.test/api/v1"), http, CircuitBreaker())
    wav = asyncio.run(tts.speech(text, "bram"))
    assert len(calls.openrouter) == len(chunks)
    assert wav_info(wav) == (PCM_RATE, PCM_RATE * len(chunks))


def test_voice_table_covers_every_gemini_voice_with_the_same_gender() -> None:
    assert set(HEYGEN_VOICE_BY_GEMINI) == set(GROK_VOICE_BY_GEMINI)
    for voice, heygen in HEYGEN_VOICE_BY_GEMINI.items():
        expected = HEYGEN_FEMALE_VOICES if voice in GEMINI_FEMALE else HEYGEN_MALE_VOICES
        assert heygen in expected, f"{voice} -> {heygen} changes gender"
        assert heygen != "meredith"
    assert heygen_voice_for("Kore") == "nadine" and heygen_voice_for("charon") == "bram"
    assert heygen_voice_for("NoSuchVoice") == "nadine"


def test_model_and_key_come_from_env() -> None:
    config = load_openrouter_tts_config({"OPENROUTER_API_KEY": "generic"})
    assert (config.key, config.model, config.enabled) == ("generic", DEFAULT_MODEL, True)
    config = load_openrouter_tts_config({"DOSRADIO_OPENROUTER_TTS_KEY": "own", "OPENROUTER_API_KEY": "generic",
                                         "DOSRADIO_OPENROUTER_TTS_MODEL": "heygen/heygen-voice-1-turbo",
                                         "DOSRADIO_OPENROUTER_TTS_URL": "https://x.test/v1/"})
    assert (config.key, config.model, config.url) == ("own", "heygen/heygen-voice-1-turbo", "https://x.test/v1")
    assert not load_openrouter_tts_config({}).enabled
