"""Plus wave tests: gating (402), preferences validation, podcast generation/cache, personal digest."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "x" * 40)
os.environ["DOSRADIO_PREWARM"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAKE_SCRIPT = json.dumps({
    "title": "Testowy odcinek",
    "turns": [
        {"speaker": 0, "text": "Cześć, tu Ania i witasz w Rozmowach DOS Radio, dziś mówimy o testach."},
        {"speaker": 1, "text": "Dzień dobry, tu Michał. Testy to podstawa, zacznijmy od podstaw."},
        {"speaker": 0, "text": "Dokładnie, najpierw sprawdzamy bramki dostępu i walidację danych wejściowych."},
        {"speaker": 1, "text": "A na koniec zostawiamy sobie cache i odtwarzanie. Zaczynajmy więc."},
        {"speaker": 0, "text": "Świetnie, podsumujmy i pożegnajmy się ze słuchaczami do następnego razu."},
    ],
}, ensure_ascii=False)

TINY_WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DOSRADIO_TRIAL_SECONDS", "600")
    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, base_url="https://testserver")


@pytest.fixture()
def plus_client(client, monkeypatch):
    """Verified, logged-in listener with an active Plus plan."""
    from app import mailer
    monkeypatch.setattr(mailer, "send_verification_email", lambda *a, **k: None)
    client.post("/radio-api/register", json={"email": "ola@example.com", "password": "dlugiehaslo1"})
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE users SET email_verified = 1, plan = 'plus' WHERE email = 'ola@example.com'")
    client.post("/radio-api/login", json={"email": "ola@example.com", "password": "dlugiehaslo1"})
    assert client.get("/radio-api/me").json()["plus"] is True
    return client


@pytest.fixture()
def fake_gemini(monkeypatch):
    """No network: scripted dialogue + tiny WAV for every TTS call. Returns a call counter."""
    from app.main import gemini
    calls = {"speak": 0}

    async def fake_chat(prompt: str) -> str:
        return FAKE_SCRIPT

    async def fake_speak(text: str, voice: str, style: str = "") -> bytes:
        calls["speak"] += 1
        return TINY_WAV

    monkeypatch.setattr(gemini, "chat", fake_chat)
    monkeypatch.setattr(gemini, "speak", fake_speak)
    return calls


@pytest.fixture(autouse=True)
def fake_ffmpeg(client, monkeypatch):
    """No ffmpeg in tests: the runner just creates the output file (last argv entry). Returns the argv log."""
    from app.main import podcasts
    calls: list[list[str]] = []

    def fake_run(args: list[str], timeout: int) -> str:
        calls.append(args)
        Path(args[-1]).write_bytes(b"BUMPER")
        return ""

    monkeypatch.setattr(podcasts, "run", fake_run)
    return calls


def seed_archive_segments(count: int = 8) -> None:
    from app.main import settings
    station_dir = settings.data_dir / "archive" / "dos-groove"
    station_dir.mkdir(parents=True, exist_ok=True)
    for index in range(count):
        (station_dir / f"seg-{1700000000000000000 + index}.opus").write_bytes(b"OPUSDATA" * 100)


# --- gating ----------------------------------------------------------------------

def test_plus_endpoints_gated_for_anonymous_and_free_users(client, fake_gemini, monkeypatch):
    from app import mailer
    monkeypatch.setattr(mailer, "send_verification_email", lambda *a, **k: None)

    for method, path in [
        ("post", "/radio-api/plus/podcast"),
        ("post", "/radio-api/plus/pill"),
        ("get", "/radio-api/plus/pill/abc"),
        ("put", "/radio-api/plus/news-preferences"),
        ("get", "/radio-api/plus/news-preferences"),
        ("get", "/radio-api/plus/news-digest"),
    ]:
        kwargs = {"json": {"url": "https://youtu.be/dQw4w9WgXcQ"} if path.endswith("/pill") else {}} \
            if method in ("post", "put") else {}
        response = getattr(client, method)(path, **kwargs)
        assert response.status_code == 402, f"{method} {path}"
        assert "Plus" in response.json()["detail"]

    # A registered free listener is still gated out.
    client.post("/radio-api/register", json={"email": "free@example.com", "password": "dlugiehaslo1"})
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE users SET email_verified = 1 WHERE email = 'free@example.com'")
    client.post("/radio-api/login", json={"email": "free@example.com", "password": "dlugiehaslo1"})
    assert client.get("/radio-api/me").json()["plus"] is False
    assert client.post("/radio-api/plus/podcast", json={}).status_code == 402
    assert client.put("/radio-api/plus/news-preferences", json={"keywords": ["ai"], "rss_feeds": []}).status_code == 402


# --- preferences -------------------------------------------------------------------

def test_preferences_validation_and_roundtrip(plus_client):
    assert plus_client.put("/radio-api/plus/news-preferences", json={
        "keywords": [f"temat{i}" for i in range(21)], "rss_feeds": [],
    }).status_code == 422
    assert plus_client.put("/radio-api/plus/news-preferences", json={
        "keywords": ["ai"], "rss_feeds": [f"https://feed{i}.pl/rss" for i in range(11)],
    }).status_code == 422
    for bad in ("ftp://feed.pl/rss", "javascript:alert(1)", "to-nie-jest-url"):
        assert plus_client.put("/radio-api/plus/news-preferences", json={
            "keywords": [], "rss_feeds": [bad],
        }).status_code == 422

    saved = plus_client.put("/radio-api/plus/news-preferences", json={
        "keywords": [" AI ", "Kosmos", "ai"], "rss_feeds": ["https://spacex.com/feed", "http://nano.pl/rss"],
    })
    assert saved.status_code == 200
    body = saved.json()
    assert body["keywords"] == ["AI", "Kosmos"]  # trimmed and de-duplicated
    assert body["rss_feeds"] == ["https://spacex.com/feed", "http://nano.pl/rss"]

    read_back = plus_client.get("/radio-api/plus/news-preferences").json()
    assert read_back["keywords"] == body["keywords"]
    assert read_back["rss_feeds"] == body["rss_feeds"]
    assert read_back["updated_at"] > 0


# --- podcasts ------------------------------------------------------------------------

def test_podcast_generates_voices_with_music_and_caches(plus_client, fake_gemini, fake_ffmpeg):
    seed_archive_segments()
    created = plus_client.post("/radio-api/plus/podcast", json={"topic": "Sen i produktywność"})
    assert created.status_code == 200
    manifest = created.json()
    from app.podcast import slugify
    assert manifest["id"].endswith(slugify("Sen i produktywność"))
    kinds = [part["kind"] for part in manifest["parts"]]
    assert kinds.count("voice") == 5
    assert kinds.count("music") >= 4  # two breaks of continuous archive segments
    # Radio bumpers: intro, break-out + break-in around each music break, outro; never two music edges bare.
    assert kinds[0] == "bumper" and kinds[-1] == "bumper"
    assert kinds.count("bumper") == 2 + 2 * 2
    first_music = kinds.index("music")
    assert kinds[first_music - 1] == "bumper"
    assert kinds[len(kinds) - 1 - kinds[::-1].index("music") + 1] == "bumper"
    assert manifest["version"] >= 2
    assert fake_gemini["speak"] == 5 + kinds.count("bumper")
    mixes = [args for args in fake_ffmpeg if "-filter_complex" in args]
    assert len(mixes) == kinds.count("bumper")
    assert "sidechaincompress" in mixes[0][mixes[0].index("-filter_complex") + 1]
    assert "afade=t=in" in mixes[0][mixes[0].index("-filter_complex") + 1]

    # Every part is served back to a Plus listener.
    for part in manifest["parts"]:
        served = plus_client.get(part["url"])
        assert served.status_code == 200
        assert served.content

    # Same topic on the same day: served from cache, no new TTS calls.
    spoken = fake_gemini["speak"]
    again = plus_client.post("/radio-api/plus/podcast", json={"topic": "Sen i produktywność"})
    assert again.json()["id"] == manifest["id"]
    assert fake_gemini["speak"] == spoken

    # Manifest endpoint and traversal guard.
    assert plus_client.get(f"/radio-api/plus/podcast/{manifest['id']}").json()["title"] == "Testowy odcinek"
    assert plus_client.get("/radio-api/plus/podcast/2026-01-01-nie-ma").status_code == 404
    assert plus_client.get(f"/radio-api/plus/podcast/{manifest['id']}/../../etc/passwd").status_code in (400, 404)


def test_podcast_survives_without_archive_music(plus_client, fake_gemini):
    manifest = plus_client.post("/radio-api/plus/podcast", json={"topic": "Odporność na błędy"}).json()
    kinds = [part["kind"] for part in manifest["parts"]]
    assert "voice" in kinds and "music" not in kinds
    assert kinds[0] == "bumper" and kinds[-1] == "bumper"  # voice-only bumpers still frame the episode


def test_stale_podcast_manifest_regenerates(plus_client, fake_gemini):
    from app.main import podcasts
    first = plus_client.post("/radio-api/plus/podcast", json={"topic": "Wersje"}).json()
    manifest_path = podcasts.dir / first["id"] / "manifest.json"
    stored = json.loads(manifest_path.read_text())
    del stored["version"]  # simulate an episode generated before bumpers existed
    manifest_path.write_text(json.dumps(stored))
    spoken = fake_gemini["speak"]
    again = plus_client.post("/radio-api/plus/podcast", json={"topic": "Wersje"}).json()
    assert fake_gemini["speak"] > spoken and again["version"] >= 2


def test_podcast_bumper_failure_does_not_break_episode(plus_client, fake_gemini, monkeypatch):
    from app.main import podcasts

    def broken(args, timeout):
        raise RuntimeError("ffmpeg is not installed")

    monkeypatch.setattr(podcasts, "run", broken)
    kinds = [part["kind"] for part in plus_client.post("/radio-api/plus/podcast", json={"topic": "Bez ffmpeg"}).json()["parts"]]
    assert kinds.count("voice") == 5 and "bumper" not in kinds


# --- personal digest ---------------------------------------------------------------

RSS_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Feed</title>
<item><title>Nowy model AI</title><link>https://lab.pl/model</link>
<description>&lt;b&gt;Premiera&lt;/b&gt; nowego modelu ogarniajacego polski.</description></item>
<item><title>Wyprawa na Marsa</title><link>https://space.pl/mars</link>
<description>Rakieta wystartuje w piatek.</description></item>
<item><title>Beton</title><link>bez-linku</link><description>Bez linku.</description></item>
</channel></rss>"""


