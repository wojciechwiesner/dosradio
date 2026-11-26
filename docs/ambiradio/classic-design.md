# AmbiRadio Classic — design rationale & tokens

**Brand:** AmbiRadio — Ambitnie dla Ciebie · **Scope:** `index.html`, `src/ui/dosradio.css`, `src/ui/pill.css`,
injected styles in `billing.ts`, `dedicationModal.ts`, `socialCreatorStudio.ts`.
Screenshots: `docs/ambiradio/shots/ambi-classic-redesign/`.

## Rationale

- **Raw and typographic.** No gradients, no glow, no rounded cards. Structure comes from type size, hairline rules
  and an 8px grid. Corners are square (`--radius: 0`). Only status dots are round.
- **One accent.** Signal lime `#d4ff3a` marks only what is live or chosen: Play, the active station, the
  on-air dot, pressed toggles, focus rings and primary buttons. Everything else is graphite and off-white.
  Group colours stay only as 8px dots (data, not decoration).
- **One obvious action.** Play is an 88px accent square, the largest control on the page, next to the
  station name set in display type. The level meter beside it has a fixed height, and the status and
  upcoming lines reserve their own line height, so nothing moves while audio loads (measured: player height
  is identical in the idle and loading states).
- **Reading order = priority.** 1. What's on air (station, host, Play, volume, status, what comes next).
  2. Radio actions (host mode, Auto-Ramówka, news now). 3. Share and Plus (dedication, Plus, share, friends,
  own radio, web podcast, favourite) as one consistent row of icon + label buttons.
  Then the numbered sections: 01 Stacje · 02 Na antenie dziś (quiet timeline) · 03 Twój nastrój ·
  04 Twoja ramówka (topics + interval + weather, moved out of the side card) · 05 Twoje źródła (Plus).
- **Station switcher as a list.** Group tabs with an underline indicator, then each group as a dense
  ruled table of `name … 122 BPM` rows (56px tall). The active row is filled with the accent; a Shift-click
  blend gets an accent edge and a "+ miks" suffix.
- **Ramówka as a timeline.** "Na antenie dziś" is a vertical rule with dots: the airing story has an accent
  dot and accent title, aired ones fade to 50%.
- **Keyboard first.** `Space` = play/pause, `←`/`→` = previous/next visible station
  (`src/ui/keyboard.ts`, tested in `tests/classicKeyboard.test.ts`). Shortcuts stay out of form fields,
  dialogs and Orbita. Space on a focused button keeps its native meaning. There is a skip link, and every
  control shows a 2px accent `:focus-visible` ring.
- **Touch & small screens.** Every interactive element is at least 44×44px (checked automatically at
  1440, 390 and 360px). At 360px there is no horizontal overflow; the actions become a 2-column grid and the
  group tabs scroll sideways.
- **Motion.** Only the live dot pulse, the Play "loading" breathe and a 160ms modal fade. Under
  `prefers-reduced-motion` all animation stops and the level meter holds as a flat line.

## Tokens

### Colour

| Token | Value | Use | Contrast on `--bg` |
|---|---|---|---|
| `--bg` | `#0b0b0c` | page (obsidian) | — |
| `--bg-2` | `#131315` | inputs, dialogs | — |
| `--bg-3` | `#1b1b1e` | hover / pressed | — |
| `--panel` | `#111113` | on-air column | — |
| `--line` | `#2a2a2e` | hairlines | — |
| `--line-strong` | `#45454b` | control borders | 2.1:1 (non-text UI boundary, paired with label text) |
| `--text` | `#f4f4ef` | primary text | 18.3:1 |
| `--dim` | `#a8a8a2` | secondary text | 8.3:1 |
| `--faint` | `#8d8d87` | labels, meta | 5.9:1 |
| `--accent` | `#d4ff3a` | the only accent | 17:1 (text on accent: `--on-accent` `#0b0b0c`) |
| `--danger` | `#ff8a7a` | errors only | 8.4:1 |

`--accent-2`, `--live` and `--ok` are aliases of `--accent`, kept so older modules still resolve.

### Type

- Display / UI: **Space Grotesk** 400/500/700 (Google Fonts, `display=swap`).
- Labels, numbers, status lines: **JetBrains Mono** 400/500/700, with tabular numerals for clock, BPM and countdowns.
- Scale (px): 12 · 14 · 16 · 20 · 24 · 32 · display `clamp(40px, 6.4vw, 88px)`
  (mobile: section titles 24, display `clamp(36px, 11vw, 48px)`).
- Eyebrows and section numbers: mono 12px, uppercase, +0.1em tracking.

### Space (8px grid)

`--s-1` 8 · `--s-2` 16 · `--s-3` 24 · `--s-4` 32 · `--s-5` 40 · `--s-6` 48 · `--s-8` 64 · `--s-10` 80.
4px is used only for hairline nudges (icon gaps, kbd spacing). `--tap` = 44px minimum touch target.
Max content width 1200px; page padding 32px (desktop) / 16px (≤640px).

## Hooks kept

All 77 element ids from the previous `index.html` are still present (8 new: `main`, `plusSlot`,
`stationsSection`, section heading ids). Class hooks used by TS (`.mood-chip`, `.settings`, `.top-actions`,
`.station`, `.music-group-*`, `.news`, `.chip`, `.modal.open`, …) are unchanged. `localStorage` keys and
`/radio-api` paths are untouched. No audio/engine code changed.

## Known gaps

- "Comment" (listener comments on air, W7) has no UI yet: there is no backend for it. When it lands, it
  belongs in the share/Plus action row as a 44px icon + label button.
- Rebranding of strings that this job did not touch (engine metadata, jingle label, PWA manifest,
  social share texts) is left to W3.
