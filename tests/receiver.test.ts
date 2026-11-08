import { describe, expect, it } from 'vitest';
import { dialPositions, knobAngle } from '../src/ui/receiver';
import { STATIONS } from '../src/radio/stations';

describe('receiver dial', () => {
  it('puts every preset station on exactly one band, inside the scale', () => {
    const positions = dialPositions();
    expect(positions.size).toBe(STATIONS.length);
    for (const { x } of positions.values()) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('spreads stations of one band evenly and keeps their order', () => {
    const fokus = [...dialPositions().entries()].filter(([, p]) => p.band === 'fokus').map(([, p]) => p.x);
    expect(fokus).toEqual([1 / 6, 3 / 6, 5 / 6]);
  });

  it('turns knobs over a 270 degree sweep and clamps out of range values', () => {
    expect(knobAngle(0)).toBe(-135);
    expect(knobAngle(1)).toBe(135);
    expect(knobAngle(0.5)).toBe(0);
    expect(knobAngle(2)).toBe(135);
    expect(knobAngle(-1)).toBe(-135);
  });
});
