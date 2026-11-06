import { describe, it, expect } from 'vitest';
import { runClips } from '../src/radio/breakRunner';
import { ProgrammeState } from '../src/radio/programmeState';
import { AiredStore } from '../src/radio/airedStore';
import { hourKey, type BreakClip, type BreakPlan } from '../src/radio/programme';

const clip = (role: BreakClip['role'], path: string, storyId?: string): BreakClip => ({ role, path, storyId });

describe('runClips', () => {
  it('plays loaded clips in order and skips missing ones', async () => {
    const heard: string[] = [];
    const played = await runClips(
      [clip('intro', 'i'), clip('headline', 'missing', 'x'), clip('story', 's', 'y')],
      { decode: async (path) => (path === 'missing' ? null : path), play: async (buffer) => { heard.push(buffer); }, now: () => 0 },
    );
    expect(heard).toEqual(['i', 's']);
    expect(played.map((item) => item.role)).toEqual(['intro', 'story']);
  });

  it('treats a rejecting decode (404) as a missing clip', async () => {
    const played = await runClips(
      [clip('intro', 'i'), clip('teaser', 'boom')],
      { decode: async (path) => { if (path === 'boom') throw new Error('404'); return path; }, play: async () => {}, now: () => 0 },
    );
    expect(played).toHaveLength(1);
  });

  it('stops adding clips after the time cap but always plays the first one', async () => {
    let clock = 0;
    const played = await runClips(
      [clip('intro', 'a'), clip('story', 'b', '1'), clip('story', 'c', '2')],
      { decode: async (path) => path, play: async () => { clock += 100_000; }, now: () => clock },
      150_000,
    );
    expect(played.map((item) => item.path)).toEqual(['a', 'b']);
  });
});

describe('ProgrammeState.record', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  };
  const plan = (kind: BreakPlan['kind']): BreakPlan => ({ kind, headlines: [], full: [], teaser: null, weather: false, empty: false });

  it('counts a story as aired only when its full audio played', () => {
    const state = new ProgrammeState(new AiredStore(memory()));
    state.record(plan('main'), [clip('intro', 'i'), clip('story', 's', 'a'), clip('teaser', 't', 'b'), clip('headline', 'h', 'c')], new Date());
    expect(state.aired.has('a')).toBe(true);
    expect(state.aired.has('b')).toBe(false);
    expect(state.aired.has('c')).toBe(false);
    const context = state.context([], new Date());
    expect(context.headlined.has('c')).toBe(true);
    expect(context.lastFormat).toBe('main');
  });

  it('a session does not open with the hourly bulletin of its start hour; the next hour does', () => {
    const state = new ProgrammeState(new AiredStore(memory()));
    const start = new Date(2026, 10, 7, 14, 10);
    state.startSession(start);
    expect(state.context([], start).lastHourlyKey).toBe(hourKey(start));
    const later = new Date(2026, 10, 7, 15, 3);
    state.record(plan('hourly'), [clip('intro', 'i')], later);
    const context = state.context([], later);
    expect(context.lastHourlyKey).toBe(hourKey(later));
    expect(context.lastFormat).toBeNull();
  });
});
