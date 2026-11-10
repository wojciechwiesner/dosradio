"""A custom mood is recorded on the server and played back 30 seconds behind the recording.

The browser never opens the Lyria websocket: nginx 1.18 cannot upgrade a websocket over HTTP/2,
so that path answers 404 to every listener. The mood rides the same channel as the preset stations,
as a live recording split into 10-minute parts.
"""
from __future__ import annotations

import asyncio
import base64
import json

from pathlib import Path
import pytest
import os
import sys

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "x" * 40)
os.environ["DOSRADIO_PREWARM"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


import websockets

from app import recorder
from app.mood import MoodSession
from app.recorder import StationRecorder

BYTES_PER_SECOND = 192_000  # 48 kHz, 16-bit, stereo — the rate the recorder already assumes
CHUNK_BYTES = BYTES_PER_SECOND  # one second of audio per fake message
PART_SECONDS = 600
BUFFER_SECONDS = 30


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, base_url="https://testserver")


class _FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.received = 0
        self._chunk = base64.b64encode(bytes(CHUNK_BYTES)).decode()

    async def __aenter__(self) -> "_FakeSocket":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    async def send(self, message: str) -> None:
        self.sent.append(json.loads(message))

    async def recv(self) -> str:
        self.received += 1
        if self.received > 2:
            raise websockets.ConnectionClosed(None, None)
        return json.dumps({"serverContent": {"audioChunks": [{"data": self._chunk}]}})


@pytest.fixture
def fake_lyria(monkeypatch: pytest.MonkeyPatch) -> _FakeSocket:
    socket = _FakeSocket()
    fake_encode = lambda pcm, **kwargs: b"OggS" + len(pcm).to_bytes(4, "big")
    monkeypatch.setattr(websockets, "connect", lambda url, **kwargs: socket)
    monkeypatch.setattr(recorder, "encode_pcm_to_opus", fake_encode)
    from app import mood
    monkeypatch.setattr(mood, "encode_pcm_to_opus", fake_encode)
    return socket


@pytest.mark.anyio
async def test_mood_plays_live_thirty_seconds_behind(client, fake_lyria: _FakeSocket) -> None:
    created = client.post("/radio-api/mood", json={"prompt": "deszczowy wieczor przy oknie"}).json()
    mood_id = created["id"]
    assert mood_id.startswith("mood-")

    from app.main import mood_recorder
    session = mood_recorder.session(mood_id)
    assert session is not None
    session.task.cancel()
    await asyncio.sleep(0)
    session.parts = [bytearray()]  # the background task may have stored a chunk already

    session.feed(bytes(CHUNK_BYTES * (BUFFER_SECONDS - 1)))
    too_early = client.get(f"/radio-api/station/{mood_id}/part/1.ogg")
    assert too_early.status_code == 425  # recorded, but the 30-second buffer is not full yet

    session.feed(bytes(CHUNK_BYTES))
    ready = client.get(f"/radio-api/station/{mood_id}/part/1.ogg")
    assert ready.status_code == 200
    assert ready.headers["content-type"].startswith("audio/ogg")

    sent = json.dumps(fake_lyria.sent)
    assert "deszczowy wieczor przy oknie" in sent
    assert "lyria-realtime-exp" in sent


@pytest.mark.anyio
async def test_mood_rolls_over_to_the_next_part_after_ten_minutes(client, fake_lyria: _FakeSocket) -> None:
    created = client.post("/radio-api/mood", json={"prompt": "szybki trans do treningu"}).json()
    mood_id = created["id"]

    from app.main import mood_recorder
    from app.mood import MoodSession
    recorded = mood_recorder.session(mood_id)
    recorded.task.cancel()
    await asyncio.sleep(0)

    fresh = MoodSession("szybki trans do treningu")
    fresh.feed(bytes(CHUNK_BYTES * (PART_SECONDS + BUFFER_SECONDS)))
    print("PUT", mood_id, len(fresh.parts), [len(x) for x in fresh.parts])
    mood_recorder.sessions[mood_id] = fresh
    print("KEYS", list(mood_recorder.sessions))

    first = client.get(f"/radio-api/station/{mood_id}/part/1.ogg")
    second = client.get(f"/radio-api/station/{mood_id}/part/2.ogg")
    assert first.status_code == 200
    assert second.status_code == 200
    assert int.from_bytes(first.content[4:8], "big") == PART_SECONDS * BYTES_PER_SECOND
    assert int.from_bytes(second.content[4:8], "big") > 0


@pytest.mark.anyio
async def test_recording_task_stops_when_cancelled(client, fake_lyria: _FakeSocket) -> None:
    created = client.post("/radio-api/mood", json={"prompt": "cichy wieczor"}).json()
    from app.main import mood_recorder
    session = mood_recorder.session(created["id"])
    session.task.cancel()
    await asyncio.sleep(0.05)
    assert session.task.done()


def test_mood_rejects_an_empty_prompt(client) -> None:
    assert client.post("/radio-api/mood", json={"prompt": "   "}).status_code == 400


def test_unknown_mood_part_is_404(client) -> None:
    assert client.get("/radio-api/station/mood-does-not-exist/part/1.ogg").status_code == 404
