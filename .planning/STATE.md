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

## Next Steps (Backlog / v1.3)
- [ ] Podpięcie produkcyjnych kluczy Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) na serwerze
- [ ] B2B Audio Streamer dla lokali i kawiarni (dedykowany profil licencyjny)
