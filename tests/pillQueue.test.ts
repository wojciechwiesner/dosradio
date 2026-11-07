import { describe, it, expect } from 'vitest';
import { PillQueue, PILL_QUEUE_KEY, splitUnits, type PillPart } from '../src/radio/pillQueue';
import { breakClips, type BreakPlan } from '../src/radio/programme';

const part = (kind: string, name: string): PillPart => ({ kind, url: `/radio-api/plus/pill/x/${name}` });
const PARTS = [part('bumper', 'b1'), part('voice', 'v1'), part('clip', 'c1'), part('voice', 'v2'), part('clip', 'c2'), part('bumper', 'b2')];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe('splitUnits', () => {
  it('keeps a bumper alone and a voice summary together with its clip', () => {
    expect(splitUnits(PARTS).map((unit) => unit.map((p) => p.kind))).toEqual([
      ['bumper'], ['voice', 'clip'], ['voice', 'clip'], ['bumper'],
    ]);
  });

  it('lets a stray voice or clip air alone', () => {
    expect(splitUnits([part('clip', 'c'), part('voice', 'v')]).map((unit) => unit.length)).toEqual([1, 1]);
  });
});

describe('PillQueue', () => {
  it('airs units in order and drops the pill after its last part', () => {
    const queue = new PillQueue(memoryStorage());
    queue.enqueue({ id: 'a', title: 'Pigułka A', parts: PARTS });
    const aired: string[][] = [];
    while (queue.peekUnit()) {
      aired.push(queue.peekUnit()!.map((p) => p.url.split('/').pop()!));
      queue.commitUnit();
    }
    expect(aired).toEqual([['b1'], ['v1', 'c1'], ['v2', 'c2'], ['b2']]);
    expect(queue.isEmpty).toBe(true);
  });

  it('serves pills first in, first out and reports progress in parts', () => {
    const queue = new PillQueue(memoryStorage());
    queue.enqueue({ id: 'a', title: 'A', parts: PARTS });
    queue.enqueue({ id: 'b', title: 'B', parts: [part('clip', 'only')] });
    queue.commitUnit();
    queue.commitUnit();
    expect(queue.progress()).toEqual([
      { pillId: 'a', title: 'A', done: 3, total: 6 },
      { pillId: 'b', title: 'B', done: 0, total: 1 },
    ]);
  });

  it('refuses duplicates and empty pills', () => {
    const queue = new PillQueue(memoryStorage());
    expect(queue.enqueue({ id: 'a', title: 'A', parts: PARTS })).toBe(true);
    expect(queue.enqueue({ id: 'a', title: 'A', parts: PARTS })).toBe(false);
    expect(queue.enqueue({ id: 'e', title: 'E', parts: [] })).toBe(false);
  });

  it('removes a pill and notifies listeners', () => {
    const queue = new PillQueue(memoryStorage());
    let notified = 0;
    queue.subscribe(() => { notified++; });
    queue.enqueue({ id: 'a', title: 'A', parts: PARTS });
    queue.remove('a');
    expect(queue.isEmpty).toBe(true);
    expect(notified).toBe(2);
  });

  it('survives a reload with the position kept', () => {
    const storage = memoryStorage();
    const first = new PillQueue(storage);
    first.enqueue({ id: 'a', title: 'A', parts: PARTS });
    first.commitUnit();
    const reloaded = new PillQueue(storage);
    expect(reloaded.progress()).toEqual([{ pillId: 'a', title: 'A', done: 1, total: 6 }]);
    expect(reloaded.peekUnit()?.map((p) => p.kind)).toEqual(['voice', 'clip']);
  });

  it('starts empty on corrupted storage', () => {
    expect(new PillQueue(memoryStorage({ [PILL_QUEUE_KEY]: '{not json' })).isEmpty).toBe(true);
    expect(new PillQueue(memoryStorage({ [PILL_QUEUE_KEY]: '[{"pillId":1}]' })).isEmpty).toBe(true);
  });
});

describe('break plan with a pill unit', () => {
  const options = { hhmm: '12:00', stationId: 'dos-groove', place: null };
  const main: BreakPlan = { kind: 'main', headlines: [], full: [], teaser: null, weather: false, empty: false };
  const unit = [part('voice', 'v1'), part('clip', 'c1')];

  it('appends the pill unit after the news clips', () => {
    const clips = breakClips(main, { ...options, pillUnit: unit });
    expect(clips.map((c) => c.role)).toEqual(['intro', 'pill', 'pill']);
    expect(clips[1].path).toBe(unit[0].url);
  });

  it('makes a pill-only break (no intro) when there is no news', () => {
    const clips = breakClips({ ...main, empty: true }, { ...options, pillUnit: unit });
    expect(clips.map((c) => c.role)).toEqual(['pill', 'pill']);
  });

  it('leaves a news-only break unchanged', () => {
    expect(breakClips(main, options).map((c) => c.role)).toEqual(['intro']);
  });
});
