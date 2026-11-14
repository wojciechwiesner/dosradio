# DOS Radio Orbita v2: wdrożenie i kontrakt z backendem

## Wdrożenie

1. Po zmianach w `orbita/src/` zbuduj stronę poleceniem `npm run build:orbita`, uruchomionym z katalogu repo.
   Powstanie `public/orbita.html`. Używa esbuild, który jest już w `node_modules` razem z Vite.
2. `./deploy.sh` zrobi resztę: Vite skopiuje `public/orbita.html` do `dist/`, a rsync wyśle go na `/var/www/dosradio.theones.io/`.
   Nginx poda plik pod `https://dosradio.theones.io/orbita.html`.
3. three.js 0.170.0 i fonty idą z CDN (`cdn.jsdelivr.net`, Google Fonts). Vhost nie ma CSP, więc nic nie trzeba zmieniać.
   Nagłówek `Permissions-Policy: microphone=(), geolocation=()` wyłącza dyktowanie nastroju i „Użyj mojej lokalizacji”.
   Orbita wykrywa to i chowa oba przyciski.
4. Język: `#pl`, `#en` lub `#ru` w adresie, przełącznik PL/EN/RU albo język przeglądarki.

Orbita dzieli z klasycznym DOS Radio te klucze `localStorage`: `dosradio.prefs.v1`, `dosradio.pillQueue.v1`
i `dosradio.aired.v1`. Obie wersje mogą więc działać równolegle. Pigułki „showcase” czytane głosem przeglądarki
nie trafiają do wspólnej kolejki, bo klasyczna wersja nie umie ich odtworzyć.

## Endpointy już używane (bez zmian)

`/me`, `/trial/start`, `/register`, `/login`, `/logout`, `/news?cats=`, `/mood`, `/aired` (GET i POST),
`/station/{id}/stream.ogg`, `/station/{id}/next-chunk`, `/intro.wav`, `/story/{id}.wav`, `/story/{id}/headline.wav`,
`/weather.wav`, `/teaser.wav`, `/host-clips/{id}`, `/plus/news-preferences` (GET i PUT), `/plus/news-digest`,
`/plus/podcast`, `/plus/pill`, `/plus/pill/{id}`, `/plus/pills`, `/billing/status`, `/billing/checkout`.

Logika przerw jest przeniesiona 1:1:
- pierwsze wejście po 5 min (w darmowej godzinie po 20 s od intro),
- potem co `interval`, minimum 45 s po końcu poprzedniego wejścia,
- formaty flash, main i hourly z limitem 4 min,
- twoje newsy mają priorytet 4, temat dnia 2,
- pigułki wchodzą po wiadomościach,
- przerywniki prowadzącego co 6–12 min,
- ściszanie muzyki pod głos.

## Do dodania w backendzie

### 1. Parametr `lang` (EN/RU)

Frontend już go wysyła:

- `GET /news?cats=…&lang=en`
- `POST /plus/podcast {topic, lang}`
- `POST /mood {mood, lang}`
- `intro.wav`, `teaser.wav` i `weather.wav` z `&lang=`

Dopóki backend go ignoruje, treści będą po polsku, a po angielsku i rosyjsku będzie tylko interfejs.

### 2. `GET /radio-api/showcase?lang=pl`

Służy do odtworzenia na starcie gotowego audio zamiast głosu przeglądarki.

```json
{ "podcast": { "id": "showcase-default", "title": "Twoja muzyka. Twoje tematy. Twoje życie.",
               "parts": [{ "kind": "voice", "url": "/radio-api/showcase/pl/01.wav" }, { "kind": "bumper", "url": "…" }] },
  "stoic":   { "id": "showcase-stoic", "title": "Stoicka pigułka: Seneka o czasie", "parts": [ … ] } }
```

Scenariusze w trzech językach są w `src/content.js` (`introScript`, `defaultPodcast`, `stoicPill`).
Wyrenderuj je raz waszym TTS w duecie i trzymaj w cache. Bez tego endpointu czyta je głos przeglądarki,
który jest wyraźnie gorszy.

### 3. Jeden darmowy podcast

Dla kont bez Plus `POST /plus/podcast` powinien przejść raz na trial lub konto, licząc po sesji, a nie po IP.
Kolejne wywołanie ma zwrócić `402` z `detail`. Dodaj też do `/me` pole `free_podcasts_left`.
Frontend już obsługuje `401/402/403`: pokazuje wtedy „darmowy podcast wykorzystany” i plany.

### 4. Gmail

Endpointy:

- `GET /radio-api/plus/connectors` → `{ "gmail": { "available": true, "connected": false, "connect_url": "/radio-api/connect/gmail" } }`
- `GET /radio-api/connect/gmail` → OAuth i powrót na `/orbita.html#pl`.
- Backend wybiera (LLM) 3 najważniejsze maile i tworzy z nich story z `category: "personal"`
  w `/news` (dla `cats` zawierających `mine`) oraz w `/plus/news-digest`. Ich `radio_text` zawiera radę, co zrobić.

Uwaga: zakresy Gmaila (`gmail.metadata` i `gmail.readonly`) Google traktuje, o ile wiem, jako „restricted”.
Publiczna aplikacja wymaga weryfikacji i corocznej oceny bezpieczeństwa. W trybie testowym (do 100 użytkowników) można ruszyć od razu.
Copy w UI obiecuje dostęp tylko do nadawcy, tematu i początku treści, więc tak to zaimplementuj albo zmień tekst.

## Czego nie przeniosłem

- **Nastrój „na zamówienie” (Lyria realtime po stronie klienta).** Gdy `/mood` zwróci własną stację,
  Orbita gra najbliższą z 25 stacji (po BPM i jasności) i pokazuje nazwę nastroju.
- **ToneKiller, MediaSession i link weryfikacyjny `?verify=`.** Te zostają w klasycznej wersji.
