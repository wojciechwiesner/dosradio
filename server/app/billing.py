"""Stripe Checkout billing for AmbiRadio Plus.

Plans (USD): AmbiRadio Plus $2.99/month, AmbiRadio Plus AI $6.99/month. Stripe price
ids come from env (`DOSRADIO_PLUS_PRICE_USD`, `DOSRADIO_PLUS_AI_PRICE_USD`) and are
checked against the displayed amount before every checkout. The old
`DOSRADIO_PLUS_PRICE_PLN` is deliberately not read any more: a PLN price id would
charge PLN while the UI shows dollars.

Subscription lifecycle (webhook):
- `checkout.session.completed`: paid Plus for 30 days, the Stripe customer and
  subscription ids are stored on the user, `paid_plan` = plus | plus_ai.
- `invoice.paid`: renewal, paid Plus runs to the invoice period end + 1 grace day.
- `customer.subscription.updated`: plan tier switch (from subscription metadata).
- `customer.subscription.deleted`: paid Plus ends now; free Plus that runs longer stays.
`POST /portal` opens the Stripe Customer Portal (cancel, change card, invoices).
Mount is handled by app.main via a guarded import; shared Database/AccessService are
resolved lazily to avoid a circular import.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

import stripe
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .auth import AccessService, client_ip
from .db import Database

log = logging.getLogger("dosradio.billing")

PLUS_DAYS = 30
GRACE_SECONDS = 86400  # Stripe retries a failed renewal for a while; do not cut access mid-retry
SEEN_EVENT_LIMIT = 2048  # in-memory idempotency guard; survives duplicate deliveries
_seen_events: set[str] = set()

CURRENCY = "usd"

# amount_cents is the monthly price; yearly_cents is shown in the UI only (no yearly checkout yet).
PLANS: dict[str, dict[str, Any]] = {
    "plus": {
        "id": "plus",
        "name": "AmbiRadio Plus",
        "amount_cents": 299,
        "yearly_cents": 2990,
        "price_envs": ("DOSRADIO_PLUS_PRICE_USD",),
    },
    "plus_ai": {
        "id": "plus_ai",
        "name": "AmbiRadio Plus AI",
        "amount_cents": 699,
        "yearly_cents": 6990,
        "price_envs": ("DOSRADIO_PLUS_AI_PRICE_USD",),
    },
}

router = APIRouter(prefix="/radio-api/billing")


def _core() -> tuple[Database, AccessService]:
    """Shared app instances; imported lazily because main imports this module."""
    from . import main

    return main.db, main.access


def _ip(request: Request) -> str:
    return client_ip({k.lower(): v for k, v in request.headers.items()}, request.client.host if request.client else None)


def _stripe_client() -> stripe.StripeClient:
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Płatności są teraz wyłączone (brak klucza Stripe). Spróbuj później.")
    return stripe.StripeClient(key)


class CheckoutRequest(BaseModel):
    plan: str = "plus"
    b2b: bool = False  # B2B: monthly invoice instead of an immediate card charge


def _configured_price_id(plan_id: str) -> str:
    spec = PLANS[plan_id]
    for env_name in spec["price_envs"]:
        price_id = os.environ.get(env_name, "").strip()
        if price_id:
            return price_id
    return ""


def _verified_price(client: stripe.StripeClient, plan_id: str) -> str:
    """The configured Stripe price, but only when it charges exactly the displayed amount.

    A display price is never turned into a charge on its own: without a configured price id,
    or when the price bills a different amount, currency or interval, checkout fails clearly.
    The yearly figure is display-only and is never sold here.
    """
    spec = PLANS[plan_id]
    price_id = _configured_price_id(plan_id)
    if not price_id:
        raise HTTPException(503, f"Płatności dla planu {spec['name']} nie są skonfigurowane. Nie ma ceny Stripe do sprzedaży.")
    try:
        price = client.v1.prices.retrieve(price_id)
    except Exception as error:
        log.error("Stripe price lookup failed for %s: %s", price_id, error)
        raise HTTPException(502, "Nie udało się sprawdzić ceny w Stripe. Spróbuj ponownie za chwilę.") from error
    amount = _field(price, "unit_amount")
    currency = str(_field(price, "currency") or "").lower()
    recurring = _field(price, "recurring") or {}
    interval = str(_field(recurring, "interval") or "")
    if amount != spec["amount_cents"] or currency != CURRENCY or interval != "month" or not _field(price, "active"):
        log.error("Stripe price %s is %s %s/%s (active=%s), UI shows %s %s/month",
                  price_id, amount, currency, interval or "once", _field(price, "active"), spec["amount_cents"], CURRENCY)
        raise HTTPException(503, f"Cena Stripe dla planu {spec['name']} nie zgadza się z ceną na stronie. Płatność wstrzymana.")
    return price_id


def _site_url(request: Request) -> str:
    configured = os.environ.get("DOSRADIO_SITE_URL", "").strip().rstrip("/")
    if configured:
        return configured
    origin = request.headers.get("origin", "").strip().rstrip("/")
    if origin:
        return origin
    return str(request.base_url).rstrip("/")


@router.post("/checkout")
def checkout(body: CheckoutRequest, request: Request) -> dict:
    """Open a Stripe Checkout session for any registered (non-Plus-required) listener."""
    if body.plan not in PLANS:
        raise HTTPException(400, "Nieznany plan. Wybierz AmbiRadio Plus albo AmbiRadio Plus AI.")
    db, access = _core()
    current = access.resolve(request.cookies, _ip(request))
    if not current.registered or not current.email:
        raise HTTPException(401, "Załóż konto i zaloguj się, żeby wykupić AmbiRadio Plus.")
    user = db.find_user_by_email(current.email)
    if user is None:
        raise HTTPException(401, "Nie znaleziono konta.")
    client = _stripe_client()
    metadata = {"user_id": str(user["id"]), "plan": body.plan}
    params: dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": _verified_price(client, body.plan), "quantity": 1}],
        "success_url": _site_url(request) + "/?billing=success",
        "cancel_url": _site_url(request) + "/?billing=cancel",
        "client_reference_id": str(user["id"]),
        "metadata": metadata,
        # Renewal invoices and subscription events carry the subscription's metadata, not the session's.
        "subscription_data": {"metadata": dict(metadata)},
    }
    customer_id = _row_value(user, "stripe_customer_id")
    if customer_id:
        params["customer"] = customer_id  # one Stripe customer per account, also after a cancellation
    else:
        params["customer_email"] = current.email
    if body.b2b:
        params["subscription_data"].update({"collection_method": "send_invoice", "days_until_due": 14})
    try:
        session = client.v1.checkout.sessions.create(params=params)
    except Exception as error:
        log.error("Stripe checkout failed: %s", error)
        raise HTTPException(502, "Nie udało się otworzyć płatności. Spróbuj ponownie za chwilę.") from error
    return {"url": session.url, "plan": body.plan}


def _plan_or_default(raw: Any) -> str:
    plan = str(raw or "")
    return plan if plan in PLANS else "plus"


def _row_value(row: Any, key: str) -> Any:
    """Column value from a sqlite3.Row, None when the column does not exist (pre-migration)."""
    try:
        return row[key]
    except (IndexError, KeyError):
        return None


def _extend_paid_plus(db: Database, user_id: int, until: float, plan: str | None = None) -> None:
    """Paid Plus up to `until`; never shortens access that is already longer."""
    with db.connect() as conn:
        conn.execute(
            "UPDATE users SET plan = 'plus',"
            " plus_paid_until = MAX(COALESCE(plus_paid_until, 0), ?),"
            " plus_until = CASE WHEN plus_until IS NULL AND plan = 'plus' THEN NULL"
            "                   ELSE MAX(COALESCE(plus_until, 0), ?) END,"
            " paid_plan = COALESCE(?, paid_plan, 'plus')"
            " WHERE id = ?",
            (until, until, plan, user_id),
        )


def _grant_plus(db: Database, user_id: int, plan: str = "plus", customer: str | None = None,
                subscription: str | None = None) -> None:
    with db.connect() as conn:
        conn.execute(
            "UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id),"
            " stripe_subscription_id = COALESCE(?, stripe_subscription_id) WHERE id = ?",
            (customer, subscription, user_id),
        )
    _extend_paid_plus(db, user_id, time.time() + PLUS_DAYS * 86400, plan)


def _user_id_by_stripe(db: Database, customer: Any, subscription: Any) -> int | None:
    with db.connect() as conn:
        for column, value in (("stripe_subscription_id", subscription), ("stripe_customer_id", customer)):
            if value:
                row = conn.execute(f"SELECT id FROM users WHERE {column} = ?", (str(value),)).fetchone()
                if row:
                    return int(row["id"])
    return None


def _invoice_period_end(invoice: Any) -> float | None:
    lines = _field(_field(invoice, "lines") or {}, "data") or []
    ends = [_field(_field(line, "period") or {}, "end") for line in lines]
    ends = [float(end) for end in ends if end]
    return max(ends) if ends else None


def _on_checkout_completed(db: Database, event_id: str, session: Any) -> None:
    user_id = _user_id_from_session(db, session)
    if user_id is None:
        log.warning("Webhook %s: checkout session without a matching user", event_id)
        return
    plan = _plan_or_default(_field(_field(session, "metadata") or {}, "plan"))
    customer = _field(session, "customer")
    subscription = _field(session, "subscription")
    _grant_plus(db, user_id, plan, str(customer) if customer else None, str(subscription) if subscription else None)
    log.info("Granted %s to user %s (event %s)", plan, user_id, event_id)


def _on_invoice_paid(db: Database, event_id: str, invoice: Any) -> None:
    user_id = _user_id_by_stripe(db, _field(invoice, "customer"), _field(invoice, "subscription"))
    period_end = _invoice_period_end(invoice)
    if user_id is None or period_end is None:
        log.warning("Webhook %s: paid invoice without a matching user or period", event_id)
        return
    _extend_paid_plus(db, user_id, period_end + GRACE_SECONDS)
    log.info("Renewed paid Plus for user %s until %s (event %s)", user_id, int(period_end), event_id)


def _on_subscription_updated(db: Database, event_id: str, subscription: Any) -> None:
    user_id = _user_id_by_stripe(db, _field(subscription, "customer"), _field(subscription, "id"))
    if user_id is None:
        return
    plan = _field(_field(subscription, "metadata") or {}, "plan")
    if plan in PLANS:
        with db.connect() as conn:
            conn.execute("UPDATE users SET paid_plan = ? WHERE id = ?", (plan, user_id))
        log.info("User %s is now on %s (event %s)", user_id, plan, event_id)


def _on_subscription_deleted(db: Database, event_id: str, subscription: Any) -> None:
    user_id = _user_id_by_stripe(db, _field(subscription, "customer"), _field(subscription, "id"))
    if user_id is None:
        return
    ended = float(_field(subscription, "ended_at") or time.time())
    with db.connect() as conn:
        row = conn.execute("SELECT plus_until, plus_paid_until FROM users WHERE id = ?", (user_id,)).fetchone()
        paid_until = row["plus_paid_until"] or 0
        plus_until = row["plus_until"]
        # Free Plus (welcome / admin) that runs past the paid period is kept; only the paid part ends.
        # plus_until NULL on a Plus account means unlimited (admin) and is kept as well.
        keeps_free_plus = plus_until is None or plus_until > paid_until + 1
        new_plus_until = plus_until if plus_until is None or keeps_free_plus else min(plus_until, ended)
        conn.execute(
            "UPDATE users SET plus_paid_until = ?, plus_until = ?, stripe_subscription_id = NULL WHERE id = ?",
            (min(paid_until, ended), new_plus_until, user_id),
        )
    log.info("Subscription ended for user %s (event %s)", user_id, event_id)


WEBHOOK_HANDLERS = {
    "checkout.session.completed": _on_checkout_completed,
    "invoice.paid": _on_invoice_paid,
    "customer.subscription.updated": _on_subscription_updated,
    "customer.subscription.deleted": _on_subscription_deleted,
}


def _field(obj: Any, key: str) -> Any:
    """Subscript access tolerating both plain dicts and stripe's StripeObject."""
    try:
        return obj[key]
    except (KeyError, IndexError, TypeError):
        return None


