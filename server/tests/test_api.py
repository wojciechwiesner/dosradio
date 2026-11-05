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
    monkeypatch.setenv("DOSRADIO_TRIAL_SECONDS", "600")
    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, base_url="https://testserver")


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


def test_trial_then_register_then_login(client):
    me = client.get("/radio-api/me").json()
    assert me == {"allowed": True, "registered": False, "email": None, "trial_started": False, "trial_remaining": 600}

    started = client.post("/radio-api/trial/start").json()
    assert started["trial_started"] is True and 595 <= started["trial_remaining"] <= 600

    # Expire the trial by moving its start back 11 minutes.
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE trials SET started_at = started_at - 660")
    assert client.get("/radio-api/me").json()["allowed"] is False
    assert client.get("/radio-api/news?cats=ai").status_code == 402

    # Clearing cookies does not reset the trial (same IP).
    client.cookies.clear()
    assert client.get("/radio-api/me").json()["allowed"] is False

    bad = client.post("/radio-api/register", json={"email": "zly", "password": "12345678"})
    assert bad.status_code == 422
    ok = client.post("/radio-api/register", json={"email": "Ola@Example.com", "password": "dlugiehaslo1"})
    assert ok.status_code == 200 and ok.json()["email"] == "ola@example.com"
    me = client.get("/radio-api/me").json()
    assert me["allowed"] is True and me["registered"] is True

    assert client.post("/radio-api/register", json={"email": "ola@example.com", "password": "dlugiehaslo1"}).status_code == 409
    client.post("/radio-api/logout")
    client.cookies.clear()
    assert client.post("/radio-api/login", json={"email": "ola@example.com", "password": "zlehaslo99"}).status_code == 401
    assert client.post("/radio-api/login", json={"email": "ola@example.com", "password": "dlugiehaslo1"}).status_code == 200
    assert client.get("/radio-api/me").json()["registered"] is True


def test_health_and_input_validation(client):
    health = client.get("/radio-api/health").json()
    assert health["ok"] is True and set(health["categories"]) == {"ai", "beauty", "sport", "funny", "stoic"}
    assert client.get("/radio-api/news?cats=polityka").status_code == 400
    assert client.get("/radio-api/intro.wav?time=25:00").status_code == 400
    assert client.get("/radio-api/story/../../etc.wav").status_code in (400, 404)
