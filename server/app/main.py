"""AmbiRadio API: accounts + 1 h trial, AI news per category, shared TTS cache, Lyria RealTime WebSocket proxy.

The Gemini key never leaves the server. Run: uvicorn app.main:app --port 3015
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from typing import Optional
from pathlib import Path

import websockets
from dataclasses import asdict
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .auth import (
    DEDICATION_PASS_COOKIE,
    TRIAL_ENDED_DETAIL,
    UNVERIFIED_ENDED_DETAIL,
    AccessService,
    build_router,
    client_ip,
)
from .config import load_settings
from .db import Database
from .gemini_client import build_gemini_client
from .news import CATEGORIES, NewsService
from .archive import ArchiveRegistry
from .stream import build_stream_router
from .recorder import StationRecorder, STATION_SPECS
from .retention import retention_loop
from .mood import MoodRecorder
from .notifier import trigger_telegram_alert
from .hosts import BORROWED_HOSTS, HOSTS, host_for
from .personal_news import PersonalNews
from .podcast import PodcastService
from .podcast_quota import PodcastQuota
from .plus_api import build_plus_router
from .host_clips import build_router as build_host_clips_router
from .weather import WeatherService
from .voice_routes import build_voice_router
from .aired import build_aired_router
from .orbita_voice import build_orbita_voice_router, prewarm_orbita_voice
from .dedications import build_dedications_router
from .catalog import CatalogService
from .telemetry import TelemetryService
from .auto_ramowka import RamowkaService, build_ramowka_router
from .admin_api import build_admin_router
from .custom_radios import CustomRadioService, build_custom_radios_router
from .og_preview import build_og_router
from .social_api import build_social_router
from .comments import CommentService, build_comments_router
from .custom_radios import resolve_actor_key
from .news import story_headline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("dosradio")

settings = load_settings()
db = Database(settings.data_dir / "dosradio.db")
archives = ArchiveRegistry(settings.data_dir / "archive")
catalog = CatalogService(db, archives)
custom_radios = CustomRadioService(db, catalog)
telemetry = TelemetryService(db)
ramowka_service = RamowkaService(db, catalog, data_dir=settings.data_dir)
access = AccessService(db, settings.secret, settings.trial_seconds, settings.device_keys)
gemini = build_gemini_client(
    settings.gemini_api_key,
    settings.news_model,
    settings.tts_model,
    on_usage=lambda feature, model, inp, out, aud: telemetry.record_tokens(
        feature=feature, model=model, prompt_tokens=inp, output_tokens=out, audio_seconds=aud
    ),
)
news = NewsService(gemini, settings.data_dir / "audio", settings.news_refresh_seconds)
recorder = StationRecorder(
    settings.gemini_api_key,
    archives,
    specs_provider=catalog.active_specs,
    on_segment_recorded=lambda sid, secs: telemetry.record_tokens(
        feature=f"lyria:{sid}", model="lyria-realtime-exp", prompt_tokens=0, output_tokens=0, audio_seconds=secs
    ),
)
mood_recorder = MoodRecorder(settings.gemini_api_key)
podcasts = PodcastService(gemini, settings.data_dir / "podcasts", archives)
podcast_quota = PodcastQuota(db)  # one daily limit shared by the Plus panel and website links
personal = PersonalNews(db, news)
news.on_personal_refresh = personal.refresh_all
weather = WeatherService()
static_audio_dir = settings.data_dir / "audio" / "static"
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
    text = host.greeting if kind == "welcome" else host.jingle
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]  # edited lines are voiced again
    path = static_audio_dir / f"{kind}-{station_id}-{digest}.wav"
    if not path.exists():
        audio = await gemini.speak(text, host.voice, host.style)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(audio)
        tmp.replace(path)
    return path


async def prewarm_hosts() -> None:
    """Voice every host's greeting and jingle in the background (2 files x stations)."""
    for station_id in list(HOSTS) + list(BORROWED_HOSTS):
        for kind in ("welcome", "jingle"):
            try:
                await render_host_audio(station_id, kind)
            except Exception as error:
                log.warning("host audio %s/%s failed: %s", station_id, kind, error)


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [asyncio.create_task(recorder.record_loop())]  # 100h archive per station
    tasks.append(asyncio.create_task(retention_loop(db)))  # 12-month purge promised in prywatnosc.html
    if settings.prewarm:
        tasks.append(asyncio.create_task(news.hourly_loop()))  # one edition per topic per hour
        tasks.append(asyncio.create_task(prewarm_hosts()))
        tasks.append(asyncio.create_task(prewarm_orbita_voice(gemini.speak, static_audio_dir)))
    yield
    recorder.running = False
    for task in tasks:
        task.cancel()
    await gemini.http.aclose()
    await weather.aclose()


