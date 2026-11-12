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
import { LiveMusicHelper } from '../audio/LiveMusicHelper';
import { getSharedAudioContext } from '../audio/iosAudioUnlock';
import { applyStationToHelper, createLyriaHelper } from './liveLyria';
import { radioApi, TrialEndedError } from './radioApi';
import { interleaveStories, type NewsCategory, type QueuedStory } from './newsQueue';
import { hostStationId, isPresetStation, type Station } from './stations';
import { DEFAULT_BREAK_INTERVAL, FIRST_BREAK_DELAY_MS, nextScheduledBreak, type BreakInterval } from './radioClock';
import { HostClipPlayer } from './hostClipPlayer';
import { ChunkStreamer } from './chunkStreamer';
import { AiredStore } from './airedStore';
import { ProgrammeState } from './programmeState';
import { breakClips, planBreak, upcomingStory, HOURLY_MAX_MS, type WeatherPlace } from './programme';
import { runClips } from './breakRunner';
import { createStreamElement, isIOS, type StreamHandle } from '../audio/streamElement';
import { ToneKiller } from '../dsp/toneKiller';
import { PillQueue } from './pillQueue';
import type { BreakPlan } from './programme';

/** Music bed volume while voice is speaking, relative to full volume. */
export const DUCK_LEVEL = 0.34;
const NEWS_POLL_MS = 10 * 60_000;
/** A scheduled break with news switched off: no stories, only what the programme queue holds. */
const NO_NEWS_PLAN: BreakPlan = { kind: 'main', headlines: [], full: [], teaser: null, weather: false, empty: true };
/** Host and news voice sit 8 dB below full-volume music, so the voice never outshouts the music bed. */
export const VOICE_GAIN = 0.4;

export type HostMode = 'with-host' | 'music-only';

export interface PublicRadioEvents {
  onState: (state: 'idle' | 'loading' | 'playing' | 'paused') => void;
  onStatus: (text: string) => void;
  onError: (text: string) => void;
  onQueue: (queue: QueuedStory[], airingId: string | null) => void;
  onOnAir: (story: QueuedStory | null) => void;
  onNextBreak: (at: Date | null) => void;
  /** The story the next break will lead with or tease (for the "Za m:ss" line); null when nothing is left. */
  onUpcoming?: (story: QueuedStory | null) => void;
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
  /** Notches steady tones (the Lyria whine) on the music only; voice never passes through it. */
  private readonly toneKiller = new ToneKiller(this.ctx);
  private readonly voiceGain = this.ctx.createGain();
  /** Listener's voice level (0..1); the fixed VOICE_GAIN offset sits on top of it. */
  private voiceLevel = 1;
  /** Listener's ducked-music level (0..1 of the music); applied only while the voice speaks. */
  private duckLevel = DUCK_LEVEL;
  private ducked = false;
  private readonly analyser = this.ctx.createAnalyser();

  private helper: LiveMusicHelper | null = null;
  private chunkStreamer: ChunkStreamer | null = null;
  private streamHandle: StreamHandle | null = null;
  private station: Station;
  private categories: NewsCategory[];
  private queue: QueuedStory[] = [];
  private nextSlot: Date | null = null;

  private timers: ReturnType<typeof setTimeout>[] = [];
  private newsTimer: ReturnType<typeof setInterval> | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  private silentTicks = 0;
  private recovering = false;
  private speaking = false;
  private playing = false;
  private currentVoiceSource: AudioBufferSourceNode | null = null;
  private welcomeGeneration = 0;
  private switchCount = 0;

  private startedAt = new Date();
  private lastBreakAt: Date | null = null;
  private lastBreakEndedAt: Date | null = null;
  private readonly clipPlayer = new HostClipPlayer({
    stationId: () => hostStationId(this.station),
    canPlay: () => this.playing && this.hostMode === 'with-host' && !this.speaking,
    play: (url) => this.airHostClip(url),
  });

