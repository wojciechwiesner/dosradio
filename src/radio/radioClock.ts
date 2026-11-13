/**
 * Pure time helpers for DOS Radio: spoken Polish time and the break schedule.
 * No DOM, no audio: fully unit-testable.
 */

const HOURS_PL = [
  'zero', 'pierwsza', 'druga', 'trzecia', 'czwarta', 'piąta', 'szósta', 'siódma',
  'ósma', 'dziewiąta', 'dziesiąta', 'jedenasta', 'dwunasta', 'trzynasta', 'czternasta',
  'piętnasta', 'szesnasta', 'siedemnasta', 'osiemnasta', 'dziewiętnasta', 'dwudziesta',
  'dwudziesta pierwsza', 'dwudziesta druga', 'dwudziesta trzecia',
];

const UNITS_PL = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const TEENS_PL = [
  'dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście',
  'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście',
];
const TENS_PL = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt'];

function minutesToWords(minutes: number): string {
  if (minutes === 0) return 'zero zero';
  if (minutes < 10) return `zero ${UNITS_PL[minutes]}`;
  if (minutes < 20) return TEENS_PL[minutes - 10];
  const tens = TENS_PL[Math.floor(minutes / 10)];
  const units = UNITS_PL[minutes % 10];
  return units ? `${tens} ${units}` : tens;
}

/** "14:20" -> "czternasta dwadzieścia" (radio style, always hour first). */
export function spokenTimePl(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`invalid time ${hours}:${minutes}`); // autocheck spot
  }
  return `${HOURS_PL[hours]} ${minutesToWords(minutes)}`;
}

/** Minutes between news breaks: any whole number from 1 to 60, chosen by the listener. */
export type BreakInterval = number;
export const MIN_BREAK_INTERVAL = 1;
export const MAX_BREAK_INTERVAL = 60;
/** Quick picks shown in onboarding; the settings slider allows every minute in between. */
export const BREAK_INTERVALS: readonly BreakInterval[] = [1, 3, 5, 10, 15, 30, 60];
export const DEFAULT_BREAK_INTERVAL: BreakInterval = 5;

/** Any stored value is rounded and clamped to 1..60; garbage falls back to the default. */
export function normalizeInterval(value: unknown): BreakInterval {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes) || value === null || value === '' || typeof value === 'boolean') return DEFAULT_BREAK_INTERVAL;
  return Math.min(MAX_BREAK_INTERVAL, Math.max(MIN_BREAK_INTERVAL, minutes));
}

/** Human label: "Co minutę", "Co 3 minuty", "Co 5 minut", "Co godzinę". */
export function intervalLabel(minutes: BreakInterval): string {
  if (minutes === 60) return 'Co godzinę';
  if (minutes === 1) return 'Co minutę';
  const lastDigit = minutes % 10;
  const lastTwo = minutes % 100;
  const few = lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14);
  return `Co ${minutes} ${few ? 'minuty' : 'minut'}`;
}

const MS_PER_MINUTE = 60_000;
/** The first news break comes this long after the listener pressed play. */
export const FIRST_BREAK_DELAY_MS = 5 * MS_PER_MINUTE;

export interface BreakSchedule {
  startedAt: Date;
  lastBreakAt: Date | null;
  interval: BreakInterval;
  firstBreakDelayMs?: number;
  /** When the previous break finished speaking; music always gets MIN_MUSIC_BETWEEN_MS after it. */
  lastBreakEndedAt?: Date | null;
}

/** Whatever speaks (news, pill, jingle, chatter) is followed and preceded by at least this much music. */
export const MIN_MUSIC_BETWEEN_MS = 2 * MS_PER_MINUTE;

/** Rough length of a host clip, so a clip is not started right before a break would be due. */
export const CLIP_ALLOWANCE_MS = 30 * 1000;

/**
 * May a host clip start now? Needs MIN_MUSIC_BETWEEN_MS of music since the last spoken item and
 * enough room before the next break (music gap + the clip itself).
 */
export function canSpeakNow(now: Date, lastSpokeEndedAt: Date | null, nextBreakAt: Date | null): boolean {
  if (lastSpokeEndedAt && now.getTime() - lastSpokeEndedAt.getTime() < MIN_MUSIC_BETWEEN_MS) return false;
  if (nextBreakAt && nextBreakAt.getTime() - now.getTime() < MIN_MUSIC_BETWEEN_MS + CLIP_ALLOWANCE_MS) return false;
  return true;
}

/**
 * Listener-relative schedule: first break at start + delay, every later break `interval`
 * minutes after the previous one (not aligned to the wall clock).
 */
export function nextScheduledBreak(schedule: BreakSchedule): Date {
  const { startedAt, lastBreakAt, interval, firstBreakDelayMs = FIRST_BREAK_DELAY_MS } = schedule;
  const afterMusic = schedule.lastBreakEndedAt ? schedule.lastBreakEndedAt.getTime() + MIN_MUSIC_BETWEEN_MS : 0;
  const byInterval = lastBreakAt ? lastBreakAt.getTime() + interval * MS_PER_MINUTE : startedAt.getTime() + firstBreakDelayMs;
  return new Date(Math.max(byInterval, afterMusic));
}

/** Random pause before the next host clip: 6-12 minutes. `random` is injectable for tests. */
export const HOST_CLIP_MIN_MS = 6 * MS_PER_MINUTE;
export const HOST_CLIP_MAX_MS = 12 * MS_PER_MINUTE;
export function nextHostClipDelayMs(random: () => number = Math.random): number {
  return HOST_CLIP_MIN_MS + Math.floor(random() * (HOST_CLIP_MAX_MS - HOST_CLIP_MIN_MS + 1));
}

/**
 * Next break strictly after `now`, aligned to the clock (:00, :20, :40 for 20 min).
 * Focus mode only keeps the top-of-hour break.
 */
export function nextBreakAt(now: Date, interval: BreakInterval, focus = false): Date {
  const step = focus ? 60 : interval;
  const next = new Date(now.getTime());
  next.setSeconds(0, 0);
  const minutesIntoHour = next.getMinutes();
  const nextSlot = (Math.floor(minutesIntoHour / step) + 1) * step;
  next.setMinutes(nextSlot); // setMinutes(60) rolls over to the next hour
  if (next.getTime() <= now.getTime()) throw new Error('break schedule went backwards'); // autocheck spot
  return next;
}

/** Milliseconds until the next break, never negative. */
export function msUntilNextBreak(now: Date, interval: BreakInterval, focus = false): number {
  return Math.max(0, nextBreakAt(now, interval, focus).getTime() - now.getTime());
}
