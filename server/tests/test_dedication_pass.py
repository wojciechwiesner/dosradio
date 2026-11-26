"""A dedication recipient whose free hour is over still hears the greeting and the music under it, briefly."""
from __future__ import annotations

import sys
import wave
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import DEDICATION_PASS_COOKIE, DEDICATION_PASS_SECONDS, AccessService
from app.catalog import CatalogService
from app.db import Database
from app.dedications import build_dedications_router


def _wav() -> bytes:
    buf = BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(b"\x00\x00" * 2400)
    return buf.getvalue()


def _access(tmp_path: Path) -> AccessService:
    return AccessService(Database(tmp_path / "dosradio.db"), secret="s" * 40, trial_seconds=3600)


def test_pass_is_signed_time_limited_and_not_renewable(tmp_path: Path) -> None:
    access = _access(tmp_path)
    granted = access.grant_dedication_pass("abc123", "203.0.113.7", now=1000.0)
    assert granted is not None
    value, max_age = granted
    assert max_age == DEDICATION_PASS_SECONDS
    assert access.dedication_pass_valid(value, now=1000.0 + DEDICATION_PASS_SECONDS - 1)
    assert not access.dedication_pass_valid(value, now=1000.0 + DEDICATION_PASS_SECONDS + 1)
    # Re-opening the link later does not move the window.
    again = access.grant_dedication_pass("abc123", "203.0.113.7", now=1300.0)
    assert again is not None and again[1] == DEDICATION_PASS_SECONDS - 300
    assert access.grant_dedication_pass("abc123", "203.0.113.7", now=1000.0 + DEDICATION_PASS_SECONDS) is None
    # Tampering with the expiry breaks the signature.
    token, expires, sig = value.split(".")
    assert not access.dedication_pass_valid(f"{token}.{int(expires) + 99999}.{sig}", now=1000.0)
    assert not access.dedication_pass_valid("garbage", now=1000.0)
    assert not access.dedication_pass_valid(None)


def test_get_dedication_sets_pass_cookie(tmp_path: Path) -> None:
    async def speak(text: str, voice: str = "Orus", style: str = "") -> bytes:
        return _wav()

    access = _access(tmp_path)
    catalog = CatalogService(Database(tmp_path / "dosradio.db"))
    app = FastAPI()
    app.include_router(build_dedications_router(
        speak=speak, audio_dir=tmp_path / "audio", db_path=tmp_path / "dosradio.db",
        station_lookup=lambda sid: next((s for s in catalog.public_catalog()["stations"] if s["id"] == sid), None),
        access=access,
    ))
    client = TestClient(app)
    created = client.post("/radio-api/dedications", json={
        "station_id": "salon-beauty-spa", "to_name": "Klaudia", "from_name": "Wojtek", "message": "Hej", "lang": "pl",
    })
    assert created.status_code in (200, 201), created.text
    token = created.json()["id"]
    res = client.get(f"/radio-api/dedications/{token}")
    assert res.status_code == 200
    cookie = res.headers.get("set-cookie", "")
    assert cookie.startswith(f"{DEDICATION_PASS_COOKIE}=")
    value = cookie.split(";", 1)[0].split("=", 1)[1].strip('"')
    assert access.dedication_pass_valid(value)
