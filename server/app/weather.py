"""Weather for a listener's place: Open-Meteo forecast and geocoding, Nominatim reverse lookup, 30 min cache."""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

import httpx

from .radio_script import weather_script

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "DOSRadio/1.5 (+https://dosradio.theones.io)"
CACHE_SECONDS = 30 * 60
COORD_DECIMALS = 2
REQUEST_TIMEOUT_S = 10.0
FALLBACK_PLACE = "twoja okolica"
DEFAULT_SUMMARY = "zmiennie"
TOMORROW_INDEX = 1  # tonight's low is tomorrow's daily minimum
PLACE_KEYS = ("city", "town", "village", "municipality")

WMO_SUMMARY: dict[int, str] = {
    0: "bezchmurnie",
    1: "przeważnie słonecznie",
    2: "częściowo pochmurno",
    3: "pochmurno",
    45: "mglisto",
    48: "mglisto",
    51: "mżawka",
    53: "mżawka",
    55: "mżawka",
    56: "marznąca mżawka",
    57: "marznąca mżawka",
    61: "słabe opady deszczu",
    63: "pada deszcz",
    65: "silny deszcz",
    66: "marznący deszcz",
    67: "marznący deszcz",
    71: "słabe opady śniegu",
    73: "pada śnieg",
    75: "silny śnieg",
    77: "pada śnieg",
    80: "przelotne opady deszczu",
    81: "przelotne opady deszczu",
    82: "ulewy",
    85: "przelotny śnieg",
    86: "przelotny śnieg",
    95: "burze",
    96: "burze z gradem",
    99: "burze z gradem",
}


class CityNotFound(Exception):
    pass


class WeatherUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Weather:
    city: str
    temp_c: int
    summary: str
    low_c: int
    text: str

    def as_dict(self) -> dict:
        return {"city": self.city, "temp_c": self.temp_c, "summary": self.summary, "text": self.text}


def _cache_key(lat: float, lon: float) -> tuple[float, float]:
    return round(lat, COORD_DECIMALS), round(lon, COORD_DECIMALS)


class WeatherService:
    def __init__(self, http: httpx.AsyncClient | None = None, now: Callable[[], float] = time.time) -> None:
        self.http = http or httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S)
        self.now = now
        self._forecasts: dict[tuple[float, float], tuple[float, dict]] = {}
        self._places: dict[tuple[float, float], tuple[float, str]] = {}

    async def aclose(self) -> None:
        await self.http.aclose()

    async def current(self, lat: float | None, lon: float | None, city: str | None) -> Weather:
        if lat is None or lon is None:
            city, lat, lon = await self.locate(city or "")
        elif not city:
            city = await self.place_name(lat, lon)
        forecast = await self._forecast(lat, lon)
        now_c, low_c = round(forecast["temp"]), round(forecast["low"])
        summary = WMO_SUMMARY.get(forecast["code"], DEFAULT_SUMMARY)
        return Weather(city, now_c, summary, low_c, weather_script(city, now_c, low_c, summary))

    async def locate(self, city: str) -> tuple[str, float, float]:
        data = await self._get_json(GEOCODING_URL, {"name": city, "count": 1, "language": "pl", "format": "json"})
        results = data.get("results") or []
        if not results:
            raise CityNotFound(city)
        try:
            top = results[0]
            return str(top["name"]), float(top["latitude"]), float(top["longitude"])
        except (KeyError, TypeError, ValueError) as error:
            raise WeatherUnavailable(f"unexpected geocoding reply: {error}") from error

    async def place_name(self, lat: float, lon: float) -> str:
        key = _cache_key(lat, lon)
        hit = self._places.get(key)
        if hit and self.now() - hit[0] < CACHE_SECONDS:
            return hit[1]
        try:
            data = await self._get_json(
                REVERSE_URL,
                {"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 10, "accept-language": "pl"},
                {"User-Agent": USER_AGENT},
            )
        except WeatherUnavailable:
            return FALLBACK_PLACE
        address = data.get("address") or {}
        name = next((str(address[k]) for k in PLACE_KEYS if address.get(k)), FALLBACK_PLACE)
        self._places[key] = (self.now(), name)
        return name

    async def _forecast(self, lat: float, lon: float) -> dict:
        key = _cache_key(lat, lon)
        hit = self._forecasts.get(key)
        if hit and self.now() - hit[0] < CACHE_SECONDS:
            return hit[1]
        data = await self._get_json(FORECAST_URL, {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,weather_code",
            "daily": "temperature_2m_min",
            "forecast_days": TOMORROW_INDEX + 1,
            "timezone": "auto",
        })
        try:
            forecast = {
                "temp": float(data["current"]["temperature_2m"]),
                "code": int(data["current"]["weather_code"]),
                "low": float(data["daily"]["temperature_2m_min"][TOMORROW_INDEX]),
            }
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise WeatherUnavailable(f"unexpected forecast reply: {error}") from error
        self._forecasts[key] = (self.now(), forecast)
        return forecast

    async def _get_json(self, url: str, params: dict, headers: dict | None = None) -> dict:
        try:
            response = await self.http.get(url, params=params, headers=headers)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise WeatherUnavailable(f"{url}: {error}") from error
