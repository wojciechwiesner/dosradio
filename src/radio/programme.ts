/**
 * Programme planner for the news breaks. Pure: no DOM, no audio, no network.
 *
 * Two short formats alternate: FLASH (2-3 one-sentence headlines + teaser) and MAIN (one story + teaser).
 * The first break after a full hour is HOURLY (headlines, the top 2 stories in full, weather).
 * Stories already aired today are never planned again.
 */
import type { NewsCategory, QueuedStory } from './newsQueue';
import type { PillPart } from './pillQueue';

export type BreakKind = 'flash' | 'main' | 'hourly';
export type ShortFormat = 'flash' | 'main';

export const FLASH_MAX_HEADLINES = 3;
export const HOURLY_FULL_STORIES = 2;
export const HOURLY_MAX_HEADLINES = 4;
/** The hourly bulletin must not run longer than this; the engine stops adding clips past it. */
export const HOURLY_MAX_MS = 4 * 60_000;

export interface WeatherPlace {
  city: string;
  lat: number | null;
  lon: number | null;
}

export interface BreakContext {
  now: Date;
  queue: QueuedStory[];
  /** Fully aired today (persisted). */
  aired: ReadonlySet<string>;
  /** Only the headline was read this session; kept out of further flashes. */
  headlined: ReadonlySet<string>;
  dayTopic: NewsCategory | null;
  lastFormat: ShortFormat | null;
  /** Hour key of the last hourly bulletin (or of the session start, so a session never opens with one). */
  lastHourlyKey: string | null;
  hourlyEnabled: boolean;
  weatherEnabled: boolean;
}

export interface BreakPlan {
  kind: BreakKind;
  /** Stories read as one-sentence headlines only. */
  headlines: QueuedStory[];
  /** Stories read in full; they count as aired. */
  full: QueuedStory[];
  /** Real, unaired story the teaser points at. */
  teaser: QueuedStory | null;
  weather: boolean;
  /** Nothing new to say: the engine airs host chatter instead. */
  empty: boolean;
}

export interface BreakClip {
  role: 'intro' | 'headline' | 'story' | 'teaser' | 'weather' | 'pill';
  path: string;
  storyId?: string;
}

const hasHeadline = (story: QueuedStory): boolean => Boolean(story.headline);

/** `2026-11-07T14`: identifies one clock hour in the listener's local time. */
export function hourKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}`;
}

/** Unaired stories, topic of the day first, then rendered audio first, then queue order. */
export function rankUnaired(queue: QueuedStory[], aired: ReadonlySet<string>, topic: NewsCategory | null): QueuedStory[] {
  const score = (story: QueuedStory): number => (story.category === topic ? 2 : 0) + (story.audio_ready ? 1 : 0);
  return queue
    .map((story, index) => ({ story, index }))
    .filter(({ story }) => !aired.has(story.id))
    .sort((a, b) => score(b.story) - score(a.story) || a.index - b.index)
    .map(({ story }) => story);
}

function planHourly(ctx: BreakContext, ranked: QueuedStory[]): BreakPlan | null {
  if (!ctx.hourlyEnabled || hourKey(ctx.now) === ctx.lastHourlyKey) return null;
  const full = ranked.slice(0, HOURLY_FULL_STORIES);
  if (!full.length && !ctx.weatherEnabled) return null;
  const headlines = ranked.slice(HOURLY_FULL_STORIES).filter(hasHeadline).slice(0, HOURLY_MAX_HEADLINES);
  return { kind: 'hourly', headlines, full, teaser: null, weather: ctx.weatherEnabled, empty: false };
}

export function planBreak(ctx: BreakContext): BreakPlan {
  const ranked = rankUnaired(ctx.queue, ctx.aired, ctx.dayTopic);
  const hourly = planHourly(ctx, ranked);
  if (hourly) return hourly;

  const [lead, ...others] = ranked;
  if (!lead) return { kind: 'main', headlines: [], full: [], teaser: null, weather: false, empty: true };

  if (ctx.lastFormat !== 'flash') {
    const headlines = others.filter((story) => hasHeadline(story) && !ctx.headlined.has(story.id)).slice(0, FLASH_MAX_HEADLINES);
    if (headlines.length) return { kind: 'flash', headlines, full: [], teaser: lead, weather: false, empty: false };
  }
  return { kind: 'main', headlines: [], full: [lead], teaser: others[0] ?? null, weather: false, empty: false };
}

/** What to show in the "Za m:ss" line for the break planned at `ctx.now`; null when nothing is coming. */
export function upcomingStory(ctx: BreakContext): QueuedStory | null {
  const plan = planBreak(ctx);
  return plan.full[0] ?? plan.teaser;
}

export const hasWeatherPlace = (place: WeatherPlace | null): place is WeatherPlace =>
  Boolean(place && (place.city.trim() || (place.lat !== null && place.lon !== null)));

export function weatherQuery(place: WeatherPlace, stationId: string): string {
  const params = new URLSearchParams({ station: stationId });
  if (place.city.trim()) params.set('city', place.city.trim());
  if (place.lat !== null && place.lon !== null) {
    params.set('lat', place.lat.toFixed(3));
    params.set('lon', place.lon.toFixed(3));
  }
  return params.toString();
}

export interface ClipOptions {
  hhmm: string;
  stationId: string;
  place: WeatherPlace | null;
  /** One pill unit (see pillQueue.splitUnits) aired after the news; alone it makes a pill-only break. */
  pillUnit?: PillPart[] | null;
}

/** Ordered audio of one break. Every clip may 404 on an older server: the engine skips what it cannot load. */
export function breakClips(plan: BreakPlan, options: ClipOptions): BreakClip[] {
  const { hhmm, stationId, place } = options;
  const clips: BreakClip[] = [];
  if (!plan.empty) {
    clips.push({ role: 'intro', path: `/radio-api/intro.wav?time=${hhmm}&station=${stationId}&kind=${plan.kind}` });
  }
  for (const story of plan.headlines) {
    clips.push({ role: 'headline', path: `/radio-api/story/${story.id}/headline.wav`, storyId: story.id });
  }
  for (const story of plan.full) {
    clips.push({ role: 'story', path: `/radio-api/story/${story.id}.wav`, storyId: story.id });
  }
  if (plan.weather && hasWeatherPlace(place)) {
    clips.push({ role: 'weather', path: `/radio-api/weather.wav?${weatherQuery(place, stationId)}` });
  }
  if (plan.teaser) {
    const query = new URLSearchParams({ story: plan.teaser.id, station: stationId });
    clips.push({ role: 'teaser', path: `/radio-api/teaser.wav?${query}`, storyId: plan.teaser.id });
  }
  for (const part of options.pillUnit ?? []) clips.push({ role: 'pill', path: part.url });
  return clips;
}
