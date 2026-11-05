"""Personalized news digest for Plus subscribers: own RSS feeds and keywords.

Per-user stories are fetched with a hard 5 s timeout per feed and one try/except
per feed, so a dead RSS source can never break the hourly global news cycle.
When preferences are empty or every feed fails, the digest falls back to the
current global edition.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
import xml.etree.ElementTree as ET

import httpx

from .db import Database
from .news import NewsService, Story

log = logging.getLogger("dosradio.personal")

RSS_TIMEOUT_S = 5.0
MAX_DIGEST_STORIES = 12
MAX_KEYWORDS = 20
MAX_RSS_FEEDS = 10
PERSONAL_REFRESH_S = 3600
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


class PreferenceError(ValueError):
    """Invalid news preferences (message is shown to the user in Polish)."""


def validate_preferences(keywords: list[str], rss_feeds: list[str]) -> tuple[list[str], list[str]]:
    """Clean and enforce limits; raise PreferenceError with a Polish message."""
    clean_keywords: list[str] = []
    seen_keywords: set[str] = set()
    for raw in keywords:
        keyword = raw.strip()
        if not keyword or keyword.lower() in seen_keywords:
            continue
        if len(keyword) > 60:
            raise PreferenceError("Każde słowo kluczowe może mieć maksymalnie 60 znaków.")
        seen_keywords.add(keyword.lower())
        clean_keywords.append(keyword)
    if len(clean_keywords) > MAX_KEYWORDS:
        raise PreferenceError(f"Maksymalnie {MAX_KEYWORDS} słów kluczowych.")

    clean_feeds: list[str] = []
    for raw in rss_feeds:
        feed = raw.strip()
        if not feed or feed in clean_feeds:
            continue
        if not re.match(r"^https?://", feed, re.IGNORECASE):
            raise PreferenceError("Kanały RSS muszą zaczynać się od http:// albo https://.")
        if len(feed) > 500:
            raise PreferenceError("Adres kanału RSS jest zbyt długi.")
        clean_feeds.append(feed)
    if len(clean_feeds) > MAX_RSS_FEEDS:
        raise PreferenceError(f"Maksymalnie {MAX_RSS_FEEDS} kanałów RSS.")

    return clean_keywords, clean_feeds


def _strip_html(text: str) -> str:
    return _SPACE_RE.sub(" ", _TAG_RE.sub(" ", text)).strip()


def parse_rss(xml_text: str, feed_url: str) -> list[Story]:
    """Parse RSS 2.0 (<item>) and Atom (<entry>) into Story objects."""
    root = ET.fromstring(xml_text)
    nodes = root.findall(".//item") or root.findall(".//{http://www.w3.org/2005/Atom}entry")
    stories: list[Story] = []
    for node in nodes:
        title = _strip_html(node.findtext("title") or "")
        link_node = node.find("link")
        link = node.findtext("link") or ""
        if not link and link_node is not None:
            link = link_node.get("href") or ""  # Atom: <link href="..."/>
        summary = _strip_html(
            node.findtext("description")
            or node.findtext("{http://www.w3.org/2005/Atom}summary")
            or node.findtext("{http://www.w3.org/2005/Atom}content")
            or ""
        )
        link, title = link.strip(), title.strip()
        if not title or not re.match(r"^https?://", link):
            continue  # autocheck spot: a digest entry needs a title and a real link
        story_id = hashlib.sha1(f"personal|{link}|{title}".encode()).hexdigest()[:12]
        stories.append(Story(story_id, title, summary[:600], link, True, "personal"))
    return stories


def matches_keywords(story: Story, keywords: list[str]) -> bool:
    """Empty keyword list keeps everything; otherwise any keyword must hit title or text."""
    if not keywords:
        return True
    haystack = f"{story.title} {story.radio_text}".lower()
    return any(keyword.lower() in haystack for keyword in keywords)


async def fetch_feed(url: str) -> list[Story]:
    """One feed, 5 s budget. Raises on transport/HTTP/parse errors; callers isolate."""
    async with httpx.AsyncClient(timeout=RSS_TIMEOUT_S, follow_redirects=True) as http:
        response = await http.get(url)
        response.raise_for_status()
        return parse_rss(response.text, url)


async def collect_personal_stories(keywords: list[str], rss_feeds: list[str]) -> list[Story]:
    """Fetch all feeds concurrently; a dead feed is skipped, never fatal."""
    results = await asyncio.gather(*(fetch_feed(url) for url in rss_feeds), return_exceptions=True)
    stories: list[Story] = []
    seen: set[str] = set()
    for result in results:
        if isinstance(result, Exception):
            log.warning("rss feed failed (%s): %s", type(result).__name__, result)
            continue
        for story in result:
            if story.id not in seen:
                seen.add(story.id)
                stories.append(story)
    if keywords:
        stories = [story for story in stories if matches_keywords(story, keywords)]
    return stories[:MAX_DIGEST_STORIES]


class PersonalNews:
    """Per-user digest cache refreshed from news.hourly_loop via the on_personal_refresh hook."""

    def __init__(self, db: Database, news: NewsService) -> None:
        self.db = db
        self.news = news
        self.cache: dict[int, tuple[float, tuple[bool, list[Story]]]] = {}

    async def refresh_all(self) -> None:
        """Hourly pass over every stored preference row; per-user failures are isolated."""
        for user_id, prefs in self.db.all_news_preferences():
            try:
                await self.digest(user_id, prefs, force=True)
            except Exception as error:  # never break the global cycle
                log.warning("personal digest user %s failed: %s", user_id, error)

    async def digest(self, user_id: int, prefs: dict, force: bool = False) -> tuple[bool, list[Story]]:
        """(personal, stories); falls back to the global queue when feeds yield nothing."""
        cached = self.cache.get(user_id)
        if not force and cached and time.time() - cached[0] < PERSONAL_REFRESH_S:
            return cached[1]
        has_sources = bool(prefs.get("keywords")) or bool(prefs.get("rss_feeds"))
        stories = await collect_personal_stories(prefs.get("keywords", []), prefs.get("rss_feeds", [])) if has_sources else []
        if stories:
            result = (True, stories)
            self.news.remember(stories)
        else:
            result = (False, self.news.global_queue())
        self.cache[user_id] = (time.time(), result)
        return result
