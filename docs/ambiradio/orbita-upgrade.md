# Orbita — SOTA upgrade (W5)

Branch `ow/ambi-orbita-sota`. Scope: the immersive Orbita page only (`orbita/src/*` → `public/orbita.html`).
No backend endpoints changed. Shared `localStorage` keys (`dosradio.*`) and API paths (`/radio-api`, `/radio-ws`) unchanged.

## What changed

### Scene and performance (`orbita/src/scene.js`, `orbita/src/reactive.js`, `orbita/src/main.js`)
- **Adaptive quality tiers** `low / medium / high / ultra` (dpr 1 / 1.25 / 1.6 / 2). **dpr is capped at 2** (it was a fixed
  1.75 with only a one-way step down). The start tier depends on the device: cores, memory, coarse pointer, width,
  reduced motion and the screen's own dpr. A frame-time governor measures 2 s windows on the *real* frame time.
  A window slower than 18.5 ms average steps down at once. Three windows under 17.2 ms step back up, but never into a
  tier that was already too slow, so it cannot oscillate. The first window is ignored because of shader compilation.
  Lower tiers turn off bloom, cut warp streaks to 60 % or 35 %, run the fluid at half rate (low), and drop CSS
  `backdrop-filter` (below).
- **Render loop stops while the tab is hidden** (`visibilitychange`). It restarts on return with a fresh timer, so
  there is no dt spike, and the governor's timing is reset.
- **Audio-reactive from the real Web Audio analyser.** `AudioCore.analyse()` already split the music bus into
  low/mid/high. A new band follower (`createBandFollower`) adds auto-gain per band (running peak with slow decay), so
  quiet streams still move the scene; attack 60 ms / release 350 ms; and a slew cap of 4 units/s, so nothing can
  strobe. Mapping:
  bass → speaker cone pump, field line brightness, bloom (+0.12 max);
  mid → interference-field wave number, speaker ripple energy;
  high → fine sparkle on the field lines, warp-streak speed and brightness, a touch of edge aberration.
  Kick pulses now only nudge bloom (+0.1) and aberration (+0.35). Before, they were +0.35 and +1.6.
- **Colour grade per station category** in the existing final pass (no extra pass). Shadow and highlight tints,
  saturation and contrast for `fokus` (cool violet), `chill` (teal), `energia` (warm, punchier), `noc` (deep blue,
  desaturated). It blends over ~1 s on station change.
- **Post-processing kept cheap.** No new passes. Base chromatic aberration 1.1 → 0.45, film grain 0.03 → 0.02,
  bloom 0.85 → 0.7 base strength.
- **No motion sickness.** The camera follows the pointer with half the parallax and a slower lerp, and its speed is
  hard-capped at 1.2 world units/s. Seek zoom is reduced. The friend-halo pulse is slower (2.5 rad/s) and shallower.
- **Calm view** = `prefers-reduced-motion` or the `M` key / wave button in the header. It is stored in the new key
  `dosradio.orbita.calm.v1`. In calm view: the camera is fixed, there are no streaks, no pointer fluid, no kick
  pulses and no aberration; the field phase is nearly frozen; the dial jumps instead of swinging; CSS animations
  stop; and the scene renders at 30 fps when nothing moves. The governor does not sample in calm view, because
  30 fps is deliberate there.

### HUD, typography, accessibility (`orbita/src/index.frag.html`, `main.js`, `i18n.js`)
- **Core actions as in Classic**, all with SVG icons and `aria-keyshortcuts`: play/pause (`P`), station prev/next
  (`←`/`→`), news now (`N`), **share with dedication** (`S`), **comment** (`C`), **Plus** (`+`). There is also a
  calm toggle (`M`). `Ctrl+K` moved to the bottom-right HUD. On phones the share/comment/Plus row shows icons only,
  with visually hidden labels, so the card stays as short as before and does not cover the thumb dial.
- **Comment:** the backend has no listener-comment endpoint yet (that is W7), and this job must not add endpoints.
  So "Komentarz" opens the share sheet focused on the greeting field. The host reads that text on air when the
  recipient opens the link (`POST /radio-api/social/drops`, unchanged).
- **Captions:** a proportional reading face (system UI) instead of monospace, 16–20 px, line height 1.5, a solid
  86 % backdrop with an accent rule, a speaker chip, max 52ch and 3 lines. On phones they sit above the thumb dial.
- **Now-playing line** at the bottom centre on desktop ≥1100 px ("TERAZ GRA · station · prowadzi host"). It fades
  out while captions are on screen.
- **Mobile header fixed:** the brand no longer overlaps the install button and language switch. The install button
  and free-hour pill are compact on phones.
