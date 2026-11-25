# Wave plan: DJ beat sync, podcast interludes, sound presets, dedication funnel, YouTube Live

Rev 3, 2026-11-19 07:20. Status: PLAN ONLY. Nothing dispatched, no product code changed by this plan.
Base at rev 3: `feat/kasprzak-receiver` @ `5711735` (was `a695e1b` at rev 1, `d919d12` at rev 2; another session commits to this checkout every few minutes).
Orchestrator: `claude-opus-5-5` in cmux on the Mac mini. Workers via `~/.hermes/bin/worker-dispatch`.

## 0. Owner decisions (2026-11-19)

| # | Decision |
|---|---|
| 1 | Beat sync runs on the server. No client-side sync in this wave. |
| 2 | YouTube visual: live overlay on top of an animation taken from the site, plus a "what is DOS Radio" description card. |
| 3 | YouTube encoder runs on the Mac mini, using the Apple hardware encoder. |
| 4 | Dedications are on YouTube, triggered from live chat: write a comment, tag someone, it is read on air. |
| 5 | Sound presets run on phones too. If a device has a problem, the preset switches itself off. |
| 6 | Wave order stays, but zones run in parallel wherever file ownership allows. |
| 7 | New: generated podcasts air as interludes between music, not as one block. |
| 8 | New: merge worktrees `wt/backend` and `wt/orbita`. Attempted, not completed, see section 2. |

## 1. Repo facts

Verified on 2026-11-19 by reading the repo, dry-run merges, and running the gates in a clean worktree at `5711735`.

### Mixer and stream
| Fact | Where |
|---|---|
| Beat grid computed at mix time, 28 s window, both decks, every join; no cache | `server/app/mixer.py:542,547`, `:47` |
| Beatmatch range +/-12 %, WSOLA stretch, piecewise tempo lock | `mixer.py:52`, `:401-424`, `server/app/dj_dsp.py:24` |
| `wsola_tempo_glide` is defined and imported but never called | `dj_dsp.py:49`, `mixer.py:19` |
| No bar, phrase or key detection | grep in `mixer.py`, `dj_dsp.py`, `dj_genres.py` |
| Generator gets a fixed BPM per station | `server/app/recorder.py:34-63` |
| Mix runs once per station in a thread; 26 s held back for it | `server/app/stream.py:308-311`, `:34` |
| Server stream is music only; voice is mixed in the browser | 0 hits for duck/voice/tts in `stream.py` |
| Music has no loudness normalisation (voice has) | `recorder.py:178-200`, `news.py:33,172` |
| A beat grid sidecar was built once and reverted two hours later | `82c89b4` (11-06 21:31, adds `server/app/beatgrid.py`, 176 lines), reverted by `0e1095d` (23:32); not in HEAD |
| Unmerged older mix branches exist | `feat/v14-u3b-mix` (2 commits), `feat/v14-u3b-base` (1 commit) |

### Clients (line numbers are for HEAD `5711735`)
| Fact | Where |
|---|---|
| Music already flows through Web Audio on both playback paths: `musicBus -> toneKiller -> master -> limiter -> destination` | `src/radio/publicRadioEngine.ts:168` and following |
| Android/desktop: `<audio>` element via `MediaElementSource`; iOS: 30 s chunk path | `publicRadioEngine.ts:391`, `src/audio/streamElement.ts` |
| Orbita has a separate graph in plain JS | `orbita/src/audio.js:16,212` |
| Pills already air as units between music in the classic app | `src/radio/pillQueue.ts:34`, `publicRadioEngine.ts:906` |
| After a dedication Orbita sets `introDone = true`, so the radio intro never plays | `orbita/src/engine.js:300` |

