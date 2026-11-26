# Changelog

All notable changes to AmbiRadio (formerly DOS Radio) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Fixed
- Polish dedication greeting no longer says "pozdrowienia od Wojtek": the sender's name stays in the nominative.

### Changed
- **Launch polish before ads**: the share card (`/radio-api/og/card.png`, per-station and dedication cards) is
  rendered by the new `server/app/og_card.py` as AmbiRadio, with the tagline "Ambitnie dla Ciebie", the domain from
  `public_domain()`, short Polish copy and one CTA ("Posłuchaj na żywo"), still 1200x630. The old display name
  "DOS Groove" is now "Ambi Groove" in UI, stations, hosts, catalog and docs (the station id `dos-groove` and all URLs
  are unchanged). Orbita: the right panel no longer clips the "Graj" buttons at 1440x900, small orbit/moon/host labels
  sit on a readable backdrop, the intro overlay no longer clips at 390px and no longer repeats the tagline;
  reduced-motion is kept. Classic: the empty right panel shows now playing, host and next up, and the trial pill reads
  "Darmowy dostęp 6 h" with an explanation on hover. Tests: `server/tests/test_og_card.py`.
- **YouTube audio clipping is off** (`server/app/youtube_pill.py`, `pill_service.py`, `plus_api.py`,
  `custom_radios.py`): `POST /radio-api/plus/pill`, `POST /radio-api/plus/pills/batch`, the pill status, the saved-pill
  list and the cached media all answer 410 unless `DOSRADIO_YOUTUBE_CLIPS=1`, and `download_audio` refuses before
  yt-dlp is ever called. Cached pills stay on disk, they are only unreachable. A custom-radio pill pointing at YouTube
  is refused the same way; article links and notes, the text "pigułka wiedzy" drop and public RSS podcasts are
  untouched. The Classic pill form, the Orbita pill pane, the Plus plan lists (PL/EN/RU) and the host promo no longer
  offer or promise YouTube clips. Tests: `server/tests/test_youtube_disabled.py`.
- **Checkout sells only a verified Stripe price** (`server/app/billing.py`): a plan is buyable only when its
  `DOSRADIO_PLUS_PRICE_USD` / `DOSRADIO_PLUS_AI_PRICE_USD` price exists in Stripe and bills exactly the displayed
  amount, currency and monthly interval. Anything else returns 503 and charges nothing; the yearly price stays
  display-only. `/radio-api/billing/status` now says per plan whether checkout is actually available.
- **Release integration** (`ow/ambi-release-grok`): wave 1 (rebrand, USD pricing, Classic redesign, entry wizard and
  6 h trial), the beat-grid mixer fix, the Orbita SOTA scene, the presence/dedication fix and hosts-with-a-soul plus
  listener comments merged into one branch. Shared files keep every side's work: the Classic redesign owns layout, the
  rebrand owns brand strings and USD prices, the wizard owns the entry split and trial, and each later branch adds its
  own pieces (start notice, comment button and feed, calm view, persona field) without reverting the earlier ones.
- **Wave 1 integration** (`ow/ambi-integrate-w1`): rebrand + USD pricing, Classic redesign and entry split / start
  wizard / 6 h trial merged into one branch. The redesign owns layout and styles, the rebrand owns brand strings
  (ambiradio.com canonical/OG) and USD prices, the wizard owns the entry split, wizard and trial. Wizard and trial
  styles now use the Classic tokens (square edges, one lime accent instead of the old orange), the trial pill reads
  "Pełny dostęp 5 h 42 min" so the header stays on one row at 1440 px, the Plus modal sits above the mobile bottom
  nav, and the leftover "darmowa godzina" texts in Orbita (PL/EN/RU) and the 5-minute nudge now say "pełny dostęp".
  Screenshots: `docs/ambiradio/shots/integ-w1/`.
