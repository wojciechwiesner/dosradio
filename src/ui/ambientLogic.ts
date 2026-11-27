/** Pure logic behind the Classic ambient shader: scene mapping, audio features, host fade, frame gating. No DOM, no WebGL. */
import type { MusicGroupId, Station } from '../radio/stations';

export type SceneId = 'nature' | 'techno' | 'night' | 'focus';
export const SCENE_ORDER: readonly SceneId[] = ['nature', 'techno', 'night', 'focus'];

export const SCENE_CROSSFADE_S = 2.5;
export const HOST_FADE_IN_S = 0.6;
export const HOST_FADE_OUT_S = 1.2;
export const SHIMMER_S = 1.2;
export const IDLE_PAUSE_MS = 3000;
export const MIN_FRAME_MS = 1000 / 60 - 1;
export const MOBILE_MAX_WIDTH = 820;
export const SCALE_MOBILE = 0.6;
export const SCALE_DESKTOP = 0.75;
export const MAX_DPR = 2;
/** Techno from this BPM up when a group is not in the table. */
export const TECHNO_BPM = 118;

const BASS_BINS = 3;
const BASS_FLOOR = 0.35;
const KICK_GAIN = 8; // measured on real techno output: bass swings ~0.05-0.1 around its average per kick
const VOICE_RMS_GAIN = 4;
const ATTACK_S = 0.04;
const RELEASE_S = 0.2;
const BASS_AVG_S = 0.5; // fast enough that steady bass stops reading as a kick within ~1 s

export const GROUP_SCENE: Record<MusicGroupId, SceneId> = {
  'klasyka-instrumentalna': 'nature',
  'etno-folk': 'nature',
  'synth-filmowa': 'nature',
  'klub-energia': 'techno',
  'techno-rave': 'techno',
  'chill-noc': 'night',
  'fokus-puls': 'focus',
  'przestrzenie-b2b': 'focus',
};

const NAME_HINTS: Array<[RegExp, SceneId]> = [
  [/techno|rave|klub|club|dance|house|trance/i, 'techno'],
  [/noc|night|chill|lofi|lo-fi|jazz/i, 'night'],
  [/fokus|focus|puls|ambient|b2b|przestrze/i, 'focus'],
  [/klasy|folk|etno|natur|akust|film|orkiest/i, 'nature'],
];

/** Group id first, then the station's own group, then name hints, then BPM. */
export function sceneForStation(
  station: Pick<Station, 'name' | 'bpm' | 'group'> | null,
  groupId: MusicGroupId | string | null,
): SceneId {
  const known = (id: string | null | undefined): SceneId | null =>
    id && id in GROUP_SCENE ? GROUP_SCENE[id as MusicGroupId] : null;
  const direct = known(groupId) ?? known(station?.group);
  if (direct) return direct;
  const label = `${groupId ?? ''} ${station?.group ?? ''} ${station?.name ?? ''}`;
  for (const [pattern, scene] of NAME_HINTS) if (pattern.test(label)) return scene;
  if (station && station.bpm >= TECHNO_BPM) return 'techno';
  return 'focus';
}

export type SceneWeights = [number, number, number, number];

export function oneHot(scene: SceneId): SceneWeights {
  return SCENE_ORDER.map((id) => (id === scene ? 1 : 0)) as SceneWeights;
}

/** Moves the weights towards the target scene so a full switch takes SCENE_CROSSFADE_S. Always sums to 1. */
export function stepSceneWeights(weights: SceneWeights, target: SceneId, dtS: number): SceneWeights {
  const goal = oneHot(target);
  const step = Math.max(0, dtS) / SCENE_CROSSFADE_S;
  const next = weights.map((w, i) => {
    const diff = goal[i] - w;
    return Math.abs(diff) <= step ? goal[i] : w + Math.sign(diff) * step;
  });
  const sum = next.reduce((a, b) => a + b, 0) || 1;
  return next.map((w) => w / sum) as SceneWeights;
}

