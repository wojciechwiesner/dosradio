/**
 * DOS Radio Plus panel: "Twoje źródła" (own keywords + RSS feeds), the duet podcast
 * generator (with radio bumpers) and the YouTube pill form from pill.ts. Mounted for
 * Plus subscribers only; non-Plus listeners never see the panel, and the server gates
 * every /radio-api/plus route anyway.
 */
import { getSharedAudioContext } from '../audio/iosAudioUnlock';
import { radioApi, type DigestStory, type PodcastManifest } from '../radio/radioApi';
import { initPill } from './pill';

const MAX_KEYWORDS = 20;
const MAX_RSS_FEEDS = 10;
const MAX_DIGEST_PLAYS = 8;

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>';
const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';

export interface PlusOptions {
  onStatus: (text: string, isError?: boolean) => void;
  /** Radio must yield its audio output while a podcast or digest is playing. */
  stopRadio: () => void;
}

/** One audio file of a sequence; `kind` decides whether its edges are faded (music and bumpers). */
export interface AudioPart {
  kind: string;
  url: string;
}

const FADE_SECONDS = 1.5;
const FADED_KINDS = new Set(['music', 'bumper']);
const SCHEDULE_PAD_S = 0.05;
const SCHEDULE_AHEAD_S = 0.4;
const POLL_MS = 100;

/**
 * Plays audio parts back to back through the shared Web Audio graph. The next part is decoded
 * while the current one plays and scheduled on the audio clock, so there are no gaps; music
 * and bumper parts get a 1.5 s fade on both edges.
 */
class SequencePlayer {
  private generation = 0;
  private active = false;
  private readonly ctx = getSharedAudioContext();
  private readonly sources = new Set<AudioBufferSourceNode>();

  get isPlaying(): boolean {
    return this.active;
  }

  stop(): void {
    this.generation++;
    this.active = false;
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already ended */ }
    }
    this.sources.clear();
  }

  async play(title: string, parts: AudioPart[], onStatus: (text: string) => void): Promise<void> {
    this.active = true;
    const generation = ++this.generation;
    try {
      let cursor = 0;
      let pending = parts.length ? this.load(parts[0].url) : null;
      for (let index = 0; index < parts.length; index++) {
        const buffer = await pending;
        if (generation !== this.generation || !buffer) return;
        pending = index + 1 < parts.length ? this.load(parts[index + 1].url) : null; // decode ahead
        onStatus(`Odtwarzam: ${title} (${index + 1}/${parts.length})`);
        const startAt = Math.max(this.ctx.currentTime + SCHEDULE_PAD_S, cursor);
        cursor = startAt + buffer.duration;
        this.schedule(buffer, parts[index].kind, startAt);
        await this.waitUntil(cursor - SCHEDULE_AHEAD_S, generation);
      }
      await this.waitUntil(cursor, generation);
      if (generation === this.generation) onStatus(`${title} — zakończone. Kliknij Graj, żeby wrócić do radia.`);
    } finally {
      if (generation === this.generation) this.active = false;
    }
  }

  private load(url: string): Promise<AudioBuffer> {
    const decoded = radioApi.audio(url).then((data) => this.ctx.decodeAudioData(data));
    decoded.catch(() => undefined); // surfaced by the await in play(); avoids an unhandled rejection after stop()
    return decoded;
  }

  private schedule(buffer: AudioBuffer, kind: string, startAt: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    let output: AudioNode = source;
    if (FADED_KINDS.has(kind)) {
      const fade = Math.min(FADE_SECONDS, buffer.duration / 2);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(1, startAt + fade);
      gain.gain.setValueAtTime(1, startAt + buffer.duration - fade);
      gain.gain.linearRampToValueAtTime(0, startAt + buffer.duration);
      source.connect(gain);
      output = gain;
    }
    output.connect(this.ctx.destination);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    source.start(startAt);
  }

  private async waitUntil(time: number, generation: number): Promise<void> {
    while (generation === this.generation && this.ctx.currentTime < time) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}