- **Rebrand to AmbiRadio — "AmbiRadio — Ambitnie dla Ciebie"**: every user-facing "DOS Radio" string is now
  "AmbiRadio" across `index.html` (title, description, canonical, OG/Twitter tags pointing at https://ambiradio.com),
  `public/manifest.webmanifest`, `public/admin.html`, `src/**`, Orbita (`orbita/src/*`, PL/EN/RU i18n, rebuilt
  `public/orbita.html`), and the backend (host jingles and TTS lines, podcasts, spots, Auto-Ramówka, dedications,
  e-mail, Telegram, share texts, OG share cards). The tagline shows in the header, footer, page title, OG site name,
  Orbita enter screen and the verification e-mail. Service worker cache bumped to `dosradio-shell-v5`.
  Kept on purpose for backwards compatibility: localStorage keys (`dosradio.*`), API paths, `x-dosradio-*` headers,
  postMessage types, env var names, logger names, file and DB names.
- **Public base URL is configurable** (`server/app/config.py`): `DOSRADIO_PUBLIC_BASE_URL` (default
  `https://ambiradio.com`; the older `DOSRADIO_PUBLIC_URL` still works) feeds share links, custom-radio links, the
  verification e-mail, Telegram alerts and bot user agents. OG share pages keep using the request's own host, so
  ambiradio.com and dosradio.theones.io both work. The OG brand domain defaults to ambiradio.com (was heloradio.com).
- **Pricing in USD** (`server/app/billing.py`): AmbiRadio Plus $2.99/month and AmbiRadio Plus AI $6.99/month
  (`currency: "usd"`, amounts in cents). Stripe price ids come from `DOSRADIO_PLUS_PRICE_USD` and
  `DOSRADIO_PLUS_AI_PRICE_USD`; `DOSRADIO_PLUS_PRICE_PLN` is no longer read, so a PLN price can't be charged while
  the UI shows dollars. `/radio-api/billing/status` now returns `currency`, `amount_cents` and `yearly_cents`
  instead of `amount_pln`. The billing modal (`src/ui/billing.ts`, new `src/ui/pricing.ts`) and the Orbita Plus pane
  show "$2.99 / mies." and "$6.99 / mies." plus "$29.90 / rok" and "$69.90 / rok" (yearly is display-only; there is
  no yearly checkout yet).
- **AmbiRadio Classic redesign** (`index.html`, `src/ui/dosradio.css`, `src/ui/pill.css`): raw, typographic
  look on obsidian with one signal-lime accent, Space Grotesk + JetBrains Mono, 8px grid, square edges.
  Big 88px Play next to the display-size station name; radio actions and share/Plus actions as consistent
  icon + label rows; stations as a group tab strip plus a dense ruled list with BPM; "Na antenie dziś" as a quiet
  timeline; programme settings moved into a "Twoja ramówka" section. Every control is at least 44px, has a
  visible focus ring, there is no layout shift while audio loads, it works at 360px, and motion stops under
  `prefers-reduced-motion`. Header wordmark "AmbiRadio — Ambitnie dla Ciebie"; title/meta/OG rebranded.
  Tokens and rationale: `docs/ambiradio/classic-design.md`, screenshots in `docs/ambiradio/shots/ambi-classic-redesign/`.
- The Plus badge (`src/ui/billing.ts`) now sits in the player's action row (`#plusSlot`) instead of floating.
  The Plus, dedication and share/studio modals use the same tokens.
### Fixed
- **A slow listener killed the live stream for everyone** (`server/app/stream.py`): when a listener's queue
  overflowed, `_offer` pushed the end marker into the same full queue, raised `QueueFull` again inside
  `_publish` and ended the station encoder. The overflowing queue is now emptied before the end marker, so
  only that listener is dropped. Seen on production 5 times on 2026-11-26. Test: `test_stream_slow_listener.py`.
- **Home page and link previews showed the domain instead of the brand** (`server/app/og_preview.py`): the
  plain home page title is now `AmbiRadio — Ambitnie dla Ciebie`, shared items read "... audycja w radiu
  AmbiRadio", and `canonical` follows `DOSRADIO_PUBLIC_BASE_URL` instead of pointing at the not yet
  registered `ambiradio.com`. Test: `test_og_home_brand.py`.
- **"Who is online" stats were wrong** (`server/app/auto_ramowka.py`, `src/ui/dosradio.ts`, `orbita/src/main.js`):
  both AmbiRadio frontends sent `station`/`view`/`auto_ramowka`, the backend read `station_id`/`view_mode`/`ramowka`
  and silently dropped the rest, so every listener showed as `dos-groove` / `classic`, and listeners behind one NAT
  collapsed into one IP row. `POST /radio-api/presence` now maps the old names (old tabs keep working), then rejects
  unknown fields (`extra="forbid"`); `client_id` (shared `dosradio.client_id.v1` key, now also sent by Orbita) is the
  actor before cookies and IP. Session cookies are hashed before they reach the admin-visible table, and the
  listener's email/user id come from the session, not from the page. Heartbeats pause while the tab is hidden and
  send one beat when it becomes visible, and the first beat goes out when playback starts.
  Tests: `server/tests/test_presence_shapes.py`.
- **Shared dedication did not play for recipients whose free hour was over** (`src/ui/playbackGate.ts`,
  `src/ui/dosradio.ts`, `server/app/auth.py`, `server/app/dedications.py`, `server/app/main.py`): Classic opened the
  register modal before the pending greeting could play, and the music stream answered 402. Classic now plays the
  greeting and the music under it, then shows the soft register prompt 60 s after the greeting ends.
  `GET /radio-api/dedications/{token}` sets a signed `dr_ded` pass cookie (10 min from the first open of that link
  from that address, never extended) that `require_access` accepts. Tests: `tests/playbackGate.test.ts`,
  `server/tests/test_dedication_pass.py`; checked end to end in Chromium (greeting AudioBuffer starts, AudioContext
  time advances, no auth modal).

### Changed
- **Play starts at once** (Classic and Orbita): the first Play no longer waits for the onboarding wizard. The
  wizard opens next to the playing radio with default settings, and its answers apply live. A calm line under
  the player says "Muzyka ruszy za kilka sekund — generuję pierwsze nuty. Prowadzący może już mówić." (Orbita:
  PL/EN/RU) until the music bed is actually playing (`onMusicAudible` engine event). Both pages resume the
  AudioContext synchronously in the click, before any network await, for iOS.
- `@types/node` added to devDependencies: `tsconfig.json` references it, and `npm run build` failed on a clean install.

### Added
- **Hosts with a soul + listener comments on air (AmbiRadio)** (`server/app/host_personas.py`, `hosts.py`,
  `comments.py`, `moderation.py`, `og_preview.py`, `main.py`, `src/ui/commentBox.ts`, `src/radio/hostClipPlayer.ts`,
  `orbita/src/comments.js`, `orbita/src/engine.js`, `index.html`): every host has a Polish persona (backstory,
  worldview, humour, catchphrases, pet topics, musical loves/hates, how they address listeners, a day thread) and a
  server-side day memory (last 10 notable things said/heard). Live links between songs are written by the LLM from
  persona + memory + time of day + the news topic in the programme, once per station per 20 min slot; static chatter
  is the offline fallback. `POST /radio-api/comments` (max 280 chars, nick optional, per-actor and per-IP rate limit)
  moderates and scores comments (heuristic + optional cached LLM score); the best fresh comment is read in the next
  break with the nick ("Ania z Krakowa pisze: ...") and answered in the host's voice. Cost guard: max
  `AMBI_COMMENTS_PER_HOUR` (4) readouts per station per hour, `AMBI_HOST_LLM_PER_HOUR` (120) LLM calls, one voiced
  file per break shared by every listener. The sender sees "Twój komentarz poszedł na antenę" with the clip and a
  share link (`?k=`, OpenGraph card). Classic: "Komentarz na antenę" button + live feed with "na antenie" badge;
  Orbita: comment icon in the station card + feed. Docs: `docs/ambiradio/hosts-and-comments.md`.
  Tests: `server/tests/test_comments.py`, `server/tests/test_moderation.py`, `tests/hostBreak.test.ts`.
- **Shared moderation** (`server/app/moderation.py`): Polish + English abuse list (catches `k u r w a`, `ku.rwa`,
  leetspeak, repeated letters), link/e-mail/phone/handle stripping, length cap, optional cached LLM second opinion.
  Used by comments, dedications and custom radio names; rejections return a friendly Polish message.

### Changed
- Host jingles, dedication greetings and borrowed-host greetings say "AmbiRadio" instead of "DOS Radio". Host clip,
  greeting and jingle cache files now carry a hash of the line, so edited lines are voiced again.
- **Orbita SOTA upgrade** (`orbita/src/scene.js`, `reactive.js`, `main.js`, `index.frag.html`): the scene reacts to
  the real Web Audio analyser through a bass/mid/high band follower (auto-gain, attack/release, slew cap so nothing
  flashes); adaptive quality tiers with device pixel ratio capped at 2 and a frame-time governor (drops bloom, streaks,
  fluid rate and backdrop blur on slow GPUs); the render loop stops while the tab is hidden; per-category colour grade
  in the final pass; slower, speed-capped camera and much lighter chromatic aberration. Calm view (`prefers-reduced-motion`
  or key M, stored in `dosradio.orbita.calm.v1`): still camera, no streaks, pulses or fluid, 30 fps. Readable captions
  (proportional face, solid backdrop, max 3 lines), a now-playing line, and the Classic core actions in the card:
  play, station, share with dedication (S), comment (C), Plus (+). Merged on top of the rebrand: the tagline
  "Ambitnie dla Ciebie" (PL/EN/RU) and the calm-view strings join the 6 h "pełny dostęp" trial wording and the USD
  prices, and the "zmień wersję" link stays in the HUD. Perf script `scripts/orbita-perf.mjs`; numbers in
  `docs/ambiradio/orbita-upgrade.md`. Tests: `tests/orbitaReactive.test.ts`, `tests/orbitaCalmScene.test.ts`.
- **Keyboard shortcuts in Classic** (`src/ui/keyboard.ts`): `Space` play/pause, `←`/`→` previous/next station;
  ignored in form fields, open dialogs and Orbita. Tests: `tests/classicKeyboard.test.ts`.
- **AmbiRadio entry split** (`src/ui/entrySplit.ts`, `entrySplit.css`): on the first visit the root page shows a
  full-viewport choice, Classic (raw, functional) on the left and Orbita (immersive) on the right, each with a static
  poster and a one-line description. Hover (or a first tap on touch screens) expands a half, a click chooses. The
  choice lives in `localStorage` `dosradio.ui.version`; Orbita navigates to `/orbita.html` (also on later visits),
  Classic stays. Verification, billing and `?view=` links always land in Classic. Mobile stacks the halves.
  Both versions have a small "zmień wersję" link (`/?wersja=wybierz`).
- **Start wizard** (`src/ui/onboarding.ts`, `src/ui/wizardContent.ts`) replaces the one-screen onboarding: three
  skippable steps, (1) news topics as chips and how often, (2) podcasts: paste a link (turned into a podcast through
  `POST /radio-api/plus/podcast`, new `source_url` in `radioApi.podcast`) or pick real Polish podcasts in Tech/AI,
  Biznes, Sport, Kultura and Nauka (10 public RSS feeds, each checked with curl: HTTP 200, valid RSS, `language pl`),
  whose feeds join "Moje źródła" through the news-preferences API, (3) a host personality (Kuba, Zosia, Marek or
  music only), which tunes to that host's station. Plus setup is parked until the trial turns Plus on.
- **6 h trial = full Plus** (`server/app/auth.py`, `db.py`, `plus_api.py`, `main.py`, `spots.py`):
  `DOSRADIO_TRIAL_SECONDS` defaults to 21600. While the trial runs `/radio-api/me` reports `plus: true` and the new
  `trial_plus: true`; every `/radio-api/plus` route, "Moje źródła" and spot-free listening work for the anonymous
  listener. Their data is stored under a negative owner id (`trial_owners` table) and moves to the account on
  `/radio-api/register`. Free-Plus limits (1 podcast per day) still apply. Tests: `server/tests/test_trial_plus.py`,
  `tests/entryWizard.test.ts`.
- **Calm trial indicator and soft register prompt** (`src/ui/trialNotice.ts`): the Classic pill shows hours and
  minutes ("Pełny dostęp jeszcze 5 h 42 min", no ticking seconds); 30 minutes before the end a one-time,
  non-blocking card offers the existing registration. Orbita shows the same 6 h clock and a 30-minute toast.
- **HeyGen Voice Turbo (OpenRouter) as the second TTS provider** (`server/app/tts_openrouter.py`,
  `gemini_client.py`): speech chain is now Gemini -> OpenRouter `heygen/heygen-voice-1-turbo:free` -> Grok.
  Same-gender voice table (`Kore` -> `nadine`, `Charon` -> `bram`, never `meredith`), PCM 44100 Hz wrapped
  to WAV, text over 4800 chars split at sentence boundaries. Own breaker key, so a 429/404/retired model
  cools down and falls through to Grok. Config: `DOSRADIO_OPENROUTER_TTS_KEY` (or `OPENROUTER_API_KEY`),
  `DOSRADIO_OPENROUTER_TTS_MODEL` (the `:free` id retires 2026-11-30; paid id `heygen/heygen-voice-1-turbo`),
  `DOSRADIO_OPENROUTER_TTS_URL`. Startup logs the TTS chain. Tests: `server/tests/test_tts_openrouter.py`;
  proof script `server/scripts/heygen_tts_proof.py`.
- **Device keys for shared devices** (`server/app/auth.py`, `config.py`, `main.py`): `DOSRADIO_DEVICE_KEYS=name:key`
  (key >= 32 chars) grants a device such as the LUNA salon reception kiosk permanent access, sent as the
  `x-dosradio-device` header or `?device=` query (for `<audio>`). Keyed GETs also get `Access-Control-Allow-Origin: *`
  so a `file://` kiosk can read news JSON. Tests: `server/tests/test_device_keys.py`.

### Fixed
- Mobile header (`src/ui/dosradio.css`): the top action buttons wrap instead of pushing the page 140 px wider
  than a 390 px screen; the tagline now shows on mobile too. The Orbita plan card keeps "/ mies." on one line.
- The Plus badge had no styles until the Plus modal was first opened.
- The classic mobile bottom nav's "Orbita" and "Stacje" buttons targeted ids that do not exist
  (`orbitaViewBtn`, `stationGrid`) and did nothing.
- The dedication modal now closes on Escape and is announced as a dialog.
- The Classic trial pill was always visible: `.pill { display: inline-flex }` overrode its `hidden` attribute, and on
  phones the header row then pushed the page to ~570 px wide. The header now wraps on narrow screens and modals sit
  above the Classic mobile nav.
- **Dropped/doubled kick at AmbiRadio DJ joins** (`server/app/mixer.py`): the grid-locked bass swap fired at
  each deck's idealised fitted-grid time, up to ~30 ms off the real kick in opposite directions, so the
  anti-flam ramp smeared both kicks and the join read as a 2-beat gap (0.968 s at 126 bpm). Kicks are now
  paired by grid ordinal on each deck and the swap lands on the measured kick at that ordinal (head matched
  in the untrimmed frame). 5-segment chain: kick interval max 0.968 -> 0.505 s, stddev 35.8 -> 12.1 ms.
  Restores `tests/test_stream_chain.py`; regression test in `tests/test_mixer.py`.
- **DJ transitions drifted off the beat** (`server/app/beat_grid.py`, `server/app/mixer.py`): the tempo lock
  took its stretch ratio from ONE detected kick pair and paired kicks by their order, so one missed or
  mistimed kick (common on rumble techno) skewed half the blend by tens of ms, sometimes half a beat. Each
  deck's tempo and beat phase are now measured on the overlap audio itself (low-band onset envelope folded
  over the beat, +-1.5 % tempo search), with a robust least-squares kick-grid fit as fallback; the head is
  trimmed so its beats land on the tail's beats. Tempo changes up to 2 % use turntable-style varispeed
  instead of WSOLA. Measured on production archive recordings (median kick offset during the blend):
  berlin-bcco-techno 56 -> 7 ms, deep-tech 14 -> 2 ms, hypnotic-techno 48.5 -> 5.5 ms.