export function weightsSettled(weights: SceneWeights, target: SceneId): boolean {
  return weights[SCENE_ORDER.indexOf(target)] >= 0.999;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface SpectrumFeatures { bass: number; level: number }

/** Bass = mean of the lowest FFT bins, level = mean of all bins, both 0..1. */
export function analyzeSpectrum(spectrum: ArrayLike<number>): SpectrumFeatures {
  const n = spectrum.length;
  if (n === 0) return { bass: 0, level: 0 };
  let bass = 0;
  let all = 0;
  for (let i = 0; i < n; i++) {
    const v = spectrum[i] / 255;
    all += v;
    if (i < BASS_BINS) bass += v;
  }
  return { bass: clamp01(bass / Math.min(BASS_BINS, n)), level: clamp01(all / n) };
}

export const voiceFromRms = (rms: number): number => clamp01(rms * VOICE_RMS_GAIN);

export interface AudioFrame { bass: number; kick: number; level: number; voice: number }

/** Smooths raw features per frame; kick is the bass rising above its own slow average. */
export class AudioFeatures {
  private bass = 0;
  private bassAvg = 0;
  private level = 0;
  private voice = 0;

  update(spectrum: ArrayLike<number>, voiceRms: number, dtS: number): AudioFrame {
    const raw = analyzeSpectrum(spectrum);
    this.bassAvg += (raw.bass - this.bassAvg) * Math.min(1, dtS / BASS_AVG_S);
    this.bass = follow(this.bass, raw.bass, dtS);
    this.level = follow(this.level, raw.level, dtS);
    this.voice = follow(this.voice, voiceFromRms(voiceRms), dtS);
    const kick = clamp01((raw.bass - Math.max(this.bassAvg, BASS_FLOOR * 0.5)) * KICK_GAIN);
    return { bass: this.bass, kick, level: this.level, voice: this.voice };
  }
}

function follow(prev: number, next: number, dtS: number): number {
  const tau = next > prev ? ATTACK_S : RELEASE_S;
  return prev + (next - prev) * (1 - Math.exp(-Math.max(0, dtS) / tau));
}

export type HostRole = 'host' | 'news' | 'jingle' | null;

/** Fade state of the host silhouette (0..1) and the jingle shimmer (1 -> 0). */
export class HostPresence {
  presence = 0;
  shimmer = 0;
  private target = 0;

  setSpeaking(speaking: boolean, role: HostRole): void {
    if (!speaking) {
      this.target = 0;
      return;
    }
    if (role === 'jingle') this.shimmer = 1;
    else this.target = 1;
  }

  update(dtS: number): void {
    const dt = Math.max(0, dtS);
    const rate = this.target > this.presence ? 1 / HOST_FADE_IN_S : 1 / HOST_FADE_OUT_S;
    const diff = this.target - this.presence;
    this.presence = Math.abs(diff) <= rate * dt ? this.target : this.presence + Math.sign(diff) * rate * dt;
    this.shimmer = Math.max(0, this.shimmer - dt / SHIMMER_S);
  }

  /** Jump to the end state (reduced motion). */
  snap(): void {
    this.presence = this.target;
    this.shimmer = 0;
  }

  get settled(): boolean {
    return this.presence === this.target && this.shimmer === 0;
  }
}

export function renderScale(viewportWidth: number, coarsePointer: boolean): number {
  return viewportWidth <= MOBILE_MAX_WIDTH || coarsePointer ? SCALE_MOBILE : SCALE_DESKTOP;
}

export function canvasSize(cssW: number, cssH: number, dpr: number, scale: number): { w: number; h: number } {
  const k = Math.min(Math.max(dpr, 1), MAX_DPR) * scale;
  return { w: Math.max(1, Math.round(cssW * k)), h: Math.max(1, Math.round(cssH * k)) };
}

export interface FrameGate {
  hidden: boolean;
  reduced: boolean;
  playing: boolean;
  idleMs: number;
  transitioning: boolean;
}

/** False means: stop the RAF loop and leave the last frame on screen. */
export function needsFrames(g: FrameGate): boolean {
  if (g.hidden || g.reduced) return false;
  return g.playing || g.transitioning || g.idleMs < IDLE_PAUSE_MS;
}
