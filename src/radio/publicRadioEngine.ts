/**
 * DOS Radio engine for dosradio.theones.io.
 *
 * Features:
 * - 14 stations with named hosts (Kuba, Ola, Rafał, Ida, Zosia, Lena, Tadek, Max, Igor, Wiktor, Helena, Marta, Szymon, Marek).
 * - "Z prowadzącym" vs "Tylko muzyka" mode (suppresses voice breaks and spoken time).
 * - Automatic reconnection on disconnect (zero dead air; plays jingle and reconnects/falls back to archive).
 * - Instant start in ~100ms with the station host's voice greeting while music buffers.
 * - Gapless hybrid stream (70% archive / 30% live) with prefetch and crossfade.
 */
import { GoogleGenAI } from '@google/genai';
import { LiveMusicHelper } from '../audio/LiveMusicHelper';
import { getSharedAudioContext } from '../audio/iosAudioUnlock';
import type { MusicGenerationConfig, Prompt } from '../types';
import { radioApi, TrialEndedError } from './radioApi';
import { interleaveStories, pickNextStory, type NewsCategory, type QueuedStory } from './newsQueue';
import { hostStationId, isPresetStation, NEGATIVE_PROMPT, type Station } from './stations';
import { msUntilNextBreak, nextBreakAt, type BreakInterval } from './radioClock';
import { ChunkStreamer } from './chunkStreamer';

const LYRIA_MODEL = 'lyria-realtime-exp';
const LYRIA_PROXY_BASE = '/radio-ws/lyria';
const PLACEHOLDER_KEY = 'server-side';
const DUCK_LEVEL = 0.16;
const NEWS_POLL_MS = 10 * 60_000;

export type HostMode = 'with-host' | 'music-only';

export interface PublicRadioEvents {
  onState: (state: 'idle' | 'loading' | 'playing' | 'paused') => void;
  onStatus: (text: string) => void;
  onError: (text: string) => void;
  onQueue: (queue: QueuedStory[], airingId: string | null) => void;
  onOnAir: (story: QueuedStory | null) => void;
  onNextBreak: (at: Date | null) => void;
  onTrialEnded: () => void;
  onLevel: (level: number) => void;
  onHostModeChange?: (mode: HostMode) => void;
  onHostState?: (speaking: boolean, role: 'host' | 'news' | 'jingle' | null) => void;
}

export class PublicRadioEngine {
  private readonly ctx = getSharedAudioContext();
  private readonly master = this.ctx.createGain();
  private readonly limiter = this.ctx.createDynamicsCompressor();
  private readonly musicBus = this.ctx.createGain();
  private readonly voiceGain = this.ctx.createGain();
  private readonly analyser = this.ctx.createAnalyser();

  private helper: LiveMusicHelper | null = null;
  private chunkStreamer: ChunkStreamer | null = null;
  private station: Station;
  private categories: NewsCategory[];
  private queue: QueuedStory[] = [];
  private aired = new Set<string>();

  private timers: ReturnType<typeof setTimeout>[] = [];
  private newsTimer: ReturnType<typeof setInterval> | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  private silentTicks = 0;
  private recovering = false;
  private speaking = false;
  private playing = false;

  public interval: BreakInterval = 20;
  public hostMode: HostMode = 'with-host';

  constructor(station: Station, categories: NewsCategory[], private readonly events: PublicRadioEvents) {
    this.station = station;
    this.categories = categories;

    this.limiter.threshold.value = -2;
    this.limiter.ratio.value = 12;

    this.musicBus.connect(this.master);
    this.voiceGain.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.limiter.connect(this.ctx.destination);
    this.analyser.fftSize = 512;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentStation(): Station {
    return this.station;
  }

  setVolume(value: number): void {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.ctx.currentTime, 0.05);
  }

  setHostMode(mode: HostMode): void {
    this.hostMode = mode;
    this.events.onHostModeChange?.(mode);
    if (this.playing) {
      this.clearSchedule();
      if (mode === 'with-host') {
        this.scheduleNextBreak();
      } else {
        this.events.onNextBreak(null);
      }
    }
  }

  async start(): Promise<void> {
    await this.ctx.resume();
    this.events.onState('loading');
    this.playing = true; // set first: greeting, watchdog and breaks all check it
    this.startLevelMeter();

    if (this.hostMode === 'with-host') {
      void this.playWelcomeIntro(); // host speaks within ~100 ms while music loads underneath
    }

    const started = await this.startMusic();
    if (!this.playing) return; // user pressed pause while loading
    if (!started) {
      this.events.onStatus('Muzyka się ładuje, za chwilę wejdzie...');
      void this.triggerDeadAirRecovery();
    } else {
      this.events.onStatus(`Gra ${this.station.name}`);
    }
    this.events.onState('playing');

    if (this.hostMode === 'with-host') {
      void this.refreshNews();
      this.newsTimer = setInterval(() => void this.refreshNews(), NEWS_POLL_MS);
      this.scheduleNextBreak();
    } else {
      this.events.onNextBreak(null);
    }
  }