def test_parse_rss_and_keyword_filter():
    from app.personal_news import matches_keywords, parse_rss
    stories = parse_rss(RSS_SAMPLE, "https://feed.pl")
    assert [s.title for s in stories] == ["Nowy model AI", "Wyprawa na Marsa"]  # no link -> dropped
    assert stories[0].radio_text == "Premiera nowego modelu ogarniajacego polski."  # HTML stripped
    assert all(s.category == "personal" and s.confirmed for s in stories)

    assert matches_keywords(stories[0], ["ai"]) is True
    assert matches_keywords(stories[1], ["ai"]) is False
    assert matches_keywords(stories[1], []) is True  # no keywords keeps everything


def test_personal_digest_falls_back_to_global(plus_client):
    from app.main import db, news
    from app.news import Story
    news.cache["ai"].stories = [Story("aaaabbbbcccc", "Globalna wiadomość", "Tekst globalnej wiadomości.",
                                      "https://global.pl", True, "ai", True)]
    # Preferences point only at a dead local feed: 5 s budget, per-feed isolation, global fallback.
    plus_client.put("/radio-api/plus/news-preferences", json={
        "keywords": [], "rss_feeds": ["http://127.0.0.1:1/rss"],
    })
    digest = plus_client.get("/radio-api/plus/news-digest")
    assert digest.status_code == 200
    body = digest.json()
    assert body["personal"] is False and body["fallback"] is True
    assert [s["title"] for s in body["stories"]] == ["Globalna wiadomość"]

    # No preferences at all: empty, not an error.
    with db.connect() as conn:
        conn.execute("DELETE FROM news_preferences")
    from app import main
    main.personal.cache.clear()
    empty = plus_client.get("/radio-api/plus/news-digest").json()
    assert empty == {"personal": False, "fallback": False, "stories": []}