app = FastAPI(title="AmbiRadio API", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def device_cors(request: Request, call_next):
    """Let a keyed shared device (kiosk page opened from file://) read JSON responses.

    Only simple GETs carrying a valid ?device= key get the header, so browsers and
    other origins keep the default same-origin behaviour.
    """
    response = await call_next(request)
    if request.method == "GET" and access.device_for_key(request.query_params.get(DEVICE_KEY_QUERY)):
        response.headers["Access-Control-Allow-Origin"] = "*"
    return response


app.include_router(build_router(access))
app.include_router(build_plus_router(access, db, news, podcasts, personal, quota=podcast_quota))
app.include_router(build_host_clips_router(gemini.speak, static_audio_dir))
app.include_router(build_orbita_voice_router(gemini.speak, static_audio_dir))
app.include_router(
    build_dedications_router(
        speak=gemini.speak,
        audio_dir=static_audio_dir,
        db_path=settings.data_dir / "dosradio.db",
        access=access,
        station_lookup=lambda sid: next(
            (s for s in catalog.public_catalog().get("stations", []) if s.get("id") == sid),
            ({"id": sid, "name": sid} if sid in STATION_SPECS else None),
        ),
    )
)
app.include_router(build_ramowka_router(
    db=db,
    catalog=catalog,
    telemetry=telemetry,
    gemini=gemini,
    data_dir=settings.data_dir,
    ramowka_service=ramowka_service,
))
app.include_router(build_admin_router(
    db=db,
    access=access,
    archives=archives,
    catalog=catalog,
    telemetry=telemetry,
    ramowka_service=ramowka_service,
    recorder=recorder,
))
app.include_router(build_custom_radios_router(custom_radios, access=access))
app.include_router(build_social_router(
    db=db,
    access=access,
    podcasts=podcasts,
    quota=podcast_quota,
    station_lookup=lambda sid: next(
        (s for s in catalog.public_catalog().get("stations", []) if s.get("id") == sid),
        ({"id": sid, "name": sid} if sid in STATION_SPECS else None),
    ),
))
def _headline_now() -> str | None:
    """The news topic already in the programme, so hosts can mention what the day is about."""
    queue = news.global_queue()
    return story_headline(queue[0]) if queue else None


comment_service = CommentService(db, generate=gemini.generate_text, headline=_headline_now)
app.include_router(build_comments_router(
    service=comment_service,
    speak=gemini.speak,
    audio_dir=static_audio_dir,
    station_lookup=lambda sid: next(
        (s for s in catalog.public_catalog().get("stations", []) if s.get("id") == sid),
        ({"id": sid, "name": sid} if sid in STATION_SPECS else None),
    ),
    actor_key=lambda request: resolve_actor_key(request, access, db),
))
app.include_router(build_og_router(
    db=db,
    podcasts=podcasts,
    custom_radios=custom_radios,
    station_lookup=lambda sid: next(
        (s for s in catalog.public_catalog().get("stations", []) if s.get("id") == sid),
        ({"id": sid, "name": sid} if sid in STATION_SPECS else None),
    ),
    html_candidates=[
        Path("/var/www/dosradio.theones.io/index.html"),
        Path(__file__).resolve().parents[2] / "dist" / "index.html",
        Path(__file__).resolve().parents[2] / "index.html",
    ],
))

# Billing (Stripe) router — optional module, loaded only when present.
try:
    from .billing import router as _billing_router

    app.include_router(_billing_router)
except ImportError:
    pass


DEVICE_KEY_HEADER = "x-dosradio-device"
DEVICE_KEY_QUERY = "device"


def require_access(request: Request) -> None:
    # Shared devices (salon kiosk) send their key as a header, or as ?device= for
    # <audio> elements that cannot set headers.
    device_key = request.headers.get(DEVICE_KEY_HEADER) or request.query_params.get(DEVICE_KEY_QUERY)
    if access.device_for_key(device_key):
        return
    ip = client_ip({k.lower(): v for k, v in request.headers.items()}, request.client.host if request.client else None)
    if access.dedication_pass_valid(request.cookies.get(DEDICATION_PASS_COOKIE)):
        return
    current = access.resolve(request.cookies, ip)
    if not current.allowed:
        raise HTTPException(402, UNVERIFIED_ENDED_DETAIL if current.registered else TRIAL_ENDED_DETAIL)


app.include_router(build_voice_router(
    require_access, news, gemini, settings.data_dir / "audio" / "voice", weather,
))
app.include_router(build_aired_router(db))


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
    prompt: Optional[str] = None

    @property
    def text(self) -> str:
        return (self.mood or self.description or self.prompt or "").strip()


@app.post("/radio-api/mood")
async def generate_mood_station(body: MoodRequest, request: Request) -> dict:
    """Translate user's described mood (Polish text) into tailored music parameters and prompt."""
    require_access(request)
    user_mood = body.text
    if not user_mood:
        raise HTTPException(400, "Podaj opis nastroju")
    if body.prompt:
        mood_id = mood_recorder.start(body.prompt.strip())
        session = mood_recorder.session(mood_id)
        session.task = asyncio.create_task(mood_recorder.record(mood_id))
        return {"id": mood_id}
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
        raw = await gemini.generate_text(prompt, feature="mood")
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



@app.get("/radio-api/station/{mood_id}/part/{number}.ogg")
def mood_part(mood_id: str, number: int) -> Response:
    session = mood_recorder.session(mood_id)
    if session is None:
        raise HTTPException(404, "Nie ma takiego nastroju")
    audio = session.part_ogg(number)
    if audio is None:
        raise HTTPException(425, "Nagranie jeszcze nie ma 30 sekund")
    return Response(content=audio, media_type="audio/ogg; codecs=opus")



@app.get("/radio-api/hosts")
def list_hosts() -> dict:
    all_stations = list(HOSTS.keys()) + list(BORROWED_HOSTS.keys())
    return {sid: {"name": host_for(sid).name} for sid in all_stations}


@app.api_route("/radio-api/welcome/{station_id}.wav", methods=["GET", "HEAD"])
async def welcome_audio(station_id: str) -> FileResponse:
    if station_id not in HOSTS and station_id not in BORROWED_HOSTS:
        raise HTTPException(404, "no such station")
    try:
        path = await render_host_audio(station_id, "welcome")
    except Exception as error:
        raise HTTPException(502, f"Nie udało się nagrać powitania: {error}") from error
    return FileResponse(path, media_type="audio/wav", headers={"cache-control": "public, max-age=604800"})


@app.api_route("/radio-api/jingle/{station_id}.wav", methods=["GET", "HEAD"])
async def jingle_audio(station_id: str) -> FileResponse:
    if station_id not in HOSTS and station_id not in BORROWED_HOSTS:
        raise HTTPException(404, "no such station")
    try:
        path = await render_host_audio(station_id, "jingle")
    except Exception as error:
        raise HTTPException(502, f"Nie udało się nagrać dżingla: {error}") from error
    return FileResponse(path, media_type="audio/wav", headers={"cache-control": "public, max-age=604800"})


app.include_router(
    build_stream_router(
        archives,
        require_access,
        group_resolver=lambda gid: [s["id"] for s in catalog.stations_in_group(gid, only_enabled=True)],
    )
)

@app.api_route("/radio-api/station/{station_id}/next-chunk", methods=["GET", "HEAD"])
async def next_station_chunk(
    request: Request,
    station_id: str,
    live_prob: float = Query(0.3, ge=0.0, le=1.0),
    after: Optional[str] = Query(None, pattern=r"^seg-\d+\.opus$"),
) -> FileResponse:
    """Next 30-second Opus segment for a listener: continues the recording after `after`, else 70/30 jump."""
    require_access(request)
    if station_id not in STATION_SPECS and catalog.get_station(station_id) is None:
        raise HTTPException(404, f"Nieznana stacja: {station_id}")
    arch = archives.get(station_id)
    path, is_live = arch.pick_next(live_probability=live_prob, after=after)
    if not path or not path.exists():
        fallback_sid = BORROWED_HOSTS.get(station_id, (None, None))[0]
        if fallback_sid:
            arch = archives.get(fallback_sid)
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
    requested = cats.split(",")
    wanted = [c for c in requested if c in CATEGORIES][:len(CATEGORIES)]
    wants_personal = PERSONAL_CATEGORY in requested
    if not wanted and not wants_personal:
        raise HTTPException(400, "Wybierz przynajmniej jedną kategorię wiadomości.")
    # Editions are produced by news.hourly_loop; a topic with no edition yet is fetched once here.
    missing = [c for c in wanted if not news.cache[c].stories]
    if missing:
        await asyncio.gather(*(news.ensure(c) for c in missing))
    groups = [news.public(c) for c in wanted]
    if wants_personal:
        groups.append(await personal_group(request))
    return {"categories": groups}


PERSONAL_CATEGORY = "mine"


async def personal_group(request: Request) -> dict:
    """The listener's own RSS feeds and keywords as one more news topic (Plus only)."""
    group = {"category": PERSONAL_CATEGORY, "label": "Moje źródła", "fetched_at": time.time(),
             "edition": None, "error": None, "stories": []}
    ip = client_ip({k.lower(): v for k, v in request.headers.items()}, request.client.host if request.client else None)
    owner_id = access.plus_owner_id(request.cookies, ip)  # account or running trial
    if owner_id is None:
        group["error"] = "Własne źródła są w AmbiRadio Plus."
        return group
    prefs = db.get_news_preferences(owner_id) or {}
    if not prefs.get("rss_feeds") and not prefs.get("keywords"):
        group["error"] = "Dodaj kanał RSS w panelu Plus."
        return group
    is_personal, stories = await personal.digest(owner_id, prefs)
    if not is_personal:
        group["error"] = "Twoje kanały teraz nie odpowiadają."
        return group
    group["stories"] = [asdict(story) for story in stories]
    return group


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
