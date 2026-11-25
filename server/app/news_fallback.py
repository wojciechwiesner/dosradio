"""Sourced news when Gemini search grounding is down: real RSS items, rewritten by an LLM.

Zero fake fallbacks. The model never picks a link and never sees a topic without a
source: it only rewrites numbered items we fetched, and every story keeps the link of
the item it came from. A category with no fresh, described item fails loudly.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Awaitable, Callable

import httpx

from .news import CATEGORIES, HEADLINE_MAX_WORDS, NEWS_ITEM_COUNT, NEWS_WINDOW_HOURS, Story, parse_stories

log = logging.getLogger("dosradio.news_fallback")

ATOM = "{http://www.w3.org/2005/Atom}"
FEED_TIMEOUT_S = 8.0
FEED_USER_AGENT = "Mozilla/5.0 (compatible; AmbiRadio/1.0; +https://ambiradio.com)"
MIN_SUMMARY_CHARS = 80
MAX_SUMMARY_CHARS = 900
FALLBACK_MIN_WORDS = 30
FALLBACK_MAX_WORDS = 60
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")

# Real publisher feeds per category (checked 2026-11-23: HTTP 200, items with descriptions).
NEWS_SOURCES: dict[str, tuple[str, ...]] = {
    "ai": (
        "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
        "https://techcrunch.com/category/artificial-intelligence/feed/",
        "https://antyweb.pl/feed",
    ),
    "beauty": ("https://www.elle.pl/rss", "https://www.vogue.com/feed/rss"),
    "sport": (
        "https://www.polsatsport.pl/rss/wszystkie.xml",
        "https://sportowefakty.wp.pl/rss.xml",
        "https://feeds.bbci.co.uk/sport/rss.xml",
    ),
    "stoic": ("https://dailystoic.com/feed/",),
    "funny": ("https://www.odditycentral.com/feed", "https://feeds.skynews.com/feeds/rss/strange.xml"),
}
# Stoic posts are reflections, not news: no freshness window.
WINDOW_HOURS: dict[str, int | None] = {"stoic": None}

Complete = Callable[[str, str], Awaitable[str]]


class NoSourceError(RuntimeError):
    """No real source item for a category: the edition fails instead of being invented."""


@dataclass(frozen=True)
class SourceItem:
    title: str
    summary: str
    link: str
    published: datetime | None


def _clean(text: str) -> str:
    return _SPACE_RE.sub(" ", _TAG_RE.sub(" ", html.unescape(text or ""))).strip()


def _parse_date(raw: str) -> datetime | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        moment = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        try:
            moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def parse_feed_items(xml_text: str) -> list[SourceItem]:
    """RSS 2.0 <item> and Atom <entry>; entries without a title or http(s) link are dropped."""
    root = ET.fromstring(xml_text)
    items: list[SourceItem] = []
    for node in root.findall(".//item") or root.findall(f".//{ATOM}entry"):
        link = (node.findtext("link") or "").strip()
        if not link:
            link_node = node.find(f"{ATOM}link")
            link = (link_node.get("href") or "").strip() if link_node is not None else ""
        title = _clean(node.findtext("title") or node.findtext(f"{ATOM}title") or "")
        summary = _clean(node.findtext("description") or node.findtext(f"{ATOM}summary")
                         or node.findtext(f"{ATOM}content") or "")
        published = _parse_date(node.findtext("pubDate") or node.findtext(f"{ATOM}published")
                                or node.findtext(f"{ATOM}updated") or "")
        if title and re.match(r"^https?://", link):
            items.append(SourceItem(title, summary[:MAX_SUMMARY_CHARS], link, published))
    return items


def usable_items(items: list[SourceItem], category: str, now: datetime) -> list[SourceItem]:
    """Fresh items with a real description, newest first, one per link."""
    window = WINDOW_HOURS.get(category, NEWS_WINDOW_HOURS)
    oldest = now - timedelta(hours=window) if window else None
    seen: set[str] = set()
    kept: list[SourceItem] = []
    for item in items:
        if item.link in seen or len(item.summary) < MIN_SUMMARY_CHARS:
            continue
        if oldest is not None and (item.published is None or item.published < oldest):
            continue  # autocheck spot: unknown age cannot pass a freshness window
        seen.add(item.link)
        kept.append(item)
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    return sorted(kept, key=lambda item: item.published or epoch, reverse=True)


def build_rewrite_prompt(category: str, items: list[SourceItem], today: date) -> str:
    spec = CATEGORIES[category]
    numbered = "\n".join(
        f"[{index}] TYTUŁ: {item.title}\nOPIS: {item.summary}" for index, item in enumerate(items)
    )
    return "\n".join([
        f"Dzisiaj jest {today.isoformat()}. Jesteś redaktorem polskiego radia, temat: {spec['brief']}.",
        "Poniżej są PRAWDZIWE materiały z feedów RSS. Przepisz je na wiadomości radiowe po polsku.",
        "Używaj WYŁĄCZNIE faktów z TYTUŁU i OPISU danego materiału. Nie dodawaj nazwisk, liczb, dat ani wniosków, których tam nie ma.",
        "Jeśli opis jest krótki, tekst też ma być krótki. Nie wymyślaj nowych historii.",
        f"Wybierz najwyżej {NEWS_ITEM_COUNT} najciekawszych materiałów, najciekawsze najpierw.",
        f"headline: jedno zdanie, najwyżej {HEADLINE_MAX_WORDS} słów. radio_text: {FALLBACK_MIN_WORDS}-{FALLBACK_MAX_WORDS} słów: {spec['angle']}.",
        "Bez markdown, bez list. NO EMOJI.",
        'Zwróć WYŁĄCZNIE JSON: [{"source":0,"title":"...","headline":"...","radio_text":"..."}], gdzie source to numer materiału.',
        "",
        numbered,
    ])


def parse_rewrite(reply_text: str, category: str, items: list[SourceItem]) -> list[Story]:
    """Attach each rewritten story to the link of the item it cites; uncited stories are dropped."""
    start, end = reply_text.find("["), reply_text.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("fallback news reply has no JSON array")
    raw = json.loads(reply_text[start:end + 1])
    cited: list[dict] = []
    used: set[int] = set()
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        index = entry.get("source")
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(items) or index in used:
            continue  # autocheck spot: a story must cite exactly one fetched item
        used.add(index)
        cited.append({**entry, "source_url": items[index].link, "confirmed": True})
    return parse_stories(json.dumps(cited, ensure_ascii=False), category)[:NEWS_ITEM_COUNT]


class SourcedNews:
    """Callable news fallback: fetch real items for a category, rewrite them, never invent."""

    def __init__(self, complete: Complete, http: httpx.AsyncClient | None = None,
                 sources: dict[str, tuple[str, ...]] | None = None) -> None:
        self.complete = complete
        self.http = http
        self.sources = NEWS_SOURCES if sources is None else sources

    async def _fetch(self, url: str) -> list[SourceItem]:
        if self.http is not None:
            response = await self.http.get(url, headers={"user-agent": FEED_USER_AGENT},
                                           timeout=FEED_TIMEOUT_S, follow_redirects=True)
        else:
            async with httpx.AsyncClient(timeout=FEED_TIMEOUT_S, follow_redirects=True) as http:
                response = await http.get(url, headers={"user-agent": FEED_USER_AGENT})
        response.raise_for_status()
        return parse_feed_items(response.text)

    async def source_items(self, category: str) -> list[SourceItem]:
        urls = self.sources.get(category) or ()
        if not urls:
            raise NoSourceError(f"no real news source configured for {category}")
        results = await asyncio.gather(*(self._fetch(url) for url in urls), return_exceptions=True)
        items: list[SourceItem] = []
        for url, result in zip(urls, results):
            if isinstance(result, BaseException):
                log.warning("news source %s failed: %s: %s", url, type(result).__name__, result)
                continue
            items.extend(result)
        usable = usable_items(items, category, datetime.now(timezone.utc))
        if not usable:
            raise NoSourceError(f"no fresh real source item for {category} ({len(items)} fetched)")
        return usable[:NEWS_ITEM_COUNT * 2]

    async def __call__(self, category: str) -> list[Story]:
        items = await self.source_items(category)
        reply = await self.complete(build_rewrite_prompt(category, items, date.today()), f"news_fallback:{category}")
        stories = parse_rewrite(reply, category, items)
        log.info("news %s served from %d real source items (%d stories)", category, len(items), len(stories))
        return stories
