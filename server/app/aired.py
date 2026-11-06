"""Ramówka aired ledger: stories a registered listener already heard today, merged across devices."""
from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from .auth import SESSION_COOKIE, token_hash
from .db import Database

MAX_IDS_PER_DAY = 500
ITEM_ID_PATTERN = re.compile(r"[A-Za-z0-9._:-]{1,80}")
DAY_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_day(value: str) -> str:
    if not DAY_PATTERN.fullmatch(value):
        raise ValueError("day must be YYYY-MM-DD")
    date.fromisoformat(value)
    return value


class AiredBody(BaseModel):
    day: str
    ids: list[str] = Field(default_factory=list, max_length=MAX_IDS_PER_DAY)

    @field_validator("day")
    @classmethod
    def check_day(cls, value: str) -> str:
        return parse_day(value)

    @field_validator("ids")
    @classmethod
    def check_ids(cls, values: list[str]) -> list[str]:
        if not all(ITEM_ID_PATTERN.fullmatch(item) for item in values):
            raise ValueError("bad item id")
        return values


def build_aired_router(db: Database) -> APIRouter:
    router = APIRouter(prefix="/radio-api")

    def listener_id(request: Request) -> int:
        token = request.cookies.get(SESSION_COOKIE)
        user = db.user_for_session(token_hash(token)) if token else None
        if user is None or not user["email_verified"]:
            raise HTTPException(401, "Zaloguj się, żeby zapisać postęp ramówki.")
        return int(user["id"])

    @router.get("/aired")
    def get_aired(request: Request, day: str = Query(...)) -> dict:
        user_id = listener_id(request)
        try:
            checked = parse_day(day)
        except ValueError:
            raise HTTPException(400, "Zła data, podaj dzień w formacie RRRR-MM-DD.")
        return {"day": checked, "ids": db.aired_ids(user_id, checked)}

    @router.post("/aired")
    def post_aired(body: AiredBody, request: Request) -> dict:
        user_id = listener_id(request)
        merged = sorted(set(db.aired_ids(user_id, body.day)) | set(body.ids))
        if len(merged) > MAX_IDS_PER_DAY:
            raise HTTPException(400, "Za dużo wiadomości jak na jeden dzień.")
        db.add_aired_ids(user_id, body.day, body.ids)
        return {"day": body.day, "ids": merged}

    return router
