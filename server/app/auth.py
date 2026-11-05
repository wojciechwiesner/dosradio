"""Accounts, cookies and the listening allowance (10 min trial, then registration)."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from .db import Database

SESSION_COOKIE = "dr_session"
ANON_COOKIE = "dr_anon"
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

    def as_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "registered": self.registered,
            "email": self.email,
            "trial_started": self.trial_started,
            "trial_remaining": self.trial_remaining,
        }


class AccessService:
    def __init__(self, db: Database, secret: str, trial_seconds: int) -> None:
        self.db = db
        self.secret = secret
        self.trial_seconds = trial_seconds
        self.on_register: Any = None

    def _trial_keys(self, ip: str, anon_id: str | None) -> list[str]:
        ip_key = "ip:" + hmac.new(self.secret.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]
        return [ip_key] + ([f"anon:{anon_id}"] if anon_id else [])

    def resolve(self, cookies: dict[str, str], ip: str, now: float | None = None) -> Access:
        now = now or time.time()
        session = cookies.get(SESSION_COOKIE)
        if session:
            user = self.db.user_for_session(token_hash(session))
            if user:
                return Access(True, True, user["email"], True, self.trial_seconds)
        started = self.db.trial_started_at(self._trial_keys(ip, cookies.get(ANON_COOKIE)))
        if started is None:
            return Access(True, False, None, False, self.trial_seconds)
        remaining = max(0, int(self.trial_seconds - (now - started)))
        return Access(remaining > 0, False, None, True, remaining)

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


def build_router(access: AccessService) -> APIRouter:
    router = APIRouter(prefix="/radio-api")

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
    def register(body: Credentials, response: Response) -> dict:
        if access.db.find_user_by_email(body.email):
            raise HTTPException(409, "Konto z tym adresem już istnieje. Zaloguj się.")
        user_id = access.db.create_user(body.email, hash_password(body.password))
        open_session(response, user_id)
        if getattr(access, "on_register", None):
            try:
                access.on_register(body.email, access.db.count_users())
            except Exception:
                pass
        return {"ok": True, "email": body.email}

    @router.post("/login")
    def login(body: Credentials, response: Response) -> dict:
        user = access.db.find_user_by_email(body.email)
        if not user or not verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "Zły e-mail albo hasło.")
        open_session(response, int(user["id"]))
        return {"ok": True, "email": body.email}

    @router.post("/logout")
    def logout(request: Request, response: Response) -> dict:
        session = request.cookies.get(SESSION_COOKIE)
        if session:
            access.db.delete_session(token_hash(session))
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    return router