  public readonly programme: ProgrammeState;
  /** YouTube pills waiting to air inside the news breaks. */
  public readonly pillQueue: PillQueue;
  public interval: BreakInterval = DEFAULT_BREAK_INTERVAL;
  /** First news break comes this long after play is pressed (not on the clock grid). */
  public firstBreakDelayMs = FIRST_BREAK_DELAY_MS;
  public hostMode: HostMode = 'with-host';
  /** When false the host still chats, but scheduled news breaks are skipped ("Bez wiadomości"). */
  public newsEnabled = true;

  constructor(
    station: Station,
    categories: NewsCategory[],
    private readonly events: PublicRadioEvents,
    airedStore: AiredStore = new AiredStore(localStorage),
    pillQueue: PillQueue = new PillQueue(localStorage),
  ) {
    this.programme = new ProgrammeState(airedStore);
    this.pillQueue = pillQueue;
    this.station = station;
    this.categories = categories;

    this.limiter.threshold.value = -2;
    this.limiter.ratio.value = 12;

    this.musicBus.connect(this.toneKiller.input);
    this.toneKiller.output.connect(this.master);
    this.voiceGain.gain.value = VOICE_GAIN;
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

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  /** Overall music loudness. Independent of the voice and of the ducked level. */
  setVolume(value: number): void {
    this.master.gain.setTargetAtTime(this.clamp01(value), this.ctx.currentTime, 0.05);
  }

  /** Host and news loudness, independent of the music. */
  setVoiceVolume(value: number): void {
    this.voiceLevel = this.clamp01(value);
    this.voiceGain.gain.setTargetAtTime(this.voiceLevel * VOICE_GAIN, this.ctx.currentTime, 0.05);
  }

  /** How loud the music stays under the host and the news. Takes effect on the next duck. */
  setDuckLevel(value: number): void {
    this.duckLevel = this.clamp01(value);
    if (this.ducked) this.duck(this.duckLevel, 0.4);
  }

  setHostMode(mode: HostMode): void {
    this.hostMode = mode;
    this.events.onHostModeChange?.(mode);
    if (this.playing) {
      this.clearSchedule();
      if (mode === 'with-host') {
        this.resetBreakSchedule();
        this.scheduleNextBreak();
        this.clipPlayer.start();
      } else {
        this.clipPlayer.stop();
        this.events.onNextBreak(null);
      }
    }
  }

  async start(): Promise<void> {
    await this.ctx.resume();
    this.events.onState('loading');
    this.playing = true; // set first: greeting, watchdog and breaks all check it
    this.resetBreakSchedule();
    this.programme.startSession(new Date());
    void this.programme.aired.pull();
    this.startLevelMeter();
    this.toneKiller.start();

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
      this.clipPlayer.start();
    } else {
      this.events.onNextBreak(null);
    }
  }


  /**
   * Play the station through a real <audio> element. Resolves false (so the
   * chunk streamer takes over) when the element errors or the platform refuses
   * to create a media element source.
   */
  private async startStreamElement(): Promise<boolean> {
    return this.openStream(this.streamUrl());
  }

  private streamUrl(): string {
    return `/radio-api/station/${this.station.id}/stream.ogg`;
  }

  /**
   * Opens `url` in a new <audio> element on the music bus. With `previous` (a restart) the old element
   * keeps playing until the new one runs, then it is torn down; on failure the old one stays.
   */
  private async openStream(url: string, previous: StreamHandle | null = null): Promise<boolean> {
    const switchId = ++this.switchCount;
    // Mute previous stream immediately so two stations NEVER play or overlap simultaneously
    if (previous) {
      previous.el.muted = true;
    }
    let handle: StreamHandle;
    try {
      handle = createStreamElement(this.ctx, url, this.musicBus);
    } catch {
      if (previous) previous.el.muted = false;
      return false;
    }
    this.streamHandle = handle;
    handle.el.addEventListener('error', () => {
      if (this.streamHandle !== handle) return;
      this.stopStreamElement();
      void this.startChunkFallback();
    });
    handle.el.addEventListener('playing', () => { this.silentTicks = 0; });
    try {
      await handle.el.play();
    } catch {
      handle.destroy();
      if (switchId === this.switchCount) {
        this.streamHandle = previous;
        if (previous) {
          previous.el.muted = false;
          if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
        }
      }
      return false;
    }
    if (previous) {
      previous.destroy();
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; // destroy() reset it
    }
    // If another station switch started while this handle was loading, discard it
    if (switchId !== this.switchCount) {
      handle.destroy();
      return false;
    }
    return true;
  }

