"""A Lyria session records a fixed short run of segments with a slightly varied temperature."""
from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
import websockets

from app import recorder
from app.archive import ArchiveRegistry
from app.recorder import STATION_SPECS, StationRecorder, session_temperature

CHUNK_BYTES = 8


class _FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self._chunk = base64.b64encode(bytes(CHUNK_BYTES)).decode()

    async def __aenter__(self) -> "_FakeSocket":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    async def send(self, message: str) -> None:
        self.sent.append(json.loads(message))

    async def recv(self) -> str:
        return json.dumps({"serverContent": {"audioChunks": [{"data": self._chunk}]}})


@pytest.fixture
def fake_lyria(monkeypatch: pytest.MonkeyPatch) -> _FakeSocket:
    socket = _FakeSocket()
    monkeypatch.setattr(websockets, "connect", lambda url, **kwargs: socket)
    monkeypatch.setattr(recorder, "TARGET_CHUNK_BYTES", CHUNK_BYTES)
    monkeypatch.setattr(recorder, "encode_pcm_to_opus", lambda pcm: pcm)
    return socket


@pytest.mark.anyio
async def test_session_records_fixed_number_of_segments(tmp_path: Path, fake_lyria: _FakeSocket) -> None:
    station = StationRecorder("test-key", ArchiveRegistry(tmp_path))
    station.running = True
    await station.record_session("dos-groove", STATION_SPECS["dos-groove"])
    segments = station.archives.get("dos-groove").list_segments()
    assert len(segments) == recorder.SEGMENTS_PER_SESSION == 2


@pytest.mark.anyio
async def test_session_sends_a_jittered_temperature(tmp_path: Path, fake_lyria: _FakeSocket) -> None:
    station = StationRecorder("test-key", ArchiveRegistry(tmp_path))
    station.running = True
    await station.record_session("dos-groove", STATION_SPECS["dos-groove"])
    config = next(msg["musicGenerationConfig"] for msg in fake_lyria.sent if "musicGenerationConfig" in msg)
    assert abs(config["temperature"] - recorder.BASE_TEMPERATURE) <= recorder.TEMPERATURE_JITTER


def test_session_temperature_varies_between_sessions() -> None:
    values = [session_temperature() for _ in range(50)]
    assert len(set(values)) > 1
    assert all(
        abs(value - recorder.BASE_TEMPERATURE) <= recorder.TEMPERATURE_JITTER for value in values
    )
