/**
 * Listener preferences and onboarding persistence. Pure functions only (no DOM),
 * so they are unit-testable; callers pass a Storage-like object.
 */
import type { HostMode } from '../radio/publicRadioEngine';
import { sanitizeCategories, type NewsCategory } from '../radio/newsQueue';
import { normalizeInterval, DEFAULT_BREAK_INTERVAL, type BreakInterval } from '../radio/radioClock';
import { DEFAULT_STATION_ID, stationById } from '../radio/stations';

export const PREFS_KEY = 'dosradio.prefs.v1';
export const ONBOARDED_KEY = 'dosradio.onboarded';
const DEFAULT_VOLUME = 0.9;
const DEFAULT_CATEGORIES: NewsCategory[] = ['ai'];

export interface Prefs {
  station: string;
  categories: NewsCategory[];
  interval: BreakInterval;
  volume: number;
  hostMode: HostMode;
  newsEnabled: boolean;
}

/** What the onboarding modal collects. An empty `categories` list means "Bez wiadomości". */
export interface OnboardingChoice {
  hostMode: HostMode;
  categories: NewsCategory[];
  interval: BreakInterval;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function defaultPrefs(): Prefs {
  return {
    station: DEFAULT_STATION_ID,
    categories: [...DEFAULT_CATEGORIES],
    interval: DEFAULT_BREAK_INTERVAL,
    volume: DEFAULT_VOLUME,
    hostMode: 'with-host',
    newsEnabled: true,
  };
}

/** Tolerant parser: old stored prefs (no newsEnabled, intervals 20/30/60) stay valid. */
export function parsePrefs(raw: Partial<Prefs> | null | undefined): Prefs {
  const source = raw ?? {};
  return {
    station: stationById(source.station).id,
    categories: sanitizeCategories(source.categories ?? DEFAULT_CATEGORIES),
    interval: normalizeInterval(source.interval),
    volume: typeof source.volume === 'number' ? source.volume : DEFAULT_VOLUME,
    hostMode: source.hostMode === 'music-only' ? 'music-only' : 'with-host',
    newsEnabled: source.newsEnabled !== false,
  };
}

export function loadPrefs(storage: StorageLike): Prefs {
  try {
    return parsePrefs(JSON.parse(storage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>);
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(storage: StorageLike, prefs: Prefs): void {
  storage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** Merge the onboarding answers into existing prefs; no chosen area turns news off but keeps old categories. */
export function applyOnboardingChoice(prefs: Prefs, choice: OnboardingChoice): Prefs {
  const newsEnabled = choice.categories.length > 0;
  return {
    ...prefs,
    hostMode: choice.hostMode,
    categories: newsEnabled ? sanitizeCategories(choice.categories) : prefs.categories,
    interval: normalizeInterval(choice.interval),
    newsEnabled,
  };
}

export const isOnboarded = (storage: StorageLike): boolean => storage.getItem(ONBOARDED_KEY) === '1';
export const markOnboarded = (storage: StorageLike): void => storage.setItem(ONBOARDED_KEY, '1');
