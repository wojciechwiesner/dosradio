"""End-to-end integration test of the wired FastAPI app (`app.main:app`) and group streaming."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "0123456789abcdef0123456789abcdef")
os.environ.setdefault("DOSRADIO_PREWARM", "0")

from app.archive import ArchiveRegistry
from app.stream import build_stream_router, is_intra_session_step

INTEGRATION_ADMIN_TOKEN = "integration-admin-token-0123456789"


def _make_opus(folder: Path, name: str, freq: int = 220) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", f"sine=frequency={freq}:duration=2:sample_rate=48000",
            "-ac", "2", "-c:a", "libopus", "-b:a", "64k", str(folder / name),
        ],
        check=True,
    )


def test_is_intra_session_step_distinguishes_continuous_30s_slices_from_new_sessions():
    t0 = 1_793_879_881_598_884_550
    t1 = t0 + 30_205_842_572  # 30.2s later -> same Lyria take
    t2 = t1 + 180_000_000_000  # 180s later -> different session
    assert is_intra_session_step(t0, t1) is True
    assert is_intra_session_step(t1, t2) is False
    assert is_intra_session_step(None, t0) is False


def test_group_stream_endpoint_emits_valid_ogg_for_group_with_playable_station(tmp_path: Path):
    from fastapi import FastAPI

    reg = ArchiveRegistry(tmp_path / "archive")
    _make_opus(tmp_path / "archive" / "stranger-synth", "seg-1793880000000000000.opus", 220)
    _make_opus(tmp_path / "archive" / "muzyka-filmowa", "seg-1793880100000000000.opus", 330)

    app = FastAPI()
    app.include_router(
        build_stream_router(
            reg,
            require_access=lambda _req: None,
            pace=False,
            group_resolver=lambda gid: ["stranger-synth", "muzyka-filmowa"] if gid == "kino-i-synth" else [],
        )
    )
    with TestClient(app) as client:
        res = client.get("/radio-api/group/kino-i-synth/stream.ogg?seconds=1")
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("audio/ogg")
        assert res.headers["x-dosradio-group"] == "kino-i-synth"
        assert res.content[:4] == b"OggS"

        missing = client.get("/radio-api/group/nie-ma-takiej-grupy/stream.ogg?seconds=1")
        assert missing.status_code == 404


def test_main_app_wires_catalog_ramowka_leads_and_admin_endpoints(monkeypatch):
    # Dedicated admin token: other test modules may already have set DOSRADIO_SECRET at import time.
    monkeypatch.setenv("DOSRADIO_ADMIN_TOKEN", INTEGRATION_ADMIN_TOKEN)
    from app.main import app

    with TestClient(app) as client:
        cat = client.get("/radio-api/catalog")
        assert cat.status_code == 200
        data = cat.json()
        group_ids = {g["id"] for g in data["groups"]}
        station_ids = {s["id"] for s in data["stations"]}
        assert {"fokus-puls", "klub-energia", "synth-filmowa", "klasyka-instrumentalna", "etno-folk", "chill-noc"} <= group_ids
        assert {
            "stranger-synth",
            "muzyka-filmowa",
            "muzyka-klasyczna",
            "instrumentalna-akustyczna",
            "etno-world",
            "slowianski-folk",
        } <= station_ids

        ram = client.get("/radio-api/ramowka/now")
        assert ram.status_code == 200
        ram_json = ram.json()
        assert "station_id" in ram_json
        assert ram_json["news_interval_minutes"] == 20

        lead = client.post(
            "/radio-api/leads/zrobimy",
            json={
                "company": "Alfa Logistyka Sp. z o.o.",
                "contact_name": "Marek Kowalski",
                "phone_or_email": "marek@alfalogistyka.pl",
                "team_size": "25-80",
                "pain_area": "Ręczne przepisywanie faktur i zleceń transportowych",
                "source_spot": "audyt-5-dni",
            },
        )
        assert lead.status_code in (200, 201)
        assert lead.json()["ok"] is True

        # Admin mixer config reflects upgraded 32-beat DJ phrase mix defaults
        adm = client.get("/radio-api/admin/mixer/config", headers={"X-Admin-Token": INTEGRATION_ADMIN_TOKEN})
        assert adm.status_code == 200
        cfg = adm.json()
        assert cfg["crossfade_beats"] == 32
        assert cfg["bass_swap_position"] == 0.5
        assert cfg["equal_power_highs"] is True