### Podcast state after `5711735` (committed 07:12 by another session, not by this plan)
| Fact | Where |
|---|---|
| Backend tags every part with a section: `intro`, `part_1..3`, `outro`; covered by a test | `server/app/podcast.py`, `server/tests/test_social_custom_urlpodcast.py:231-234` |
| Orbita plays the show chapter by chapter with music between chapters for 2.8 s, 7.5 s and 6.5 s, plus one spot | `orbita/src/engine.js:469`, `_musicInterlude` calls at `:510,513,520` |
| Classic app does the same with breaks of 2.5 s and 7 s | `src/ui/plus.ts:266` and following (`breakMs: 2500`, `7000`) |
| A podcast lock keeps intros, news and drops from overlapping a running podcast | `podcastActive` in `engine.js`, `isPodcastPlaying()` |
| The same commit added an invitation card on dedication links and promo spots | `orbita/src/inviteScreen.js`, `server/app/spots.py` |

Gap against decision 7: the show still runs as one continuous block; the music between chapters lasts seconds, not minutes. Zones P1/P2 below close that gap. The audio of this commit was not listened to in this session.

### Environment
| Fact | Evidence |
|---|---|
| Frontend gates pass at `5711735`: vitest 16 files / 122 tests, `tsc --noEmit` exit 0 | clean worktree run |
| `server/.venv` is Python 3.9.6; pytest stopped with 4 collection errors (run at `d919d12`) | pytest exit 2 |
| Backend tests pass on Python 3.12.11 at `5711735`: 182 passed | fresh venv, clean worktree |
| `npm run build` not run in this session | - |
| Mac mini: Apple M2 Pro, ffmpeg 9.0.1 with `h264_videotoolbox` and `hevc_videotoolbox` | local check |
| Prod borg-ts: 8 cores, ffmpeg 4.4.2 | read-only ssh |
| No `.opus`/`.ogg` recordings in the local repo; the archive is on prod | `find` returned 0 |
| Workers: omarchy, borg-ts, windows ONLINE; macbook-pro OFFLINE | `worker-dispatch status` |
| No RTMP/HLS/YouTube code in the repo | grep, 0 hits |

Not verified, Batch 0 must establish:
- cost of one join (wall time, event-loop lag); no performance number is quoted in this plan;
- why the beat grid sidecar was reverted;
- BPM spread per station and whether play order repeats pairs;
- which Python version prod runs;
- Mac mini: sustained encode load for 1, 2 and 3 simultaneous channels, and uplink bandwidth;
- every YouTube statement (ingest specs, simultaneous streams per channel, live chat API quotas and write access, whether chat mentions notify the tagged person, AI-content and rebroadcast rules). Nothing about YouTube in this plan has a checked source yet.

## 2. Step 0: worktree merge (not done, needs one owner decision)

What the dry-run merges showed:

- `wt/backend` (`416e7f6`, 04:06) and `wt/orbita` (`12f53f3`, 03:56) implement the same features that landed on the main branch in `a6ce666` (04:21), written separately. Neither branch is pushed.
- Backend: 7 conflicts against `5711735`. Five are files both sides created that did not exist at the merge base (`custom_radios.py`, `social.py`, `social_api.py`, `url_extractor.py`, `tests/test_social_custom_urlpodcast.py`), plus content conflicts in `plus_api.py` and `podcast.py`.
- Orbita: 4 conflicts (`data.js`, `main.js`, `scene.js`, and the build artifact `public/orbita.html`).
- The branch `podcast.py` imports `fetch_and_extract_url`, `UrlExtractError`, `ExtractedPage`, which the main `url_extractor.py` does not define, so taking the branch side of that file breaks imports.
- URL fetch guard: main resolves DNS before fetching (`getaddrinfo`), the branch version does not. The branch version must not win.
- `tests/orbita.test.ts` on the branch asserts 45 stations on 7 orbits and imports `ORBITS` from `scene.js`; main has the 3-ring dial and no such export.
- Only on the branches: routes `GET /genres`, `DELETE /friends/{friend_id}`, `GET /drops/{token}/segments/{idx}`, `POST /podcast/from-url`, `POST /podcasts`; Orbita modules `djMixer.js` (254 lines), `promptEditor.js` (271), `ramowka.js` (259); a rewritten `dedication.js`.
- The branch keeps getting commits from another session while this is open, so every new commit there can add conflicts (it went from 6 to 7 during planning).

