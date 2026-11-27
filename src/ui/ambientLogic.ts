/** Pure logic behind the Classic ambient shader: scene mapping, audio features, host fade, frame gating. No DOM, no WebGL. */
import type { MusicGroupId, Station } from '../radio/stations';

export type SceneId =
  | 'nature' | 'techno' | 'night' | 'focus' | 'aurora' | 'ocean' | 'synthwave'
  | 'neon' | 'smoke' | 'dunes' | 'laser' | 'warp' | 'liquid' | 'candle';
/** Index order is the shader's scene id (see scene() in ambientGL.glsl.ts). */
export const SCENE_ORDER: readonly SceneId[] = [
  'nature', 'techno', 'night', 'focus', 'aurora', 'ocean', 'synthwave',
  'neon', 'smoke', 'dunes', 'laser', 'warp', 'liquid', 'candle',
];

export const SCENE_CROSSFADE_S = 3;
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

/** Fallback per group, used for custom stations and anything not in STATION_SCENE. */
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

/** One mood per preset station, so moving between stations actually changes the picture. */
export const STATION_SCENE: Record<string, SceneId> = {
  // Fokus i Puls
  'dos-groove': 'focus', 'lofi-nauka': 'night', 'micro-house': 'focus', 'deep-tech': 'liquid',
  'dub-techno': 'ocean', 'minimal-techno': 'focus',
  // Klub i Energia
  'tech-house': 'techno', 'club-dance': 'laser', 'detroit-techno': 'techno', 'melodic-house': 'aurora',
  'progressive-house': 'warp', 'trance': 'warp', 'drum-and-bass': 'warp', 'liquid-dnb': 'liquid',
  // Synth i Filmowa
  'stranger-synth': 'synthwave', 'muzyka-filmowa': 'aurora', 'cyber-noir': 'neon',
  // Klasyka i Instrumentalna
  'muzyka-klasyczna': 'candle', 'instrumentalna-akustyczna': 'nature', 'stoa': 'candle',
  // Etno i Folk
  'etno-world': 'dunes', 'slowianski-folk': 'nature', 'afro-house': 'dunes', 'organic-house': 'dunes',
  // Chill i Noc
  'deep-house': 'liquid', 'poranna-kawa': 'nature', 'groove-funk': 'smoke', 'deep-ambient': 'aurora',
  'warm-jazz': 'smoke', 'trip-hop': 'neon', 'nocny-dub': 'ocean',
  // Techno i Rave
  'raw-techno': 'laser', 'berlin-bcco-techno': 'techno', 'hypnotic-techno': 'techno', 'etno-techno': 'dunes',
  'tribal-techno': 'laser', 'goa-trance': 'warp', 'hard-dance': 'laser', 'tekk': 'laser',
  // Przestrzenie B2B
  'salon-beauty-spa': 'ocean', 'lobby-hotelowe': 'candle', 'poczekalnia': 'focus',
};

const NAME_HINTS: Array<[RegExp, SceneId]> = [
  [/hard|tekk|raw|rave/i, 'laser'],
  [/trance|goa|dnb|drum/i, 'warp'],
  [/techno|klub|club|dance|house/i, 'techno'],
  [/jazz|funk|soul/i, 'smoke'],
  [/synth|retro|80/i, 'synthwave'],
  [/noir|cyber|trip/i, 'neon'],
  [/ambient|spa|aurora|kosmos|space/i, 'aurora'],
  [/morze|ocean|dub|sea/i, 'ocean'],
  [/klasy|orkiest|piano|fortepian/i, 'candle'],
  [/afro|etno|world|tribal/i, 'dunes'],
  [/noc|night|chill|lofi|lo-fi/i, 'night'],
  [/fokus|focus|puls|b2b|przestrze/i, 'focus'],
  [/folk|natur|akust|film|las|forest/i, 'nature'],
];

/** Station id first, then the group, then name hints, then BPM. */
export function sceneForStation(
  station: (Pick<Station, 'name' | 'bpm' | 'group'> & { id?: string }) | null,
  groupId: MusicGroupId | string | null,
): SceneId {
  if (station?.id && station.id in STATION_SCENE) return STATION_SCENE[station.id];
  const label = `${station?.name ?? ''} ${station?.id ?? ''}`;
  for (const [pattern, scene] of NAME_HINTS) if (pattern.test(label)) return scene;
  const known = (id: string | null | undefined): SceneId | null =>
    id && id in GROUP_SCENE ? GROUP_SCENE[id as MusicGroupId] : null;
  const direct = known(groupId) ?? known(station?.group);
  if (direct) return direct;
  const groupLabel = `${groupId ?? ''} ${station?.group ?? ''}`;
  for (const [pattern, scene] of NAME_HINTS) if (pattern.test(groupLabel)) return scene;
  if (station && station.bpm >= TECHNO_BPM) return 'techno';
  return 'focus';
}

