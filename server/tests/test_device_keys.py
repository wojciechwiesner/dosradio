"""Device keys: a shared device (salon kiosk) gets permanent access without an account."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "x" * 40)
os.environ["DOSRADIO_PREWARM"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SALON_KEY = "k" * 40


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DOSRADIO_TRIAL_SECONDS", "0")   # trial already used up
    monkeypatch.setenv("DOSRADIO_DEVICE_KEYS", f"luna-salon:{SALON_KEY}")
    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    from fastapi.testclient import TestClient
    from app.main import app
    # A public (non-Tailscale) address, so the admin bypass does not apply.
    return TestClient(app, base_url="https://testserver", headers={"cf-connecting-ip": "83.4.169.163"})


def test_without_key_is_blocked(client):
    client.post("/radio-api/trial/start")
    assert client.get("/radio-api/news?cats=ai").status_code == 402


def test_wrong_key_is_blocked(client):
    client.post("/radio-api/trial/start")
    response = client.get("/radio-api/news?cats=ai", headers={"x-dosradio-device": "z" * 40})
    assert response.status_code == 402


def test_device_key_header_passes_the_gate(client):
    client.post("/radio-api/trial/start")
    response = client.get("/radio-api/story/zzzz.wav", headers={"x-dosradio-device": SALON_KEY})
    assert response.status_code == 400   # past the 402 gate, rejected only for the bad id


def test_device_key_query_passes_the_gate(client):
    client.post("/radio-api/trial/start")
    assert client.get(f"/radio-api/story/zzzz.wav?device={SALON_KEY}").status_code == 400
    assert client.get("/radio-api/story/zzzz.wav?device=short").status_code == 402


def test_cors_header_only_for_valid_device_key(client):
    keyed = client.get(f"/radio-api/story/zzzz.wav?device={SALON_KEY}")
    assert keyed.headers.get("access-control-allow-origin") == "*"
    plain = client.get("/radio-api/story/zzzz.wav")
    assert "access-control-allow-origin" not in plain.headers
    wrong = client.get("/radio-api/story/zzzz.wav?device=" + "z" * 40)
    assert "access-control-allow-origin" not in wrong.headers


def test_short_device_key_is_rejected():
    from app.config import parse_device_keys
    with pytest.raises(RuntimeError):
        parse_device_keys("luna-salon:tooshort")
    assert parse_device_keys(f"luna-salon:{SALON_KEY}, ") == {SALON_KEY: "luna-salon"}
