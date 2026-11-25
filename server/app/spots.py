"""Curated AmbiRadio Ciekawostki & Promotional Spots (Guest vs Free vs Plus)."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any
import wave

from .auth import Access
from .hosts import host_for

SPOTS_CATALOG: list[dict[str, str]] = [
    {
        "id": "guest_orbits",
        "tier": "guest",
        "kind": "ciekawostka",
        "title": "Ciekawostka AmbiRadio · Trzy orbity pod kciukiem",
        "text": (
            "Słuchasz AmbiRadio. Ciekawostka z naszej reżyserki: pod kciukiem masz trzy "
            "orbity energii — od głębokiego chillu, przez klubowy groove, aż po nocny rave. "
            "Załóż darmowe konto w dziesięć sekund, żeby zapisywać ulubione stacje "
            "i wysyłać znajomym głosowe pozdrowienia na antenie."
        ),
        "cta_label": "Załóż darmowe konto",
        "cta_tab": "plus",
    },
    {
        "id": "guest_url_audition",
        "tier": "guest",
        "kind": "spot",
        "title": "Spot · Audycja o dowolnej stronie WWW",
        "text": (
            "Chcesz zaskoczyć znajomego albo klienta? Wklej w AmbiRadio adres dowolnej "
            "strony internetowej, a nasi prowadzący przygotują o niej żywą audycję "
            "i połączą ją z dobrą muzyką w jednym zaproszeniu. Zarejestruj się za darmo "
            "i wypróbuj od ręki."
        ),
        "cta_label": "Wypróbuj za darmo",
        "cta_tab": "plus",
    },
    {
        "id": "guest_creator_station",
        "tier": "guest",
        "kind": "ciekawostka",
        "title": "Ciekawostka · Własna stacja w 15 sekund",
        "text": (
            "Czy wiesz, że w AmbiRadio możesz stworzyć własną stację radiową na żywo? "
            "Opisujesz klimat jednym zdaniem, dorzucasz pigułki wiedzy albo linki ze swojego "
            "kanału i udostępniasz gotową antenę jednym kliknięciem. Darmowe konto czeka w zakładce Plus."
        ),
        "cta_label": "Stwórz konto",
        "cta_tab": "plus",
    },
    {
        "id": "guest_dj_bpm",
        "tier": "guest",
        "kind": "spot",
        "title": "Spot · Klubowy miks BPM i Twoja ramówka",
        "text": (
            "Zero przypadkowych przerw i zero szumu. Silnik AmbiRadio dopasowuje tempo BPM "
            "między utworami jak żywy DJ, a serwisy czyta wyłącznie z tematów, które sam wybierzesz. "
            "Zarejestruj się bezpłatnie i ustaw własną ramówkę."
        ),
        "cta_label": "Ustaw swoją ramówkę",
        "cta_tab": "mine",
    },
    {
        "id": "free_plus_duet",
        "tier": "free",
        "kind": "ciekawostka",
        "title": "Ciekawostka AmbiRadio Plus · Audycje bez spotów",
        "text": (
            "Ciekawostka dla zalogowanych słuchaczy: w wersji AmbiRadio Plus zamieniasz "
            "dowolny temat lub notatkę w wieloczęściową audycję dwugłosową — całkowicie bez "
            "spotów promocyjnych między wejściami. Odblokuj Plus w zakładce obok."
        ),
        "cta_label": "Odblokuj AmbiRadio Plus",
        "cta_tab": "plus",
    },
    {
        "id": "free_plus_rss",
        "tier": "free",
        "kind": "spot",
        "title": "Spot · Twój prywatny przegląd RSS i branży",
        "text": (
            "Masz już konto w AmbiRadio — sprawdź, co potrafi Plus. Podpinasz własne kanały RSS, "
            "strony branżowe i słowa kluczowe, a prowadzący sami robią dla Ciebie świeży skrót "
            "między utworami. Przejdź na Plus i słuchaj bez przerw reklamowych."
        ),
        "cta_label": "Przejdź na Plus",
        "cta_tab": "plus",
    },
    {
        "id": "free_plus_pills",
        "tier": "free",
        "kind": "ciekawostka",
        "title": "Ciekawostka · Pigułki wiedzy w rytmie muzyki",
        "text": (
            "W AmbiRadio Plus wrzucasz długi artykuł albo raport jako pigułkę wiedzy, a radio "
            "dawkuje Ci najważniejsze wnioski w krótkich wejściach dopasowanych do rytmu stacji. "
            "Zero spotów, sto procent Twoich tematów."
        ),
        "cta_label": "Sprawdź wersję Plus",
        "cta_tab": "plus",
    },
    {
        "id": "free_plus_unlimited",
        "tier": "free",
        "kind": "spot",
        "title": "Spot · Pełna antena AmbiRadio Plus",
        "text": (
            "Trzy orbity muzyki, żywi prowadzący i własne audycje na żądanie. Z pakietem "
            "AmbiRadio Plus odblokowujesz pełny limit generowania podcastów i czystą antenę "
            "bez komunikatów promocyjnych."
        ),
        "cta_label": "Włącz Plus",
        "cta_tab": "plus",
    },
]

_BY_ID = {s["id"]: s for s in SPOTS_CATALOG}


def _silent_wav() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(b"\x00\x00" * 4800)
    return buf.getvalue()


class SpotService:
    def __init__(self, gemini: Any, cache_dir: Path) -> None:
        self.gemini = gemini
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._cursor = 0

    def list_all(self) -> list[dict[str, str]]:
        return list(SPOTS_CATALOG)

    def pick_for_access(self, access: Access, station_id: str = "dos-groove") -> dict[str, Any]:
        if access.plus:  # subscribers and the 6 h full-experience trial hear no spots
            return {"skip": True, "tier": "plus", "spot": None}
        tier = "free" if access.registered else "guest"
        pool = [s for s in SPOTS_CATALOG if s["tier"] == tier]
        spot = dict(pool[self._cursor % len(pool)])
        self._cursor += 1
        spot["audio_url"] = f"/radio-api/social/spot/{spot['id']}.wav?station={station_id}"
        return {"skip": False, "tier": tier, "spot": spot}

    async def render_wav(self, spot_id: str, station_id: str = "dos-groove") -> Path:
        spot = _BY_ID.get(spot_id)
        if not spot:
            raise KeyError(spot_id)
        host = host_for(station_id)
        safe_voice = "".join(c for c in host.voice if c.isalnum()) or "Puck"
        out_path = self.cache_dir / f"{spot_id}_{safe_voice}.wav"
        if out_path.exists() and out_path.stat().st_size > 100:
            return out_path
        try:
            audio = await self.gemini.speak(
                spot["text"],
                host.voice,
                "ciepły, dynamiczny głos radiowy, naturalne tempo, bez patosu",
            )
        except Exception:
            audio = _silent_wav()
        out_path.write_bytes(audio)
        return out_path