### Added
- **Daily podcast limit for free Plus** (`server/app/podcast_quota.py`): the free 30-day welcome Plus (and
  anonymous website-link visitors) may start ONE new podcast per calendar day in `Europe/Warsaw`, counted per
  account across both `POST /radio-api/plus/podcast` and `POST /radio-api/social/url-podcast-link`. Paid Plus
  (new nullable `users.plus_paid_until`, set only by the Stripe webhook) is unlimited. Replaying an existing
  episode and failed generations do not use up the day. Over the limit: HTTP 429
  `{"detail": "Darmowy Plus: 1 podcast dziennie. Kolejny jutro albo wykup Plus.", "reset_at": <next Warsaw midnight>}`,
  checked before any LLM/TTS call. The Plus panel status area, Orbita and the classic link studio show the message.
- **"Moje podcasty" list in the Plus panel** (`GET /radio-api/plus/podcasts`, `server/app/podcast_list.py`,
  `src/ui/podcastList.ts`): podcasts a Plus listener generated (now recorded in the new `user_podcasts`
  table) merged with podcasts made from website links (Orbita drops), newest first, with title, Polish
  date, summary, a play button sharing `playManifest` with the generator, and the share link for link
  podcasts. Link podcasts still generating or failed show their status instead of a play button.
- **LLM and TTS fallback when Gemini fails** (`server/app/gemini_client.py`, `llm_fallback.py`, `llm_breaker.py`):
  text goes Gemini direct -> `DOSRADIO_LLM_FALLBACK_MODELS` on an OpenAI-compatible endpoint
  (`DOSRADIO_LLM_FALLBACK_URL`, default `https://llm.borg.tools/v1`, token `DOSRADIO_LLM_FALLBACK_TOKEN`).
  Podcasts, YouTube pills, spots, voice greetings, ramówka spots, Orbita voice and the mood station
  (no longer calling `gemini._call` directly) all use the chain. Every served call logs provider and model;
  `on_usage` telemetry records the real fallback model.