const player = new SequencePlayer();

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`); // autocheck spot: page and script must match
  return element as T;
};

let options: PlusOptions;
let digestParts: AudioPart[] = [];

export function isPlusAudioPlaying(): boolean {
  return player.isPlaying;
}

export function stopPlusAudio(): void {
  player.stop();
}

export function initPlus(events: PlusOptions): void {
  options = events;
  $<HTMLButtonElement>('podcastBtn').innerHTML = `${MIC_SVG} Wygeneruj podcast`;
  $('plusPrefsForm').addEventListener('submit', (event) => { event.preventDefault(); void savePreferences(); });
  $('podcastForm').addEventListener('submit', (event) => { event.preventDefault(); void handlePodcast(); });
  $('plusDigestPlay').addEventListener('click', () => void playDigest());
  initPill({ onStatus: events.onStatus, play: playPillParts, stop: stopPlusAudio, isPlaying: isPlusAudioPlaying });
}

/** Plays a finished YouTube pill through the podcast player; toggles off when already playing. */
async function playPillParts(title: string, parts: AudioPart[]): Promise<void> {
  options.stopRadio();
  await player.play(title, parts, options.onStatus);
}

/** Called by the page whenever /radio-api/me changes; shows the panel for Plus only. */
export async function refreshPlusPanel(plus: boolean): Promise<void> {
  $('plusPanel').hidden = !plus;
  if (!plus) {
    stopPlusAudio();
    return;
  }
  try {
    const prefs = await radioApi.newsPreferences();
    $<HTMLInputElement>('plusKeywords').value = prefs.keywords.join(', ');
    $<HTMLTextAreaElement>('plusFeeds').value = prefs.rss_feeds.join('\n');
    await renderDigest();
  } catch (error) {
    options.onStatus((error as Error).message, true);
  }
}

// --- preferences ------------------------------------------------------------------

async function savePreferences(): Promise<void> {
  const info = $('plusPrefsInfo');
  const keywords = $<HTMLInputElement>('plusKeywords').value.split(/[,;\n]/).map((word) => word.trim()).filter(Boolean);
  const feeds = $<HTMLTextAreaElement>('plusFeeds').value.split('\n').map((feed) => feed.trim()).filter(Boolean);
  if (keywords.length > MAX_KEYWORDS) {
    info.textContent = `Maksymalnie ${MAX_KEYWORDS} słów kluczowych.`;
    return;
  }
  if (feeds.length > MAX_RSS_FEEDS) {
    info.textContent = `Maksymalnie ${MAX_RSS_FEEDS} kanałów RSS.`;
    return;
  }
  if (feeds.some((feed) => !/^https?:\/\//i.test(feed))) {
    info.textContent = 'Każdy kanał RSS musi zaczynać się od http:// albo https://.';
    return;
  }
  const save = $<HTMLButtonElement>('plusPrefsSave');
  save.disabled = true;
  try {
    await radioApi.saveNewsPreferences(keywords, feeds);
    info.textContent = 'Zapisano. Wiadomości z twoich źródeł za chwilę się odświeżą.';
    await renderDigest();
  } catch (error) {
    info.textContent = (error as Error).message;
  } finally {
    save.disabled = false;
  }
}

// --- personalized digest ------------------------------------------------------------

async function renderDigest(): Promise<void> {
  const digest = await radioApi.newsDigest();
  if (!digest.personal) {
    $('plusDigestHead').textContent = digest.fallback
      ? 'Twoje kanały nie odpowiadają — na antenie globalne wydanie'
      : 'Dodaj słowa kluczowe albo kanały RSS, żeby słuchać własnych wiadomości';
    $('plusDigest').replaceChildren();
    $('plusDigestPlay').hidden = true;
    digestParts = [];
    return;
  }
  $('plusDigestHead').textContent = `Najświeższe z twoich źródeł (${digest.stories.length})`;
  $('plusDigestPlay').hidden = false;
  digestParts = digest.stories.slice(0, MAX_DIGEST_PLAYS)
    .map((story) => ({ kind: 'voice', url: `/radio-api/story/${story.id}.wav` }));
  $('plusDigest').replaceChildren(...digest.stories.map((story) => digestItem(story)));
}

function digestItem(story: DigestStory): HTMLLIElement {
  const item = document.createElement('li');
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = 'twoje';
  const link = document.createElement('a');
  link.href = story.source_url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = story.title;
  item.append(tag, link);
  return item;
}

async function playDigest(): Promise<void> {
  if (!digestParts.length) return;
  if (player.isPlaying) {
    player.stop();
    options.onStatus('Zatrzymano.');
    return;
  }
  options.stopRadio();
  try {
    await player.play('Twoje wiadomości', digestParts, options.onStatus);
  } catch (error) {
    options.onStatus((error as Error).message, true);
  }
}

// --- duet podcast --------------------------------------------------------------------

async function handlePodcast(): Promise<void> {
  const button = $<HTMLButtonElement>('podcastBtn');
  if (player.isPlaying) {
    player.stop();
    options.onStatus('Zatrzymano.');
    return;
  }
  const topic = $<HTMLInputElement>('podcastTopic').value.trim();
  button.disabled = true;
  options.onStatus(topic ? `Generuję podcast: ${topic}...` : 'Generuję dzisiejszy podcast...');
  try {
    const manifest: PodcastManifest = await radioApi.podcast(topic || undefined);
    options.stopRadio();
    button.innerHTML = `${STOP_SVG} Zatrzymaj`;
    await player.play(`Podcast: ${manifest.title}`, manifest.parts, options.onStatus);
  } catch (error) {
    options.onStatus((error as Error).message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = `${MIC_SVG} Wygeneruj podcast`;
  }
}
