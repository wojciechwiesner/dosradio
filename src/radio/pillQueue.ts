/**
 * Programme queue of YouTube pills. A pill is aired one "unit" per news break, after the news:
 * a bumper is a unit on its own, a voice summary and the clip it introduces stay together.
 * Pure (no DOM, no audio); the queue is persisted in localStorage so a reload keeps it.
 */

export const PILL_QUEUE_KEY = 'dosradio.pillQueue.v1';
export const MAX_QUEUED_PILLS = 10;

export interface PillPart {
  kind: string;
  url: string;
}

export interface QueuedPill {
  pillId: string;
  title: string;
  parts: PillPart[];
  /** Index of the first part that has not aired yet. */
  nextIndex: number;
}

export interface PillProgress {
  pillId: string;
  title: string;
  /** Parts already aired. */
  done: number;
  total: number;
}

export type PillStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Splits parts into airing units: [bumper], [voice, clip], [bumper]. A stray voice or clip airs alone. */
export function splitUnits(parts: PillPart[]): PillPart[][] {
  const units: PillPart[][] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const next = parts[index + 1];
    if (part.kind === 'voice' && next?.kind === 'clip') {
      units.push([part, next]);
      index++;
    } else {
      units.push([part]);
    }
  }
  return units;
}

const isPart = (value: unknown): value is PillPart =>
  typeof value === 'object' && value !== null
  && typeof (value as PillPart).kind === 'string' && typeof (value as PillPart).url === 'string';

function parseQueue(raw: string | null): QueuedPill[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is QueuedPill =>
      typeof item?.pillId === 'string' && typeof item.title === 'string' && Array.isArray(item.parts)
      && item.parts.every(isPart) && Number.isInteger(item.nextIndex) && item.nextIndex >= 0
      && item.nextIndex < item.parts.length);
  } catch {
    return []; // missing or corrupted: start with an empty programme
  }
}

export class PillQueue {
  private items: QueuedPill[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: PillStorage) {
    this.items = parseQueue(storage.getItem(PILL_QUEUE_KEY));
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Adds a pill at the end of the programme; false when it is already queued, empty or the queue is full. */
  enqueue(pill: { id: string; title: string; parts: PillPart[] }): boolean {
    if (!pill.parts.length || this.items.length >= MAX_QUEUED_PILLS) return false;
    if (this.items.some((item) => item.pillId === pill.id)) return false;
    this.items.push({ pillId: pill.id, title: pill.title, parts: pill.parts, nextIndex: 0 });
    this.save();
    return true;
  }

  remove(pillId: string): void {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.pillId !== pillId);
    if (this.items.length !== before) this.save();
  }

  /** The unit the next break airs (first pill, its next unit); null when the programme has no pill. */
  peekUnit(): PillPart[] | null {
    const head = this.items[0];
    if (!head) return null;
    return splitUnits(head.parts.slice(head.nextIndex))[0] ?? null;
  }

  /** The head pill's next unit has aired (or was skipped): move on, drop the pill after its last part. */
  commitUnit(): void {
    const head = this.items[0];
    const unit = this.peekUnit();
    if (!head || !unit) return;
    head.nextIndex += unit.length;
    if (head.nextIndex >= head.parts.length) this.items.shift();
    this.save();
  }

  progress(): PillProgress[] {
    return this.items.map((item) => ({
      pillId: item.pillId, title: item.title, done: item.nextIndex, total: item.parts.length,
    }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(): void {
    try {
      this.storage.setItem(PILL_QUEUE_KEY, JSON.stringify(this.items));
    } catch { /* storage full or blocked: the programme still works for this session */ }
    this.listeners.forEach((listener) => listener());
  }
}
