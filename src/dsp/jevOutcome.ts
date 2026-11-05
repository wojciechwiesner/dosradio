// ---------------------------------------------------------------------------
// JevOutcomeTracker — attribution for JEV decisions.
//
// A JEV decision is only useful for learning if we know what the audio did
// afterwards. For each decision this records the RT features at decision time
// and again after 2 and 3 Lyria chunks (outcomes on silence are marked valid=false) (~4 s / ~6 s), and reports the deltas.
// The rows go to the diag uplink so weights can later be fitted from real
// sessions instead of being hand-set. Pure logic: clock and timer injected.
// ---------------------------------------------------------------------------

import type { AudioFeatures } from './rtFeatures';

export const OUTCOME_DELAYS_MS = [4000, 6000];
/** Below this the stream is silent (pre-roll / underrun): deltas are meaningless. */
export const AUDIBLE_DB = -60;
const TRACKED: (keyof AudioFeatures)[] = ['rmsDb', 'peakDb', 'crestDb', 'clipCount', 'midTonalRatio', 'subRatio'];

export interface JevOutcome {
  id: string;
  action: string;
  afterMs: number;
  /** false when either side was silent: keep for audit, exclude from weight fitting */
  valid: boolean;
  before: Partial<AudioFeatures>;
  after: Partial<AudioFeatures>;
  delta: Partial<Record<keyof AudioFeatures, number>>;
}

type Timer = (fn: () => void, ms: number) => unknown;

export class JevOutcomeTracker {
  private seq = 0;

  constructor(
    private readonly features: () => AudioFeatures,
    private readonly emit: (o: JevOutcome) => void,
    private readonly timer: Timer = (fn, ms) => setTimeout(fn, ms),
  ) {}

  /** Register a decision; returns the id to stamp on the decision event. */
  track(action: string): string {
    const id = `jev-${++this.seq}`;
    const before = pick(this.features());
    for (const ms of OUTCOME_DELAYS_MS) {
      this.timer(() => {
        const after = pick(this.features());
        const delta: JevOutcome['delta'] = {};
        for (const k of TRACKED) {
          const a = after[k], b = before[k];
          if (typeof a === 'number' && typeof b === 'number') delta[k] = round(a - b);
        }
        const valid = (before.rmsDb ?? -120) > AUDIBLE_DB && (after.rmsDb ?? -120) > AUDIBLE_DB;
        this.emit({ id, action, afterMs: ms, valid, before, after, delta });
      }, ms);
    }
    return id;
  }
}

function pick(f: AudioFeatures): Partial<AudioFeatures> {
  const out: Partial<AudioFeatures> = {};
  for (const k of TRACKED) if (typeof f[k] === 'number') (out as Record<string, number>)[k] = round(f[k] as number);
  return out;
}

function round(v: number): number { return Math.round(v * 1000) / 1000; }
