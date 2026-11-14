"""Billing tests: checkout gating, 503 without keys, webhook signature + idempotent Plus grant.

The Stripe SDK is faked (no network); webhook signatures are computed locally with
hmac/sha256 exactly like Stripe does, so construct_event verifies real crypto offline.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DOSRADIO_SECRET", "x" * 40)
os.environ["DOSRADIO_PREWARM"] = "0"
for name in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "DOSRADIO_PLUS_PRICE_PLN"):
    os.environ.pop(name, None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

WEBHOOK_SECRET = "whsec_test_secret"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DOSRADIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DOSRADIO_TRIAL_SECONDS", "600")
    for name in list(sys.modules):
        if name.startswith("app"):
            del sys.modules[name]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, base_url="https://testserver")


@pytest.fixture()
def db(client):
    from app import main
    return main.db


def login_user(client, db, email: str = "plus@test.pl") -> int:
    """Create a verified user straight in the DB and set the session cookie."""
    from app.auth import hash_password, token_hash

    user_id = db.create_user(email, hash_password("haslo12345"))
    db.verify_email(user_id)
    token = secrets.token_urlsafe(32)
    db.create_session(token_hash(token), user_id)
    client.cookies.set("dr_session", token)
    return user_id


@pytest.fixture()
def fake_stripe(monkeypatch):
    """Replace the SDK inside billing with a recording fake (webhook parts stay real)."""
    from app import billing
    import stripe as real_stripe

    calls: list[dict] = []

    def create(params=None, **kwargs):
        calls.append(params or kwargs)
        return SimpleNamespace(url="https://checkout.stripe.com/c/pay/cs_test_123")

    fake_client = SimpleNamespace(v1=SimpleNamespace(checkout=SimpleNamespace(sessions=SimpleNamespace(create=create))))
    fake = SimpleNamespace(
        StripeClient=lambda key: fake_client,
        Webhook=real_stripe.Webhook,
        error=real_stripe.error,
    )
    monkeypatch.setattr(billing, "stripe", fake)
    return calls


def signed_event(event: dict) -> tuple[bytes, str]:
    """Serialize + sign an event with the local test secret (Stripe's t/v1 scheme)."""
    payload = json.dumps(event).encode()
    timestamp = str(int(time.time()))
    signed = f"{timestamp}.".encode() + payload
    v1 = hmac.new(WEBHOOK_SECRET.encode(), signed, hashlib.sha256).hexdigest()
    return payload, f"t={timestamp},v1={v1}"


def completed_event(user_id: int, event_id: str = "evt_test_1") -> dict:
    return {
        "id": event_id,
        "type": "checkout.session.completed",
        "data": {"object": {"metadata": {"user_id": str(user_id), "plan": "plus"}, "client_reference_id": str(user_id)}},
    }


def test_status_anonymous(client):
    body = client.get("/radio-api/billing/status").json()
    assert body["registered"] is False
    assert body["plus"] is False
    assert body["checkout_available"] is False
    assert [p["id"] for p in body["plans"]] == ["plus", "plus_ai"]
    assert {p["amount_pln"] for p in body["plans"]} == {39, 59}


def test_checkout_requires_registration(client, db):
    response = client.post("/radio-api/billing/checkout", json={"plan": "plus"})
    assert response.status_code == 401


def test_checkout_503_without_stripe_key_and_app_alive(client, db):
    login_user(client, db)
    response = client.post("/radio-api/billing/checkout", json={"plan": "plus"})
    assert response.status_code == 503
    assert "Stripe" in response.json()["detail"]
    assert client.get("/radio-api/health").json()["ok"] is True  # rest of the app unaffected


def test_checkout_rejects_unknown_plan(client, db, monkeypatch, fake_stripe):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    login_user(client, db)
    response = client.post("/radio-api/billing/checkout", json={"plan": "enterprise"})
    assert response.status_code == 400


def test_checkout_creates_session_inline_price(client, db, monkeypatch, fake_stripe):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    user_id = login_user(client, db)
    response = client.post("/radio-api/billing/checkout", json={"plan": "plus_ai"})
    assert response.status_code == 200
    assert response.json() == {"url": "https://checkout.stripe.com/c/pay/cs_test_123", "plan": "plus_ai"}
    params = fake_stripe[0]
    assert params["mode"] == "subscription"
    assert params["metadata"] == {"user_id": str(user_id), "plan": "plus_ai"}
    assert params["line_items"][0]["price_data"]["unit_amount"] == 5900
    assert params["success_url"].endswith("/?billing=success")
    assert "subscription_data" not in params


def test_checkout_uses_env_price_id_and_b2b_invoice(client, db, monkeypatch, fake_stripe):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_PLUS_PRICE_PLN", "price_test_39")
    monkeypatch.setenv("DOSRADIO_SITE_URL", "https://dosradio.example")
    login_user(client, db)
    response = client.post("/radio-api/billing/checkout", json={"plan": "plus", "b2b": True})
    assert response.status_code == 200
    params = fake_stripe[0]
    assert params["line_items"][0] == {"price": "price_test_39", "quantity": 1}
    assert params["subscription_data"]["collection_method"] == "send_invoice"
    assert params["success_url"] == "https://dosradio.example/?billing=success"


def test_webhook_missing_secret_503(client, db):
    assert client.post("/radio-api/billing/webhook", content=b"{}").status_code == 503


def test_webhook_bad_signature_400(client, db, monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    response = client.post(
        "/radio-api/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=123,v1=deadbeef"},
    )
    assert response.status_code == 400


def test_webhook_grants_plus(client, db, monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    user_id = login_user(client, db)
    payload, header = signed_event(completed_event(user_id))
    response = client.post("/radio-api/billing/webhook", content=payload, headers={"stripe-signature": header})
    assert response.status_code == 200
    assert response.json() == {"received": True}
    row = db.find_user_by_email("plus@test.pl")
    assert row["plan"] == "plus"
    assert row["plus_until"] == pytest.approx(time.time() + 30 * 86400, abs=60)
    status = client.get("/radio-api/billing/status").json()
    assert status["plus"] is True and status["plan"] == "plus"


def test_webhook_idempotent(client, db, monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    user_id = login_user(client, db)
    payload, header = signed_event(completed_event(user_id))
    first = client.post("/radio-api/billing/webhook", content=payload, headers={"stripe-signature": header})
    assert first.json() == {"received": True}
    plus_until = db.find_user_by_email("plus@test.pl")["plus_until"]
    time.sleep(0.01)
    second = client.post("/radio-api/billing/webhook", content=payload, headers={"stripe-signature": header})
    assert second.json() == {"received": True, "duplicate": True}
    assert db.find_user_by_email("plus@test.pl")["plus_until"] == plus_until  # not re-granted


def test_webhook_ignores_other_event_types(client, db, monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    user_id = login_user(client, db)
    payload, header = signed_event({"id": "evt_other", "type": "invoice.paid", "data": {"object": {}}})
    assert client.post("/radio-api/billing/webhook", content=payload, headers={"stripe-signature": header}).status_code == 200
    assert db.find_user_by_email("plus@test.pl")["plan"] == "free"
