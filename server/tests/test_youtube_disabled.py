"""YouTube audio clipping is off before release: fail closed, nothing is downloaded.

Existing pills on disk are kept but never served, and the non-YouTube paths
(article pills, public RSS podcasts) keep working.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "x" * 40)
os.environ["DOSRADIO_PREWARM"] = "0"

WATCH_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
VIDEO_ID = "dQw4w9WgXcQ"


def test_youtube_clips_disabled_by_default(monkeypatch):
    monkeypatch.delenv("DOSRADIO_YOUTUBE_CLIPS", raising=False)
    from app.youtube_pill import youtube_clips_enabled
    assert youtube_clips_enabled() is False


def test_youtube_clips_only_explicit_one_enables(monkeypatch):
    from app.youtube_pill import youtube_clips_enabled
    for value in ("0", "false", "no", "off", "yes", "true", "YES", ""):
        monkeypatch.setenv("DOSRADIO_YOUTUBE_CLIPS", value)
        assert youtube_clips_enabled() is False
    monkeypatch.setenv("DOSRADIO_YOUTUBE_CLIPS", "1")
    assert youtube_clips_enabled() is True


def test_download_audio_refuses_when_disabled(monkeypatch, tmp_path):
    monkeypatch.delenv("DOSRADIO_YOUTUBE_CLIPS", raising=False)
    from app.youtube_pill import PillError, download_audio

    def boom(*_args, **_kwargs):
        raise AssertionError("yt-dlp must not be called while clips are disabled")

    with pytest.raises(PillError):
        download_audio(boom, WATCH_URL, tmp_path)


def _plus_client(tmp_path, monkeypatch):
    """A verified, logged-in listener with paid Plus, on a fresh app instance."""
    from fastapi.testclient import TestClient

    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    from app import mailer
    from app.main import app, db

    monkeypatch.setattr(mailer, "send_verification_email", lambda *a, **k: None)
    client = TestClient(app, base_url="https://testserver")
    client.post("/radio-api/register", json={"email": "ola@example.com", "password": "dlugiehaslo1"})
    with db.connect() as conn:
        conn.execute("UPDATE users SET email_verified = 1, plan = 'plus', plus_paid_until = strftime('%s','now') + 86400 * 30 WHERE email = 'ola@example.com'")
    client.post("/radio-api/login", json={"email": "ola@example.com", "password": "dlugiehaslo1"})
    assert client.get("/radio-api/me").json()["plus"] is True
    return client


def test_pill_create_and_batch_fail_closed_without_download(tmp_path, monkeypatch):
    monkeypatch.delenv("DOSRADIO_YOUTUBE_CLIPS", raising=False)
    plus_client = _plus_client(tmp_path, monkeypatch)
    from app.main import db, podcasts

    calls: list[list[str]] = []

    def boom(args, timeout):
        calls.append(args)
        raise AssertionError(f"no external process may run for a YouTube pill: {args[0]}")

    monkeypatch.setattr(podcasts, "run", boom)

    created = plus_client.post("/radio-api/plus/pill", json={"url": WATCH_URL})
    assert created.status_code == 410, created.text
    assert "YouTube" in created.json()["detail"]

    batch = plus_client.post("/radio-api/plus/pills/batch", json={"text": f"{WATCH_URL}\nhttps://youtu.be/abcdefghijk"})
    assert batch.status_code == 410, batch.text

    assert calls == []
    assert list(db.user_pill_ids(int(db.find_user_by_email("ola@example.com")["id"]))) == []


def test_cached_pill_is_not_served_and_not_deleted(tmp_path, monkeypatch):
    monkeypatch.delenv("DOSRADIO_YOUTUBE_CLIPS", raising=False)
    plus_client = _plus_client(tmp_path, monkeypatch)
    from app.main import settings

    pill_dir = settings.data_dir / "pills" / VIDEO_ID
    pill_dir.mkdir(parents=True)
    (pill_dir / "v00.wav").write_bytes(b"RIFFkept")
    (pill_dir / "manifest.json").write_text(json.dumps({
        "id": VIDEO_ID, "title": "Stara pigułka", "author": "Ktoś", "source_url": WATCH_URL,
        "parts": [{"kind": "voice", "url": f"/radio-api/plus/pill/{VIDEO_ID}/v00.wav"}],
    }))

    assert plus_client.get(f"/radio-api/plus/pill/{VIDEO_ID}").status_code == 410
    assert plus_client.get(f"/radio-api/plus/pill/{VIDEO_ID}/v00.wav").status_code == 410
    assert plus_client.get("/radio-api/plus/pills").status_code == 410
    # Nothing on disk is touched: the file is still there, just unreachable.
    assert (pill_dir / "v00.wav").read_bytes() == b"RIFFkept"


def test_custom_radio_rejects_youtube_pill_but_keeps_article_notes(tmp_path, monkeypatch):
    monkeypatch.delenv("DOSRADIO_YOUTUBE_CLIPS", raising=False)
    from fastapi.testclient import TestClient

    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    from app.main import app

    client = TestClient(app, base_url="https://testserver")
    blocked = client.post("/radio-api/custom-radios", headers={"X-Client-Id": "creator-1"}, json={
        "name": "Radio z wycinanką", "mode": "describe", "description": "techno",
        "pills": [{"title": "Odcinek", "url": "https://youtu.be/abcdefghijk", "note": "skrót"}],
    })
    assert blocked.status_code == 410, blocked.text

    kept = client.post("/radio-api/custom-radios", headers={"X-Client-Id": "creator-1"}, json={
        "name": "Radio z artykułem", "mode": "describe", "description": "techno",
        "pills": [{"title": "Notatka", "url": "https://example.com/artykul", "note": "streszczenie artykułu"}],
    })
    assert kept.status_code == 200, kept.text
    assert kept.json()["radio"]["pills"][0]["url"] == "https://example.com/artykul"

    slug = kept.json()["slug"]
    appended = client.post(f"/radio-api/custom-radios/{slug}/pills", headers={"X-Client-Id": "creator-1"}, json={
        "title": "Klip", "url": "https://www.youtube.com/watch?v=abcdefghijk", "note": "",
    })
    assert appended.status_code == 410


def test_article_pill_drop_still_works(tmp_path, monkeypatch):
    """A pill drop is a text summary of a web page, never a YouTube download, so it stays."""
    from fastapi.testclient import TestClient

    monkeypatch.delenv("DOSRADIO_YOUTUBE_CLIPS", raising=False)
    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    from app import url_extractor
    from app.main import app

    monkeypatch.setattr(
        url_extractor, "_fetch_html_raw",
        lambda url, timeout=10.0: "<html><head><title>Kawa</title><meta name='description' content='Jak parzyć'></head><body><p>Artykuł o kawie.</p></body></html>",
    )
    client = TestClient(app, base_url="https://testserver")
    drop = client.post("/radio-api/social/drops", headers={"X-Client-Id": "listener-1"}, json={
        "kind": "pill", "station_id": "dos-groove", "to_name": "Kasia",
        "message": "Krótkie streszczenie artykułu o kawie.",
        "source_url": "https://example.com/artykul-o-kawie",
    })
    assert drop.status_code == 200, drop.text
    assert drop.json()["drop"]["kind"] == "pill"
    assert "Kawa" in drop.json()["drop"]["pill_text"]
