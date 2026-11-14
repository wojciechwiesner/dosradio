/* Time-of-day palette and per-station symmetry for the Orbita background. Pure functions, no DOM, covered by tests/orbitaTod.test.ts. */

/* sRGB 0..1. `line` draws the interference contours, `accent` the kick ring and UI accent, `bg` the void. */
export const TOD_KEYS = [
  { h: 0,    line: [0.35, 0.42, 0.95], accent: [0.55, 0.35, 1.00], bg: [0.015, 0.018, 0.050] }, // deep night
  { h: 4.5,  line: [0.45, 0.40, 0.85], accent: [0.85, 0.45, 0.75], bg: [0.030, 0.020, 0.060] }, // before dawn
  { h: 7.5,  line: [1.00, 0.66, 0.55], accent: [1.00, 0.42, 0.35], bg: [0.070, 0.035, 0.045] }, // dawn
  { h: 12,   line: [0.80, 0.92, 1.00], accent: [0.35, 0.85, 0.95], bg: [0.030, 0.050, 0.070] }, // day
  { h: 17,   line: [1.00, 0.82, 0.50], accent: [1.00, 0.55, 0.20], bg: [0.060, 0.040, 0.025] }, // golden hour
  { h: 20,   line: [0.95, 0.45, 0.75], accent: [0.60, 0.35, 1.00], bg: [0.050, 0.020, 0.050] }, // dusk
];

const smooth = x => x * x * (3 - 2 * x);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Palette for a local hour (fractional, any real number: wraps around midnight). */
export function todPalette(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = TOD_KEYS.length - 1;
  while (i > 0 && TOD_KEYS[i].h > h) i--;
  const a = TOD_KEYS[i], b = TOD_KEYS[(i + 1) % TOD_KEYS.length];
  const span = ((b.h - a.h) + 24) % 24 || 24, t = smooth(((h - a.h + 24) % 24) / span);
  return { line: mix3(a.line, b.line, t), accent: mix3(a.accent, b.accent, t), bg: mix3(a.bg, b.bg, t) };
}

/** Angular order (3..8) of the interference pattern for the station at dial index i; neighbours never match. */
export const stationSymmetry = i => ((i * 5 + 2) % 6) + 3;
