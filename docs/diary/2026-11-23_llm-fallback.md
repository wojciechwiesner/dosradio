# 2026-11-23 LLM and TTS fallback chain

## Problem

Production stopped producing news and podcasts: Gemini direct returned 429 (quota) and 401,
about 180 calls per hour, with no cooldown. The borg Gemini proxy was exhausted as well.

## Decisions

| Decision | Why | Alternatives considered |
|---|---|---|
| Chain Gemini direct -> llm.borg.tools models (`grok-4.20-0309-non-reasoning`, `gemini-3.1-flash-lite`, `grok-4.3`) | Different vendors behind one OpenAI-compatible endpoint, so one exhausted quota does not stop the station | Only retrying Gemini (does not heal quota) |
| Shared circuit breaker: auth opens the whole provider for 30 min, quota opens one model (retry hint or 10 min, doubled per strike, max 1 h) | A dead key must stop costing a network round trip on every call | Fixed sleep per call |
| News fallback rewrites real RSS items only; `source_url` always comes from the feed item | Ungrounded LLM news would be invented; the model may only pick a numbered source | Letting the fallback model "search" (no grounding available) |
| Grok TTS with a fixed Gemini -> Grok voice table, same gender per host | Voices must stay consistent between shows; gender checked by measured pitch (eve/ara/una ~210 Hz, rex/leo/sal ~130 Hz) | Random or single voice |
| `GeminiClient` moved to `gemini_client.py` | `news.py` was 427 lines; the chain would push it further past 300 | Keeping it in `news.py` |

## Verification

- `server`: `python -m pytest tests -q` -> 197 passed (15 new), exit 0.
- `npx vitest run` -> 123 passed; `npx tsc --noEmit` exit 0; `npm run build` exit 0.
- Local proof with a fake Gemini key and the fallback token set: Gemini answered HTTP 400
  "API key not valid", breaker opened `gemini` for 1800 s, then 6 AI stories were served by
  `fallback/grok-4.20-0309-non-reasoning`; every `source_url` matched a live feed item.
  Story audio and two podcast host lines (Kore -> ara, Charon -> rex) were voiced by
  `grok-tts` as 24 kHz mono WAV. Files: `~/Desktop/projects/files/dosradio-voice-probe/fallback-proof/`.

## Lessons and gotchas

- An invalid Gemini key returns HTTP 400, not 401; the breaker treats the "API key not valid" message as auth.
- `urllib` gets HTTP 403 from llm.borg.tools; use httpx.
- The same event can come from two feeds, so the fallback can produce two stories on one topic.
- Lyria (music WebSocket) has no fallback equivalent and is out of scope.
- The env example file was not updated in this change (blocked by the local guard); variables are documented in README.
