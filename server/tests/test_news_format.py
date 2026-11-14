"""Ramówka news format: headlines, word limits, emoji stripping, host scripts. Offline, fake TTS."""
from __future__ import annotations

import asyncio
import json
from datetime import date

from app.news import HEADLINE_MAX_WORDS, NewsService, Story, build_news_prompt, parse_stories, story_headline
from app.radio_script import degrees_pl, intro_script, outro_script, strip_emoji, teaser_script, word_count

RADIO_TEXT = (
    "Firma pokazała nowy model, który działa lokalnie na laptopie "
    "i kosztuje mniej niż dotychczasowe rozwiązania od dostawcy chmurowego."
)
ROCKET = "\U0001F680"
SPARKLES = "\u2728"


def reply(**overrides) -> str:
    item = {
        "title": "Nowy model działa na laptopie",
        "headline": "Nowy model działa lokalnie i taniej.",
        "radio_text": RADIO_TEXT,
        "source_url": "https://example.com/model",
        "confirmed": True,
    }
    item.update(overrides)
    return json.dumps([item])


def test_strip_emoji_removes_pictographs_and_collapses_spaces():
    assert strip_emoji(f"Start {ROCKET} ok {SPARKLES} done") == "Start ok done"


def test_parse_stories_keeps_headline_and_strips_emoji():
    story = parse_stories(reply(headline=f"Nowy model {ROCKET} działa lokalnie."), "ai")[0]
    assert story.headline == "Nowy model działa lokalnie."
    assert story_headline(story) == "Nowy model działa lokalnie."


def test_parse_stories_falls_back_to_title_when_headline_missing():
    title = " ".join(f"słowo{index}" for index in range(20))
    story = parse_stories(reply(title=title, headline=""), "ai")[0]
    assert story.headline == " ".join(title.split()[:HEADLINE_MAX_WORDS])
    assert word_count(story.headline) == HEADLINE_MAX_WORDS


def test_parse_stories_replaces_overlong_headline_with_title():
    long_headline = " ".join(["zdanie"] * (HEADLINE_MAX_WORDS + 1))
    story = parse_stories(reply(title="Krótki tytuł", headline=long_headline), "ai")[0]
    assert story.headline == "Krótki tytuł"


def test_story_headline_prefers_headline_over_title():
    story = Story("abc123def456", "Tytuł", RADIO_TEXT, "https://x.test", True, "ai", headline="Nagłówek.")
    assert story_headline(story) == "Nagłówek."
    assert story_headline(Story("abc123def456", "Tytuł", RADIO_TEXT, "https://x.test", True, "ai")) == "Tytuł"


def test_news_prompt_asks_for_headline_word_limits_and_no_emoji():
    prompt = build_news_prompt("ai", date(2026, 11, 7))
    assert "najwyżej 18 słów" in prompt
    assert "45-70 słów" in prompt
    assert "NO EMOJI" in prompt
    assert '"headline"' in prompt


def test_teaser_is_deterministic_and_rotates_phrasings():
    assert teaser_script("Ważne!", "000000000000") == "Za chwilę: Ważne. Zostań z nami."
    assert teaser_script("Ważne", "000000000000") == teaser_script("Ważne", "000000000000")
    phrasings = {teaser_script("Test", f"00000000000{index}") for index in range(3)}
    assert len(phrasings) == 3


def test_intro_scripts_for_each_kind():
    assert intro_script("flash", "czternasta dwadzieścia", "Host.") == "Czternasta dwadzieścia. Krótko, co słychać."
    assert intro_script("main", "czternasta", "Host.") == "Czternasta. Temat na teraz."
    assert intro_script("hourly", "czternasta", "Host.") == "Jest czternasta. Pełne wiadomości DOS Radio."
    assert intro_script(None, "czternasta", "Host.") == "Czternasta. Host."


def test_outro_variants_are_fixed_phrases():
    assert outro_script(0) == "Gramy dalej."
    assert outro_script(3) == "Gramy dalej. Muzyka wraca."


def test_degrees_use_polish_plural_forms():
    assert degrees_pl(0.4) == "zero stopni"
    assert degrees_pl(1) == "1 stopień"
    assert degrees_pl(2) == "2 stopnie"
    assert degrees_pl(5) == "5 stopni"
    assert degrees_pl(12) == "12 stopni"
    assert degrees_pl(22) == "22 stopnie"
    assert degrees_pl(-3) == "minus 3 stopnie"


class FakeSpeaker:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def speak(self, text: str, voice: str, style: str = "") -> bytes:
        self.texts.append(text)
        return b"RIFF-fake"


def test_headline_is_voiced_once_and_cached(tmp_path):
    speaker = FakeSpeaker()
    service = NewsService(speaker, tmp_path / "audio", refresh_seconds=3600)
    story = Story("abc123def456", "Tytuł", RADIO_TEXT, "https://x.test", True, "ai", headline="Nagłówek")

    first = asyncio.run(service.render_headline(story))
    second = asyncio.run(service.render_headline(story))

    assert first == second
    assert first.read_bytes() == b"RIFF-fake"
    assert speaker.texts == ["Nagłówek."]
