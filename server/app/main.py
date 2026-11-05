"""DOS Radio API: accounts + 10 min trial, AI news per category, shared TTS cache, Lyria RealTime WebSocket proxy.

The Gemini key never leaves the server. Run: uvicorn app.main:app --port 3015
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from typing import Optional
from pathlib import Path

import websockets
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .auth import AccessService, build_router, client_ip
from .config import load_settings
from .db import Database
from .news import CATEGORIES, GeminiClient, NewsService
from .spoken_time import spoken_time_pl
from .archive import ArchiveRegistry
from .recorder import StationRecorder, STATION_SPECS
from .notifier import trigger_telegram_alert
from .hosts import HOSTS, host_for, intro_line
from .personal_news import PersonalNews
from .podcast import PodcastService
from .plus_api import build_plus_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("dosradio")

settings = load_settings()
db = Database(settings.data_dir / "dosradio.db")
access = AccessService(db, settings.secret, settings.trial_seconds)
gemini = GeminiClient(settings.gemini_api_key, settings.news_model, settings.tts_model)
news = NewsService(gemini, settings.data_dir / "audio", settings.news_refresh_seconds)
archives = ArchiveRegistry(settings.data_dir / "archive")
recorder = StationRecorder(settings.gemini_api_key, archives)
podcasts = PodcastService(gemini, settings.data_dir / "podcasts", archives)
personal = PersonalNews(db, news)
news.on_personal_refresh = personal.refresh_all
intro_dir = settings.data_dir / "audio" / "intro"
static_audio_dir = settings.data_dir / "audio" / "static"
intro_dir.mkdir(parents=True, exist_ok=True)
static_audio_dir.mkdir(parents=True, exist_ok=True)

# Notify on Telegram when a listener registers
def handle_new_user(email: str, count: int) -> None:
    total_hours = sum(a.total_hours() for a in archives.archives.values())
    trigger_telegram_alert(email, count, total_hours)

access.on_register = handle_new_user

LYRIA_UPSTREAM = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic"
started_at = time.time()


async def render_host_audio(station_id: str, kind: str) -> Path:
    """Greeting or jingle for one station host, voiced once and cached forever."""
    host = host_for(station_id)
    path = static_audio_dir / f"{kind}-{station_id}.wav"
    if not path.exists():
        text = host.greeting if kind == "welcome" else host.jingle
        audio = await gemini.speak(text, host.voice, host.style)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(audio)
        tmp.replace(path)
    return path


async def prewarm_hosts() -> None:
    """Voice every host's greeting and jingle in the background (2 files x stations)."""
    for station_id in HOSTS:
        for kind in ("welcome", "jingle"):
            try:
                await render_host_audio(station_id, kind)
            except Exception as error:
                log.warning("host audio %s/%s failed: %s", station_id, kind, error)


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [asyncio.create_task(recorder.record_loop())]  # 100h archive per station
    if settings.prewarm:
        tasks.append(asyncio.create_task(news.hourly_loop()))  # one edition per topic per hour
        tasks.append(asyncio.create_task(prewarm_hosts()))
    yield
    recorder.running = False
    for task in tasks:
        task.cancel()
    await gemini.http.aclose()


app = FastAPI(title="DOS Radio API", lifespan=lifespan, docs_url=None, redoc_url=None)
app.include_router(build_router(access))
app.include_router(build_plus_router(access, db, news, podcasts, personal))

# Billing (Stripe) router — optional module, loaded only when present.
try:
    from .billing import router as _billing_router

    app.include_router(_billing_router)
except ImportError:
    pass


def require_access(request: Request) -> None:
    ip = client_ip({k.lower(): v for k, v in request.headers.items()}, request.client.host if request.client else None)
    if not access.resolve(request.cookies, ip).allowed:
        raise HTTPException(402, "Darmowe 10 minut minęło. Załóż konto, żeby słuchać dalej.")


@app.get("/radio-api/health")
def health() -> dict:
    """Health panel: cache state per category, archive stats per station, users, uptime."""
    return {
        "ok": True,
        "uptime_s": int(time.time() - started_at),
        "users": db.count_users(),
        "recorder": {
            "current_station": recorder.current_station,
            "total_recorded_segments": recorder.total_recorded_segments,
        },
        "archive": archives.stats(),
        "categories": {
            name: {
                "stories": len(cache.stories),
                "audio_ready": sum(1 for s in cache.stories if s.audio_ready),
                "age_s": int(time.time() - cache.fetched_at) if cache.fetched_at else None,
                "error": cache.error,
            }
            for name, cache in news.cache.items()
        },
    }


@app.get("/radio-api/categories")
def categories() -> list[dict]:
    return [{"id": key, "label": spec["label"]} for key, spec in CATEGORIES.items()]


