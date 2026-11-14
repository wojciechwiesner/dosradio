# DOS Radio — Ramówka Wave (2026-11-07, target v1.5.0)

Goal: an engaging, never-repeating programme. Short frequent news, one main topic,
hourly full bulletin with weather, FOMO teasers, podcast bumpers, YouTube "pigułka".

## Requirements (Wojciech, intent)
R1. Never replay a story the listener already heard today (survives reload; synced for logged-in users).
R2. Shorter news. Two break formats, alternating every N minutes (default 5):
    FLASH = 2-3 one-sentence headlines + one teaser ("zapowiedź") of what comes next.
    MAIN  = one main story from the listener's topic of the day, told in 45-70 words + teaser.
R3. Hourly extended bulletin (first break after HH:00): every current headline + full text
    of the top 2 unaired stories, hard cap ~4 min, opt-out toggle.
R4. Weather, very short, by listener's city, once per hour inside the hourly bulletin
    ("We Wrocławiu teraz 8 stopni, pochmurno. Wieczorem do 5."). Opt-in via city/geolocation.
R5. FOMO: topic of the day picked by the user; UI shows "Za 3:12: <next title>"; teasers
    always point to a real upcoming unaired story; nothing repeats within a day.
R6. Reload Lyria live session during every news break (only when live Lyria is in use).
R7. Podcasts: radio bumpers — intro sting (music bed + host voice), between sections
    "Gramy dalej, przerwa muzyczna, lecimy", "Wracamy do rozmowy", outro; no hard cuts
    (fade music in/out).
R8. YouTube pigułka (Plus): user gives a video or channel URL; we take the transcript,
    pick the most important ~20% as ordered segments, cut those exact audio fragments and
    play them as short blocks, each introduced by a one-sentence host summary.

## Shared API contract (W1 implements server side, W2/W3 consume; nobody else edits)
- Story JSON (GET /radio-api/news) gains `headline` (one sentence, <= 18 words).
  `radio_text` is now 45-70 words.
- GET|HEAD /radio-api/story/{id}/headline.wav — headline voiced (cached).
- GET /radio-api/intro.wav?time=HH:MM&station=SID&kind=flash|main|hourly (kind optional,
  default = old behaviour). flash: "Krótko, co słychać." main: "Temat na teraz." hourly:
  "Jest {time}. Pełne wiadomości DOS Radio." — all with time announcement.
- GET|HEAD /radio-api/teaser.wav?story=ID&station=SID — host voice: "Za chwilę: {headline}. Zostań z nami."
  (2-3 phrasings, deterministic by story id). 404 for unknown story.
- GET|HEAD /radio-api/outro.wav?station=SID&variant=0..3 — "Gramy dalej." family.
- GET /radio-api/weather?lat=&lon=&city= -> {"city","temp_c","summary","text"}; 
  GET|HEAD /radio-api/weather.wav?lat=&lon=&city=&station=SID -> voiced `text`.
  Open-Meteo (no key) for forecast + geocoding; reverse geocoding via Nominatim with a
  proper User-Agent; cache weather 30 min per rounded coords; audio cached per city+hour+station.
- GET /radio-api/aired?day=YYYY-MM-DD -> {"day","ids":[...]} (registered only, else 401);
  POST /radio-api/aired {"day","ids":[...]} -> union-merge, returns merged set. Max 500 ids/day.

## Zones (strict file ownership)

### W1 — Haiku — news backend (worktree ../dosradio-wt-ramowka-api, branch wt/ramowka-api)
OWNS: server/app/news.py, server/app/weather.py (new), server/app/aired.py (new router),
server/app/db.py, server/app/config.py, server/app/main.py, server/tests/test_news_format.py,
server/tests/test_weather.py, server/tests/test_aired.py, server/.env.example.
- Implement the whole shared contract above. news prompt: 6 stories, each with headline
  (<= 18 words) and radio_text (45-70 words, concrete, no filler). Keep story ids stable.
- db.py: table aired_items(user_id, day TEXT, item_id TEXT, PRIMARY KEY(user_id,day,item_id)).
- Tests offline (fake speak, fake HTTP for Open-Meteo/Nominatim).

