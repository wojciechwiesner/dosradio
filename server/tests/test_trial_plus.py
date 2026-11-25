"""6 h trial = full Plus experience: gating of /radio-api/plus for trial listeners, expiry, and
adoption of trial data by the new account. No network."""
from __future__ import annotations

from test_plus import client, fake_ffmpeg, fake_gemini  # noqa: F401  (fixtures)

FEED = "https://feeds.castos.com/d4vo5"
PREFS_URL = "/radio-api/plus/news-preferences"


def _expire_trial() -> None:
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE trials SET started_at = started_at - 100000")


def test_default_trial_is_six_hours(tmp_path, monkeypatch):
    monkeypatch.delenv("DOSRADIO_TRIAL_SECONDS", raising=False)
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    from app.config import load_settings
    assert load_settings().trial_seconds == 6 * 3600


def test_not_started_trial_has_no_plus(client):
    me = client.get("/radio-api/me").json()
    assert me["plus"] is False and me["trial_plus"] is False
    assert client.get(PREFS_URL).status_code == 402


def test_running_trial_gets_plus_features(client):
    started = client.post("/radio-api/trial/start").json()
    assert started["plus"] is True and started["trial_plus"] is True and started["registered"] is False
    saved = client.put(PREFS_URL, json={"keywords": ["AI"], "rss_feeds": [FEED]})
    assert saved.status_code == 200, saved.text
    assert client.get(PREFS_URL).json()["rss_feeds"] == [FEED]
    assert client.get("/radio-api/plus/podcasts").json() == {"podcasts": []}
    assert client.get("/radio-api/plus/pills").json() == {"pills": []}


def test_trial_plus_ends_with_the_trial(client):
    client.post("/radio-api/trial/start")
    assert client.put(PREFS_URL, json={"keywords": ["AI"], "rss_feeds": []}).status_code == 200
    _expire_trial()
    me = client.get("/radio-api/me").json()
    assert me["allowed"] is False and me["plus"] is False and me["trial_plus"] is False
    assert client.get(PREFS_URL).status_code == 402
    assert client.post("/radio-api/plus/podcast", json={}).status_code == 402


def test_trial_owner_ids_are_negative_and_separate(client):
    from app.main import db
    first = db.trial_owner_id("anon:a")
    assert first < 0 and db.trial_owner_id("anon:a") == first
    assert db.trial_owner_id("anon:b") not in (first, None)
    assert db.trial_owner_id("anon:missing", create=False) is None


def test_trial_podcast_counts_against_daily_limit(client, fake_gemini, fake_ffmpeg):
    client.post("/radio-api/trial/start")
    first = client.post("/radio-api/plus/podcast", json={"topic": "Sen i produktywność"})
    assert first.status_code == 200, first.text
    assert [item["id"] for item in client.get("/radio-api/plus/podcasts").json()["podcasts"]] == [first.json()["id"]]
    second = client.post("/radio-api/plus/podcast", json={"topic": "Inny temat zupełnie"})
    assert second.status_code == 429


def test_registration_adopts_trial_sources(client, monkeypatch):
    from app import mailer
    monkeypatch.setattr(mailer, "send_verification_email", lambda *a, **k: None)
    client.post("/radio-api/trial/start")
    client.put(PREFS_URL, json={"keywords": ["AI"], "rss_feeds": [FEED]})
    assert client.post("/radio-api/register", json={"email": "ola@example.com", "password": "dlugiehaslo1"}).status_code == 200
    from app.main import db
    user_id = int(db.find_user_by_email("ola@example.com")["id"])
    assert db.get_news_preferences(user_id)["rss_feeds"] == [FEED]
    owner = db.trial_owner_id(f"anon:{client.cookies.get('dr_anon')}", create=False)
    assert owner is not None and db.get_news_preferences(owner) is None


def test_trial_listener_hears_no_spots(client):
    client.post("/radio-api/trial/start")
    assert client.get("/radio-api/social/spot").json()["skip"] is True
