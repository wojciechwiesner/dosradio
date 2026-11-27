import { describe, expect, it } from 'vitest';
import {
  AudioFeatures, GROUP_SCENE, HostPresence, IDLE_PAUSE_MS, SCENE_CROSSFADE_S, SCENE_ORDER, STATION_SCENE,
  SECTION_COOLDOWN_S, SceneFader, SectionDetector, analyzeSpectrum, canvasSize, needsFrames, nextVariant,
  renderScale, sceneForStation, variantForStation, voiceFromRms,
} from '../src/ui/ambientLogic';
import { FRAGMENT_SRC } from '../src/ui/ambientGL.glsl';
import { MUSIC_GROUPS, STATIONS } from '../src/radio/stations';

describe('station -> scene mapping', () => {
  it('maps every music group to a known scene', () => {
    expect(MUSIC_GROUPS.every((g) => g.id in GROUP_SCENE)).toBe(true);
    expect(Object.values(GROUP_SCENE).every((s) => SCENE_ORDER.includes(s))).toBe(true);
  });

  it('gives every preset station a valid scene and spreads them over at least 12 of the 14 moods', () => {
    const used = new Set(STATIONS.map((st) => sceneForStation(st, st.group ?? null)));
    for (const s of used) expect(SCENE_ORDER).toContain(s);
    expect(SCENE_ORDER.length).toBe(14);
    expect(used.size).toBeGreaterThanOrEqual(12);
    expect(Object.values(STATION_SCENE).every((s) => SCENE_ORDER.includes(s))).toBe(true);
  });

  it('every scene id has a branch in the shader', () => {
    for (const id of SCENE_ORDER) expect(FRAGMENT_SRC).toMatch(new RegExp(`vec3 ${id}\\(vec2 uv,float v\\)`));
    expect(FRAGMENT_SRC).toMatch(new RegExp(`if\\(id<${SCENE_ORDER.length - 1.5}\\)`));
  });

  it('falls back by name, then by group, then by BPM, for custom stations', () => {
    expect(sceneForStation({ name: 'X', bpm: 130 }, 'nowa-grupa')).toBe('techno');
    expect(sceneForStation({ name: 'Nocny jazz', bpm: 80 }, 'inna')).toBe('smoke');
    expect(sceneForStation({ name: 'Zzz', bpm: 90 }, null)).toBe('focus');
    expect(sceneForStation({ name: 'Zzz', bpm: 120, group: 'chill-noc' }, null)).toBe('night');
    expect(sceneForStation({ id: 'warm-jazz', name: 'Warm Jazz', bpm: 90 }, null)).toBe('smoke');
  });

  it('gives each station a stable variant, and the next variant is far from the last', () => {
    expect(variantForStation('hypnotic-techno')).toBe(variantForStation('hypnotic-techno'));
    expect(variantForStation('hypnotic-techno')).not.toBe(variantForStation('berlin-bcco-techno'));
    const v = variantForStation('dub-techno');
    const d = Math.abs(nextVariant(v) - v);
    expect(Math.min(d, 1 - d)).toBeGreaterThan(0.3);
  });
});

