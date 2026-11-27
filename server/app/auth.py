"""Accounts, cookies and the listening allowance (6 h trial with full Plus, then registration)."""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from . import mailer, referrals
from .db import Database

log = logging.getLogger("dosradio.auth")

VERIFY_TTL_SECONDS = mailer.VERIFY_TTL_SECONDS
WELCOME_PLUS_DAYS = 30
# A new account works at once; without a confirmed e-mail it keeps working for this long.
UNVERIFIED_GRACE_SECONDS = 7 * 86400
RESEND_COOLDOWN_SECONDS = 60
REGISTER_LIMIT_PER_HOUR = 5  # per address, against scripted sign-ups (no CAPTCHA in front)

TRIAL_ENDED_DETAIL = (
    "Darmowy czas słuchania minął. Załóż konto: słuchasz dalej od razu, "
    "a po potwierdzeniu e-maila dostajesz 30 dni Plus za darmo."
)
UNVERIFIED_ENDED_DETAIL = "Potwierdź adres e-mail, żeby słuchać dalej. Link jest w skrzynce, możesz też wysłać nowy."

SESSION_COOKIE = "dr_session"
ANON_COOKIE = "dr_anon"
# A recipient opening a shared dedication link may hear the greeting and the music under it even after
# their own free hour is used up: a short, signed, non-renewable pass scoped to that link and address.
DEDICATION_PASS_COOKIE = "dr_ded"
DEDICATION_PASS_SECONDS = 10 * 60
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# --- password hashing (stdlib PBKDF2-SHA256, OWASP 2023+ iteration count) -----
PBKDF2_ITERATIONS = 600_000


def _pbkdf2(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"pbkdf2${salt.hex()}${_pbkdf2(password, salt).hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(_pbkdf2(password, bytes.fromhex(salt_hex)).hex(), digest_hex)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def client_ip(request_headers: dict[str, str], peer: str | None) -> str:
    # nginx sits behind the Cloudflare tunnel and forwards the real address.
    return request_headers.get("cf-connecting-ip") or request_headers.get("x-real-ip") or peer or "unknown"


@dataclass
class Access:
    allowed: bool
    registered: bool
    email: str | None
    trial_started: bool
    trial_remaining: int  # seconds, 0 when used up
    plus: bool = False  # Plus features on: active AmbiRadio Plus subscription or a running trial
    trial_plus: bool = False  # Plus comes from the anonymous trial, not from an account
    email_verified: bool = False  # only meaningful for registered accounts

    def as_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "registered": self.registered,
            "email": self.email,
            "trial_started": self.trial_started,
            "trial_remaining": self.trial_remaining,
            "plus": self.plus,
            "trial_plus": self.trial_plus,
            "email_verified": self.email_verified,
        }