class MoodRequest(BaseModel):
    mood: Optional[str] = None
    description: Optional[str] = None

    @property
    def text(self) -> str:
        return (self.mood or self.description or "").strip()


@app.post("/radio-api/mood")
async def generate_mood_station(body: MoodRequest, request: Request) -> dict:
    """Translate user's described mood (Polish text) into tailored music parameters and prompt."""
    require_access(request)
    user_mood = body.text
    if not user_mood:
        raise HTTPException(400, "Podaj opis nastroju")
    prompt = (
        f"Użytkownik radia opisał swój nastrój: \"{user_mood}\".\n"
        "Przekształć ten opis w parametry dla generatora muzyki instrumentalnej (Lyria RealTime):\n"
        "1. name: krótka, zwięzła nazwa stacji po polsku (max 3 słowa, np. 'Deszczowy Trans', 'Poranny Fokus')\n"
        "2. tagline: jedno krótkie zdanie po polsku opisujące klimat\n"
        "3. prompt: precyzyjny prompt po angielsku (4-12 słów) z instrumentami, tempem i nastrojem, kończący się słowem 'instrumental'\n"
        "4. bpm: liczba całkowita od 60 do 175\n"
        "5. density: liczba zmiennoprzecinkowa 0.2 - 0.7\n"
        "6. brightness: liczba zmiennoprzecinkowa 0.2 - 0.7\n\n"
        "Zwróć WYŁĄCZNIE czysty JSON: {\"name\": \"...\", \"tagline\": \"...\", \"prompt\": \"...\", \"bpm\": 120, \"density\": 0.5, \"brightness\": 0.5}"
    )
    try:
        data = await gemini._call(settings.news_model, {"contents": [{"parts": [{"text": prompt}]}]})
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        raw = "".join(p.get("text", "") for p in parts)
        s, e = raw.find("{"), raw.rfind("}")
        parsed = json.loads(raw[s:e+1])
        # Validate and clamp
        bpm = max(60, min(175, int(parsed.get("bpm", 120))))
        density = max(0.15, min(0.8, float(parsed.get("density", 0.45))))
        brightness = max(0.15, min(0.8, float(parsed.get("brightness", 0.45))))
        return {
            "id": f"custom-{int(time.time())}",
            "name": str(parsed.get("name", "Twój Nastrój"))[:40],
            "tagline": str(parsed.get("tagline", body.mood))[:80],
            "prompt": str(parsed.get("prompt", "deep atmospheric instrumental")),
            "bpm": bpm,
            "density": density,
            "brightness": brightness,
        }
    except Exception as err:
        log.warning("Mood generation failed: %s", err)
        raise HTTPException(502, "Nie udało się skomponować nastroju. Spróbuj innego opisu.")


@app.get("/radio-api/hosts")
def list_hosts() -> dict:
    return {station_id: {"name": host.name} for station_id, host in HOSTS.items()}


@app.api_route("/radio-api/welcome/{station_id}.wav", methods=["GET", "HEAD"])
async def welcome_audio(station_id: str) -> FileResponse:
    if station_id not in HOSTS:
        raise HTTPException(404, "no such station")
    try:
        path = await render_host_audio(station_id, "welcome")
    except Exception as error:
        raise HTTPException(502, f"Nie udało się nagrać powitania: {error}") from error
    return FileResponse(path, media_type="audio/wav", headers={"cache-control": "public, max-age=604800"})


@app.api_route("/radio-api/jingle/{station_id}.wav", methods=["GET", "HEAD"])
async def jingle_audio(station_id: str) -> FileResponse:
    if station_id not in HOSTS:
        raise HTTPException(404, "no such station")
    try:
        path = await render_host_audio(station_id, "jingle")
    except Exception as error:
        raise HTTPException(502, f"Nie udało się nagrać dżingla: {error}") from error
    return FileResponse(path, media_type="audio/wav", headers={"cache-control": "public, max-age=604800"})


@app.api_route("/radio-api/station/{station_id}/next-chunk", methods=["GET", "HEAD"])
async def next_station_chunk(
    request: Request,
    station_id: str,
    live_prob: float = Query(0.3, ge=0.0, le=1.0),
    after: Optional[str] = Query(None, pattern=r"^seg-\d+\.opus$"),
) -> FileResponse:
    """Next 30-second Opus segment for a listener: continues the recording after `after`, else 70/30 jump."""
    require_access(request)
    if station_id not in STATION_SPECS:
        raise HTTPException(404, f"Nieznana stacja: {station_id}")
    arch = archives.get(station_id)
    path, is_live = arch.pick_next(live_probability=live_prob, after=after)
    if not path or not path.exists():
        raise HTTPException(503, "Stacja nagrywa pierwsze segmenty, spróbuj za chwilę.")
    return FileResponse(
        path,
        media_type="audio/ogg; codecs=opus",
        headers={
            "cache-control": "no-cache",
            "x-dosradio-source": "live" if is_live else "archive",
            "x-dosradio-hours": str(arch.total_hours()),
            "x-dosradio-segment": path.name,
            "access-control-expose-headers": "x-dosradio-source, x-dosradio-hours, x-dosradio-segment",
        },
    )


