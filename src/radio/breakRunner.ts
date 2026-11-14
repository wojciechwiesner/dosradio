/**
 * Plays the clips of one news break in order. Everything is decoded up front (in parallel) so the voice
 * runs without gaps; a clip that fails to load is skipped, never fatal. Generic over the buffer type for tests.
 */
import type { BreakClip } from './programme';

export interface RunnerIo<Buffer> {
  /** Resolves null (or rejects) when the clip is missing, e.g. an older server without the endpoint. */
  decode: (path: string) => Promise<Buffer | null>;
  play: (buffer: Buffer, clip: BreakClip) => Promise<void>;
  now: () => number;
}

/** Returns the clips that were really played, in order. `maxMs` stops adding clips after that much airtime. */
export async function runClips<Buffer>(clips: BreakClip[], io: RunnerIo<Buffer>, maxMs?: number): Promise<BreakClip[]> {
  const loading = clips.map((clip) => io.decode(clip.path).catch(() => null));
  const startedAt = io.now();
  const played: BreakClip[] = [];
  for (let index = 0; index < clips.length; index++) {
    if (maxMs !== undefined && played.length && io.now() - startedAt >= maxMs) break;
    const buffer = await loading[index];
    if (!buffer) continue;
    await io.play(buffer, clips[index]);
    played.push(clips[index]);
  }
  return played;
}