describe('scene crossfade', () => {
  const step = (f: SceneFader, s: number): void => { for (let t = 0; t < s; t += 0.016) f.update(0.016); };

  it('fades over ~3 s with an eased mix, never cuts', () => {
    const f = new SceneFader({ scene: 'nature', variant: 0.2 });
    f.set({ scene: 'techno', variant: 0.5 });
    f.update(0.016);
    expect(f.from.scene).toBe('nature');
    expect(f.to.scene).toBe('techno');
    expect(f.mix).toBeGreaterThan(0);
    expect(f.mix).toBeLessThan(0.01);
    step(f, SCENE_CROSSFADE_S / 2 - 0.05);
    expect(f.mix).toBeGreaterThan(0.4);
    expect(f.mix).toBeLessThan(0.6);
    expect(f.settled).toBe(false);
    step(f, SCENE_CROSSFADE_S / 2 + 0.1);
    expect(f.mix).toBe(1);
    expect(f.settled).toBe(true);
  });

  it('a change during a fade waits for it to land, then fades again (no pop)', () => {
    const f = new SceneFader({ scene: 'nature', variant: 0 });
    f.set({ scene: 'techno', variant: 0 });
    step(f, 1);
    const mid = f.mix;
    f.set({ scene: 'ocean', variant: 0.3 });
    expect(f.to.scene).toBe('techno');
    expect(f.mix).toBe(mid);
    expect(f.target.scene).toBe('ocean');
    step(f, SCENE_CROSSFADE_S);
    expect(f.from.scene).toBe('techno');
    expect(f.to.scene).toBe('ocean');
    step(f, SCENE_CROSSFADE_S + 0.1);
    expect(f.settled).toBe(true);
  });

  it('the same mood with a new variant also fades; an identical key is ignored', () => {
    const f = new SceneFader({ scene: 'laser', variant: 0.1 });
    f.set({ scene: 'laser', variant: 0.1 });
    expect(f.settled).toBe(true);
    f.set({ scene: 'laser', variant: 0.6 });
    expect(f.settled).toBe(false);
    f.snap();
    expect(f.to.variant).toBe(0.6);
    expect(f.mix).toBe(1);
  });
});

describe('musical section changes', () => {
  const run = (d: SectionDetector, frame: { bass: number; level: number }, s: number): number => {
    let hits = 0;
    for (let t = 0; t < s; t += 0.05) if (d.update(frame, 0.05)) hits += 1;
    return hits;
  };

  it('steady music never triggers; a breakdown does, once, then cools down', () => {
    const d = new SectionDetector();
    expect(run(d, { bass: 0.8, level: 0.15 }, 40)).toBe(0);
    expect(run(d, { bass: 0.15, level: 0.05 }, 6)).toBe(1);
    expect(run(d, { bass: 0.8, level: 0.15 }, SECTION_COOLDOWN_S - 8)).toBe(0);
  });

  it('a short dip (under 1.5 s) is not a section change, and reset() starts over', () => {
    const d = new SectionDetector();
    run(d, { bass: 0.8, level: 0.15 }, 30);
    expect(run(d, { bass: 0.1, level: 0.02 }, 0.8)).toBe(0);
    d.reset();
    expect(run(d, { bass: 0.1, level: 0.02 }, 6)).toBe(0); // warm-up after reset
  });
});

describe('spectrum features', () => {
  const spectrum = (bass: number, rest: number): Uint8Array => {
    const a = new Uint8Array(256).fill(rest);
    a.fill(bass, 0, 3);
    return a;
  };

  it('extracts bass from the low bins and level from all bins', () => {
    const f = analyzeSpectrum(spectrum(255, 0));
    expect(f.bass).toBe(1);
    expect(f.level).toBeCloseTo(3 / 256, 5);
    expect(analyzeSpectrum(new Uint8Array(0))).toEqual({ bass: 0, level: 0 });
    expect(analyzeSpectrum(spectrum(0, 255)).bass).toBe(0);
  });

  it('fires a kick on a bass jump and not on steady bass', () => {
    const feats = new AudioFeatures();
    let frame = feats.update(spectrum(40, 20), 0, 0.016);
    for (let i = 0; i < 200; i++) frame = feats.update(spectrum(200, 20), 0, 0.016);
    expect(frame.kick).toBeLessThan(0.2);
    frame = feats.update(spectrum(255, 20), 0, 0.016);
    const quiet = new AudioFeatures();
    for (let i = 0; i < 200; i++) quiet.update(spectrum(40, 20), 0, 0.016);
    expect(quiet.update(spectrum(255, 20), 0, 0.016).kick).toBeGreaterThan(0.5);
  });

  it('scales voice RMS into 0..1 and smooths it', () => {
    expect(voiceFromRms(0)).toBe(0);
    expect(voiceFromRms(0.1)).toBeCloseTo(0.4, 5);
    expect(voiceFromRms(5)).toBe(1);
    const feats = new AudioFeatures();
    const loud = feats.update(spectrum(0, 0), 0.2, 0.016).voice;
    const after = feats.update(spectrum(0, 0), 0, 0.016).voice;
    expect(loud).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(loud);
  });
});

