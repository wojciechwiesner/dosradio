"""Welcome Plus: a verified free account gets 30 days of Plus, paid plans are never changed. No network."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "x" * 40)
os.environ["DOSRADIO_PREWARM"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

EMAIL = "ewa@example.com"
PASSWORD = "dlugiehaslo1"
SECONDS_PER_DAY = 86400
WELCOME_DAYS = 30
TOLERANCE_S = 60


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, base_url="https://testserver")


@pytest.fixture()
def captured_emails(monkeypatch):
    """Collect verification e-mails instead of sending them over SMTP."""
    sent: list[tuple[str, str]] = []  # (recipient, verification link)
    from app import mailer

    def fake_send(to_email: str, token: str) -> None:
        sent.append((to_email, f"{mailer.SITE_URL}/?verify={token}"))

    monkeypatch.setattr(mailer, "send_verification_email", fake_send)
    return sent


def verify_latest(client, captured_emails) -> int:
    token = captured_emails[-1][1].split("verify=")[1]
    return client.post("/radio-api/verify", json={"token": token}).status_code


def plan_row(email: str):
    from app.main import db
    with db.connect() as conn:
        return conn.execute("SELECT plan, plus_until FROM users WHERE email = ?", (email,)).fetchone()


def test_verified_free_account_gets_thirty_days_of_plus(client, captured_emails):
    client.post("/radio-api/register", json={"email": EMAIL, "password": PASSWORD})
    before = time.time()
    assert verify_latest(client, captured_emails) == 200

    row = plan_row(EMAIL)
    assert row["plan"] == "plus"
    expected = WELCOME_DAYS * SECONDS_PER_DAY
    assert before + expected - TOLERANCE_S <= row["plus_until"] <= time.time() + expected + TOLERANCE_S
    assert client.get("/radio-api/me").json()["plus"] is True


@pytest.mark.parametrize("days_left", [None, 5, 365])
def test_existing_plus_is_never_changed(client, captured_emails, days_left):
    from app.main import db
    client.post("/radio-api/register", json={"email": EMAIL, "password": PASSWORD})
    stored_until = None if days_left is None else time.time() + days_left * SECONDS_PER_DAY
    with db.connect() as conn:
        conn.execute("UPDATE users SET plan = 'plus', plus_until = ? WHERE email = ?", (stored_until, EMAIL))

    assert verify_latest(client, captured_emails) == 200

    row = plan_row(EMAIL)
    assert row["plan"] == "plus"
    assert row["plus_until"] == stored_until


def test_unverified_account_gets_no_plus_before_confirmation(client, captured_emails):
    client.post("/radio-api/register", json={"email": EMAIL, "password": PASSWORD})
    row = plan_row(EMAIL)
    assert row["plan"] == "free" and row["plus_until"] is None
