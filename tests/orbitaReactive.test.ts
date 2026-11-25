import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module shared with the Orbita bundle
import { createBandFollower, createQualityGovernor, initialTier, QUALITY_TIERS, MAX_DPR, gradeFor, lerpGrade, DEFAULT_GRADE } from '../orbita/src/reactive.js';

describe('Orbita band follower (audio -> visuals)', () => {
  it('auto-gains a quiet stream so the scene still moves', () => {
    const b = createBandFollower();
    for (let i = 0; i < 600; i++) b.update({ low: 0.15, mid: 0.1, high: 0.05 }, 1 / 60);
    expect(b.state.bass).toBeGreaterThan(0.8);
    expect(b.state.mid).toBeGreaterThan(0.8);
  });

  it('never changes faster than the slew cap (no flashing on a hard kick)', () => {
    const b = createBandFollower({ maxSlew: 4 });
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      const before = b.state.bass;
      b.update({ low: i % 20 < 2 ? 1 : 0, mid: 0, high: 0 }, 1 / 60);
      worst = Math.max(worst, Math.abs(b.state.bass - before) * 60);
    }
    expect(worst).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('falls slower than it rises and goes quiet when playback stops', () => {
    const b = createBandFollower();
    for (let i = 0; i < 6; i++) b.update({ low: 1, mid: 1, high: 1 }, 1 / 60);
    const up = b.state.bass;
    b.update({ low: 0, mid: 0, high: 0 }, 1 / 60);
    expect(up - b.state.bass).toBeLessThan(up * 0.2);
    for (let i = 0; i < 300; i++) b.update({ low: 1, mid: 1, high: 1 }, 1 / 60, false);
    expect(b.state.level).toBeLessThan(0.01);
  });
});

describe('Orbita adaptive quality', () => {
  it('caps device pixel ratio at 2 on every tier', () => {
    for (const q of QUALITY_TIERS) expect(q.dpr).toBeLessThanOrEqual(MAX_DPR);
    const g = createQualityGovernor({ tier: 3, deviceDpr: 3 });
    expect(g.dpr()).toBe(2);
  });

  it('starts lower on phones, low-end and reduced-motion devices', () => {
    expect(initialTier({ deviceDpr: 2, cores: 8, memory: 8, width: 1440 })).toBe(3);
    expect(initialTier({ deviceDpr: 3, coarse: true, width: 390 })).toBe(2);
    expect(initialTier({ deviceDpr: 2, cores: 4, memory: 4 })).toBe(1);
    expect(initialTier({ deviceDpr: 2, cores: 2 })).toBe(0);
    expect(initialTier({ deviceDpr: 1 })).toBe(0); // 1x screen: no point rendering above 1x
  });

  it('steps down after a slow window and does not climb back into the slow tier', () => {
    const g = createQualityGovernor({ tier: 3, deviceDpr: 2, warmup: 0, windowS: 1, upAfter: 2 });
    const run = (ms: number, secs: number) => { let changed = false; for (let t = 0; t < secs * 1000; t += ms) changed = g.sample(ms / 1000) || changed; return changed; };
    expect(run(30, 1.05)).toBe(true);
    expect(g.current.name).toBe('high');
    run(10, 10);
    expect(g.current.name).toBe('high');
  });

  it('ignores the warm-up window (shader compilation)', () => {
    const g = createQualityGovernor({ tier: 3, deviceDpr: 2, warmup: 1, windowS: 1 });
    for (let t = 0; t < 1050; t += 40) g.sample(0.04);
    expect(g.current.name).toBe('ultra');
  });
});

describe('Orbita colour grade', () => {
  it('has a distinct grade per category and a neutral fallback', () => {
    expect(gradeFor('energia').sat).toBeGreaterThan(gradeFor('noc').sat);
    expect(gradeFor('unknown')).toEqual(DEFAULT_GRADE);
  });
  it('blends towards the target grade', () => {
    const g = structuredClone(DEFAULT_GRADE);
    for (let i = 0; i < 200; i++) lerpGrade(g, gradeFor('noc'), 0.1);
    expect(g.shadow[2]).toBeCloseTo(gradeFor('noc').shadow[2], 5);
  });
});