  /** Archive stream first (scales to any number of listeners), live Lyria only as a fallback. */
  private async startMusic(): Promise<boolean> {
    if (!this.chunkStreamer) {
      this.chunkStreamer = new ChunkStreamer(this.ctx, this.musicBus, this.station.id, {
        onChunk: () => { this.silentTicks = 0; },
        onError: (err) => {
          if (err === 'trial-ended') this.endTrial();
          else void this.triggerDeadAirRecovery();
        },
      });
    }
    if (isPresetStation(this.station) && (await this.chunkStreamer.start())) return true;
    this.chunkStreamer = null;
    try {
      if (!this.helper) this.helper = this.createHelper();
      await this.applyStation();
      await this.helper.play();
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this.clearSchedule();
    if (this.newsTimer) clearInterval(this.newsTimer);
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.newsTimer = null;
    this.levelTimer = null;

    if (this.chunkStreamer) {
      this.chunkStreamer.stop();
      this.chunkStreamer = null;
    }
    this.helper?.pause();
    this.playing = false;
    this.events.onState('paused');
    this.events.onLevel(0);
  }

  async setStation(station: Station): Promise<void> {
    const prev = this.station;
    this.station = station;
    if (!this.playing) return;

    if (isPresetStation(station)) {
      // Preset stations play from the recorded archive.
      this.helper?.stop();
      if (!this.chunkStreamer) {
        await this.startMusic();
      } else if (!(await this.chunkStreamer.setStation(station.id))) {
        void this.triggerDeadAirRecovery();
      }
    } else {
      // A mood station has no archive: generate it live with Lyria.
      this.chunkStreamer?.stop();
      this.chunkStreamer = null;
      if (!this.helper) this.helper = this.createHelper();
      await this.applyStation();
      if (station.bpm !== prev.bpm) await this.helper.resetContext();
      await this.helper.play();
    }
    this.events.onStatus(`Gra ${station.name}`);
  }

  async setCategories(categories: NewsCategory[]): Promise<void> {
    this.categories = categories;
    if (this.playing && this.hostMode === 'with-host') {
      await this.refreshNews();
    }
  }

  setInterval(interval: BreakInterval): void {
    this.interval = interval;
    if (this.playing && this.hostMode === 'with-host') {
      this.clearSchedule();
      this.scheduleNextBreak();
    }
  }

  async newsNow(): Promise<void> {
    if (this.hostMode === 'music-only') return;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }
    if (!this.queue.length) await this.refreshNews();
    await this.airBreak(new Date(), true);
  }

  private createHelper(): LiveMusicHelper {
    const ai = new GoogleGenAI({
      apiKey: PLACEHOLDER_KEY,
      httpOptions: { apiVersion: 'v1alpha', baseUrl: location.origin + LYRIA_PROXY_BASE },
    });
    const helper = new LiveMusicHelper(ai, LYRIA_MODEL);
    helper.extraDestination = this.musicBus;

    // Automatic reconnection watchdog on disconnection (Google drops at ~10 minutes)
    helper.addEventListener('error', (async () => {
      if (!this.playing) return;
      const me = await radioApi.me().catch(() => null);
      if (me && !me.allowed) return this.endTrial();

      // Seamlessly recover with jingle and reconnect/fallback to archive
      console.warn('[Lyria] stream interrupted; triggering seamless watchdog recovery');
      void this.triggerDeadAirRecovery();
    }) as EventListener);

    return helper;
  }

  private async applyStation(): Promise<void> {
    if (!this.helper) return;
    const prompts = new Map<string, Prompt>([
      ['mood', { promptId: 'mood', text: this.station.prompt, weight: 1.3, cc: 0, color: '#888' }],
      ['neg', { promptId: 'neg', text: NEGATIVE_PROMPT, weight: 0.25, cc: 0, color: '#444' }],
    ]);
    const config = {
      bpm: this.station.bpm,
      density: this.station.density,
      brightness: this.station.brightness,
      guidance: 4.0,
      temperature: 1.0,
    } as MusicGenerationConfig;
    await this.helper.setWeightedPrompts(prompts);
    await this.helper.setMusicGenerationConfig(config);
  }