- **Circuit breaker**: after a 429 the Gemini model is skipped for `retryDelay`/`Retry-After` (else 10 min,
  doubling on consecutive quota failures, max 1 h); after a 401 or invalid key the whole Gemini key is skipped
  for 30 min. Stops the ~180 failing calls per hour seen in production.
- **Sourced news fallback** (`server/app/news_fallback.py`): when grounded Gemini search fails, each category is
  rebuilt from fresh real RSS items (The Verge, TechCrunch, Antyweb, Elle.pl, Vogue, Polsat Sport,
  SportoweFakty, BBC Sport, Daily Stoic, Oddity Central, Sky News Strange) rewritten by the fallback LLM.
  Every story keeps the link of the item it cites; a category without a fresh described item fails loudly.
- **Grok TTS fallback** (`server/app/tts_fallback.py`): Gemini TTS -> `grok-tts`, one table mapping every
  Gemini voice to a same-gender Grok voice (gender measured by pitch), MP3 decoded to 24 kHz mono WAV before
  `normalize_loudness`. Gemini `style` is never sent or read aloud.

### Security
- Require a verified email for admin password login and issue only the session cookie, not the shared admin token.
- **Admin token no longer exposes secret material** (`server/app/admin_api.py`): without a dedicated
  `DOSRADIO_ADMIN_TOKEN`, the token returned by `POST /radio-api/admin/login` was the first 32 characters of
  `DOSRADIO_SECRET`. The fallback is now an HMAC-SHA256 derivation of the app secret, so the session-signing
  secret never leaves the server; a dedicated `DOSRADIO_ADMIN_TOKEN` still wins when set. Covered by
  `server/tests/test_admin_token.py`. `server/tests/test_main_integration.py` now pins its own admin token, so
  it no longer depends on which test module set `DOSRADIO_SECRET` first.

### Changed
- **Factual website podcasts** (`server/app/url_podcast_prompt.py`): the prompt for podcasts made from a business
  page now tells the hosts to present the services and client benefits using only facts from the page, with no
  medical comparisons, health promises, or claims about availability, prices or results the page does not state;
  reviews only as quoted on the page. Page excerpt raised from 2000 to 6000 characters.
- `GeminiClient` moved from `server/app/news.py` to `server/app/gemini_client.py` (news.py 427 -> 354 lines).
- **Safer deploy** (`deploy.sh`): refuses to ship uncommitted deploy inputs (`ALLOW_DIRTY=1` overrides), builds
  with `npm run build` (Orbita bundle, type check, Vite) and checks `orbita.html` and `admin.html` in `dist/`,
  keeps `feeds/` and `share-*` in the web root during `--delete`, no longer uploads `.venv312` or
  `.pytest_cache`, backs up `.env`, the SQLite database (online backup API) and the nginx vhost before
  uploading, and fails when the health check does not answer within 30 s.