def test_personal_digest_serves_rss_stories(plus_client, monkeypatch):
    from app import personal_news
    from app.personal_news import parse_rss

    async def fake_fetch(url: str):
        return parse_rss(RSS_SAMPLE, url)

    monkeypatch.setattr(personal_news, "fetch_feed", fake_fetch)
    plus_client.put("/radio-api/plus/news-preferences", json={
        "keywords": ["mars"], "rss_feeds": ["https://feed.pl/rss"],
    })
    body = plus_client.get("/radio-api/plus/news-digest").json()
    assert body["personal"] is True
    assert [s["title"] for s in body["stories"]] == ["Wyprawa na Marsa", "Nowy model AI"]  # keyword hit first

    # The digest story is remembered, so the shared story audio endpoint can voice it.
    from app.main import news
    story = news.find(body["stories"][0]["id"])
    assert story is not None and story.category == "personal"
    from app.news import story_script
    assert "twoich źródeł" in story_script(story)


def test_keywords_rank_feed_stories_instead_of_dropping_them(monkeypatch):
    """Regression: a feed with no keyword hits used to yield zero stories (feed unusable)."""
    import asyncio
    from app import personal_news
    stories = personal_news.parse_rss(RSS_SAMPLE, "https://feed.pl")

    async def fake_fetch(url):
        return stories

    monkeypatch.setattr(personal_news, "fetch_feed", fake_fetch)
    ranked = asyncio.run(personal_news.collect_personal_stories(["marsa"], ["https://feed.pl/rss"]))
    assert [s.title for s in ranked] == ["Wyprawa na Marsa", "Nowy model AI"]  # hit first, rest kept


def test_news_endpoint_serves_my_feeds_as_a_topic(plus_client, monkeypatch):
    from app import personal_news
    stories = personal_news.parse_rss(RSS_SAMPLE, "https://feed.pl")

    async def fake_collect(keywords, feeds):
        return stories

    monkeypatch.setattr(personal_news, "collect_personal_stories", fake_collect)
    plus_client.put("/radio-api/plus/news-preferences", json={"keywords": ["prezydent"], "rss_feeds": ["https://feed.pl/rss"]})
    body = plus_client.get("/radio-api/news?cats=mine").json()
    mine = body["categories"][0]
    assert mine["category"] == "mine" and mine["error"] is None
    assert [s["title"] for s in mine["stories"]] == ["Nowy model AI", "Wyprawa na Marsa"]


def test_my_feeds_topic_is_plus_only(client):
    body = client.get("/radio-api/news?cats=mine").json()
    assert body["categories"][0]["stories"] == []
    assert "Plus" in body["categories"][0]["error"]
