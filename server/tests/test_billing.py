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
for name in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "DOSRADIO_PLUS_PRICE_PLN", "DOSRADIO_PLUS_PRICE_USD", "DOSRADIO_PLUS_AI_PRICE_USD"):
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

    # A configured price sells only what the page shows: 299 or 699 US cents, monthly, active.
    PRICE_AMOUNTS = {"price_test_usd_299": 299, "price_test_usd_699": 699}

    def retrieve(price_id, **kwargs):
        amount = PRICE_AMOUNTS.get(price_id)
        if amount is None:
            raise RuntimeError(f"unknown price {price_id}")
        return {"id": price_id, "unit_amount": amount, "currency": "usd", "active": True,
                "recurring": {"interval": "month"}}

    fake_client = SimpleNamespace(v1=SimpleNamespace(
        checkout=SimpleNamespace(sessions=SimpleNamespace(create=create)),
        prices=SimpleNamespace(retrieve=retrieve),
    ))
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
    plans = {p["id"]: p for p in body["plans"]}
    assert {p["currency"] for p in plans.values()} == {"usd"}
    assert plans["plus"]["name"] == "AmbiRadio Plus"
    assert plans["plus_ai"]["name"] == "AmbiRadio Plus AI"
    assert (plans["plus"]["amount_cents"], plans["plus_ai"]["amount_cents"]) == (299, 699)
    assert (plans["plus"]["yearly_cents"], plans["plus_ai"]["yearly_cents"]) == (2990, 6990)
    assert all("amount_pln" not in p for p in plans.values())


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


def test_checkout_refuses_without_configured_price(client, db, monkeypatch, fake_stripe):
    """A displayed price is not a charge: with no Stripe price id, checkout fails and sells nothing."""
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    login_user(client, db)
    response = client.post("/radio-api/billing/checkout", json={"plan": "plus_ai"})
    assert response.status_code == 503
    assert "nie są skonfigurowane" in response.json()["detail"]
    assert fake_stripe == []


def test_checkout_uses_env_price_id_and_b2b_invoice(client, db, monkeypatch, fake_stripe):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_PLUS_PRICE_USD", "price_test_usd_299")
    monkeypatch.setenv("DOSRADIO_SITE_URL", "https://ambiradio.example")
    login_user(client, db)
    response = client.post("/radio-api/billing/checkout", json={"plan": "plus", "b2b": True})
    assert response.status_code == 200
    params = fake_stripe[0]
    assert params["line_items"][0] == {"price": "price_test_usd_299", "quantity": 1}
    assert params["subscription_data"]["collection_method"] == "send_invoice"
    assert params["success_url"] == "https://ambiradio.example/?billing=success"


def test_checkout_plus_ai_env_price_id(client, db, monkeypatch, fake_stripe):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_PLUS_AI_PRICE_USD", "price_test_usd_699")
    login_user(client, db)
    assert client.post("/radio-api/billing/checkout", json={"plan": "plus_ai"}).status_code == 200
    assert fake_stripe[0]["line_items"][0] == {"price": "price_test_usd_699", "quantity": 1}


def test_checkout_ignores_legacy_pln_price_id(client, db, monkeypatch, fake_stripe):
    """A PLN price id would charge zloty while the UI shows dollars, so it is not used any more."""
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_PLUS_PRICE_PLN", "price_test_pln_39")
    login_user(client, db)
    response = client.post("/radio-api/billing/checkout", json={"plan": "plus"})
    assert response.status_code == 503  # no USD price configured, and the PLN one is never a fallback
    assert fake_stripe == []


def test_checkout_refuses_price_that_does_not_match_display(client, db, monkeypatch, fake_stripe):
    """A configured price that bills a different amount or currency is not sold."""
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_PLUS_PRICE_USD", "price_test_usd_299")
    from app import billing
    original_client = billing.stripe.StripeClient

    def mismatched_client(key):
        client_ = original_client(key)
        client_.v1.prices.retrieve = lambda price_id, **kw: {
            "id": price_id, "unit_amount": 3900, "currency": "pln", "active": True, "recurring": {"interval": "month"},
        }
        return client_

    monkeypatch.setattr(billing.stripe, "StripeClient", mismatched_client)
    login_user(client, db)
    response = client.post("/radio-api/billing/checkout", json={"plan": "plus"})
    assert response.status_code == 503
    assert "nie zgadza się" in response.json()["detail"]
    assert fake_stripe == []


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
    payload, header = signed_event({"id": "evt_other", "type": "charge.refunded", "data": {"object": {}}})
    assert client.post("/radio-api/billing/webhook", content=payload, headers={"stripe-signature": header}).status_code == 200
    assert db.find_user_by_email("plus@test.pl")["plan"] == "free"
