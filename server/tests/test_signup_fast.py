"""Fast sign-up: the account works right after registration; confirming the e-mail unlocks 30 days of Plus.

Before this, half of the accounts never clicked the confirmation link and could not listen at all.
"""
from __future__ import annotations

import time

from test_api import captured_emails, client  # noqa: F401  (fixtures are used by name)

DAY = 86400


def _expire_trial() -> None:
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE trials SET started_at = started_at - 100000")


def _age_account(email: str, seconds: float) -> None:
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE users SET created_at = created_at - ? WHERE email = ?", (seconds, email))


def _register(client, email: str = "ola@example.com"):
    return client.post("/radio-api/register", json={"email": email, "password": "dlugiehaslo1"})


def test_register_keeps_listening_without_the_inbox(client, captured_emails):
    client.post("/radio-api/trial/start")
    _expire_trial()
    assert client.get("/radio-api/me").json()["allowed"] is False

    response = _register(client)
    assert response.status_code == 200
    assert response.json()["verification_sent"] is True
    assert len(captured_emails) == 1

    me = client.get("/radio-api/me").json()
    assert me["registered"] is True and me["allowed"] is True
    assert me["email_verified"] is False
    assert me["plus"] is False  # Plus comes with the confirmed e-mail
    assert client.get("/radio-api/news?cats=ai").status_code != 402


def test_confirming_the_email_unlocks_welcome_plus(client, captured_emails):
    _register(client)
    token = captured_emails[0][1].split("verify=")[1]
    assert client.post("/radio-api/verify", json={"token": token}).status_code == 200
    me = client.get("/radio-api/me").json()
    assert me["email_verified"] is True and me["plus"] is True


def test_registering_during_the_trial_keeps_trial_plus(client, captured_emails):
    client.post("/radio-api/trial/start")
    _register(client)
    me = client.get("/radio-api/me").json()
    assert me["registered"] is True and me["plus"] is True and me["email_verified"] is False


def test_unconfirmed_account_works_for_seven_days(client, captured_emails):
    client.post("/radio-api/trial/start")
    _expire_trial()
    _register(client)
    _age_account("ola@example.com", 6 * DAY)
    assert client.get("/radio-api/me").json()["allowed"] is True
    _age_account("ola@example.com", 2 * DAY)
    me = client.get("/radio-api/me").json()
    assert me["allowed"] is False and me["registered"] is True and me["email_verified"] is False
    blocked = client.get("/radio-api/news?cats=ai")
    assert blocked.status_code == 402
    assert "Potwierdź" in blocked.json()["detail"]


def test_login_before_confirmation_within_grace(client, captured_emails):
    _register(client)
    client.post("/radio-api/logout")
    client.cookies.clear()
    login = client.post("/radio-api/login", json={"email": "ola@example.com", "password": "dlugiehaslo1"})
    assert login.status_code == 200 and login.json()["email_verified"] is False
    assert client.get("/radio-api/me").json()["registered"] is True


def test_login_after_grace_needs_confirmation(client, captured_emails):
    _register(client)
    _age_account("ola@example.com", 8 * DAY)
    client.post("/radio-api/logout")
    client.cookies.clear()
    login = client.post("/radio-api/login", json={"email": "ola@example.com", "password": "dlugiehaslo1"})
    assert login.status_code == 403


def test_mail_failure_still_creates_a_working_account(client, monkeypatch):
    from app import mailer

    def broken(to_email: str, token: str) -> None:
        raise RuntimeError("smtp down")

    monkeypatch.setattr(mailer, "send_verification_email", broken)
    response = _register(client)
    assert response.status_code == 200 and response.json()["verification_sent"] is False
    assert client.get("/radio-api/me").json()["registered"] is True


def test_resend_from_the_session_with_cooldown(client, captured_emails):
    _register(client)
    first = client.post("/radio-api/verify/resend")
    assert first.status_code == 200 and first.json()["sent"] is True
    assert len(captured_emails) == 2
    assert client.post("/radio-api/verify/resend").status_code == 429
    fresh = captured_emails[1][1].split("verify=")[1]
    assert client.post("/radio-api/verify", json={"token": fresh}).status_code == 200
    assert client.post("/radio-api/verify/resend").json().get("already_verified") is True


def test_resend_without_session_is_rejected(client):
    assert client.post("/radio-api/verify/resend").status_code == 401


def test_registrations_are_rate_limited_per_address(client, captured_emails):
    for n in range(5):
        client.cookies.clear()
        assert _register(client, f"u{n}@example.com").status_code == 200
    client.cookies.clear()
    assert _register(client, "u9@example.com").status_code == 429


def test_unconfirmed_account_is_never_admin(client, captured_emails, monkeypatch):
    monkeypatch.setenv("DOSRADIO_ADMIN_EMAILS", "boss@example.com")
    _register(client, "boss@example.com")
    assert client.get("/radio-api/me").json()["registered"] is True
    assert client.get("/radio-api/admin/overview").status_code == 403


def test_trial_end_message_matches_the_six_hour_trial(client):
    client.post("/radio-api/trial/start")
    _expire_trial()
    detail = client.get("/radio-api/news?cats=ai").json()["detail"]
    assert "godzina" not in detail
    assert "Załóż konto" in detail


def test_timestamps_stay_sane(client, captured_emails):
    _register(client)
    from app.main import db
    row = db.find_user_by_email("ola@example.com")
    assert abs(row["created_at"] - time.time()) < 60
