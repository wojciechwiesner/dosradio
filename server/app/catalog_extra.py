from __future__ import annotations

from typing import Any

EXTRA_GROUPS: list[dict[str, Any]] = [
    {
        "id": "techno-rave",
        "name": "Techno i Rave",
        "tagline": "Berlin BCCO, raw, hypnotic, tribal, Goa i twardy parkiet",
        "color": "#e11d48",
        "sort_order": 7,
    },
    {
        "id": "przestrzenie-b2b",
        "name": "Przestrzenie i Lokale",
        "tagline": "Gotowe zestawy do salonu beauty/spa, lobby hotelowego i poczekalni",
        "color": "#d4a373",
        "sort_order": 8,
    },
]

RAW_TECHNO_OVERRIDE: dict[str, Any] = {
    "name": "Raw Techno",
    "tagline": "Surowa przesterowana stopa 909 i ciemny warehouse groove",
    "group_id": "techno-rave",
    "sort_order": 1,
    "prompt": (
        "Raw warehouse techno, 138 BPM, overdriven analog 909 kickdrum, dark industrial rumble sub-bass, "
        "metallic percussive loops, sidechained vinyl stabs, hypnotic relentless groove, no melodic synth leads, no vocals, instrumental"
    ),
}

EXTRA_BUILTIN_STATIONS: list[dict[str, Any]] = [
    {
        "id": "berlin-bcco-techno",
        "name": "Berlin BCCO Techno",
        "tagline": "Szybki berliński groove, winylowe staby i chopy z sidechainem",
        "group_id": "techno-rave",
        "category": "energia",
        "bpm": 140,
        "density": 0.78,
        "brightness": 0.42,
        "host": "Wiktor",
        "prompt": (
            "Fast groovy Berlin BCCO underground club techno, 140 BPM, punchy 909 kickdrum, rolling funky sub-bass groove, "
            "crisp offbeat hi-hats, raw vinyl dub stabs and sample chops with heavy sidechain pumping, zero melodic synth leads, no screeches, instrumental"
        ),
        "sort_order": 0,
    },
    {
        "id": "hypnotic-techno",
        "name": "Hypnotic Techno",
        "tagline": "Głęboki tunelowy puls modularny i dubowe echa",
        "group_id": "techno-rave",
        "category": "fokus",
        "bpm": 134,
        "density": 0.68,
        "brightness": 0.32,
        "host": "Rafał",
        "prompt": (
            "Deep hypnotic techno, 134 BPM, evolving polyrhythmic modular percussion, dark filtered dub chords with tape delay, "
            "deep rolling sub-bass, subtle analog saturation, meditative tunnel groove, no melodic leads, instrumental"
        ),
        "sort_order": 2,
    },
    {
        "id": "etno-techno",
        "name": "Etno Techno",
        "tagline": "Organiczne bębny obręczowe i darbuka na głębokiej stopie",
        "group_id": "techno-rave",
        "category": "fokus",
        "bpm": 126,
        "density": 0.66,
        "brightness": 0.46,
        "host": "Kuba",
        "prompt": (
            "Organic ethno techno, 126 BPM, driving four-on-the-floor kick fused with darbuka, frame drums and shamanic hand percussion, "
            "deep hypnotic sub-bass, earthy wooden rhythmic textures, no cheesy synth leads, instrumental"
        ),
        "sort_order": 3,
    },
    {
        "id": "tribal-techno",
        "name": "Tribal",
        "tagline": "Gęste polirytmie kong, bongosów i tomów na surowym kicku",
        "group_id": "techno-rave",
        "category": "energia",
        "bpm": 136,
        "density": 0.82,
        "brightness": 0.44,
        "host": "Wiktor",
        "prompt": (
            "Driving tribal techno, 136 BPM, dense interlocking conga, bongo and low tom polyrhythms over a punchy 909 kickdrum, "
            "raw percussive stabs with heavy sidechain groove, relentless rhythmic momentum, no melodic synth leads, instrumental"
        ),
        "sort_order": 4,
    },
    {
        "id": "goa-trance",
        "name": "Goa Trance",
        "tagline": "Kwaśne linie TB-303 i hipnotyczny trans lat 90.",
        "group_id": "techno-rave",
        "category": "energia",
        "bpm": 142,
        "density": 0.78,
        "brightness": 0.58,
        "host": "Wiktor",
        "prompt": (
            "Classic 90s Goa trance, 142 BPM, driving four-on-the-floor kick, rolling 16th-note analog bassline, "
            "resonant TB-303 acid filter sweeps, hypnotic eastern modal arpeggiated sequences, psychedelic percussion, instrumental"
        ),
        "sort_order": 5,
    },
    {
        "id": "hard-dance",
        "name": "Hard Dance",
        "tagline": "Reverse-bass, twardy wykop i klubowa energia szczytu nocy",
        "group_id": "techno-rave",
        "category": "energia",
        "bpm": 148,
        "density": 0.84,
        "brightness": 0.54,
        "host": "Filip",
        "prompt": (
            "High-energy European hard dance, 148 BPM, punchy reverse-bass and driving rave kick, "
            "energetic offbeat rhythmic stabs, crisp open hi-hats, relentless peak-time club drive, instrumental"
        ),
        "sort_order": 6,
    },
    {
        "id": "tekk",
        "name": "Tekk",
        "tagline": "Ciężka, przesterowana stopa Hardtekk i surowy rave",
        "group_id": "techno-rave",
        "category": "energia",
        "bpm": 155,
        "density": 0.86,
        "brightness": 0.38,
        "host": "Wiktor",
        "prompt": (
            "Underground German Tekk and Hardtekk, 155 BPM, heavily distorted bouncy warehouse kickdrum, "
            "raw industrial percussion, dark rhythmic vinyl chops, aggressive minimalist rave groove, no cheesy melodies, instrumental"
        ),
        "sort_order": 7,
    },
    {
        "id": "salon-beauty-spa",
        "name": "Salon Beauty & Spa",
        "tagline": "Ciepły organiczny lounge i aksamitny relaks do zabiegów",
        "group_id": "przestrzenie-b2b",
        "category": "chill",
        "bpm": 96,
        "density": 0.34,
        "brightness": 0.56,
        "host": "Ola",
        "prompt": (
            "Warm luxury beauty salon and spa lounge, 96 BPM, silky Fender Rhodes chords, gentle Balearic percussion, "
            "soft acoustic guitar harmonics, velvet sub-bass, soothing sunlit elegance, no harsh transients, instrumental"
        ),
        "sort_order": 0,
    },
    {
        "id": "lobby-hotelowe",
        "name": "Lobby Hotelowe",
        "tagline": "Butikowy nu-jazz, Rhodes i eleganckie tło rozmów",
        "group_id": "przestrzenie-b2b",
        "category": "chill",
        "bpm": 104,
        "density": 0.42,
        "brightness": 0.54,
        "host": "Helena",
        "prompt": (
            "Sophisticated boutique hotel lobby lounge, 104 BPM, warm nu-jazz electric piano, brushed acoustic drums, "
            "mellow upright bass, subtle atmospheric pads, cosmopolitan refined background groove, instrumental"
        ),
        "sort_order": 1,
    },
    {
        "id": "poczekalnia",
        "name": "Poczekalnia",
        "tagline": "Kojący fortepian felt i miękki ambient obniżający napięcie",
        "group_id": "przestrzenie-b2b",
        "category": "chill",
        "bpm": 76,
        "density": 0.24,
        "brightness": 0.50,
        "host": "Ola",
        "prompt": (
            "Calm reassuring waiting room ambient acoustic, 76 BPM, warm felt piano, soft sustained cello and airy pads, "
            "gentle steady pulse, stress-reducing consonant harmonies, unobtrusive peaceful atmosphere, instrumental"
        ),
        "sort_order": 2,
    },
]

EXTRA_BORROWED_HOSTS: dict[str, tuple[str, str]] = {
    "berlin-bcco-techno": ("raw-techno", "Berlin BCCO Techno"),
    "hypnotic-techno": ("raw-techno", "Hypnotic Techno"),
    "etno-techno": ("groove-funk", "Etno Techno"),
    "tribal-techno": ("raw-techno", "Tribal"),
    "goa-trance": ("raw-techno", "Goa Trance"),
    "hard-dance": ("poranna-kawa", "Hard Dance"),
    "tekk": ("raw-techno", "Tekk"),
    "salon-beauty-spa": ("deep-ambient", "Salon Beauty i Spa"),
    "lobby-hotelowe": ("warm-jazz", "Lobby Hotelowe"),
    "poczekalnia": ("lofi-nauka", "Poczekalnia"),
}

EXTRA_RECORDER_SPECS: dict[str, dict[str, Any]] = {
    st["id"]: {
        "prompt": st["prompt"],
        "bpm": st["bpm"],
        "density": st["density"],
        "brightness": st["brightness"],
    }
    for st in EXTRA_BUILTIN_STATIONS
}