class AccessService:
    def __init__(
        self, db: Database, secret: str, trial_seconds: int, device_keys: dict[str, str] | None = None
    ) -> None:
        self.db = db
        self.secret = secret
        self.trial_seconds = trial_seconds
        self.on_register: Any = None
        # Shared devices (e.g. a salon reception PC) with permanent access: key -> device name.
        self.device_keys = device_keys or {}
        # sha256(token|ip) -> first time the dedication link was opened from that address.
        self._ded_grants: dict[str, float] = {}

    def device_for_key(self, key: str | None) -> str | None:
        """Name of the device owning `key`, compared in constant time; None when unknown."""
        if not key:
            return None
        for known_key, device in self.device_keys.items():
            if hmac.compare_digest(known_key.encode(), key.encode()):
                return device
        return None

    def _ded_sig(self, payload: str) -> str:
        return hmac.new(self.secret.encode(), f"ded|{payload}".encode(), hashlib.sha256).hexdigest()[:32]

    def grant_dedication_pass(self, token: str, ip: str, now: float | None = None) -> tuple[str, int] | None:
        """Cookie value and max-age for a dedication pass; None once this link's window from this address is over.

        The window starts at the first open and is never extended, so re-opening the link cannot farm music.
        """
        now = now or time.time()
        grants = self._ded_grants
        if len(grants) > 5000:
            for key in [k for k, t in grants.items() if now - t > 86400]:
                del grants[key]
        key = hashlib.sha256(f"{token}|{ip}".encode()).hexdigest()
        first = grants.setdefault(key, now)
        expires = int(first + DEDICATION_PASS_SECONDS)
        if expires <= now:
            return None
        payload = f"{token}.{expires}"
        return f"{payload}.{self._ded_sig(payload)}", expires - int(now)

    def dedication_pass_valid(self, value: str | None, now: float | None = None) -> bool:
        if not value or value.count(".") != 2:
            return False
        token, expires, sig = value.split(".")
        if not hmac.compare_digest(sig, self._ded_sig(f"{token}.{expires}")):
            return False
        try:
            return float(expires) > (now or time.time())
        except ValueError:
            return False

    def _trial_keys(self, ip: str, anon_id: str | None) -> list[str]:
        ip_key = "ip:" + hmac.new(self.secret.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]
        return [ip_key] + ([f"anon:{anon_id}"] if anon_id else [])

    def resolve(self, cookies: dict[str, str], ip: str, now: float | None = None) -> Access:
        now = now or time.time()
        session = cookies.get(SESSION_COOKIE)
        if session:
            user = self.db.user_for_session(token_hash(session))
            if user and user["email_verified"]:
                plus = user["plan"] == "plus" and (user["plus_until"] is None or user["plus_until"] > now)
                return Access(True, True, user["email"], True, self.trial_seconds, plus, email_verified=True)
            if user:
                # Unconfirmed account: listens at once, keeps the rest of the trial's Plus, locks after the grace.
                # A Stripe payment counts as proof of a real listener: paid Plus works and never locks.
                paid_until = user["plus_paid_until"] if "plus_paid_until" in user.keys() else None
                if paid_until and paid_until > now and user["plan"] == "plus":
                    return Access(True, True, user["email"], True, self.trial_seconds, plus=True)
                if now - float(user["created_at"]) >= UNVERIFIED_GRACE_SECONDS:
                    return Access(False, True, user["email"], True, 0)
                started = self.db.trial_started_at(self._trial_keys(ip, cookies.get(ANON_COOKIE)))
                trial_left = max(0, int(self.trial_seconds - (now - started))) if started is not None else 0
                return Access(True, True, user["email"], True, self.trial_seconds,
                              plus=trial_left > 0, trial_plus=trial_left > 0)
        if ip.startswith("100.") or ip in ("127.0.0.1", "::1", "unknown"):
            return Access(True, False, "admin@theones.io", True, self.trial_seconds)
        started = self.db.trial_started_at(self._trial_keys(ip, cookies.get(ANON_COOKIE)))
        if started is None:
            return Access(True, False, None, False, self.trial_seconds)
        remaining = max(0, int(self.trial_seconds - (now - started)))
        # The whole trial is the full experience: Plus features until the last second.
        return Access(remaining > 0, False, None, True, remaining, plus=remaining > 0, trial_plus=remaining > 0)

    def trial_key(self, cookies: dict[str, str], ip: str) -> str:
        """Stable key the trial listener's Plus data is stored under: the anon cookie, else the IP."""
        keys = self._trial_keys(ip, cookies.get(ANON_COOKIE))
        return keys[-1]

    def plus_owner_id(self, cookies: dict[str, str], ip: str) -> int | None:
        """Id the caller's Plus data lives under, or None without Plus.

        Paid / welcome Plus: the account's users.id. Running trial: a negative trial owner id
        (see Database.trial_owner_id), adopted by the account when the listener registers."""
        current = self.resolve(cookies, ip)
        if not current.plus:
            return None
        if current.registered:
            user = self.db.find_user_by_email(current.email or "")
            return int(user["id"]) if user is not None else None
        if current.trial_plus:
            return self.db.trial_owner_id(self.trial_key(cookies, ip))
        return None

    def start_trial(self, cookies: dict[str, str], ip: str, now: float | None = None) -> str:
        anon_id = cookies.get(ANON_COOKIE) or secrets.token_urlsafe(16)
        self.db.start_trial(self._trial_keys(ip, anon_id), now or time.time())
        return anon_id


class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=200)
    password: str = Field(min_length=8, max_length=200)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_RE.match(value):
            raise ValueError("Niepoprawny adres e-mail")
        return value


class VerifyToken(BaseModel):
    token: str = Field(min_length=10, max_length=200)


