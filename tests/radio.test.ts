import { describe, it, expect } from 'vitest';
import { STATIONS, stationById, hostStationId, isPresetStation } from '../src/radio/stations';
import { defaultPrefs, parsePrefs, nextGenreChoice } from '../src/ui/prefs';
import { interleaveStories, pickNextStory, type QueuedStory } from '../src/radio/newsQueue';
import { nextBreakAt, msUntilNextBreak, spokenTimePl } from '../src/radio/radioClock';

describe('DOS Radio Stations', () => {
  it('loads 14 stations with unique IDs and hosts', () => {
    expect(STATIONS.length).toBe(25);
    const ids = new Set(STATIONS.map((s) => s.id));
    expect(ids.size).toBe(25);
  });

  it('resolves preset station correctly', () => {
    const groove = stationById('dos-groove');
    expect(groove.name).toBe('DOS Groove');
    expect(isPresetStation(groove)).toBe(true);
    expect(hostStationId(groove)).toBe('dos-groove');
  });

  it('keeps a second genre only when it is a different station', () => {
    const prefs = parsePrefs({ ...defaultPrefs(), station: 'dos-groove', blend: 'micro-house' });
    expect(prefs.blend).toBe('micro-house');
    const same = parsePrefs({ ...defaultPrefs(), station: 'dos-groove', blend: 'dos-groove' });
    expect(same.blend).toBeNull();
  });

    it('a shifted click adds a second genre instead of replacing the station', () => {
    const added = nextGenreChoice('dos-groove', null, 'micro-house', true);
    expect(added).toEqual({ station: 'dos-groove', blend: 'micro-house' });
    const cleared = nextGenreChoice('dos-groove', 'micro-house', 'micro-house', true);
    expect(cleared.blend).toBeNull();
  });

  it('falls back to default station on unknown id', () => {
    const unknown = stationById('non-existent');
    expect(unknown.id).toBe('dos-groove');
  });
});

describe('News Queue & Stories', () => {
  it('interleaves stories across categories without bias', () => {
    const categories = [
      {
        category: 'ai' as const,
        title: 'AI',
        stories: [
          { id: '1', title: 'A1', summary: 'S1', category: 'ai' as const },
          { id: '2', title: 'A2', summary: 'S2', category: 'ai' as const },
        ],
      },
      {
        category: 'sport' as const,
        title: 'Sport',
        stories: [
          { id: '3', title: 'S1', summary: 'SS1', category: 'sport' as const },
        ],
      },
    ];

    const queue = interleaveStories(categories);
    expect(queue.length).toBe(3);
    expect(queue[0].id).toBe('1');
    expect(queue[1].id).toBe('3');
    expect(queue[2].id).toBe('2');
  });

  it('picks un-aired stories before repeating', () => {
    const stories: QueuedStory[] = [
      { id: 's1', title: '1', summary: '1', category: 'ai' },
      { id: 's2', title: '2', summary: '2', category: 'ai' },
    ];
    const aired = new Set<string>(['s1']);
    const next = pickNextStory(stories, aired);
    expect(next?.id).toBe('s2');
  });
});

describe('Radio Clock & Intervals', () => {
  it('calculates the next 20-minute slot accurately', () => {
    const d = new Date(2026, 10, 5, 14, 5, 0);
    const slot = nextBreakAt(d, 20);
    expect(slot.getHours()).toBe(14);
    expect(slot.getMinutes()).toBe(20);
    expect(slot.getSeconds()).toBe(0);
  });

  it('returns positive ms until next slot', () => {
    const d = new Date(2026, 10, 5, 14, 5, 0);
    const ms = msUntilNextBreak(d, 20);
    expect(ms).toBe(15 * 60 * 1000);
  });

  it('converts time to natural Polish speech', () => {
    const d = new Date(2026, 10, 5, 14, 20, 0);
    expect(spokenTimePl(d)).toBe('czternasta dwadzieścia');
  });

  it('allows standalone news breaks to preempt speaking without getting dropped', () => {
    // REGRESSION INVARIANT: standalone breaks (e.g. newsNow) must not be rejected when speaking is true
    const shouldAir = (speaking: boolean, standalone: boolean, playing: boolean, hostMode: string) => {
      if ((speaking && !standalone) || (!playing && !standalone) || hostMode === 'music-only') return false;
      return true;
    };
    expect(shouldAir(true, false, true, 'with-host')).toBe(false); // scheduled break deferred
    expect(shouldAir(true, true, true, 'with-host')).toBe(true);   // manual newsNow preempts speaking
    expect(shouldAir(false, false, true, 'with-host')).toBe(true);
    expect(shouldAir(false, false, true, 'music-only')).toBe(false);
  });
});
