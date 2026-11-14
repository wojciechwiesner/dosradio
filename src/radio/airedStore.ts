/**
 * Stories the listener already heard today. Survives reloads (localStorage), resets at local midnight and,
 * for logged-in users, is merged with the server set. Server sync is best effort and never blocks audio.
 */

export const AIRED_KEY = 'dosradio.aired.v1';
export const MAX_AIRED_IDS_PER_DAY = 500;

export type AiredStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Server side of the aired set; every method may fail and returns null/false then. */
export interface AiredRemote {
  fetchIds: (day: string) => Promise<string[] | null>;
  pushIds: (day: string, ids: string[]) => Promise<string[] | null>;
}

interface AiredState {
  day: string;
  ids: string[];
}

/** Local calendar date as YYYY-MM-DD (the listener's day, not UTC). */
export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseState(raw: string | null, today: string): AiredState {
  try {
    const parsed = JSON.parse(raw ?? '') as Partial<AiredState>;
    if (parsed.day === today && Array.isArray(parsed.ids)) {
      return { day: today, ids: parsed.ids.filter((id): id is string => typeof id === 'string') };
    }
  } catch { /* missing or corrupted: start the day fresh */ }
  return { day: today, ids: [] };
}

export class AiredStore {
  private state: AiredState;

  constructor(
    private readonly storage: AiredStorage,
    private readonly now: () => Date = () => new Date(),
    private remote: AiredRemote | null = null,
  ) {
    this.state = parseState(storage.getItem(AIRED_KEY), localDay(this.now()));
  }

  /** Switch server sync on (logged in) or off (guest). */
  setRemote(remote: AiredRemote | null): void {
    this.remote = remote;
  }

  /** Live view of today's ids; safe to pass to the planner. */
  get ids(): ReadonlySet<string> {
    this.rollOverIfNewDay();
    return new Set(this.state.ids);
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    this.rollOverIfNewDay();
    if (this.state.ids.includes(id)) return;
    this.state.ids = [...this.state.ids, id].slice(-MAX_AIRED_IDS_PER_DAY);
    this.persist();
    void this.push();
  }

  /** Union with what the server knows (other devices); fail-soft. */
  async pull(): Promise<void> {
    this.rollOverIfNewDay();
    const day = this.state.day;
    const remoteIds = await this.remote?.fetchIds(day).catch(() => null);
    if (!remoteIds || day !== this.state.day) return;
    this.merge(remoteIds);
    if (this.state.ids.length > remoteIds.length) void this.push();
  }

  private async push(): Promise<void> {
    if (!this.remote) return;
    const day = this.state.day;
    const merged = await this.remote.pushIds(day, this.state.ids).catch(() => null);
    if (merged && day === this.state.day) this.merge(merged);
  }

  private merge(remoteIds: string[]): void {
    const union = [...new Set([...this.state.ids, ...remoteIds])].slice(-MAX_AIRED_IDS_PER_DAY);
    if (union.length === this.state.ids.length) return;
    this.state.ids = union;
    this.persist();
  }

  private rollOverIfNewDay(): void {
    const today = localDay(this.now());
    if (this.state.day === today) return;
    this.state = { day: today, ids: [] };
    this.persist();
  }

  private persist(): void {
    try {
      this.storage.setItem(AIRED_KEY, JSON.stringify(this.state));
    } catch { /* storage full or blocked: the in-memory set still protects this session */ }
  }
}
