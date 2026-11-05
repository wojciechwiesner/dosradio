/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PlaybackState, Prompt, MusicGenerationConfig } from '../types';
import { getSharedAudioContext } from './iosAudioUnlock';
import type { GoogleGenAI, AudioChunk, LiveMusicFilteredPrompt, LiveMusicServerMessage, LiveMusicSession } from '@google/genai';
import { decode, decodeAudioData } from './audio';
import { throttle } from './throttle';
import { applyCanon, type CanonMode } from '../dsp/promptCanon';
import { PcmRingBuffer, type AudioFeatures } from '../dsp/rtFeatures';
import { audioDecisionEngine, AudioDecisionEngine, interpolateWeightedPrompts, sanitizeMusicConfig } from '../dsp/audioDecisionEngine';
import { JevOutcomeTracker } from '../dsp/jevOutcome';

function highpass(ctx: BaseAudioContext, hz: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hz;
  f.Q.value = 0.707;
  return f;
}

export class LiveMusicHelper extends EventTarget {
  private session: LiveMusicSession | null = null; private sessionPromise: Promise<LiveMusicSession> | null = null;
  private connectionError = true; private setupComplete = false; private setupCompleteResolve: (() => void) | null = null;
  private filteredPrompts = new Set<string>(); private nextStartTime = 0; private bufferTime = 10;
  public readonly audioContext: AudioContext; public extraDestination: AudioNode | null = null;
  get ctx(): AudioContext { return this.audioContext; }
  public canonMode: CanonMode = 'open'; public readonly decisionEngine: AudioDecisionEngine = audioDecisionEngine;
  private outputNode: GainNode; private dcBlocker: BiquadFilterNode; private rumbleCut: BiquadFilterNode;
  private fallbackLimiter: DynamicsCompressorNode | null = null; private playbackState: PlaybackState = 'stopped';
  private prompts: Map<string, Prompt> = new Map(); private musicGenerationConfig: MusicGenerationConfig | null = null;
  private lastAppliedPrompts: Array<{ text: string; weight: number }> = [];
  private lastAppliedBpm = 120; private lastAppliedDensity = 0.5;
  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null; private ringBuffer = new PcmRingBuffer(2, 48000);

  constructor(private ai: GoogleGenAI, private model: string) {
    super();
    this.audioContext = getSharedAudioContext();
    this.outputNode = this.audioContext.createGain();
    // RT hygiene: 20 Hz DC blocker + 30 Hz sub rumble cut
    // AudioParams (frequency, Q) are read-only accessors: Object.assign({ frequency: {...} }) throws.
    this.dcBlocker = highpass(this.audioContext, 20);
    this.rumbleCut = highpass(this.audioContext, 30);
    this.dcBlocker.connect(this.rumbleCut);
  }

  private getSession(): Promise<LiveMusicSession> { return this.sessionPromise ??= this.connect(); }