### Added
- **Dynamic OpenGraph Social Miniatures (`1200x630` PNG) & SSR Meta Tags for Shared Links** (`server/app/og_preview.py`, `server/app/main.py`, `server/requirements.txt`, `index.html`, `orbita/src/inviteScreen.js`): added dynamic `1200x630` Pillow PNG miniature renderer (`/radio-api/og/card.png`) and SSR OpenGraph/Twitter HTML injector (`/radio-api/og/share-html` + Nginx root query-param rewrite) so shared links (`?p=`, `?w=`, `?r=`, `?d=`, `?station=`) display a custom broadcast thumbnail card and `<meta property="og:title">` containing the exact audition title + `audycja w radiu heloradio.com`, story summary, and station music.
- **Clean Vinyl Scrub Detent, Global `isPodcastPlaying` Exclusivity Lock, 5-Act Segmented Podcast Show, Guest/Free DOS Radio Spots & Dedicated-Link Invitation Screen** (`orbita/src/audio.js`, `orbita/src/engine.js`, `orbita/src/inviteScreen.js`, `orbita/src/social.js`, `orbita/src/shareSheet.js`, `orbita/src/main.js`, `src/radio/publicRadioEngine.ts`, `src/ui/dosradio.ts`, `src/ui/plus.ts`, `server/app/spots.py`, `server/app/podcast.py`, `server/app/social_api.py`, `server/tests/test_social_custom_urlpodcast.py`): eliminated harsh `2600 Hz` square-wave dial ticks and white-noise static hiss in favor of a subtle `<=145 Hz` lowpass vinyl micro-detent (`140 ms` rate-limited); added `isPodcastPlaying()` + `voiceEpoch` mutual exclusion across Orbita and Classic so host intros, news breaks, jingles, and friend drops never overlap an active podcast; structured generated and played podcasts into distinct chapters (`Wejście -> Część 1 -> Przerwa muzyczna -> Ciekawostka/Spot DOS Radio -> Część 2 -> Przerwa muzyczna -> Finał i Wyjście`) with live HUD controls; added 8 voiced DOS Radio ciekawostki & promotional spots (`/radio-api/social/spot`, played automatically for unregistered guests and non-Plus accounts, skipped for Plus); and added an editorial full-screen Invitation Card + sender preview (`Zapraszamy do wysłuchania audycji w radiu pt. „...” która opowiada o ... przy muzyce ...`) on dedicated links (`?p=`, `?w=`, `?r=`).
- **Mobile Bottom Navigation (`Antena / Radio / Moje / Podcast / Znajomi`), True 1/4-Circle 2.5D 3-Orbit Thumb-Turntable, App-Badge Share Sheet & Full PWA Installability** (`orbita/src/thumbDial.js`, `orbita/src/shareSheet.js`, `orbita/src/social.js`, `orbita/src/index.frag.html`, `src/ui/socialCreatorStudio.ts`, `index.html`, `public/manifest.webmanifest`, `public/sw.js`): added native-style 5-tab mobile bottom navigation bar with safe-area support, dedicated 1/4-circle (`95°`) 3-orbit 2.5D corner thumb-turntable (`I · Chill`, `II · Groove`, `III · Rave` with tactile scrub ticks, auto-tune needle, clamped AABB non-clipping station pills, and `Prawy / Lewy kciuk` + desktop `1/4 2.5D` toggle), simplified `"Udostępnij przez..."` sheet with 6 branded SVG app badges (`Więcej apek` Web Share, `WhatsApp`, `Telegram`, `SMS`, `E-mail`, `Kopiuj link`) + optional inline voice greeting, and compliant PWA installability (`purpose: any` + `maskable` icons, `beforeinstallprompt` capture across top/iframe windows, `Zainstaluj` button + iOS/Android install guide, and `application/manifest+json` Nginx MIME).
- **3-Ring 2.5D Hybrid Astrolabe + Mobile Corner Thumb-Turntable + Social Airwave Graph, Creator Radios & Website-to-Podcast Outreach** (`orbita/src/data.js`, `orbita/src/scene.js`, `orbita/src/main.js`, `orbita/src/social.js`, `src/ui/socialCreatorStudio.ts`, `src/ui/dosradio.ts`, `server/app/url_extractor.py`, `server/app/custom_radios.py`, `server/app/social.py`, `server/app/social_api.py`, `server/app/plus_api.py`, `server/tests/test_social_custom_urlpodcast.py`): partitioned all 43+ stations across 3 concentric 2.5D energy rings (`<106 BPM` Chill/Fokus, `106–129 BPM` Groove/House/Synth, `>=130 BPM` Techno/Trance/Rave) with golden-ratio phase offsets, strict AABB screen-space label anti-collision, Favorites star & ring filter bar (`Wszystkie / Ulubione / I / II / III`), and ergonomic Mobile Corner Thumb-Turntable (`Prawy / Lewy kciuk`); added Friends & Invite-with-Greeting (`WhatsApp`, `Telegram`, `E-mail`, `SMS`, self-pairing `?w=` links, live station presence halos, and Live Airwave Hijack drops for greetings/pills/podcasts), Custom Creator & YouTuber Live Radios (`?r=slug` with curated YouTube/web pills), and SSRF-guarded Website-to-Podcast personalized outreach links (`?p=token` with optional intro comment).
- **Club DJ Mixer Engine (`±12%` Master-Tempo WSOLA, Spectral-Flux Tempogram & Genre Techniques) + Inline Prompt Editor in `Muzyka` Tab** (`server/app/dj_dsp.py`, `server/app/dj_genres.py`, `server/app/mixer.py`, `server/app/stream.py`, `server/app/admin_api.py`, `public/admin.html`, `server/scripts/dj_mix_tool.py`, `server/tests/test_dj_mixer.py`): upgraded radio transitions from short linear-resampling fades to stereo phase-locked WSOLA time-stretching within `±12%` BPM (`0.0` semitone shift), multi-band spectral-flux autocorrelation beat tracking (`tempogram_beat_grid`) for rolling-sub rumble techno (`berlin-bcco-techno`, `detroit-techno`, `goa-trance`), 32–48 beat (`15–23s`) real DJ phrase lengths (`MIX_RESERVE_SECONDS = 26.0`), and 4 genre-routed DJ techniques (`eq_blend` 3-band Linkwitz-Riley isolator + downbeat bass swap, `filter_sweep` dual Chamberlin SVF LPF/HPF sweep, `echo_out` 3/4 tempo-synced dub delay + drop on 1 for hip-hop/dub/`>12%` BPM jumps, and `velvet_fade` 12–16s 3-band S-curve for ambient/jazz/B2B); exposed inline Lyria prompt + BPM/density/brightness editing directly inside the `Muzyka (Kawałki i Prompty)` tab of `/admin.html`.
- **Voice-Only Podcasts & Pills Over Live Radio Music Bed (`MANIFEST_VERSION = 3`)** (`server/app/podcast.py`, `server/app/pill_service.py`, `orbita/src/engine.js`, `src/ui/plus.ts`, `src/ui/dosradio.ts`, `src/radio/publicRadioEngine.ts`): eliminated double-music layering where podcasts and YouTube pills baked `dos-groove` music into bumpers (`b*.opus`) and 2–3 min archive segments (`m*.opus`) on top of the active radio stream; episodes now emit 100% pure spoken segments while the listener's chosen live radio station plays continuously underneath as the single ducked background music bed (`DUCK_LEVEL = 0.24`, voice gain `0.42`).
- **Inline Lyria Prompt Editor in Admin (`/admin.html`), Universal MP3/Ogg DJ Stream & Ducking Fix** (`public/admin.html`, `server/app/stream.py`, `orbita/src/audio.js`, `orbita/src/engine.js`, `src/radio/publicRadioEngine.ts`, `src/radio/chunkStreamer.ts`): every station row in `/admin.html` (`Rodzaje Muzyki`) now exposes an inline Lyria prompt `<textarea>` with instant search and 1-click `Zapisz prompt` (`PATCH /radio-api/admin/catalog/stations/{id}`) feeding `StationRecorder` live; added `/radio-api/station/{id}/stream.mp3` and `/radio-api/group/{id}/stream.mp3` (`libmp3lame 160k`) auto-selected on Safari/WebKit/iOS so `mixer.py` 16-beat DJ crossfades are no longer bypassed by `stream.ogg` fallback; fixed `ChunkStreamer` intra-session continuity (`live_prob=0` after initial segment + 2.4s inter-session crossfade); fixed voice/music ducking (`musicBus = 1.0`, `DUCK_LEVEL = 0.24`, `VOICE_BASE_GAIN = 0.42`, 320 ms pre-duck, 1.8 s restore).
- **8 Techno & Rave Genres + 3 B2B Venue Sets (42 Stations Total)** (`server/app/catalog_extra.py`, `server/app/catalog.py`, `server/app/hosts.py`, `server/app/recorder.py`, `src/radio/extraStations.ts`, `src/radio/stations.ts`, `orbita/src/data.js`, `orbita/src/i18n.js`): added group `techno-rave` (`berlin-bcco-techno`, `raw-techno`, `hypnotic-techno`, `etno-techno`, `tribal-techno`, `goa-trance`, `hard-dance`, `tekk`) and group `przestrzenie-b2b` (`salon-beauty-spa`, `lobby-hotelowe`, `poczekalnia`), plus updated 4th Orbita welcome line highlighting the free first hour and registration.
- **Share Station with Personal Host Dedication (`?d=<token>`)** (`server/app/dedications.py`, `orbita/src/dedication.js`, `src/ui/dedicationModal.ts`): `POST /radio-api/dedications` creates a shareable link (`Dla [Imię]`, `Od [Imię]`, dedication up to 200 chars) and synthesizes/caches a personalized WAV host greeting (`/radio-api/dedications/{id}/greeting.wav`) played automatically when the recipient opens `/orbita.html?d=...` or `/?d=...`.
- **Unified Classic <-> Orbita 3D View Switcher & PWA Integration** (`index.html`, `src/ui/dosradio.ts`, `src/ui/prefs.ts`, `orbita/src/main.js`, `public/sw.js`, `public/manifest.webmanifest`): live view switcher (`Widok: Klasyczny | Orbita 3D`) persisting `dosradio.view.v1`, `?view=orbita` / `?view=classic` deep links, PWA app shortcuts for Classic, Orbita 3D and Auto-Ramowka, and Service Worker caching for `/orbita.html` and `/admin.html`.
- **6 Music Groups, Subgroups, Group Streaming & 7 New Genres** (`server/app/catalog.py`, `server/app/stream.py`, `server/app/hosts.py`, `server/app/recorder.py`, `src/radio/stations.ts`, `orbita/src/data.js`): 32 stations organized into 6 groups (`fokus-puls`, `klub-energia`, `synth-filmowa`, `klasyka-instrumentalna`, `etno-folk`, `chill-noc`), continuous DJ-mixed group stream `/radio-api/group/{group_id}/stream.ogg`, and 7 new genres (`stranger-synth`, `muzyka-filmowa`, `cyber-noir`, `muzyka-klasyczna`, `instrumentalna-akustyczna`, `etno-world`, `slowianski-folk`).
- **Auto-Ramowka 24/7 Engine & `zrobi.my` B2B Audio Funnel** (`server/app/auto_ramowka.py`, `src/radio/publicRadioEngine.ts`, `orbita/src/main.js`): hourly genre rotation matched to Warsaw time of day, news bulletins every 20 minutes, podcasts, host jingles, TTS-synthesized `zrobi.my` AI audit/implementation spots (`/radio-api/ramowka/spot/{id}.wav`), and CORS-enabled lead receiver `POST /radio-api/leads/zrobimy` coupled with the standalone B2B project `/Users/wojciechwiesner/Projects/active/zrobimy`.
- **Admin Cockpit (`/admin.html`) & Admin API** (`public/admin.html`, `server/app/admin_api.py`, `server/app/telemetry.py`): recorded `.opus` track browser/player, interactive A/B DJ Mixer Tester with live WAV synthesis and 64-point envelope plot, token/Lyria usage telemetry, registered & online listener presence, dynamic station/group catalog CRUD, 24h Auto-Ramowka editor, and `zrobi.my` SME lead inbox.