/** Stable 0..1 look per station, so two stations sharing a mood still differ (palette, layout, camera). */
export function variantForStation(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** Next look inside the same mood after a musical section change; golden-ratio step keeps it far from the last. */
export const nextVariant = (v: number): number => (v + 0.381966) % 1;

export interface SceneKey { scene: SceneId; variant: number }

const sameKey = (a: SceneKey, b: SceneKey): boolean =>
  a.scene === b.scene && Math.abs(a.variant - b.variant) < 1e-6;

/**
 * Two-slot crossfade: the shader renders only `from` and `to`, mixed by an eased `mix`.
 * A change that arrives mid-fade waits for the running fade to land, so the picture never pops.
 */
export class SceneFader {
  from: SceneKey;
  to: SceneKey;
  progress = 1;
  private pending: SceneKey | null = null;

  constructor(initial: SceneKey) {
    this.from = { ...initial };
    this.to = { ...initial };
  }

  set(next: SceneKey): void {
    if (this.progress >= 1) {
      if (sameKey(next, this.to)) return;
      this.from = this.to;
      this.to = { ...next };
      this.progress = 0;
      return;
    }
    this.pending = sameKey(next, this.to) ? null : { ...next };
  }

  update(dtS: number): void {
    if (this.progress >= 1) return;
    this.progress = Math.min(1, this.progress + Math.max(0, dtS) / SCENE_CROSSFADE_S);
    if (this.progress >= 1 && this.pending) {
      const next = this.pending;
      this.pending = null;
      this.from = this.to;
      this.to = next;
      this.progress = 0;
    }
  }

  /** Jump to the final state (reduced motion). */
  snap(): void {
    if (this.pending) this.to = this.pending;
    this.pending = null;
    this.from = { ...this.to };
    this.progress = 1;
  }

  /** Smoothstep-eased weight of `to`. */
  get mix(): number {
    const x = this.progress;
    return x * x * (3 - 2 * x);
  }

  get settled(): boolean {
    return this.progress >= 1 && this.pending === null;
  }

  /** Where the fade is heading (pending change included). */
  get target(): SceneKey {
    return this.pending ?? this.to;
  }
}

export const SECTION_COOLDOWN_S = 30;
export const SECTION_HOLD_S = 1.5;
export const SECTION_WARMUP_S = 8;
const SECTION_DELTA = 0.3;
const SECTION_FAST_S = 2;
const SECTION_SLOW_S = 20;

/**
 * Detects a musical section change (breakdown, drop, a new track in the mix) from the real audio:
 * a fast energy average leaving the slow one by more than 30 % for 1.5 s. Cooldown 30 s.
 */
export class SectionDetector {
  private fast = 0;
  private slow = 0;
  private hold = 0;
  private warm = 0;
  private cooldown = 0;

  update(frame: Pick<AudioFrame, 'bass' | 'level'>, dtS: number): boolean {
    const dt = Math.max(0, dtS);
    const energy = 0.6 * frame.bass + 0.4 * clamp01(frame.level * 3);
    if (this.warm === 0) this.fast = this.slow = energy;
    this.warm += dt;
    this.fast += (energy - this.fast) * Math.min(1, dt / SECTION_FAST_S);
    this.slow += (energy - this.slow) * Math.min(1, dt / SECTION_SLOW_S);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.warm < SECTION_WARMUP_S || this.cooldown > 0) {
      this.hold = 0;
      return false;
    }
    const rel = Math.abs(this.fast - this.slow) / Math.max(this.slow, 0.05);
    this.hold = rel > SECTION_DELTA ? this.hold + dt : 0;
    if (this.hold < SECTION_HOLD_S) return false;
    this.hold = 0;
    this.cooldown = SECTION_COOLDOWN_S;
    this.slow = this.fast;
    return true;
  }

  /** Start over (station change, pause, host talking: the music is ducked, that is not a section change). */
  reset(): void {
    this.warm = 0;
    this.hold = 0;
  }
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
