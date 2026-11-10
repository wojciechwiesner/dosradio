"""Calendar and AP-queue items rendered as RSS for the personal digest.

Pure functions only: no network, no mail access. The publisher script
(`scripts/publish_feeds.py`) feeds them text and writes the XML. The radio
reads the result through the existing `personal_news.fetch_feed` path.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from xml.sax.saxutils import escape

# Google's "Daily Agenda" mail: "11:00 – 13:30<TAB>Title<TAB>Calendar name".
_EVENT_RE = re.compile(r"^(\d{1,2}:\d{2})\s*[\u2013-]\s*(\d{1,2}:\d{2})\t", re.MULTILINE)
_FOOTER_MARK = "View your calendar"
_SPACE_RE = re.compile(r"\s+")

TOPIC_TITLES = {"calendar": "Kalendarz", "ap": "AP Operations"}


@dataclass(frozen=True)
class AgendaItem:
    title: str
    start: str = ""
    end: str = ""

    @property
    def headline(self) -> str:
        if not self.start:
            return self.title
        return f"{self.start}\u2013{self.end} {self.title}"


def parse_agenda(text: str, day: date) -> list[AgendaItem]:
    """Events from one Google Daily Agenda mail body. `day` is the mail's date."""
    body = text.split(_FOOTER_MARK, 1)[0]
    matches = list(_EVENT_RE.finditer(body))
    items: list[AgendaItem] = []
    for index, match in enumerate(matches):
        end_of_chunk = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        chunk = body[match.end():end_of_chunk]
        # The last tab separates the title from the calendar name; titles wrap across lines.
        title_part = chunk.rsplit("\t", 1)[0] if "\t" in chunk else chunk
        title = _SPACE_RE.sub(" ", title_part).strip()
        if title:
            items.append(AgendaItem(title=title, start=match.group(1), end=match.group(2)))
    return items


def ap_items(ops: dict) -> list[AgendaItem]:
    """Operational signals from ap_improve /api/ops. Stale data produces nothing."""
    if (ops.get("freshness") or {}).get("stale"):
        return []
    items: list[AgendaItem] = []
    queue = ops.get("queue") or {}
    counts = queue.get("counts") or {}
    total = queue.get("total")
    if counts.get("breached"):
        suffix = f" z {total} w kolejce" if total else ""
        items.append(AgendaItem(f"Zg\u0142oszenia po terminie w AP: {counts['breached']}{suffix}"))
    if counts.get("at_risk"):
        items.append(AgendaItem(f"Zg\u0142oszenia zagro\u017cone przekroczeniem terminu: {counts['at_risk']}"))
    calls = ops.get("calls") or {}
    missed = calls.get("missed_inbound")
    if missed:
        period = f" w ostatnich {calls['days']} dniach" if calls.get("days") else ""
        items.append(AgendaItem(f"Nieodebrane po\u0142\u0105czenia przychodz\u0105ce{period}: {missed}"))
    return items


def build_rss(topic: str, items: list[AgendaItem], day: date, self_url: str) -> str:
    """RSS 2.0 document. Links carry the day, so the same title on two days stays two stories."""
    channel_title = f"{TOPIC_TITLES.get(topic, topic)} {day.isoformat()}"
    entries = []
    for index, item in enumerate(items):
        link = f"{self_url}#{day.isoformat()}-{index}"
        entries.append(
            "<item>"
            f"<title>{escape(item.headline)}</title>"
            f"<link>{escape(link)}</link>"
            f"<guid isPermaLink=\"false\">{escape(link)}</guid>"
            f"<description>{escape(item.headline)}</description>"
            "</item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0"><channel>'
        f"<title>{escape(channel_title)}</title>"
        f"<link>{escape(self_url)}</link>"
        f"<description>{escape(channel_title)}</description>"
        + "".join(entries)
        + "</channel></rss>"
    )
