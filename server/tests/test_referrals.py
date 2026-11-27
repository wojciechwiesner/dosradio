"""Referral attribution: shared links (dedication d, greeting w, url podcast p) -> visitors -> accounts.

Before this, nothing tied a new listener or account to the link that brought them.
"""
from __future__ import annotations

import hashlib

import pytest

from test_api import captured_emails, client  # noqa: F401  (fixtures are used by name)

ADMIN_TOKEN = "admin-test-token-0123456789"


def _dedication(sender_ip: str = "198.51.100.9") -> str:
    from app.dedications import DedicationStore
    from app.main import db
    row = DedicationStore(db.path).create(
        station_id="dos-groove", station_name="Groove", host_name="Ola", to_name="Ewa", from_name="Kuba",
        message="hej", lang="pl", script="Pozdrowienia", ip_hash=hashlib.sha256(f"ded:{sender_ip}".encode()).hexdigest()[:16],
    )
    return row["id"]


def _summary():
    from app.main import db
    from app.referrals import summary
    return summary(db)


def test_opening_a_dedication_link_is_counted_once_and_marks_the_visitor(client):
    token = _dedication()
    first = client.get(f"/radio-api/dedications/{token}")
    assert first.status_code == 200
    assert client.cookies.get("dr_ref") == f"d:{token}"
    client.get(f"/radio-api/dedications/{token}")  # re-open: same visitor
    s = _summary()
    assert s["opened"] == 1 and s["by_kind"]["d"]["opened"] == 1


def test_signup_after_a_link_is_attributed(client, captured_emails):
    token = _dedication()
    client.get(f"/radio-api/dedications/{token}")
    assert client.post("/radio-api/register", json={"email": "ewa@example.com", "password": "dlugiehaslo1"}).status_code == 200
    from app.main import db
    assert db.find_user_by_email("ewa@example.com")["referred_by"] == f"d:{token}"
    s = _summary()
    assert s["signups"] == 1 and s["verified"] == 0
    link = captured_emails[0][1].split("verify=")[1]
    client.post("/radio-api/verify", json={"token": link})
    assert _summary()["verified"] == 1


def test_sender_opening_own_link_is_not_counted(client):
    token = _dedication(sender_ip="testclient")  # TestClient peer address
    client.get(f"/radio-api/dedications/{token}")
    assert _summary()["opened"] == 0
    assert client.cookies.get("dr_ref") is None


def test_first_link_wins(client, captured_emails):
    first, second = _dedication(), _dedication()
    client.get(f"/radio-api/dedications/{first}")
    client.get(f"/radio-api/dedications/{second}")
    client.post("/radio-api/register", json={"email": "ewa@example.com", "password": "dlugiehaslo1"})
    from app.main import db
    assert db.find_user_by_email("ewa@example.com")["referred_by"] == f"d:{first}"


@pytest.mark.parametrize("junk", ["x:abc", "d:", "d:<script>", "d:" + "a" * 80])
def test_forged_cookie_is_ignored(client, captured_emails, junk):
    client.cookies.set("dr_ref", junk)
    client.post("/radio-api/register", json={"email": "ewa@example.com", "password": "dlugiehaslo1"})
    from app.main import db
    assert db.find_user_by_email("ewa@example.com")["referred_by"] is None


def test_registered_listener_gets_no_cookie(client, captured_emails):
    client.post("/radio-api/register", json={"email": "ewa@example.com", "password": "dlugiehaslo1"})
    client.cookies.delete("dr_ref")
    token = _dedication()
    client.get(f"/radio-api/dedications/{token}")
    assert client.cookies.get("dr_ref") is None
    s = _summary()
    assert s["opened"] == 0 and s["opened_by_members"] == 1


def test_admin_overview_shows_referrals(client, monkeypatch):
    monkeypatch.setenv("DOSRADIO_ADMIN_TOKEN", ADMIN_TOKEN)
    client.get(f"/radio-api/dedications/{_dedication()}")
    body = client.get("/radio-api/admin/overview", headers={"x-admin-token": ADMIN_TOKEN}).json()
    assert body["referrals"]["opened"] == 1


def test_drop_claim_and_url_podcast_link_are_tracked(client):
    from app.main import db
    from app.social import SocialService
    social = SocialService(db)
    greeting = social.create_drop(prefix="w", from_key="c:sender1", from_name="Kuba", to_name="Ewa", kind="greeting",
                                  station_id="dos-groove", message="hej")
    podcast = social.create_drop(prefix="p", from_key="c:sender1", from_name="Kuba", to_name="", kind="url_podcast",
                                 station_id="dos-groove", message="strona")
    assert client.post(f"/radio-api/social/drops/{greeting['token']}/claim", json={},
                       headers={"x-client-id": "visitor1"}).status_code == 200
    assert client.cookies.get("dr_ref") == f"w:{greeting['token']}"
    for _ in range(3):  # the page polls this link while the podcast renders
        client.get(f"/radio-api/social/url-podcast-link/{podcast['token']}", headers={"x-client-id": "visitor1"})
    s = _summary()
    assert s["by_kind"]["w"]["opened"] == 1 and s["by_kind"]["p"]["opened"] == 1


def test_sender_claiming_own_drop_is_not_counted(client):
    from app.main import db
    from app.social import SocialService
    drop = SocialService(db).create_drop(prefix="w", from_key="c:me1", from_name="Kuba", to_name="Ewa",
                                         kind="greeting", station_id="dos-groove", message="hej")
    client.post(f"/radio-api/social/drops/{drop['token']}/claim", json={}, headers={"x-client-id": "me1"})
    assert _summary()["opened"] == 0
