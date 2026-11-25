# Project State: dosradio

## Active Goal
DOS Radio v1.0.0 — publiczne radio AI (Lyria RealTime, 14 stacji z prowadzącymi, wiadomości co godzinę, PWA) na `https://dosradio.theones.io`

## Tech Stack
- **Languages:** Python 3.12, TypeScript 5.5
- **Frameworks:** FastAPI (uvicorn :3015), Vite 5, Web Audio API, MediaSession API
- **Storage:** SQLite WAL (`users`, `sessions`, `trials`), 100h FIFO Opus Archive (`data/archive/<station>/`)
- **Production:** `borg.tools` (`/var/www/dosradio.theones.io` + PM2 `dosradio-api` :3015)
- **GitHub:** `https://github.com/wojciechwiesner/dosradio`

## Tasks & Phases
- [x] **Phase 0: Repository Profiling & JIT Context Initialization** (`jit init .`)
- [x] **Phase 1: Core Architecture & 14 Stations with Named Hosts**
  - [x] 14 stacji muzycznych (w tym *DOS Groove*, *Stoa*, *Liquid DnB*, *Głęboki Ambient*, *Microhouse*, *Mocne Techno*, *Klubowy Dance*, *Nocny Jazz*, *Neo Funk*)
  - [x] Nazwani prowadzący dopasowani do stacji (Kuba, Ola, Rafał, Ida, Marek, Zosia, Lena, Tadek, Max, Igor, Wiktor, Helena, Marta, Szymon)
  - [x] AI Mood Composer (`/radio-api/mood`) — generowanie stacji z opisu nastroju po polsku w czasie rzeczywistym
  - [x] Tryb „Tylko muzyka” (wyłączenie wejść prowadzącego i wiadomości)
- [x] **Phase 2: 100h FIFO Archive, 70/30 Stream & Dead-Air Watchdog**
  - [x] Nagrywanie w tle 30s segmentów Ogg/Opus 96 kbps z rotacją FIFO powyżej 100h
  - [x] Ciągłe odtwarzanie w kolejności nagrania (`?after=seg-...`) bez przeskoków i pętli
  - [x] Strażnik ciszy (Watchdog) na limit 10 minut sesji Google — dżingiel i bezszwowe wznowienie
  - [x] Natychmiastowy start (~100 ms) z powitaniem prowadzącego i animowanym EQ
- [x] **Phase 3: Hourly News Editions, PWA & Telegram Telemetry**
  - [x] Cogodzinne wydania wiadomości (AI, Beauty i moda, Sport, Głupie, Stoicka myśl) nagrywane raz i współdzielone
  - [x] Naprawa TTS (`gemini-3.8-flash-tts`) — czysty polski tekst bez wycieków instrukcji angielskich
  - [x] Pełne PWA (`manifest.webmanifest`, `sw.js`, ikony) + odtwarzanie w tle na iOS/Android (`MediaSession` + silent audio keep-alive)
  - [x] Alerty na Telegram po rejestracji nowego słuchacza wraz z obciążeniem CPU/RAM i stanem archiwum
  - [x] Obsługa puli wielu kluczy Google (`KeyPool` / `GEMINI_API_KEYS`)
- [x] **Phase 4: Verification & Production Deployment**
  - [x] Testy jednostkowe: 8/8 `pytest` PASS, 8/8 `vitest` PASS, `tsc --noEmit` 0 błędów
  - [x] Weryfikacja E2E w Chrome (`scripts/diagnose.mjs` + `scripts/test-e2e-fixes.mjs`) na żywej produkcji `https://dosradio.theones.io`
  - [x] Naprawa crashu `toLocaleTimeString`, odblokowanie wiadomości on-demand, naprawa trasowania audio newsów i WebSocket Lyria

- [x] **Phase 5: E-mail Verification (v1.1.0)**
  - [x] Potwierdzenie adresu e-mail przez SMTP po rejestracji (token 24h)
  - [x] Blokada logowania przed weryfikacją (HTTP 403) z opcją ponownej wysyłki linku
  - [x] Obsługa lądowania na `/?verify=<token>` w UI

- [x] **Phase 6: DOS Radio Plus & Monetyzacja (v1.2.0)**
  - [x] **Duet Podcasts (NotebookLM-PL):** `POST /radio-api/plus/podcast` (Ania i Michał, `gemini-3.8-flash`, cache w `data/podcasts/`)
  - [x] **Personalizacja wiadomości:** `PUT/GET /radio-api/plus/news-preferences` (RSS 2.0/Atom, keywords, 5s timeout per feed)
  - [x] **Płatności Stripe:** `POST /radio-api/billing/checkout` (Plus 39 PLN, Plus+AI 59 PLN, B2B invoice), webhook podpisany
  - [x] **UI Plus:** pływający widżet "Plus", modal planów i statusu, drawer "Twoje źródła"

- [x] **Phase 7: Onboarding Wave (v1.3.0, 2026-11-06)**
  - [x] Trial bez logowania 1 h (prod .env DOSRADIO_TRIAL_SECONDS=3600)
  - [x] Pierwsze wiadomości 5 min po Graj, częstotliwość 5/10/15/20/30/60 min
  - [x] Onboarding przy pierwszym odtworzeniu (motto, prowadzący tak/nie, obszary wiadomości, częstotliwość)
  - [x] 30 dni Plus po potwierdzeniu e-maila + jednorazowo 4 istniejące konta
  - [x] 56 dżingli + 112 gadek prowadzących (TTS przy pierwszym użyciu, cache)
  - [x] Orkiestracja cmux: W1 Sonnet 5.5 (frontend), W2 Haiku 5.5 (backend)