  private async playWelcomeIntro(): Promise<void> {
    const sid = hostStationId(this.station);
    try {
      this.duck(0.15, 0.2);
      const buf = await this.decode(`/radio-api/welcome/${sid}.wav`);
      if (!this.playing) return;
      this.speaking = true;
      this.events.onHostState?.(true, 'host');
      await this.playVoice(buf);
    } catch {
      // Ignored if greeting is missing
    } finally {
      this.speaking = false;
      this.events.onHostState?.(false, null);
      this.duck(1.0, 1.8);
    }
  }

  private async triggerDeadAirRecovery(): Promise<void> {
    if (this.recovering || !this.playing) return;
    this.recovering = true;
    const sid = hostStationId(this.station);
    try {
      // 1. Short host ident over the silence, so the listener knows the radio is alive.
      const jingleBuf = await this.decode(`/radio-api/jingle/${sid}.wav`).catch(() => null);
      if (jingleBuf && this.playing && !this.speaking) {
        this.speaking = true;
        this.events.onHostState?.(true, 'jingle');
        await this.playVoice(jingleBuf);
        this.speaking = false;
        this.events.onHostState?.(false, null);
      }
      // 2. Restart music; retry with backoff until it plays or the user stops the radio.
      for (let attempt = 0; this.playing; attempt++) {
        this.chunkStreamer?.stop();
        this.helper?.stop();
        if (await this.startMusic()) {
          this.events.onStatus(`Gra ${this.station.name}`);
          return;
        }
        this.events.onStatus('Łączę ponownie z muzyką...');
        await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 2000 * (attempt + 1))));
      }
    } finally {
      this.silentTicks = 0;
      this.recovering = false;
    }
  }

  private startLevelMeter(): void {
    const buffer = new Float32Array(this.analyser.fftSize);
    this.levelTimer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / buffer.length);
      this.events.onLevel(Math.min(1, rms * 4));

      // Watchdog: detect dead air (>3.5s silence) while playing and not in break
      if (this.playing && !this.speaking && rms < 0.003) {
        this.silentTicks++;
        if (this.silentTicks > 28) {
          void this.triggerDeadAirRecovery();
        }
      } else {
        this.silentTicks = 0;
      }
    }, 120);
  }

  private endTrial(): void {
    this.stop();
    this.events.onTrialEnded();
  }

  private async refreshNews(): Promise<void> {
    try {
      const { categories } = await radioApi.news(this.categories);
      this.queue = interleaveStories(categories);
      this.events.onQueue(this.queue, null);
    } catch (error) {
      if (error instanceof TrialEndedError) return this.endTrial();
      // Silently retry on next tick
    }
  }

  private clearSchedule(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private scheduleNextBreak(): void {
    if (this.hostMode === 'music-only') return;
    const now = new Date();
    const slot = nextBreakAt(now, this.interval);
    this.events.onNextBreak(slot);
    this.timers.push(
      setTimeout(async () => {
        await this.airBreak(slot);
        if (this.playing && this.hostMode === 'with-host') this.scheduleNextBreak();
      }, msUntilNextBreak(now, this.interval)),
    );
  }

  private duck(level: number, seconds: number): void {
    const gain = this.musicBus.gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(level, now + seconds);
  }

  private async decode(path: string): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(await radioApi.audio(path));
  }

  private async airBreak(slot: Date, standalone = false): Promise<void> {
    if (this.speaking || (!this.playing && !standalone) || this.hostMode === 'music-only') return;
    this.speaking = true;
    const hhmm = `${String(slot.getHours()).padStart(2, '0')}:${String(slot.getMinutes()).padStart(2, '0')}`;
    const sid = hostStationId(this.station);
    const story = pickNextStory(this.queue, this.aired);

    try {
      this.events.onHostState?.(true, 'news');
      const intro = await this.decode(`/radio-api/intro.wav?time=${hhmm}&station=${sid}`).catch(() => null);
      const body = story ? await this.decode(`/radio-api/story/${story.id}.wav`).catch(() => null) : null;
      if (!intro && !body) return;

      this.events.onOnAir(story);
      if (story) {
        this.aired.add(story.id);
        this.events.onQueue(this.queue, story.id);
      }

      if (this.playing) {
        this.duck(DUCK_LEVEL, 1.2);
        await new Promise((r) => setTimeout(r, 600));
      }
      if (intro) await this.playVoice(intro);
      if (body) await this.playVoice(body);
    } catch (error) {
      if (error instanceof TrialEndedError) return this.endTrial();
    } finally {
      if (this.playing) this.duck(1.0, 2.0);
      this.speaking = false;
      this.events.onHostState?.(false, null);
      this.events.onOnAir(null);
    }
  }

  private playVoice(buffer: AudioBuffer): Promise<void> {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceGain);
    return new Promise<void>((resolve) => {
      source.onended = () => resolve();
      source.start();
    });
  }
}