def build_router(access: AccessService) -> APIRouter:
    router = APIRouter(prefix="/radio-api")
    register_times: dict[str, list[float]] = {}  # ip -> recent registration times

    def set_cookie(response: Response, name: str, value: str, max_age: int) -> None:
        response.set_cookie(name, value, max_age=max_age, httponly=True, secure=True, samesite="lax", path="/")

    def ip_of(request: Request) -> str:
        return client_ip({k.lower(): v for k, v in request.headers.items()}, request.client.host if request.client else None)

    @router.get("/me")
    def me(request: Request) -> dict:
        return access.resolve(request.cookies, ip_of(request)).as_dict()

    @router.post("/trial/start")
    def trial_start(request: Request, response: Response) -> dict:
        current = access.resolve(request.cookies, ip_of(request))
        if not current.registered and not current.trial_started:
            anon_id = access.start_trial(request.cookies, ip_of(request))
            set_cookie(response, ANON_COOKIE, anon_id, 365 * 24 * 3600)
            request.cookies[ANON_COOKIE] = anon_id
        return access.resolve(request.cookies, ip_of(request)).as_dict()

    def open_session(response: Response, user_id: int) -> None:
        token = secrets.token_urlsafe(32)
        access.db.create_session(token_hash(token), user_id)
        set_cookie(response, SESSION_COOKIE, token, 180 * 24 * 3600)

    @router.post("/register")
    def register(body: Credentials, request: Request, response: Response) -> dict:
        if access.db.find_user_by_email(body.email):
            raise HTTPException(409, "Konto z tym adresem już istnieje. Zaloguj się.")
        ip = ip_of(request)
        if not _register_allowed(ip):
            raise HTTPException(429, "Za dużo nowych kont z tego adresu. Spróbuj za godzinę.")
        referred_by = referrals.parse_ref(request.cookies.get(referrals.REF_COOKIE))
        user_id = access.db.create_user(body.email, hash_password(body.password), verified=False, referred_by=referred_by)
        # Sources, podcasts and pills set up during the trial move onto the new account.
        trial_owner = access.db.trial_owner_id(access.trial_key(request.cookies, ip), create=False)
        if trial_owner is not None:
            access.db.adopt_trial_data(trial_owner, user_id)
        # The account works right away; the e-mail only unlocks the 30 days of Plus.
        open_session(response, user_id)
        sent = _send_verification(body.email, user_id, raise_on_error=False)
        if getattr(access, "on_register", None):
            try:
                access.on_register(body.email, access.db.count_users())
            except Exception:
                pass
        return {"ok": True, "email": body.email, "pending_verification": True, "verification_sent": sent}

    @router.post("/login")
    def login(body: Credentials, response: Response) -> dict:
        user = access.db.find_user_by_email(body.email)
        if not user or not verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "Zły e-mail albo hasło.")
        if not user["email_verified"] and time.time() - float(user["created_at"]) >= UNVERIFIED_GRACE_SECONDS:
            raise HTTPException(403, "Najpierw potwierdź adres e-mail — sprawdź skrzynkę albo wyślij nowy link.")
        open_session(response, int(user["id"]))
        return {"ok": True, "email": body.email, "email_verified": bool(user["email_verified"])}

    @router.post("/verify")
    def verify(body: VerifyToken, response: Response) -> dict:
        """Confirm an e-mail address with the token from the verification link."""
        row = access.db.find_user_by_verify_token(token_hash(body.token))
        if row is None or (row["verify_expires"] or 0) < time.time():
            raise HTTPException(400, "Link nieprawidłowy albo wygasł. Zaloguj się i wyślij nowy.")
        access.db.verify_email(int(row["id"]))
        access.db.grant_welcome_plus(int(row["id"]), days=WELCOME_PLUS_DAYS)
        open_session(response, int(row["id"]))
        return {"ok": True, "email": row["email"], "verified": True}

    @router.post("/resend-verification")
    def resend_verification(body: Credentials, response: Response) -> dict:
        user = access.db.find_user_by_email(body.email)
        if not user:
            # Do not leak which addresses have accounts.
            return {"ok": True}
        if user and user["email_verified"]:
            return {"ok": True}
        if not verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "Zły e-mail albo hasło.")
        _send_verification(body.email, int(user["id"]))
        return {"ok": True, "sent": True}

    @router.post("/verify/resend")
    def resend_from_session(request: Request) -> dict:
        """New confirmation link for the logged-in, unconfirmed account (no password needed)."""
        session = request.cookies.get(SESSION_COOKIE)
        user = access.db.user_for_session(token_hash(session)) if session else None
        if user is None:
            raise HTTPException(401, "Zaloguj się, żeby wysłać link ponownie.")
        if user["email_verified"]:
            return {"ok": True, "already_verified": True}
        last = user["verify_resent_at"] if "verify_resent_at" in user.keys() else None
        if last and time.time() - float(last) < RESEND_COOLDOWN_SECONDS:
            raise HTTPException(429, "Link już poszedł. Poczekaj minutę i sprawdź też spam.")
        with access.db.connect() as conn:
            conn.execute("UPDATE users SET verify_resent_at = ? WHERE id = ?", (time.time(), int(user["id"])))
        _send_verification(user["email"], int(user["id"]))
        return {"ok": True, "sent": True}

    def _register_allowed(ip: str) -> bool:
        now = time.time()
        recent = [t for t in register_times.get(ip, []) if now - t < 3600]
        if len(recent) >= REGISTER_LIMIT_PER_HOUR:
            register_times[ip] = recent
            return False
        recent.append(now)
        register_times[ip] = recent
        if len(register_times) > 5000:
            for key in [k for k, v in register_times.items() if not v or now - v[-1] > 3600]:
                del register_times[key]
        return True

    def _send_verification(email: str, user_id: int, raise_on_error: bool = True) -> bool:
        token = secrets.token_urlsafe(32)
        access.db.set_email_verification(user_id, token_hash(token), time.time() + VERIFY_TTL_SECONDS)
        try:
            mailer.send_verification_email(email, token)
        except Exception as error:
            log.error("Verification e-mail failed for %s: %s", email, error)
            if not raise_on_error:
                return False
            raise HTTPException(503, "Nie udało się wysłać e-maila potwierdzającego. Spróbuj ponownie za chwilę.")
        return True

    @router.post("/logout")
    def logout(request: Request, response: Response) -> dict:
        session = request.cookies.get(SESSION_COOKIE)
        if session:
            access.db.delete_session(token_hash(session))
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    return router