- **Brand:** every user-facing Orbita string now says AmbiRadio. The header and enter screen show the tagline
  "AmbiRadio — Ambitnie dla Ciebie" (EN "Ambitious, for you", RU "Амбициозно для тебя"). The help modal lists the
  new shortcuts in PL/EN/RU.

## Measurements

Tool: `scripts/orbita-perf.mjs`. It runs headless Chromium 155 through Playwright and loads
`/orbita.html?embed=1#pl` from `npx vite --port 5202`, with the demo synth playing (audio muted, autoplay allowed).
After a 4 s warm-up it records `requestAnimationFrame` intervals for 10 s (8 s for "before"). Viewports: 1440x900 at
device scale 2 and 390x844 at device scale 3. `/radio-api` is blocked so Orbita runs its built-in demo; otherwise a
local backend's trial state can change what is measured.

The machine is shared with other workers (load average 4–5 during the runs), so numbers vary by a few fps from run
to run. Ranges are given where runs differed.

### Real GPU — `--mode gpu` (`--enable-gpu --use-angle=vulkan`)
Renderer: `ANGLE (Intel, Vulkan 1.4.354 (Intel(R) UHD Graphics 630 (CFL GT2)), Intel open-source Mesa driver)`.

| Run | Viewport | fps | median frame | p95 frame | worst | tier / dpr |
|---|---|---|---|---|---|---|
| before (`018ee86`) | 1440x900 | 48.3 | 16.7 ms | 33.4 ms | 66.7 ms | fixed dpr 1.75 |
| before | 390x844 | 60.1 | 16.7 ms | 16.8 ms | 16.8 ms | fixed dpr 1.75 |
| after | 1440x900 | 56.4–60.2 | 16.7 ms | 16.7–33.3 ms | 16.8–50 ms | medium 1.25 (one run: low 1.0) |
| after | 390x844 | 60.1 | 16.7 ms | 16.7 ms | 16.8 ms | ultra 2.0 |
| after, reduced motion | 1440x900 | 59.3–60.0 | 16.7 ms | 16.8 ms | 33.3 ms | scene at 30 fps by design |
| after, reduced motion | 390x844 | 59.9–60.1 | 16.7 ms | 16.7 ms | 16.8 ms | scene at 30 fps by design |

The fps column counts browser frames (rAF). In calm view the scene itself redraws every second frame.

Experiment (same build, tier "high", 1440x900): turning off CSS `backdrop-filter` raised fps from 45.1 to 53.5. The
blur over a live WebGL canvas is recomputed every frame. That is why panels go solid below the ultra tier.

### Software rendering — `--mode software` (`--use-angle=swiftshader`)
Renderer: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`.

| Run | Viewport | fps | median frame | tier |
|---|---|---|---|---|
| before | 1440x900 | 1.0 | 1317 ms | fixed dpr 1.75 |
| before | 390x844 | 3.4 | 300 ms | fixed dpr 1.75 |
| after | 1440x900 | 3.9–4.5 | 217–267 ms | low 1.0 |
| after | 390x844 | 10.1–10.9 | 83–100 ms | low 1.0 |

SwiftShader stands in for the weakest devices. The governor reaches "low" there; with the old code it never
adapted, because it was fed the animation dt, which is clamped to 50 ms.

Re-run:
```
npm run build:orbita && npx vite --port 5202 &
PLAYWRIGHT=/path/to/node_modules/playwright-core/index.mjs CHROMIUM=/usr/bin/chromium \
  node scripts/orbita-perf.mjs --mode gpu --seconds 10 --shots docs/ambiradio/shots/ambi-orbita-sota [--reduced]
```

## Screenshots
`docs/ambiradio/shots/ambi-orbita-sota/`: `orbita-1440x900.png`, `orbita-390x844.png`, the same with `-caption`
(host speaking) and `-reduced` / `-reduced-caption` (calm view).

## Tests
- `tests/orbitaReactive.test.ts`: band follower auto-gain, slew cap and release; dpr cap; start tiers; governor
  hysteresis and warm-up; grades.
- `tests/orbitaCalmScene.test.ts` (real `scene.js` under the jsdom harness): camera still in calm view, camera
  speed cap otherwise, no aberration in calm view, tier reported with dpr ≤ 2, calm 30 fps not taken for a slow GPU,
  and a 1 fps device steps down.
- The existing `tests/orbita*.test.ts` pass unchanged.

## Known gaps
- Listener comments go through the greeting-on-a-shared-link flow until W7 adds a real on-air comment endpoint.
- The governor locks out tiers that were slow once in a session, so a single long hiccup (another heavy tab) keeps
  the scene one tier lower until reload. This is intentional to avoid oscillation.
- Not measured on real phones. The mobile rows above are the 390x844 viewport on a desktop iGPU.
- `npm run build` needs `@types/node`, which is not in `package.json` (a pre-existing gap, not touched here; it was
  verified with `npm i --no-save @types/node@20`).
