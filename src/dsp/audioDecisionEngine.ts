/**
 * Audio Decision Engine & JEV Transition Arbitrator for Synthapse.
 *
 * Implements deterministic Expected Utility (JEV) routing for real-time Lyria RT steering.
 * Evaluates measured audio features against candidate actions (ACCEPT, CROSSFADE, HOLD).
 *
 * Canon:
 * - Zero melodic synthesizer leads in mid frequencies (Techno Canon).
 * - Smooth transition arbitration based on audio continuity and clarity.
 * - Sub-millisecond, pure in-process execution with no network calls in the audio path.
 */

import type { AudioFeatures } from './rtFeatures';
import type { MusicGenerationConfig } from '../types';

export type JevAction = 'ACCEPT' | 'CROSSFADE' | 'HOLD';

export interface TransitionRequest {
  promptChange: boolean;
  bpmDelta: number;
  energyDelta: number;
}

export interface JevTerms {
  clarityTerm: number;
  continuityTerm: number;
  canonTerm: number;
  responsivenessTerm: number;
}

export interface JevDecision {
  action: JevAction;
  bars: number;
  utilities: Record<JevAction, number>;
  terms: Record<JevAction, JevTerms>;
  rationale: string;
}

export interface JevWeights {
  clarityWeight: number;        // Evaluates spectral headroom and clipping avoidance
  continuityWeight: number;     // Penalizes abrupt tempo or energy discontinuities
  canonWeight: number;          // Strictly enforces mid-tonal lead guardrail (anti-melody)
  responsivenessWeight: number; // Rewards immediate fulfillment of user intent
}

export const JEV_WEIGHTS: Record<JevAction, JevWeights> = {
  ACCEPT: {
    clarityWeight: 1.0,         // Headroom and clip penalty weight for instant execution
    continuityWeight: 1.2,      // Penalty weight for abrupt tempo or energy discontinuities
    canonWeight: 2.0,           // Strict penalty weight for mid-tonal lead violations
    responsivenessWeight: 1.5,  // High reward weight for immediate user intent fulfillment
  },
  CROSSFADE: {
    clarityWeight: 0.9,         // Headroom weight during gradual crossfade transitions
    continuityWeight: 1.5,      // High reward weight for smoothing large tempo or energy jumps
    canonWeight: 1.0,           // Moderate tolerance weight allowing crossfade through tonal content
    responsivenessWeight: 0.8,  // Moderate reward weight for timely progress with a smooth ramp
  },
  HOLD: {
    clarityWeight: 1.1,         // Preference weight for holding when signal is clipping or congested
    continuityWeight: 1.0,      // Baseline weight for preserving current groove continuity
    canonWeight: 1.8,           // High reward weight for waiting out ringing mid-tonal leads
    responsivenessWeight: 0.0,  // Zero responsiveness weight since user change is deferred
  },
};

export function evaluateJev(features: AudioFeatures, request: TransitionRequest): JevDecision {
  const discontinuity = (request.bpmDelta / 8.0) + (request.energyDelta * 2.0);
  const clipPenalty = features.clipCount > 0 ? -1.5 : 0.5;
  const crestBonus = Math.min(1.0, features.crestDb / 12.0);

  const rawClarity: Record<JevAction, number> = {
    ACCEPT: clipPenalty + crestBonus,
    CROSSFADE: 0.5 * clipPenalty + 0.5,
    HOLD: features.clipCount > 0 ? 1.0 : 0.0,
  };

  const rawContinuity: Record<JevAction, number> = {
    ACCEPT: 1.0 - discontinuity * 1.5,
    CROSSFADE: discontinuity > 0.8 ? 1.5 : (0.5 + discontinuity * 0.5),
    HOLD: 0.5,
  };

  const isMidTonal = features.midTonalRatio > 0.4;
  const rawCanon: Record<JevAction, number> = {
    ACCEPT: isMidTonal && request.promptChange ? -2.5 * (features.midTonalRatio / 0.4) : (1.0 - features.midTonalRatio),
    CROSSFADE: isMidTonal ? -0.5 * features.midTonalRatio : 0.5,
    HOLD: isMidTonal && request.promptChange ? 1.5 * features.midTonalRatio : 0.0,
  };

  const hasChange = request.promptChange || request.bpmDelta > 0 || request.energyDelta > 0;
  const rawResp: Record<JevAction, number> = {
    ACCEPT: hasChange ? 1.0 : 0.2,
    CROSSFADE: hasChange ? 0.6 : 0.1,
    HOLD: 0.0,
  };

  const terms: Record<JevAction, JevTerms> = {
    ACCEPT: { clarityTerm: 0, continuityTerm: 0, canonTerm: 0, responsivenessTerm: 0 },
    CROSSFADE: { clarityTerm: 0, continuityTerm: 0, canonTerm: 0, responsivenessTerm: 0 },
    HOLD: { clarityTerm: 0, continuityTerm: 0, canonTerm: 0, responsivenessTerm: 0 },
  };
  const utilities: Record<JevAction, number> = { ACCEPT: 0, CROSSFADE: 0, HOLD: 0 };
  const actions: JevAction[] = ['ACCEPT', 'CROSSFADE', 'HOLD'];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    const w = JEV_WEIGHTS[act];
    const cTerm = w.clarityWeight * rawClarity[act];
    const contTerm = w.continuityWeight * rawContinuity[act];
    const canTerm = w.canonWeight * rawCanon[act];
    const rTerm = w.responsivenessWeight * rawResp[act];

    terms[act] = { clarityTerm: cTerm, continuityTerm: contTerm, canonTerm: canTerm, responsivenessTerm: rTerm };
    utilities[act] = cTerm + contTerm + canTerm + rTerm;
  }

  let bestAct: JevAction = 'ACCEPT';
  let bestUtil = utilities.ACCEPT;
  if (utilities.CROSSFADE > bestUtil) { bestUtil = utilities.CROSSFADE; bestAct = 'CROSSFADE'; }
  if (utilities.HOLD > bestUtil) { bestUtil = utilities.HOLD; bestAct = 'HOLD'; }

  let bars = 1;
  if (bestAct === 'CROSSFADE') {
    bars = Math.max(2, Math.min(8, Math.round(request.bpmDelta / 4 + request.energyDelta * 4)));
  }

  const rationale = `JEV selected ${bestAct} (U=${bestUtil.toFixed(2)}) based on ${
    isMidTonal && request.promptChange ? 'Techno Canon mid-tonal guardrail' :
    discontinuity > 0.8 ? `discontinuity delta=${discontinuity.toFixed(2)}` : 'clean signal headroom'
  }.`;

  return { action: bestAct, bars, utilities, terms, rationale };
}

