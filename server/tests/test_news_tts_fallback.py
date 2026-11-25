"""Sourced news fallback (never invented), Grok TTS fallback (WAV out) and the voice table. No network."""
from __future__ import annotations

import asyncio
import io
import json
import shutil
import subprocess
import wave
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import httpx
import pytest

from app.auto_ramowka import DEFAULT_SPOTS
from app.gemini_client import GeminiClient
from app.hosts import HOSTS, NEWSROOM_VOICES
from app.llm_breaker import CircuitBreaker
from app.llm_fallback import FallbackConfig, FallbackLLM
from app.news_fallback import NoSourceError, SourcedNews, parse_rewrite, usable_items, parse_feed_items
from app.podcast import PODCAST_HOSTS
from app.tts_fallback import GROK_FEMALE_VOICES, GROK_MALE_VOICES, GROK_VOICE_BY_GEMINI, grok_voice_for

FEED_URL = "https://feed.test/rss"
STORY_LINK = "https://publisher.test/real-story"
SUMMARY = "Firma opublikowała nowy model językowy, który według jej danych działa szybciej i taniej niż poprzednia wersja."
GEMINI_FEMALE = {"Zephyr", "Kore", "Leda", "Aoede", "Callirrhoe", "Autonoe", "Despina", "Erinome", "Laomedeia",
                 "Achernar", "Gacrux", "Pulcherrima", "Vindemiatrix", "Sulafat"}
FFMPEG = shutil.which("ffmpeg") is not None


def rss(published: datetime, summary: str = SUMMARY) -> str:
    return (f'<?xml version="1.0"?><rss version="2.0"><channel><item><title>Nowy model AI</title>'
            f"<link>{STORY_LINK}</link><description>{summary}</description>"
            f"<pubDate>{format_datetime(published)}</pubDate></item></channel></rss>")


def feed_http(xml: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=xml)))


def rewrite_reply(source: int = 0, url: str = "https://invented.test/") -> str:
    text = ("Firma opublikowała nowy model językowy. Według jej danych działa on szybciej i taniej niż "
            "poprzednia wersja, co może obniżyć koszty dla twórców aplikacji i zwykłych użytkowników.")
    return json.dumps([{"source": source, "title": "Nowy model AI", "headline": "Nowy model AI jest szybszy",
                        "radio_text": text, "source_url": url}])


def test_news_fallback_keeps_the_feed_link_not_the_model_link() -> None:
    prompts: list[str] = []

    async def complete(prompt: str, feature: str) -> str:
        prompts.append(prompt)
        return rewrite_reply()

    fresh = datetime.now(timezone.utc) - timedelta(hours=2)
    news = SourcedNews(complete, feed_http(rss(fresh)), {"ai": (FEED_URL,)})
    stories = asyncio.run(news("ai"))
    assert [story.source_url for story in stories] == [STORY_LINK]
    assert SUMMARY in prompts[0]


def test_news_fallback_refuses_without_a_source_and_never_calls_the_model() -> None:
    calls: list[str] = []

    async def complete(prompt: str, feature: str) -> str:
        calls.append(prompt)
        return rewrite_reply()

    stale = datetime.now(timezone.utc) - timedelta(days=5)
    cases = [
        SourcedNews(complete, feed_http(rss(stale)), {"ai": (FEED_URL,)}),  # too old
        SourcedNews(complete, feed_http(rss(datetime.now(timezone.utc), summary="krótko")), {"ai": (FEED_URL,)}),
        SourcedNews(complete, feed_http(""), {}),  # no source configured
    ]
    for news in cases:
        with pytest.raises(NoSourceError):
            asyncio.run(news("ai"))
    assert calls == []


def test_rewrite_without_a_valid_citation_produces_nothing() -> None:
    items = usable_items(parse_feed_items(rss(datetime.now(timezone.utc))), "ai", datetime.now(timezone.utc))
    for bad in (rewrite_reply(source=7), rewrite_reply(source=True), json.dumps([{"title": "x", "radio_text": "y" * 200}])):
        with pytest.raises(ValueError):
            parse_rewrite(bad, "ai", items)


def test_client_news_uses_sourced_fallback_when_gemini_quota_is_gone() -> None:
    gemini_calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        gemini_calls.append(request.url.path)
        return httpx.Response(429, json={"error": {"message": "You exceeded your current quota"}})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    breaker = CircuitBreaker()
    fallback = FallbackLLM(FallbackConfig(token="t"), http, breaker)
    client = GeminiClient("k", "gemini-3.8-flash", "tts", fallback=fallback, breaker=breaker, http=http)

    async def sourced(category: str):
        return [f"sourced:{category}"]

    client.news_fallback = sourced
    assert asyncio.run(client.news("sport")) == ["sourced:sport"]
    assert len(gemini_calls) == 1  # 429 is not retried


def sine_mp3() -> bytes:
    return subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1",
         "-ac", "1", "-ar", "24000", "-f", "mp3", "pipe:1"], capture_output=True, check=True,
    ).stdout


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
def test_tts_fallback_returns_wav_with_mapped_voice_and_no_style() -> None:
    mp3, bodies = sine_mp3(), []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "generativelanguage.googleapis.com":
            return httpx.Response(429, json={"error": {"message": "quota"}})
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=mp3, headers={"content-type": "audio/mpeg"})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    breaker, usage = CircuitBreaker(), []
    fallback = FallbackLLM(FallbackConfig(url="https://f.test/v1", token="t"), http, breaker,
                           lambda *row: usage.append(row))
    client = GeminiClient("k", "m", "gemini-tts", fallback=fallback, breaker=breaker, http=http)
    wav = asyncio.run(client.speak("Dzień dobry.", "Charon", "a slow, deep narrator"))
    with wave.open(io.BytesIO(wav), "rb") as reader:
        assert (reader.getnchannels(), reader.getsampwidth(), reader.getframerate()) == (1, 2, 24000)
        assert reader.getnframes() > 20000
    assert bodies == [{"model": "grok-tts", "input": "Dzień dobry.", "voice": "rex"}]
    assert client.last_tts_model == "grok-tts" and usage[0][1] == "grok-tts"


def all_host_voices() -> set[str]:
    voices = {host.voice for host in HOSTS.values()}
    voices |= {voice for voice, _ in NEWSROOM_VOICES.values()}
    voices |= {host["voice"] for host in PODCAST_HOSTS} | {spot["voice"] for spot in DEFAULT_SPOTS}
    return voices


def test_every_host_voice_maps_to_a_grok_voice_of_the_same_gender() -> None:
    for voice in all_host_voices() | set(GROK_VOICE_BY_GEMINI):
        grok = grok_voice_for(voice)
        expected = GROK_FEMALE_VOICES if voice in GEMINI_FEMALE else GROK_MALE_VOICES
        assert voice in GROK_VOICE_BY_GEMINI, f"{voice} missing from the voice table"
        assert grok in expected, f"{voice} -> {grok} changes gender"


def test_voice_mapping_is_stable_and_podcast_hosts_stay_distinct() -> None:
    assert [grok_voice_for("Kore") for _ in range(3)] == ["ara"] * 3
    assert grok_voice_for("kore") == "ara" and grok_voice_for("eve") == "eve"
    assert grok_voice_for("NoSuchVoice") == "ara"
    assert len({grok_voice_for(host["voice"]) for host in PODCAST_HOSTS}) == len(PODCAST_HOSTS)
