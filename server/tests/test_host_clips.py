"""Host clips: listing shape, 404s, and each clip voiced once then served from cache. Fake speaker, no network."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "x" * 40)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

JINGLES_PER_HOST = 4
CHATTER_PER_HOST = 8
FAKE_WAV = b"RIFF" + b"\x00" * 40
STATION = "dos-groove"


def make_app(speak, audio_dir):
    from fastapi import FastAPI
    from app.host_clips import build_router

    app = FastAPI()
    app.include_router(build_router(speak, audio_dir))
    return app


@pytest.fixture()
def env(tmp_path):
    from fastapi.testclient import TestClient

    calls: list[tuple[str, str, str]] = []

    async def fake_speak(text: str, voice: str, style: str = "") -> bytes:
        calls.append((text, voice, style))
        return FAKE_WAV

    client = TestClient(make_app(fake_speak, tmp_path))
    return SimpleNamespace(client=client, calls=calls, audio_dir=tmp_path)


def test_every_host_has_four_jingles_naming_dos_radio_and_eight_chatter():
    from app.hosts import HOSTS

    for station_id, host in HOSTS.items():
        assert len(host.jingles) == JINGLES_PER_HOST, station_id
        assert len(host.chatter) == CHATTER_PER_HOST, station_id
        assert all("DOS Radio" in line for line in host.jingles), station_id
        for line in host.jingles + host.chatter:
            assert all(ord(char) < 0x2000 for char in line), (station_id, line)


def test_listing_shape_and_urls(env):
    body = env.client.get(f"/radio-api/host-clips/{STATION}").json()
    assert body["jingles"] == [f"/radio-api/host-clip/{STATION}/jingle/{i}.wav" for i in range(JINGLES_PER_HOST)]
    assert body["chatter"] == [f"/radio-api/host-clip/{STATION}/chatter/{i}.wav" for i in range(CHATTER_PER_HOST)]
    assert env.calls == []


def test_clip_is_voiced_once_then_served_from_cache(env):
    from app.hosts import HOSTS

    host = HOSTS[STATION]
    first = env.client.get(f"/radio-api/host-clip/{STATION}/jingle/0.wav")
    assert first.status_code == 200
    assert first.headers["content-type"].startswith("audio/wav")
    assert first.content == FAKE_WAV

    second = env.client.get(f"/radio-api/host-clip/{STATION}/jingle/0.wav")
    assert second.status_code == 200 and second.content == FAKE_WAV
    assert env.calls == [(host.jingles[0], host.voice, host.style)]
    assert (env.audio_dir / f"jingle-{STATION}-0.wav").read_bytes() == FAKE_WAV


def test_head_request_serves_chatter_clip(env):
    response = env.client.head(f"/radio-api/host-clip/{STATION}/chatter/7.wav")
    assert response.status_code == 200
    assert len(env.calls) == 1


@pytest.mark.parametrize("path", [
    "/radio-api/host-clips/no-such-station",
    "/radio-api/host-clip/no-such-station/jingle/0.wav",
    f"/radio-api/host-clip/{STATION}/news/0.wav",
    f"/radio-api/host-clip/{STATION}/jingle/{JINGLES_PER_HOST}.wav",
    f"/radio-api/host-clip/{STATION}/chatter/{CHATTER_PER_HOST}.wav",
    f"/radio-api/host-clip/{STATION}/jingle/x.wav",
])
def test_bad_station_kind_or_index_is_404_without_voicing(env, path):
    assert env.client.get(path).status_code == 404
    assert env.calls == []


def test_speaker_failure_returns_502_and_writes_nothing(tmp_path):
    from fastapi.testclient import TestClient

    async def broken_speak(text: str, voice: str, style: str = "") -> bytes:
        raise RuntimeError("tts unavailable")

    response = TestClient(make_app(broken_speak, tmp_path)).get(f"/radio-api/host-clip/{STATION}/jingle/0.wav")
    assert response.status_code == 502
    assert list(tmp_path.iterdir()) == []


def test_a_new_genre_borrows_an_existing_hosts_voice(env) -> None:
    """A genre added without its own host still gets a voice and host-clips endpoints work."""
    from app.hosts import host_for
    host = host_for("deep-tech")
    assert host.name == "Kuba"
    assert host.station_label == "Deep Tech"
    assert "Deep Tech" in host.greeting
    assert "Deep Tech" in host.jingle

    res = env.client.get("/radio-api/host-clips/deep-tech")
    assert res.status_code == 200
    data = res.json()
    assert len(data["jingles"]) > 0
    assert len(data["chatter"]) > 0
