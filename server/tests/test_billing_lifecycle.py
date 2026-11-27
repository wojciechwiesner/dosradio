"""Subscription lifecycle: renewals, cancellations, plan tiers and the Customer Portal.

Regression invariant: a paying subscriber keeps Plus for as long as Stripe keeps charging.
Before this, only `checkout.session.completed` was handled and Plus lapsed after 30 days
while Stripe went on billing every month.
"""
from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from test_billing import (  # noqa: F401  (fixtures are used by name)
    WEBHOOK_SECRET, client, db, fake_stripe, login_user, signed_event,
)

DAY = 86400


def post_event(client, event: dict):
    payload, header = signed_event(event)
    return client.post("/radio-api/billing/webhook", content=payload, headers={"stripe-signature": header})


def checkout_completed(user_id: int, plan: str = "plus", event_id: str = "evt_cs_1") -> dict:
    return {
        "id": event_id,
        "type": "checkout.session.completed",
        "data": {"object": {
            "metadata": {"user_id": str(user_id), "plan": plan},
            "client_reference_id": str(user_id),
            "customer": "cus_test_1",
            "subscription": "sub_test_1",
        }},
    }


def invoice_paid(period_end: float, event_id: str = "evt_inv_2", plan: str | None = None) -> dict:
    line: dict = {"period": {"start": period_end - 30 * DAY, "end": period_end}}
    if plan:
        line["metadata"] = {"plan": plan}
    return {
        "id": event_id,
        "type": "invoice.paid",
        "data": {"object": {
            "customer": "cus_test_1",
            "subscription": "sub_test_1",
            "billing_reason": "subscription_cycle",
            "lines": {"data": [line]},
        }},
    }


def subscription_deleted(ended_at: float, event_id: str = "evt_sub_del") -> dict:
    return {
        "id": event_id,
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_test_1", "customer": "cus_test_1", "status": "canceled", "ended_at": ended_at}},
    }


@pytest.fixture()
def hooked(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)


def user(db):
    return db.find_user_by_email("plus@test.pl")


def test_checkout_links_stripe_customer_and_subscription(client, db, hooked):
    user_id = login_user(client, db)
    assert post_event(client, checkout_completed(user_id)).status_code == 200
    row = user(db)
    assert row["stripe_customer_id"] == "cus_test_1"
    assert row["stripe_subscription_id"] == "sub_test_1"
    assert row["paid_plan"] == "plus"
    assert row["plus_paid_until"] == pytest.approx(time.time() + 30 * DAY, abs=60)


def test_renewal_extends_paid_plus_past_the_first_month(client, db, hooked):
    """The bug: the 2nd month was charged but Plus ended after 30 days."""
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    next_period_end = time.time() + 61 * DAY
    assert post_event(client, invoice_paid(next_period_end)).status_code == 200
    row = user(db)
    assert row["plan"] == "plus"
    # paid through the new period, plus a grace day for Stripe retries / clock skew
    assert row["plus_paid_until"] == pytest.approx(next_period_end + DAY, abs=5)
    assert row["plus_until"] == pytest.approx(next_period_end + DAY, abs=5)


def test_renewal_never_shortens_access(client, db, hooked):
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    before = user(db)["plus_paid_until"]
    post_event(client, invoice_paid(time.time() + 2 * DAY, event_id="evt_inv_short"))
    assert user(db)["plus_paid_until"] == before


def test_renewal_for_unknown_customer_is_ignored(client, db, hooked):
    login_user(client, db)
    assert post_event(client, invoice_paid(time.time() + 60 * DAY)).status_code == 200
    assert user(db)["plan"] == "free"


def test_cancellation_ends_paid_plus(client, db, hooked):
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    ended = time.time()
    assert post_event(client, subscription_deleted(ended)).status_code == 200
    row = user(db)
    assert row["plus_paid_until"] == pytest.approx(ended, abs=5)
    assert row["plus_until"] == pytest.approx(ended, abs=5)
    status = client.get("/radio-api/billing/status").json()
    assert status["plus"] is False


def test_cancellation_keeps_a_longer_welcome_plus(client, db, hooked):
    """Cancelling a paid plan must not take away free Plus the account still had."""
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    with db.connect() as conn:  # e.g. admin-granted Plus for 90 days
        conn.execute("UPDATE users SET plus_until = ? WHERE id = ?", (time.time() + 90 * DAY, user_id))
    post_event(client, subscription_deleted(time.time()))
    row = user(db)
    assert row["plus_paid_until"] <= time.time() + 5
    assert row["plus_until"] > time.time() + 80 * DAY
    assert row["plan"] == "plus"


