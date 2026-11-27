import { describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT, SHAKE_COOLDOWN_MS, ShakeDetector, parseRecent, pickShuffleStation, pushRecent,
} from '../src/ui/shuffleLogic';

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
const sweep = (): number[] => Array.from({ length: 100 }, (_, i) => i / 100);

describe('pickShuffleStation', () => {
  it('never returns the current station', () => {
    for (const r of sweep()) expect(pickShuffleStation(ids(8), 's3', [], () => r)?.id).not.toBe('s3');
  });
  it('avoids the recent picks while fresh stations exist', () => {
    const recent = ['s1', 's2', 's4', 's5', 's6'];
    for (const r of sweep()) {
      const id = pickShuffleStation(ids(10), 's0', recent, () => r)!.id;
      expect(recent).not.toContain(id);
      expect(id).not.toBe('s0');
    }
  });
  it('falls back to recent stations (still not current) when nothing else is left', () => {
    for (const r of sweep()) {
      const id = pickShuffleStation(ids(4), 's0', ['s1', 's2', 's3'], () => r)!.id;
      expect(['s1', 's2', 's3']).toContain(id);
    }
  });
  it('prefers the oldest recent pick in the fallback', () => {
    const counts: Record<string, number> = { s1: 0, s2: 0, s3: 0 };
    for (const r of sweep()) counts[pickShuffleStation(ids(4), 's0', ['s1', 's2', 's3'], () => r)!.id] += 1;
    expect(counts.s3).toBeGreaterThan(counts.s1);
  });
  it('returns null when only the current station exists', () => {
    expect(pickShuffleStation(ids(1), 's0', [])).toBeNull();
  });
});

describe('recent memory', () => {
  it('keeps newest first, unique, capped', () => {
    let list: string[] = [];
    for (let i = 0; i < 8; i += 1) list = pushRecent(list, `s${i}`);
    list = pushRecent(list, 's6');
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toBe('s6');
    expect(new Set(list).size).toBe(list.length);
  });
  it('parses bad storage safely', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{oops')).toEqual([]);
    expect(parseRecent('["a",1,"b"]')).toEqual(['a', 'b']);
  });
});

describe('ShakeDetector', () => {
  const calm = (d: ShakeDetector, t: number) => d.feed(0, 0, 9.8, t);
  it('ignores a single peak', () => {
    const d = new ShakeDetector();
    calm(d, 0);
    expect(d.feed(25, 0, 9.8, 50)).toBe(false);
    expect(calm(d, 100)).toBe(false);
  });
  it('triggers on two peaks within 600 ms', () => {
    const d = new ShakeDetector();
    calm(d, 0);
    expect(d.feed(25, 0, 9.8, 50)).toBe(false);
    expect(d.feed(-25, 0, 9.8, 150)).toBe(true);
  });
  it('does not count two peaks that are too far apart', () => {
    const d = new ShakeDetector();
    calm(d, 0);
    d.feed(25, 0, 9.8, 50);
    calm(d, 200);
    expect(d.feed(25, 0, 9.8, 900)).toBe(false);
  });
  it('does not double count one jolt spread over adjacent samples', () => {
    const d = new ShakeDetector();
    calm(d, 0);
    expect(d.feed(25, 0, 9.8, 50)).toBe(false);
    expect(d.feed(-5, 0, 9.8, 70)).toBe(false);
  });
  it('respects the cooldown', () => {
    const d = new ShakeDetector();
    calm(d, 0);
    d.feed(25, 0, 9.8, 50);
    expect(d.feed(-25, 0, 9.8, 150)).toBe(true);
    calm(d, 200);
    d.feed(25, 0, 9.8, 300);
    expect(d.feed(-25, 0, 9.8, 400)).toBe(false);
    const later = 150 + SHAKE_COOLDOWN_MS + 100;
    calm(d, later);
    d.feed(25, 0, 9.8, later + 50);
    expect(d.feed(-25, 0, 9.8, later + 150)).toBe(true);
  });
});
