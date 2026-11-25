"""Auto-Ramówka 24/7 broadcast planner, B2B zrobi.my spot manager, and FastAPI router."""
from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .auth import SESSION_COOKIE, client_ip, token_hash
from .catalog import CatalogService, validate_slug
from .db import Database
from .telemetry import TelemetryService

log = logging.getLogger("dosradio.ramowka")

VALID_SPOT_KINDS = {"jingle", "ad", "audit", "podcast_intro"}

RAMOWKA_SCHEMA = """
CREATE TABLE IF NOT EXISTS ramowka_spots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    script TEXT NOT NULL,
    voice TEXT NOT NULL DEFAULT 'Orus',
    cta_label TEXT NOT NULL DEFAULT '',
    cta_url TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ramowka_hours (
    hour INTEGER PRIMARY KEY,
    station_id TEXT NOT NULL,
    slot_label TEXT NOT NULL
);
"""

DEFAULT_HOURLY_SLOTS: list[tuple[int, str, str]] = [
    (0, "deep-ambient", "Północny dryf ambientowy"),
    (1, "stoa", "Nocna refleksja Stoa"),
    (2, "nocny-dub", "Głęboki dub po drugiej"),
    (3, "cyber-noir", "Neon Noir — trzecia w nocy"),
    (4, "warm-jazz", "Przedświt w klubie jazzowym"),
    (5, "instrumentalna-akustyczna", "Cichy świt akustyczny"),
    (6, "poranna-kawa", "Poranny rozruch przy kawie"),
    (7, "instrumentalna-akustyczna", "Akustyczny poranek"),
    (8, "organic-house", "Płynne wejście w dzień"),
    (9, "dos-groove", "Głęboki fokus — blok pierwszy"),
    (10, "muzyka-klasyczna", "Klasyczna precyzja i skupienie"),
    (11, "micro-house", "Rytmiczny detal przed południem"),
    (12, "groove-funk", "Południowa energia Neo Funk"),
    (13, "etno-world", "Muzyka świata w środku dnia"),
    (14, "deep-house", "Popołudniowy puls biznesowy"),
    (15, "muzyka-filmowa", "Szeroka perspektywa — pasmo filmowe"),
    (16, "lofi-nauka", "Spokojne domknięcie zadań"),
    (17, "dub-techno", "Przestrzeń i echo po godzinach"),
    (18, "slowianski-folk", "Wieczorne korzenie i oddech"),
    (19, "stranger-synth", "Retro Synth 84 — wieczorna zmiana"),
    (20, "trip-hop", "Wieczorny salon Trip-Hop"),
    (21, "warm-jazz", "Nocny klub jazzowy"),
    (22, "cyber-noir", "Neon Noir — nocna jazda"),
    (23, "nocny-dub", "Późny dub"),
]

