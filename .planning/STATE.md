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

## Next Steps (Backlog / v1.1)
- [ ] **DOS Radio Plus (Premium):** generator dyskusji i podcastów w duecie (format NotebookLM po polsku) przeplatanych 4–7 min muzyki
- [ ] **Personalizacja źródeł wiadomości:** własne słowa kluczowe i kanały RSS dla subskrybentów Plus
- [ ] **Płatności Stripe:** podpięcie Stripe Checkout pod plan Plus (29–39 PLN/mies.) i ofertę B2B dla lokali
