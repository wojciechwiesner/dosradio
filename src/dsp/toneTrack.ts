// SPEC-START: ToneTracker - detection of steady pitched artifacts (the Lyria "whine")
// Lyria RealTime drifts into a narrow tone that stays on the SAME frequency for seconds (measured on the
// DOS Radio archive: 463-469 Hz, 1318-1336 Hz, 1986-1998 Hz at +33 dB). Musical notes and Lyria's normal
// partials move or stop within a bar. So a peak is confirmed only when it is prominent AND sits on the same
// bin for most of a multi-second window. Pure logic (no Web Audio) so it runs in unit tests.
// Ported from synthapse src/dsp/toneTrack.ts (commit d77b54f), band widened to 300 Hz - 16 kHz.
// SPEC-END

export const TONE_LO_HZ = 300;           // the archive whine starts around 460 Hz
export const TONE_HI_HZ = 16000;
export const TONE_MIN_PROMINENCE_DB = 12; // peak over the median of +-NEIGHBOUR_HZ around it
export const TONE_NEIGHBOUR_HZ = 300;
export const TONE_FLOOR_DB = -90;        // ignore peaks quieter than this (dBFS per bin)
export const TONE_WINDOW_SCANS = 40;     // 4 s at the 100 ms scan cadence
export const TONE_CONFIRM_SHARE = 0.8;   // present in >= 80 % of the window
export const TONE_RELEASE_SCANS = 30;    // 3 s without the tone before a notch is released
const SAME_TONE_BINS = 1;                // a steady tone may land on the neighbouring bin

export interface TonePeak { bin: number; prominenceDb: number }
export interface ConfirmedTone { bin: number; hz: number; prominenceDb: number }

/** Narrow peaks in one magnitude spectrum (dB per bin, as AnalyserNode.getFloatFrequencyData). */
export function findTonePeaks(db: Float32Array, hzPerBin: number): TonePeak[] {
  const half = Math.max(4, Math.round(TONE_NEIGHBOUR_HZ / hzPerBin));
  const lo = Math.max(half, Math.round(TONE_LO_HZ / hzPerBin));
  const hi = Math.min(db.length - half - 1, Math.round(TONE_HI_HZ / hzPerBin));
  const peaks: TonePeak[] = [];
  const neigh: number[] = [];
  for (let k = lo; k <= hi; k++) {
    const v = db[k];
    if (!(v > TONE_FLOOR_DB) || v < db[k - 1] || v < db[k + 1]) continue;
    neigh.length = 0;
    for (let j = k - half; j <= k + half; j++) if (Math.abs(j - k) > 2 && Number.isFinite(db[j])) neigh.push(db[j]);
    neigh.sort((a, b) => a - b);
    const prominenceDb = v - neigh[neigh.length >> 1];
    if (prominenceDb >= TONE_MIN_PROMINENCE_DB) peaks.push({ bin: k, prominenceDb });
  }
  return peaks;
}

interface Track { hits: number[]; lastProminenceDb: number; missing: number; confirmed: boolean }

/** Follows peaks across scans; a tone is confirmed when it holds its bin through most of the window. */
export class ToneTracker {
  private tracks = new Map<number, Track>();

  constructor(private readonly hzPerBin: number) {}

  /** Feed one scan; returns the tones that are confirmed after it. */
  update(peaks: TonePeak[]): ConfirmedTone[] {
    const matched = new Set<number>();
    for (const p of peaks) {
      let key = p.bin;
      for (const k of this.tracks.keys()) if (Math.abs(k - p.bin) <= SAME_TONE_BINS) { key = k; break; }
      if (matched.has(key)) continue;
      matched.add(key);
      const t = this.tracks.get(key) ?? { hits: [], lastProminenceDb: 0, missing: 0, confirmed: false };
      t.lastProminenceDb = p.prominenceDb;
      this.tracks.set(key, t);
    }
    const out: ConfirmedTone[] = [];
    for (const [bin, t] of this.tracks) {
      const hit = matched.has(bin) ? 1 : 0;
      t.hits.push(hit);
      if (t.hits.length > TONE_WINDOW_SCANS) t.hits.shift();
      t.missing = hit ? 0 : t.missing + 1;
      const share = t.hits.reduce((a, b) => a + b, 0) / TONE_WINDOW_SCANS;
      if (!t.confirmed && share >= TONE_CONFIRM_SHARE) t.confirmed = true;
      if (t.confirmed && t.missing >= TONE_RELEASE_SCANS) t.confirmed = false;
      if (!t.confirmed && t.hits.every((h) => h === 0)) { this.tracks.delete(bin); continue; }
      if (t.confirmed) out.push({ bin, hz: bin * this.hzPerBin, prominenceDb: t.lastProminenceDb });
    }
    return out.sort((a, b) => b.prominenceDb - a.prominenceDb);
  }

  reset(): void { this.tracks.clear(); }
}
