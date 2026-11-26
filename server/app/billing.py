"""Stripe Checkout billing for AmbiRadio Plus (test mode).

Plans (USD): AmbiRadio Plus $2.99/month, AmbiRadio Plus AI $6.99/month. Stripe price
ids come from env (`DOSRADIO_PLUS_PRICE_USD`, `DOSRADIO_PLUS_AI_PRICE_USD`); without them
Checkout uses an inline USD price. The old `DOSRADIO_PLUS_PRICE_PLN` is deliberately not
read any more: a PLN price id would charge PLN while the UI shows dollars. The webhook grants `plus`
(plan='plus', plus_until=now+30d) on `checkout.session.completed`. Mount is
handled by app.main via a guarded import; shared Database/AccessService are
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
    params: dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": _verified_price(client, body.plan), "quantity": 1}],
        "success_url": _site_url(request) + "/?billing=success",
        "cancel_url": _site_url(request) + "/?billing=cancel",
        "customer_email": current.email,
        "client_reference_id": str(user["id"]),
        "metadata": {"user_id": str(user["id"]), "plan": body.plan},
    }
    if body.b2b:
        params["subscription_data"] = {"collection_method": "send_invoice", "days_until_due": 14}
    try:
        session = client.v1.checkout.sessions.create(params=params)
    except Exception as error:
        log.error("Stripe checkout failed: %s", error)
        raise HTTPException(502, "Nie udało się otworzyć płatności. Spróbuj ponownie za chwilę.") from error
    return {"url": session.url, "plan": body.plan}


def _grant_plus(db: Database, user_id: int) -> None:
    with db.connect() as conn:
        until = time.time() + PLUS_DAYS * 86400
        conn.execute("UPDATE users SET plan = 'plus', plus_until = ?, plus_paid_until = ? WHERE id = ?", (until, until, user_id))


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
    if event["type"] == "checkout.session.completed":
        db, _ = _core()
        user_id = _user_id_from_session(db, event["data"]["object"])
        if user_id is None:
            log.warning("Webhook %s: checkout session without a matching user", event["id"])
        else:
            _grant_plus(db, user_id)
            log.info("Granted Plus to user %s (event %s)", user_id, event["id"])
    return {"received": True}


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
    return info