Both merge attempts ran in scratch worktrees and were aborted; those worktrees and branches are removed. `wt/backend`, `wt/orbita` and the main checkout were not modified by this plan.

Recommended resolution (zone M, Sonnet, isolated worktree, at a moment when the other session is idle):
1. Main wins on every file both sides implemented.
2. Port by hand only what the owner still wants from the branch-only list.
3. Record both branches as merged, remove the two worktrees.

Owner decision: which branch-only items to port. If none, this is a record-only merge that discards them.

## 3. Architecture

### 3.1 Beat sync (server)
- Analyse each recording once at ingest into a sidecar; the mixer reads it instead of analysing at mix time.
- Station nominal BPM is a prior: narrows the search and removes half/double-tempo errors.
- Tiered tempo policy:

| Tempo difference | Method |
|---|---|
| up to ~2 % | varispeed resample (pitch moves, transients stay intact, cheapest) |
| ~2 to 12 % | WSOLA (existing) |
| above 12 % or low grid confidence | no beatmatch; existing echo-out / filter techniques |

- Small differences are still corrected: drift = difference x overlap length (0.3 % over 15 s is ~45 ms).
- Mix-in on a phrase boundary of both decks; loudness matched from sidecar LUFS.
- Every transition is measured (low-band onset offset inside the overlap). Starting targets, tuned by listening: p95 <= 8 ms, max <= 15 ms. Over the limit the mixer falls back and records why.
- Renders run in a process pool. Disk transition cache only if Batch 0 shows repeated pairs.

### 3.2 Podcast interludes
- Backend marks sections in the manifest (intro, parts, outro).
- Clients queue sections as units and air one unit per break through the existing break scheduler, with full-level music in between. The classic pill queue is the model.
- Each section ends with a spoken hand-off and the next opens with a one-line recap.
- "Play it all now" stays available as an explicit action.
- Old manifests without section tags fall back to splitting by part count.
- Build on `5711735`: section tags, chapter loop and podcast lock already exist. The change is where a chapter airs: one chapter per programme break with minutes of music between, instead of seconds inside one run.
- Owner sets the spacing; recommended default is one chapter per break, 2-4 minutes of music between.

### 3.3 Sound
- Server baseline for every device, at ingest: high-pass ~28 Hz, loudness target, true-peak ceiling.
- Client presets on native Web Audio nodes (no AudioWorklet, no WASM). They can run on phones because music already passes through the graph on both playback paths:
  - Techno Punch: low peak ~60 Hz, mud cut ~280 Hz, presence ~3 kHz, glue compressor with ~30 ms attack so the kick transient passes, limiter, soft clip.
  - Phone Speaker: harmonics from the 50-120 Hz band so the kick is audible on small speakers. Manual toggle.
  - Night: stronger compression, lower ceiling.
- Device guard (decision 5): the preset is bypassed automatically when the audio context is interrupted repeatedly, the stream element stalls after enabling, or the device reports very low memory or core count. The bypass is remembered per device and shown in settings.
- `DynamicsCompressorNode` adds makeup gain that cannot be disabled; each preset carries a measured compensating gain.

### 3.4 Dedication funnel
| Step | Time | Plays | Screen |
|---|---|---|---|
| 0 | before tap | - | personalised link preview, one play button |
| 1 | 0:00 | 2 s music, then the dedication over ducked music | sender name |
| 2 | after | bridge line, max 8 s | - |
| 3 | ~0:35 | 60-90 s music | chip "Odpowiedz dedykacją" |
| 4 | ~2:00 | explainer, 35-45 s: what DOS Radio is, how to send a dedication | button "Wyślij dedykację" |
| 5 | ~2:45 | 2-3 min music | - |
| 6 | ~5:30 | feature podcast as interludes (3.2), skippable | button "Ustaw swoje radio" |

