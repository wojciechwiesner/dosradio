/* Pure helpers for the Orbita scene (no three.js, no DOM): audio band follower, adaptive quality governor,
   per-category colour grade. Kept separate so they are unit-testable and so scene.js stays about drawing. */

/* ---------- audio bands -> visuals ----------
   Raw analyser bands jump frame to frame. Visuals get:
   - attack/release envelopes (fast-ish rise, slow fall), so nothing strobes,
   - a slow auto-gain per band (running peak with decay), so a quiet stream still moves the scene and a loud one
     does not saturate it,
   - a hard cap on how fast the normalised value may change per second (no flashing: < 3 big swings per second). */
export function createBandFollower({ attack = 0.06, release = 0.35, peakDecay = 0.25, floor = 0.08, maxSlew = 4 } = {}) {
  const st = { bass: 0, mid: 0, high: 0, level: 0 }, peak = { bass: floor, mid: floor, high: floor };
  const follow = (cur, target, dt) => {
    const tau = target > cur ? attack : release;
    return cur + (target - cur) * (1 - Math.exp(-dt / tau));
  };
  return {
    state: st,
    /* raw: { low, mid, high } in 0..1 straight from the analyser (already smoothed a little by audio.js) */
    update(raw, dt, playing = true) {
      dt = Math.max(1 / 240, Math.min(dt, 0.1));
      const src = playing ? { bass: raw.low || 0, mid: raw.mid || 0, high: raw.high || 0 } : { bass: 0, mid: 0, high: 0 };
      for (const k of ['bass', 'mid', 'high']) {
        peak[k] = Math.max(src[k], floor, peak[k] * Math.exp(-dt * peakDecay));
        const norm = Math.min(1, src[k] / peak[k]);
        const next = follow(st[k], norm, dt), lim = maxSlew * dt;
        st[k] += Math.max(-lim, Math.min(lim, next - st[k]));
      }
      st.level = st.bass * 0.45 + st.mid * 0.4 + st.high * 0.15;
      return st;
    },
  };
}

/* ---------- adaptive quality ----------
   Tiers from cheapest to richest. dpr is capped at 2 everywhere (beyond that the GPU pays for pixels nobody sees).
   The governor watches the frame time over windows of `windowS` seconds: a slow window steps down at once,
   `upAfter` fast windows in a row step up again, but never back into a tier that was already too slow (so it does
   not oscillate). The first `warmup` windows are ignored: shader compilation makes them slow on every device. */
export const QUALITY_TIERS = [
  { name: 'low', dpr: 1, bloom: false, streaks: 0.35, fluid: false },
  { name: 'medium', dpr: 1.25, bloom: true, streaks: 0.6, fluid: true },
  { name: 'high', dpr: 1.6, bloom: true, streaks: 1, fluid: true },
  { name: 'ultra', dpr: 2, bloom: true, streaks: 1, fluid: true },
];
export const MAX_DPR = 2;

export function initialTier({ deviceDpr = 1, cores = 8, memory = 8, coarse = false, width = 1440, reduced = false } = {}) {
  let t = 3;
  if (coarse || width <= 760) t = 2;
  if (cores <= 4 || memory <= 4) t = Math.min(t, 1);
  if (cores <= 2 || memory <= 2) t = 0;
  if (reduced) t = Math.min(t, 1);
  // a 1x screen gains nothing from the ultra tier
  while (t > 0 && QUALITY_TIERS[t - 1].dpr >= Math.min(MAX_DPR, deviceDpr)) t--;
  return t;
}

export function createQualityGovernor({ tier = 3, deviceDpr = 1, budgetMs = 1000 / 58, slowMs = 1000 / 54, windowS = 2, upAfter = 3, warmup = 1 } = {}) {
  let acc = 0, n = 0, fast = 0, skip = warmup, maxTier = QUALITY_TIERS.length - 1;
  const g = {
    tier, lastAvgMs: 0,
    get current() { return QUALITY_TIERS[g.tier]; },
    dpr() { return Math.min(g.current.dpr, MAX_DPR, Math.max(1, deviceDpr)); },
    /* returns true when the tier changed */
    sample(dtS) {
      acc += dtS; n++;
      if (acc < windowS) return false;
      const avgMs = acc / n * 1000; acc = 0; n = 0; g.lastAvgMs = avgMs;
      if (skip > 0) { skip--; return false; }
      if (avgMs > slowMs && g.tier > 0) { maxTier = g.tier - 1; g.tier--; fast = 0; return true; }
      if (avgMs < budgetMs && g.tier < maxTier) { if (++fast >= upAfter) { g.tier++; fast = 0; return true; } }
      else fast = 0;
      return false;
    },
    reset() { acc = 0; n = 0; fast = 0; skip = Math.max(skip, 1); },
  };
  return g;
}

/* ---------- colour grade per station category ----------
   shadow/highlight tints (linear rgb multipliers around 1) and saturation, applied in the final pass.
   Subtle on purpose: the grade sets a mood, the music palette does the colour. */
export const GRADES = {
  fokus: { shadow: [0.92, 0.9, 1.12], highlight: [1.02, 1.0, 1.04], sat: 0.95, contrast: 1.04 },
  chill: { shadow: [0.88, 1.04, 1.06], highlight: [1.0, 1.03, 1.0], sat: 0.9, contrast: 0.98 },
  energia: { shadow: [1.08, 0.9, 0.98], highlight: [1.06, 1.0, 0.96], sat: 1.08, contrast: 1.08 },
  noc: { shadow: [0.86, 0.92, 1.16], highlight: [0.98, 0.98, 1.04], sat: 0.85, contrast: 1.0 },
};
export const DEFAULT_GRADE = { shadow: [1, 1, 1], highlight: [1, 1, 1], sat: 1, contrast: 1 };
export const gradeFor = cat => GRADES[cat] || DEFAULT_GRADE;

/* exponential approach of one grade to another, in place */
export function lerpGrade(cur, target, k) {
  for (const key of ['shadow', 'highlight']) for (let i = 0; i < 3; i++) cur[key][i] += (target[key][i] - cur[key][i]) * k;
  cur.sat += (target.sat - cur.sat) * k; cur.contrast += (target.contrast - cur.contrast) * k;
  return cur;
}