def _user_id_from_session(db: Database, session: dict[str, Any]) -> int | None:
    metadata = _field(session, "metadata") or {}
    raw = _field(metadata, "user_id") or _field(session, "client_reference_id")
    if raw:
        try:
            return int(raw)
        except (TypeError, ValueError):
            pass
    email = _field(session, "customer_email")
    if email:
        user = db.find_user_by_email(str(email))
        if user:
            return int(user["id"])
    return None


@router.post("/webhook")
async def stripe_webhook(request: Request) -> dict:
    """Signature-verified, idempotent Stripe webhook; grants Plus on checkout completion."""
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(503, "Webhook nie jest skonfigurowany (STRIPE_WEBHOOK_SECRET).")
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, signature, secret)
    except (ValueError, stripe.error.SignatureVerificationError) as error:
        raise HTTPException(400, "Nieprawidłowy podpis webhooka.") from error
    if event["id"] in _seen_events:
        return {"received": True, "duplicate": True}
    if len(_seen_events) >= SEEN_EVENT_LIMIT:
        _seen_events.clear()
    _seen_events.add(event["id"])
    handler = WEBHOOK_HANDLERS.get(event["type"])
    if handler is not None:
        db, _ = _core()
        handler(db, event["id"], event["data"]["object"])
    return {"received": True}


