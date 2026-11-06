"""DOS Radio Plus endpoints: duet podcasts, YouTube pills and personalized news sources.

Every route requires a registered listener with an active Plus subscription
(HTTP 402 otherwise). Mounted by app.main through build_plus_router.
"""
from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .auth import AccessService, client_ip
from .db import Database
from .news import NewsService
from .personal_news import PersonalNews, PreferenceError, validate_preferences
from .pill_service import PillService
from .podcast import PodcastService
from .youtube_pill import PillError

log = logging.getLogger("dosradio.plus")
PLUS_MESSAGE = "Ta funkcja jest częścią DOS Radio Plus."


class PodcastRequest(BaseModel):
    topic: Optional[str] = Field(None, max_length=200)


class PillRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=300)


class PreferencesBody(BaseModel):
    keywords: list[str] = Field(default_factory=list)
    rss_feeds: list[str] = Field(default_factory=list)


def build_plus_router(access: AccessService, db: Database, news: NewsService,
                      podcasts: PodcastService, personal: PersonalNews,
                      pills: PillService | None = None) -> APIRouter:
    if pills is None:  # shares the podcast client, archive and (late-bound) process runner
        pills = PillService(podcasts.client, podcasts.dir.parent / "pills", podcasts.archives,
                            podcasts.station_id, run=lambda args, timeout: podcasts.run(args, timeout))
    router = APIRouter(prefix="/radio-api/plus")

    def require_plus(request: Request) -> int:
        """Active Plus subscription required; returns the caller's user id."""
        ip = client_ip({k.lower(): v for k, v in request.headers.items()},
                       request.client.host if request.client else None)
        current = access.resolve(request.cookies, ip)
        if not current.registered or not current.plus:
            raise HTTPException(402, PLUS_MESSAGE)
        user = db.find_user_by_email(current.email or "")
        if user is None:
            raise HTTPException(401, "Sesja nieprawidłowa. Zaloguj się ponownie.")
        return int(user["id"])

    # --- podcasts ---------------------------------------------------------------
    @router.post("/podcast")
    async def create_podcast(body: PodcastRequest, request: Request) -> dict:
        require_plus(request)
        topic = (body.topic or "").strip() or None
        headlines = [story.title for story in news.cache["ai"].stories[:1]]
        try:
            return await podcasts.episode(topic, headlines=headlines)
        except Exception as error:
            log.warning("podcast generation failed: %s: %s", type(error).__name__, error)
            raise HTTPException(502, "Nie udało się wygenerować podcastu. Spróbuj ponownie za chwilę.") from error

    @router.get("/podcast/{episode_id}")
    def get_podcast(episode_id: str, request: Request) -> dict:
        require_plus(request)
        manifest = podcasts.load_manifest(episode_id)
        if manifest is None:
            raise HTTPException(404, "Nie ma takiego podcastu.")
        return manifest

    @router.get("/podcast/{episode_id}/{file_name}")
    def podcast_part(episode_id: str, file_name: str, request: Request) -> FileResponse:
        require_plus(request)
        try:
            path = podcasts.part_path(episode_id, file_name)
        except FileNotFoundError:
            raise HTTPException(404, "Nie ma takiego fragmentu.")
        media = "audio/wav" if file_name.endswith(".wav") else "audio/ogg; codecs=opus"
        return FileResponse(path, media_type=media, headers={"cache-control": "private, max-age=86400"})

    # --- YouTube pill ---------------------------------------------------------------------
    def pill_view(job: dict) -> dict:
        return {key: job[key] for key in ("id", "status", "title", "author", "source_url", "parts", "error")}

    @router.post("/pill")
    async def create_pill(body: PillRequest, request: Request, background: BackgroundTasks) -> dict:
        require_plus(request)
        try:
            job = pills.submit(body.url)
        except PillError as error:
            raise HTTPException(422, str(error)) from error
        if job["status"] == "queued":
            background.add_task(pills.process, job["id"])
        return {"id": job["id"], "status": job["status"]}

    @router.get("/pill/{pill_id}")
    def get_pill(pill_id: str, request: Request) -> dict:
        require_plus(request)
        job = pills.get(pill_id)
        if job is None:
            raise HTTPException(404, "Nie ma takiej pigułki.")
        return pill_view(job)

    @router.get("/pill/{video_id}/{file_name}")
    def pill_part(video_id: str, file_name: str, request: Request) -> FileResponse:
        require_plus(request)
        try:
            path = pills.part_path(video_id, file_name)
        except FileNotFoundError:
            raise HTTPException(404, "Nie ma takiego fragmentu.")
        media = "audio/wav" if file_name.endswith(".wav") else "audio/ogg; codecs=opus"
        return FileResponse(path, media_type=media, headers={"cache-control": "private, max-age=86400"})

    # --- personalized news ---------------------------------------------------------
    @router.put("/news-preferences")
    def put_news_preferences(body: PreferencesBody, request: Request) -> dict:
        user_id = require_plus(request)
        try:
            keywords, rss_feeds = validate_preferences(body.keywords, body.rss_feeds)
        except PreferenceError as error:
            raise HTTPException(422, str(error)) from error
        updated_at = db.set_news_preferences(user_id, keywords, rss_feeds)
        return {"keywords": keywords, "rss_feeds": rss_feeds, "updated_at": updated_at}

    @router.get("/news-preferences")
    def get_news_preferences(request: Request) -> dict:
        user_id = require_plus(request)
        stored = db.get_news_preferences(user_id)
        return stored or {"keywords": [], "rss_feeds": [], "updated_at": 0.0}

    @router.get("/news-digest")
    async def news_digest(request: Request) -> dict:
        user_id = require_plus(request)
        prefs = db.get_news_preferences(user_id) or {"keywords": [], "rss_feeds": []}
        if not prefs["keywords"] and not prefs["rss_feeds"]:
            return {"personal": False, "fallback": False, "stories": []}
        try:
            is_personal, stories = await personal.digest(user_id, prefs)
        except Exception as error:
            log.warning("digest failed for user %s: %s", user_id, error)
            raise HTTPException(502, "Nie udało się pobrać twoich źródeł. Spróbuj ponownie za chwilę.") from error
        return {
            "personal": is_personal,
            "fallback": not is_personal,
            "stories": [asdict(story) for story in stories],
        }

    return router
