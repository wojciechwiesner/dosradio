import { describe, it, expect } from 'vitest';
import type { QueuedStory } from '../src/radio/newsQueue';
import {
  breakClips, hourKey, planBreak, rankUnaired, upcomingStory, weatherQuery, type BreakContext,
} from '../src/radio/programme';

function story(id: string, category: QueuedStory['category'] = 'ai', extra: Partial<QueuedStory> = {}): QueuedStory {
  return {
    id, title: `Title ${id}`, headline: `Headline ${id}`, radio_text: `Text ${id}`, source_url: `https://x/${id}`,
    confirmed: true, category, audio_ready: false, ...extra,
  };
}

const QUEUE = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => story(id));

function context(overrides: Partial<BreakContext> = {}): BreakContext {
  return {
    now: new Date(2026, 10, 7, 14, 20),
    queue: QUEUE,
    aired: new Set(),
    headlined: new Set(),
    dayTopic: null,
    lastFormat: null,
    lastHourlyKey: hourKey(new Date(2026, 10, 7, 14, 5)),
    hourlyEnabled: true,
    weatherEnabled: true,
    ...overrides,
  };
}

const ids = (stories: QueuedStory[]) => stories.map((item) => item.id);

describe('rankUnaired', () => {
  it('puts the topic of the day first, then rendered audio, then queue order', () => {
    const queue = [story('a'), story('b', 'sport'), story('c', 'ai', { audio_ready: true }), story('d', 'sport', { audio_ready: true })];
    expect(ids(rankUnaired(queue, new Set(), 'sport'))).toEqual(['d', 'b', 'c', 'a']);
  });

  it('drops aired stories and never restarts the cycle', () => {
    expect(rankUnaired(QUEUE, new Set(ids(QUEUE)), null)).toEqual([]);
  });
});

describe('planBreak formats', () => {
  it('starts with a flash: headlines of the following stories, teaser on the next main story', () => {
    const plan = planBreak(context());
    expect(plan.kind).toBe('flash');
    expect(ids(plan.headlines)).toEqual(['b', 'c', 'd']);
    expect(plan.teaser?.id).toBe('a');
    expect(plan.full).toEqual([]);
  });

  it('alternates: after a flash comes a main story with a teaser for the next one', () => {
    const plan = planBreak(context({ lastFormat: 'flash' }));
    expect(plan.kind).toBe('main');
    expect(ids(plan.full)).toEqual(['a']);
    expect(plan.teaser?.id).toBe('b');
  });

  it('main story follows the topic of the day', () => {
    const queue = [story('a'), story('b', 'sport')];
    const plan = planBreak(context({ queue, dayTopic: 'sport', lastFormat: 'flash' }));
    expect(ids(plan.full)).toEqual(['b']);
    expect(plan.teaser?.id).toBe('a');
  });

  it('flash skips headlines already read and the teaser story itself', () => {
    const plan = planBreak(context({ headlined: new Set(['b', 'c']) }));
    expect(ids(plan.headlines)).toEqual(['d', 'e', 'f']);
  });

  it('falls back to a main story when no headline is available (older server)', () => {
    const queue = QUEUE.map((item) => ({ ...item, headline: undefined }));
    expect(planBreak(context({ queue })).kind).toBe('main');
  });

  it('with a single unaired story it airs it as main with no teaser', () => {
    const plan = planBreak(context({ aired: new Set(['b', 'c', 'd', 'e', 'f']) }));
    expect(plan.kind).toBe('main');
    expect(ids(plan.full)).toEqual(['a']);
    expect(plan.teaser).toBeNull();
  });

  it('is empty when everything aired today', () => {
    const plan = planBreak(context({ aired: new Set(ids(QUEUE)), weatherEnabled: false }));
    expect(plan.empty).toBe(true);
    expect(plan.full).toEqual([]);
  });

  it('a teaser always points at an unaired story and no story is ever planned twice', () => {
    let aired = new Set<string>();
    let lastFormat: BreakContext['lastFormat'] = null;
    const spoken: string[] = [];
    for (let step = 0; step < QUEUE.length * 2 + 2; step++) {
      const plan = planBreak(context({ aired, lastFormat }));
      if (plan.empty) break;
      if (plan.teaser) expect(aired.has(plan.teaser.id)).toBe(false);
      spoken.push(...ids(plan.full));
      aired = new Set([...aired, ...ids(plan.full)]);
      lastFormat = plan.kind as BreakContext['lastFormat'];
    }
    expect(new Set(spoken).size).toBe(spoken.length);
    expect(spoken.sort()).toEqual(ids(QUEUE));
  });
});

