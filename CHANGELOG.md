# Changelog

All notable changes to DOS Radio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Ramówka planner** (`programme.ts`): two short break formats alternate every break. FLASH reads 2-3
  one-sentence headlines plus a teaser for the next story; MAIN tells one story (topic of the day first)
  plus a teaser. The first break after every full hour is an extended bulletin: remaining headlines,
  the top 2 stories in full and the weather, capped at 4 minutes. Opt-out toggle "Pełne wiadomości co godzinę".
- **No repeats** (`airedStore.ts`): stories aired today are stored in `dosradio.aired.v1`, reset at local
  midnight and merged with `GET|POST /radio-api/aired` for logged-in listeners (best effort, never blocks audio).
  `pickNextStory` no longer restarts the cycle; with nothing new the host chats instead of replaying.
- **Topic of the day**: star on a news chip in the onboarding; that topic leads the main stories.
- **FOMO line** under the player: "Za 3:12: <headline of what comes next>", updated every second.
- **Weather** in the hourly bulletin by city name or browser geolocation ("Użyj mojej lokalizacji").
- **Live Lyria reload** during every news break when live generation is in use; music returns fresh after the voice.
- Every new server call (`headline.wav`, `teaser.wav`, `weather.wav`, `intro.wav?kind=`, `/aired`) is fail-soft:
  a missing endpoint falls back to the old behaviour.

### Changed
- Default break interval is now 5 minutes (stored choices are kept).
- Live Lyria wiring moved from `publicRadioEngine.ts` to `liveLyria.ts`; break playback to `breakRunner.ts`.

## [1.3.0] - 2026-11-06

### Added
- **Host clips**: `GET /radio-api/host-clips/{station_id}` lists each host's 4 jingles and
  8 chatter remarks as wav URLs; `GET|HEAD /radio-api/host-clip/{station_id}/{kind}/{index}.wav`
  voices a clip on first request and caches it under `data/audio/static/`. Unknown station,
  kind or index returns 404.
- **Welcome Plus**: a verified free account gets 30 days of Plus; paid or unlimited plans
  are never shortened. Existing verified free accounts received the same 30 days at release.
- **Onboarding on first play**: modal with the motto, "Z prowadzącym / Sama muzyka" cards,
  news-area chips (incl. "Bez wiadomości") and a news frequency picker. Stored in
  `dosradio.onboarded` + prefs; re-openable via "Zmień, co chcesz słyszeć".
- **Random host clips**: between songs (with host on) the engine plays a random jingle or
  chatter from `GET /radio-api/host-clips/{station}` every 6-12 minutes, ducked like news;
  silently skipped when the endpoint is missing.

### Changed
- Anonymous trial lasts one hour (`DOSRADIO_TRIAL_SECONDS` default 3600, was 600).
- **News frequency**: every 5, 10, 15, 20, 30 or 60 minutes (old stored values stay valid).
- First news break fires 5 minutes after play is pressed; later breaks follow the chosen
  interval counted from the previous break (no longer the wall-clock grid).
- Trial copy and countdown moved from 10 minutes to one hour; register CTA offers
  "30 dni Plus za darmo".

## [1.2.0] - 2026-11-05

### Added
- **Duet podcasts (DOS Radio Plus)**: `POST /radio-api/plus/podcast {topic?}` generates a
  NotebookLM-style two-host Polish conversation (Ania i Michał) via `gemini-3.8-flash`,
  voices each turn with two distinct Gemini TTS voices and interleaves 2-3 minute music
  breaks copied from the station archive. One episode per topic per day is cached under
  `data/podcasts/` (max 30 kept); parts are served Plus-gated from
  `/radio-api/plus/podcast/{id}/{part}`.
- **Personalized news sources (Plus)**: `PUT/GET /radio-api/plus/news-preferences` stores
  per-user keywords (max 20) and RSS feeds (max 10, http/https only) with Polish
  validation messages; `GET /radio-api/plus/news-digest` builds a per-user digest
  (5 s timeout per feed, per-feed isolation, keyword filtering, RSS 2.0 + Atom) that
  falls back to the global edition. The hourly news loop refreshes every stored
  preference row without ever blocking the global cycle; digest stories are voiced
  on demand through the shared `/radio-api/story/{id}.wav` pipeline.
- All `/radio-api/plus/*` routes require a registered listener with an active Plus
  subscription (HTTP 402 otherwise).
- **DOS Radio Plus billing (Stripe Checkout, test mode)**: new `app/billing.py` router
  mounted through the existing guarded hook in `main.py` — no changes to shared modules.
  - `POST /radio-api/billing/checkout` (registered users) opens a Stripe Checkout session
    for Plus (39 PLN/mo) or Plus+AI (59 PLN/mo); optional `b2b: true` switches the
    subscription to invoice billing (`send_invoice`, 14 days due).
  - `POST /radio-api/billing/webhook` verifies the Stripe signature and grants Plus
    idempotently (`plan='plus'`, `plus_until=now+30d`) on `checkout.session.completed`.
  - `GET /radio-api/billing/status` returns the caller's plan state and the plan catalogue.
  - Missing `STRIPE_SECRET_KEY` makes checkout return a clear 503 JSON; the rest of the
    app is unaffected. Env documented in `server/.env.example` (`STRIPE_SECRET_KEY`,
    `STRIPE_WEBHOOK_SECRET`, `DOSRADIO_PLUS_PRICE_PLN` as optional Price ID override).
  - `stripe>=8` added to `server/requirements.txt`; 12 offline tests in
    `server/tests/test_billing.py` (faked SDK, locally computed webhook signatures).
