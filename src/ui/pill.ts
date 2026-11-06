/**
 * "Pigułka z YouTube" (Plus): the listener pastes a video or channel link, the server picks the
 * most important ~20% of the transcript and cuts those exact audio fragments. This module renders
 * the form inside #plusPanel, polls the job every 3 s and hands the finished parts to the player.
 */
import './pill.css';

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 400; // 20 minutes
const MAX_URL_LENGTH = 300;

const PILL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="m9.5 7.5 7 9"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>';

type PillStatus = 'queued' | 'working' | 'ready' | 'error';

interface PillPart {
  kind: string;
  url: string;
}

interface PillState {
  id: string;
  status: PillStatus;
  title: string;
  author: string;
  source_url: string;
  parts: PillPart[];
  error: string;
}

export interface PillOptions {
  onStatus: (text: string, isError?: boolean) => void;
  /** Plays the finished parts through the podcast player (stops the radio first). */
  play: (title: string, parts: PillPart[]) => Promise<void>;
  stop: () => void;
  isPlaying: () => boolean;
}

const STATUS_COPY: Record<'queued' | 'working', string> = {
  queued: 'Twoja pigułka czeka w kolejce...',
  working: 'Robię pigułkę: czytam napisy, wybieram najważniejsze fragmenty i wycinam dźwięk. To potrwa kilka minut.',
};

let options: PillOptions;
let urlInput: HTMLInputElement;
let button: HTMLButtonElement;
let progress: HTMLElement;
let source: HTMLElement;
let busy = false;

// --- own fetch helpers (radioApi.ts is owned by another module) ----------------------------------

async function pillRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

const startPill = (url: string) => pillRequest<{ id: string; status: PillStatus }>('/radio-api/plus/pill', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
});
const readPill = (id: string) => pillRequest<PillState>(`/radio-api/plus/pill/${encodeURIComponent(id)}`);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- UI -------------------------------------------------------------------------------------------

export function initPill(events: PillOptions): void {
  options = events;
  const panel = document.getElementById('plusPanel');
  if (!panel) throw new Error('missing #plusPanel'); // autocheck spot: page and script must match
  const form = document.createElement('form');
  form.className = 'pill-box';
  form.noValidate = true;
  form.innerHTML = `
    <h3>${PILL_SVG}Pigułka z YouTube</h3>
    <label class="plus-field" for="pillUrl">Link do odcinka albo kanału
      <input type="url" id="pillUrl" maxlength="${MAX_URL_LENGTH}" placeholder="https://www.youtube.com/watch?v=..." />
    </label>
    <p class="pill-hint">Wybieramy najważniejsze 20% odcinka i puszczamy je jako krótkie bloki, każdy z jednozdaniowym wstępem prowadzącej. Kanał oznacza jego najnowszy odcinek (do 3 godzin).</p>
    <button type="submit" class="btn" id="pillBtn">${PILL_SVG} Zrób pigułkę</button>
    <div class="pill-progress" id="pillProgress" role="status"></div>
    <div class="pill-source" id="pillSource"></div>`;
  panel.append(form);
  urlInput = form.querySelector<HTMLInputElement>('#pillUrl')!;
  button = form.querySelector<HTMLButtonElement>('#pillBtn')!;
  progress = form.querySelector<HTMLElement>('#pillProgress')!;
  source = form.querySelector<HTMLElement>('#pillSource')!;
  form.addEventListener('submit', (event) => { event.preventDefault(); void handleSubmit(); });
}

function setProgress(text: string, isError = false): void {
  progress.textContent = text;
  progress.classList.toggle('error', isError);
}

function setButton(playing: boolean): void {
  button.innerHTML = playing ? `${STOP_SVG} Zatrzymaj` : `${PILL_SVG} Zrób pigułkę`;
}

/** Author and link to the original episode; only http(s) links are rendered as links. */
function showSource(state: PillState): void {
  source.replaceChildren();
  if (!/^https?:\/\//i.test(state.source_url)) return;
  const link = document.createElement('a');
  link.href = state.source_url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = state.title || state.source_url;
  source.append('Źródło: ', link, state.author ? ` — ${state.author}` : '');
}

async function handleSubmit(): Promise<void> {
  if (options.isPlaying()) {
    options.stop();
    options.onStatus('Zatrzymano.');
    return;
  }
  if (busy) return;
  const url = urlInput.value.trim();
  if (!/^https?:\/\//i.test(url)) {
    setProgress('Wklej link do odcinka albo kanału na YouTube (zaczyna się od https://).', true);
    return;
  }
  busy = true;
  button.disabled = true;
  source.replaceChildren();
  try {
    const finished = await runJob(url);
    showSource(finished);
    setProgress(`Gotowe: ${finished.title}`);
    button.disabled = false;
    setButton(true);
    await options.play(`Pigułka: ${finished.title}`, finished.parts);
  } catch (error) {
    setProgress((error as Error).message, true);
  } finally {
    busy = false;
    button.disabled = false;
    setButton(false);
  }
}

/** Starts the job and polls until it is ready; throws the server's Polish message on failure. */
async function runJob(url: string): Promise<PillState> {
  setProgress(STATUS_COPY.queued);
  const started = await startPill(url);
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    const state = await readPill(started.id);
    if (state.status === 'ready') return state;
    if (state.status === 'error') throw new Error(state.error || 'Nie udało się zrobić pigułki.');
    setProgress(STATUS_COPY[state.status]);
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error('Pigułka robi się zbyt długo. Spróbuj ponownie później.');
}