describe('planBreak hourly bulletin', () => {
  const afterFullHour = new Date(2026, 10, 7, 15, 2);

  it('first break after the full hour is hourly: top 2 in full, other headlines, weather', () => {
    const plan = planBreak(context({ now: afterFullHour }));
    expect(plan.kind).toBe('hourly');
    expect(ids(plan.full)).toEqual(['a', 'b']);
    expect(ids(plan.headlines)).toEqual(['c', 'd', 'e', 'f']);
    expect(plan.weather).toBe(true);
  });

  it('runs once per hour', () => {
    const plan = planBreak(context({ now: afterFullHour, lastHourlyKey: hourKey(afterFullHour) }));
    expect(plan.kind).not.toBe('hourly');
  });

  it('can be switched off', () => {
    expect(planBreak(context({ now: afterFullHour, hourlyEnabled: false })).kind).not.toBe('hourly');
  });

  it('omits weather when no place is set', () => {
    expect(planBreak(context({ now: afterFullHour, weatherEnabled: false })).weather).toBe(false);
  });

  it('still airs weather when all stories were aired', () => {
    const plan = planBreak(context({ now: afterFullHour, aired: new Set(ids(QUEUE)) }));
    expect(plan.kind).toBe('hourly');
    expect(plan.empty).toBe(false);
    expect(plan.full).toEqual([]);
  });
});

describe('upcomingStory', () => {
  it('shows the story the next break leads with or teases', () => {
    expect(upcomingStory(context())?.id).toBe('a');
    expect(upcomingStory(context({ lastFormat: 'flash' }))?.id).toBe('a');
    expect(upcomingStory(context({ aired: new Set(ids(QUEUE)), weatherEnabled: false }))).toBeNull();
  });
});

describe('breakClips', () => {
  const place = { city: 'Wrocław', lat: null, lon: null };

  it('flash: intro, headlines, teaser', () => {
    const plan = planBreak(context());
    const clips = breakClips(plan, { hhmm: '14:20', stationId: 'dos-groove', place: null });
    expect(clips.map((clip) => clip.role)).toEqual(['intro', 'headline', 'headline', 'headline', 'teaser']);
    expect(clips[0].path).toBe('/radio-api/intro.wav?time=14:20&station=dos-groove&kind=flash');
    expect(clips[1].path).toBe('/radio-api/story/b/headline.wav');
    expect(clips[4].path).toBe('/radio-api/teaser.wav?story=a&station=dos-groove');
  });

  it('hourly: intro, headlines, full stories, weather with encoded city', () => {
    const plan = planBreak(context({ now: new Date(2026, 10, 7, 15, 2) }));
    const clips = breakClips(plan, { hhmm: '15:02', stationId: 'dos-groove', place });
    expect(clips.map((clip) => clip.role)).toEqual([
      'intro', 'headline', 'headline', 'headline', 'headline', 'story', 'story', 'weather',
    ]);
    expect(clips.at(-1)?.path).toBe('/radio-api/weather.wav?station=dos-groove&city=Wroc%C5%82aw');
  });

  it('weather is skipped without a place', () => {
    const plan = planBreak(context({ now: new Date(2026, 10, 7, 15, 2) }));
    const clips = breakClips(plan, { hhmm: '15:02', stationId: 'dos-groove', place: null });
    expect(clips.some((clip) => clip.role === 'weather')).toBe(false);
  });

  it('weatherQuery uses rounded coordinates', () => {
    expect(weatherQuery({ city: '', lat: 51.107883, lon: 17.038538 }, 's')).toBe('station=s&lat=51.108&lon=17.039');
  });
});
