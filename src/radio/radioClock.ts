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

export const BREAK_INTERVALS = [5, 10, 15, 20, 30, 60] as const;
export type BreakInterval = (typeof BREAK_INTERVALS)[number];
export const DEFAULT_BREAK_INTERVAL: BreakInterval = 20;

/** Old or corrupted stored values fall back to the default; every old valid value (20/30/60) stays valid. */
export function normalizeInterval(value: unknown): BreakInterval {
  return (BREAK_INTERVALS as readonly unknown[]).includes(value) ? (value as BreakInterval) : DEFAULT_BREAK_INTERVAL;
}

const MS_PER_MINUTE = 60_000;
/** The first news break comes this long after the listener pressed play. */
export const FIRST_BREAK_DELAY_MS = 5 * MS_PER_MINUTE;

export interface BreakSchedule {
  startedAt: Date;
  lastBreakAt: Date | null;
  interval: BreakInterval;
  firstBreakDelayMs?: number;
}

/**
 * Listener-relative schedule: first break at start + delay, every later break `interval`
 * minutes after the previous one (not aligned to the wall clock).
 */
export function nextScheduledBreak(schedule: BreakSchedule): Date {
  const { startedAt, lastBreakAt, interval, firstBreakDelayMs = FIRST_BREAK_DELAY_MS } = schedule;
  if (!lastBreakAt) return new Date(startedAt.getTime() + firstBreakDelayMs);
  return new Date(lastBreakAt.getTime() + interval * MS_PER_MINUTE);
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