DEFAULT_SPOTS: list[dict[str, Any]] = [
    {
        "id": "jingle-ramowka-1",
        "kind": "jingle",
        "title": "Auto-Ramówka AmbiRadio",
        "script": "Słuchasz Auto-Ramówki AmbiRadio. Co godzinę inna muzyka, co dwadzieścia minut konkretne wiadomości, zero szumu.",
        "voice": "Orus",
        "cta_label": "",
        "cta_url": "",
        "sort_order": 1,
    },
    {
        "id": "jingle-ramowka-2",
        "kind": "jingle",
        "title": "Rytm pracy i technologii",
        "script": "AmbiRadio w trybie Auto-Ramówki. Zmieniamy klimat muzyczny z każdą pełną godziną i podajemy sprawdzone informacje ze świata technologii oraz biznesu.",
        "voice": "Kore",
        "cta_label": "",
        "cta_url": "",
        "sort_order": 2,
    },
    {
        "id": "jingle-ramowka-3",
        "kind": "jingle",
        "title": "Czysty sygnał AmbiRadio",
        "script": "Tu Auto-Ramówka AmbiRadio. Muzyka instrumentalna dopasowana do pory dnia, krótkie serwisy informacyjne i rozmowy o praktycznej technologii.",
        "voice": "Charon",
        "cta_label": "",
        "cta_url": "",
        "sort_order": 3,
    },
    {
        "id": "zrobimy-audyt-5dni",
        "kind": "audit",
        "title": "Audyt AI dla MŚP w 5 dni",
        "script": "Prowadzisz firmę i wiesz, że wypadałoby już wdrożyć sztuczną inteligencję, ale nie wiesz od czego zacząć? Na zrobi kropka my nie sprzedajemy kursów z pisania promptów. Prześwietlamy procesy w Twojej firmie i w pięć dni pokazujemy czarno na białym, gdzie automatyzacja zwróci się w pierwszym miesiącu. Sprawdź na zrobi kropka my.",
        "voice": "Orus",
        "cta_label": "Umów audyt AI na zrobi.my",
        "cta_url": "https://zrobi.my?utm_source=ambiradio&utm_medium=auto_ramowka&spot=zrobimy-audyt-5dni",
        "sort_order": 4,
    },
    {
        "id": "zrobimy-wyceny-b2b",
        "kind": "ad",
        "title": "Automatyzacja wycen i maili B2B",
        "script": "Ile godzin dziennie Twoi handlowcy przepisują zapytania z maili do wycen i arkuszy? Zespół zrobi kropka my wdraża asystentów AI, którzy przygotowują gotowy szkic oferty w dwie minuty na bazie Twojego cennika i historii zamówień. Wejdź na zrobi kropka my.",
        "voice": "Charon",
        "cta_label": "Umów audyt AI na zrobi.my",
        "cta_url": "https://zrobi.my?utm_source=ambiradio&utm_medium=auto_ramowka&spot=zrobimy-wyceny-b2b",
        "sort_order": 5,
    },
    {
        "id": "zrobimy-faktury-ksef",
        "kind": "ad",
        "title": "Faktury, dokumenty i KSeF bez ręcznego klepania",
        "script": "Dokumenty kosztowe, opisy faktur, uzgodnienia z księgowością. Zamiast zatrudniać kolejną osobę do przepisywania PDF-ów, zobacz jak polskie firmy odzyskują czterdzieści godzin miesięcznie dzięki wdrożeniom pod klucz. Szczegóły na zrobi kropka my.",
        "voice": "Orus",
        "cta_label": "Umów audyt AI na zrobi.my",
        "cta_url": "https://zrobi.my?utm_source=ambiradio&utm_medium=auto_ramowka&spot=zrobimy-faktury-ksef",
        "sort_order": 6,
    },
    {
        "id": "zrobimy-recepcja-247",
        "kind": "ad",
        "title": "Obsługa klienta i recepcja AI 24/7",
        "script": "Klient dzwoni po siedemnastej albo pisze w weekend, a nikt nie odbiera? Wdrażamy polskojęzycznych asystentów głosowych i mailowych spiętych z Twoim kalendarzem i CRM. Konkretna inżynieria, bez korporacyjnego lania wody. Zrobi kropka my.",
        "voice": "Kore",
        "cta_label": "Umów audyt AI na zrobi.my",
        "cta_url": "https://zrobi.my?utm_source=ambiradio&utm_medium=auto_ramowka&spot=zrobimy-recepcja-247",
        "sort_order": 7,
    },
    {
        "id": "zrobimy-dzial-ai",
        "kind": "audit",
        "title": "Zewnętrzny dział AI dla firm 10–150 osób",
        "script": "Nie musisz budować własnego działu IT, żeby korzystać z AI bezpiecznie i na własnych danych. Na zrobi kropka my zamawiasz konkretny efekt biznesowy: audyt, wdrożenie pod klucz i stałą opiekę. Wejdź na zrobi kropka my.",
        "voice": "Charon",
        "cta_label": "Umów audyt AI na zrobi.my",
        "cta_url": "https://zrobi.my?utm_source=ambiradio&utm_medium=auto_ramowka&spot=zrobimy-dzial-ai",
        "sort_order": 8,
    },
]

