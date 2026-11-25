"""Presence heartbeats: the shapes old and new Classic/Orbita builds actually send must land in the stats."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auto_ramowka import RamowkaService, build_ramowka_router
from app.catalog import CatalogService
from app.db import Database
from app.telemetry import TelemetryService


@pytest.fixture()
def env(tmp_path: Path):
    db = Database(tmp_path / "presence.db")
    catalog = CatalogService(db)
    telemetry = TelemetryService(db)
    app = FastAPI()
    app.include_router(
        build_ramowka_router(
            db=db,
            catalog=catalog,
            telemetry=telemetry,
            gemini=None,
            data_dir=tmp_path,
            ramowka_service=RamowkaService(db, catalog, data_dir=tmp_path),
        )
    )
    client = TestClient(app)
    client.db = db  # type: ignore[attr-defined]
    return client, telemetry


def test_old_classic_js_shape_is_counted(env) -> None:
    client, telemetry = env
    # Literal body of the Classic heartbeat before the fix (src/ui/dosradio.ts).
    r = client.post(
        "/radio-api/presence",
        json={"client_id": "cli-abc123-xyz", "station": "berlin-bcco-techno", "group": "techno-rave",
              "view": "classic", "ramowka": True},
    )
    assert r.status_code == 200
    active = telemetry.active_listeners()
    assert active["by_station"] == {"berlin-bcco-techno": 1}
    assert active["by_view"]["classic"] == 1
    assert active["ramowka_listeners"] == 1
    assert active["listeners"][0]["actor_key"] == "cid:cli-abc123-xyz"


def test_old_orbita_js_shape_is_counted(env) -> None:
    client, telemetry = env
    # Literal body of the Orbita heartbeat before the fix (orbita/src/main.js), no client id at all.
    r = client.post(
        "/radio-api/presence",
        json={"station": "stranger-synth", "group": "retro", "view": "orbita", "auto_ramowka": False},
    )
    assert r.status_code == 200
    active = telemetry.active_listeners()
    assert active["by_station"] == {"stranger-synth": 1}
    assert active["by_view"]["orbita"] == 1
    assert active["by_view"]["classic"] == 0


def test_new_canonical_shape_is_counted(env) -> None:
    client, telemetry = env
    r = client.post(
        "/radio-api/presence",
        json={"client_id": "cli-new", "station_id": "muzyka-klasyczna", "group_id": None,
              "view_mode": "orbita", "ramowka": True},
    )
    assert r.status_code == 200
    active = telemetry.active_listeners()
    assert active["by_station"] == {"muzyka-klasyczna": 1}
    assert active["by_view"]["orbita"] == 1
    assert active["ramowka_listeners"] == 1


def test_two_client_ids_behind_one_ip_are_two_listeners(env) -> None:
    client, telemetry = env
    for cid in ("cli-tab-a", "cli-tab-b"):
        assert client.post(
            "/radio-api/presence",
            json={"client_id": cid, "station_id": "dos-groove", "view_mode": "classic"},
        ).status_code == 200
    # Same client id again (second heartbeat) must not add a row.
    client.post("/radio-api/presence", json={"client_id": "cli-tab-a", "station_id": "dos-groove"})
    active = telemetry.active_listeners()
    assert active["active_now"] == 2
    assert active["by_station"] == {"dos-groove": 2}


def test_unknown_field_is_rejected_and_unknown_view_normalised(env) -> None:
    client, telemetry = env
    assert client.post("/radio-api/presence", json={"client_id": "x", "statoin": "typo"}).status_code == 422
    assert client.post(
        "/radio-api/presence", json={"client_id": "y", "station_id": "dos-groove", "view_mode": "kiosk"}
    ).status_code == 200
    assert telemetry.active_listeners()["by_view"]["classic"] == 1


def test_session_cookie_is_not_stored_raw(env) -> None:
    client, telemetry = env
    client.cookies.set("dr_session", "secret-session-token")
    client.post("/radio-api/presence", json={"station_id": "dos-groove"})
    key = telemetry.active_listeners()["listeners"][0]["actor_key"]
    assert key.startswith("sess:") and "secret-session-token" not in key


def test_listener_identity_comes_from_session_not_from_the_page(env) -> None:
    from app.auth import token_hash

    client, telemetry = env
    db = client.db
    uid = db.create_user("anna@example.com", "x")
    db.create_session(token_hash("real-session"), uid)
    client.cookies.set("dr_session", "real-session")
    client.post("/radio-api/presence", json={"client_id": "c1", "station_id": "dos-groove", "email": "spoof@evil.test"})
    row = telemetry.active_listeners()["listeners"][0]
    assert row["email"] == "anna@example.com" and row["user_id"] == uid
