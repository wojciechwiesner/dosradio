"""Provider chain: Gemini direct -> llm.borg.tools fallback, with a circuit breaker. No network."""
from __future__ import annotations

import asyncio
import json

import httpx

from app.gemini_client import GeminiClient
from app.llm_breaker import (
    AUTH_COOLDOWN_S, MAX_COOLDOWN_S, QUOTA_COOLDOWN_S, CircuitBreaker, ProviderError,
    cooldown_for, gemini_retry_delay, parse_retry_after,
)
from app.llm_fallback import DEFAULT_MODELS, FallbackConfig, FallbackLLM, load_fallback_config

GEMINI_HOST = "generativelanguage.googleapis.com"
FALLBACK_URL = "https://fallback.test/v1"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class FakeUpstreams:
    """Routes Gemini and fallback requests to scripted replies and records every call."""

    def __init__(self, gemini_status: int = 429, gemini_payload: dict | None = None,
                 fallback_status: dict[str, int] | None = None) -> None:
        self.gemini_status = gemini_status
        self.gemini_payload = gemini_payload
        self.fallback_status = fallback_status or {}
        self.gemini_calls: list[str] = []
        self.fallback_calls: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == GEMINI_HOST:
            self.gemini_calls.append(request.url.path)
            if self.gemini_status == 200:
                return httpx.Response(200, json=self.gemini_payload)
            return httpx.Response(self.gemini_status, json=self.gemini_payload or {
                "error": {"code": self.gemini_status, "message": "You exceeded your current quota"},
            })
        body = json.loads(request.content)
        self.fallback_calls.append(body)
        status = self.fallback_status.get(body["model"], 200)
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "usage limit reached"}})
        return httpx.Response(200, json={
            "model": body["model"],
            "choices": [{"message": {"content": f"odpowiedź z {body['model']}"}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7},
        })


def make_client(upstreams: FakeUpstreams, clock: FakeClock | None = None, token: str = "test-token",
                models: tuple[str, ...] = DEFAULT_MODELS, usage: list | None = None) -> GeminiClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(upstreams.handler))
    breaker = CircuitBreaker(clock or FakeClock())
    hook = (lambda *row: usage.append(row)) if usage is not None else None
    fallback = FallbackLLM(FallbackConfig(url=FALLBACK_URL, token=token, models=models), http, breaker, hook)
    return GeminiClient("fake-key", "gemini-3.8-flash", "gemini-3.8-flash-tts", hook,
                        fallback=fallback, breaker=breaker, http=http)


def test_chain_falls_through_on_429_and_reports_real_model() -> None:
    upstreams, usage = FakeUpstreams(gemini_status=429), []
    client = make_client(upstreams, usage=usage)
    text = asyncio.run(client.generate_text("napisz coś", feature="mood"))
    assert text == f"odpowiedź z {DEFAULT_MODELS[0]}"
    assert len(upstreams.gemini_calls) == 1
    assert usage == [("mood", DEFAULT_MODELS[0], 11, 7, 0.0)]


def test_chain_falls_through_on_401_and_blocks_every_gemini_model() -> None:
    upstreams = FakeUpstreams(gemini_status=401, gemini_payload={"error": {"message": "API key not valid"}})
    client = make_client(upstreams)
    asyncio.run(client.chat("podcast"))
    assert client.breaker.remaining("gemini", "gemini-3.8-flash-tts") > AUTH_COOLDOWN_S - 1
    asyncio.run(client.generate_text("drugi raz"))
    assert len(upstreams.gemini_calls) == 1  # the second call never reached Gemini


def test_breaker_skips_cooled_down_provider_until_cooldown_ends() -> None:
    clock, upstreams = FakeClock(), FakeUpstreams(gemini_status=429)
    client = make_client(upstreams, clock)
    for _ in range(5):
        asyncio.run(client.generate_text("x"))
    assert len(upstreams.gemini_calls) == 1
    clock.now += QUOTA_COOLDOWN_S + 1
    asyncio.run(client.generate_text("x"))
    assert len(upstreams.gemini_calls) == 2


def test_fallback_models_are_tried_in_order() -> None:
    upstreams = FakeUpstreams(gemini_status=500, fallback_status={"model-a": 429})
    client = make_client(upstreams, models=("model-a", "model-b"))
    assert asyncio.run(client.generate_text("x")) == "odpowiedź z model-b"
    assert [call["model"] for call in upstreams.fallback_calls] == ["model-a", "model-b"]
    asyncio.run(client.generate_text("x"))
    assert [call["model"] for call in upstreams.fallback_calls][2:] == ["model-b"]  # model-a cooling down


def test_server_error_does_not_open_the_breaker() -> None:
    upstreams = FakeUpstreams(gemini_status=500)
    client = make_client(upstreams)
    asyncio.run(client.generate_text("x"))
    asyncio.run(client.generate_text("x"))
    assert len(upstreams.gemini_calls) == 2


def test_without_token_the_gemini_error_surfaces_and_no_fallback_call_is_made() -> None:
    upstreams = FakeUpstreams(gemini_status=429)
    client = make_client(upstreams, token="")
    try:
        asyncio.run(client.generate_text("x"))
    except ProviderError as error:
        assert error.status == 429
    else:
        raise AssertionError("expected the Gemini error")
    assert upstreams.fallback_calls == []


def test_retry_hints_are_honoured_and_escalate() -> None:
    payload = {"error": {"details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "900s"}]}}
    assert gemini_retry_delay(payload) == 900.0
    assert parse_retry_after("120") == 120.0
    assert parse_retry_after("not a date") is None
    quota = ProviderError("gemini", "m", 429, "quota", retry_after=900.0)
    assert cooldown_for(quota) == 900.0
    assert cooldown_for(ProviderError("gemini", "m", 429, "quota")) == QUOTA_COOLDOWN_S
    assert cooldown_for(ProviderError("gemini", "m", 429, "quota", retry_after=900.0), strikes=4) == MAX_COOLDOWN_S
    assert cooldown_for(ProviderError("gemini", "m", 400, "API key not valid. Please pass a valid API key.")) == AUTH_COOLDOWN_S
    assert cooldown_for(ProviderError("gemini", "m", 503, "overloaded")) is None


def test_fallback_config_comes_from_env() -> None:
    config = load_fallback_config({
        "DOSRADIO_LLM_FALLBACK_URL": "https://x.test/v1/", "DOSRADIO_LLM_FALLBACK_TOKEN": "t",
        "DOSRADIO_LLM_FALLBACK_MODELS": " a , b ,,",
    })
    assert (config.url, config.models, config.enabled, config.tts_model) == ("https://x.test/v1", ("a", "b"), True, "grok-tts")
    default = load_fallback_config({})
    assert default.models == DEFAULT_MODELS and not default.enabled
