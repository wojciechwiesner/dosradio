"""Ramówka voice endpoints: intro, headline, teaser, outro and weather lines, each voiced once and cached."""
from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse

from .hosts import BORROWED_HOSTS, DEFAULT_HOST_STATION, HOSTS, host_for, intro_line
from .news import NewsService, Story, story_headline
from .radio_script import OUTRO_PHRASES, intro_script, outro_script, teaser_script
from .spoken_time import spoken_time_pl
from .weather import CityNotFound, Weather, WeatherService, WeatherUnavailable

TIME_RE = re.compile(r"([01]\d|2[0-3]):([0-5]\d)")
STORY_ID_RE = re.compile(r"[0-9a-f]{12}")
CITY_MAX_CHARS = 80
AUDIO_HEADERS = {"cache-control": "private, max-age=86400"}


def _known_story(news: NewsService, story_id: str) -> Story:
    if not STORY_ID_RE.fullmatch(story_id):
        raise HTTPException(400, "bad id")
    story = news.find(story_id)
    if story is None:
        raise HTTPException(404, "Nie ma takiej wiadomości.")
    return story


def _known_station(station: str) -> None:
    if station not in HOSTS and station not in BORROWED_HOSTS:
        raise HTTPException(400, "Nieznana stacja.")


def _location_or_400(lat: Optional[float], lon: Optional[float], city: Optional[str]) -> Optional[str]:
    city = city.strip() if city else None
    if (lat is None) != (lon is None):
        raise HTTPException(400, "Podaj szerokość i długość razem.")
    if lat is None and not city:
        raise HTTPException(400, "Podaj miejscowość albo lokalizację.")
    return city


async def _weather_or_error(weather: WeatherService, lat: Optional[float], lon: Optional[float], city: Optional[str]) -> Weather:
    try:
        return await weather.current(lat, lon, city)
    except CityNotFound:
        raise HTTPException(404, "Nie znam takiej miejscowości.")
    except WeatherUnavailable:
        raise HTTPException(502, "Pogoda chwilowo niedostępna.")


def build_voice_router(
    require_access: Callable[[Request], None],
    news: NewsService,
    client: Any,
    voice_dir: Path,
    weather: WeatherService,
) -> APIRouter:
    router = APIRouter(prefix="/radio-api")
    voice_dir.mkdir(parents=True, exist_ok=True)

    async def voiced(path: Path, text: str, station: str) -> FileResponse:
        if not path.exists():
            host = host_for(station)
            try:
                audio = await client.speak(text, host.voice, host.style)
            except Exception as error:
                raise HTTPException(502, f"Nie udało się nagrać: {error}") from error
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(audio)
            tmp.replace(path)
        return FileResponse(path, media_type="audio/wav", headers=AUDIO_HEADERS)

    @router.get("/intro.wav")
    async def intro_audio(
        request: Request,
        time_hm: str = Query(..., alias="time"),
        station: str = Query(DEFAULT_HOST_STATION),
        kind: Optional[str] = Query(None, pattern=r"^(flash|main|hourly)$"),
    ) -> FileResponse:
        """Spoken time by the station host, cached per station, minute and kind."""
        require_access(request)
        match = TIME_RE.fullmatch(time_hm)
        if not match:
            raise HTTPException(400, "bad time")
        _known_station(station)
        suffix = f"-{kind}" if kind else ""
        text = intro_script(kind, spoken_time_pl(int(match.group(1)), int(match.group(2))), intro_line(station))
        return await voiced(voice_dir / f"intro-{station}-{time_hm.replace(':', '')}{suffix}.wav", text, station)

    @router.api_route("/story/{story_id}/headline.wav", methods=["GET", "HEAD"])
    async def headline_audio(request: Request, story_id: str) -> FileResponse:
        require_access(request)
        story = _known_story(news, story_id)
        try:
            path = await news.render_headline(story)
        except Exception as error:
            raise HTTPException(502, f"Nie udało się nagrać nagłówka: {error}") from error
        return FileResponse(path, media_type="audio/wav", headers=AUDIO_HEADERS)

    @router.api_route("/teaser.wav", methods=["GET", "HEAD"])
    async def teaser_audio(
        request: Request,
        story: str = Query(...),
        station: str = Query(DEFAULT_HOST_STATION),
    ) -> FileResponse:
        require_access(request)
        known = _known_story(news, story)
        _known_station(station)
        text = teaser_script(story_headline(known), known.id)
        return await voiced(voice_dir / f"teaser-{station}-{known.id}.wav", text, station)

    @router.api_route("/outro.wav", methods=["GET", "HEAD"])
    async def outro_audio(
        request: Request,
        station: str = Query(DEFAULT_HOST_STATION),
        variant: int = Query(0, ge=0, le=len(OUTRO_PHRASES) - 1),
    ) -> FileResponse:
        require_access(request)
        _known_station(station)
        return await voiced(voice_dir / f"outro-{station}-{variant}.wav", outro_script(variant), station)

    @router.get("/weather")
    async def weather_now(
        request: Request,
        lat: Optional[float] = Query(None, ge=-90, le=90),
        lon: Optional[float] = Query(None, ge=-180, le=180),
        city: Optional[str] = Query(None, max_length=CITY_MAX_CHARS),
    ) -> dict:
        require_access(request)
        place = _location_or_400(lat, lon, city)
        return (await _weather_or_error(weather, lat, lon, place)).as_dict()

    @router.api_route("/weather.wav", methods=["GET", "HEAD"])
    async def weather_audio(
        request: Request,
        lat: Optional[float] = Query(None, ge=-90, le=90),
        lon: Optional[float] = Query(None, ge=-180, le=180),
        city: Optional[str] = Query(None, max_length=CITY_MAX_CHARS),
        station: str = Query(DEFAULT_HOST_STATION),
    ) -> FileResponse:
        require_access(request)
        place = _location_or_400(lat, lon, city)
        _known_station(station)
        report = await _weather_or_error(weather, lat, lon, place)
        city_key = hashlib.sha1(report.city.encode()).hexdigest()[:12]
        hour_key = time.strftime("%Y%m%d%H")
        return await voiced(voice_dir / f"weather-{station}-{city_key}-{hour_key}.wav", report.text, station)

    return router
