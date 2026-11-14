import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS module shared with the Orbita bundle
import { todPalette, stationSymmetry, TOD_KEYS } from '../orbita/src/tod.js';

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('Orbita time-of-day palette', () => {
  it('returns line, accent and bg as 0..1 rgb triples for any hour', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const p = todPalette(h);
      for (const k of ['line', 'accent', 'bg'] as const) {
        expect(p[k]).toHaveLength(3);
        for (const c of p[k]) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
      }
    }
  });

  it('hits the keyframes exactly and differs between night, dawn, day and dusk', () => {
    for (const k of TOD_KEYS) expect(dist(todPalette(k.h).line, k.line)).toBeLessThan(1e-9);
    const lines = [3, 7.5, 13, 19].map(h => todPalette(h).line);
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) expect(dist(lines[i], lines[j])).toBeGreaterThan(0.15);
  });

  it('is continuous: no visible jump per minute, also across midnight', () => {
    let worst = 0;
    for (let m = 0; m < 24 * 60; m++) worst = Math.max(worst, dist(todPalette(m / 60).line, todPalette((m + 1) / 60).line));
    expect(worst).toBeLessThan(0.02);
    expect(dist(todPalette(23.999).line, todPalette(0).line)).toBeLessThan(0.01);
    expect(dist(todPalette(24).line, todPalette(0).line)).toBeLessThan(1e-9);
  });

  it('wraps hours outside 0..24', () => {
    expect(dist(todPalette(-1).line, todPalette(23).line)).toBeLessThan(1e-9);
    expect(dist(todPalette(25.5).line, todPalette(1.5).line)).toBeLessThan(1e-9);
  });
});

describe('Orbita station symmetry', () => {
  it('gives every station an integer angular order between 3 and 8', () => {
    for (let i = 0; i < 60; i++) { const n = stationSymmetry(i); expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(8); }
  });
  it('neighbouring stations on the dial do not share a symmetry', () => {
    for (let i = 0; i < 59; i++) expect(stationSymmetry(i)).not.toBe(stationSymmetry(i + 1));
  });
});
