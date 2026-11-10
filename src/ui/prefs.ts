/**
 * Listener preferences and onboarding persistence. Pure functions only (no DOM),
 * so they are unit-testable; callers pass a Storage-like object.
 */
import type { HostMode } from '../radio/publicRadioEngine';
import { sanitizeCategories, type NewsCategory } from '../radio/newsQueue';
import { normalizeInterval, DEFAULT_BREAK_INTERVAL, type BreakInterval } from '../radio/radioClock';
import { hasWeatherPlace, type WeatherPlace } from '../radio/programme';
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
  /** Host/news voice loudness, 0..1, independent of the music. */
  voiceVolume: number;
  /** How loud the music stays while the host or the news speaks, 0..1. */
  duckLevel: number;
  hostMode: HostMode;
  newsEnabled: boolean;
  /** Category the listener starred as "topic of the day"; always one of `categories` or null. */
  dayTopic: NewsCategory | null;
  /** Full bulletin (all headlines, top stories, weather) in the first break after every full hour. */
  hourlyBulletin: boolean;
  /** Weather place for the hourly bulletin: a city name and/or coordinates; empty = no weather. */
  weatherCity: string;
  weatherLat: number | null;
  weatherLon: number | null;
}

/** What the onboarding modal collects. An empty `categories` list means "Bez wiadomości". */
export interface OnboardingChoice {
  hostMode: HostMode;
  categories: NewsCategory[];
  interval: BreakInterval;
  dayTopic?: NewsCategory | null;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function defaultPrefs(): Prefs {
  return {
    station: DEFAULT_STATION_ID,
    categories: [...DEFAULT_CATEGORIES],
    interval: DEFAULT_BREAK_INTERVAL,
    volume: DEFAULT_VOLUME,
    voiceVolume: DEFAULT_VOLUME,
    duckLevel: 0.34,
    hostMode: 'with-host',
    newsEnabled: true,
    dayTopic: null,
    hourlyBulletin: true,
    weatherCity: '',
    weatherLat: null,
    weatherLon: null,
  };
}

const MAX_CITY_LENGTH = 80;

const validCoord = (value: unknown, limit: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;

/** The topic of the day must be one of the chosen categories, otherwise there is none. */
export function sanitizeDayTopic(topic: unknown, categories: NewsCategory[]): NewsCategory | null {
  return categories.find((category) => category === topic) ?? null;
}

/** Tolerant parser: old stored prefs (no newsEnabled, intervals 20/30/60) stay valid. */
export function parsePrefs(raw: Partial<Prefs> | null | undefined): Prefs {
  const source = raw ?? {};
  const categories = sanitizeCategories(source.categories ?? DEFAULT_CATEGORIES);
  const lat = validCoord(source.weatherLat, 90);
  const lon = validCoord(source.weatherLon, 180);
  const hasCoords = lat !== null && lon !== null;
  return {
    station: stationById(source.station).id,
    categories,
    interval: normalizeInterval(source.interval),
    volume: typeof source.volume === 'number' ? source.volume : DEFAULT_VOLUME,
    voiceVolume: typeof source.voiceVolume === 'number' ? source.voiceVolume : DEFAULT_VOLUME,
    duckLevel: typeof source.duckLevel === 'number' ? source.duckLevel : 0.34,
    hostMode: source.hostMode === 'music-only' ? 'music-only' : 'with-host',
    newsEnabled: source.newsEnabled !== false,
    dayTopic: sanitizeDayTopic(source.dayTopic, categories),
    hourlyBulletin: source.hourlyBulletin !== false,
    weatherCity: typeof source.weatherCity === 'string' ? source.weatherCity.trim().slice(0, MAX_CITY_LENGTH) : '',
    weatherLat: hasCoords ? lat : null,
    weatherLon: hasCoords ? lon : null,
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
  const categories = newsEnabled ? sanitizeCategories(choice.categories) : prefs.categories;
  return {
    ...prefs,
    hostMode: choice.hostMode,
    categories,
    dayTopic: sanitizeDayTopic(newsEnabled ? choice.dayTopic : prefs.dayTopic, categories),
    interval: normalizeInterval(choice.interval),
    newsEnabled,
  };
}

export const isOnboarded = (storage: StorageLike): boolean => storage.getItem(ONBOARDED_KEY) === '1';
export const markOnboarded = (storage: StorageLike): void => storage.setItem(ONBOARDED_KEY, '1');

/** Weather place for the hourly bulletin, or null when the listener gave neither a city nor coordinates. */
export function weatherPlaceFromPrefs(prefs: Prefs): WeatherPlace | null {
  const place: WeatherPlace = { city: prefs.weatherCity, lat: prefs.weatherLat, lon: prefs.weatherLon };
  return hasWeatherPlace(place) ? place : null;
}

/** Everything the engine needs to know about the programme choices. */
export function programmeOptions(prefs: Prefs): { dayTopic: NewsCategory | null; hourlyEnabled: boolean; place: WeatherPlace | null } {
  return { dayTopic: prefs.dayTopic, hourlyEnabled: prefs.hourlyBulletin, place: weatherPlaceFromPrefs(prefs) };
}
