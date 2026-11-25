/**
 * Host moments between songs. First choice is the live break from the server (a listener
 * comment read on air, or a persona link written for this hour); when there is none, or
 * this listener already heard it, a random static jingle/chatter clip plays as before.
 * Pure scheduling lives in radioClock.ts; this class only owns the timer and the pick.
 */
import { radioApi, type HostClips } from './radioApi';
import { nextHostClipDelayMs } from './radioClock';

const BUSY_RETRY_MS = 30_000;

export interface HostClipHooks {
  stationId: () => string;
  canPlay: () => boolean; // playing, host mode on, nothing else speaking
  play: (url: string) => Promise<void>;
}

export class HostClipPlayer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clips: HostClips | null = null;
  private clipsStation = '';
  private heardBreaks = new Set<string>();

  constructor(private readonly hooks: HostClipHooks, private readonly random: () => number = Math.random) {}

  start(): void {
    this.stop();
    this.schedule(nextHostClipDelayMs(this.random));
  }

  /** A listener just sent a comment: check for a live break sooner than the usual gap. */
  soon(delayMs: number): void {
    this.stop();
    this.schedule(delayMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.hooks.canPlay()) return this.schedule(BUSY_RETRY_MS);
    const url = await this.pickClipUrl();
    if (url && this.hooks.canPlay()) {
      try { await this.hooks.play(url); } catch { /* silently keep the old behaviour */ }
    }
    this.schedule(nextHostClipDelayMs(this.random));
  }

  /** URL of the server's live break if this listener has not heard it yet. */
  async freshLiveUrl(stationId: string): Promise<string | null> {
    const live = await radioApi.hostBreak(stationId);
    if (!live || this.heardBreaks.has(live.id)) return null;
    this.heardBreaks.add(live.id);
    return live.url;
  }

  private async pickClipUrl(): Promise<string | null> {
    const stationId = this.hooks.stationId();
    const live = await this.freshLiveUrl(stationId);
    if (live) return live;
    if (this.clipsStation !== stationId || !this.clips) {
      this.clips = await radioApi.hostClips(stationId);
      this.clipsStation = stationId;
    }
    const all = [...(this.clips?.jingles ?? []), ...(this.clips?.chatter ?? [])];
    return all.length ? all[Math.floor(this.random() * all.length)] : null;
  }
}
