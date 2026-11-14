"""Ramówka aired ledger: auth gate, union merge, per-day isolation, 500-id cap. Offline, temp SQLite."""
from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.aired import MAX_IDS_PER_DAY, build_aired_router
from app.auth import SESSION_COOKIE, token_hash
from app.db import Database

DAY = "2026-11-07"


@pytest.fixture()
def db(tmp_path) -> Database:
    return Database(tmp_path / "aired.db")


@pytest.fixture()
def client(db) -> TestClient:
    app = FastAPI()
    app.include_router(build_aired_router(db))
    return TestClient(app)


def signed_in(db: Database, client: TestClient, email: str = "a@example.com", verified: bool = True) -> int:
    user_id = db.create_user(email, "hash")
    if not verified:
        db.set_email_verification(user_id, "pending-token", time.time() + 3600)
    token = f"session-{user_id}"
    db.create_session(token_hash(token), user_id)
    client.cookies.set(SESSION_COOKIE, token)
    return user_id


def test_anonymous_listener_is_refused(client):
    assert client.get("/radio-api/aired", params={"day": DAY}).status_code == 401
    assert client.post("/radio-api/aired", json={"day": DAY, "ids": ["a1"]}).status_code == 401


def test_unverified_account_is_refused(db, client):
    signed_in(db, client, verified=False)
    assert client.get("/radio-api/aired", params={"day": DAY}).status_code == 401


def test_post_merges_with_stored_ids_as_union(db, client):
    signed_in(db, client)
    first = client.post("/radio-api/aired", json={"day": DAY, "ids": ["a1", "b2"]})
    second = client.post("/radio-api/aired", json={"day": DAY, "ids": ["b2", "c3"]})
    assert first.json() == {"day": DAY, "ids": ["a1", "b2"]}
    assert second.json() == {"day": DAY, "ids": ["a1", "b2", "c3"]}
    assert client.get("/radio-api/aired", params={"day": DAY}).json() == {"day": DAY, "ids": ["a1", "b2", "c3"]}


def test_ids_are_isolated_per_day_and_per_listener(db, client):
    signed_in(db, client, "a@example.com")
    client.post("/radio-api/aired", json={"day": DAY, "ids": ["a1"]})
    assert client.get("/radio-api/aired", params={"day": "2026-11-08"}).json()["ids"] == []

    other = TestClient(client.app)
    signed_in(db, other, "b@example.com")
    assert other.get("/radio-api/aired", params={"day": DAY}).json()["ids"] == []


def test_merge_over_daily_cap_is_rejected(db, client):
    signed_in(db, client)
    full_day = [f"s{index:04d}" for index in range(MAX_IDS_PER_DAY)]
    assert client.post("/radio-api/aired", json={"day": DAY, "ids": full_day}).status_code == 200
    response = client.post("/radio-api/aired", json={"day": DAY, "ids": ["extra"]})
    assert response.status_code == 400


def test_bad_day_and_bad_item_id_are_rejected(db, client):
    signed_in(db, client)
    assert client.get("/radio-api/aired", params={"day": "2026-13-01"}).status_code == 400
    assert client.post("/radio-api/aired", json={"day": "07-11-2026", "ids": []}).status_code == 422
    assert client.post("/radio-api/aired", json={"day": DAY, "ids": ["has space"]}).status_code == 422
