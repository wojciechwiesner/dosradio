# Changelog

All notable changes to DOS Radio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
