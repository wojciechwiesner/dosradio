/** Pure parts of "Losuj stację": weighted random pick, recent-picks memory, shake detector. No DOM. */

export const RECENT_LIMIT = 5;
export const SHAKE_DELTA_MS2 = 18; // m/s² change between two consecutive samples that counts as a peak
export const SHAKE_PEAKS_NEEDED = 2;
export const SHAKE_WINDOW_MS = 600;
export const SHAKE_MIN_PEAK_GAP_MS = 60; // consecutive samples of one jolt must not count as two peaks
export const SHAKE_COOLDOWN_MS = 2500;

export interface PickCandidate { id: string }

/**
 * Random station other than `currentId`, steered away from `recentIds` (newest first).
 * Recent picks are excluded while any fresh station remains; otherwise the oldest pick is the most likely.
 * `random` returns [0, 1) and is injectable for tests.
 */
export function pickShuffleStation<T extends PickCandidate>(
  candidates: readonly T[],
  currentId: string,
  recentIds: readonly string[],
  random: () => number = Math.random,
): T | null {
  const others = candidates.filter((c) => c.id !== currentId);
  if (!others.length) return null;
  const recent = recentIds.slice(0, RECENT_LIMIT);
  const fresh = others.filter((c) => !recent.includes(c.id));
  if (fresh.length) return fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))];
  // Everything was picked lately: weight by age (index in recent = newer = lighter).
  const weights = others.map((c) => Math.max(1, recent.indexOf(c.id) + 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = random() * total;
  for (let i = 0; i < others.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return others[i];
  }
  return others[others.length - 1];
}

export function pushRecent(recentIds: readonly string[], id: string): string[] {
  return [id, ...recentIds.filter((r) => r !== id)].slice(0, RECENT_LIMIT);
}

export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Feed accelerometer samples (incl. gravity); returns true when a shake gesture completes. */
export class ShakeDetector {
  private last: [number, number, number] | null = null;
  private peaks: number[] = [];
  private blockedUntil = -Infinity;

  feed(x: number, y: number, z: number, now: number): boolean {
    const prev = this.last;
    this.last = [x, y, z];
    if (!prev || now < this.blockedUntil) return false;
    const delta = Math.hypot(x - prev[0], y - prev[1], z - prev[2]);
    if (delta <= SHAKE_DELTA_MS2) return false;
    const lastPeak = this.peaks[this.peaks.length - 1];
    if (lastPeak !== undefined && now - lastPeak < SHAKE_MIN_PEAK_GAP_MS) return false;
    this.peaks = [...this.peaks.filter((t) => now - t <= SHAKE_WINDOW_MS), now];
    if (this.peaks.length < SHAKE_PEAKS_NEEDED) return false;
    this.peaks = [];
    this.blockedUntil = now + SHAKE_COOLDOWN_MS;
    return true;
  }
}