### Fixed
- **Orbita: dedications are read again** (`orbita/src/engine.js`): `playDedicationIntro()` passed an undefined
  `kind` to `say()`, so opening a dedication link threw `ReferenceError: kind is not defined` and the dedication
  was never voiced. It now airs with `kind: 'dedication'`. Covered by `tests/orbitaDedicationIntro.test.ts`.
- **Phrase-Long DJ Mixer & Seamless Intra-Session Continuity** (`server/app/mixer.py`, `server/app/stream.py`): fixed short/audible transitions caused by 4-beat (~1.9s) linear fades, 0.5s fallback cuts on syncopated/ambient tracks, and destructive beat-slicing inside continuous 30s Lyria takes. Consecutive 30s intra-session segments now splice via 15 ms equal-power micro-declick (0 dropped beats); inter-session and group transitions use a 16-beat (4-bar, ~7.6-8.0s) beat-matched crossfade with Linkwitz-Riley 150 Hz midpoint bass-swap and 6.5s equal-power crossfade for beatless/ambient genres.
- **AP newest news in the `ap` feed** (`scripts/publish_feeds.py`): reads ap_improve `GET /api/radio` first (blockers, overdue and just finished company topics, most urgent IT ticket) and puts those lines before the queue signals. Optional: an older ap_improve without the endpoint still publishes the queue signals.

### Fixed
- **Orbita: recorded host voices at start & showcase** (`server/app/orbita_voice.py`, `server/app/orbita_scripts.py`, `orbita/src/engine.js`, `orbita/src/api.js`, `orbita/src/sales.js`, `orbita/src/main.js`): after browser `speechSynthesis` was removed from Orbita, `playIntro()` (e.g. Kuba on `dos-groove`), showcase programmes (`defaultPodcast`, `stoicPill`), air fillers and 5-minute nudges emitted `kind: 'tts'` without WAV URLs, showing silent captions only. Added `/radio-api/orbita/intro/{station}/{index}.wav`, `/radio-api/orbita/nudge/5min.wav`, `/radio-api/showcase`, and `/radio-api/showcase/{kind}/{index}.wav` (`pl`/`en`/`ru`) with atomic disk caching (`data/voice/orbita/`), look-ahead warm-up, startup prewarm for Kuba & showcase, and Orbita engine wire-up with caption fallback.
- **Station stream: a second listener got silence** (`server/app/stream.py`): the shared Ogg/Opus encoder writes its Opus headers
  only once, when it starts. Anyone who joined a station that already had a listener received audio pages with no header, so
  the browser's audio element waited forever (a couple of seconds of the welcome intro, then silence). New listeners now get
  the two header pages replayed and the stream continues on a page boundary. Covered by
  `server/tests/test_stream_late_join.py`, which fails on the old code and passes now.

### Changed
- **Orbita: no synthetic speech, a quieter and more artistic stage** (`orbita/src/`): the browser speech-synthesis fallback is gone;
  a part without a recording is shown as a caption at reading pace while the host form moves with it, and silent captions no
  longer duck the music. The opening text is shorter (4 lines, PL/EN/RU) and the start screen copy was rewritten. The streaks
  background is now an interference field: a standing wave from 3-8 symmetric sources (a different symmetry per station,
  morphing on tune), contours in the colour of the time of day (`tod.js`, `?hour=` overrides for testing), a ring on every
  kick and the line weight following the level. The hosts are abstract forms (a breathing orb in gyroscope rings, a crystal
  with orbiting rings) instead of head-and-jaw figures.

### Fixed
- **At least 2 minutes of music between anything that speaks** (`src/radio/radioClock.ts`, `publicRadioEngine.ts`): the gap
  after a news break was 45 s and host jingles/chatter ignored breaks entirely, so a clip could land right before or on top
  of the news. `MIN_MUSIC_BETWEEN_MS` is now 120 s, a host clip counts as speech for the next break, and clips only start
  when the last spoken item ended 2+ minutes ago and the next break is more than 2.5 minutes away (`canSpeakNow`).
  The break timer is rescheduled after every clip and can no longer be armed twice.

### Added
- **Orbita: a parallel 3D front end at `/orbita.html`** (`orbita/`, built into `public/orbita.html` with `npm run build:orbita`):
  the station list becomes a tuner dial in space (drag, wheel, hold to seek, static between stations), news topics are moons around a dithered speaker, and when a host talks the speaker gives way to dithered host silhouettes with lip sync and captions. The palette follows the music. It reuses the existing API and shares `dosradio.prefs.v1`, `dosradio.pillQueue.v1` and `dosradio.aired.v1` with the classic app, so both run side by side. Ports the break scheduler, programme planner, pill queue, host clips and ducking; adds an opening intro by the host, a default duo podcast ("Twoja muzyka. Twoje tematy. Twoje życie."), a stoic pill, a free-hour checklist with nudges and an end-of-trial recap, a Gmail sample, one free podcast, and PL/EN/RU. Backend work it expects (lang, showcase audio, free podcast credit, Gmail connector) is listed in `orbita/README.md`.

### Fixed
- **Pressing play while the radio already runs no longer layers a second stream** (`src/radio/publicRadioEngine.ts`; Feedby 2026-11-12 "radio sie wylacza, ponowne nacisniecie play powoduje nakladanie sie stacji"):
  `start()` is now a no-op while `playing`, and `openStream()` tears down any live stream that is not the explicit `previous` before opening a new one, so two stations can no longer sound at once. Covered by two new tests in `tests/stationSwitch.test.ts`.
- **Own-source ("Moje źródła") stories are aired first in a break** (`src/radio/programme.ts`; Feedby 2026-11-12 "Nie odtwarzaja sie wlasne wiadomosci"):
  the server tags them `personal` while the client only knew `mine`, so they got no priority and were crowded out by rendered stories of other topics. `rankUnaired` now ranks own stories first. Covered by a new test in `tests/programme.test.ts`.
