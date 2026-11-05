/**
 * DOS Radio Plus panel: "Twoje źródła" (own keywords + RSS feeds) and the duet
 * podcast generator. Mounted for Plus subscribers only; non-Plus listeners never
 * see the panel, and the server gates every /radio-api/plus route anyway.
 */
import { getSharedAudioContext } from '../audio/iosAudioUnlock';
import { radioApi, type DigestStory, type PodcastManifest } from '../radio/radioApi';

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

/** Plays a list of audio URLs back to back through the shared Web Audio graph. */
class SequencePlayer {
  private generation = 0;
  private active = false;
  private readonly ctx = getSharedAudioContext();

  get isPlaying(): boolean {
    return this.active;
  }

  stop(): void {
    this.generation++;
    this.active = false;
  }

  async play(title: string, urls: string[], onStatus: (text: string) => void): Promise<void> {
    this.active = true;
    const generation = ++this.generation;
    try {
      for (let index = 0; index < urls.length; index++) {
        if (generation !== this.generation) return;
        onStatus(`Odtwarzam: ${title} (${index + 1}/${urls.length})`);
        const buffer = await this.ctx.decodeAudioData(await radioApi.audio(urls[index]));
        if (generation !== this.generation) return;
        await new Promise<void>((resolve) => {
          const source = this.ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(this.ctx.destination);
          source.onended = () => resolve();
          source.start();
        });
      }
      onStatus(`${title} — zakończone. Kliknij Graj, żeby wrócić do radia.`);
    } finally {
      if (generation === this.generation) this.active = false;
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
let digestUrls: string[] = [];

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
    digestUrls = [];
    return;
  }
  $('plusDigestHead').textContent = `Najświeższe z twoich źródeł (${digest.stories.length})`;
  $('plusDigestPlay').hidden = false;
  digestUrls = digest.stories.slice(0, MAX_DIGEST_PLAYS).map((story) => `/radio-api/story/${story.id}.wav`);
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
  if (!digestUrls.length) return;
  if (player.isPlaying) {
    player.stop();
    options.onStatus('Zatrzymano.');
    return;
  }
  options.stopRadio();
  try {
    await player.play('Twoje wiadomości', digestUrls, options.onStatus);
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
    await player.play(`Podcast: ${manifest.title}`, manifest.parts.map((part) => part.url), options.onStatus);
  } catch (error) {
    options.onStatus((error as Error).message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = `${MIC_SVG} Wygeneruj podcast`;
  }
}