  /** The chunk path, used on iOS and whenever the stream element fails. */
  private async startChunkFallback(): Promise<boolean> {
    if (this.chunkStreamer) return true;
    this.chunkStreamer = new ChunkStreamer(this.ctx, this.musicBus, this.station.id, {
      onChunk: () => { this.silentTicks = 0; },
      onError: (reason) => {
        if (reason === 'trial-ended') { this.endTrial(); return; }
        this.triggerDeadAirRecovery();
      },
    });
    return this.chunkStreamer.start();
  }

  private stopStreamElement(): void {
    this.streamHandle?.destroy();
    this.streamHandle = null;
  }

  /** Archive stream first (scales to any number of listeners), live Lyria only as a fallback. */
  private async startMusic(): Promise<boolean> {
    // A real <audio> element keeps Android Chrome alive after the browser is
    // closed. iOS Safari stays on the chunk path (MediaElementSource bug).
    if (isPresetStation(this.station) && !isIOS() && (await this.startStreamElement())) return true;
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
    this.clipPlayer.stop();
    if (this.newsTimer) clearInterval(this.newsTimer);
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.newsTimer = null;
    this.levelTimer = null;
    this.toneKiller.stop();

    if (this.chunkStreamer) {
      this.chunkStreamer.stop();
      this.chunkStreamer = null;
    }
    this.stopStreamElement();
    this.helper?.pause();
    this.playing = false;
    this.events.onState('paused');
    this.events.onLevel(0);
  }