@app.get("/radio-api/news")
async def get_news(request: Request, cats: str = Query("ai")) -> dict:
    require_access(request)
    wanted = [c for c in cats.split(",") if c in CATEGORIES][:len(CATEGORIES)]
    if not wanted:
        raise HTTPException(400, "Wybierz przynajmniej jedną kategorię wiadomości.")
    # Editions are produced by news.hourly_loop; a topic with no edition yet is fetched once here.
    missing = [c for c in wanted if not news.cache[c].stories]
    if missing:
        await asyncio.gather(*(news.ensure(c) for c in missing))
    return {"categories": [news.public(c) for c in wanted]}


@app.get("/radio-api/story/{story_id}.wav")
async def story_audio(request: Request, story_id: str) -> FileResponse:
    require_access(request)
    if not re.fullmatch(r"[0-9a-f]{12}", story_id):
        raise HTTPException(400, "bad id")
    story = news.find(story_id)
    path = news.audio_path(story_id)
    if not path.exists():
        if not story:
            raise HTTPException(404, "Nie ma takiej wiadomości.")
        try:
            path = await news.render_story(story)
        except Exception as error:
            raise HTTPException(502, f"Nie udało się nagrać wiadomości: {error}") from error
    return FileResponse(path, media_type="audio/wav", headers={"cache-control": "private, max-age=86400"})


@app.get("/radio-api/intro.wav")
async def intro_audio(request: Request, time_hm: str = Query(..., alias="time"), station: str = Query("dos-groove")) -> FileResponse:
    """Spoken time by the station host ('Czternasta dwadzieścia. Z tej strony Kuba, DOS Groove...'), cached for all."""
    require_access(request)
    match = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", time_hm)
    if not match or station not in HOSTS:
        raise HTTPException(400, "bad time or station")
    host = host_for(station)
    path = intro_dir / f"{station}-{time_hm.replace(':', '')}.wav"
    if not path.exists():
        text = f"{spoken_time_pl(int(match.group(1)), int(match.group(2))).capitalize()}. {intro_line(station)}"
        try:
            audio = await gemini.speak(text, host.voice, host.style)
        except Exception as error:
            raise HTTPException(502, f"Nie udało się nagrać zapowiedzi: {error}") from error
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(audio)
        tmp.replace(path)
    return FileResponse(path, media_type="audio/wav", headers={"cache-control": "private, max-age=86400"})


@app.websocket("/radio-ws/lyria/ws/{rest:path}")
async def lyria_proxy(client: WebSocket, rest: str) -> None:
    """Relay the browser's Lyria RealTime session to Google, adding the server key. Closes when the trial ends."""
    ip = client_ip({k.lower(): v for k, v in client.headers.items()}, client.client.host if client.client else None)
    current = access.resolve(client.cookies, ip)
    await client.accept()
    if not current.allowed:
        await client.close(code=4402, reason="trial-ended")
        return
    deadline = None if current.registered else time.time() + current.trial_remaining
    upstream_url = f"{LYRIA_UPSTREAM}?key={settings.gemini_api_key}"
    try:
        async with websockets.connect(upstream_url, max_size=None, open_timeout=20) as upstream:
            async def browser_to_google() -> None:
                while True:
                    message = await client.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("text") is not None:
                        await upstream.send(message["text"])
                    elif message.get("bytes") is not None:
                        await upstream.send(message["bytes"])

            async def google_to_browser() -> None:
                async for frame in upstream:
                    if isinstance(frame, bytes):
                        await client.send_bytes(frame)
                    else:
                        await client.send_text(frame)

            async def trial_guard() -> None:
                if deadline is None:
                    await asyncio.Event().wait()
                    return
                await asyncio.sleep(max(0.0, deadline - time.time()))

            tasks = [asyncio.create_task(t()) for t in (browser_to_google, google_to_browser, trial_guard)]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            if tasks[2] in done:
                await client.close(code=4402, reason="trial-ended")
                return
    except WebSocketDisconnect:
        return
    except Exception as error:
        log.warning("lyria proxy error: %s", error)
    try:
        await client.close()
    except Exception:
        pass
