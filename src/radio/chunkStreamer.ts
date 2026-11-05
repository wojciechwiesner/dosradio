/**
 * Gapless player for the 30-second Opus segments served by /radio-api/station/{id}/next-chunk.
 *
 * - start() resolves as soon as the first segment is scheduled (true) or could not be loaded (false);
 *   the feed loop keeps running in the background and never blocks the caller.
 * - Segments are requested in order (?after=<last segment>), so consecutive 30 s pieces of one
 *   recording play as continuous music instead of random, repeating snippets.
 * - Each segment gets a short fade in/out and overlaps the next one, which hides encoder edges.
 */

const FADE_S = 0.08;
const SCHEDULE_AHEAD_S = 15;
const FAILURES_BEFORE_ERROR = 3;

export interface ChunkInfo {
  source: 'live' | 'archive';
  hours: number;
  segment: string | null;
}

export interface ChunkStreamerEvents {
  onChunk: (info: ChunkInfo) => void;
  /** 'trial-ended' or a human-readable reason after repeated failures. */
  onError: (error: string) => void;
}

interface LoadedChunk extends ChunkInfo {
  buffer: AudioBuffer;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ChunkStreamer {
  private running = false;
  private generation = 0;
  private nextStartTime = 0;
  private lastSegment: string | null = null;
  private failures = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
    private stationId: string,
    private readonly events: ChunkStreamerEvents,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Resolves true once audio is scheduled, false when the station has nothing to play yet. */
  async start(): Promise<boolean> {
    if (this.running) return true;
    this.running = true;
    const generation = ++this.generation;
    this.nextStartTime = 0;

    const first = await this.fetchChunk();
    if (!first || generation !== this.generation || !this.running) {
      this.running = false;
      return false;
    }
    this.schedule(first);
    void this.feedLoop(generation); // background; never awaited
    return true;
  }

  stop(): void {
    this.running = false;
    this.generation++;
    const now = this.ctx.currentTime;
    for (const source of this.sources) {
      try { source.stop(now + 0.05); } catch { /* already stopped */ }
    }
    this.sources.clear();
  }

  async setStation(stationId: string): Promise<boolean> {
    if (this.stationId === stationId) return true;
    this.stationId = stationId;
    this.lastSegment = null;
    if (!this.running) return true;
    this.stop();
    return this.start();
  }

  private async feedLoop(generation: number): Promise<void> {
    while (this.running && generation === this.generation) {
      const ahead = this.nextStartTime - this.ctx.currentTime;
      if (ahead > SCHEDULE_AHEAD_S) {
        await sleep(Math.min(5000, (ahead - SCHEDULE_AHEAD_S) * 1000));
        continue;
      }
      const chunk = await this.fetchChunk();
      if (!this.running || generation !== this.generation) return;
      if (chunk) {
        this.schedule(chunk);
      } else {
        await sleep(1500);
      }
    }
  }

  private schedule(chunk: LoadedChunk): void {
    const source = this.ctx.createBufferSource();
    source.buffer = chunk.buffer;
    const fade = this.ctx.createGain();
    source.connect(fade);
    fade.connect(this.destination);

    const startAt = Math.max(this.ctx.currentTime + 0.05, this.nextStartTime);
    const duration = chunk.buffer.duration;
    fade.gain.setValueAtTime(0, startAt);
    fade.gain.linearRampToValueAtTime(1, startAt + FADE_S);
    fade.gain.setValueAtTime(1, Math.max(startAt + FADE_S, startAt + duration - FADE_S));
    fade.gain.linearRampToValueAtTime(0, startAt + duration);

    source.onended = () => {
      this.sources.delete(source);
      fade.disconnect();
    };
    source.start(startAt);
    this.sources.add(source);
    this.nextStartTime = startAt + duration - FADE_S;
    this.events.onChunk({ source: chunk.source, hours: chunk.hours, segment: chunk.segment });
  }

  private async fetchChunk(): Promise<LoadedChunk | null> {
    const after = this.lastSegment ? `&after=${encodeURIComponent(this.lastSegment)}` : '';
    try {
      const response = await fetch(`/radio-api/station/${this.stationId}/next-chunk?live_prob=0.3${after}`, {
        credentials: 'same-origin',
      });
      if (response.status === 402) {
        this.events.onError('trial-ended');
        this.stop();
        return null;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const segment = response.headers.get('x-dosradio-segment');
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      this.lastSegment = segment;
      this.failures = 0;
      return {
        buffer,
        segment,
        source: (response.headers.get('x-dosradio-source') || 'archive') as 'live' | 'archive',
        hours: parseFloat(response.headers.get('x-dosradio-hours') || '0'),
      };
    } catch (error) {
      this.failures++;
      if (this.failures >= FAILURES_BEFORE_ERROR) {
        this.failures = 0;
        this.events.onError(`Muzyka: ${(error as Error).message}`);
      }
      return null;
    }
  }
}
