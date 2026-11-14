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
    fades = []
    def encode(pcm, fade_in=False, fade_out=False):
        fades.append((fade_in, fade_out))
        return pcm
    monkeypatch.setattr(recorder, "encode_pcm_to_opus", encode)
    socket.fades = fades
    return socket


@pytest.mark.anyio
async def test_session_records_without_edge_fades_for_the_mix_engine(tmp_path: Path, fake_lyria: _FakeSocket) -> None:
    """Recordings must have no edge volume dips so the live mix engine gets intact kicks and audio."""
    archives = ArchiveRegistry(tmp_path)
    rec = StationRecorder("test-key", archives)
    rec.running = True
    await rec.record_session("dos-groove", STATION_SPECS["dos-groove"], num_segments=2)
    assert fake_lyria.fades == [(False, False), (False, False)]


@pytest.mark.anyio
async def test_a_session_records_three_minutes(tmp_path: Path, fake_lyria: _FakeSocket) -> None:
    """A session runs for minutes, not one minute, so fewer seams need mixing."""
    archives = ArchiveRegistry(tmp_path)
    rec = StationRecorder("test-key", archives)
    rec.running = True
    await rec.record_session("dos-groove", STATION_SPECS["dos-groove"])
    saved = rec.archives.get("dos-groove").list_segments()
    assert len(saved) == recorder.SEGMENTS_PER_SESSION
    assert recorder.SEGMENTS_PER_SESSION * recorder.TARGET_SEGMENT_SECONDS >= 180


@pytest.mark.anyio
async def test_session_records_fixed_number_of_segments(tmp_path: Path, fake_lyria: _FakeSocket) -> None:
    station = StationRecorder("test-key", ArchiveRegistry(tmp_path))
    station.running = True
    await station.record_session("dos-groove", STATION_SPECS["dos-groove"])
    segments = station.archives.get("dos-groove").list_segments()
    assert len(segments) == recorder.SEGMENTS_PER_SESSION


@pytest.mark.anyio
async def test_a_second_genre_goes_out_as_its_own_weighted_prompt(tmp_path: Path, fake_lyria: _FakeSocket) -> None:
    """Lyria blends two genres only when each is its own weighted prompt."""
    rec = StationRecorder("test-key", ArchiveRegistry(tmp_path))
    rec.running = True
    spec = {**STATION_SPECS["dos-groove"], "blend": "dub techno, deep echoing chords, instrumental"}
    await rec.record_session("dos-groove", spec, num_segments=1)
    prompts = next(msg["clientContent"]["weightedPrompts"] for msg in fake_lyria.sent if "clientContent" in msg)
    texts = [item["text"] for item in prompts]
    assert spec["blend"] in texts
    assert spec["prompt"] in texts


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
        abs(value - recorder.BASE_TEMPERATURE) <= recorder.TEMPERATURE_JITTER + 1e-9 for value in values
    )  # 1.0 + 0.05 - 1.0 is 0.05000000000000004 in floating point


def test_fade_in_is_applied_before_encoding(monkeypatch):
    from app import recorder
    seen = {}

    def fake_popen(cmd, **kwargs):
        seen["cmd"] = cmd
        class Proc:
            returncode = 0
            def communicate(self, data):
                return b"OggS", b""
        return Proc()

    monkeypatch.setattr(recorder.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(recorder, "tone_notch_chain", lambda *a, **k: "")
    recorder.encode_pcm_to_opus(b"\x00" * 64, fade_in=True)
    assert "afade=t=in:d=0.5" in seen["cmd"]
