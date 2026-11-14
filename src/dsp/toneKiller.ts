// SPEC-START: ToneKiller - automatic removal of steady pitched artifacts (the Lyria "whine")
// Detects with ToneTracker on each channel separately and removes a confirmed tone with a narrow notch
// (Q 30) on both channels. Notches ramp in/out over 80 ms (no clicks) and are released after the tone has
// been gone for 3 s. Sits on the MUSIC bus only (never on voice), so every music path is covered.
// Ported from synthapse src/dsp/toneKiller.ts (commit d77b54f).
// SPEC-END
import { ToneTracker, findTonePeaks, type ConfirmedTone } from './toneTrack';

const FFT_SIZE = 4096;
const SCAN_MS = 100;
const NOTCH_SLOTS = 4;
const NOTCH_Q = 30;
const NOTCH_DEPTH_DB = -36;
const RAMP_SEC = 0.08;

export interface ToneEvent { action: 'confirm' | 'release'; hz: number; channel: 'L' | 'R'; prominenceDb: number }

export class ToneKiller {
  readonly input: GainNode;
  readonly output: AudioNode;
  readonly analysers: AnalyserNode[];
  private readonly notches: BiquadFilterNode[] = [];
  private readonly slotHz: (number | null)[] = new Array(NOTCH_SLOTS).fill(null);
  private readonly trackers: ToneTracker[];
  private readonly buf: Float32Array;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = new Map<string, ConfirmedTone & { channel: 'L' | 'R' }>();

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    this.input.connect(split);
    this.analysers = [0, 1].map((c) => {
      const a = ctx.createAnalyser();
      a.fftSize = FFT_SIZE;
      a.smoothingTimeConstant = 0;
      split.connect(a, c);
      return a;
    });
    let prev: AudioNode = this.input;
    for (let i = 0; i < NOTCH_SLOTS; i++) {
      // 'peaking' with a deep negative gain = a notch whose depth can be ramped (a 'notch' biquad cannot).
      const n = ctx.createBiquadFilter();
      n.type = 'peaking';
      n.frequency.value = 1000;
      n.Q.value = NOTCH_Q;
      n.gain.value = 0;
      prev.connect(n);
      prev = n;
      this.notches.push(n);
    }
    this.output = prev;
    const hzPerBin = ctx.sampleRate / FFT_SIZE;
    this.trackers = [new ToneTracker(hzPerBin), new ToneTracker(hzPerBin)];
    this.buf = new Float32Array(FFT_SIZE / 2);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scan(), SCAN_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Tones currently notched (for HUD / telemetry). */
  get tones(): { hz: number; channel: 'L' | 'R'; prominenceDb: number }[] {
    return [...this.active.values()].map(({ hz, channel, prominenceDb }) => ({ hz: Math.round(hz), channel, prominenceDb: Math.round(prominenceDb) }));
  }

  private scan(): void {
    const hzPerBin = this.ctx.sampleRate / FFT_SIZE;
    const now = new Map<string, ConfirmedTone & { channel: 'L' | 'R' }>();
    this.analysers.forEach((a, c) => {
      a.getFloatFrequencyData(this.buf as Float32Array<ArrayBuffer>);
      const channel = c === 0 ? 'L' : 'R';
      for (const t of this.trackers[c].update(findTonePeaks(this.buf, hzPerBin))) {
        now.set(`${channel}:${t.bin}`, { ...t, channel });
      }
    });
    for (const [key, t] of now) if (!this.active.has(key)) this.emit({ action: 'confirm', hz: t.hz, channel: t.channel, prominenceDb: t.prominenceDb });
    for (const [key, t] of this.active) if (!now.has(key)) this.emit({ action: 'release', hz: t.hz, channel: t.channel, prominenceDb: t.prominenceDb });
    this.active = now;
    this.assignNotches([...now.values()].sort((a, b) => b.prominenceDb - a.prominenceDb));
  }

  private assignNotches(tones: ConfirmedTone[]): void {
    const wanted: number[] = [];
    for (const t of tones) if (!wanted.some((hz) => Math.abs(hz - t.hz) < t.hz / NOTCH_Q)) wanted.push(t.hz);
    wanted.length = Math.min(wanted.length, NOTCH_SLOTS);
    const t0 = this.ctx.currentTime;
    // Keep a slot on its frequency while that tone persists, so a notch never jumps under a playing tone.
    const keep = this.slotHz.map((hz) => (hz !== null && wanted.some((w) => Math.abs(w - hz) < hz / NOTCH_Q) ? hz : null));
    const free = wanted.filter((w) => !keep.some((hz) => hz !== null && Math.abs(w - hz) < hz / NOTCH_Q));
    keep.forEach((hz, i) => {
      const n = this.notches[i];
      if (hz === null && free.length) {
        const f = free.shift() as number;
        n.frequency.setValueAtTime(f, t0);
        n.gain.setTargetAtTime(NOTCH_DEPTH_DB, t0, RAMP_SEC / 3);
        this.slotHz[i] = f;
      } else if (hz === null) {
        n.gain.setTargetAtTime(0, t0, RAMP_SEC / 3);
        this.slotHz[i] = null;
      }
    });
  }

  private emit(detail: ToneEvent): void {
    const msg = `[ToneKiller] ${detail.action} ${Math.round(detail.hz)} Hz (${detail.channel}, +${Math.round(detail.prominenceDb)} dB)`;
    console.info(msg);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dosradio-tone', { detail }));
  }
}
