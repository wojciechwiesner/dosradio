"""Comprehensive tests for Catalog, Telemetry, Auto-Ramówka, and Admin API."""
from __future__ import annotations

import base64
import io
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admin_api import build_admin_router
from app.archive import ArchiveRegistry
from app.auth import AccessService, hash_password
from app.auto_ramowka import RamowkaService, build_ramowka_router
from app.catalog import CatalogService
from app.db import Database
from app.mixer import RATE, float_to_pcm
from app.news import pcm_to_wav
from app.telemetry import TelemetryService


class FakeGemini:
    tts_model = "gemini-3.8-flash-tts"

    async def speak(self, text: str, voice: str = "Orus", style: str = "") -> bytes:
        pcm = (np.zeros(24000, dtype=np.int16)).tobytes()
        return pcm_to_wav(pcm, rate=24000)


class DummyRecorder:
    current_station = "stranger-synth"
    total_recorded_segments = 12


@pytest.fixture()
def env_setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DOSRADIO_ADMIN_TOKEN", "test-secret-admin-token-12345")
    monkeypatch.setenv("DOSRADIO_ADMIN_EMAILS", "wojciech@theones.io")
    db = Database(tmp_path / "test_dosradio.db")
    archives = ArchiveRegistry(tmp_path / "archive")
    catalog = CatalogService(db, archives=archives)
    telemetry = TelemetryService(db)
    ramowka = RamowkaService(db, catalog, data_dir=tmp_path)
    access = AccessService(db, secret="s" * 40, trial_seconds=3600)
    gemini = FakeGemini()
    recorder = DummyRecorder()

    app = FastAPI()
    app.include_router(
        build_ramowka_router(
            db=db,
            catalog=catalog,
            telemetry=telemetry,
            gemini=gemini,
            data_dir=tmp_path,
            ramowka_service=ramowka,
        )
    )
    app.include_router(
        build_admin_router(
            db=db,
            access=access,
            archives=archives,
            catalog=catalog,
            telemetry=telemetry,
            ramowka_service=ramowka,
            recorder=recorder,
        )
    )
    client = TestClient(app)
    return {
        "tmp_path": tmp_path,
        "db": db,
        "archives": archives,
        "catalog": catalog,
        "telemetry": telemetry,
        "ramowka": ramowka,
        "access": access,
        "client": client,
        "headers": {"X-Admin-Token": "test-secret-admin-token-12345"},
    }