- Bridge (draft): "Zaraz wracamy do muzyki. A za chwilę opowiem ci, czym jest DOS Radio i jak wysłać komuś taką dedykację."
- Returning listeners: steps 1 and 3 only. Explainer never twice.
- Sender sees "odsłuchano"; recipient is offered a reply dedication.
- Only the dedication is personalised; bridge, explainer and feature podcast are cached clips.
- Metrics: opened, play, dedication finished, listening at 60 s, explainer finished, button tapped, dedication sent, returned within 7 days.

### 3.5 YouTube Live (everything on the Mac mini)
- Programme bus on the Mac mini: pulls the station stream from prod like any listener, fetches news, podcasts and idents through the existing API, mixes with ducking. Prod gets one extra listener per channel and no encoding load.
- Encoder: one supervised ffmpeg per channel, `h264_videotoolbox`, RTMPS out. Admin-only start/stop.
- Visual: looped animation rendered from the site as background; live overlay with now playing, headline ticker, spectrum, dedication card; rotating card describing DOS Radio and how to send a dedication.
- Chat dedications: the overlay invites "napisz dedykację w komentarzu i oznacz osobę". A chat reader parses mention and text, then: length cap, blocklist, safety check, per-author and per-hour limits, admin queue with an auto-approve switch and a kill switch. Approved items are voiced through the existing dedication pipeline, inserted at the next break, shown as an overlay card.
- Content gate: `broadcastable` flag. Existing generated podcasts are backfilled to true except personalised outreach podcasts; R3 confirms how to tell them apart.
- Stream keys and YouTube OAuth tokens stay in a local env file on the Mac mini (chmod 600, gitignored). Never in git, never sent to a browser.
- The Mac mini is also the orchestration host: the encoder gets a CPU budget and a kill switch, and the machine must not sleep.

## 4. Contracts

1. Beat grid sidecar `<recording>.grid.json` (owner A1): `version, bpm, nominal_bpm, beat_period_s, first_beat_s, bar_phase, phrase_starts_beats[], confidence, lufs_i, true_peak_dbfs, has_steady_kick`. `confidence < 0.5` or no steady kick means no beatmatch. Missing sidecar means today's live analysis.
2. `MixReport` additions (owner A2): `phase_error_ms_p95, phase_error_ms_max, stretch_method (none|varispeed|wsola), grid_source (sidecar|live), fallback_reason`.
3. Podcast manifest (owner P1): each part carries `section`; the manifest carries `sections[]` with `id, title, handoff_text`.
4. Master chain (owner B2): `createMasterChain(ctx, preset) -> { input, output, setPreset(name), health(), dispose() }`, presets `off|technoPunch|phoneSpeaker|night`.
5. Funnel events (owner C1): `POST /radio-api/funnel/event { token, step, ts }`.
6. Broadcast channel (owner D2): `{ id, station_id, programme_profile, visual, state, started_at, last_error }`. No key in any response.
7. Chat dedication (owner D6): `{ id, author_display, mention, text, state: pending|approved|rejected|aired, reason }`.

## 5. Zones and parallel schedule

Max 4 workers at once. One worktree per worker, cut from `wave/beatsync-1119`.

### Hot files (one owner at a time)
| File | Order |
|---|---|
| `src/radio/publicRadioEngine.ts` | P2 -> B2 -> C3 |
| `orbita/src/engine.js` | P2 -> C2 |
| `server/app/recorder.py` | A1 -> B1 |
| `server/app/podcast.py` | P1 only |
| `server/app/dedications.py` | C1 -> D6 |
| `CHANGELOG.md` | workers put their entry in the hand-off; the orchestrator writes the file at merge |

