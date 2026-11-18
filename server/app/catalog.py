"""Hierarchical music taxonomy (groups and stations) persisted in SQLite."""
from __future__ import annotations

import re
import time
from typing import Any

from .archive import ArchiveRegistry
from .catalog_extra import EXTRA_BUILTIN_STATIONS, EXTRA_GROUPS, RAW_TECHNO_OVERRIDE
from .db import Database
from .recorder import STATION_SPECS

SLUG_RE = re.compile(r"^[a-z0-9-]{2,48}$")

CATALOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS music_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS music_stations (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES music_groups(id),
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    prompt TEXT NOT NULL,
    bpm INTEGER NOT NULL,
    density REAL NOT NULL,
    brightness REAL NOT NULL,
    category TEXT NOT NULL DEFAULT 'fokus',
    host TEXT NOT NULL DEFAULT 'Kuba',
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
"""

DEFAULT_GROUPS: list[dict[str, Any]] = [
    {
        "id": "fokus-puls",
        "name": "Fokus i Puls",
        "tagline": "Równy, głęboki puls do wielogodzinnej pracy",
        "color": "#8f6bff",
        "sort_order": 1,
    },
    {
        "id": "klub-energia",
        "name": "Klub i Energia",
        "tagline": "House, techno, funk i energetyczny groove",
        "color": "#ff4f9a",
        "sort_order": 2,
    },
    {
        "id": "synth-filmowa",
        "name": "Filmowa i Retro Synth",
        "tagline": "Analogowe arpeggiatory lat 80. w klimacie Stranger Things i szeroka przestrzeń kinowa",
        "color": "#ff6b3d",
        "sort_order": 3,
    },
    {
        "id": "klasyka-instrumentalna",
        "name": "Klasyczna i Instrumentalna",
        "tagline": "Kameralne smyczki, fortepian, gitara akustyczna i żywe instrumentarium",
        "color": "#e5b567",
        "sort_order": 4,
    },
    {
        "id": "etno-folk",
        "name": "Etno i Folk",
        "tagline": "Muzyka świata, słowiańskie i nordyckie korzenie oraz organiczne bębny",
        "color": "#35d0b5",
        "sort_order": 5,
    },
    {
        "id": "chill-noc",
        "name": "Chill, Jazz i Noc",
        "tagline": "Lo-fi z winyla, wieczorny jazz, trip-hop, dub i głęboki ambient",
        "color": "#4d7dff",
        "sort_order": 6,
    },
    *EXTRA_GROUPS,
]

EXISTING_STATION_METADATA: dict[str, dict[str, Any]] = {
    # fokus-puls
    "dos-groove": {
        "group_id": "fokus-puls",
        "name": "DOS Groove",
        "tagline": "Minimal deep tech do pracy",
        "category": "fokus",
        "host": "Kuba",
        "sort_order": 1,
    },
    "micro-house": {
        "group_id": "fokus-puls",
        "name": "Microhouse",
        "tagline": "Organiczny rumuński minimal i detal",
        "category": "fokus",
        "host": "Rafał",
        "sort_order": 2,
    },
    "deep-tech": {
        "group_id": "fokus-puls",
        "name": "Deep Tech",
        "tagline": "Głęboki, równy tech bez ozdobników",
        "category": "fokus",
        "host": "Kuba",
        "sort_order": 3,
    },
    "dub-techno": {
        "group_id": "fokus-puls",
        "name": "Dub Techno",
        "tagline": "Akordy, które wracają echem",
        "category": "fokus",
        "host": "Rafał",
        "sort_order": 4,
    },
    "minimal-techno": {
        "group_id": "fokus-puls",
        "name": "Minimal Techno",
        "tagline": "Hipnotyczny, precyzyjny klubowy puls",
        "category": "energia",
        "host": "Igor",
        "sort_order": 5,
    },
    # klub-energia
    "poranna-kawa": {
        "group_id": "klub-energia",
        "name": "Poranna Kawa",
        "tagline": "Słoneczny, ciepły deep house",
        "category": "energia",
        "host": "Zosia",
        "sort_order": 1,
    },
    "deep-house": {
        "group_id": "klub-energia",
        "name": "Deep House",
        "tagline": "Ciepły bas i miękkie akordy",
        "category": "chill",
        "host": "Zosia",
        "sort_order": 2,
    },
    "organic-house": {
        "group_id": "klub-energia",
        "name": "Organic House",
        "tagline": "Drewno, oddech i ciepły perkusjon",
        "category": "chill",
        "host": "Rafał",
        "sort_order": 3,
    },
    "afro-house": {
        "group_id": "klub-energia",
        "name": "Afro House",
        "tagline": "Perkusja, ciepło i taneczny oddech",
        "category": "energia",
        "host": "Tadek",
        "sort_order": 4,
    },
    "tech-house": {
        "group_id": "klub-energia",
        "name": "Tech House",
        "tagline": "Równy parkiet, najszerzej trafia",
        "category": "energia",
        "host": "Max",
        "sort_order": 5,
    },
    "melodic-house": {
        "group_id": "klub-energia",
        "name": "Melodic House",
        "tagline": "Długa melodia nad głębokim basem",
        "category": "energia",
        "host": "Lena",
        "sort_order": 6,
    },
    "progressive-house": {
        "group_id": "klub-energia",
        "name": "Progressive House",
        "tagline": "Buduje się powoli i niesie",
        "category": "energia",
        "host": "Max",
        "sort_order": 7,
    },
    "detroit-techno": {
        "group_id": "klub-energia",
        "name": "Detroit Techno",
        "tagline": "Strunowe akordy i maszynowy puls",
        "category": "energia",
        "host": "Igor",
        "sort_order": 8,
    },
    "raw-techno": {
        "group_id": RAW_TECHNO_OVERRIDE["group_id"],
        "name": RAW_TECHNO_OVERRIDE["name"],
        "tagline": RAW_TECHNO_OVERRIDE["tagline"],
        "category": "energia",
        "host": "Wiktor",
        "sort_order": RAW_TECHNO_OVERRIDE["sort_order"],
    },
    "club-dance": {
        "group_id": "klub-energia",
        "name": "Klubowy Dance",
        "tagline": "Sprężysty tech-house i parkietowa energia",
        "category": "energia",
        "host": "Max",
        "sort_order": 10,
    },
    "trance": {
        "group_id": "klub-energia",
        "name": "Trance",
        "tagline": "Jasna melodia i równy galop",
        "category": "energia",
        "host": "Zosia",
        "sort_order": 11,
    },
    "liquid-dnb": {
        "group_id": "klub-energia",
        "name": "Liquid DnB",
        "tagline": "Płynne, ciepłe połamane bity i głęboki bas",
        "category": "energia",
        "host": "Lena",
        "sort_order": 12,
    },
    "drum-and-bass": {
        "group_id": "klub-energia",
        "name": "Drum and Bass",
        "tagline": "Szybki łamany bit i głęboki bas",
        "category": "energia",
        "host": "Lena",
        "sort_order": 13,
    },
    "groove-funk": {
        "group_id": "klub-energia",
        "name": "Neo Funk",
        "tagline": "Bujający bas, vintage gitara i groove",
        "category": "energia",
        "host": "Tadek",
        "sort_order": 14,
    },
    # klasyka-instrumentalna
    "stoa": {
        "group_id": "klasyka-instrumentalna",
        "name": "Stoa",
        "tagline": "Wiolonczela, fortepian i spokój stoików",
        "category": "chill",
        "host": "Marek",
        "sort_order": 1,
    },
    # chill-noc
    "lofi-nauka": {
        "group_id": "chill-noc",
        "name": "Lo-fi Nauka",
        "tagline": "Ciepłe bity z winyla i miękkie pianino",
        "category": "fokus",
        "host": "Ola",
        "sort_order": 1,
    },
    "warm-jazz": {
        "group_id": "chill-noc",
        "name": "Nocny Jazz",
        "tagline": "Miotełki, ciepły kontrabas i Rhodes",
        "category": "noc",
        "host": "Helena",
        "sort_order": 2,
    },
    "trip-hop": {
        "group_id": "chill-noc",
        "name": "Trip-hop Wieczór",
        "tagline": "Leniwy winylowy dół w stylu Bristolu",
        "category": "noc",
        "host": "Marta",
        "sort_order": 3,
    },
    "nocny-dub": {
        "group_id": "chill-noc",
        "name": "Nocny Dub",
        "tagline": "Przestrzenne akordy i głęboki oddech",
        "category": "noc",
        "host": "Szymon",
        "sort_order": 4,
    },
    "deep-ambient": {
        "group_id": "chill-noc",
        "name": "Głęboki Ambient",
        "tagline": "Bez perkusji, medytacyjna przestrzeń",
        "category": "chill",
        "host": "Ida",
        "sort_order": 5,
    },
}

NEW_BUILTIN_STATIONS: list[dict[str, Any]] = [
    {
        "id": "stranger-synth",
        "group_id": "synth-filmowa",
        "name": "Stranger Synth 84",
        "tagline": "Mroczny analogowy arpeggiator z lat 80. i puls tajemnicy",
        "prompt": "dark 1980s analog synthwave soundtrack, hypnotic Juno-60 arpeggiator, deep warm Moog bass pulse, mysterious nocturnal retro sci-fi tension, warm gated reverb tom accents, instrumental",
        "bpm": 108,
        "density": 0.50,
        "brightness": 0.45,
        "category": "noc",
        "host": "Wiktor",
        "sort_order": 1,
    },
    {
        "id": "muzyka-filmowa",
        "group_id": "synth-filmowa",
        "name": "Muzyka Filmowa",
        "tagline": "Szerokie smyczki, waltornie i epicka przestrzeń kinowa",
        "prompt": "cinematic film score soundtrack, wide orchestral strings, warm French horn swells, subtle felt piano ostinato, emotional widescreen atmosphere and wonder, instrumental",
        "bpm": 78,
        "density": 0.45,
        "brightness": 0.45,
        "category": "fokus",
        "host": "Marek",
        "sort_order": 2,
    },
    {
        "id": "cyber-noir",
        "group_id": "synth-filmowa",
        "name": "Neon Noir Synth",
        "tagline": "Deszczowy nocny analog, szerokie pady CS-80 i filmowy nastrój",
        "prompt": "cinematic synth noir soundtrack, lush vintage CS-80 analog brass pads, slow pulsing sub bass, warm tape delay, nocturnal rain soundtrack mood, instrumental",
        "bpm": 90,
        "density": 0.38,
        "brightness": 0.35,
        "category": "noc",
        "host": "Helena",
        "sort_order": 3,
    },
    {
        "id": "muzyka-klasyczna",
        "group_id": "klasyka-instrumentalna",
        "name": "Muzyka Klasyczna",
        "tagline": "Kameralna orkiestra smyczkowa, wiolonczela i harmonia sali koncertowej",
        "prompt": "classical chamber orchestra, expressive string quartet, warm solo cello counterpoint, graceful violin phrasing, natural concert hall acoustics, instrumental",
        "bpm": 72,
        "density": 0.35,
        "brightness": 0.42,
        "category": "fokus",
        "host": "Marek",
        "sort_order": 2,
    },
    {
        "id": "instrumentalna-akustyczna",
        "group_id": "klasyka-instrumentalna",
        "name": "Instrumentalna Akustyczna",
        "tagline": "Gitara fingerstyle, miękkie pianino z filcem i żywe drewno",
        "prompt": "warm acoustic instrumental music, delicate fingerstyle acoustic guitar, soft felt upright piano, subtle upright double bass, intimate studio room tone, instrumental",
        "bpm": 84,
        "density": 0.38,
        "brightness": 0.45,
        "category": "chill",
        "host": "Ida",
        "sort_order": 3,
    },
    {
        "id": "etno-world",
        "group_id": "etno-folk",
        "name": "Etno i Muzyka Świata",
        "tagline": "Hipnotyczne bębny obręczowe, oud, kora i organiczny trans",
        "prompt": "organic ethno world music, hypnotic frame drums and hand percussion, warm acoustic oud and kora melodies, subtle kalimba, earthy acoustic bass pulse, meditative groove, instrumental",
        "bpm": 98,
        "density": 0.48,
        "brightness": 0.48,
        "category": "chill",
        "host": "Tadek",
        "sort_order": 1,
    },
    {
        "id": "slowianski-folk",
        "group_id": "etno-folk",
        "name": "Folk i Korzenie",
        "tagline": "Słowiańska i nordycka liryka, skrzypce, cymbały i przestrzeń lasu",
        "prompt": "modern acoustic folk instrumental, warm fiddle harmonies, gentle plucked dulcimer and acoustic guitar, soft frame drum pulse, Slavic and Nordic woodland atmosphere, instrumental",
        "bpm": 94,
        "density": 0.44,
        "brightness": 0.46,
        "category": "chill",
        "host": "Ola",
        "sort_order": 2,
    },
]


def _build_default_stations() -> list[dict[str, Any]]:
    stations: list[dict[str, Any]] = []
    for station_id, spec in STATION_SPECS.items():
        meta = EXISTING_STATION_METADATA.get(
            station_id,
            {
                "group_id": "fokus-puls",
                "name": station_id.replace("-", " ").title(),
                "tagline": "Muzyka instrumentalna DOS Radio",
                "category": "fokus",
                "host": "Kuba",
                "sort_order": 99,
            },
        )
        stations.append(
            {
                "id": station_id,
                "group_id": meta["group_id"],
                "name": meta["name"],
                "tagline": meta["tagline"],
                "prompt": spec["prompt"],
                "bpm": int(spec["bpm"]),
                "density": float(spec["density"]),
                "brightness": float(spec["brightness"]),
                "category": meta["category"],
                "host": meta["host"],
                "sort_order": int(meta["sort_order"]),
            }
        )
    stations.extend(NEW_BUILTIN_STATIONS)
    stations.extend([{**st, "enabled": True, "is_builtin": True} for st in EXTRA_BUILTIN_STATIONS])
    return stations


DEFAULT_STATIONS: list[dict[str, Any]] = _build_default_stations()


def validate_slug(value: str) -> str:
    slug = (value or "").strip().lower()
    if not SLUG_RE.match(slug):
        raise ValueError(f"Nieprawidłowy identyfikator slug: {value!r} (wymagane ^[a-z0-9-]{{2,48}}$)")
    return slug


def clamp_bpm(bpm: int | float) -> int:
    return max(50, min(190, int(round(bpm))))


def clamp_unit(val: float | int) -> float:
    return round(max(0.05, min(0.95, float(val))), 3)


class CatalogService:
    def __init__(self, db: Database, archives: ArchiveRegistry | None = None) -> None:
        self.db = db
        self.archives = archives
        self._init_and_seed()

    def _init_and_seed(self) -> None:
        now = time.time()
        with self.db.connect() as conn:
            conn.executescript(CATALOG_SCHEMA)
            for grp in DEFAULT_GROUPS:
                conn.execute(
                    "INSERT OR IGNORE INTO music_groups "
                    "(id, name, tagline, color, sort_order, enabled, created_at) "
                    "VALUES (?, ?, ?, ?, ?, 1, ?)",
                    (
                        grp["id"],
                        grp["name"],
                        grp["tagline"],
                        grp["color"],
                        grp["sort_order"],
                        now,
                    ),
                )
            for st in DEFAULT_STATIONS:
                conn.execute(
                    "INSERT OR IGNORE INTO music_stations "
                    "(id, group_id, name, tagline, prompt, bpm, density, brightness, "
                    "category, host, sort_order, enabled, is_builtin, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)",
                    (
                        st["id"],
                        st["group_id"],
                        st["name"],
                        st["tagline"],
                        st["prompt"],
                        clamp_bpm(st["bpm"]),
                        clamp_unit(st["density"]),
                        clamp_unit(st["brightness"]),
                        st["category"],
                        st["host"],
                        st["sort_order"],
                        now,
                    ),
                )
            conn.execute(
                "UPDATE music_stations SET name = ?, group_id = ?, tagline = ? "
                "WHERE id = 'raw-techno' AND is_builtin = 1 AND name = 'Mocne Techno'",
                (RAW_TECHNO_OVERRIDE["name"], RAW_TECHNO_OVERRIDE["group_id"], RAW_TECHNO_OVERRIDE["tagline"]),
            )

    def _row_to_group(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "tagline": row["tagline"],
            "color": row["color"],
            "sort_order": int(row["sort_order"]),
            "enabled": bool(row["enabled"]),
            "created_at": float(row["created_at"]),
        }

    def _row_to_station(self, row: Any) -> dict[str, Any]:
        sid = row["id"]
        segment_count = 0
        archive_hours = 0.0
        if self.archives is not None:
            arch = self.archives.get(sid)
            segs = arch.list_segments()
            segment_count = len(segs)
            archive_hours = arch.total_hours()
        return {
            "id": sid,
            "group_id": row["group_id"],
            "name": row["name"],
            "tagline": row["tagline"],
            "prompt": row["prompt"],
            "bpm": int(row["bpm"]),
            "density": float(row["density"]),
            "brightness": float(row["brightness"]),
            "category": row["category"],
            "host": row["host"],
            "sort_order": int(row["sort_order"]),
            "enabled": bool(row["enabled"]),
            "is_builtin": bool(row["is_builtin"]),
            "created_at": float(row["created_at"]),
            "segment_count": segment_count,
            "archive_hours": archive_hours,
        }

    def get_group(self, group_id: str) -> dict[str, Any] | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM music_groups WHERE id = ?", (group_id,)).fetchone()
        return self._row_to_group(row) if row else None

    def get_station(self, station_id: str) -> dict[str, Any] | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM music_stations WHERE id = ?", (station_id,)).fetchone()
        return self._row_to_station(row) if row else None

    def list_groups(self, include_disabled: bool = False) -> list[dict[str, Any]]:
        query = "SELECT * FROM music_groups"
        if not include_disabled:
            query += " WHERE enabled = 1"
        query += " ORDER BY sort_order ASC, id ASC"
        with self.db.connect() as conn:
            rows = conn.execute(query).fetchall()
        return [self._row_to_group(r) for r in rows]

    def list_stations(
        self, include_disabled: bool = False, group_id: str | None = None
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if not include_disabled:
            clauses.append("enabled = 1")
        if group_id is not None:
            clauses.append("group_id = ?")
            params.append(group_id)
        query = "SELECT * FROM music_stations"
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY sort_order ASC, id ASC"
        with self.db.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_station(r) for r in rows]

    def stations_in_group(self, group_id: str, only_enabled: bool = True) -> list[dict[str, Any]]:
        return self.list_stations(include_disabled=not only_enabled, group_id=group_id)

    def public_catalog(self) -> dict[str, Any]:
        groups = self.list_groups(include_disabled=False)
        enabled_group_ids = {g["id"] for g in groups}
        all_enabled_stations = self.list_stations(include_disabled=False)
        stations = [s for s in all_enabled_stations if s["group_id"] in enabled_group_ids]
        return {
            "groups": groups,
            "stations": stations,
        }

    def active_specs(self) -> dict[str, dict[str, Any]]:
        pub = self.public_catalog()
        return {
            st["id"]: {
                "prompt": st["prompt"],
                "bpm": st["bpm"],
                "density": st["density"],
                "brightness": st["brightness"],
                "group_id": st["group_id"],
                "host": st["host"],
            }
            for st in pub["stations"]
        }

    def upsert_group(
        self,
        group_id: str | dict[str, Any],
        name: str | None = None,
        tagline: str = "",
        color: str = "#8f6bff",
        sort_order: int = 0,
        enabled: bool = True,
    ) -> dict[str, Any]:
        if isinstance(group_id, dict):
            data = group_id
            gid = validate_slug(str(data.get("id") or ""))
            name = str(data.get("name") or "").strip()
            tagline = str(data.get("tagline") or "").strip()
            color = str(data.get("color") or "#8f6bff").strip()
            sort_order = int(data.get("sort_order", 0))
            enabled = bool(data.get("enabled", True))
        else:
            gid = validate_slug(group_id)
            name = (name or "").strip()
            tagline = tagline.strip()
            color = color.strip() or "#8f6bff"
        if not name:
            raise ValueError("Nazwa grupy jest wymagana")
        now = time.time()
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO music_groups (id, name, tagline, color, sort_order, enabled, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET "
                "name=excluded.name, tagline=excluded.tagline, color=excluded.color, "
                "sort_order=excluded.sort_order, enabled=excluded.enabled",
                (gid, name, tagline, color, int(sort_order), 1 if enabled else 0, now),
            )
        grp = self.get_group(gid)
        assert grp is not None
        return grp

    def update_group(self, group_id: str, changes: dict[str, Any] | None = None, **kwargs: Any) -> dict[str, Any]:
        gid = validate_slug(group_id)
        existing = self.get_group(gid)
        if existing is None:
            raise KeyError(f"Nieznana grupa: {gid}")
        updates = dict(changes or {})
        updates.update(kwargs)
        merged = {
            "id": gid,
            "name": updates.get("name", existing["name"]),
            "tagline": updates.get("tagline", existing["tagline"]),
            "color": updates.get("color", existing["color"]),
            "sort_order": updates.get("sort_order", existing["sort_order"]),
            "enabled": updates.get("enabled", existing["enabled"]),
        }
        return self.upsert_group(merged)

    def upsert_station(
        self,
        station_id: str | dict[str, Any],
        group_id: str | None = None,
        name: str | None = None,
        tagline: str = "",
        prompt: str = "",
        bpm: int = 120,
        density: float = 0.45,
        brightness: float = 0.45,
        category: str = "fokus",
        host: str = "Kuba",
        sort_order: int = 0,
        enabled: bool = True,
        is_builtin: bool = False,
    ) -> dict[str, Any]:
        if isinstance(station_id, dict):
            data = station_id
            sid = validate_slug(str(data.get("id") or ""))
            group_id = str(data.get("group_id") or "").strip()
            name = str(data.get("name") or "").strip()
            tagline = str(data.get("tagline") or "").strip()
            prompt = str(data.get("prompt") or "").strip()
            bpm = int(data.get("bpm", 120))
            density = float(data.get("density", 0.45))
            brightness = float(data.get("brightness", 0.45))
            category = str(data.get("category") or "fokus").strip()
            host = str(data.get("host") or "Kuba").strip()
            sort_order = int(data.get("sort_order", 0))
            enabled = bool(data.get("enabled", True))
            is_builtin = bool(data.get("is_builtin", False))
        else:
            sid = validate_slug(station_id)
            group_id = (group_id or "").strip()
            name = (name or "").strip()
            tagline = tagline.strip()
            prompt = prompt.strip()

        if not group_id or self.get_group(group_id) is None:
            raise ValueError(f"Nieznana grupa: {group_id}")
        if not name:
            raise ValueError("Nazwa stacji jest wymagana")
        if not prompt:
            raise ValueError("Prompt muzyczny jest wymagany")

        clamped_bpm = clamp_bpm(bpm)
        clamped_density = clamp_unit(density)
        clamped_brightness = clamp_unit(brightness)
        now = time.time()

        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO music_stations "
                "(id, group_id, name, tagline, prompt, bpm, density, brightness, "
                "category, host, sort_order, enabled, is_builtin, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET "
                "group_id=excluded.group_id, name=excluded.name, tagline=excluded.tagline, "
                "prompt=excluded.prompt, bpm=excluded.bpm, density=excluded.density, "
                "brightness=excluded.brightness, category=excluded.category, host=excluded.host, "
                "sort_order=excluded.sort_order, enabled=excluded.enabled",
                (
                    sid,
                    group_id,
                    name,
                    tagline,
                    prompt,
                    clamped_bpm,
                    clamped_density,
                    clamped_brightness,
                    category or "fokus",
                    host or "Kuba",
                    int(sort_order),
                    1 if enabled else 0,
                    1 if is_builtin else 0,
                    now,
                ),
            )
        st = self.get_station(sid)
        assert st is not None
        return st

    def update_station(
        self, station_id: str, changes: dict[str, Any] | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        sid = validate_slug(station_id)
        existing = self.get_station(sid)
        if existing is None:
            raise KeyError(f"Nieznana stacja: {sid}")
        updates = dict(changes or {})
        updates.update(kwargs)
        merged = {
            "id": sid,
            "group_id": updates.get("group_id", existing["group_id"]),
            "name": updates.get("name", existing["name"]),
            "tagline": updates.get("tagline", existing["tagline"]),
            "prompt": updates.get("prompt", existing["prompt"]),
            "bpm": updates.get("bpm", existing["bpm"]),
            "density": updates.get("density", existing["density"]),
            "brightness": updates.get("brightness", existing["brightness"]),
            "category": updates.get("category", existing["category"]),
            "host": updates.get("host", existing["host"]),
            "sort_order": updates.get("sort_order", existing["sort_order"]),
            "enabled": updates.get("enabled", existing["enabled"]),
            "is_builtin": existing["is_builtin"],
        }
        return self.upsert_station(merged)

    def delete_station(self, station_id: str) -> dict[str, Any]:
        sid = validate_slug(station_id)
        existing = self.get_station(sid)
        if existing is None:
            raise KeyError(f"Nieznana stacja: {sid}")
        if existing["is_builtin"]:
            with self.db.connect() as conn:
                conn.execute("UPDATE music_stations SET enabled = 0 WHERE id = ?", (sid,))
            return {"id": sid, "deleted": False, "disabled": True}
        with self.db.connect() as conn:
            conn.execute("DELETE FROM music_stations WHERE id = ?", (sid,))
        return {"id": sid, "deleted": True, "disabled": False}