FEATURED_PODCAST_TOPICS: list[dict[str, Any]] = [
    {
        "id": "ai-wyceny-msp",
        "title": "Jak skrócić przygotowanie wyceny B2B z dwóch godzin do trzech minut",
        "topic": "praktyczna automatyzacja wycen i zapytań ofertowych w polskich firmach produkcyjnych i usługowych",
        "hosts": ["Ania", "Michał"],
        "turns": [
            {
                "speaker": 0,
                "text": "Rozmowy AmbiRadio. Dzisiaj bierzemy na warsztat temat, który boli prawie każdego właściciela firmy usługowej i produkcyjnej: wyceny, które utknęły w skrzynce mailowej.",
            },
            {
                "speaker": 1,
                "text": "Dokładnie. Klient wysyła zapytanie, handlowiec otwiera trzy arkusze kalkulacyjne, szuka starych cenników i mija pół dnia, zanim wyjdzie pierwsza odpowiedź.",
            },
            {
                "speaker": 0,
                "text": "A w tym czasie klient zdążył już porozmawiać z konkurencją. Co można z tym zrobić bez wymiany całego systemu ERP?",
            },
            {
                "speaker": 1,
                "text": "Spina się asystenta AI bezpośrednio ze skrzynką i aktualnym cennikiem. Handlowiec dostaje gotowy, policzony szkic oferty do zatwierdzenia jednym kliknięciem.",
            },
        ],
    },
    {
        "id": "ai-obsluga-po-godzinach",
        "title": "Recepcja i obsługa klienta po godzinie siedemnastej bez dodatkowych etatów",
        "topic": "wdrażanie polskojęzycznych asystentów głosowych i mailowych spiętych z kalendarzem i CRM w sektorze MŚP",
        "hosts": ["Ania", "Michał"],
        "turns": [
            {
                "speaker": 0,
                "text": "Rozmowy AmbiRadio. Ile kosztuje firmę telefon od klienta, którego nikt nie odebrał o siedemnastej trzydzieści?",
            },
            {
                "speaker": 1,
                "text": "Często dokładnie tyle, ile marża z całego zlecenia. Większość klientów nie nagrywa się na pocztę głosową, tylko dzwoni do kolejnej firmy z listy.",
            },
            {
                "speaker": 0,
                "text": "Kiedyś jedynym rozwiązaniem było zewnętrzne call center, które i tak nie znało specyfiki firmy.",
            },
            {
                "speaker": 1,
                "text": "Dziś polskojęzyczny agent głosowy odbiera w dwie sekundy, sprawdza wolne terminy w kalendarzu, odpowiada na konkretne pytania techniczne i zapisuje notatkę w CRM.",
            },
        ],
    },
    {
        "id": "ai-dokumenty-ksiegowosc",
        "title": "Koniec z ręcznym przepisywaniem faktur kosztowych i protokołów",
        "topic": "automatyczny obieg dokumentów, faktur PDF i integracja z KSeF w firmach od 10 do 150 pracowników",
        "hosts": ["Ania", "Michał"],
        "turns": [
            {
                "speaker": 0,
                "text": "Rozmowy AmbiRadio. Czterdzieści godzin miesięcznie — tyle średnio w trzydziestoosobowej firmie zajmuje ręczne opisywanie dokumentów i sprawdzanie załączników.",
            },
            {
                "speaker": 1,
                "text": "I to zazwyczaj robią najbardziej doświadczeni ludzie w biurze, zamiast zajmować się klientami albo kontrolą marży.",
            },
            {
                "speaker": 0,
                "text": "Jak wygląda dobrze zaprojektowany obieg takich dokumentów z udziałem modeli językowych?",
            },
            {
                "speaker": 1,
                "text": "Dokument wpada na dedykowany adres, model wyciąga pozycje, przypisuje projekt oraz centrum kosztów i wysyła na Slacka lub Teamsy tylko jedno pytanie o akceptację.",
            },
        ],
    },
    {
        "id": "fokus-praca-gleboka",
        "title": "Architektura skupienia w świecie ciągłych powiadomień",
        "topic": "jak projektować bloki głębokiej pracy, rytm dnia i narzędzia AI, które redukują szum informacyjny",
        "hosts": ["Ania", "Michał"],
        "turns": [
            {
                "speaker": 0,
                "text": "Rozmowy AmbiRadio. Mówimy dużo o automatyzacji, ale najważniejszym zasobem w firmie pozostaje uwaga zespołu.",
            },
            {
                "speaker": 1,
                "text": "Bo nawet najlepsze narzędzie nie pomoże, jeśli co sześć minut przerywa nam powiadomienie z komunikatora albo długi wątek mailowy bez konkluzji.",
            },
            {
                "speaker": 0,
                "text": "Stąd w Auto-Ramówce AmbiRadio zasada jest prosta: równe pasma muzyki instrumentalnej i zwięzły serwis dopiero co dwadzieścia minut.",
            },
            {
                "speaker": 1,
                "text": "Dobre wdrożenie AI w firmie działa identycznie: zbiera rozproszone sygnały w tle i podaje decydentowi jedno krótkie podsumowanie wtedy, kiedy jest na nie czas.",
            },
        ],
    },
]

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
}