### Batch 0: facts (read-only, can start immediately)
| Zone | Model / node | Output |
|---|---|---|
| R1 mixer baseline: copy >= 20 recording pairs read-only from prod, render with the current mixer, record join time, loop lag, phase error, BPM spread | Sonnet / omarchy | `baseline.md`, WAVs in `~/Desktop/projects/files/dosradio-beatsync/before/` |
| R2 YouTube and encoder facts: every open YouTube item in section 1 with source links; measure 1/2/3 simultaneous 720p `h264_videotoolbox` encodes and uplink on the Mac mini | Haiku / windows for research, Mac mini for measurement | `youtube-facts.md` |
| R3 inventory: podcast and pill storage, how personalised podcasts are marked, invite and dedication paths, existing analytics, prod Python version | Haiku / omarchy | `inventory.md` with `path:line` |
| R4 beat grid history: why `82c89b4` was reverted, what `feat/v14-u3b-*` contain, what is reusable | Haiku / omarchy | `beatgrid-history.md` |

### Batch 1 (after Batch 0; M also needs the section 2 decision)
| Zone | Model | Files | Task |
|---|---|---|---|
| M merge reconcile | Sonnet | per section 2 | bring the two branches in, main wins |
| A1 ingest analysis | Sonnet | new `server/app/beat_analysis.py`, new `server/scripts/backfill_grids.py`, `recorder.py` hook, tests | sidecar per contract 1, backfill script; reuse `82c89b4` if R4 clears it |
| A2 mixer policy | Sonnet, Opus review | `mixer.py`, `dj_dsp.py`, new policy module, tests | tiered stretch, phrase alignment, loudness match, phase measurement, contract 2; starts from a fixture sidecar |
| P1 podcast sections (server) | Haiku | `server/app/podcast.py`, tests | on top of the existing section tags: `sections[]` with title and hand-off text, a recap line opening each part, tests |
| C4 funnel copy | Opus (orchestrator) | `server/app/orbita_scripts.py` | bridge, explainer, feature podcast scripts; owner approves before rendering |

### Batch 2
| Zone | Model | Files | Task |
|---|---|---|---|
| A3 stream performance | Sonnet | `stream.py`, new `server/app/mix_pool.py`, tests | process pool, optional cache, proof that stream writers are not delayed |
| A4 audit harness | Haiku or Gemini, not shown A2's code | new `server/scripts/mix_audit.py` | render pair, dump WAV, per-band levels, kick offsets, tempo curve |
| P2 podcast interludes (clients) | Sonnet | `src/ui/plus.ts`, `publicRadioEngine.ts` (podcast path), `pillQueue.ts`, `orbita/src/engine.js` | queue chapters and air one per programme break in both apps; keep the existing lock and HUD; keep "play it all now" |
| C1 funnel backend | Haiku | `dedications.py`, `orbita_voice.py`, new `server/app/funnel.py`, tests | first-listen state, cached clips, contract 5, "odsłuchano" |

### Batch 3
| Zone | Model | Files | Task |
|---|---|---|---|
| B1 server baseline master | Sonnet | `recorder.py` encode chain, tests | high-pass, loudness target, ceiling; coexists with the tone notch |
| B2 master chain | Sonnet | new `src/audio/masterChain.ts`, `publicRadioEngine.ts` wiring, `src/ui/prefs.ts`, tests | contract 4 with the device guard |
| C2 Orbita funnel sequencer | Sonnet | `orbita/src/engine.js`, `dedication.js`, `sales.js` | sequence 3.4, fixes the skipped intro |
| D1 programme bus | Sonnet, Opus design | new `broadcast/` package, runs on the Mac mini | 3.5 |

### Batch 4
| Zone | Model | Files | Task |
|---|---|---|---|
| B3 Orbita presets | Haiku | `orbita/src/audio.js`, settings UI | same presets and guard |
| C3 classic funnel parity, link preview | Haiku | `src/ui/dedicationModal.ts`, `publicRadioEngine.ts` dedication path | 3.4 in the classic app |
| D2 encoder supervisor | Sonnet | `broadcast/encoder.py`, admin routes | contract 6, restarts, CPU budget, kill switch |
| D3 visual | Haiku | loop renderer, ffmpeg filter graph | background loop, overlay, description card |

