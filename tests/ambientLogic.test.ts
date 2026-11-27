import { describe, expect, it } from 'vitest';
import {
  AudioFeatures, GROUP_SCENE, HostPresence, IDLE_PAUSE_MS, SCENE_CROSSFADE_S, analyzeSpectrum, canvasSize,
  needsFrames, oneHot, renderScale, sceneForStation, stepSceneWeights, voiceFromRms, weightsSettled,
} from '../src/ui/ambientLogic';
import { MUSIC_GROUPS } from '../src/radio/stations';

describe('group -> scene mapping', () => {
  it('maps every music group to one of the four scenes as specified', () => {
    expect(MUSIC_GROUPS.every((g) => g.id in GROUP_SCENE)).toBe(true);
    expect(GROUP_SCENE['klasyka-instrumentalna']).toBe('nature');
    expect(GROUP_SCENE['etno-folk']).toBe('nature');
    expect(GROUP_SCENE['synth-filmowa']).toBe('nature');
    expect(GROUP_SCENE['klub-energia']).toBe('techno');
    expect(GROUP_SCENE['techno-rave']).toBe('techno');
    expect(GROUP_SCENE['chill-noc']).toBe('night');
    expect(GROUP_SCENE['fokus-puls']).toBe('focus');
    expect(GROUP_SCENE['przestrzenie-b2b']).toBe('focus');
  });

  it('falls back by name, then by BPM, for unknown groups', () => {
    expect(sceneForStation({ name: 'X', bpm: 130 }, 'nowa-grupa')).toBe('techno');
    expect(sceneForStation({ name: 'Nocny jazz', bpm: 80 }, 'inna')).toBe('night');
    expect(sceneForStation({ name: 'Zzz', bpm: 90 }, null)).toBe('focus');
    expect(sceneForStation({ name: 'Zzz', bpm: 120, group: 'chill-noc' }, null)).toBe('night');
  });
});

describe('scene crossfade', () => {
  it('takes about 2.5 s, never cuts, and always sums to 1', () => {
    let w = oneHot('nature');
    w = stepSceneWeights(w, 'techno', 0.016);
    expect(w[0]).toBeGreaterThan(0.9);
    expect(w[1]).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) w = stepSceneWeights(w, 'techno', 0.016);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(weightsSettled(w, 'techno')).toBe(false);
    for (let t = 1.6; t < SCENE_CROSSFADE_S + 0.1; t += 0.016) w = stepSceneWeights(w, 'techno', 0.016);
    expect(weightsSettled(w, 'techno')).toBe(true);
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