- **Synchronized live news on-air state and headline updates** (`src/radio/publicRadioEngine.ts`, `src/radio/breakRunner.ts`, `src/ui/dosradio.ts`):
  isolated voice source termination (`stopVoiceSource`) from session-level speaking state so `playVoice()` no longer resets `speaking` to false mid-break. The on-air banner and status pill now reliably stay in "Wiadomości na żywo" mode throughout the bulletin. Forwarded clip descriptors in `runClips()` to dynamically display the active headline, full story text, or weather forecast in the player card as the presenter speaks them. Ensured "Wiadomości teraz" can replay top daily stories on explicit request, and caught `TrialEndedError` in audio clip decoding.
- **Synced personal RSS feeds across account profiles**:
  ensured active user profile receives the calendar and AP operations personal digest feed.

### Added
- **Calendar and AP feeds for the personal news digest** (`server/app/agenda_feed.py`, `scripts/publish_feeds.py`):
  three RSS topics (`calendar`, `ap`, `all`) served from `/feeds/<token>/<topic>.xml`. Calendar comes from Google's "Daily Agenda" mail read over Himalaya (IMAP), AP signals from ap_improve `/api/ops` (counts only, nothing from stale data). The radio consumes them through the existing personal-RSS path, no radio code changes. Published by launchd (`io.theones.dosradio.feeds`) every 30 minutes. The token lives in `~/.config/dosradio-feeds/token`; nginx serves `/feeds/` with `autoindex off`, `no-store` and `noindex`.

### Fixed
- **Prevent station stream overlap and clash on switch** (`src/radio/publicRadioEngine.ts`):
  the previous station's `<audio>` element is now muted immediately when a new station is clicked, eliminating the dissonant overlap where both stations played simultaneously at full volume. Added switch generation tracking (`switchCount`) to discard slow/orphaned stream requests on rapid clicking, and single-voice exclusivity (`stopVoice`) so presenters never talk over each other.
- **Removed intrusive speech on station change**:
  station switches now transition music directly without forcing a 15-second welcome speech on every button click (full welcome intro is reserved for initial radio playback start).
- **Wall-clock pacing for Ogg stream** (`server/app/stream.py`):
  `StationStream._feed` now paces PCM output against `time.monotonic()` to match real-time playback, preventing the encoder from running at 60x CPU speed and over-mixing segments in rapid bursts.
- **Unlock news flash voice routes for all genres** (`server/app/voice_routes.py`):
  unlocked `/radio-api/intro.wav`, `/teaser.wav`, `/outro.wav` for borrowed stations (previously throwing 400 Bad Request).
- **Host voices, greetings, and jingles for all 25 stations** (`server/app/hosts.py`, `server/app/host_clips.py`, `server/app/main.py`):
  every station now has a personalized host greeting and jingle matching its genre (e.g. Kuba on Deep Tech, Ola on Trance). Unlocked `/radio-api/welcome/{sid}.wav`, `/radio-api/jingle/{sid}.wav`, and `/radio-api/host-clips/{sid}` for all 25 stations (previously returning 404 for borrowed genres).
- **Instant host greeting on station switch** (`src/radio/publicRadioEngine.ts`):
  switching station now immediately triggers the host's welcome line (`playWelcomeIntro`) while music ducks and loads, providing instant audio confirmation that the host is active and the station changed.
- **Archive fallback for new stations** (`server/app/stream.py`, `server/app/main.py`):
  new stations without recorded segments yet seamlessly stream audio from their parent genre, eliminating the 404 / 50-byte silent stall.
- **DJ mix engine with zero-phase kick onset detection and bass-swap crossfade** (`server/app/mixer.py`):
  built from proven blocks (`synthapse/kkik` beat grid and `AI_DJ` bass swap). Aligns the first kick of incoming recordings with outgoing kicks, crossfades highs over 4 beats, and swaps the low-pass sub-bass cleanly to prevent volume drops, flamming, and clipping.
- **Continuous buffer stream feeder** (`server/app/stream.py`): `StationStream._feed` now chains archive audio through `join_recordings` in memory before writing to `libopus`, guaranteeing a mathematically gapless `stream.ogg` for web and mobile listeners.
- **On-demand "Twój nastrój" (Mood) station** (`server/app/mood.py`): streaming personal radio generated from user prompt with a 30-second live delay buffer and 10-minute part rollover.
- **25 electronic station presets** (`src/radio/stations.ts`, `server/app/recorder.py`, `server/app/hosts.py`): expanded library with Deep Tech, Dub Techno, Detroit Techno, Microhouse, Tech House, Trance, Drum and Bass, and borrowed host voices for all new genres.

### Changed
- **Removed destructive edge fades in recorder**: `encode_pcm_to_opus` in `server/app/recorder.py` no longer silences the first and last 0.5s of sessions, preventing the 1-second volume dip that listeners heard every 3 minutes. Clean audio is now passed to the live mix engine.

### Fixed
- **Station switch left the previous music playing** (Feedby, 6 reports 2026-11-10): changing a preset station
  created the new stream element and destroyed the old one before the new one had started, so both played at once
  (or the old one died and the new one never came up). The swap now waits until the new stream is actually playing,
  and a failed switch keeps the station that was already on air.
- **Host break cut the mix** (same reports: the model reset and a new piece started under the voice): a break no
  longer restarts the live Lyria session, resets its context, or reloads the archive stream. The music stays and is
  only ducked under the voice.
- **One knob controlled everything** (Feedby, 2026-11-10): the single Głośność knob scaled music and voice
  together, and the music level under the news was a fixed constant. The receiver now has three knobs —
  Muzyka, Prowadzący, Muzyka pod wiadomościami — each on its own gain, remembered in the listener's settings.

### Changed
- **Longer recordings, mixed only where two of them meet.** A Lyria session now records three minutes (six 30-second parts) instead of one. A measured three-minute session kept its tone, so the old one-minute cut was wasting seams. The first part of a session fades in and the last fades out over half a second, so the join between two recordings does not jump. Parts inside one recording stay untouched, because that audio is already continuous.

- **Previous radio look restored.** The Kasprzak receiver (dial, piano keys, bakelite knobs) is gone;
  the station list and the plain volume slider are back. The three separate volumes stay in the engine
  and in the listener's saved settings, ready to return as plain controls.

### Fixed
- **Pills forgot where the listener stopped** (Feedby, 2026-11-10): the programme row now shows the
  part number and an "Od numeru" field, so a pill left at 3/42 continues from the number the listener
  types. The position was already remembered across reloads.

### Added
- **Odbiornik (gałąź feat/kasprzak-receiver)**: the player is a 60s-70s Polish table radio (Kasprzak/Diora): walnut
  cabinet, cloth grille, black glass scale with UKF numbers, station names on four bands (Fokus, Energia, Chill, Noc) and a red
  pointer, magic eye driven by the live signal level, ivory piano keys, bakelite volume and tuning knobs (native ranges,
  keyboard and touch work). Mobile turns the scale into tappable chips. Replaces the level bars. CSS/SVG only, no images.
