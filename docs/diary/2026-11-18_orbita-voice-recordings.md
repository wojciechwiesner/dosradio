# VibingDiary — 2026-11-18: Orbita Voice Recordings at Startup & Showcase

## Context & Root Cause
In `/orbita.html`, Kuba did not speak at startup (`playIntro()`), showing only silent text captions, and no `.wav` voice files were being generated. Earlier, browser `speechSynthesis` had been intentionally removed from `orbita/src/audio.js` (`AudioCore.speak()` calls `readCaption()` only), expecting real Gemini TTS `.wav` recordings via `decode(url)` + `playBuffer(buf, 'voice')`. However, `playIntro()`, `airFiller()`, `announce()`, and `showcase` (`defaultPodcast`, `stoicPill`) still emitted `{ kind: 'tts', text }` with no server endpoints or audio URLs.

## Decisions & Alternatives
| Decision | Chosen Solution | Alternative Considered | Rationale |
|---|---|---|---|
| TTS Endpoint Shape | Dedicated deterministic catalogue routes (`/radio-api/orbita/intro/{station}/{index}.wav`, `/radio-api/showcase`, `/radio-api/showcase/{kind}/{index}.wav`, `/radio-api/orbita/nudge/5min.wav`) | Open `POST /radio-api/tts` accepting arbitrary free text | Prevents quota abuse/arbitrary TTS proxying while allowing immutable `Cache-Control: public, max-age=86400` disk caching. |
| Latency Mitigation | Startup `prewarm_orbita_voice` for `dos-groove` (Kuba) + PL showcase, plus server-side & client-side look-ahead prefetch (`i+1`, `i+2`) with per-path `asyncio.Lock` | Rendering sequentially only when requested | Eliminates inter-sentence gaps and prevents duplicate concurrent Gemini TTS calls. |
| Offline Resilience | Fallback to `core.speak(caption, who)` in `engine.js:say()` if `decode(p.url)` returns `null` | Dropping failed voice parts | Preserves caption pacing in offline/demo mode or transient network errors. |

## Verification Evidence
- `npm run build:orbita` -> `orbita -> public/orbita.html` OK
- `npm run build` -> `tsc --noEmit && vite build` OK (`dist/orbita.html` emitted)
- `npm test` -> `14 passed (14)`, `113 passed (113)` (including `tests/orbitaVoice.test.ts`)
- `PYTHONPATH=server python3 -m pytest server/tests -q` -> `161 passed` (including `server/tests/test_orbita_voice.py`)
- Local FastAPI + headless browser runtime check on `/orbita.html`: HTTP 200 `audio/wav` on `/radio-api/orbita/intro/dos-groove/0..3.wav?lang=pl` & `/radio-api/showcase?lang=pl` with `.wav` files persisted under `orbita/`.

## Lessons Learned & Gotchas
- `host_for(station_id)` returns a default fallback `Host` instead of raising `KeyError`; always check `station_id in HOSTS or station_id in BORROWED_HOSTS` on public URL params so arbitrary strings cannot create unbounded cache files.
- Whenever removing synthetic speech fallbacks in UI, audit every `{ kind: 'tts' }` emitter across intro, showcase, filler, and nudges so none silently degrade into caption-only stubs.
