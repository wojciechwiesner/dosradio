import { describe, it, expect } from 'vitest';
import { ToneTracker, findTonePeaks, TONE_WINDOW_SCANS, TONE_RELEASE_SCANS } from '../src/dsp/toneTrack';

const FFT = 4096;
const SAMPLE_RATE = 48000;
const HZ_PER_BIN = SAMPLE_RATE / FFT;
const BINS = FFT / 2;
const FLOOR_DB = -80;
const PEAK_DB = -45;

/** Deterministic pseudo-random jitter (+-3 dB) so the floor is not perfectly flat. */
function makeJitter(): () => number {
  let seed = 12345;
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return (seed / 4294967296 - 0.5) * 6;
  };
}

/** One synthetic magnitude spectrum (dB per bin) with narrow peaks at the given bins. */
function spectrum(jitter: () => number, peakBins: number[]): Float32Array {
  const db = new Float32Array(BINS);
  for (let k = 0; k < BINS; k++) db[k] = FLOOR_DB + jitter();
  for (const bin of peakBins) {
    db[bin - 1] = PEAK_DB - 12;
    db[bin] = PEAK_DB;
    db[bin + 1] = PEAK_DB - 12;
  }
  return db;
}

const binOf = (hz: number) => Math.round(hz / HZ_PER_BIN);

function run(scans: number, peaksAt: (scan: number) => number[]) {
  const jitter = makeJitter();
  const tracker = new ToneTracker(HZ_PER_BIN);
  let confirmed = tracker.update([]);
  for (let scan = 0; scan < scans; scan++) {
    confirmed = tracker.update(findTonePeaks(spectrum(jitter, peaksAt(scan)), HZ_PER_BIN));
  }
  return confirmed;
}

describe('findTonePeaks', () => {
  it('finds a narrow peak 35 dB over the floor and nothing in plain noise', () => {
    const jitter = makeJitter();
    const found = findTonePeaks(spectrum(jitter, [binOf(2500)]), HZ_PER_BIN);
    expect(found.map((p) => p.bin)).toEqual([binOf(2500)]);
    expect(findTonePeaks(spectrum(jitter, []), HZ_PER_BIN)).toEqual([]);
  });
});

describe('ToneTracker', () => {
  it('confirms a steady 2500 Hz tone after the window fills', () => {
    const confirmed = run(TONE_WINDOW_SCANS, () => [binOf(2500)]);
    expect(confirmed).toHaveLength(1);
    expect(Math.abs(confirmed[0].hz - 2500)).toBeLessThan(HZ_PER_BIN);
  });

  it('confirms a steady 469 Hz tone (the archive whine sits below the old 1 kHz limit)', () => {
    const confirmed = run(TONE_WINDOW_SCANS, () => [binOf(469)]);
    expect(Math.abs(confirmed[0].hz - 469)).toBeLessThan(HZ_PER_BIN);
  });

  it('does not confirm a tone before the window is filled', () => {
    expect(run(TONE_WINDOW_SCANS / 2, () => [binOf(2500)])).toEqual([]);
  });

  it('never confirms a moving partial', () => {
    // A glide: the peak moves 3 bins every scan, never holding a bin.
    const confirmed = run(TONE_WINDOW_SCANS * 2, (scan) => [binOf(1000) + (scan % 60) * 3]);
    expect(confirmed).toEqual([]);
  });

  it('never confirms notes that change every second', () => {
    const notes = [binOf(600), binOf(900), binOf(1300), binOf(1800)];
    const confirmed = run(TONE_WINDOW_SCANS * 2, (scan) => [notes[Math.floor(scan / 10) % notes.length]]);
    expect(confirmed).toEqual([]);
  });

  it('releases a tone after it has been gone for the release time', () => {
    const jitter = makeJitter();
    const tracker = new ToneTracker(HZ_PER_BIN);
    for (let scan = 0; scan < TONE_WINDOW_SCANS; scan++) tracker.update(findTonePeaks(spectrum(jitter, [binOf(2500)]), HZ_PER_BIN));
    let confirmed = tracker.update(findTonePeaks(spectrum(jitter, []), HZ_PER_BIN));
    expect(confirmed).toHaveLength(1); // a short gap keeps the notch
    for (let scan = 0; scan < TONE_RELEASE_SCANS; scan++) confirmed = tracker.update(findTonePeaks(spectrum(jitter, []), HZ_PER_BIN));
    expect(confirmed).toEqual([]);
  });
});