- **Pigułki hurtem (Plus)**: "Wklej wiele linków naraz" under the YouTube pill form. `POST /radio-api/plus/pills/batch {"text"}`
  takes up to 20 links in any pasted block (new lines, commas, or glued together), skips duplicates by video id,
  reports each link as queued/ready/duplicate/error and saves every accepted episode to "Moje pigułki".
  Triggered by Insight: 123 YouTube links were copied one by one on 2026-11-07.
- **Archive cleanup**: `server/scripts/clean_archive.py --station <id> --dry-run|--apply|--purge-originals`
  finds steady Lyria tones in archived segments and rewrites them with notch filters; originals stay in
  `<station>/originals/` until purged.
- **Fresh stream start**: `stream.ogg?seek=fresh` opens a private stream that starts at a Lyria session start.
- **Whine removal on the client (ToneTracker + ToneKiller)**: steady tones (the Lyria whine, 300 Hz - 16 kHz,
  >= 12 dB over the neighbourhood, same bin for 80% of 4 s) are notched on the music bus only
  (peaking -36 dB, Q 30, max 4 notches, released 3 s after the tone ends), so the stream element,
  the chunk fallback and the live helper are all covered. Voice never passes through it.
- **Pills join the programme**: pressing play on a YouTube pill no longer stops the radio. The pill goes
  into a persisted queue (`dosradio.pillQueue.v1`) and airs one unit per news break, after the news
  (bumper, or voice summary + clip), with the music ducked under it. The player shows
  "W programie: <title> (n/N)" with a remove button; a queued pill also makes a pill-only break when
  no news is left, or when news is switched off.
- **Moje pigułki**: every YouTube pill a Plus listener makes is saved on the account
  (`user_pills` table) and listed under the pill form with one-tap replay;
  `GET /radio-api/plus/pills` returns them newest first.

### Changed
- **Lyria whine no longer baked into the archive**: recorder sessions capture 2 segments (~60 s) instead of 10,
  with the temperature jittered per session; every segment is notched on steady tones
  (up to 4 filters, -36 dB) before Opus encoding. Adds `numpy` to the server requirements.
- **Music reset during breaks (stream path)**: when the voice starts, the stream element is replaced by a
  new one opened with `?seek=fresh&t=<ms>`, so the music comes back from a fresh point instead of the
  drifted one (the live helper is still reloaded on the live path).
- **News frequency: any minute from 1 to 60** — settings slider with a live label
  ("Co minutę", "Co 3 minuty", "Co 25 minut", "Co godzinę"); onboarding quick picks 1/3/5/10/15/30/60.
  Stored values are rounded and clamped, old ones stay valid.
- Breaks always leave at least 45 s of music after the previous break ends, so "co minutę"
  never turns the radio into non-stop talking.

### Fixed
- **Pill form inputs**: the YouTube link input was unstyled (white system field on the dark theme).
- **RSS feeds as a news source**: a feed saved in the Plus panel can now be picked as the
  "Moje źródła" news topic (chip in settings and onboarding, Plus only) and the radio reads it
  in regular breaks via `/radio-api/news?cats=mine`. Keywords now rank feed stories instead of
  dropping every story that did not match (a feed with no keyword hit used to yield nothing).
- **YouTube pill**: subtitles are tried in order (human pl/en, original-language auto captions,
  en) and one failing track (HTTP 429 on auto-translated captions) no longer aborts the pill;
  yt-dlp is taken from the app venv (`yt-dlp[default]>=2026.10` in requirements) because the
  distro build is blocked by YouTube (403/SABR).

### Added
- **YouTube pill (Plus)**: `POST /radio-api/plus/pill {"url"}` and `GET /radio-api/plus/pill/{id}`
  turn a video or channel link (latest upload, up to 3 h) into a "pigulka": pl (else en) subtitles,
  Gemini picks ordered segments covering ~20% of the episode (20-120 s, snapped to cue boundaries),
  yt-dlp + ffmpeg cut those exact fragments, each introduced by a one-sentence host summary and
  wrapped in intro/outro bumpers. One job at a time, cached per video id, 402 without Plus.
  New modules `youtube_pill.py` (pipeline) and `pill_service.py` (queue and cache); UI in `pill.ts`.
- **Podcast bumpers**: ffmpeg-built stings (6-9 s music bed from the station archive, faded, ducked
  under the host voice) for intro, break-out, break-in and outro; manifest parts get kind `bumper`.
- Client podcast player schedules parts gaplessly and fades music and bumper edges by 1.5 s.

### Changed
- Podcast manifests carry `version: 2`; episodes cached before bumpers regenerate on next request.
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
- **News headlines**: each story carries a one-sentence `headline` (max 18 words) next to its
  `radio_text`, which is now 45-70 words. `GET|HEAD /radio-api/story/{id}/headline.wav` voices
  the headline once and caches it.
- **Ramówka voices**: `GET|HEAD /radio-api/teaser.wav?story=&station=` (teaser for a story,
  404 for unknown ids), `GET|HEAD /radio-api/outro.wav?station=&variant=0..3` ("Gramy dalej."
  family) and `GET /radio-api/intro.wav?time=&station=&kind=flash|main|hourly`.
- **Weather**: `GET /radio-api/weather?lat=&lon=&city=` returns city, temperature, summary and
  text from Open-Meteo; `GET|HEAD /radio-api/weather.wav` voices that text for a station.
  Forecasts are cached 30 minutes per coordinates rounded to two decimals.
- **Aired ledger**: `GET /radio-api/aired?day=` and `POST /radio-api/aired` keep the stories a
  verified listener already heard per day, merged as a union, capped at 500 ids per day.
  Anonymous and unverified listeners get 401.

### Changed
- News prompt asks for headlines and the 45-70 word radio text, and every model reply passes
  through `strip_emoji` before it is stored or voiced.
- Old `GET /radio-api/intro.wav?time=` endpoint is replaced by the kind-aware one above.
- **Voice loudness (v1.4 U1)**: host and news voice now sit 8 dB below full-volume music
  (`VOICE_GAIN = 0.4` on the voice bus in `publicRadioEngine.ts`), and the music duck level
  while voice is speaking rose from 0.16 to 0.34 (-9.4 dB). Previously the voice played at
  0 dB against music ducked to -15.9 dB; now the voice (-8 dB) sits ~1.4 dB above the ducked
  bed and 8 dB below full music, so it no longer overpowers the music.
- **Server-side loudness normalization**: `GeminiClient.speak()` now runs every synthesized
  clip (news stories, host jingles/chatter, podcast turns) through `normalize_loudness()`
  (`server/app/news.py`), a single-pass ffmpeg `loudnorm` filter targeting -19 LUFS before
  caching/returning the audio. Falls back to the original, unnormalized audio and logs a
  warning if ffmpeg is missing or fails, so a broken normalizer never blocks speech.
### Added
- **Continuous station stream**: `GET /radio-api/station/{id}/stream.ogg` serves one shared
  Ogg/Opus stream per station, re-encoded from the archive so segment boundaries are
  gapless. The player uses a real `<audio>` element on Android and desktop (iOS stays on
  the chunk path), which keeps playback alive after the browser is closed. `?seconds=N`
  caps the length for tests.

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
