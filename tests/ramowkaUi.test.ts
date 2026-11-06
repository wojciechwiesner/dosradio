import { describe, it, expect } from 'vitest';
import { formatCountdown, upcomingText } from '../src/ui/upcoming';
import { PREFS_KEY, applyOnboardingChoice, defaultPrefs, loadPrefs, weatherPlaceFromPrefs, programmeOptions } from '../src/ui/prefs';
import type { QueuedStory } from '../src/radio/newsQueue';

const story: QueuedStory = {
  id: 'a', title: 'Tytuł', headline: 'Krótki nagłówek', radio_text: '', source_url: '', confirmed: true, category: 'ai', audio_ready: false,
};

describe('FOMO line', () => {
  it('formats m:ss', () => {
    expect(formatCountdown(192_000)).toBe('3:12');
    expect(formatCountdown(59_100)).toBe('1:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('shows the countdown and the headline, falling back to the title', () => {
    const now = new Date(2026, 10, 7, 14, 0, 0);
    const at = new Date(now.getTime() + 192_000);
    expect(upcomingText(at, story, now)).toBe('Za 3:12: Krótki nagłówek');
    expect(upcomingText(at, { ...story, headline: undefined }, now)).toBe('Za 3:12: Tytuł');
    expect(upcomingText(now, story, now)).toBe('Za chwilę: Krótki nagłówek');
  });

  it('is empty without a next break or a story', () => {
    expect(upcomingText(null, story, new Date())).toBe('');
    expect(upcomingText(new Date(), null, new Date())).toBe('');
  });
});

describe('Programme prefs', () => {
  const memory = (raw: unknown) => ({ getItem: () => JSON.stringify(raw), setItem: () => {} });

  it('defaults: interval 5, hourly bulletin on, no topic, no weather', () => {
    const prefs = defaultPrefs();
    expect(prefs).toMatchObject({ interval: 5, hourlyBulletin: true, dayTopic: null, weatherCity: '' });
    expect(weatherPlaceFromPrefs(prefs)).toBeNull();
  });

  it('old stored prefs migrate with the new defaults', () => {
    const loaded = loadPrefs(memory({ station: 'dos-groove', categories: ['ai'], interval: 20 }));
    expect(loaded).toMatchObject({ interval: 20, hourlyBulletin: true, dayTopic: null, weatherLat: null });
    expect(PREFS_KEY).toBe('dosradio.prefs.v1');
  });

  it('topic of the day must be one of the chosen categories', () => {
    expect(loadPrefs(memory({ categories: ['ai', 'sport'], dayTopic: 'sport' })).dayTopic).toBe('sport');
    expect(loadPrefs(memory({ categories: ['ai'], dayTopic: 'sport' })).dayTopic).toBeNull();
  });

  it('onboarding stores the starred topic and drops it when its category is unselected', () => {
    const chosen = applyOnboardingChoice(defaultPrefs(), { hostMode: 'with-host', categories: ['ai', 'sport'], interval: 5, dayTopic: 'sport' });
    expect(chosen.dayTopic).toBe('sport');
    const dropped = applyOnboardingChoice(chosen, { hostMode: 'with-host', categories: ['ai'], interval: 5, dayTopic: 'sport' });
    expect(dropped.dayTopic).toBeNull();
  });

  it('sanitises weather place: needs both coordinates in range, city trimmed', () => {
    expect(loadPrefs(memory({ weatherLat: 51.1, weatherLon: 17 }))).toMatchObject({ weatherLat: 51.1, weatherLon: 17 });
    expect(loadPrefs(memory({ weatherLat: 51.1 }))).toMatchObject({ weatherLat: null, weatherLon: null });
    expect(loadPrefs(memory({ weatherLat: 951, weatherLon: 17 })).weatherLat).toBeNull();
    const prefs = loadPrefs(memory({ weatherCity: '  Wrocław ' }));
    expect(programmeOptions(prefs).place).toEqual({ city: 'Wrocław', lat: null, lon: null });
  });
});