def _make_opus_kick_segment(bpm: float = 124.0, seconds: float = 8.0) -> bytes:
    frames = int(seconds * RATE)
    period = 60.0 / bpm
    mono = np.zeros(frames, dtype=np.float32)
    burst_t = np.arange(int(0.12 * RATE)) / RATE
    burst = (0.6 * np.sin(2 * np.pi * 58.0 * burst_t) * np.exp(-burst_t * 25.0)).astype(np.float32)
    t = 0.15
    while t < seconds - 0.2:
        idx = int(t * RATE)
        mono[idx : idx + len(burst)] += burst
        t += period
    stereo = np.stack([mono, mono], axis=1)
    pcm = float_to_pcm(stereo)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        str(RATE),
        "-ac",
        "2",
        "-i",
        "pipe:0",
        "-c:a",
        "libopus",
        "-b:a",
        "96k",
        "-f",
        "ogg",
        "pipe:1",
    ]
    proc = subprocess.run(cmd, input=pcm, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    assert proc.returncode == 0 and proc.stdout
    return proc.stdout


def test_catalog_seeding_disable_and_custom_station(env_setup):
    catalog: CatalogService = env_setup["catalog"]
    pub = catalog.public_catalog()

    assert len(pub["groups"]) == 8
    assert len(pub["stations"]) >= 42

    station_ids = {s["id"] for s in pub["stations"]}
    required_new = {
        "stranger-synth",
        "muzyka-filmowa",
        "cyber-noir",
        "muzyka-klasyczna",
        "instrumentalna-akustyczna",
        "etno-world",
        "slowianski-folk",
    }
    assert required_new.issubset(station_ids)

    # Disabling a station removes it from public_catalog() and active_specs() while keeping it in admin list
    catalog.update_station("stranger-synth", {"enabled": False})
    pub_after = catalog.public_catalog()
    specs_after = catalog.active_specs()
    admin_all = catalog.list_stations(include_disabled=True)

    assert "stranger-synth" not in {s["id"] for s in pub_after["stations"]}
    assert "stranger-synth" not in specs_after
    assert "stranger-synth" in {s["id"] for s in admin_all}

    # Re-enable
    catalog.update_station("stranger-synth", enabled=True)
    assert "stranger-synth" in catalog.active_specs()

    # Adding a custom station clamps BPM/density/brightness and validates slug
    custom = catalog.upsert_station(
        {
            "id": "custom-synth-test",
            "group_id": "synth-filmowa",
            "name": "Custom Synth Test",
            "tagline": "Testowy syntezator",
            "prompt": "analog synth arpeggio, warm bass, instrumental",
            "bpm": 240,  # clamped to 190
            "density": 0.01,  # clamped to 0.05
            "brightness": 0.99,  # clamped to 0.95
            "category": "noc",
            "host": "Wiktor",
        }
    )
    assert custom["bpm"] == 190
    assert custom["density"] == 0.05
    assert custom["brightness"] == 0.95
    assert custom["is_builtin"] is False

    with pytest.raises(ValueError):
        catalog.upsert_station(
            {
                "id": "INVALID SLUG!",
                "group_id": "synth-filmowa",
                "name": "Bad",
                "prompt": "instrumental",
            }
        )

    # Deleting custom station removes it completely
    del_res = catalog.delete_station("custom-synth-test")
    assert del_res["deleted"] is True
    assert catalog.get_station("custom-synth-test") is None


def test_telemetry_tokens_and_summary(env_setup):
    telemetry: TelemetryService = env_setup["telemetry"]

    telemetry.record_tokens(
        model="gemini-3.8-flash",
        feature="news",
        prompt_tokens=10_000,
        output_tokens=2_000,
    )
    telemetry.record_tokens(
        model="gemini-3.8-flash-tts",
        feature="tts",
        prompt_tokens=1_000,
        output_tokens=4_000,
        audio_seconds=12.5,
    )
    telemetry.record_tokens(
        model="models/lyria-realtime-exp",
        feature="lyria",
        prompt_tokens=200,
        output_tokens=0,
        audio_seconds=180.0,
    )

    summary = telemetry.token_summary(days=30)
    t24 = summary["totals_24h"]
    t30 = summary["totals_30d"]

    assert t24["calls"] == 3
    assert t24["prompt_tokens"] == 11_200
    assert t24["output_tokens"] == 6_000
    assert t24["total_tokens"] == 17_200
    assert t24["audio_seconds"] == pytest.approx(192.5, rel=1e-2)
    assert t24["estimated_cost_usd"] > 0.18  # 3 min of Lyria alone is $0.18
    assert t30["total_tokens"] == 17_200
    assert {f["feature"] for f in summary["by_feature"]} == {"news", "tts", "lyria"}
    assert len(summary["daily"]) >= 1


def test_presence_heartbeats_classic_orbita_ramowka(env_setup):
    client: TestClient = env_setup["client"]
    telemetry: TelemetryService = env_setup["telemetry"]

    r1 = client.post(
        "/radio-api/presence",
        json={
            "actor_key": "listener-1",
            "station_id": "stranger-synth",
            "view_mode": "orbita",
            "ramowka": True,
            "email": "anna@example.com",
        },
    )
    assert r1.status_code == 200 and r1.json()["ok"] is True

    r2 = client.post(
        "/radio-api/presence",
        json={
            "actor_key": "listener-2",
            "station_id": "muzyka-klasyczna",
            "view_mode": "classic",
            "ramowka": False,
        },
    )
    assert r2.status_code == 200

    active = telemetry.active_listeners()
    assert active["active_now"] == 2
    assert active["active_24h"] == 2
    assert active["by_view"]["orbita"] == 1
    assert active["by_view"]["classic"] == 1
    assert active["ramowka_listeners"] == 1
    assert active["by_station"]["stranger-synth"] == 1
    assert active["by_station"]["muzyka-klasyczna"] == 1


def test_auto_ramowka_state_spots_and_zrobimy_leads(env_setup):
    client: TestClient = env_setup["client"]

    state_res = client.get("/radio-api/ramowka/state")
    assert state_res.status_code == 200
    state = state_res.json()
    assert state["news_interval_minutes"] == 20
    assert len(state["hourly_schedule"]) == 24
    assert state["active_spot"] is not None
    assert "zrobi.my" in state["active_spot"]["cta_url"]
    assert state["featured_podcast_topic"]["hosts"] == ["Ania", "Michał"]

    spots_res = client.get("/radio-api/ramowka/spots")
    assert spots_res.status_code == 200
    spots = spots_res.json()
    assert len(spots) == 8

    # Render spot audio WAV once and verify caching
    first_spot_id = spots[0]["id"]
    wav_res = client.get(f"/radio-api/ramowka/spot/{first_spot_id}.wav")
    assert wav_res.status_code == 200
    assert wav_res.headers["content-type"].startswith("audio/wav")
    assert wav_res.content[:4] == b"RIFF"

    # OPTIONS preflight + POST lead for zrobi.my with CORS headers
    opt_res = client.options("/radio-api/leads/zrobimy")
    assert opt_res.status_code == 204
    assert opt_res.headers.get("access-control-allow-origin") == "*"

    lead_res = client.post(
        "/radio-api/leads/zrobimy",
        json={
            "company": "Meble Kowalski Sp. z o.o.",
            "contact_name": "Jan Kowalski",
            "contact": "jan@meblekowalski.pl",
            "industry": "Produkcja mebli",
            "team_size": "25-50",
            "pain_point": "Ręczne przepisywanie zapytań ofertowych z maili do arkusza wycen",
            "source_spot": "zrobimy-wyceny-b2b",
            "notes": "Proszę o kontakt po 14:00",
        },
    )
    assert lead_res.status_code == 201
    assert lead_res.headers.get("access-control-allow-origin") == "*"
    payload = lead_res.json()
    assert payload["ok"] is True
    assert payload["lead"]["company"] == "Meble Kowalski Sp. z o.o."
    assert payload["lead"]["status"] == "new"


def test_admin_password_login_requires_verified_email_and_uses_session(env_setup):
    client = env_setup["client"]
    client.base_url = "https://testserver"
    db = env_setup["db"]
    credentials = {"email": "wojciech@theones.io", "password": "test-password-123"}
    uid = db.create_user(credentials["email"], hash_password(credentials["password"]))
    db.set_email_verification(uid, "test-email-token-hash", 4_000_000_000)

    rejected = client.post("/radio-api/admin/login", json=credentials)
    assert rejected.status_code == 403
    assert "set-cookie" not in rejected.headers
    assert client.get("/radio-api/admin/overview").status_code == 401

    db.verify_email(uid)
    accepted = client.post("/radio-api/admin/login", json=credentials)
    assert accepted.status_code == 200
    assert "token" not in accepted.json()
    assert "HttpOnly" in accepted.headers["set-cookie"]
    assert client.get("/radio-api/admin/overview").status_code == 200


def test_admin_auth_tracks_mixer_preview_and_management(env_setup):
    client: TestClient = env_setup["client"]
    headers: dict[str, str] = env_setup["headers"]
    archives: ArchiveRegistry = env_setup["archives"]
    db: Database = env_setup["db"]

    # 1. Unauthenticated or bad token requests are rejected with 401/403
    assert client.get("/radio-api/admin/overview").status_code in (401, 403)
    assert (
        client.get("/radio-api/admin/overview", headers={"X-Admin-Token": "wrong-token"}).status_code
        in (401, 403)
    )

    # Admin login with token works
    login_ok = client.post("/radio-api/admin/login", json={"token": headers["X-Admin-Token"]})
    assert login_ok.status_code == 200 and login_ok.json()["admin"] is True

    # Create a normal user and verify admin endpoints allow user management
    uid = db.create_user("sluchacz@example.com", hash_password("haslo12345"))
    users_res = client.get("/radio-api/admin/users", headers=headers)
    assert users_res.status_code == 200
    assert any(u["email"] == "sluchacz@example.com" for u in users_res.json()["users"])

    patch_user_res = client.patch(
        f"/radio-api/admin/users/{uid}",
        headers=headers,
        json={"plan": "plus", "plus_days": 30, "email_verified": True},
    )
    assert patch_user_res.status_code == 200
    assert patch_user_res.json()["user"]["plan"] == "plus"

    # Admin catalog updates
    cat_patch = client.patch(
        "/radio-api/admin/catalog/stations/muzyka-filmowa",
        headers=headers,
        json={"bpm": 82, "tagline": "Nowa szeroka przestrzeń kinowa"},
    )
    assert cat_patch.status_code == 200
    assert cat_patch.json()["station"]["bpm"] == 82

    # 2. Record two synthetic Opus segments and test track listing + WAV mixer preview
    if shutil.which("ffmpeg") is not None:
        arch = archives.get("dos-groove")
        seg1 = arch.add_segment(_make_opus_kick_segment(bpm=124.0, seconds=8.0))
        seg2 = arch.add_segment(_make_opus_kick_segment(bpm=124.0, seconds=8.0))

        tracks_res = client.get("/radio-api/admin/tracks?station_id=dos-groove", headers=headers)
        assert tracks_res.status_code == 200
        tracks = tracks_res.json()["tracks"]
        assert len(tracks) == 2
        assert {t["filename"] for t in tracks} == {seg1.name, seg2.name}

        # Path traversal guard
        bad_audio = client.get("/radio-api/admin/tracks/dos-groove/..%2Fdosradio.db/audio", headers=headers)
        assert bad_audio.status_code in (400, 404)

        good_audio = client.get(f"/radio-api/admin/tracks/dos-groove/{seg1.name}/audio", headers=headers)
        assert good_audio.status_code == 200
        assert good_audio.headers["content-type"].startswith("audio/ogg")

        # Mixer seam preview
        preview_res = client.post(
            "/radio-api/admin/mixer/preview",
            headers=headers,
            json={
                "station_a": "dos-groove",
                "segment_a": seg1.name,
                "station_b": "dos-groove",
                "segment_b": seg2.name,
                "crossfade_beats": 4,
                "fallback_fade_seconds": 0.5,
                "tempo_lock": True,
                "context_seconds": 3.0,
            },
        )
        assert preview_res.status_code == 200
        prev = preview_res.json()
        assert prev["ok"] is True
        assert len(prev["envelope_db"]) == 60
        assert isinstance(prev["peak_db"], float)
        wav_raw = base64.b64decode(prev["audio_wav_base64"])
        with wave.open(io.BytesIO(wav_raw), "rb") as w:
            assert w.getframerate() == RATE
            assert w.getnchannels() == 2
            assert w.getnframes() > RATE
