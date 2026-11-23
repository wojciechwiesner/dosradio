"""Daily podcast quota: 1 new podcast per day (Europe/Warsaw) unless paid Plus; shared by both endpoints."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from test_plus import client, fake_ffmpeg, fake_gemini  # noqa: F401  (fixtures)

PLUS_URL = "/radio-api/plus/podcast"
LINK_URL = "/radio-api/social/url-podcast-link"
WARSAW = ZoneInfo("Europe/Warsaw")
LIMIT_TEXT = "Darmowy Plus: 1 podcast dziennie. Kolejny jutro albo wykup Plus."
FAKE_SITE = {"title": "Salon Testowy", "domain": "salon.example", "description": "Masaże i pielęgnacja.",
             "text": "Oferujemy masaż Kobido.", "url": "https://salon.example"}


def _login(client, monkeypatch, email: str, *, paid: bool = False) -> int:
    from app import mailer
    monkeypatch.setattr(mailer, "send_verification_email", lambda *a, **k: None)
    from app.main import db
    client.post("/radio-api/register", json={"email": email, "password": "dlugiehaslo1"})
    with db.connect() as conn:
        conn.execute("UPDATE users SET email_verified = 1 WHERE email = ?", (email,))
    user_id = int(db.find_user_by_email(email)["id"])
    db.grant_welcome_plus(user_id, days=30)
    if paid:
        with db.connect() as conn:
            conn.execute("UPDATE users SET plus_paid_until = strftime('%s','now') + 86400 * 30 WHERE id = ?", (user_id,))
    client.post("/radio-api/login", json={"email": email, "password": "dlugiehaslo1"})
    return user_id


@pytest.fixture()
def welcome(client, monkeypatch, fake_gemini):
    _login(client, monkeypatch, "free@example.com")
    return client


@pytest.fixture()
def site(monkeypatch):
    from app import social_api
    monkeypatch.setattr(social_api, "extract_webpage_content", lambda url: dict(FAKE_SITE))


def test_welcome_plus_gets_one_then_429_with_reset_at(welcome):
    assert welcome.post(PLUS_URL, json={"topic": "Temat A"}).status_code == 200
    from app.main import podcast_quota
    denied = welcome.post(PLUS_URL, json={"topic": "Temat B"})
    assert denied.status_code == 429
    body = denied.json()
    assert body["detail"] == LIMIT_TEXT
    assert body["reset_at"] == podcast_quota.reset_at()


def test_cache_replay_does_not_count(welcome, fake_gemini):
    first = welcome.post(PLUS_URL, json={"topic": "Temat A"})
    speaks = fake_gemini["speak"]
    again = welcome.post(PLUS_URL, json={"topic": "Temat A"})
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    assert fake_gemini["speak"] == speaks  # nothing regenerated


def test_failed_generation_does_not_use_up_the_day(welcome, monkeypatch):
    from app.main import gemini

    async def broken_chat(prompt: str) -> str:
        raise RuntimeError("quota exceeded upstream")

    good_chat = gemini.chat
    monkeypatch.setattr(gemini, "chat", broken_chat)
    assert welcome.post(PLUS_URL, json={"topic": "Temat A"}).status_code == 502
    monkeypatch.setattr(gemini, "chat", good_chat)
    assert welcome.post(PLUS_URL, json={"topic": "Temat A"}).status_code == 200


def test_paid_plus_is_unlimited(client, monkeypatch, fake_gemini):
    _login(client, monkeypatch, "paid@example.com", paid=True)
    for topic in ("A", "B", "C"):
        assert client.post(PLUS_URL, json={"topic": f"Temat {topic}"}).status_code == 200


def test_limit_is_shared_between_plus_panel_and_link_endpoint(welcome, site):
    assert welcome.post(PLUS_URL, json={"topic": "Temat A"}).status_code == 200
    denied = welcome.post(LINK_URL, json={"url": "https://salon.example"})
    assert denied.status_code == 429 and denied.json()["detail"] == LIMIT_TEXT


def test_link_first_then_plus_panel_is_denied(welcome, site):
    assert welcome.post(LINK_URL, json={"url": "https://salon.example"}).status_code == 200
    assert welcome.post(PLUS_URL, json={"topic": "Temat A"}).status_code == 429


def test_anonymous_actor_gets_one_then_429(client, site, fake_gemini):
    headers = {"X-Client-Id": "anon-1"}
    assert client.post(LINK_URL, json={"url": "https://salon.example"}, headers=headers).status_code == 200
    denied = client.post(LINK_URL, json={"url": "https://salon.example", "comment": "inny"}, headers=headers)
    assert denied.status_code == 429 and "reset_at" in denied.json()
    other = client.post(LINK_URL, json={"url": "https://salon.example"}, headers={"X-Client-Id": "anon-2"})
    assert other.status_code == 200


def test_failed_link_generation_releases_the_slot(client, site, fake_gemini, monkeypatch):
    from app.main import podcasts
    headers = {"X-Client-Id": "anon-3"}
    real_episode = podcasts.episode

    async def broken(topic, headlines=None):
        raise RuntimeError("llm down")

    monkeypatch.setattr(podcasts, "episode", broken)
    assert client.post(LINK_URL, json={"url": "https://salon.example"}, headers=headers).status_code == 200  # drop marked failed
    monkeypatch.setattr(podcasts, "episode", real_episode)
    assert client.post(LINK_URL, json={"url": "https://salon.example"}, headers=headers).status_code == 200


def test_day_resets_at_warsaw_midnight(welcome):
    from app.main import podcast_quota
    late = datetime(2026, 7, 1, 23, 59, 30, tzinfo=WARSAW)
    podcast_quota.clock = lambda: late.timestamp()
    assert welcome.post(PLUS_URL, json={"topic": "Temat A"}).status_code == 200
    denied = welcome.post(PLUS_URL, json={"topic": "Temat B"})
    assert denied.status_code == 429
    midnight = datetime(2026, 7, 2, 0, 0, 0, tzinfo=WARSAW).timestamp()
    assert denied.json()["reset_at"] == midnight
    podcast_quota.clock = lambda: midnight + 1
    assert welcome.post(PLUS_URL, json={"topic": "Temat B"}).status_code == 200


def test_paid_flag_set_by_billing_not_by_welcome_plus(client, monkeypatch):
    from app import billing
    user_id = _login(client, monkeypatch, "b@example.com")
    from app.main import db
    assert db.find_user_by_email("b@example.com")["plus_paid_until"] is None
    billing._grant_plus(db, user_id)
    assert db.find_user_by_email("b@example.com")["plus_paid_until"] > 0