  private async connect(): Promise<LiveMusicSession> {
    let session: LiveMusicSession;
    return this.ai.live.music.connect({
      model: this.model,
      callbacks: {
        onmessage: async (e: LiveMusicServerMessage) => {
          if (e.setupComplete) {
            this.connectionError = false; this.setupComplete = true; this.session = session;
            this.setupCompleteResolve?.(); this.setupCompleteResolve = null;
          }
          if (e.filteredPrompt) {
            this.filteredPrompts.add(e.filteredPrompt.text!);
            this.dispatchEvent(new CustomEvent<LiveMusicFilteredPrompt>('filtered-prompt', { detail: e.filteredPrompt }));
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('synapse-filtered-prompt', { detail: { text: e.filteredPrompt.text } }));
          }
          if (e.serverContent?.audioChunks) await this.processAudioChunks(e.serverContent.audioChunks);
        },
        onerror: (err) => {
          console.error('[Lyria] onerror:', err);
          this.connectionError = true; this.stop();
          this.dispatchEvent(new CustomEvent('error', { detail: 'Connection error, please restart audio.' }));
        },
        onclose: () => {
          if (this.playbackState !== 'stopped') {
            this.session = null; this.stop();
            this.dispatchEvent(new CustomEvent('error', { detail: 'Connection error, please restart audio.' }));
          }
        },
      },
    }).then((s) => { session = s; return s; });
  }

  private setPlaybackState(s: PlaybackState) {
    this.playbackState = s;
    this.dispatchEvent(new CustomEvent('playback-state-changed', { detail: s }));
  }

  public getRecentFeatures(): AudioFeatures { return this.ringBuffer.getFeatures(); }
  // Feature deltas 4 s / 6 s after each JEV decision -> diag log (weight fitting data).
  private readonly jevOutcomes = new JevOutcomeTracker(
    () => this.getRecentFeatures(),
    (o) => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('synapse-jev-outcome', { detail: o })); },
  );

  private async processAudioChunks(audioChunks: AudioChunk[]) {
    if (this.playbackState === 'paused' || this.playbackState === 'stopped') return;
    const host = (window as any).vaybeHost;
    const useVaybe = host && typeof host.enqueuePCM === 'function';

    for (const chunk of audioChunks) {
      const raw = decode(chunk.data!);
      this.ringBuffer.recordInt16Stereo(raw);
      this.dispatchEvent(new CustomEvent('chunk', { detail: { features: this.getRecentFeatures() } })); // JEV controller tick (jevGlue.ts)
      if (useVaybe) { host.enqueuePCM(raw); continue; }

      const audioBuffer = await decodeAudioData(raw, this.audioContext, 48000, 2);
      // Lyria chunks are contiguous. Fading every chunk notches the signal every ~2 s
      // (measured -3.3 dB dip on a 55 Hz bass). Fade in only at stream start or after
      // an underrun, where there is a real discontinuity.
      if (this.nextStartTime === 0) {
        const fadeLen = Math.min(Math.floor(audioBuffer.sampleRate * 0.004), audioBuffer.length);
        for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
          const ch = audioBuffer.getChannelData(c);
          for (let i = 0; i < fadeLen; i++) ch[i] *= i / fadeLen;
        }
      }
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);

      if (this.nextStartTime === 0) {
        this.nextStartTime = this.audioContext.currentTime + this.bufferTime;
        setTimeout(() => this.setPlaybackState('playing'), this.bufferTime * 1000);
      }
      if (this.nextStartTime < this.audioContext.currentTime) {
        this.setPlaybackState('loading'); this.nextStartTime = 0; return;
      }
      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
    }
    if (useVaybe && this.playbackState !== 'playing') this.setPlaybackState('playing');
  }

  public getBufferFill(): number {
    return (!this.nextStartTime || !this.bufferTime) ? 0 : Math.max(0, Math.min(1, (this.nextStartTime - this.audioContext.currentTime) / this.bufferTime));
  }

  public get activePrompts() {
    if (!this.prompts || typeof this.prompts.values !== 'function') return [];
    return Array.from(this.prompts.values()).filter((p) => !this.filteredPrompts.has(p.text) && Math.abs(p.weight) >= 1e-8).map((p) => ({ text: p.text, weight: p.weight }));
  }

  private hasPromptChange(targets: Array<{ text: string; weight: number }>): boolean {
    if (this.lastAppliedPrompts.length !== targets.length) return true;
    return targets.some((tgt, i) => {
      const cur = this.lastAppliedPrompts[i];
      return !cur || cur.text !== tgt.text || Math.abs(cur.weight - tgt.weight) > 0.05;
    });
  }

  public readonly setWeightedPrompts = throttle(async (prompts: Map<string, Prompt>) => {
    this.prompts = prompts;
    if (this.activePrompts.length === 0) {
      this.dispatchEvent(new CustomEvent('error', { detail: 'There needs to be one active prompt to play.' }));
      this.pause();
      return;
    }
    const targetPrompts = this.activePrompts.map((p) => {
      const res = applyCanon(p.text, this.canonMode);
      if (res.verdict === 'rewritten') {
        this.dispatchEvent(new CustomEvent('canon-rewrite', { detail: { original: p.text, text: res.text, replaced: res.replaced } }));
      }
      return { text: res.text, weight: p.weight };
    });

    const features = this.getRecentFeatures();
    const bpm = this.musicGenerationConfig?.bpm ?? 120;
    const density = this.musicGenerationConfig?.density ?? 0.5;
    const decision = this.decisionEngine.evaluate(features, {
      promptChange: this.hasPromptChange(targetPrompts),
      bpmDelta: Math.abs(bpm - this.lastAppliedBpm),
      energyDelta: Math.abs(density - this.lastAppliedDensity),
    });

    const decisionId = this.jevOutcomes.track(decision.action);
    this.dispatchEvent(new CustomEvent('jev-decision', { detail: decision }));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('synapse-jev-decision', { detail: { id: decisionId, ...decision, features } }));
    if (!this.session) return;

    if (decision.action === 'HOLD') {
      // HOLD defers the change, it must never drop it: re-evaluate after one bar.
      this.scheduleHoldRetry(prompts, bpm);
      return;
    }
    this.clearHoldRetry();
    if (decision.action === 'CROSSFADE' && this.lastAppliedPrompts.length > 0) {
      await this.startCrossfade(this.lastAppliedPrompts, targetPrompts, decision.bars, bpm);
    } else {
      await this.applyPromptsDirect(targetPrompts);
    }
  }, 200);

  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private holdRetries = 0;

  private scheduleHoldRetry(prompts: Map<string, Prompt>, bpm: number): void {
    this.clearHoldRetry(false);
    const barMs = Math.round((240 / Math.max(60, bpm)) * 1000);
    this.holdRetries++;
    if (this.holdRetries > 4) {
      // Waited 4 bars: apply instead of holding forever (crossfade when there is a source).
      this.holdRetries = 0;
      const target = this.activePrompts.map((p) => ({ text: applyCanon(p.text, this.canonMode).text, weight: p.weight }));
      if (this.lastAppliedPrompts.length > 0) void this.startCrossfade(this.lastAppliedPrompts, target, 4, bpm);
      else void this.applyPromptsDirect(target);
      return;
    }
    this.holdTimer = setTimeout(() => { this.holdTimer = null; void this.setWeightedPrompts(prompts); }, barMs);
  }

  private clearHoldRetry(resetCount = true): void {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (resetCount) this.holdRetries = 0;
  }

  private async startCrossfade(from: Array<{ text: string; weight: number }>, to: Array<{ text: string; weight: number }>, bars: number, bpm: number): Promise<void> {
    if (this.crossfadeTimer) { clearTimeout(this.crossfadeTimer); this.crossfadeTimer = null; }
    const barMs = Math.round((240 / Math.max(60, bpm)) * 1000), totalSteps = Math.max(2, bars);
    let stepIdx = 1;
    const step = async () => {
      if (!this.session) return;
      const interpolated = interpolateWeightedPrompts(from, to, stepIdx / totalSteps);
      try {
        await this.session.setWeightedPrompts({ weightedPrompts: interpolated });
        if (stepIdx >= totalSteps) {
          this.lastAppliedPrompts = to;
          this.lastAppliedBpm = this.musicGenerationConfig?.bpm ?? 120;
          this.lastAppliedDensity = this.musicGenerationConfig?.density ?? 0.5;
          this.crossfadeTimer = null;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('synapse-prompts-applied', { detail: { prompts: to, at: Date.now(), via: 'crossfade' } }));
          }
        } else {
          stepIdx++;
          this.crossfadeTimer = setTimeout(step, barMs);
        }
      } catch (e: any) {
        this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
        this.crossfadeTimer = null;
      }
    };
    await step();
  }

  private async applyPromptsDirect(weightedPrompts: Array<{ text: string; weight: number }>): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.setWeightedPrompts({ weightedPrompts });
      this.lastAppliedPrompts = weightedPrompts;
      this.lastAppliedBpm = this.musicGenerationConfig?.bpm ?? 120;
      this.lastAppliedDensity = this.musicGenerationConfig?.density ?? 0.5;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('synapse-prompts-applied', { detail: { prompts: weightedPrompts, at: Date.now() } }));
      }
    } catch (e: any) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message })); this.pause();
    }
  }

  private async _sendMusicGenerationConfig(config: MusicGenerationConfig) {
    if (!this.session) return;
    try {
      const s = sanitizeMusicConfig(config);
      await this.session.setMusicGenerationConfig({ musicGenerationConfig: s as any });
      this.lastAppliedBpm = s.bpm ?? this.lastAppliedBpm;
      this.lastAppliedDensity = s.density ?? this.lastAppliedDensity;
    } catch (e: any) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
    }
  }

  // Lyria replaces the WHOLE config on every message: a field left out goes back to its default
  // ("model decides" for bpm/scale/density/brightness). Callers send deltas, so they are merged
  // (synchronously, before the throttle, so no delta inside a throttle window is lost) onto the
  // last full config, and the locked session bpm is always re-sent. Measured on prod 2026-09-28:
  // partial updates without bpm made Lyria play ~128 BPM whatever was requested (124/130/136/142,
  // phase drift up to 28 ms/s); with the merged config it holds 123.95-141.75 BPM.
  public setMusicGenerationConfig(config: MusicGenerationConfig): Promise<void> | void {
    const merged: MusicGenerationConfig = { ...(this.musicGenerationConfig ?? {}), ...config };
    if (this.lockedBpm !== null) merged.bpm = this.lockedBpm;
    this.musicGenerationConfig = merged;
    return this.flushConfig();
  }

  private readonly flushConfig = throttle(async () => {
    if (this.session && this.musicGenerationConfig) await this._sendMusicGenerationConfig(this.musicGenerationConfig);
  }, 200);

  /** Session tempo lock: every config sent to Lyria carries this bpm until unlocked. */
  private lockedBpm: number | null = null;
  public lockBpm(bpm: number | null): void {
    this.lockedBpm = bpm === null || !isFinite(bpm) ? null : Math.round(Math.max(60, Math.min(200, bpm)));
  }
  public get requestedBpm(): number | null { return this.lockedBpm ?? this.musicGenerationConfig?.bpm ?? null; }

  private waitForSetupComplete(): Promise<void> {
    return this.setupComplete ? Promise.resolve() : new Promise((res) => { this.setupCompleteResolve = res; });
  }

  private connectHygieneBus(): void {
    const host = (window as any).vaybeHost;
    if (host && typeof host.enqueuePCM === 'function') return;
    this.outputNode.connect(this.dcBlocker);
    try { this.rumbleCut.disconnect(); } catch { /* noop */ }
    if (this.extraDestination) return void this.rumbleCut.connect(this.extraDestination);
    if (!this.fallbackLimiter) {
      const lim = this.audioContext.createDynamicsCompressor();
      lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.08;
      this.fallbackLimiter = lim;
      this.fallbackLimiter.connect(this.audioContext.destination);
    }
    this.rumbleCut.connect(this.fallbackLimiter);
  }

  public async play() {
    this.setPlaybackState('loading');
    await this.getSession();
    await this.waitForSetupComplete();
    await this.setWeightedPrompts(this.prompts);
    if (this.musicGenerationConfig && this.session) await this._sendMusicGenerationConfig(this.musicGenerationConfig);
    this.audioContext.resume();
    this.session!.play();
    try { this.outputNode.disconnect(); } catch { /* noop */ }
    this.connectHygieneBus();
    this.outputNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    this.outputNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + 0.1);
  }

  private tearDownOutputNode(): void {
    this.outputNode.gain.cancelScheduledValues(this.audioContext.currentTime);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, this.audioContext.currentTime);
    this.outputNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
    const old = this.outputNode;
    setTimeout(() => { try { old.disconnect(); } catch { /* noop */ } }, 150);
    this.nextStartTime = 0; this.outputNode = this.audioContext.createGain();
  }

  // Drop audio already queued in the worklet so resume does not replay stale chunks.
  private flushVaybeHost(): void {
    (window as any).vaybeHost?.flush?.();
  }

  public pause() {
    if (this.crossfadeTimer) { clearTimeout(this.crossfadeTimer); this.crossfadeTimer = null; }
    this.clearHoldRetry();
    this.flushVaybeHost();
    this.session?.pause(); this.setPlaybackState('paused'); this.tearDownOutputNode();
  }

  public stop() {
    if (this.crossfadeTimer) { clearTimeout(this.crossfadeTimer); this.crossfadeTimer = null; }
    this.clearHoldRetry();
    this.flushVaybeHost();
    this.session?.stop(); this.setPlaybackState('stopped'); this.tearDownOutputNode();
    this.session = null; this.sessionPromise = null; this.setupComplete = false;
    this.setupCompleteResolve = null; this.filteredPrompts.clear();
  }

  public async playPause() {
    return this.playbackState === 'playing' ? this.pause() : (this.playbackState === 'loading' ? this.stop() : this.play());
  }

  public async resetContext() {
    if (!this.session && !this.sessionPromise) { console.warn('Cannot reset context: no session'); return; }
    try {
      const s = this.session || await this.getSession();
      await s?.resetContext();
    } catch (e: any) {
      this.dispatchEvent(new CustomEvent('error', { detail: `Reset context failed: ${e.message}` }));
    }
  }
}
