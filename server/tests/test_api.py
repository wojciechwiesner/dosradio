"""DOS Radio API tests: trial/registration gate, news validation, spoken time. No network."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "x" * 40)
os.environ["DOSRADIO_PREWARM"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DOSRADIO_TRIAL_SECONDS", "3600")
    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, base_url="https://testserver")


@pytest.fixture()
def captured_emails(monkeypatch):
    """Collect verification e-mails instead of sending them over SMTP."""
    sent: list[tuple[str, str]] = []  # (recipient, verification link)
    from app import mailer

    def fake_send(to_email: str, token: str) -> None:
        sent.append((to_email, f"{mailer.SITE_URL}/?verify={token}"))

    monkeypatch.setattr(mailer, "send_verification_email", fake_send)
    return sent


def test_spoken_time():
    from app.spoken_time import spoken_time_pl
    assert spoken_time_pl(14, 20) == "czternasta dwadzieścia"
    assert spoken_time_pl(9, 0) == "dziewiąta zero zero"
    assert spoken_time_pl(21, 5) == "dwudziesta pierwsza zero pięć"
    assert spoken_time_pl(7, 47) == "siódma czterdzieści siedem"
    with pytest.raises(ValueError):
        spoken_time_pl(24, 0)


def test_parse_stories_keeps_only_sourced():
    from app.news import parse_stories
    text = "Długi tekst wiadomości do radia. " * 4
    reply = (
        f'ok [{{"title":"A","radio_text":"{text}","source_url":"https://a.pl","confirmed":true}},'
        f'{{"title":"B","radio_text":"krótko","source_url":"https://b.pl"}},'
        f'{{"title":"C","radio_text":"{text}","source_url":"brak"}},'
        f'{{"title":"D","radio_text":"{text}","source_url":"https://d.pl","confirmed":false}}]'
    )
    stories = parse_stories(reply, "sport")
    assert [s.title for s in stories] == ["A", "D"]
    assert stories[1].confirmed is False
    assert all(len(s.id) == 12 for s in stories)
    with pytest.raises(ValueError):
        parse_stories("Nie wiem.", "ai")


def test_trial_defaults_to_one_hour(tmp_path, monkeypatch):
    monkeypatch.delenv("DOSRADIO_TRIAL_SECONDS", raising=False)
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    from app.config import load_settings
    assert load_settings().trial_seconds == 3600


def test_trial_then_register_then_login(client, captured_emails):
    me = client.get("/radio-api/me").json()
    assert me == {"allowed": True, "registered": False, "email": None, "trial_started": False, "trial_remaining": 3600, "plus": False}

    started = client.post("/radio-api/trial/start").json()
    assert started["trial_started"] is True and 3595 <= started["trial_remaining"] <= 3600

    # Expire the trial by moving its start back past the one hour allowance.
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE trials SET started_at = started_at - 3660")
    assert client.get("/radio-api/me").json()["allowed"] is False
    assert client.get("/radio-api/news?cats=ai").status_code == 402

    # Clearing cookies does not reset the trial (same IP).
    client.cookies.clear()
    assert client.get("/radio-api/me").json()["allowed"] is False

    bad = client.post("/radio-api/register", json={"email": "zly", "password": "12345678"})
    assert bad.status_code == 422
    ok = client.post("/radio-api/register", json={"email": "Ola@Example.com", "password": "dlugiehaslo1"})
    assert ok.status_code == 200 and ok.json()["pending_verification"] is True
    assert len(captured_emails) == 1 and captured_emails[0][0] == "ola@example.com"

    # Until the e-mail is confirmed there is no access and login is blocked.
    assert client.get("/radio-api/me").json()["registered"] is False
    login = client.post("/radio-api/login", json={"email": "ola@example.com", "password": "dlugiehaslo1"})
    assert login.status_code == 403

    # Wrong tokens are rejected, the real token from the e-mail confirms the account.
    assert client.post("/radio-api/verify", json={"token": "nieprawidlowytoken"}).status_code == 400
    token = captured_emails[0][1].split("verify=")[1]
    verified = client.post("/radio-api/verify", json={"token": token})
    assert verified.status_code == 200 and verified.json()["verified"] is True
    me = client.get("/radio-api/me").json()
    assert me["allowed"] is True and me["registered"] is True

    assert client.post("/radio-api/register", json={"email": "ola@example.com", "password": "dlugiehaslo1"}).status_code == 409
    client.post("/radio-api/logout")
    client.cookies.clear()
    assert client.post("/radio-api/login", json={"email": "ola@example.com", "password": "zlehaslo99"}).status_code == 401
    assert client.post("/radio-api/login", json={"email": "ola@example.com", "password": "dlugiehaslo1"}).status_code == 200
    assert client.get("/radio-api/me").json()["registered"] is True


def test_expired_token_and_resend(client, captured_emails):
    ok = client.post("/radio-api/register", json={"email": "ala@example.com", "password": "dlugiehaslo1"})
    assert ok.status_code == 200

    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE users SET verify_expires = verify_expires - 100000 WHERE email = 'ala@example.com'")
    token = captured_emails[0][1].split("verify=")[1]
    assert client.post("/radio-api/verify", json={"token": token}).status_code == 400

    # Resend issues a fresh token that works.
    resent = client.post("/radio-api/resend-verification", json={"email": "ala@example.com", "password": "dlugiehaslo1"})
    assert resent.status_code == 200 and resent.json()["sent"] is True
    fresh_token = captured_emails[1][1].split("verify=")[1]
    assert client.post("/radio-api/verify", json={"token": fresh_token}).status_code == 200
    assert client.get("/radio-api/me").json()["registered"] is True


def test_health_and_input_validation(client):
    health = client.get("/radio-api/health").json()
    assert health["ok"] is True and set(health["categories"]) == {"ai", "beauty", "sport", "funny", "stoic"}
    assert client.get("/radio-api/news?cats=polityka").status_code == 400
    assert client.get("/radio-api/intro.wav?time=25:00").status_code == 400
    assert client.get("/radio-api/story/../../etc.wav").status_code in (400, 404)
