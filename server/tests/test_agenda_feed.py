"""Calendar / AP feeds for the personal digest: parsing and RSS shape."""
from __future__ import annotations

from datetime import date

from app.agenda_feed import ap_items, build_rss, parse_agenda
from app.personal_news import parse_rss

TODAY = date(2026, 11, 10)
URL = "https://dosradio.theones.io/feeds/token/calendar.xml"

AGENDA = (
    "Wojciech Wiesner, here is your schedule for Tue 2026-11-10\n\n"
    "11:00 \u2013 13:30\tOff\tWojtek Wiesner priv\n"
    "13:00 \u2013 14:00\t II etap rekrutacji na stanowisko Platform Backend Engineer /  \n"
    "Wojciech Wiesner\tWojtek Wiesner priv\n\n\n"
    "View your calendar at https://calendar.google.com/calendar/\n\n"
    "You are receiving this email at the account x because you\n"
)


def test_parse_agenda_reads_times_and_titles() -> None:
    items = parse_agenda(AGENDA, TODAY)
    assert [(i.start, i.end) for i in items] == [("11:00", "13:30"), ("13:00", "14:00")]
    assert items[0].title == "Off"


def test_parse_agenda_joins_soft_wrapped_titles() -> None:
    items = parse_agenda(AGENDA, TODAY)
    assert items[1].title == "II etap rekrutacji na stanowisko Platform Backend Engineer / Wojciech Wiesner"


def test_parse_agenda_ignores_footer_and_calendar_name() -> None:
    joined = " ".join(i.title for i in parse_agenda(AGENDA, TODAY))
    assert "receiving" not in joined and "priv" not in joined


def test_parse_agenda_empty_day() -> None:
    assert parse_agenda("You have no events scheduled today.\n", TODAY) == []


def test_rss_roundtrips_through_the_radio_parser() -> None:
    xml = build_rss("calendar", parse_agenda(AGENDA, TODAY), TODAY, URL)
    stories = parse_rss(xml, "x")
    assert len(stories) == 2
    assert stories[0].title.startswith("11:00") and "Off" in stories[0].title


def test_same_title_on_two_days_is_two_stories() -> None:
    tomorrow = date(2026, 11, 11)
    a = parse_rss(build_rss("calendar", parse_agenda(AGENDA, TODAY), TODAY, URL), "x")
    b = parse_rss(build_rss("calendar", parse_agenda(AGENDA, tomorrow), tomorrow, URL), "x")
    assert len(a) == 2 and len(b) == 2
    assert not {s.id for s in a} & {s.id for s in b}


def test_empty_agenda_is_valid_empty_feed() -> None:
    xml = build_rss("calendar", [], TODAY, URL)
    assert "<rss" in xml and parse_rss(xml, "x") == []


def test_xml_special_characters_are_escaped() -> None:
    # The radio's own parser strips tag-like text (<sync>); what matters here is that
    # the document stays well-formed and ampersands/quotes survive the round trip.
    items = parse_agenda("09:00 \u2013 10:00\tR&D <sync> \"Q4\"\tcal\n", TODAY)
    stories = parse_rss(build_rss("calendar", items, TODAY, URL), "x")
    assert len(stories) == 1
    assert "R&D" in stories[0].title and '"Q4"' in stories[0].title


OPS = {
    "queue": {"total": 40, "counts": {"breached": 7, "at_risk": 5, "on_track": 28}},
    "volume": {"today": 31, "last_24h": 52},
    "calls": {"missed_inbound": 3, "open": 2},
    "freshness": {"stale": False},
}


def test_ap_items_report_breached_tickets() -> None:
    texts = " ".join(i.title for i in ap_items(OPS))
    assert "7" in texts and "po terminie" in texts


def test_ap_items_stay_silent_on_stale_data() -> None:
    stale = {**OPS, "freshness": {"stale": True}}
    assert ap_items(stale) == []


def test_ap_items_tolerate_missing_sections() -> None:
    assert ap_items({}) == []


def test_ap_missed_calls_state_their_period() -> None:
    ops = {**OPS, "calls": {"missed_inbound": 403, "days": 7}}
    texts = [i.title for i in ap_items(ops) if "po\u0142\u0105czenia" in i.title]
    assert texts and "7 dni" in texts[0]
