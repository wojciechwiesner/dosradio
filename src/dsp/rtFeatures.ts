/**
 * Real-Time Audio Feature Extractor for Lyria RT & JEV Decision Engine.
 *
 * Computes essential psychoacoustic and signal metrics from a mono Float32Array:
 * - RMS, peak, and crest factor in dBFS
 * - Clip counter (|sample| >= 0.999)
 * - Sub bass energy ratio (20-60 Hz) / total energy
 * - Mid-frequency tonal energy ratio (250 Hz - 2.5 kHz) / total energy
 *
 * Mid tonality uses spectral flatness (Wiener entropy) across Hann-windowed FFT bins:
 * tonal energy = midBandEnergy * (1 - SFM), where SFM is geometric / arithmetic mean.
 */

export interface AudioFeatures {
  rmsDb: number;
  peakDb: number;
  crestDb: number;
  clipCount: number;
  midTonalRatio: number;
  subRatio: number;
}

/**
 * Radix-2 In-place Cooley-Tukey FFT.
 */
function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tr = real[i]; real[i] = real[j]; real[j] = tr;
      let ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepReal = Math.cos(angle);
    const wStepImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;
      for (let j = 0; j < half; j++) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + half] * wReal - imag[i + j + half] * wImag;
        const vImag = real[i + j + half] * wImag + imag[i + j + half] * wReal;
        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + half] = uReal - vReal;
        imag[i + j + half] = uImag - vImag;
        const nextWReal = wReal * wStepReal - wImag * wStepImag;
        wImag = wReal * wStepImag + wImag * wStepReal;
        wReal = nextWReal;
      }
    }
  }
}

/**
 * Extract time-domain and frequency-domain features from a mono signal buffer.
 */
export function computeRtFeatures(signal: Float32Array, sampleRate = 48000): AudioFeatures {
  const n = signal.length;
  if (n === 0) return { rmsDb: -120, peakDb: -120, crestDb: 0, clipCount: 0, midTonalRatio: 0, subRatio: 0 };

  let sumSq = 0;
  let peak = 0;
  let clipCount = 0;
  for (let i = 0; i < n; i++) {
    const abs = Math.abs(signal[i]);
    sumSq += abs * abs;
    if (abs > peak) peak = abs;
    if (abs >= 0.999) clipCount++;
  }

  const rms = Math.sqrt(sumSq / n);
  const rmsDb = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  const peakDb = peak > 1e-6 ? 20 * Math.log10(peak) : -120;
  const crestDb = Math.max(0, peakDb - rmsDb);

  const nFft = Math.min(4096, 1 << Math.floor(Math.log2(n)));
  if (nFft < 256 || rms < 1e-6) {
    return { rmsDb, peakDb, crestDb, clipCount, midTonalRatio: 0, subRatio: 0 };
  }

  const hop = nFft >> 1;
  const numFrames = Math.min(8, Math.max(1, Math.floor((n - nFft) / hop) + 1));
  const psd = new Float64Array(nFft / 2);
  let totalPsdEnergy = 0;

  const win = new Float32Array(nFft);
  let winSumSq = 0;
  for (let i = 0; i < nFft; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / nFft));
    winSumSq += win[i] * win[i];
  }

  for (let f = 0; f < numFrames; f++) {
    const offset = Math.floor((f * (n - nFft)) / Math.max(1, numFrames - 1));
    const real = new Float32Array(nFft);
    const imag = new Float32Array(nFft);
    for (let i = 0; i < nFft; i++) real[i] = signal[offset + i] * win[i];
    fft(real, imag);
    for (let k = 0; k < nFft / 2; k++) {
      const p = (real[k] * real[k] + imag[k] * imag[k]) / (nFft * winSumSq);
      psd[k] += p;
      totalPsdEnergy += p;
    }
  }

  const binHz = sampleRate / nFft;
  let subEnergy = 0;
  let midEnergy = 0;
  const midBins: number[] = [];

  for (let k = 1; k < nFft / 2; k++) {
    const freq = k * binHz;
    if (freq >= 20 && freq <= 60) subEnergy += psd[k];
    if (freq >= 250 && freq <= 2500) {
      midEnergy += psd[k];
      midBins.push(psd[k]);
    }
  }

  let tonalMidEnergy = 0;
  if (midBins.length > 0 && midEnergy > 0) {
    let logSum = 0;
    let sum = 0;
    for (let i = 0; i < midBins.length; i++) {
      sum += midBins[i];
      logSum += Math.log(midBins[i] + 1e-18);
    }
    const geomMean = Math.exp(logSum / midBins.length);
    const arithMean = sum / midBins.length;
    const sfm = geomMean / (arithMean + 1e-18);
    const tonality = Math.max(0, Math.min(1, 1 - sfm));
    tonalMidEnergy = midEnergy * tonality;
  }

  return {
    rmsDb,
    peakDb,
    crestDb,
    clipCount,
    midTonalRatio: totalPsdEnergy > 0 ? tonalMidEnergy / totalPsdEnergy : 0,
    subRatio: totalPsdEnergy > 0 ? subEnergy / totalPsdEnergy : 0,
  };
}

/**
 * Ring buffer tracking the last N seconds of PCM stream for JEV feature measurement.
 */
export class PcmRingBuffer {
  private buffer: Float32Array;
  private writeIndex = 0;

  constructor(seconds = 2, private sampleRate = 48000) {
    this.buffer = new Float32Array(seconds * sampleRate);
  }

  public recordInt16Stereo(raw: Uint8Array): void {
    const int16 = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
    const numFrames = Math.floor(int16.length / 2);
    const ring = this.buffer;
    let idx = this.writeIndex;
    for (let i = 0; i < numFrames; i++) {
      ring[idx] = (int16[i * 2] + int16[i * 2 + 1]) / 65536;
      idx = (idx + 1) % ring.length;
    }
    this.writeIndex = idx;
  }

  public getFeatures(): AudioFeatures {
    const ring = this.buffer;
    const len = ring.length;
    const snapshot = new Float32Array(len);
    snapshot.set(ring.subarray(this.writeIndex));
    snapshot.set(ring.subarray(0, this.writeIndex), len - this.writeIndex);
    return computeRtFeatures(snapshot, this.sampleRate);
  }
}
