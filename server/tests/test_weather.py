"""Weather service: Open-Meteo, geocoding and Nominatim over a mock transport. No network."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from app.weather import CACHE_SECONDS, FALLBACK_PLACE, CityNotFound, WeatherService, WeatherUnavailable

FORECAST_HOST = "api.open-meteo.com"
GEOCODING_HOST = "geocoding-api.open-meteo.com"
REVERSE_HOST = "nominatim.openstreetmap.org"


class FakeWeb:
    def __init__(self, forecast_status: int = 200, reverse_status: int = 200, places: list | None = None) -> None:
        self.forecast_status = forecast_status
        self.reverse_status = reverse_status
        self.places = [{"name": "Kraków", "latitude": 50.06, "longitude": 19.94}] if places is None else places
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        host = request.url.host
        if host == FORECAST_HOST:
            if self.forecast_status != 200:
                return httpx.Response(self.forecast_status, json={"reason": "down"})
            return httpx.Response(200, json={
                "current": {"temperature_2m": 14.6, "weather_code": 3},
                "daily": {"temperature_2m_min": [8.2, 6.4]},
            })
        if host == GEOCODING_HOST:
            return httpx.Response(200, json={"results": self.places})
        if host == REVERSE_HOST:
            if self.reverse_status != 200:
                return httpx.Response(self.reverse_status, json={})
            return httpx.Response(200, json={"address": {"town": "Zakopane"}})
        return httpx.Response(404)

    def forecast_calls(self) -> int:
        return sum(1 for request in self.requests if request.url.host == FORECAST_HOST)


def run_with(web: FakeWeb, clock: dict, operation):
    async def scenario():
        http = httpx.AsyncClient(transport=httpx.MockTransport(web.handle))
        service = WeatherService(http=http, now=lambda: clock["now"])
        try:
            return await operation(service)
        finally:
            await service.aclose()

    return asyncio.run(scenario())


def test_city_forecast_builds_polish_text():
    web, clock = FakeWeb(), {"now": 1000.0}
    report = run_with(web, clock, lambda service: service.current(None, None, "Kraków"))
    assert report.city == "Kraków"
    assert report.temp_c == 15
    assert report.low_c == 6
    assert report.summary == "pochmurno"
    assert report.text == "Pogoda, Kraków. Teraz 15 stopni, pochmurno. Wieczorem do 6 stopni."
    assert report.as_dict() == {"city": "Kraków", "temp_c": 15, "summary": "pochmurno", "text": report.text}


def test_coordinates_use_reverse_geocoding_with_user_agent():
    web, clock = FakeWeb(), {"now": 1000.0}
    report = run_with(web, clock, lambda service: service.current(50.06, 19.94, None))
    assert report.city == "Zakopane"
    reverse = next(request for request in web.requests if request.url.host == REVERSE_HOST)
    assert reverse.headers["user-agent"].startswith("DOSRadio/")


def test_nearby_coordinates_share_one_forecast_within_cache_window():
    web, clock = FakeWeb(), {"now": 1000.0}

    async def operation(service):
        await service.current(50.061, 19.941, "Kraków")
        await service.current(50.064, 19.944, "Kraków")

    run_with(web, clock, operation)
    assert web.forecast_calls() == 1


def test_forecast_refreshes_after_cache_expires():
    web, clock = FakeWeb(), {"now": 1000.0}

    async def operation(service):
        await service.current(50.06, 19.94, "Kraków")
        clock["now"] += CACHE_SECONDS + 1
        await service.current(50.06, 19.94, "Kraków")

    run_with(web, clock, operation)
    assert web.forecast_calls() == 2


def test_unknown_city_raises_city_not_found():
    web, clock = FakeWeb(places=[]), {"now": 1000.0}
    with pytest.raises(CityNotFound):
        run_with(web, clock, lambda service: service.current(None, None, "Nieistniejące"))


def test_forecast_server_error_raises_unavailable():
    web, clock = FakeWeb(forecast_status=500), {"now": 1000.0}
    with pytest.raises(WeatherUnavailable):
        run_with(web, clock, lambda service: service.current(50.06, 19.94, "Kraków"))


def test_reverse_geocoding_failure_falls_back_to_generic_place():
    web, clock = FakeWeb(reverse_status=503), {"now": 1000.0}
    report = run_with(web, clock, lambda service: service.current(50.06, 19.94, None))
    assert report.city == FALLBACK_PLACE
    assert report.temp_c == 15
