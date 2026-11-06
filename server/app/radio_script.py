"""Polish lines the station host speaks (intros, teasers, outros, weather) and text rules for LLM output."""
from __future__ import annotations

import re

INTRO_PHRASES = {"flash": "Krótko, co słychać.", "main": "Temat na teraz."}
HOURLY_INTRO = "Jest {time}. Pełne wiadomości DOS Radio."
TEASER_PHRASES = (
    "Za chwilę: {headline}. Zostań z nami.",
    "Zaraz usłyszysz: {headline}. Nie przełączaj.",
    "Za moment: {headline}. Zostań z nami.",
)
OUTRO_PHRASES = (
    "Gramy dalej.",
    "Gramy dalej. Zostań z nami.",
    "Gramy dalej, wracamy do muzyki.",
    "Gramy dalej. Muzyka wraca.",
)
WEATHER_PHRASE = "Pogoda, {city}. Teraz {now}, {summary}. Wieczorem do {low}."
PLURAL_DIGITS = (2, 3, 4)
PLURAL_TEENS = range(12, 15)
SENTENCE_END = (".", "!", "?", "…")
EMOJI_PATTERN = re.compile(r"[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]")


def intro_script(kind: str | None, time_text: str, host_line: str) -> str:
    if kind is None:
        return f"{time_text.capitalize()}. {host_line}"
    if kind == "hourly":
        return HOURLY_INTRO.format(time=time_text)
    return f"{time_text.capitalize()}. {INTRO_PHRASES[kind]}"


def teaser_script(headline: str, story_id: str) -> str:
    phrase = TEASER_PHRASES[int(story_id, 16) % len(TEASER_PHRASES)]
    return phrase.format(headline=headline.rstrip(" .!?…"))


def outro_script(variant: int) -> str:
    return OUTRO_PHRASES[variant]


def degrees_pl(value: float) -> str:
    rounded = round(value)
    if rounded == 0:
        return "zero stopni"
    amount = abs(rounded)
    prefix = "minus " if rounded < 0 else ""
    if amount == 1:
        unit = "stopień"
    elif amount % 10 in PLURAL_DIGITS and amount % 100 not in PLURAL_TEENS:
        unit = "stopnie"
    else:
        unit = "stopni"
    return f"{prefix}{amount} {unit}"


def weather_script(city: str, now_c: int, low_c: int, summary: str) -> str:
    return WEATHER_PHRASE.format(city=city, now=degrees_pl(now_c), summary=summary, low=degrees_pl(low_c))


def sentence(text: str) -> str:
    stripped = text.strip()
    return stripped if stripped.endswith(SENTENCE_END) else f"{stripped}."


def strip_emoji(text: str) -> str:
    return " ".join(EMOJI_PATTERN.sub("", text).split())


def word_count(text: str) -> int:
    return len(text.split())
