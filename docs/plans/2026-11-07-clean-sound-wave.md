# DOS Radio — Clean Sound + Pill-in-Programme Wave (2026-11-07, target v1.6.0)

## Diagnosis (measured, not guessed)
Wojciech: "stream brzmi bardzo źle — specyficzne dla Lyrii wycie w tle; nie zresetował się podczas mówienia".
- The preset stations do NOT play live Lyria. They play the recorded archive via
  `/radio-api/station/{id}/stream.ogg` (server/app/stream.py), fed by server/app/recorder.py which
  records 10 x 30 s segments per Lyria session. So the whine is baked into the archive files, and
  `reloadLiveSession()` during breaks never touches it (it only reloads `this.helper`, which is not
  used when the stream element plays). That is why "it did not reset during talking".
- Steady-tone scan (FFT 8192, peak >= 18 dB over a 300 Hz median floor, same bin in >= 60% of frames,
  300 Hz-16 kHz), last 320 segments per station:
  - dos-groove: 163/320 segments (51%) carry a steady tone (e.g. 463-469 Hz at +33 dB, 1318-1336 Hz,
    1986-1998 Hz).
  - minimal-techno: 131/320 (41%).
  - By position inside a Lyria session: first 30 s 9/34 and 5/33; from the 2nd segment on ~50%.
    Lyria starts clean and drifts into a whine within ~30-60 s.
- Synthapse solved this live in commit d77b54f (src/dsp/toneTrack.ts + toneKiller.ts): confirm a
  peak only if >= 12 dB over +-300 Hz on the same bin for 80% of 4 s, then notch it on both channels
  (peaking -36 dB, Q 30, 80 ms ramps, max 4 notches, release 3 s after the tone ends).

## Requirements
R1. Remove the whine from what listeners hear on every path (stream element, chunk fallback, live).
R2. Stop recording whine into the archive: shorter Lyria sessions (rotate the WebSocket session
    before it drifts) + notch steady tones at encode time.
R3. Clean the existing archive (offline pass over stored segments, keep originals until verified).
R4. Reset the music during every news break on the path that actually plays (stream element):
    while the host talks, jump the stream to a fresh, clean point instead of continuing the drift.
R5. YouTube pills become part of the programme: pressing play on a pill never stops the radio; pill
    parts air one by one inside news breaks (between news), with the radio music ducked under them
    like any other voice. Each break may carry one pill part after the news; the UI shows
    "W programie: <pill title> (3/16)" and lets the listener remove it.

## Zones (strict file ownership)

### W1 — Sonnet — client DSP + pill-in-programme (worktree ../dosradio-wt-clean-ui, branch wt/clean-ui)
OWNS: src/dsp/toneTrack.ts (new, port from synthapse), src/dsp/toneKiller.ts (new, port),
src/radio/publicRadioEngine.ts, src/radio/breakRunner.ts, src/radio/programme.ts,
src/radio/programmeState.ts, src/radio/pillQueue.ts (new), src/ui/pill.ts, src/ui/plus.ts,
src/ui/dosradio.ts, src/ui/dosradio.css, src/ui/pill.css, index.html, tests/**.
- R1 client: port ToneTracker + ToneKiller from ~/Projects/active/synthapse/src/dsp/ (read them and
  their tests in synthapse/tests first), insert ToneKiller on the music bus only (never on voice),
  so every music path (stream element, chunk streamer, live helper) is covered.
- R4: during every break (airBreak), when the stream element plays: after the voice starts, restart
  the stream element (new <audio> with a `?seek=fresh&t=<ms>` cache-buster) so music resumes from a
  fresh point when the break ends; keep ducking, no gap louder than the break itself. Keep the live
  helper reload for the live path.
- R5: pillQueue.ts — pure, unit-tested queue of {pillId, title, parts, nextIndex}. Pill "play"
  enqueues the pill into the programme instead of stopping the radio (if the radio is not playing,
  start it). breakRunner airs, after the news clips, the next pill unit = [voice summary part,
  clip part] (a bumper counts as its own unit at start/end). Persist the queue in localStorage
  `dosradio.pillQueue.v1`. UI: line "W programie: <title> (n/N)" with a remove (x) SVG button.
  When the pill queue is not empty the break may run even if no news is left (pill-only break).
- Tests: vitest for ToneTracker (synthetic 2500 Hz steady tone found, moving partials not), pill
  queue order/persistence/removal, break plan with pill unit appended.

### W2 — Haiku — server recording + stream (worktree ../dosradio-wt-clean-api, branch wt/clean-api)
OWNS: server/app/recorder.py, server/app/stream.py, server/app/tone_clean.py (new),
server/scripts/clean_archive.py (new), server/tests/test_tone_clean.py (new),
server/tests/test_stream.py, server/tests/test_recorder.py (new if absent), server/requirements.txt.
- R2: recorder sessions 2 segments (60 s) instead of 10 (constant SEGMENTS_PER_SESSION = 2);
  between sessions vary the seed/temperature slightly so consecutive sessions do not sound cloned.
- tone_clean.py: pure-Python (no numpy dependency on prod) or numpy if you add it to requirements;
  detect steady tones in a PCM buffer (same rule as above: >= 12 dB over +-300 Hz, same bin, >= 80%
  of frames over the segment) and build an ffmpeg `equalizer=f=<hz>:t=q:w=30:g=-36` chain (max 4).
  `encode_pcm_to_opus` applies it before encoding. Must be fast: <= 1.5 s per 30 s segment on prod.
- R3: server/scripts/clean_archive.py --station X --dry-run|--apply: rewrites segments that carry a
  steady tone, original kept as `.orig.opus` until `--purge-originals`; prints counts.
- R4 server: stream.py accepts `?seek=fresh` → listener starts at a fresh random archive point
  (prefer the first segment of a session = cleanest) instead of the shared continuous position.
- Tests offline: synthetic PCM with a 469 Hz steady tone + noise → detected, filter chain built;
  moving sweep → not detected; recorder session length constant; stream seek=fresh picks a session
  start.

## Gates
- W1: npx tsc -p tsconfig.json --noEmit; npx vitest run; npm run build — all exit 0.
- W2: cd server && python3 -m pytest tests -q exit 0 (use the python whose version >= 3.11 if the
  system one is 3.9: /opt/homebrew/bin/python3).
- CHANGELOG under ## [Unreleased]. Commit only own files with the trailer:
  Developed by Wojciech Wiesner wojciech@theones.io -= join.theones.io =- be The One Who Is Many -
- Sentinel: .planning/orchestration/waves/clean-1107/<TASK>.done with DONE <0|1>, SHA, gate output.

## Orchestrator (Hermes)
Merge W2 then W1, full gates, deploy, run clean_archive --dry-run then --apply on prod (backup first),
re-run the steady-tone scan on the same 320 segments (target: < 5% with a steady tone), browser check
that pill play keeps the radio playing, report.
