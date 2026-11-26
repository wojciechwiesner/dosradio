"""Gemini client with a provider chain: Gemini direct first, llm.borg.tools fallback second.

- Text (`generate_text`, `chat`): Gemini news model -> fallback models in order.
- News (`news`): Gemini with Google Search grounding -> sourced RSS rewrite (never invented).
- Speech (`speak`): Gemini TTS -> HeyGen Voice Turbo (OpenRouter) -> Grok TTS, each with a fixed
  voice table, returned as WAV.

A 429 or 401 opens the shared circuit breaker, so a dead key is skipped without a
network call until its cooldown ends. Every served call logs the provider and model.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re
from datetime import date
from typing import Awaitable, Callable

import httpx

from .llm_breaker import CircuitBreaker, ProviderCoolingDown, ProviderError, cooldown_for, gemini_retry_delay, parse_retry_after
from .llm_fallback import FallbackLLM, UsageHook, load_fallback_config
from .news import Story, build_news_prompt, normalize_loudness, parse_stories, pcm_to_wav
from .news_fallback import SourcedNews
from .tts_fallback import grok_voice_for, mp3_to_wav, wav_seconds
from .tts_openrouter import OpenRouterTts, heygen_voice_for, load_openrouter_tts_config
from .tts_openrouter import PROVIDER as OPENROUTER_PROVIDER

log = logging.getLogger("dosradio.gemini")

API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
PROVIDER = "gemini"
DEFAULT_PCM_RATE = 24000

NewsFallback = Callable[[str], Awaitable[list[Story]]]


def _reply_text(data: dict) -> str:
    parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    return "".join(part.get("text", "") for part in parts)


def _skips_retry(error: Exception) -> bool:
    """A cooling-down or quota/auth failure will not heal on an immediate retry."""
    return isinstance(error, ProviderCoolingDown) or (
        isinstance(error, ProviderError) and cooldown_for(error) is not None
    )


class GeminiClient:
    def __init__(self, api_key: str, news_model: str, tts_model: str, on_usage: UsageHook | None = None,
                 fallback: FallbackLLM | None = None, breaker: CircuitBreaker | None = None,
                 news_fallback: NewsFallback | None = None, http: httpx.AsyncClient | None = None,
                 openrouter_tts: OpenRouterTts | None = None) -> None:
        self.api_key = api_key
        self.news_model = news_model
        self.tts_model = tts_model
        self.on_usage = on_usage
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0))
        self.breaker = breaker or CircuitBreaker()
        self.fallback = fallback
        self.news_fallback = news_fallback
        self.openrouter_tts = openrouter_tts
        self.last_tts_model = tts_model  # model that voiced the latest clip (telemetry)

    @property
    def has_fallback(self) -> bool:
        return self.fallback is not None and self.fallback.enabled

    async def _call(self, model: str, body: dict, feature: str = "gemini") -> dict:
        """One Gemini generateContent call; raises ProviderError / ProviderCoolingDown."""
        self.breaker.guard(PROVIDER, model)
        response = await self.http.post(
            f"{API_BASE}/{model}:generateContent",
            headers={"x-goog-api-key": self.api_key, "content-type": "application/json"},
            json=body,
        )
        try:
            data = response.json()
        except ValueError:
            data = {"error": {"message": response.text[:200] or "non-JSON reply"}}
        if response.status_code != 200 or "error" in data:
            message = (data.get("error") or {}).get("message", "unknown error")
            retry = gemini_retry_delay(data)
            if retry is None:
                retry = parse_retry_after(response.headers.get("retry-after"))
            error = ProviderError(PROVIDER, model, response.status_code, message, retry)
            self.breaker.record(error)
            raise error
        self.breaker.success(PROVIDER, model)
        if self.on_usage is not None:
            try:
                meta = data.get("usageMetadata") or {}
                self.on_usage(feature, model, int(meta.get("promptTokenCount") or 0),
                              int(meta.get("candidatesTokenCount") or 0), 0.0)
            except Exception:
                pass
        return data

    async def generate_text(self, prompt: str, feature: str = "chat") -> str:
        """Plain text generation through the chain (no search grounding)."""
        try:
            text = _reply_text(await self._call(self.news_model, {"contents": [{"parts": [{"text": prompt}]}]}, feature))
            if not text.strip():
                raise RuntimeError(f"{self.news_model} returned empty text")
            log.info("llm %s served by %s/%s", feature, PROVIDER, self.news_model)
            return text
        except Exception as error:
            if not self.has_fallback:
                raise
            log.warning("llm %s: gemini failed (%s), trying fallback", feature, error)
        text, model = await self.fallback.complete(prompt, feature)
        log.info("llm %s served by fallback/%s", feature, model)
        return text

    async def chat(self, prompt: str) -> str:
        return await self.generate_text(prompt, "chat_podcast")

    async def news(self, category: str, attempts: int = 2) -> list[Story]:
        """Grounded Gemini first (one retry for flaky JSON); then real-source fallback."""
        last_error: Exception | None = None
        for _ in range(attempts):
            try:
                data = await self._call(self.news_model, {
                    "contents": [{"parts": [{"text": build_news_prompt(category, date.today())}]}],
                    "tools": [{"google_search": {}}],
                }, feature=f"news:{category}")
                stories = parse_stories(_reply_text(data), category)
                log.info("news %s served by %s/%s", category, PROVIDER, self.news_model)
                return stories
            except Exception as error:
                last_error = error
                log.warning("news %s attempt failed: %s: %s", category, type(error).__name__, error)
                if _skips_retry(error):
                    break
        if self.news_fallback is not None and self.has_fallback:
            return await self.news_fallback(category)
        raise RuntimeError(f"{type(last_error).__name__}: {last_error}") from last_error

    async def _gemini_speak(self, text: str, voice: str) -> bytes:
        data = await self._call(self.tts_model, {
            "contents": [{"parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
            },
        }, feature="tts_voice")
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        inline = next((part["inlineData"] for part in parts if "inlineData" in part), None)
        if not inline:
            raise RuntimeError(f"{self.tts_model} returned no audio")
        audio = base64.b64decode(inline["data"])
        if "wav" not in inline.get("mimeType", ""):
            rate_match = re.search(r"rate=(\d+)", inline.get("mimeType", ""))
            audio = pcm_to_wav(audio, int(rate_match.group(1)) if rate_match else DEFAULT_PCM_RATE)
        return audio

    @property
    def has_openrouter_tts(self) -> bool:
        return self.openrouter_tts is not None and self.openrouter_tts.enabled

    async def _openrouter_speak(self, text: str, voice: str) -> bytes:
        heygen_voice = heygen_voice_for(voice)
        wav = await self.openrouter_tts.speech(text, heygen_voice)
        model = self.openrouter_tts.config.model
        if self.on_usage is not None:
            try:
                self.on_usage("tts_voice", model, len(text), 0, wav_seconds(wav))
            except Exception:
                pass
        log.info("tts served by %s/%s voice %s (host voice %s)", OPENROUTER_PROVIDER, model, heygen_voice, voice)
        self.last_tts_model = model
        return wav

    async def _fallback_speak(self, text: str, voice: str) -> bytes:
        grok_voice = grok_voice_for(voice)
        mp3 = await self.fallback.speech(text, grok_voice)
        wav = await asyncio.to_thread(mp3_to_wav, mp3)
        model = self.fallback.config.tts_model
        self.fallback.report_usage("tts_voice", model, len(text.split()), 0, wav_seconds(wav))
        log.info("tts served by fallback/%s voice %s (host voice %s)", model, grok_voice, voice)
        self.last_tts_model = model
        return wav

    async def _speak_after_gemini(self, text: str, voice: str) -> bytes:
        """HeyGen via OpenRouter first, Grok last; the last failure propagates."""
        if self.has_openrouter_tts:
            try:
                return await self._openrouter_speak(text, voice)
            except Exception as error:
                if not self.has_fallback:
                    raise
                log.warning("tts: openrouter failed (%s), trying grok", error)
        return await self._fallback_speak(text, voice)

    async def speak(self, text: str, voice: str, style: str = "") -> bytes:
        """WAV for `text`. Pure text in contents: Gemini TTS reads everything verbatim.

        `style` is accepted for callers but never sent, so it can never be read aloud;
        Grok has no style control either, so the fallback drops it the same way.
        """
        try:
            audio = await self._gemini_speak(text, voice)
            self.last_tts_model = self.tts_model
            log.info("tts served by %s/%s voice %s", PROVIDER, self.tts_model, voice)
        except Exception as error:
            if not self.has_fallback and not self.has_openrouter_tts:
                raise
            log.warning("tts: gemini failed (%s), trying fallback", error)
            audio = await self._speak_after_gemini(text, voice)
        return await asyncio.to_thread(normalize_loudness, audio)


def build_gemini_client(api_key: str, news_model: str, tts_model: str,
                        on_usage: UsageHook | None = None) -> GeminiClient:
    """Production wiring: one HTTP pool and one breaker shared by Gemini and the fallback."""
    http = httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0))
    breaker = CircuitBreaker()
    config = load_fallback_config()
    fallback = FallbackLLM(config, http, breaker, on_usage)
    tts_config = load_openrouter_tts_config()
    client = GeminiClient(api_key, news_model, tts_model, on_usage, fallback=fallback, breaker=breaker, http=http,
                          openrouter_tts=OpenRouterTts(tts_config, http, breaker))
    client.news_fallback = SourcedNews(client.generate_text, http)
    log.info("llm chain: gemini/%s -> %s", news_model,
             ", ".join(f"fallback/{model}" for model in config.models) if config.enabled else "no fallback (token unset)")
    tts_chain = [f"gemini/{tts_model}"]
    if tts_config.enabled:
        tts_chain.append(f"{OPENROUTER_PROVIDER}/{tts_config.model}")
    if config.enabled:
        tts_chain.append(f"fallback/{config.tts_model}")
    log.info("tts chain: %s", " -> ".join(tts_chain))
    return client
