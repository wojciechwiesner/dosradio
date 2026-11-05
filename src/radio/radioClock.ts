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

export type BreakInterval = 20 | 30 | 60;

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
