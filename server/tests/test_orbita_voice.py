from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.orbita_voice import build_orbita_voice_router, prewarm_orbita_voice


def _fake_wav(tag: str) -> bytes:
    payload = tag.encode("utf-8")
    return b"RIFF" + b"\x00" * 40 + payload


def _make_app(tmp_path: Path, calls: list[tuple[str, str, str]]) -> TestClient:
    async def speak(text: str, voice: str, style: str) -> bytes:
        calls.append((text, voice, style))
        return _fake_wav(f"{voice}:{text[:20]}")

    app = FastAPI()
    app.include_router(build_orbita_voice_router(speak, tmp_path))
    return TestClient(app)


def test_orbita_intro_renders_kuba_and_caches_on_disk(tmp_path: Path) -> None:
    calls: list[tuple[str, str, str]] = []
    client = _make_app(tmp_path, calls)

    res = client.get("/radio-api/orbita/intro/dos-groove/0.wav?lang=pl")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("audio/wav")
    assert any(voice == "Orus" and "Cześć, tu Kuba." in text for text, voice, _ in calls)

    wav_files = list((tmp_path / "orbita").glob("intro-pl-dos-groove-0-*.wav"))
    assert len(wav_files) == 1
    assert wav_files[0].stat().st_size > 44

    count_after_first = len([c for c in calls if "Cześć, tu Kuba." in c[0]])
    res2 = client.get("/radio-api/orbita/intro/dos-groove/0.wav?lang=pl")
    assert res2.status_code == 200
    count_after_second = len([c for c in calls if "Cześć, tu Kuba." in c[0]])
    assert count_after_second == count_after_first == 1


def test_orbita_intro_404_on_invalid_station_or_index(tmp_path: Path) -> None:
    client = _make_app(tmp_path, [])
    assert client.get("/radio-api/orbita/intro/no-such-station/0.wav").status_code == 404
    assert client.get("/radio-api/orbita/intro/dos-groove/9.wav").status_code == 404
    assert client.get("/radio-api/orbita/intro/dos-groove/-1.wav").status_code == 404


def test_showcase_manifest_and_duet_voices(tmp_path: Path) -> None:
    calls: list[tuple[str, str, str]] = []
    client = _make_app(tmp_path, calls)

    manifest = client.get("/radio-api/showcase?lang=pl")
    assert manifest.status_code == 200
    data = manifest.json()
    assert "podcast" in data and "stoic" in data

    pod_parts = data["podcast"]["parts"]
    assert pod_parts[0]["kind"] == "voice"
    assert pod_parts[0]["who"] == "A"
    assert "Tu Kuba" in pod_parts[0]["text"]
    assert pod_parts[0]["url"] == "/radio-api/showcase/podcast/0.wav?lang=pl"
    assert any(p["kind"] == "music" and p["sec"] == 5 for p in pod_parts)

    r_a = client.get(pod_parts[0]["url"])
    r_b = client.get(pod_parts[1]["url"])
    assert r_a.status_code == 200
    assert r_b.status_code == 200
    assert any(v == "Orus" and "Tu Kuba" in t for t, v, _ in calls)
    assert any(v == "Achernar" and "playlista" in t for t, v, _ in calls)

    stoic_a = client.get("/radio-api/showcase/stoic/0.wav?lang=en")
    assert stoic_a.status_code == 200
    assert any(v == "Sadaltager" and "stoic pill" in t for t, v, _ in calls)


def test_orbita_nudge_endpoint(tmp_path: Path) -> None:
    calls: list[tuple[str, str, str]] = []
    client = _make_app(tmp_path, calls)

    ok = client.get("/radio-api/orbita/nudge/5min.wav?station=dos-groove&lang=pl")
    assert ok.status_code == 200
    assert any(v == "Orus" and "pięć minut" in t for t, v, _ in calls)
    assert client.get("/radio-api/orbita/nudge/unknown.wav").status_code == 404


def test_prewarm_orbita_voice_populates_cache(tmp_path: Path) -> None:
    import asyncio

    calls: list[tuple[str, str, str]] = []

    async def speak(text: str, voice: str, style: str) -> bytes:
        calls.append((text, voice, style))
        return _fake_wav(voice)

    asyncio.run(prewarm_orbita_voice(speak, tmp_path))
    generated = list((tmp_path / "orbita").glob("*.wav"))
    assert len(generated) == 4 + 12 + 4
