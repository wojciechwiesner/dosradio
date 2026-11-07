import { describe, it, expect } from 'vitest';
import {
  FIRST_BREAK_DELAY_MS, nextScheduledBreak, nextHostClipDelayMs, normalizeInterval,
  HOST_CLIP_MIN_MS, HOST_CLIP_MAX_MS,
} from '../src/radio/radioClock';
import {
  ONBOARDED_KEY, PREFS_KEY, applyOnboardingChoice, defaultPrefs, isOnboarded, loadPrefs, markOnboarded, savePrefs,
  type StorageLike,
} from '../src/ui/prefs';

const MINUTE = 60_000;

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

describe('Break schedule', () => {
  const startedAt = new Date('2026-11-06T12:03:27Z');

  it('first break is exactly start + 5 minutes, not on the clock grid', () => {
    const first = nextScheduledBreak({ startedAt, lastBreakAt: null, interval: 20 });
    expect(first.getTime()).toBe(startedAt.getTime() + 5 * MINUTE);
    expect(FIRST_BREAK_DELAY_MS).toBe(5 * MINUTE);
  });

  it('honours a custom first-break delay', () => {
    const first = nextScheduledBreak({ startedAt, lastBreakAt: null, interval: 20, firstBreakDelayMs: MINUTE });
    expect(first.getTime()).toBe(startedAt.getTime() + MINUTE);
  });

  it('later breaks are counted from the previous break', () => {
    const lastBreakAt = new Date(startedAt.getTime() + 5 * MINUTE + 4_000); // aired slightly late
    expect(nextScheduledBreak({ startedAt, lastBreakAt, interval: 15 }).getTime()).toBe(lastBreakAt.getTime() + 15 * MINUTE);
  });

  it('changing the interval re-schedules from the same previous break', () => {
    const lastBreakAt = new Date(startedAt.getTime() + 5 * MINUTE);
    const every10 = nextScheduledBreak({ startedAt, lastBreakAt, interval: 10 });
    const every60 = nextScheduledBreak({ startedAt, lastBreakAt, interval: 60 });
    expect(every60.getTime() - every10.getTime()).toBe(50 * MINUTE);
  });
});

describe('Intervals and host clip delay', () => {
  it('keeps old values valid and widens to 5/10/15', () => {
    [5, 10, 15, 20, 30, 60].forEach((value) => expect(normalizeInterval(value)).toBe(value));
    expect(normalizeInterval(7)).toBe(5);
    expect(normalizeInterval(undefined)).toBe(5);
  });

  it('host clip delay stays within 6-12 minutes', () => {
    expect(nextHostClipDelayMs(() => 0)).toBe(HOST_CLIP_MIN_MS);
    expect(nextHostClipDelayMs(() => 0.999999)).toBeLessThanOrEqual(HOST_CLIP_MAX_MS);
    expect(nextHostClipDelayMs(() => 0.5)).toBeGreaterThan(HOST_CLIP_MIN_MS);
  });
});

describe('Onboarding preferences persistence', () => {
  it('is not onboarded until marked, then persists', () => {
    const storage = memoryStorage();
    expect(isOnboarded(storage)).toBe(false);
    markOnboarded(storage);
    expect(storage.data.get(ONBOARDED_KEY)).toBe('1');
    expect(isOnboarded(storage)).toBe(true);
  });

  it('applies the choice and survives a save/load round trip', () => {
    const storage = memoryStorage();
    const chosen = applyOnboardingChoice(defaultPrefs(), { hostMode: 'music-only', categories: ['sport', 'stoic'], interval: 10 });
    savePrefs(storage, chosen);
    const loaded = loadPrefs(storage);
    expect(loaded).toMatchObject({ hostMode: 'music-only', categories: ['sport', 'stoic'], interval: 10, newsEnabled: true });
  });

  it('"Bez wiadomości" disables news but keeps previous categories', () => {
    const base = { ...defaultPrefs(), categories: ['beauty' as const] };
    const result = applyOnboardingChoice(base, { hostMode: 'with-host', categories: [], interval: 60 });
    expect(result.newsEnabled).toBe(false);
    expect(result.categories).toEqual(['beauty']);
    expect(result.hostMode).toBe('with-host');
  });

  it('migrates old stored prefs without newsEnabled', () => {
    const storage = memoryStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ station: 'dos-groove', categories: ['ai'], interval: 30, volume: 0.5, hostMode: 'with-host' }));
    expect(loadPrefs(storage)).toMatchObject({ interval: 30, newsEnabled: true, volume: 0.5 });
  });

  it('falls back to defaults on corrupted storage', () => {
    const storage = memoryStorage();
    storage.setItem(PREFS_KEY, '{not json');
    expect(loadPrefs(storage)).toEqual(defaultPrefs());
  });
});

describe('Moje źródła topic', () => {
  it('is offered only to Plus listeners and survives sanitizing', async () => {
    const { availableCategories, sanitizeCategories } = await import('../src/radio/newsQueue');
    expect(availableCategories(false).map((c) => c.id)).not.toContain('mine');
    expect(availableCategories(true).map((c) => c.id)).toContain('mine');
    expect(sanitizeCategories(['mine', 'ai'])).toEqual(['ai', 'mine']);
  });
});
