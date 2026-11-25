"""OpenAI-compatible fallback provider (llm.borg.tools) for text and speech.

Used only when Gemini direct fails. Models are tried in the configured order; each
model has its own breaker entry, so one exhausted model does not block the others.
Configuration comes from the environment only:

    DOSRADIO_LLM_FALLBACK_URL     default https://llm.borg.tools/v1
    DOSRADIO_LLM_FALLBACK_TOKEN   bearer token; empty disables the fallback
    DOSRADIO_LLM_FALLBACK_MODELS  comma-separated text models, in order
    DOSRADIO_TTS_FALLBACK_MODEL   speech model, default grok-tts
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Callable, Mapping

import httpx

from .llm_breaker import CircuitBreaker, ProviderCoolingDown, ProviderError, parse_retry_after

log = logging.getLogger("dosradio.llm_fallback")

PROVIDER = "borg"
DEFAULT_URL = "https://llm.borg.tools/v1"
DEFAULT_MODELS = ("grok-4.20-0309-non-reasoning", "gemini-3.1-flash-lite", "grok-4.3")
DEFAULT_TTS_MODEL = "grok-tts"
ERROR_SNIPPET_CHARS = 200

UsageHook = Callable[[str, str, int, int, float], None]


@dataclass(frozen=True)
class FallbackConfig:
    url: str = DEFAULT_URL
    token: str = ""
    models: tuple[str, ...] = DEFAULT_MODELS
    tts_model: str = DEFAULT_TTS_MODEL

    @property
    def enabled(self) -> bool:
        return bool(self.token)


def load_fallback_config(env: Mapping[str, str] = os.environ) -> FallbackConfig:
    raw_models = env.get("DOSRADIO_LLM_FALLBACK_MODELS", "").strip()
    models = tuple(m.strip() for m in raw_models.split(",") if m.strip()) or DEFAULT_MODELS
    return FallbackConfig(
        url=(env.get("DOSRADIO_LLM_FALLBACK_URL", "").strip() or DEFAULT_URL).rstrip("/"),
        token=env.get("DOSRADIO_LLM_FALLBACK_TOKEN", "").strip(),
        models=models,
        tts_model=env.get("DOSRADIO_TTS_FALLBACK_MODEL", "").strip() or DEFAULT_TTS_MODEL,
    )


def _error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:ERROR_SNIPPET_CHARS] or "unknown error"
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return str(error.get("message") or "unknown error")[:ERROR_SNIPPET_CHARS]
    return str(error or payload)[:ERROR_SNIPPET_CHARS]


class FallbackLLM:
    """Text and speech through one OpenAI-compatible endpoint, guarded by the shared breaker."""

    def __init__(self, config: FallbackConfig, http: httpx.AsyncClient, breaker: CircuitBreaker,
                 on_usage: UsageHook | None = None) -> None:
        self.config = config
        self.http = http
        self.breaker = breaker
        self.on_usage = on_usage

    @property
    def enabled(self) -> bool:
        return self.config.enabled

    async def _post(self, path: str, model: str, body: dict) -> httpx.Response:
        self.breaker.guard(PROVIDER, model)
        response = await self.http.post(
            f"{self.config.url}{path}",
            headers={"authorization": f"Bearer {self.config.token}"},
            json=body,
        )
        if response.status_code != 200:
            error = ProviderError(PROVIDER, model, response.status_code, _error_message(response),
                                  parse_retry_after(response.headers.get("retry-after")))
            self.breaker.record(error)
            raise error
        self.breaker.success(PROVIDER, model)
        return response

    def report_usage(self, feature: str, model: str, inp: int, out: int, seconds: float) -> None:
        if self.on_usage is None:
            return
        try:
            self.on_usage(feature, model, inp, out, seconds)
        except Exception as error:  # telemetry must never break generation
            log.debug("usage hook failed: %s", error)

    async def complete(self, prompt: str, feature: str) -> tuple[str, str]:
        """(text, model) from the first fallback model that answers; raises when all fail."""
        if not self.enabled:
            raise RuntimeError("LLM fallback disabled (DOSRADIO_LLM_FALLBACK_TOKEN not set)")
        errors: list[str] = []
        for model in self.config.models:
            try:
                response = await self._post("/chat/completions", model, {
                    "model": model, "messages": [{"role": "user", "content": prompt}],
                })
                data: dict[str, Any] = response.json()
                text = str(data["choices"][0]["message"]["content"] or "")
                if not text.strip():
                    raise RuntimeError(f"{model} returned empty text")
            except (ProviderError, ProviderCoolingDown, httpx.HTTPError, RuntimeError,
                    KeyError, IndexError, TypeError, ValueError) as error:
                errors.append(f"{model}: {error}")
                log.warning("fallback %s failed on %s: %s", feature, model, error)
                continue
            usage = data.get("usage") or {}
            self.report_usage(feature, str(data.get("model") or model),
                         int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0), 0.0)
            return text, model
        raise RuntimeError("all fallback models failed: " + "; ".join(errors))

    async def speech(self, text: str, voice: str) -> bytes:
        """MP3 bytes from the fallback speech model."""
        if not self.enabled:
            raise RuntimeError("TTS fallback disabled (DOSRADIO_LLM_FALLBACK_TOKEN not set)")
        model = self.config.tts_model
        response = await self._post("/audio/speech", model, {"model": model, "input": text, "voice": voice})
        if not response.content:
            raise RuntimeError(f"{model} returned no audio")
        return response.content