export function interpolateWeightedPrompts(
  from: Array<{ text: string; weight: number }>,
  to: Array<{ text: string; weight: number }>,
  progress: number
): Array<{ text: string; weight: number }> {
  const map = new Map<string, { from: number; to: number }>();
  for (let i = 0; i < from.length; i++) map.set(from[i].text, { from: from[i].weight, to: 0 });
  for (let i = 0; i < to.length; i++) {
    const e = map.get(to[i].text) ?? { from: 0, to: 0 };
    e.to = to[i].weight;
    map.set(to[i].text, e);
  }
  const res: Array<{ text: string; weight: number }> = [];
  for (const [text, { from: f, to: t }] of map.entries()) {
    const w = f * (1 - progress) + t * progress;
    if (Math.abs(w) >= 1e-4) res.push({ text, weight: w });
  }
  return res;
}

export function sanitizeMusicConfig(config: MusicGenerationConfig): MusicGenerationConfig {
  const s: MusicGenerationConfig = { ...config };
  const clamp = (v: number | undefined, min: number, max: number, round = false) =>
    v === undefined ? undefined : round ? Math.round(Math.max(min, Math.min(max, v))) : Math.max(min, Math.min(max, v));
  s.bpm = clamp(s.bpm, 60, 200, true);
  s.topK = clamp(s.topK, 1, 1000, true);
  s.guidance = clamp(s.guidance, 0, 6);
  s.density = clamp(s.density, 0, 1);
  s.brightness = clamp(s.brightness, 0, 1);
  s.temperature = clamp(s.temperature, 0, 3);
  return s;
}

export type TransitionMethod = 'DSP_FILTER_MORPH' | 'WEIGHTED_PROMPT_INTERPOLATION' | 'BAR_SYNCED_DROP';

export interface MusicalState {
  currentBpm: number;
  targetBpm: number;
  currentEnergy: number;
  targetEnergy: number;
  currentStyle: string;
  targetStyle: string;
  hasKick: boolean;
  hasRumble: boolean;
  hasMelodicMidLead?: boolean;
}

export interface TransitionDecision {
  method: TransitionMethod;
  action: JevAction;
  expectedUtility: number;
  recommendedRampDurationMs: number;
  blockedByGuardrail: boolean;
  blockReason: string | null;
  dspParameters: { filterCutoffHz: number; sidechainDuckDb: number; reverbSend: number };
  lyriaWeights: Record<string, number>;
  rationale: string;
}

export class AudioDecisionEngine {
  public evaluate(features: AudioFeatures, request: TransitionRequest): JevDecision {
    return evaluateJev(features, request);
  }

  public evaluateTransition(state: MusicalState): TransitionDecision {
    const features: AudioFeatures = {
      rmsDb: -10, peakDb: -4, crestDb: 6, clipCount: 0,
      midTonalRatio: state.hasMelodicMidLead ? 0.85 : 0.05,
      subRatio: state.hasKick ? 0.8 : 0.2,
    };
    const request: TransitionRequest = {
      promptChange: state.currentStyle !== state.targetStyle,
      bpmDelta: Math.abs(state.targetBpm - state.currentBpm),
      energyDelta: Math.abs(state.targetEnergy - state.currentEnergy),
    };
    const jev = evaluateJev(features, request);
    let method: TransitionMethod = 'DSP_FILTER_MORPH';
    if (jev.action === 'CROSSFADE') method = 'WEIGHTED_PROMPT_INTERPOLATION';
    else if (request.bpmDelta > 8) method = 'BAR_SYNCED_DROP';

    const blocked = state.hasMelodicMidLead === true || jev.action === 'HOLD';
    return {
      method,
      action: jev.action,
      expectedUtility: jev.utilities[jev.action],
      recommendedRampDurationMs: jev.bars * 1000,
      blockedByGuardrail: blocked,
      blockReason: blocked ? 'Canon or stability hold: mid-tonal lead or transient clashing' : null,
      dspParameters: { filterCutoffHz: 800, sidechainDuckDb: -14, reverbSend: 0.2 },
      lyriaWeights: { [state.targetStyle]: 1.0 },
      rationale: jev.rationale,
    };
  }
}

export const audioDecisionEngine = new AudioDecisionEngine();