- [x] **Phase 9: v1.4 bg/loudness/stream (2026-11-07, przejęte przez Hermes)**
  - [x] U1 loudness: głos -8 dB pod muzyką, duck 0.34, loudnorm -19 LUFS na TTS (merge ad650e6)
  - [x] U2 stream: ciągły ogg/opus przez prawdziwy <audio> (granie w tle), /radio-api/station/{id}/stream.ogg (merge b86c54e)
  - [ ] U3a beatgrid: zrewertowany przez autora (0e1095d), brak numpy/librosa na prod — NIE wdrożone
  - [ ] U3b beat-aligned mix: commit 5da230e niekompletny (usuwa _feed/_drain/_publish, test_stream nie zbiera się) — ODRZUCONY, wymaga przepisania
- [x] Moje pigułki: user_pills + GET /radio-api/plus/pills; pigułka Dr. K przypisana do user 13
- [x] **Orbita Voice Recordings (2026-11-18):** nagrania głosowe WAV na starcie Orbity (`/radio-api/orbita/intro/{station}/{0..3}.wav` — Kuba i wszyscy prowadzący), `/radio-api/showcase` (duet Kuba+Ola i Marek+Ola), `/radio-api/orbita/nudge/5min.wav`, cache dyskowy `data/voice/orbita/` + prewarm przy starcie
- [x] **Phase 10: Ecosystem v2.0 — DJ Phrase Mixer, Classic<->Orbita PWA, 6 Music Groups + 7 Genres, Auto-Ramowka 24/7, Admin Cockpit & `zrobi.my` B2B Portal (2026-11-18):**
  - [x] Silnik miksera (`server/app/mixer.py`, `stream.py`): 15 ms micro-declick dla ciągłych cięć intra-session + 16-beatowy (~7.8s) beatmatched DJ mix z midpoint bass-swap 150 Hz oraz 6.5s equal-power crossfade dla ambientu/klasyki/folku
  - [x] Przełącznik widoku `Klasyczny <-> Orbita 3D` w aplikacji i PWA (`manifest.webmanifest`, `sw.js`, `?view=orbita`)
  - [x] 6 grup i podgrup muzycznych z graniem całej grupy (`/radio-api/group/{id}/stream.ogg`) + 7 nowych gatunków (`stranger-synth`, `muzyka-filmowa`, `cyber-noir`, `muzyka-klasyczna`, `instrumentalna-akustyczna`, `etno-world`, `slowianski-folk`)
  - [x] Tryb `Auto-Ramówka 24/7` (muzyka wg pory dnia co godzinę, wiadomości co 20 min, podcasty, dżingle, spoty wdrożeń AI `zrobi.my`)
  - [x] Panel Admina `/admin.html` + `server/app/admin_api.py`, `catalog.py`, `telemetry.py` (odsłuch `.opus`, Tester Miksera DJ z wykresem obwiedni, tokeny, userzy online/zarejestrowani, CRUD grup/stacji, edytor ramówki i leady)
  - [x] Osobny projekt B2B `/Users/wojciechwiesner/Projects/active/zrobimy` (`www.zrobi.my`) dla właścicieli firm MŚP (kalkulator ROI AI, diagnostyk procesów, odtwarzacz Auto-Ramówki, formularz spięty z `/radio-api/leads/zrobimy`)

- [x] **Phase 11: Techno/Rave & B2B Spaces Expansion, Personal Dedications, Admin Prompt Editor & Universal MP3/Ogg DJ Mix (2026-11-18):**
  - [x] 8 stacji w grupie `techno-rave` (`berlin-bcco-techno`, `raw-techno`, `hypnotic-techno`, `etno-techno`, `tribal-techno`, `goa-trance`, `hard-dance`, `tekk`) + 3 zestawy `przestrzenie-b2b` (`salon-beauty-spa`, `lobby-hotelowe`, `poczekalnia`) — łącznie 42 stacje w 8 grupach
  - [x] Dedykacje głosowe (`POST /radio-api/dedications`, `/orbita.html?d=...`, `/?d=...`) z limitem 200 znaków i cache'owanym powitaniem WAV prowadzącego
  - [x] Edytor promptów Lyria inline przy każdej stacji w `/admin.html` + wyszukiwarka promptów (`PATCH /radio-api/admin/catalog/stations/{id}`)
  - [x] Uniwersalny stream DJ miksera `/radio-api/station/{id}/stream.mp3` dla Safari/WebKit/iOS (koniec spadania do surowych chunków 80 ms) + korekta duckingu (`musicBus=1.0`, `DUCK_LEVEL=0.24`, pre-duck 320 ms, fade-in 1.8 s) + zaktualizowane hasło o darmowej pierwszej godzinie

## Next Steps (Backlog / v1.3)
- [ ] Podpięcie produkcyjnych kluczy Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) na serwerze
- [ ] B2B Audio Streamer dla lokali i kawiarni (dedykowany profil licencyjny)