  async setStation(station: Station): Promise<void> {
    const prev = this.station;
    this.station = station;
    if (!this.playing) return;

    // Stop competing engines and any in-flight voice clip
    this.chunkStreamer?.stop();
    this.chunkStreamer = null;
    this.helper?.stop();
    this.stopVoice();

    if (isPresetStation(station)) {
      if (this.streamHandle) {
        await this.openStream(this.streamUrl(), this.streamHandle);
      } else if (!this.chunkStreamer) {
        await this.startMusic();
      } else if (!(await this.chunkStreamer.setStation(station.id))) {
        void this.triggerDeadAirRecovery();
      }
    } else {
      // A mood station has no archive: generate it live with Lyria.
      this.stopStreamElement();
      if (!this.helper) this.helper = this.createHelper();
      await this.applyStation();
      // The live model keeps its context across a prompt change; resetting it mid-bar is a hard cut.
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

  setNewsEnabled(enabled: boolean): void {
    this.newsEnabled = enabled;
    if (this.playing && this.hostMode === 'with-host') {
      this.clearSchedule();
      this.scheduleNextBreak();
    }
  }

  /** Puts a pill into the programme; it airs one unit per break, after the news. */
  enqueuePill(pill: { id: string; title: string; parts: { kind: string; url: string }[] }): boolean {
    const added = this.pillQueue.enqueue(pill);
    if (added && this.playing && this.hostMode === 'with-host') {
      this.clearSchedule();
      this.scheduleNextBreak();
    }
    return added;
  }

  /** Topic of the day (leads the main stories) and the hourly-bulletin options; takes effect on the next break. */
  setProgramme(options: { dayTopic: NewsCategory | null; hourlyEnabled: boolean; place: WeatherPlace | null }): void {
    this.programme.dayTopic = options.dayTopic;
    this.programme.hourlyEnabled = options.hourlyEnabled;
    this.programme.place = options.place;
    this.emitUpcoming();
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
    if (this.playing && this.hostMode === 'with-host') {
      this.clearSchedule();
      this.scheduleNextBreak(); // counted from this break
    }
  }

  private createHelper(): LiveMusicHelper {
    const helper = createLyriaHelper(this.musicBus);

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
    if (this.helper) await applyStationToHelper(this.helper, this.station);
  }

  private stopVoiceSource(): void {
    if (this.currentVoiceSource) {
      try { this.currentVoiceSource.stop(); } catch {}
      try { this.currentVoiceSource.disconnect(); } catch {}
      this.currentVoiceSource = null;
    }
  }

  private stopVoice(): void {
    this.welcomeGeneration++;
    this.stopVoiceSource();
    this.speaking = false;
    this.events.onHostState?.(false, null);
  }

  private async playWelcomeIntro(): Promise<void> {
    const gen = ++this.welcomeGeneration;
    const sid = hostStationId(this.station);
    try {
      const buf = await this.decode(`/radio-api/welcome/${sid}.wav`);
      if (!this.playing || gen !== this.welcomeGeneration) return;
      this.stopVoice();
      this.duck(0.15, 0.2);
      this.speaking = true;
      this.events.onHostState?.(true, 'host');
      await this.playVoice(buf);
    } catch {
      // Ignored if greeting is missing
    } finally {
      if (gen === this.welcomeGeneration) {
        this.speaking = false;
        this.events.onHostState?.(false, null);
        this.duck(1.0, 1.8);
      }
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
        this.stopStreamElement();
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
      this.emitUpcoming();
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
    if (this.hostMode === 'music-only' || (!this.newsEnabled && this.pillQueue.isEmpty)) {
      this.events.onNextBreak(null);
      return;
    }
    const slot = nextScheduledBreak({
      startedAt: this.startedAt,
      lastBreakAt: this.lastBreakAt,
      lastBreakEndedAt: this.lastBreakEndedAt,
      interval: this.interval,
      firstBreakDelayMs: this.firstBreakDelayMs,
    });
    this.events.onNextBreak(slot);
    this.nextSlot = slot;
    this.emitUpcoming();
    this.timers.push(
      setTimeout(async () => {
        await this.airBreak(slot);
        if (this.playing && this.hostMode === 'with-host') this.scheduleNextBreak();
      }, Math.max(0, slot.getTime() - Date.now())),
    );
  }

  /** A fresh listening session (or host mode switched on) restarts the 5 minute countdown. */
  private resetBreakSchedule(): void {
    this.startedAt = new Date();
    this.lastBreakAt = null;
    this.lastBreakEndedAt = null;
  }

  /** Random jingle/chatter between songs: ducks the music like a news break. */
  private async airHostClip(url: string): Promise<void> {
    const buffer = await this.decode(url);
    if (!this.playing || this.speaking) return;
    this.speaking = true;
    try {
      this.events.onHostState?.(true, 'host');
      this.duck(this.duckLevel, 1.0);
      await new Promise((r) => setTimeout(r, 500));
      await this.playVoice(buffer);
    } finally {
      if (this.playing) this.duck(1.0, 1.8);
      this.speaking = false;
      this.events.onHostState?.(false, null);
    }
  }

  private duck(level: number, seconds: number): void {
    this.ducked = level < 1;
    const gain = this.musicBus.gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(level, now + seconds);
  }

  private async decode(path: string): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(await radioApi.audio(path));
  }

  private emitUpcoming(): void {
    const at = this.nextSlot ?? new Date();
    this.events.onUpcoming?.(upcomingStory(this.programme.context(this.queue, at)));
  }

  /** Nothing new to report today: say so briefly and let the host chat instead of repeating a story. */
  private async airFiller(): Promise<void> {
    this.events.onStatus('To już wszystkie nowe wiadomości na dziś. Zaraz coś od prowadzącego.');
    const clips = await radioApi.hostClips(hostStationId(this.station));
    const url = clips?.chatter[Math.floor(Math.random() * (clips?.chatter.length ?? 0))];
    if (url) await this.airHostClip(url).catch(() => {});
  }

  private async airBreak(slot: Date, standalone = false): Promise<void> {
    if ((this.speaking && !standalone) || (!this.playing && !standalone) || this.hostMode === 'music-only') return;
    if (standalone && this.speaking) {
      this.stopVoiceSource();
    }
    this.lastBreakAt = new Date();
    const newsAllowed = this.newsEnabled || standalone; // "Bez wiadomości" still airs queued pills
    let plan = newsAllowed ? planBreak(this.programme.context(this.queue, this.lastBreakAt)) : NO_NEWS_PLAN;
    if (standalone && plan.empty && this.queue.length > 0) {
      // Listener explicitly asked for news now: air top stories even if already heard earlier today
      const lead = this.queue[0];
      const others = this.queue.slice(1, 4).filter((s) => Boolean(s.headline));
      plan = {
        kind: 'flash',
        headlines: others,
        full: [lead],
        teaser: null,
        weather: false,
        empty: false,
      };
    }
    const pillUnit = this.pillQueue.peekUnit();
    if (plan.empty && !pillUnit) return this.airFiller();

    this.welcomeGeneration++;
    this.speaking = true;
    const hhmm = `${String(slot.getHours()).padStart(2, '0')}:${String(slot.getMinutes()).padStart(2, '0')}`;
    const clips = breakClips(plan, { hhmm, stationId: hostStationId(this.station), place: this.programme.place, pillUnit });
    let played: typeof clips = [];

    try {
      this.events.onHostState?.(true, 'news');
      if (plan.full[0]) {
        this.events.onOnAir(plan.full[0]);
        this.events.onQueue(this.queue, plan.full[0].id);
      } else {
        this.events.onOnAir(null);
      }
      if (this.playing) {
        // Duck only. Restarting the live model or the stream here cuts the mix under the voice.
        this.duck(this.duckLevel, 1.2);
        await new Promise((r) => setTimeout(r, 600));
      }
      played = await runClips(
        clips,
        {
          decode: (path) =>
            this.decode(path).catch((err) => {
              if (err instanceof TrialEndedError) this.endTrial();
              return null;
            }),
          play: async (buffer, clip) => {
            this.events.onHostState?.(true, 'news');
            if (clip.storyId) {
              const story = this.queue.find((s) => s.id === clip.storyId);
              if (story) {
                this.events.onOnAir(story);
                this.events.onQueue(this.queue, story.id);
              }
            } else if (clip.role === 'weather') {
              this.events.onOnAir({
                id: 'weather',
                category: 'ai',
                title: 'Prognoza pogody',
                radio_text: 'Aktualna prognoza pogody.',
                headline: 'Pogoda',
                confirmed: true,
                source_url: '',
                audio_ready: true,
              } as unknown as QueuedStory);
            } else if (clip.role === 'intro') {
              this.events.onOnAir(null);
            }
            await this.playVoice(buffer);
          },
          now: Date.now,
        },
        plan.kind === 'hourly' ? HOURLY_MAX_MS : undefined,
      );
      if (clips.length > 0 && played.length === 0) {
        this.events.onStatus('Nie udało się załadować nagrań serwisu informacyjnego.');
      }
      if (pillUnit) this.pillQueue.commitUnit(); // an unloadable unit is skipped, never retried forever
    } catch (error) {
      if (error instanceof TrialEndedError) return this.endTrial();
    } finally {
      if (!plan.empty) this.programme.record(plan, played, new Date());
      this.lastBreakEndedAt = new Date();
      this.events.onQueue(this.queue, null); // re-render: just-aired stories turn grey
      if (this.playing) this.duck(1.0, 2.0);
      this.stopVoice();
      this.events.onOnAir(null);
      this.emitUpcoming();
    }
  }

  private playVoice(buffer: AudioBuffer): Promise<void> {
    this.stopVoiceSource();
    this.speaking = true;
    const source = this.ctx.createBufferSource();
    this.currentVoiceSource = source;
    source.buffer = buffer;
    source.connect(this.voiceGain);
    return new Promise<void>((resolve) => {
      source.onended = () => {
        if (this.currentVoiceSource === source) {
          this.currentVoiceSource = null;
        }
        resolve();
      };
      source.start();
    });
  }
}