describe('host presence state machine', () => {
  it('fades in over 0.6 s and out over 1.2 s', () => {
    const h = new HostPresence();
    h.setSpeaking(true, 'host');
    h.update(0.3);
    expect(h.presence).toBeCloseTo(0.5, 5);
    h.update(0.3);
    expect(h.presence).toBe(1);
    h.setSpeaking(false, null);
    h.update(0.6);
    expect(h.presence).toBeCloseTo(0.5, 5);
    h.update(0.6);
    expect(h.presence).toBe(0);
    expect(h.settled).toBe(true);
  });

  it('shows the silhouette for news, only a shimmer for a jingle', () => {
    const news = new HostPresence();
    news.setSpeaking(true, 'news');
    news.update(1);
    expect(news.presence).toBe(1);
    const jingle = new HostPresence();
    jingle.setSpeaking(true, 'jingle');
    jingle.update(0.3);
    expect(jingle.presence).toBe(0);
    expect(jingle.shimmer).toBeGreaterThan(0);
    jingle.update(2);
    expect(jingle.shimmer).toBe(0);
  });

  it('snaps to the end state for reduced motion', () => {
    const h = new HostPresence();
    h.setSpeaking(true, 'host');
    h.snap();
    expect(h.presence).toBe(1);
  });
});

describe('performance gates', () => {
  it('renders at 0.6x on mobile or coarse pointers and 0.75x on desktop', () => {
    expect(renderScale(390, false)).toBe(0.6);
    expect(renderScale(820, false)).toBe(0.6);
    expect(renderScale(1440, true)).toBe(0.6);
    expect(renderScale(1440, false)).toBe(0.75);
    expect(canvasSize(1440, 900, 2, 0.75)).toEqual({ w: 2160, h: 1350 });
    expect(canvasSize(1440, 900, 3, 0.75)).toEqual({ w: 2160, h: 1350 });
  });

  it('pauses when hidden, reduced-motion, or idle for more than 3 s', () => {
    const base = { hidden: false, reduced: false, playing: false, idleMs: 0, transitioning: false };
    expect(needsFrames({ ...base, playing: true })).toBe(true);
    expect(needsFrames({ ...base, idleMs: IDLE_PAUSE_MS - 1 })).toBe(true);
    expect(needsFrames({ ...base, idleMs: IDLE_PAUSE_MS })).toBe(false);
    expect(needsFrames({ ...base, idleMs: IDLE_PAUSE_MS, transitioning: true })).toBe(true);
    expect(needsFrames({ ...base, playing: true, hidden: true })).toBe(false);
    expect(needsFrames({ ...base, playing: true, reduced: true })).toBe(false);
  });
});

describe('real-audio calibration (regression: kick barely registered on real techno)', () => {
  it('turns a measured techno kick swing (bass ~0.78 -> ~0.84) into a visible kick', () => {
    // REGRESSION INVARIANT: on the production master the bass bins sit around 0.8 and each kick
    // lifts them only ~0.05-0.1. The visualizer must still read that as a clear kick (> 0.4).
    const feats = new AudioFeatures();
    const steady = new Uint8Array(256).fill(30);
    steady.fill(Math.round(0.78 * 255), 0, 3);
    for (let i = 0; i < 120; i++) feats.update(steady, 0, 0.016);
    const hit = new Uint8Array(256).fill(30);
    hit.fill(Math.round(0.84 * 255), 0, 3);
    expect(feats.update(hit, 0, 0.016).kick).toBeGreaterThan(0.4);
  });

  it('keeps analyser headroom so the byte spectrum does not saturate', async () => {
    const src = (await import('node:fs')).readFileSync('src/radio/publicRadioEngine.ts', 'utf8');
    expect(src).toMatch(/analyser\.maxDecibels = -10;/);
    expect(src).toMatch(/analyser\.minDecibels = -90;/);
  });
});