def test_cancellation_keeps_unlimited_admin_plus(client, db, hooked):
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    with db.connect() as conn:
        conn.execute("UPDATE users SET plus_until = NULL WHERE id = ?", (user_id,))
    post_event(client, subscription_deleted(time.time()))
    row = user(db)
    assert row["plus_until"] is None and row["plan"] == "plus"


def test_renewal_keeps_unlimited_admin_plus_unlimited(client, db, hooked):
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    with db.connect() as conn:
        conn.execute("UPDATE users SET plus_until = NULL WHERE id = ?", (user_id,))
    post_event(client, invoice_paid(time.time() + 61 * DAY))
    assert user(db)["plus_until"] is None


def test_subscription_updated_switches_plan_tier(client, db, hooked):
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    event = {
        "id": "evt_sub_upd",
        "type": "customer.subscription.updated",
        "data": {"object": {
            "id": "sub_test_1", "customer": "cus_test_1", "status": "active",
            "metadata": {"plan": "plus_ai"},
            "items": {"data": [{"current_period_end": time.time() + 30 * DAY, "price": {"id": "price_test_usd_699"}}]},
        }},
    }
    assert post_event(client, event).status_code == 200
    assert user(db)["paid_plan"] == "plus_ai"


def test_plus_ai_checkout_is_remembered(client, db, hooked):
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id, plan="plus_ai"))
    assert user(db)["paid_plan"] == "plus_ai"
    assert client.get("/radio-api/billing/status").json()["paid_plan"] == "plus_ai"


def test_unknown_plan_in_metadata_falls_back_to_plus(client, db, hooked):
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id, plan="gold"))
    assert user(db)["paid_plan"] == "plus"


def test_checkout_sends_plan_metadata_to_the_subscription(client, db, monkeypatch, fake_stripe):
    """Renewals carry subscription metadata, not the checkout session's."""
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_PLUS_AI_PRICE_USD", "price_test_usd_699")
    user_id = login_user(client, db)
    assert client.post("/radio-api/billing/checkout", json={"plan": "plus_ai"}).status_code == 200
    params = fake_stripe[0]
    assert params["subscription_data"]["metadata"] == {"user_id": str(user_id), "plan": "plus_ai"}


def test_b2b_checkout_keeps_invoice_and_metadata(client, db, monkeypatch, fake_stripe):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_PLUS_PRICE_USD", "price_test_usd_299")
    login_user(client, db)
    client.post("/radio-api/billing/checkout", json={"plan": "plus", "b2b": True})
    data = fake_stripe[0]["subscription_data"]
    assert data["collection_method"] == "send_invoice" and data["metadata"]["plan"] == "plus"


def test_checkout_reuses_existing_stripe_customer(client, db, monkeypatch, fake_stripe, hooked):
    """A returning subscriber is not split into a second Stripe customer."""
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_PLUS_PRICE_USD", "price_test_usd_299")
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    client.post("/radio-api/billing/checkout", json={"plan": "plus"})
    params = fake_stripe[0]
    assert params["customer"] == "cus_test_1"
    assert "customer_email" not in params


# --- Customer Portal --------------------------------------------------------

@pytest.fixture()
def portal_calls(monkeypatch, fake_stripe):
    from app import billing

    calls: list[dict] = []
    fake_client = billing.stripe.StripeClient("x")

    def create(params=None, **kwargs):
        calls.append(params or kwargs)
        return SimpleNamespace(url="https://billing.stripe.com/p/session/test_123")

    fake_client.v1.billing_portal = SimpleNamespace(sessions=SimpleNamespace(create=create))
    monkeypatch.setattr(billing.stripe, "StripeClient", lambda key: fake_client)
    return calls


def test_portal_requires_login(client, db, monkeypatch, portal_calls):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    assert client.post("/radio-api/billing/portal").status_code == 401
    assert portal_calls == []


def test_portal_requires_a_stripe_customer(client, db, monkeypatch, portal_calls):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    login_user(client, db)
    response = client.post("/radio-api/billing/portal")
    assert response.status_code == 404
    assert portal_calls == []


def test_portal_opens_for_subscriber(client, db, monkeypatch, portal_calls, hooked):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("DOSRADIO_SITE_URL", "https://ambiradio.example")
    user_id = login_user(client, db)
    post_event(client, checkout_completed(user_id))
    response = client.post("/radio-api/billing/portal")
    assert response.status_code == 200
    assert response.json()["url"].startswith("https://billing.stripe.com/")
    assert portal_calls[0] == {"customer": "cus_test_1", "return_url": "https://ambiradio.example/?billing=portal"}


def test_status_reports_manageable_subscription(client, db, hooked):
    user_id = login_user(client, db)
    assert client.get("/radio-api/billing/status").json()["can_manage"] is False
    post_event(client, checkout_completed(user_id))
    body = client.get("/radio-api/billing/status").json()
    assert body["can_manage"] is True
    assert body["paid"] is True