class RamowkaService:
    def __init__(self, db: Database, catalog: CatalogService, data_dir: Path | None = None) -> None:
        self.db = db
        self.catalog = catalog
        self.data_dir = data_dir
        self.featured_topics = FEATURED_PODCAST_TOPICS
        self._init_and_seed()

    def _init_and_seed(self) -> None:
        now = time.time()
        with self.db.connect() as conn:
            conn.executescript(RAMOWKA_SCHEMA)
            for hour, station_id, slot_label in DEFAULT_HOURLY_SLOTS:
                conn.execute(
                    "INSERT OR IGNORE INTO ramowka_hours (hour, station_id, slot_label) VALUES (?, ?, ?)",
                    (hour, station_id, slot_label),
                )
            for spot in DEFAULT_SPOTS:
                conn.execute(
                    "INSERT OR IGNORE INTO ramowka_spots "
                    "(id, kind, title, script, voice, cta_label, cta_url, enabled, sort_order, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
                    (
                        spot["id"],
                        spot["kind"],
                        spot["title"],
                        spot["script"],
                        spot["voice"],
                        spot["cta_label"],
                        spot["cta_url"],
                        spot["sort_order"],
                        now,
                    ),
                )

    def _row_to_spot(self, row: Any) -> dict[str, Any]:
        sid = row["id"]
        audio_ready = False
        if self.data_dir is not None:
            audio_ready = (self.data_dir / "ramowka" / f"{sid}.wav").exists()
        return {
            "id": sid,
            "kind": row["kind"],
            "title": row["title"],
            "script": row["script"],
            "voice": row["voice"],
            "cta_label": row["cta_label"],
            "cta_url": row["cta_url"],
            "enabled": bool(row["enabled"]),
            "sort_order": int(row["sort_order"]),
            "created_at": float(row["created_at"]),
            "audio_url": f"/radio-api/ramowka/spot/{sid}.wav",
            "audio_ready": audio_ready,
        }

    def list_spots(self, include_disabled: bool = False) -> list[dict[str, Any]]:
        query = "SELECT * FROM ramowka_spots"
        if not include_disabled:
            query += " WHERE enabled = 1"
        query += " ORDER BY sort_order ASC, id ASC"
        with self.db.connect() as conn:
            rows = conn.execute(query).fetchall()
        return [self._row_to_spot(r) for r in rows]

    def get_spot(self, spot_id: str) -> dict[str, Any] | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM ramowka_spots WHERE id = ?", (spot_id,)).fetchone()
        return self._row_to_spot(row) if row else None

    def upsert_spot(
        self,
        spot_id: str | dict[str, Any],
        kind: str = "ad",
        title: str = "",
        script: str = "",
        voice: str = "Orus",
        cta_label: str = "",
        cta_url: str = "",
        enabled: bool = True,
        sort_order: int = 0,
    ) -> dict[str, Any]:
        if isinstance(spot_id, dict):
            data = spot_id
            sid = validate_slug(str(data.get("id") or ""))
            kind = str(data.get("kind") or "ad").strip()
            title = str(data.get("title") or "").strip()
            script = str(data.get("script") or "").strip()
            voice = str(data.get("voice") or "Orus").strip()
            cta_label = str(data.get("cta_label") or "").strip()
            cta_url = str(data.get("cta_url") or "").strip()
            enabled = bool(data.get("enabled", True))
            sort_order = int(data.get("sort_order", 0))
        else:
            sid = validate_slug(spot_id)
            kind = (kind or "ad").strip()
            title = (title or "").strip()
            script = (script or "").strip()
            voice = (voice or "Orus").strip()
            cta_label = (cta_label or "").strip()
            cta_url = (cta_url or "").strip()

        if kind not in VALID_SPOT_KINDS:
            raise ValueError(f"Nieprawidłowy typ spotu: {kind}")
        if not title or not script:
            raise ValueError("Tytuł i treść spotu są wymagane")

        now = time.time()
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO ramowka_spots "
                "(id, kind, title, script, voice, cta_label, cta_url, enabled, sort_order, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET "
                "kind=excluded.kind, title=excluded.title, script=excluded.script, "
                "voice=excluded.voice, cta_label=excluded.cta_label, cta_url=excluded.cta_url, "
                "enabled=excluded.enabled, sort_order=excluded.sort_order",
                (sid, kind, title, script, voice, cta_label, cta_url, 1 if enabled else 0, int(sort_order), now),
            )
        if self.data_dir is not None:
            cached = self.data_dir / "ramowka" / f"{sid}.wav"
            cached.unlink(missing_ok=True)
        spot = self.get_spot(sid)
        assert spot is not None
        return spot

    def update_spot(self, spot_id: str, changes: dict[str, Any] | None = None, **kwargs: Any) -> dict[str, Any]:
        sid = validate_slug(spot_id)
        existing = self.get_spot(sid)
        if existing is None:
            raise KeyError(f"Nieznany spot: {sid}")
        updates = dict(changes or {})
        updates.update(kwargs)
        merged = {
            "id": sid,
            "kind": updates.get("kind", existing["kind"]),
            "title": updates.get("title", existing["title"]),
            "script": updates.get("script", existing["script"]),
            "voice": updates.get("voice", existing["voice"]),
            "cta_label": updates.get("cta_label", existing["cta_label"]),
            "cta_url": updates.get("cta_url", existing["cta_url"]),
            "enabled": updates.get("enabled", existing["enabled"]),
            "sort_order": updates.get("sort_order", existing["sort_order"]),
        }
        return self.upsert_spot(merged)

    def hourly_schedule(self) -> list[dict[str, Any]]:
        stations_by_id = {s["id"]: s for s in self.catalog.list_stations(include_disabled=True)}
        enabled_stations = self.catalog.public_catalog()["stations"]
        fallback = enabled_stations[0] if enabled_stations else None

        with self.db.connect() as conn:
            rows = conn.execute("SELECT hour, station_id, slot_label FROM ramowka_hours ORDER BY hour ASC").fetchall()

        schedule: list[dict[str, Any]] = []
        for r in rows:
            hr = int(r["hour"])
            sid = r["station_id"]
            st = stations_by_id.get(sid)
            effective = st if (st and st["enabled"]) else fallback
            eff_id = effective["id"] if effective else sid
            eff_name = effective["name"] if effective else sid
            eff_group = effective["group_id"] if effective else "fokus-puls"
            schedule.append(
                {
                    "hour": hr,
                    "station_id": eff_id,
                    "configured_station_id": sid,
                    "station_name": eff_name,
                    "group_id": eff_group,
                    "slot_label": r["slot_label"],
                }
            )
        return schedule

    def set_hour_slot(self, hour: int, station_id: str, slot_label: str) -> dict[str, Any]:
        hr = int(hour)
        if not 0 <= hr <= 23:
            raise ValueError("Godzina musi być w zakresie 0..23")
        sid = validate_slug(station_id)
        if self.catalog.get_station(sid) is None:
            raise ValueError(f"Nieznana stacja: {sid}")
        label = (slot_label or "").strip() or f"Pasmo o {hr:02d}:00"
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO ramowka_hours (hour, station_id, slot_label) VALUES (?, ?, ?) "
                "ON CONFLICT(hour) DO UPDATE SET station_id=excluded.station_id, slot_label=excluded.slot_label",
                (hr, sid, label),
            )
        return next(item for item in self.hourly_schedule() if item["hour"] == hr)

    def state(self, now_ts: float | None = None) -> dict[str, Any]:
        ts = now_ts if now_ts is not None else time.time()
        dt = datetime.fromtimestamp(ts)
        current_hour = dt.hour
        current_minute = dt.minute

        schedule = self.hourly_schedule()
        slot_by_hour = {item["hour"]: item for item in schedule}
        current_slot = slot_by_hour.get(current_hour) or (
            schedule[0]
            if schedule
            else {
                "hour": current_hour,
                "station_id": "dos-groove",
                "configured_station_id": "dos-groove",
                "station_name": "DOS Groove",
                "group_id": "fokus-puls",
                "slot_label": "Fokus",
            }
        )
        next_hour = (current_hour + 1) % 24
        next_slot = slot_by_hour.get(next_hour, current_slot)

        news_minutes = [0, 20, 40]
        next_news_min = next((m for m in news_minutes if m > current_minute), 60)
        minutes_until_news = next_news_min - current_minute
        next_news_at = ts + minutes_until_news * 60 - dt.second

        spot_minutes = [10, 30, 50]
        next_spot_min = next((m for m in spot_minutes if m > current_minute), 70)
        minutes_until_spot = next_spot_min - current_minute
        next_spot_at = ts + minutes_until_spot * 60 - dt.second

        enabled_spots = self.list_spots(include_disabled=False)
        b2b_spots = [s for s in enabled_spots if s["kind"] in ("ad", "audit")]
        jingle_spots = [s for s in enabled_spots if s["kind"] == "jingle"]

        block_index = (current_hour * 3 + (current_minute // 20))
        active_spot = b2b_spots[block_index % len(b2b_spots)] if b2b_spots else None
        jingle_spot = jingle_spots[current_hour % len(jingle_spots)] if jingle_spots else None
        featured_topic = self.featured_topics[current_hour % len(self.featured_topics)]

        station_obj = self.catalog.get_station(current_slot["station_id"])

        return {
            "now": ts,
            "current_hour": current_hour,
            "current_minute": current_minute,
            "current_slot": current_slot,
            "station_id": current_slot["station_id"],
            "station": station_obj,
            "next_slot": next_slot,
            "news_interval_minutes": 20,
            "news_schedule_minutes": [0, 20, 40],
            "next_news_minute": next_news_min % 60,
            "minutes_until_news": minutes_until_news,
            "next_news_at": next_news_at,
            "spot_schedule_minutes": [10, 30, 50],
            "next_spot_minute": next_spot_min % 60,
            "minutes_until_spot": minutes_until_spot,
            "next_spot_at": next_spot_at,
            "active_spot": active_spot,
            "jingle_spot": jingle_spot,
            "featured_podcast_topic": featured_topic,
            "featured_topics": self.featured_topics,
            "hourly_schedule": schedule,
        }


# Heartbeat field names older Classic/Orbita builds still send from open browser tabs.
PRESENCE_LEGACY_ALIASES = {
    "station": "station_id",
    "view": "view_mode",
    "auto_ramowka": "ramowka",
    "group": "group_id",
}


class PresenceRequest(BaseModel):
    """Listener heartbeat. Unknown fields are rejected, so a renamed field can never again fall back silently."""

    model_config = ConfigDict(extra="forbid")

    actor_key: str | None = Field(default=None, max_length=200)
    client_id: str | None = Field(default=None, max_length=80)
    station_id: str = Field(default="dos-groove", max_length=80)
    group_id: str | None = Field(default=None, max_length=80)
    view_mode: str = Field(default="classic", max_length=20)
    ramowka: bool = False
    email: str | None = Field(default=None, max_length=200)
    user_id: int | None = None

    @model_validator(mode="before")
    @classmethod
    def _accept_legacy_names(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        out = dict(data)
        for legacy, canonical in PRESENCE_LEGACY_ALIASES.items():
            if legacy in out:
                value = out.pop(legacy)
                out.setdefault(canonical, value)
        return out

    @field_validator("view_mode")
    @classmethod
    def _known_view(cls, value: str) -> str:
        return value if value in ("classic", "orbita") else "classic"


def presence_actor_key(body: PresenceRequest, cookies: dict[str, str], ip: str) -> str:
    """One row per browser: explicit key, then the persisted client id, then cookies, then IP as last resort."""
    if body.actor_key:
        return body.actor_key
    if body.client_id:
        return f"cid:{body.client_id}"
    for name, prefix in (("dr_anon", "anon"), ("dr_session", "sess")):
        value = cookies.get(name)
        if value:
            # Never store the raw session token in the admin-visible presence table.
            return f"{prefix}:{hashlib.sha256(value.encode()).hexdigest()[:16]}"
    return f"ip:{ip}"


class ZrobimyLeadRequest(BaseModel):
    model_config = {"extra": "allow"}

    company: str = Field(default="", max_length=160)
    companyName: str = Field(default="", max_length=160)
    contact_name: str = Field(default="", max_length=120)
    contactName: str = Field(default="", max_length=120)
    contact: str = Field(default="", max_length=160)
    contactChannel: str = Field(default="", max_length=160)
    phone_or_email: str = Field(default="", max_length=160)
    industry: str = Field(default="", max_length=120)
    team_size: str = Field(default="", max_length=60)
    teamSize: str = Field(default="", max_length=60)
    pain_point: str = Field(default="", max_length=500)
    pain_area: str = Field(default="", max_length=500)
    improvementArea: str = Field(default="", max_length=500)
    source_spot: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=2000)
    message: str = Field(default="", max_length=2000)
    attribution: dict[str, Any] | None = None
    calculatorSnapshot: dict[str, Any] | None = None


def build_ramowka_router(
    db: Database,
    catalog: CatalogService,
    telemetry: TelemetryService,
    gemini: Any,
    data_dir: Path,
    ramowka_service: RamowkaService | None = None,
) -> APIRouter:
    router = APIRouter()
    service = ramowka_service or RamowkaService(db, catalog, data_dir=data_dir)
    ramowka_audio_dir = data_dir / "ramowka"
    ramowka_audio_dir.mkdir(parents=True, exist_ok=True)

    @router.get("/radio-api/catalog")
    def get_public_catalog() -> dict[str, Any]:
        return catalog.public_catalog()

    @router.post("/radio-api/presence")
    def post_presence(body: PresenceRequest, request: Request) -> dict[str, Any]:
        ip = client_ip(
            {k.lower(): v for k, v in request.headers.items()},
            request.client.host if request.client else None,
        )
        actor_key = presence_actor_key(body, dict(request.cookies), ip)
        ua = request.headers.get("user-agent", "")
        # Who is listening comes from the session cookie, never from what the page claims.
        user_id, email = None, None
        session = request.cookies.get(SESSION_COOKIE)
        if session:
            user = db.user_for_session(token_hash(session))
            if user is not None:
                user_id, email = int(user["id"]), user["email"]
        telemetry.touch_presence(
            actor_key=actor_key,
            station_id=body.station_id,
            view_mode=body.view_mode,
            ramowka=body.ramowka,
            user_id=user_id,
            email=email,
            user_agent=ua,
        )
        return {"ok": True}

    @router.get("/radio-api/ramowka/state")
    @router.get("/radio-api/ramowka/now")
    def get_ramowka_state() -> dict[str, Any]:
        return service.state()

    @router.get("/radio-api/ramowka/spots")
    def get_ramowka_spots() -> list[dict[str, Any]]:
        return service.list_spots(include_disabled=False)

    @router.get("/radio-api/ramowka/spot/{spot_id}.wav")
    async def get_ramowka_spot_wav(spot_id: str) -> Response:
        sid = validate_slug(spot_id)
        alias_map = {"spot-audyt-msp": "zrobimy-audyt-5dni"}
        spot = service.get_spot(sid) or (service.get_spot(alias_map[sid]) if sid in alias_map else None)
        if spot is None:
            raise HTTPException(404, "Nie ma takiego spotu")
        sid = spot["id"]
        wav_path = ramowka_audio_dir / f"{sid}.wav"
        if not wav_path.exists():
            try:
                audio = await gemini.speak(spot["script"], spot["voice"])
            except Exception as err:
                log.warning("Failed to render spot %s: %s", sid, err)
                raise HTTPException(502, f"Nie udało się wygenerować nagrania spotu: {err}") from err
            tmp = wav_path.with_suffix(".tmp")
            tmp.write_bytes(audio)
            tmp.replace(wav_path)
            est_prompt_tokens = max(10, len(spot["script"].split()) * 2)
            est_audio_s = max(3.0, len(spot["script"].split()) / 2.3)
            telemetry.record_tokens(
                model=getattr(gemini, "last_tts_model", None) or getattr(gemini, "tts_model", "gemini-tts"),
                feature="spot",
                prompt_tokens=est_prompt_tokens,
                output_tokens=int(est_audio_s * 32),
                audio_seconds=est_audio_s,
            )
        return FileResponse(wav_path, media_type="audio/wav", headers={"cache-control": "public, max-age=86400"})

    @router.options("/radio-api/leads/zrobimy")
    def options_zrobimy_lead() -> Response:
        return Response(status_code=204, headers=CORS_HEADERS)

    @router.post("/radio-api/leads/zrobimy", status_code=201)
    def post_zrobimy_lead(body: ZrobimyLeadRequest) -> JSONResponse:
        company = (body.company or body.companyName).strip()
        contact = (body.contact or body.contactChannel or body.phone_or_email).strip()
        if not company or len(contact) < 5:
            raise HTTPException(422, "Podaj nazwę firmy oraz poprawny telefon lub e-mail")
        contact_name = (body.contact_name or body.contactName).strip()
        team_size = (body.team_size or body.teamSize).strip()
        pain_point = (body.pain_point or body.pain_area or body.improvementArea).strip()
        attr_spot = (body.attribution or {}).get("spotSlug") or ""
        source_spot = (body.source_spot or str(attr_spot)).strip()
        notes = (body.notes or body.message).strip()
        if body.calculatorSnapshot:
            snap = body.calculatorSnapshot
            snap_note = f" [ROI: ~{snap.get('reclaimedHoursMonthly', 0)}h/m, ~{snap.get('monthlySavingsPln', 0)} PLN/m]"
            notes = (notes + snap_note)[:2000]
        created = telemetry.create_lead(
            company=company,
            contact_name=contact_name,
            contact=contact,
            industry=body.industry,
            team_size=team_size,
            pain_point=pain_point,
            source_spot=source_spot,
            notes=notes,
        )
        return JSONResponse(
            status_code=201,
            content={"ok": True, "lead": created},
            headers=CORS_HEADERS,
        )

    return router