### Batch 5
| Zone | Model | Files | Task |
|---|---|---|---|
| D4 admin UI | Haiku | `public/admin.html` | channels, start/stop, state, chat dedication queue |
| D5 content gate | Haiku | podcast/news metadata, tests | `broadcastable`, backfill rule from R3 |
| D6 chat dedications | Sonnet | new `broadcast/chat_dedications.py`, tests | contract 7 |
| B4 device QA | Haiku + owner's phones | none | low-end Android, iPhone, desktop |

## 6. Gates

Backend tests need Python >= 3.10: `server/.venv` (3.9.6) fails at collection. Every backend gate names its interpreter.

| Gate | Passes when |
|---|---|
| All code zones | `python -m pytest tests -q` (Python >= 3.10), `npx vitest run`, `npx tsc --noEmit`, `npm run build` exit 0 on the merged branch |
| G-A beat sync | `mix_audit.py` on the R1 pairs meets the phase targets; every fallback has a reason; join time and loop lag reported next to R1; owner listens to before/after WAVs and signs off |
| G-P podcasts | browser run on a mobile viewport: a real generated podcast airs as >= 3 sections with music at full level between them, in both apps; owner listens once |
| G-B sound | each preset rendered offline on the same clip with before/after WAVs and band/crest numbers; owner listens on phone speaker and headphones; background playback confirmed on a real Android and iPhone; the guard bypasses on a forced failure |
| G-C funnel | browser run with a real dedication token shows each step and each stored event; owner listens to the sequence |
| G-D YouTube | 60-minute unlisted broadcast from the Mac mini within the CPU budget; a killed ffmpeg restarts; a non-broadcastable item cannot reach the bus; a test chat message goes through moderation to air. The owner creates the keys and starts the first public broadcast |

Listening gates do not block unrelated zones from starting. They block merge to the deploy branch.

## 7. Rules for workers

- Implement exactly your zone. Never edit another zone's files or a hot file out of turn.
- Read the code first. Files under 300 lines, English identifiers and comments, Polish product copy, no emoji in UI.
- No network in tests: inject fakes.
- Audio claims need WAV dumps and measurements.
- No deploy, no ssh to prod except R1's read-only copy. borg-ts workers get light tasks only.
- `git add` only your files. Commit message ends with:
  `Developed by Wojciech Wiesner wojciech@theones.io -= join.theones.io =- be The One Who Is Many -`
- Finish with `.planning/orchestration/waves/beatsync-1119/<zone>.done`: `DONE <0|1>`, commit SHA, real gate output, changelog entry text.

## 8. Orchestrator (Opus 5.5)

1. Another session commits to `feat/kasprzak-receiver` in the main checkout. Agree with the owner whether it keeps running during the wave. Cut `wave/beatsync-1119` from a committed SHA, work only in worktrees, and never stash or overwrite uncommitted work in the main checkout.
2. Dispatch Batch 0. Stop for the owner's listen to three "before" WAVs and for the section 2 decision.
3. Write briefs to `.planning/orchestration/waves/beatsync-1119/<zone>-brief.md`. Dispatch a zone only when its hot-file predecessors are merged.
4. Merge order inside a lane follows the hot-file table. Run gates on the merged branch.
5. Re-run the A4 audit and the browser checks yourself. Worker sentinels are self-reports.
6. Deploy only after the listening sign-off and an explicit yes, with a backup first.
7. After each batch: update `.planning/STATE.md` and the Obsidian project note.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Parallel sessions edit the same checkout | step 8.1; one worktree per worker |
| Beat grid sidecar was reverted before for an unknown reason | R4 before A1 |
| Varispeed pitch shift on melodic stations | per-genre cap, owner listens per genre |
| Presets break background playback on phones | device guard, G-B on real devices |
| Mac mini is both orchestrator and encoder | CPU budget, kill switch, R2 measurement decides channel count |
| Uplink too small for several channels | R2 measures; channel count follows |
| Abuse through chat dedications on a public stream | moderation chain, rate limits, admin queue, kill switch |
| Personalised podcasts reach a public stream | `broadcastable` backfill excludes them, with a test |
| Loudness jump between old and new recordings | gain-match from sidecar LUFS until a backfill is decided |
