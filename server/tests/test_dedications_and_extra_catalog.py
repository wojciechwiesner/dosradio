"""Tests for Techno & Rave + B2B Spaces catalog expansion, dedications API, and admin prompt edits."""

from __future__ import annotations

import wave
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.catalog import CatalogService
from app.db import Database
from app.dedications import build_dedications_router
from app.hosts import BORROWED_HOSTS, HOSTS
from app.orbita_scripts import intro_lines
from app.recorder import STATION_SPECS


def _fake_wav_bytes() -> bytes:
    buf = BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(b"\x00\x00" * 2400)
    return buf.getvalue()


def test_extra_techno_and_b2b_stations_present_everywhere(tmp_path: Path) -> None:
    store = CatalogService(Database(tmp_path / "dosradio.db"))
    pub = store.public_catalog()
    group_ids = {g["id"] for g in pub["groups"]}
    station_ids = {s["id"] for s in pub["stations"]}

    assert "techno-rave" in group_ids
    assert "przestrzenie-b2b" in group_ids

    expected_techno = {
        "berlin-bcco-techno",
        "raw-techno",
        "hypnotic-techno",
        "etno-techno",
        "tribal-techno",
        "goa-trance",
        "hard-dance",
        "tekk",
    }
    expected_b2b = {"salon-beauty-spa", "lobby-hotelowe", "poczekalnia"}

    assert expected_techno.issubset(station_ids)
    assert expected_b2b.issubset(station_ids)

    for sid in expected_techno | expected_b2b:
        assert sid in STATION_SPECS, f"Missing Lyria spec for {sid}"
        assert sid in HOSTS or sid in BORROWED_HOSTS, f"Missing host mapping for {sid}"


def test_admin_prompt_update_reflects_in_active_specs(tmp_path: Path) -> None:
    store = CatalogService(Database(tmp_path / "dosradio.db"))
    updated = store.update_station(
        "berlin-bcco-techno",
        {"prompt": "Custom Berlin BCCO 142 BPM vinyl dub stabs, sidechained kick, instrumental"},
    )
    assert "142 BPM" in updated["prompt"]
    specs = store.active_specs()
    assert specs["berlin-bcco-techno"]["prompt"] == updated["prompt"]


def test_orbita_welcome_line_four_mentions_free_hour_and_registration() -> None:
    lines_pl = intro_lines("dos-groove", "pl")
    assert len(lines_pl) == 4
    assert "Pierwsza godzina jest za darmo" in lines_pl[3]
    assert "twoja muzyka, twoje zasady, twój styl" in lines_pl[3]


def test_dedications_create_get_and_synthesise_greeting(tmp_path: Path) -> None:
    spoken_calls: list[tuple[str, str]] = []

    async def fake_speak(text: str, voice: str = "Orus", style: str = "") -> bytes:
        spoken_calls.append((text, voice))
        return _fake_wav_bytes()

    store = CatalogService(Database(tmp_path / "dosradio.db"))
    app = FastAPI()
    app.include_router(
        build_dedications_router(
            speak=fake_speak,
            audio_dir=tmp_path / "audio",
            db_path=tmp_path / "dosradio.db",
            station_lookup=lambda sid: next(
                (s for s in store.public_catalog()["stations"] if s["id"] == sid), None
            ),
        )
    )
    client = TestClient(app)

    res = client.post(
        "/radio-api/dedications",
        json={
            "station_id": "salon-beauty-spa",
            "to_name": "Klaudia",
            "from_name": "Wojtek",
            "message": "Cudownego dnia w salonie i samych uśmiechniętych klientek!",
            "lang": "pl",
        },
    )
    assert res.status_code in (200, 201), res.text
    data = res.json()
    assert data["to_name"] == "Klaudia"
    assert data["from_name"] == "Wojtek"
    assert "Klaudia" in data["script"]
    assert "Wojtek" in data["script"]
    assert data["share_url"].startswith("/orbita.html?d=")

    get_res = client.get(f"/radio-api/dedications/{data['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["station_id"] == "salon-beauty-spa"

    wav_res = client.get(data["audio_url"])
    assert wav_res.status_code == 200
    assert wav_res.headers["content-type"].startswith("audio/wav")
    assert wav_res.content[:4] == b"RIFF"
    assert len(spoken_calls) == 1

    # Second call serves from deterministic disk cache without re-invoking TTS
    wav_res_cached = client.get(data["audio_url"])
    assert wav_res_cached.status_code == 200
    assert len(spoken_calls) == 1


def test_polish_dedication_script_keeps_sender_name_uninflected() -> None:
    from app.dedications import build_dedication_script

    script = build_dedication_script(host_name="Kuba", station_name="Ambi Groove", to_name="Ola",
                                     from_name="Wojtek", message="Sto lat!", lang="pl")
    assert "od Wojtek" not in script
    assert "Wojtek przesyła ci gorące pozdrowienia" in script
