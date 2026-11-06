"""News per category: Gemini with Google Search grounding, validated, cached; TTS rendered once and shared by all listeners."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import re
import time
import wave
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from .hosts import NEWSROOM_VOICES
from .radio_script import sentence, strip_emoji, word_count

log = logging.getLogger("dosradio.news")
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
NEWS_ITEM_COUNT = 6
NEWS_WINDOW_HOURS = 48
HEADLINE_MAX_WORDS = 18
RADIO_MIN_WORDS = 45
RADIO_MAX_WORDS = 70
MIN_RADIO_CHARS = 80

CATEGORIES: dict[str, dict[str, str]] = {
    "ai": {
        "label": "AI",
        "brief": "najważniejsze wiadomości ze świata sztucznej inteligencji (premiery modeli, narzędzia, laby: Anthropic, OpenAI, Google, Meta, Mistral, open source)",
        "angle": "co się stało, dlaczego to ważne i co to zmienia dla zwykłego użytkownika albo twórcy",
    },
    "beauty": {
        "label": "Beauty i moda",
        "brief": "najciekawsze wiadomości z branży beauty, kosmetyki, pielęgnacji i mody (trendy, premiery, pokazy, marki, także z Polski)",
        "angle": "co się stało, dlaczego to ciekawe i co z tego wynika dla słuchaczki albo słuchacza",
    },
    "sport": {
        "label": "Sport",
        "brief": "najważniejsze wiadomości sportowe z Polski i ze świata (piłka nożna, siatkówka, tenis, skoki, F1, wyniki i transfery)",
        "angle": "wynik albo fakt, kontekst i co dalej",
    },
    "stoic": {
        "label": "Stoicka myśl",
        "brief": "jedną krótką myśl stoików na dziś: cytat Marka Aureliusza, Seneki albo Epikteta z dokładnym źródłem (dzieło, księga, list), osadzony w codziennym życiu",
        "angle": "cytat, jego sens prostymi słowami i jedna rzecz, którą można dziś z nim zrobić",
    },
    "funny": {
        "label": "Głupie",
        "brief": "zabawne, dziwne i absurdalne, ale PRAWDZIWE wiadomości ze świata (niezwykłe zdarzenia, zwierzęta, rekordy, dziwne pomysły ludzi)",
        "angle": "co się stało i dlaczego to śmieszne, lekkim, żartobliwym tonem",
    },
}


@dataclass
class Story:
    id: str
    title: str
    radio_text: str
    source_url: str
    confirmed: bool
    category: str
    audio_ready: bool = False
    headline: str = ""


def story_headline(story: Story) -> str:
    return story.headline or story.title


@dataclass
class CategoryCache:
    stories: list[Story] = field(default_factory=list)
    fetched_at: float = 0.0
    error: str | None = None


def build_news_prompt(category: str, today: date) -> str:
    spec = CATEGORIES[category]
    return "\n".join([
        f"Dzisiaj jest {today.isoformat()}.",
        f"Znajdź {NEWS_ITEM_COUNT} aktualnych wiadomości z ostatnich {NEWS_WINDOW_HOURS} godzin: {spec['brief']}.",
        "Kolejność: najciekawsze najpierw. Każda historia musi mieć link do PIERWOTNEGO źródła.",
        f"Dla każdej podaj headline: jedno zdanie po polsku, najwyżej {HEADLINE_MAX_WORDS} słów, z konkretem.",
        f"Dla każdej podaj radio_text po polsku do przeczytania w radiu: {RADIO_MIN_WORDS}-{RADIO_MAX_WORDS} słów, konkretnie, bez wypełniaczy: {spec['angle']}.",
        "Bez markdown, bez list. NO EMOJI. Nie wymyślaj faktów. Plotki oznacz confirmed=false i powiedz w tekście, że to niepotwierdzone.",
        'Zwróć WYŁĄCZNIE JSON: [{"title":"...","headline":"...","radio_text":"...","source_url":"https://...","confirmed":true}]',
    ])


def parse_stories(reply_text: str, category: str) -> list[Story]:
    """Validate model output; raise when nothing usable remains (no fake fallback)."""
    start, end = reply_text.find("["), reply_text.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("news reply has no JSON array")
    raw = json.loads(reply_text[start:end + 1])
    if not isinstance(raw, list):
        raise ValueError("news reply is not a list")
    stories: list[Story] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = strip_emoji(str(item.get("title") or ""))
        text = strip_emoji(str(item.get("radio_text") or ""))
        url = str(item.get("source_url") or "").strip()
        if not title or len(text) < MIN_RADIO_CHARS or not re.match(r"^https?://", url):
            continue  # autocheck spot: every story needs a source and real text
        headline = strip_emoji(str(item.get("headline") or ""))
        if not 0 < word_count(headline) <= HEADLINE_MAX_WORDS:
            headline = " ".join(title.split()[:HEADLINE_MAX_WORDS])
        story_id = hashlib.sha1(f"{category}|{title}".encode()).hexdigest()[:12]
        stories.append(Story(
            story_id, title, text, url, item.get("confirmed") is not False, category, headline=headline,
        ))
    if not stories:
        raise ValueError("news reply had no valid stories")
    return stories


def story_script(story: Story) -> str:
    if story.category == "personal":
        return f"Wiadomości z twoich źródeł. {story.title}. {story.radio_text} Wracamy do muzyki."
    if story.category == "stoic":
        return f"Stoicka myśl. {story.title}. {story.radio_text} Wracamy do muzyki."
    label = CATEGORIES[story.category]["label"]
    caveat = " Uwaga, to informacja niepotwierdzona." if not story.confirmed else ""
    return f"Wiadomości, {label}. {story.title}.{caveat} {story.radio_text} A teraz muzyka."


def pcm_to_wav(pcm: bytes, rate: int = 24000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


class GeminiClient:
    def __init__(self, api_key: str, news_model: str, tts_model: str) -> None:
        self.api_key = api_key
        self.news_model = news_model
        self.tts_model = tts_model
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0))

    async def _call(self, model: str, body: dict) -> dict:
        response = await self.http.post(
            f"{API_BASE}/{model}:generateContent",
            headers={"x-goog-api-key": self.api_key, "content-type": "application/json"},
            json=body,
        )
        data = response.json()
        if response.status_code != 200 or "error" in data:
            message = data.get("error", {}).get("message", "unknown error")
            raise RuntimeError(f"{model} HTTP {response.status_code}: {message}")
        return data

    async def news(self, category: str, attempts: int = 2) -> list[Story]:
        """One retry: grounded search sometimes times out or returns prose instead of JSON."""
        last_error: Exception | None = None
        for _ in range(attempts):
            try:
                data = await self._call(self.news_model, {
                    "contents": [{"parts": [{"text": build_news_prompt(category, date.today())}]}],
                    "tools": [{"google_search": {}}],
                })
                parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                return parse_stories("".join(part.get("text", "") for part in parts), category)
            except Exception as error:
                last_error = error
                log.warning("news %s attempt failed: %s: %s", category, type(error).__name__, error)
        raise RuntimeError(f"{type(last_error).__name__}: {last_error}") from last_error

    async def chat(self, prompt: str) -> str:
        """Single-shot text generation with the news model (no search grounding)."""
        data = await self._call(self.news_model, {"contents": [{"parts": [{"text": prompt}]}]})
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        return "".join(part.get("text", "") for part in parts)

    async def speak(self, text: str, voice: str, style: str = "") -> bytes:
        """Pure text in contents — Gemini TTS reads everything in contents verbatim."""
        data = await self._call(self.tts_model, {
            "contents": [{"parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
            },
        })
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        inline = next((part["inlineData"] for part in parts if "inlineData" in part), None)
        if not inline:
            raise RuntimeError(f"{self.tts_model} returned no audio")
        audio = base64.b64decode(inline["data"])
        if "wav" in inline.get("mimeType", ""):
            return audio
        rate_match = re.search(r"rate=(\d+)", inline.get("mimeType", ""))
        return pcm_to_wav(audio, int(rate_match.group(1)) if rate_match else 24000)




STORY_AUDIO_MAX_AGE_S = 48 * 3600


class NewsService:
    """One edition per topic per hour: fetched once, voiced once, replayed for every listener.

    Editions are persisted to disk, so a restart reuses the current hour instead of paying again.
    """

    def __init__(self, client: GeminiClient, audio_dir: Path, refresh_seconds: int) -> None:
        self.client = client
        self.audio_dir = audio_dir
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.editions_dir = audio_dir.parent / "news"
        self.editions_dir.mkdir(parents=True, exist_ok=True)
        self.refresh_seconds = refresh_seconds
        self.cache: dict[str, CategoryCache] = {name: self._load_edition(name) for name in CATEGORIES}
        self.locks: dict[str, asyncio.Lock] = {name: asyncio.Lock() for name in CATEGORIES}
        self.tts_lock = asyncio.Semaphore(2)
        # Stories outside the global editions (e.g. personalized RSS digest) are looked
        # up here so /radio-api/story/{id}.wav can voice them on demand.
        self.extra: dict[str, Story] = {}
        self.on_personal_refresh: Any = None  # optional async hook set by PersonalNews

    # --- persistence -----------------------------------------------------------
    def _edition_path(self, category: str) -> Path:
        return self.editions_dir / f"{category}.json"

    def _load_edition(self, category: str) -> CategoryCache:
        path = self._edition_path(category)
        if not path.exists():
            return CategoryCache()
        try:
            raw = json.loads(path.read_text())
            stories = [Story(**item) for item in raw["stories"]]
            for story in stories:
                story.audio_ready = self.audio_path(story.id).exists()
            return CategoryCache(stories, float(raw["fetched_at"]), None)
        except Exception as error:  # corrupt file: refetch, never crash startup
            log.warning("edition %s unreadable: %s", category, error)
            return CategoryCache()

    def _save_edition(self, category: str) -> None:
        cache = self.cache[category]
        payload = {"fetched_at": cache.fetched_at, "stories": [asdict(story) for story in cache.stories]}
        tmp = self._edition_path(category).with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False))
        tmp.replace(self._edition_path(category))

    def prune_old_audio(self) -> int:
        """Drop voiced stories older than 48 h; current editions are always kept."""
        keep = {story.id for cache in self.cache.values() for story in cache.stories}
        removed = 0
        for prefix in ("story-", "headline-"):
            for path in self.audio_dir.glob(f"{prefix}*.wav"):
                if path.stem.removeprefix(prefix) in keep:
                    continue
                if time.time() - path.stat().st_mtime > STORY_AUDIO_MAX_AGE_S:
                    path.unlink(missing_ok=True)
                    removed += 1
        return removed

    async def hourly_loop(self) -> None:
        """Refresh every stale topic, one at a time, independent of listeners."""
        while True:
            for category in CATEGORIES:
                if self.is_stale(category):
                    await self.ensure(category)
            self.prune_old_audio()
            if self.on_personal_refresh is not None:
                # Personalized digests must never break the global news cycle.
                try:
                    await self.on_personal_refresh()
                except Exception as error:
                    log.warning("personal digest refresh failed: %s", error)
            await asyncio.sleep(60)

    def audio_path(self, story_id: str) -> Path:
        return self.audio_dir / f"story-{story_id}.wav"

    def is_stale(self, category: str) -> bool:
        return time.time() - self.cache[category].fetched_at > self.refresh_seconds

    async def ensure(self, category: str) -> CategoryCache:
        """Fetch when stale; concurrent callers wait for the same fetch."""
        if category not in CATEGORIES:
            raise KeyError(category)
        cache = self.cache[category]
        if cache.stories and not self.is_stale(category):
            return cache
        async with self.locks[category]:
            cache = self.cache[category]
            if cache.stories and not self.is_stale(category):
                return cache
            try:
                stories = await self.client.news(category)
                for story in stories:
                    story.audio_ready = self.audio_path(story.id).exists()
                self.cache[category] = CategoryCache(stories, time.time(), None)
                self._save_edition(category)
                await self.render_all(category)  # voice the whole edition before the next topic
            except Exception as error:  # surfaced to the client, old stories kept
                log.warning("news %s failed: %s", category, error)
                cache.error = str(error) or type(error).__name__
                cache.fetched_at = time.time() - self.refresh_seconds + 300  # retry in 5 min
            return self.cache[category]

    def headline_path(self, story_id: str) -> Path:
        return self.audio_dir / f"headline-{story_id}.wav"

    async def _voice_once(self, path: Path, text: str, category: str) -> Path:
        if path.exists():
            return path
        voice, style = NEWSROOM_VOICES.get(category, NEWSROOM_VOICES["ai"])
        async with self.tts_lock:
            if not path.exists():
                audio = await self.client.speak(text, voice, style)
                tmp = path.with_suffix(".tmp")
                tmp.write_bytes(audio)
                tmp.replace(path)
        return path

    async def render_story(self, story: Story) -> Path:
        path = await self._voice_once(self.audio_path(story.id), story_script(story), story.category)
        story.audio_ready = True
        return path

    async def render_headline(self, story: Story) -> Path:
        return await self._voice_once(self.headline_path(story.id), sentence(story_headline(story)), story.category)

    async def render_all(self, category: str) -> None:
        for story in list(self.cache[category].stories):
            try:
                await self.render_story(story)
            except Exception as error:
                log.warning("tts %s failed: %s", story.id, error)

    def find(self, story_id: str) -> Story | None:
        for cache in self.cache.values():
            for story in cache.stories:
                if story.id == story_id:
                    return story
        return self.extra.get(story_id)

    def remember(self, stories: list[Story]) -> None:
        """Register non-edition stories so find()/render_story() can serve them."""
        for story in stories:
            self.extra[story.id] = story

    def global_queue(self) -> list[Story]:
        """All stories of the current global editions, interleaved across categories."""
        pools = [list(cache.stories) for cache in self.cache.values() if cache.stories]
        ordered: list[Story] = []
        for index in range(max((len(pool) for pool in pools), default=0)):
            for pool in pools:
                if index < len(pool):
                    ordered.append(pool[index])
        return ordered

    def public(self, category: str) -> dict:
        cache = self.cache[category]
        return {
            "category": category,
            "label": CATEGORIES[category]["label"],
            "fetched_at": cache.fetched_at,
            "edition": time.strftime("%H:00", time.localtime(cache.fetched_at)) if cache.fetched_at else None,
            "error": cache.error,
            "stories": [asdict(story) for story in cache.stories],
        }
