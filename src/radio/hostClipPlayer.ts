/**
 * Random host jingles and chatter between songs. Pure scheduling lives in radioClock.ts;
 * this class only owns the timer and the "pick a clip" decision.
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

  constructor(private readonly hooks: HostClipHooks, private readonly random: () => number = Math.random) {}

  start(): void {
    this.stop();
    this.schedule(nextHostClipDelayMs(this.random));
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

  private async pickClipUrl(): Promise<string | null> {
    const stationId = this.hooks.stationId();
    if (this.clipsStation !== stationId || !this.clips) {
      this.clips = await radioApi.hostClips(stationId);
      this.clipsStation = stationId;
    }
    const all = [...(this.clips?.jingles ?? []), ...(this.clips?.chatter ?? [])];
    return all.length ? all[Math.floor(this.random() * all.length)] : null;
  }
}