### W2 — Sonnet — ramówka engine + UI (worktree ../dosradio-wt-ramowka-ui, branch wt/ramowka-ui)
OWNS: src/radio/publicRadioEngine.ts, src/radio/radioClock.ts, src/radio/newsQueue.ts,
src/radio/radioApi.ts, src/radio/programme.ts (new), src/radio/airedStore.ts (new),
src/ui/dosradio.ts, src/ui/dosradio.css, src/ui/prefs.ts, src/ui/onboarding.ts, index.html,
tests/**.
- programme.ts: pure planner `planBreak(ctx) -> BreakPlan` deciding flash/main/hourly,
  which stories, teaser target, weather — fully unit-tested.
- airedStore.ts: localStorage `dosradio.aired.v1` {day, ids}, daily reset (local date),
  sync with GET/POST /radio-api/aired when registered (best effort, never blocks audio).
  pickNextStory must NEVER restart the cycle within a day; nothing new -> air time + a host
  chatter clip instead of a story.
- Prefs: dayTopic (one of chosen categories), hourlyBulletin (default true), weatherCity /
  coords (button "Użyj mojej lokalizacji" + city text field), interval default 5.
  Onboarding step 2 lets user mark the topic of the day (star on a chip).
- FOMO UI: "Za m:ss — <headline>" line under the player, updates every second.
- R6: during every break, if the live Lyria helper is active: stop it and start a fresh
  session while the voice plays; music fades back after the voice.
- Copy: warm Polish, "ty" form, no emoji, SVG icons only.

### W3 — Sonnet — podcast bumpers + YouTube pigułka (worktree ../dosradio-wt-pill, branch wt/pill)
OWNS: server/app/podcast.py, server/app/youtube_pill.py (new), server/app/plus_api.py,
server/tests/test_plus.py, server/tests/test_pill.py, src/ui/plus.ts, src/ui/pill.ts (new),
src/ui/pill.css (new, imported by pill.ts).
MUST NOT touch index.html / radioApi.ts / dosradio.css (render pill form from pill.ts inside
#plusPanel, own fetch helpers).
- R7: bumpers built server-side with ffmpeg: 6-9 s music bed from the station archive with
  fade in/out, host TTS laid over it (music ducked under voice). Kinds: intro (with episode
  title), break-out ("Gramy dalej. Przerwa muzyczna, lecimy."), break-in ("Wracamy do
  rozmowy."), outro ("To był podcast DOS Radio. Gramy dalej!"). Manifest parts get kind
  "bumper". Bump cache version so old episodes regenerate. Client player: 1.5 s fade on
  every music part edge, no gaps.
- R8: POST /radio-api/plus/pill {"url"} -> {"id","status"}; GET /radio-api/plus/pill/{id}
  -> {"status": queued|working|ready|error, "title","author","source_url","parts":[...], "error"}.
  Pipeline (background task, one at a time): yt-dlp metadata (channel URL -> latest
  upload, max duration 3 h) -> subtitles pl, else en (vtt auto-subs) -> Gemini
  gemini-3.8-flash picks ordered segments covering ~20% of duration, each 20-120 s, snapped
  to cue boundaries, each with a one-sentence Polish summary -> yt-dlp bestaudio -> ffmpeg
  cuts to opus -> parts: [bumper intro, (summary voice, clip) x N, outro]. No subtitles ->
  status error "Ten odcinek nie ma napisów, spróbuj innego." Cache per video id.
  Plus-gated (402). Show source link + author in UI. Every external process call has a
  timeout; subprocess runner injectable for tests (no network in tests).
- UI: "Pigułka z YouTube" field (link do odcinka lub kanału), button "Zrób pigułkę",
  progress status polling every 3 s, then plays through the existing podcast player.

## Gates (each worker, before writing the sentinel)
- Backend workers: `cd server && python3 -m pytest tests -q` exit 0.
- W2 (and W3 for TS): `npx tsc -p tsconfig.json --noEmit`, `npx vitest run`, `npm run build` exit 0.
- CHANGELOG.md under `## [Unreleased]`. Commit only own files with the trailer:
  `Developed by Wojciech Wiesner wojciech@theones.io -= join.theones.io =- be The One Who Is Many -`
- Last step: sentinel file with DONE <exit>, SHA, gate outputs.

## Orchestrator (Hermes)
Merge W1 -> W3 -> W2, full gates, reconcile with in-flight v1.4 branches
(news.py, publicRadioEngine.ts, main.py overlap), deploy, live proofs (curl + browser),
cost report.