@router.post("/portal")
def customer_portal(request: Request) -> dict:
    """Stripe Customer Portal: cancel, change the card, download invoices."""
    db, access = _core()
    current = access.resolve(request.cookies, _ip(request))
    if not current.registered or not current.email:
        raise HTTPException(401, "Zaloguj się, żeby zarządzać subskrypcją.")
    user = db.find_user_by_email(current.email)
    customer_id = _row_value(user, "stripe_customer_id") if user else None
    if user is None or not customer_id:
        raise HTTPException(404, "To konto nie ma jeszcze subskrypcji w Stripe.")
    client = _stripe_client()
    try:
        session = client.v1.billing_portal.sessions.create(
            params={"customer": customer_id, "return_url": _site_url(request) + "/?billing=portal"},
        )
    except Exception as error:
        log.error("Stripe portal failed for user %s: %s", user["id"], error)
        raise HTTPException(502, "Nie udało się otworzyć panelu subskrypcji. Spróbuj ponownie za chwilę.") from error
    return {"url": session.url}


@router.get("/status")
def billing_status(request: Request) -> dict:
    """Current plan state for the UI; local only, never fails on missing Stripe keys."""
    db, access = _core()
    current = access.resolve(request.cookies, _ip(request))
    info: dict[str, Any] = {
        "registered": current.registered,
        "plus": current.plus,
        "email": current.email,
        "checkout_available": bool(os.environ.get("STRIPE_SECRET_KEY", "").strip()),
        "plans": [
            {
                "id": spec["id"],
                "name": spec["name"],
                "currency": CURRENCY,
                "amount_cents": spec["amount_cents"],
                "yearly_cents": spec["yearly_cents"],  # display only: there is no yearly checkout
                "yearly_checkout": False,
                "checkout_available": bool(os.environ.get("STRIPE_SECRET_KEY", "").strip()) and bool(_configured_price_id(spec["id"])),
                "interval": "month",
            }
            for spec in PLANS.values()
        ],
    }
    if current.registered and current.email:
        user = db.find_user_by_email(current.email)
        if user:
            info["plan"] = user["plan"]
            info["plus_until"] = user["plus_until"]
            paid_until = _row_value(user, "plus_paid_until")
            info["paid"] = bool(paid_until and paid_until > time.time())
            info["paid_plan"] = (_row_value(user, "paid_plan") or "plus") if info["paid"] else None
            info["can_manage"] = bool(_row_value(user, "stripe_customer_id"))
    info.setdefault("paid", False)
    info.setdefault("paid_plan", None)
    info.setdefault("can_manage", False)
    return info
