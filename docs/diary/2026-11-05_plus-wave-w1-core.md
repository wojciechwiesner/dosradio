# 2026-11-05 · Plus Wave — W1 plus-core (duet podcasts, personalized news)

Worker W1 on worktree `dosradio-wt-plus`, branch `wt/plus-core`, per
`docs/plans/2026-11-05-plus-wave.md`.

## What was built

1. **Duet podcasts** (`server/app/podcast.py`): `POST /radio-api/plus/podcast {topic?}`
   generates a two-host PL conversation (Ania/Kore + Michał/Charon) with
   `gemini-3.8-flash`, voices turns via the existing TTS pipeline, interleaves runs of
   consecutive archive segments (continuous 2-3 min music) between three dialogue
   sections. Episodes cached per topic per day under `data/podcasts/`, max 30 kept.
2. **Personalized news** (`server/app/personal_news.py`): `PUT/GET
   /radio-api/plus/news-preferences` (max 20 keywords, max 10 RSS feeds, http/https
   only, case-insensitive dedupe) + `GET /radio-api/plus/news-digest` (RSS 2.0 + Atom,
   5 s timeout per feed, per-feed isolation, keyword filter, global fallback).
   The hourly loop refreshes preference rows through a `news.on_personal_refresh`
   hook that can never break the global cycle. Digest stories reuse the shared
   `/radio-api/story/{id}.wav` on-demand TTS path via `NewsService.extra`.
3. **Frontend** (`src/ui/plus.ts`, `index.html`, wiring in `dosradio.ts`/`radioApi.ts`):
   "Twoje źródła" panel + digest list + "Posłuchaj swoich wiadomości" +
   "Wygeneruj podcast", Plus-only visibility, sequential playback over the shared
   AudioContext. Zero emoji, SVG icons, Polish copy.

## Decisions

| Decision | Rationale |
|---|---|
| New modules `podcast.py` / `personal_news.py` / `plus_api.py` instead of growing `news.py`/`main.py` | SOTA <300 lines/file; main.py/news.py were already over the limit; ownership boundaries stay clean |
| Plus endpoints live in `plus_api.build_plus_router`, main.py only mounts it | keeps main.py delta at ~10 lines |
| Music segments copied into the episode dir | archive rotates at 100 h; cached episodes must stay playable |
| Episode id = `<date>-<slug(topic)>` | free deterministic per-day cache, no extra index |
| Digest stories remembered in `NewsService.extra` | zero new endpoints for personalized TTS — story route just works |
| Panel CSS in a scoped `<style>` block in `index.html` | `dosradio.css` is outside W1 ownership; avoids merge conflicts with W2 |
| No publicRadioEngine.ts changes | file is outside W1 ownership; podcast/digest player plays through the same shared WebAudio context instead |

## Verification (real outputs)

- `cd server && python3 -m pytest tests -q` → `15 passed in 2.81s` (7 existing + 8 new)
- `npx tsc -p tsconfig.json --noEmit` → exit 0
- `npm run build` → `✓ built in 567ms` (tsc + vite, exit 0)
- `npm test` (vitest, existing suite) → `8 passed`

## Lessons / pitfalls

- httpx `TestClient.get()` rejects a `json=` kwarg — gate loops must pass kwargs only
  to POST/PUT.
- Polish diacritics slugify to dashes (`produktywność` → `produktywno-c`); tests must
  compute expected ids with the same `slugify`, never hardcode.
- Keyword dedupe must be case-insensitive on the server ("AI" vs "ai").
- A first draft contained a CJK typo in Polish UI copy — grep for non-latin scripts
  before committing user-facing strings.
