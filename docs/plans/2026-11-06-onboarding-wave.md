# DOS Radio — Onboarding Wave (2026-11-06, target v1.3.0)

Motto (product copy): "Najlepsze radio to takie, które gra i mówi to, co ty chcesz.
Więc co chcesz usłyszeć?"

## Requirements (from Wojciech, verbatim intent)
R1. Anonymous access without login for 1 hour (was 10 min).
R2. First news break only 5 minutes after the listener presses play (not on the clock grid).
R3. First play shows a friendly onboarding: "z prowadzącym czy bez?" + "wiadomości z jakich
    obszarów?" (multi-select chips). Warm, playful Polish copy, motto as headline.
R4. After the 1 h trial: every registered (e-mail verified) account gets 30 days of full Plus free.
R5. Listener can change how often news plays (every N minutes).
R6. More jingles and random host chatter ("losowe gadki prowadzącego") between songs.
R7. Cost per generation reported to Wojciech (orchestrator does this, not workers).

## Zones (strict file ownership)

### W1 — Sonnet — frontend (worktree ../dosradio-wt-onboard, branch wt/onboard)
OWNS: index.html, src/ui/dosradio.ts, src/ui/dosradio.css, src/ui/onboarding.ts (new),
src/radio/publicRadioEngine.ts, src/radio/radioClock.ts, src/radio/radioApi.ts, tests/ (vitest).
MUST NOT touch: server/**.

- R2: engine gets `firstBreakDelayMs` (default 5 min). After `start()` the first break fires
  at `startedAt + 5 min`; later breaks follow the chosen interval counted from the previous
  break (not the wall-clock grid). Keep the "news on demand" button working.
- R3: `src/ui/onboarding.ts` — modal shown on first play only (localStorage
  `dosradio.onboarded=1`). Headline: the motto. Step 1: host on/off (two big cards:
  "Z prowadzącym" / "Sama muzyka"). Step 2: news area chips (existing categories
  ai, beauty, sport, funny, stoic + "Bez wiadomości"). Step 3: how often (R5 values).
  CTA "Graj!". Writes the existing Prefs (hostMode, categories, interval) and starts playback.
  Copy: warm, short, "ty" form, no emoji, SVG icons only. Must be re-openable from the
  drawer ("Zmień, co chcesz słyszeć").
- R5: interval options 5, 10, 15, 20, 30, 60 minutes (BreakInterval type widened; prefs
  migration keeps old values valid).
- R1 copy: every "10 minut" text in UI becomes "godzinę"; trial countdown formats >= 60 min.
- R4 copy: register CTA says "Załóż konto i dostań 30 dni Plus za darmo".
- R6 playback: between music segments (only when hostMode != off) play a random clip from
  `GET /radio-api/host-clips/{station_id}` (contract below), at most one clip every
  6-12 minutes (random), never overlapping news/voice, ducking like existing jingle code.
  If the endpoint 404s or errors, silently keep old behaviour.

### W2 — Haiku — backend (worktree ../dosradio-wt-hostclips, branch wt/hostclips)
OWNS: server/app/config.py, server/app/auth.py, server/app/db.py, server/app/hosts.py,
server/app/host_clips.py (new), server/app/main.py (only: include host_clips router),
server/tests/**, server/.env.example.
MUST NOT touch: src/**, index.html, billing.py, plus_api.py, podcast.py.

- R1: `DOSRADIO_TRIAL_SECONDS` default 3600 (config.py). Update tests expecting 600.
- R4: on successful e-mail verification (`verify` in auth.py) call
  `db.grant_welcome_plus(user_id, days=30)`: sets plan='plus', plus_until=now+30d ONLY when
  the user is currently plan='free' (never shorten a paid/unlimited plan). Test it.
- R6: per host in hosts.py add `jingles: tuple[str, ...]` (4 short lines, station-flavoured,
  include "DOS Radio") and `chatter: tuple[str, ...]` (8 short 1-2 sentence warm random
  remarks: weather-free, time-free, evergreen, Polish, in the host's personality). Keep the
  existing `jingle`/`greeting` fields working.
- New `server/app/host_clips.py` router:
  - `GET /radio-api/host-clips/{station_id}` -> `{"jingles": [url...], "chatter": [url...]}`
    urls = `/radio-api/host-clip/{station_id}/{kind}/{index}.wav`
  - `GET|HEAD /radio-api/host-clip/{station_id}/{kind}/{index}.wav` -> lazily voiced with the
    existing `gemini.speak(text, host.voice, host.style)`, cached forever in
    static_audio_dir as `{kind}-{station_id}-{index}.wav` (atomic tmp+replace). 404 for unknown
    station/kind/index. Inject speak function + audio dir so tests use a fake (no network).
- Tests: pytest for trial default, welcome-plus grant (free -> plus, existing plus untouched),
  host-clips listing and 404s, clip caching with fake speaker.

## Shared contract (both read, nobody edits): API JSON above.

## Gates (each worker, before writing the sentinel)
- W1: `npx tsc -p tsconfig.json --noEmit` exit 0, `npm run build` exit 0, `npx vitest run` exit 0.
- W2: `cd server && python3 -m pytest tests -q` exit 0.
- CHANGELOG.md: add lines under `## [Unreleased]` (create the heading if missing).
- Commit only own files (`git add <paths>`), trailer:
  `Developed by Wojciech Wiesner wojciech@theones.io -= join.theones.io =- be The One Who Is Many -`
- Last step: write `DONE <exit>` + gate outputs to the sentinel path given in the prompt.

## Orchestrator (Hermes) after both sentinels
1. Review diffs vs zones, merge W2 then W1, resolve CHANGELOG, full gates on master.
2. Deploy, set prod `DOSRADIO_TRIAL_SECONDS=3600` if overridden in .env.
3. One-shot prod grant: every verified plan='free' account -> plus_until=now+30d (R4 "każdemu").
4. Live proofs: /me trial_remaining ~3600, /host-clips JSON, one clip wav 200, UI onboarding in DOM.
5. Cost report (R7).