- **Frontend**:
  - "Twoje źródła" panel (keywords + RSS feeds, live digest list with links and
    a "Posłuchaj swoich wiadomości" player) and a "Wygeneruj podcast" button, visible for
    Plus users only, playing episodes through the shared Web Audio graph.
  - `src/ui/billing.ts` replaces the stub — floating "Plus" badge opens a
    minimal Linear-style plan modal with live status, and handles the Stripe
    `?billing=success|cancel` redirect back. Polish copy, SVG icons only, self-contained styles.
- **Tests**: full test coverage for gating, podcasts, personal news and Stripe billing
  (all tests run offline without network access).

## [1.1.1] - 2026-11-05

### Fixed
- **Frontend Crash**: Fixed `TypeError: Cannot read properties of null (reading 'toLocaleTimeString')` when scheduled break is reset (`at === null`).
- **News On-Demand**: Enabled clicking "Wiadomości teraz" (#newsNow) standalone, with safe audio playback even if an intro clip fails.
- **Audio Routing Conflict**: Replaced greedy `/{kind}/{station_id}.wav` path pattern with explicit `/radio-api/welcome/` and `/radio-api/jingle/` routes so `/radio-api/story/{story_id}.wav` is never shadowed.
- **Lyria WebSocket & Mood Composer**: Added `next_key()` delegation to `Settings` and accepted both `mood` and `description` payloads in `/radio-api/mood`.
- **Host & On-Air State**: Synchronized `onHostState` events with `#onAirLabel` DOM updates for live speaking indicators.
- **Access Whitelist**: Whitelisted local loopback and Tailscale (`100.`) subnets from the 10-minute trial expiration.
- **Unit Tests**: Added Vitest test suite (`tests/radio.test.ts`, 8 tests) covering station metadata, news interleaving, and schedule clock math.

## [1.1.0] - 2026-11-05

### Added
- **Mandatory e-mail confirmation after signup**: new accounts stay inactive until the
  user clicks a verification link sent by e-mail (valid 24 h, token stored as SHA-256 hash).
- `POST /radio-api/verify` (confirm token, opens session) and
  `POST /radio-api/resend-verification` (password-checked re-send of the link).
- SMTP verification mailer (`app/mailer.py`, STARTTLS, configured via `DOSRADIO_SMTP_*` env).
- Frontend: "check your inbox" state after signup, resend link on blocked login,
  and automatic handling of `/?verify=<token>` landing links.

### Changed
- `POST /radio-api/register` no longer opens a session immediately (returns
  `pending_verification: true`); login returns 403 until the e-mail is confirmed.

### Security
- Verification tokens are stored hashed; resend requires valid account password;
  resend for unknown addresses does not leak account existence.

## [1.0.0] - 2026-11-05

### Added
- **Full Autonomous AI Radio Station** hosted publicly at `https://dosradio.theones.io`.
- **14 Music Stations with Dedicated Hosts**:
  - *DOS Groove* (Kuba) — 122 BPM minimal deep tech
  - *Lo-fi Nauka* (Ola) — 82 BPM lo-fi beats
  - *Microhouse* (Rafał) — 124 BPM Romanian minimal
  - *Głęboki Ambient* (Ida) — 60 BPM ambient drone
  - *Stoa* (Marek) — 66 BPM neoclassical cello and piano
  - *Poranna Kawa* (Zosia) — 120 BPM deep house
  - *Liquid DnB* (Lena) — 174 BPM liquid drum and bass
  - *Neo Funk* (Tadek) — 112 BPM funk groove
  - *Klubowy Dance* (Max) — 128 BPM tech-house
  - *Minimal Techno* (Igor) — 126 BPM hypnotic techno
  - *Mocne Techno* (Wiktor) — 134 BPM industrial warehouse
  - *Nocny Jazz* (Helena) — 86 BPM jazz lounge
  - *Trip-hop Wieczór* (Marta) — 92 BPM downtempo
  - *Nocny Dub* (Szymon) — 84 BPM ambient dub
- **AI Mood Composer** (`/radio-api/mood`): natural Polish text description translated by Gemini 3.8 Flash into tailored Lyria prompt parameters and BPM in real time.
- **Tylko muzyka (No-Host Mode)**: one-click toggle to suppress voice breaks and time checks for pure focus.
- **PWA Mobile App**:
  - Full offline shell caching with Service Worker (`/sw.js`).
  - MediaSession API integration with lock-screen / Dynamic Island Play/Pause controls and album artwork.
  - Background audio keep-alive via silent loop audio element to prevent mobile OS suspension.
- **Zero Dead Air Watchdog**:
  - Automatically handles Google's hard 10-minute session disconnection limit.
  - Senses audio drops (>2.5s silence), plays a soothing station jingle, and reconnects/falls back to archive with zero user clicks.
- **100-Hour FIFO Archive Recorder**:
  - Background worker records Lyria RealTime into 30-second Opus segments (96 kbps).
  - Rotates oldest files past 100h per station (12,000 segments = ~4.3 GB).
  - Serves 70% archive / 30% live mix via `/radio-api/station/{id}/next-chunk` for unlimited scaling.
- **Hourly Grounded News Editions**:
  - 5 categories: AI, Beauty i moda, Sport, Głupie, Stoicka myśl.
  - Fetched and voiced once per hour, cached on disk, replayed for all listeners.
- **Telegram Registration Notifier**: alerts operator on each new listener with CPU and RAM telemetrics.
- **Multi-Account Gemini Key Pool**: supports `GEMINI_API_KEYS` comma-separated list for linear quota scaling.
