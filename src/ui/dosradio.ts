/** dosradio.theones.io page: stations, news topics, trial countdown, registration. */
import { PublicRadioEngine, type HostMode } from '../radio/publicRadioEngine';
import { airedRemote, radioApi, type AccessState } from '../radio/radioApi';
import { availableCategories, categoryLabel, sanitizeCategories, type NewsCategory, type QueuedStory } from '../radio/newsQueue';
import { STATIONS, stationById, type Station } from '../radio/stations';
import { intervalLabel, normalizeInterval } from '../radio/radioClock';
import { initBackgroundAudio } from '../audio/backgroundAudio';
import { applyOnboardingChoice, isOnboarded, loadPrefs, markOnboarded, nextGenreChoice, programmeOptions, sanitizeDayTopic, savePrefs as persistPrefs, type OnboardingChoice } from './prefs';
import { initUpcoming } from './upcoming';
import { initRamowkaSettings } from './ramowkaSettings';
import { openOnboarding } from './onboarding';
import { initPlus, refreshPlusPanel, isPlusAudioPlaying, stopPlusAudio } from './plus';
import { initProgrammeLine } from './pill';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`); // autocheck spot: page and script must match
  return element as T;
};

const TRIAL_FALLBACK_SECONDS = 3600;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/** 3600 -> "1:00:00", 125 -> "2:05" (hours only shown when the trial is an hour or more). */
function formatTrialLeft(seconds: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const secs = seconds % SECONDS_PER_MINUTE;
  if (seconds >= SECONDS_PER_HOUR) return `${Math.floor(seconds / SECONDS_PER_HOUR)}:${pad(minutes)}:${pad(secs)}`;
  return `${minutes}:${pad(secs)}`;
}

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const TICK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>';

let prefs = loadPrefs(localStorage);
const savePrefs = () => persistPrefs(localStorage, prefs);

let access: AccessState | null = null;
let trialTimer: ReturnType<typeof setInterval> | null = null;
let authMode: 'register' | 'login' = 'register';

// --- rendering ---------------------------------------------------------------
const playButton = $<HTMLButtonElement>('play');
const newsButton = $<HTMLButtonElement>('newsNow');
const statusLine = $('status');

function setStatus(text: string, isError = false): void {
  statusLine.textContent = text;
  statusLine.classList.toggle('error', isError);
}

function renderStations(): void {
  $('stations').replaceChildren(...STATIONS.map((station) => {
    const button = document.createElement('button');
    const isBlend = station.id === prefs.blend;
    button.className = `station${station.id === prefs.station ? ' active' : ''}${isBlend ? ' blend' : ''}`;
    button.dataset.id = station.id;
    button.title = station.tagline;
    const name = document.createElement('b');
    name.textContent = station.name;
    const bpm = document.createElement('em');
    bpm.textContent = `${station.bpm}`;
    button.append(name, bpm);
    button.addEventListener('click', () => void chooseStation(station));
    return button;
  }));
  const current = stationById(prefs.station);
  const blended = prefs.blend ? stationById(prefs.blend) : null;
  $('nowStation').textContent = blended ? `${current.name} + ${blended.name}` : current.name;
  $('nowTagline').textContent = current.host ? `${current.tagline} (prowadzi: ${current.host})` : current.tagline;
}

function renderCategories(): void {
  $('categories').replaceChildren(...availableCategories(Boolean(access?.plus)).map((category) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(prefs.categories.includes(category.id)));
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.innerHTML = TICK_SVG; // static SVG constant
    chip.append(tick, document.createTextNode(category.label));
    chip.addEventListener('click', () => void toggleCategory(category.id));
    return chip;
  }));
}

function renderQueue(queue: QueuedStory[], airingId: string | null): void {
  const list = $('queue');
  if (!queue.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Zbieram wiadomości z wybranych tematów...';
    list.replaceChildren(empty);
    return;
  }
  $('queueInfo').textContent = `${queue.length} wiadomości, nowe co godzinę`;
  list.replaceChildren(...queue.map((story) => {
    const item = document.createElement('li');
    if (story.id === airingId) item.className = 'airing';
    else if (engine.programme.aired.has(story.id)) item.className = 'aired';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = categoryLabel(story.category);
    const link = document.createElement('a');
    link.href = story.source_url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = story.title;
    item.append(tag, link);
    if (!story.confirmed) {
      const rumor = document.createElement('span');
      rumor.className = 'rumor';
      rumor.textContent = 'niepotwierdzone';
      item.append(rumor);
    }
    return item;
  }));
}

const upcoming = initUpcoming($('upcoming'));
const bars = $('bars');
const BAR_COUNT = 36;
bars.replaceChildren(...Array.from({ length: BAR_COUNT }, () => document.createElement('span')));

function renderLevel(level: number): void {
  const t = performance.now() / 260;
  Array.from(bars.children).forEach((bar, index) => {
    const wave = 0.55 + 0.45 * Math.sin(t + index * 0.55) * Math.cos(t * 0.7 + index * 0.21);
    (bar as HTMLElement).style.height = `${Math.max(6, Math.min(100, level * wave * 140))}%`;
  });
}

function renderAccess(): void {
  const pill = $('trialPill');
  const authBtn = $<HTMLButtonElement>('authBtn');
  if (access?.registered) {
    pill.hidden = true;
    $('account').textContent = access.email ?? '';
    authBtn.textContent = 'Wyloguj';
  } else {
    $('account').textContent = '';
    authBtn.textContent = 'Zaloguj się';
    // Only show the countdown once listening started and time is left; an expired trial shows the modal instead.
    pill.hidden = !access?.trial_started || !access.allowed;
    const left = Math.max(0, access?.trial_remaining ?? TRIAL_FALLBACK_SECONDS);
    $('trialLeft').textContent = formatTrialLeft(left);
  }
}

// --- engine --------------------------------------------------------------------
const engine = new PublicRadioEngine(stationById(prefs.station), prefs.categories, {
  onState: (state) => {
    playButton.classList.toggle('loading', state === 'loading');
    playButton.innerHTML = state === 'playing' || state === 'loading' ? PAUSE_SVG : PLAY_SVG; // static SVG constants
    playButton.setAttribute('aria-label', state === 'playing' ? 'Pauza' : 'Graj');
    newsButton.disabled = hostModeBtn.dataset.mode === 'music-only';
    if (state === 'loading') setStatus('Łączę z generatorem muzyki...');
  },
  onStatus: (text) => setStatus(text),
  onError: (text) => setStatus(text, true),
  onQueue: (queue, airingId) => renderQueue(queue, airingId),
  onUpcoming: (story) => upcoming.setStory(story),
  onOnAir: (story) => {
    $('onAir').classList.toggle('live', story !== null || false);
    $('onAirText').textContent = story ? 'Na antenie' : (engine.isPlaying ? 'Muzyka' : 'Poza anteną');
    if (story) {
      $('onAirLabel').textContent = `Na antenie · ${categoryLabel(story.category)}`;
      $('storyTitle').textContent = story.title;
      $('storyText').textContent = story.radio_text;
      const src = $<HTMLAnchorElement>('storySrc');
      src.href = story.source_url;
      src.hidden = false;
    }
  },
  onNextBreak: (at) => {
    upcoming.setNextBreak(at);
    const el = $('nextBreak');
    if (el) el.textContent = at ? at.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '—';
  },
  onTrialEnded: () => { void refreshAccess(); openAuth('register', true); },
  onHostState: (speaking, role) => {
    const label = $('onAirLabel');
    if (speaking) {
      label.textContent = role === 'news' ? 'Wiadomości na żywo' : role === 'jingle' ? 'DOS Radio' : 'Prowadzący na żywo';
    } else {
      label.textContent = 'Wiadomości';
    }
  },
  onLevel: renderLevel,
});
engine.interval = prefs.interval;
engine.newsEnabled = prefs.newsEnabled;
engine.setProgramme(programmeOptions(prefs));
engine.setVolume(prefs.volume);
(window as unknown as { dosRadio: PublicRadioEngine }).dosRadio = engine; // debug handle for runtime probes

async function refreshAccess(): Promise<AccessState> {
  access = await radioApi.me();
  renderAccess();
  engine.programme.aired.setRemote(access.registered ? airedRemote : null);
  void engine.programme.aired.pull();
  void refreshPlusPanel(access.plus).catch((error) => setStatus(`Plus: ${(error as Error).message}`, true));
  renderCategories(); // "Moje źródła" appears only for Plus listeners
  return access;
}

function startTrialCountdown(): void {
  if (trialTimer) clearInterval(trialTimer);
  trialTimer = setInterval(() => {
    if (!access || access.registered || !engine.isPlaying) return;
    access.trial_remaining = Math.max(0, access.trial_remaining - 1);
    renderAccess();
    if (access.trial_remaining === 0) {
      engine.stop();
      openAuth('register', true);
    }
  }, 1000);
}

async function togglePlay(): Promise<void> {
  if (engine.isPlaying) { engine.stop(); setStatus('Pauza'); return; }
  if (!isOnboarded(localStorage)) { showOnboarding(); return; }
  await startPlayback();
}

/** First play and "Zmień, co chcesz słyszeć" both land here; "Graj!" saves the answers and starts the radio. */
function showOnboarding(): void {
  openOnboarding(prefs, (choice) => {
    applyChoice(choice);
    markOnboarded(localStorage);
    if (!engine.isPlaying) void startPlayback();
  }, Boolean(access?.plus));
}

function applyChoice(choice: OnboardingChoice): void {
  prefs = applyOnboardingChoice(prefs, choice);
  savePrefs();
  showInterval();
  engine.interval = prefs.interval;
  engine.setNewsEnabled(prefs.newsEnabled);
  engine.setProgramme(programmeOptions(prefs));
  engine.setHostMode(prefs.hostMode);
  renderHostMode(prefs.hostMode);
  renderCategories();
  void engine.setCategories(prefs.categories);
}

async function startPlayback(): Promise<void> {
  if (isPlusAudioPlaying()) stopPlusAudio(); // podcast/digest yields to the radio
  try {
    let state = await refreshAccess();
    if (!state.allowed) { openAuth('register', true); return; }
    if (!state.registered && !state.trial_started) { state = await radioApi.startTrial(); access = state; renderAccess(); }
    startTrialCountdown();
    await engine.start();
    $('onAirText').textContent = 'Muzyka';
  } catch (error) {
    setStatus((error as Error).message, true);
    engine.stop();
  }
}

async function chooseStation(station: Station, shift = false): Promise<void> {
  const next = nextGenreChoice(prefs.station, prefs.blend, station.id, shift);
  prefs.station = next.station;
  prefs.blend = next.blend;
  savePrefs();
  renderStations();
  try { await engine.setStation(station); } catch (error) { setStatus((error as Error).message, true); }
}

async function toggleCategory(id: NewsCategory): Promise<void> {
  const next = prefs.categories.includes(id) ? prefs.categories.filter((c) => c !== id) : [...prefs.categories, id];
  if (!next.length) { setStatus('Zostaw przynajmniej jeden temat wiadomości.', true); return; }
  prefs.categories = sanitizeCategories(next);
  prefs.dayTopic = sanitizeDayTopic(prefs.dayTopic, prefs.categories);
  engine.setProgramme(programmeOptions(prefs));
  savePrefs();
  renderCategories();
  await engine.setCategories(prefs.categories);
}

// --- auth modal ----------------------------------------------------------------
const modal = $('authModal');

function openAuth(mode: 'register' | 'login', trialEnded = false): void {
  authMode = mode;
  $('authTitle').textContent = mode === 'register' ? (trialEnded ? 'Słuchaj dalej za darmo' : 'Załóż darmowe konto') : 'Zaloguj się';
  $('authLead').textContent = mode === 'register'
    ? (trialEnded ? 'Twoja darmowa godzina minęła. Załóż konto i dostań 30 dni Plus za darmo.' : 'Załóż konto i dostań 30 dni Plus za darmo.')
    : 'Wpisz e-mail i hasło, żeby słuchać dalej.';
  $('perks').hidden = mode === 'login';
  $('authSubmit').textContent = mode === 'register' ? 'Załóż konto i dostań 30 dni Plus za darmo' : 'Zaloguj się';
  $<HTMLInputElement>('authPassword').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  $('authSwitch').firstChild!.textContent = mode === 'register' ? 'Masz już konto? ' : 'Nie masz konta? ';
  $('toLogin').textContent = mode === 'register' ? 'Zaloguj się' : 'Załóż konto';
  $('authError').textContent = '';
  $('resendLink').hidden = true;
  $('authForm').hidden = false;
  modal.classList.add('open');
  $<HTMLInputElement>('authEmail').focus();
}

$('toLogin').addEventListener('click', () => openAuth(authMode === 'register' ? 'login' : 'register'));
modal.addEventListener('click', (event) => { if (event.target === modal) modal.classList.remove('open'); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') modal.classList.remove('open'); });

$('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $<HTMLInputElement>('authEmail').value.trim();
  const password = $<HTMLInputElement>('authPassword').value;
  if (password.length < 8) { $('authError').textContent = 'Hasło musi mieć co najmniej 8 znaków.'; return; }
  const submit = $<HTMLButtonElement>('authSubmit');
  submit.disabled = true;
  try {
    if (authMode === 'register') {
      await radioApi.register(email, password);
      // Account created, but access is granted only after e-mail confirmation.
      $('authError').textContent = '';
      $('authLead').textContent = `Sprawdź skrzynkę ${email} (też spam) — wysłaliśmy link potwierdzający. Kliknij go, żeby aktywować konto.`;
      $('authForm').hidden = true;
      $('perks').hidden = true;
      return;
    }
    await radioApi.login(email, password);
    modal.classList.remove('open');
    await refreshAccess();
    setStatus('Gotowe. Słuchasz bez limitu.');
    if (!engine.isPlaying) await togglePlay();
  } catch (error) {
    const message = (error as Error).message;
    $('authError').textContent = message;
    $('resendLink').hidden = !message.includes('potwierdź');
  } finally {
    submit.disabled = false;
  }
});

// Re-send the confirmation e-mail for an unverified account (login form is pre-filled).
$('resendLink').addEventListener('click', async () => {
  const email = $<HTMLInputElement>('authEmail').value.trim();
  const password = $<HTMLInputElement>('authPassword').value;
  const resend = $<HTMLButtonElement>('resendLink');
  resend.disabled = true;
  try {
    await radioApi.resendVerification(email, password);
    $('authError').textContent = 'Nowy link poszedł. Sprawdź skrzynkę.';
    resend.hidden = true;
  } catch (error) {
    $('authError').textContent = (error as Error).message;
    resend.disabled = false;
  }
});

// E-mail confirmation link lands here as /?verify=<token>.
async function handleVerifyLink(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('verify');
  if (!token) return;
  history.replaceState(null, '', window.location.pathname);
  try {
    const result = await radioApi.verify(token);
    await refreshAccess();
    setStatus(`Konto ${result.email} potwierdzone. Słuchasz bez limitu.`);
  } catch (error) {
    setStatus((error as Error).message, true);
  }
}
void handleVerifyLink();

$('authBtn').addEventListener('click', async () => {
  if (access?.registered) {
    await radioApi.logout();
    engine.stop();
    await refreshAccess();
    setStatus('Wylogowano.');
  } else {
    openAuth('login');
  }
});

const intervalSelect = $<HTMLInputElement>('interval');
const intervalValue = $<HTMLOutputElement>('intervalValue');
function showInterval(): void {
  intervalSelect.value = String(prefs.interval);
  intervalValue.textContent = intervalLabel(prefs.interval);
}

// --- wiring ----------------------------------------------------------------------
playButton.addEventListener('click', () => void togglePlay());
newsButton.addEventListener('click', async () => {
  newsButton.disabled = true;
  try {
    setStatus('Odtwarzam wiadomości...');
    await engine.newsNow();
  } catch (error) {
    setStatus((error as Error).message, true);
  } finally {
    newsButton.disabled = false;
  }
});
showInterval();
// Label follows the thumb while dragging; the schedule changes once the listener lets go.
intervalSelect.addEventListener('input', () => { intervalValue.textContent = intervalLabel(normalizeInterval(intervalSelect.value)); });
intervalSelect.addEventListener('change', () => {
  prefs.interval = normalizeInterval(intervalSelect.value);
  savePrefs();
  showInterval();
  engine.setInterval(prefs.interval);
});
const volume = $<HTMLInputElement>('volume');
volume.value = String(prefs.volume);
volume.addEventListener('input', () => { prefs.volume = Number(volume.value); engine.setVolume(prefs.volume); savePrefs(); });

// --- host mode toggle ("Z prowadzącym" / "Tylko muzyka") ------------------------
const hostModeBtn = $<HTMLButtonElement>('hostModeBtn');
const hostModeLabel = $('hostModeLabel');

function renderHostMode(mode: HostMode): void {
  const isMusicOnly = mode === 'music-only';
  hostModeLabel.textContent = isMusicOnly ? 'Tylko muzyka' : 'Z prowadzącym';
  hostModeBtn.classList.toggle('active', isMusicOnly);
  newsButton.hidden = isMusicOnly;
  if (isMusicOnly) {
    $('nextBreak').textContent = 'wyłączone';
  }
}

hostModeBtn.addEventListener('click', () => {
  const nextMode: HostMode = engine.hostMode === 'with-host' ? 'music-only' : 'with-host';
  prefs.hostMode = nextMode;
  savePrefs();
  engine.setHostMode(nextMode);
  renderHostMode(nextMode);
  setStatus(nextMode === 'music-only' ? 'Tryb: tylko muzyka bez przerw na głos' : 'Tryb: z prowadzącym i wiadomościami');
});

initRamowkaSettings({
  prefs: () => prefs,
  changed: () => { savePrefs(); engine.setProgramme(programmeOptions(prefs)); },
});
$('reopenOnboarding').addEventListener('click', showOnboarding);

// --- background audio keep-alive & lock screen controls -------------------------
const bgAudio = initBackgroundAudio(
  () => void togglePlay(),
  () => void engine.newsNow(),
);

// --- DOS Radio Plus ("Twoje źródła" + duet podcast) -------------------------------
initPlus({
  onStatus: (text, isError) => setStatus(text, isError),
  stopRadio: () => { if (engine.isPlaying) engine.stop(); },
  enqueuePill: async (pill) => {
    if (!engine.enqueuePill(pill)) { setStatus('Ta pigułka jest już w programie.'); return; }
    setStatus(`W programie: ${pill.title}. Wejdzie w najbliższej przerwie, po wiadomościach.`);
    if (!engine.isPlaying) await togglePlay(); // a pill never replaces the radio, it joins it
    if (engine.hostMode === 'music-only') setStatus('Pigułka czeka w programie: włącz prowadzącego, żeby ją usłyszeć.');
  },
});
initProgrammeLine($('inProgramme'), engine.pillQueue);

// --- mood composer ---------------------------------------------------------------
const moodForm = $<HTMLFormElement>('moodForm');
const moodInput = $<HTMLInputElement>('moodInput');
const moodSubmit = $<HTMLButtonElement>('moodSubmit');

async function handleMoodSubmit(description: string): Promise<void> {
  const clean = description.trim();
  if (!clean) return;
  moodSubmit.disabled = true;
  setStatus(`Komponuję muzykę pod nastrój: "${clean}"...`);
  try {
    const custom = await radioApi.mood(clean);
    $('nowStation').textContent = custom.name;
    $('nowTagline').textContent = custom.tagline;
    await engine.setStation(custom);
    bgAudio.updateMetadata(custom.name, 'DOS Radio', 'Twój nastrój');
    setStatus(`Gra nastrój: ${custom.name} · ${custom.tagline}`);
    if (!engine.isPlaying) await togglePlay();
  } catch (err) {
    setStatus((err as Error).message, true);
  } finally {
    moodSubmit.disabled = false;
  }
}

moodForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void handleMoodSubmit(moodInput.value);
});

document.querySelectorAll('.mood-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mood = (btn as HTMLElement).dataset.mood || btn.textContent || '';
    moodInput.value = mood;
    void handleMoodSubmit(mood);
  });
});

const tickClock = () => { $('clock').textContent = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); };
tickClock();
setInterval(tickClock, 5000);
renderStations();
renderCategories();
engine.setHostMode(prefs.hostMode);
renderHostMode(prefs.hostMode);
const initialStation = stationById(prefs.station);
bgAudio.updateMetadata(initialStation.name, 'DOS Radio', initialStation.host);

// Register PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

refreshAccess().catch((error) => setStatus(`Serwer radia niedostępny: ${(error as Error).message}`, true));
