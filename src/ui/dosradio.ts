/** AmbiRadio Classic page: entry split, stations, news topics, start wizard, 6 h trial, registration. */
import { changeVersionLink, initEntry } from './entrySplit';
import { PublicRadioEngine, type HostMode } from '../radio/publicRadioEngine';
import { airedRemote, radioApi, type AccessState } from '../radio/radioApi';
import { availableCategories, categoryLabel, sanitizeCategories, type NewsCategory, type QueuedStory } from '../radio/newsQueue';
import {
  applyCatalog,
  computeAutoRamowkaSlot,
  getActiveGroups,
  getActiveStations,
  groupById,
  stationsForGroup,
  stationById,
  type MusicGroupId,
  type Station,
} from '../radio/stations';
import { intervalLabel, normalizeInterval } from '../radio/radioClock';
import { initBackgroundAudio } from '../audio/backgroundAudio';
import { getSharedAudioContext } from '../audio/iosAudioUnlock';
import {
  applyOnboardingChoice,
  isOnboarded,
  loadPrefs,
  markOnboarded,
  nextGenreChoice,
  programmeOptions,
  resolveInitialView,
  sanitizeDayTopic,
  savePrefs as persistPrefs,
  saveViewPref,
  type OnboardingChoice,
  type ViewMode,
} from './prefs';
import { initUpcoming } from './upcoming';
import { initRamowkaSettings } from './ramowkaSettings';
import { openOnboarding, type WizardChoice } from './onboarding';
import { mergeFeeds, savePendingPlus, takePendingPlus } from './wizardContent';
import { REGISTER_PROMPT_AT_S, TRIAL_SECONDS, formatTrialCalm, shouldPromptRegister, showRegisterPrompt } from './trialNotice';
import { initPlus, refreshPlusPanel, isPlusAudioPlaying, stopPlusAudio } from './plus';
import { initProgrammeLine } from './pill';
import { wireClassicDedications } from './dedicationModal';
import { wireClassicComments } from './commentBox';
import { wireClassicSocialStudio } from './socialCreatorStudio';
import { classicShortcut, stepStation } from './keyboard';
import { startPlaybackFlow } from './playbackGate';
import { initShuffle } from './shuffle';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`); // autocheck spot: page and script must match
  return element as T;
};

// First visit: Classic | Orbita split; a saved Orbita choice leaves for /orbita.html right away.
const leavingForOrbita = initEntry(localStorage, window.location.search, (version) => {
  if (version === 'classic') saveViewPref(localStorage, 'classic'); // no embedded Orbita on the next load
});

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

function updateNowPlayingHeader(): void {
  const current = stationById(prefs.station);
  const blended = prefs.blend ? stationById(prefs.blend) : null;
  const activePlayGroup = prefs.playGroup ? groupById(prefs.playGroup) : null;
  if (activePlayGroup) {
    $('nowStation').textContent = `Grupa: ${activePlayGroup.name} · ${current.name}`;
    $('nowTagline').textContent = `${activePlayGroup.tagline} · ${current.host ? `prowadzi: ${current.host}` : current.tagline}`;
  } else {
    $('nowStation').textContent = blended ? `${current.name} + ${blended.name}` : current.name;
    $('nowTagline').textContent = current.host ? `${current.tagline} (prowadzi: ${current.host})` : current.tagline;
  }
  $('onairStation').textContent = blended ? `${current.name} + ${blended.name}` : current.name;
  $('onairHost').textContent = current.host || 'AmbiRadio';
}

function renderGroupFilters(): void {
  const bar = document.getElementById('groupFilterBar');
  if (!bar) return;
  const groups = getActiveGroups();
  const totalCount = getActiveStations().filter((s) => s.enabled !== false).length;

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  const allSelected = !prefs.activeGroup;
  allBtn.className = `group-filter-pill${allSelected ? ' active' : ''}`;
  allBtn.setAttribute('role', 'tab');
  allBtn.setAttribute('aria-selected', String(allSelected));
  const allLabel = document.createElement('span');
  allLabel.textContent = 'Wszystkie';
  const allCount = document.createElement('span');
  allCount.className = 'group-count';
  allCount.textContent = `(${totalCount})`;
  allBtn.append(allLabel, allCount);
  allBtn.addEventListener('click', () => {
    prefs.activeGroup = null;
    savePrefs();
    renderGroupFilters();
    renderStations();
  });

  const groupBtns = groups.map((group) => {
    const stationsInGroup = stationsForGroup(group.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = prefs.activeGroup === group.id;
    btn.className = `group-filter-pill${isSelected ? ' active' : ''}`;
    btn.style.setProperty('--group-color', group.color);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(isSelected));
    btn.dataset.group = group.id;
    const dot = document.createElement('span');
    dot.className = 'group-dot';
    const label = document.createElement('span');
    label.textContent = group.name;
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = `(${stationsInGroup.length})`;
    btn.append(dot, label, count);
    btn.addEventListener('click', () => {
      prefs.activeGroup = prefs.activeGroup === group.id ? null : group.id;
      savePrefs();
      renderGroupFilters();
      renderStations();
    });
    return btn;
  });

  bar.replaceChildren(allBtn, ...groupBtns);
}

function renderStations(): void {
  renderGroupFilters();
  const container = $('stations');
  container.classList.add('grouped-stations');
  const groups = getActiveGroups().filter((g) => !prefs.activeGroup || g.id === prefs.activeGroup);

  const cards = groups.map((group) => {
    const groupStations = stationsForGroup(group.id);
    const card = document.createElement('div');
    const isPlayingGroup = prefs.playGroup === group.id;
    card.className = `music-group-card${isPlayingGroup ? ' is-playing-group' : ''}`;
    card.dataset.groupId = group.id;
    card.style.setProperty('--group-color', group.color);

    const head = document.createElement('div');
    head.className = 'music-group-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'music-group-title';
    const h3 = document.createElement('h3');
    const dot = document.createElement('span');
    dot.className = 'group-dot';
    const nameNode = document.createElement('span');
    nameNode.textContent = `${group.name} (${groupStations.length})`;
    h3.append(dot, nameNode);

    const tagline = document.createElement('span');
    tagline.className = 'music-group-tagline';
    tagline.textContent = group.tagline;
    titleWrap.append(h3, tagline);

    const playGroupBtn = document.createElement('button');
    playGroupBtn.type = 'button';
    playGroupBtn.className = 'group-play-btn';
    playGroupBtn.dataset.playGroup = group.id;
    playGroupBtn.setAttribute('aria-pressed', String(isPlayingGroup));
    playGroupBtn.innerHTML = `${isPlayingGroup && engine.isPlaying ? PAUSE_SVG : PLAY_SVG}<span>${isPlayingGroup ? 'Gra cała grupa' : 'Graj grupę'}</span>`;
    playGroupBtn.addEventListener('click', () => void chooseGroup(group.id));

    head.append(titleWrap, playGroupBtn);

    const grid = document.createElement('div');
    grid.className = 'music-group-grid';
    grid.append(
      ...groupStations.map((station) => {
        const button = document.createElement('button');
        button.type = 'button';
        const isBlend = station.id === prefs.blend;
        button.className = `station${station.id === prefs.station ? ' active' : ''}${isBlend ? ' blend' : ''}`;
        button.dataset.id = station.id;
        button.title = station.tagline;
        const name = document.createElement('b');
        name.textContent = station.name;
        const bpm = document.createElement('em');
        bpm.textContent = `${station.bpm}`;
        button.append(name, bpm);
        button.addEventListener('click', (ev) => void chooseStation(station, ev.shiftKey));
        return button;
      }),
    );

    card.append(head, grid);
    return card;
  });

  container.replaceChildren(...cards);
  updateNowPlayingHeader();
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
    // Calm indicator (minutes only) once listening started; an expired trial shows the modal instead.
    pill.hidden = !access?.trial_started || !access.allowed;
    const left = Math.max(0, access?.trial_remaining ?? TRIAL_SECONDS);
    const text = formatTrialCalm(left);
    if ($('trialLeft').textContent !== text) $('trialLeft').textContent = text;
    pill.classList.toggle('ending', left <= REGISTER_PROMPT_AT_S);
    if (shouldPromptRegister(access, localStorage)) showRegisterPrompt(localStorage, () => openAuth('register'));
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
    if (state === 'playing') setTimeout(sendPresenceHeartbeat, 0); // count the listener now, not a minute later
    if (state === 'idle' || state === 'paused') hideStartNotice();
  },
  onStatus: (text) => setStatus(text),
  onMusicAudible: () => hideStartNotice(),
  onError: (text) => setStatus(text, true),
  onQueue: (queue, airingId) => renderQueue(queue, airingId),
  onUpcoming: (story) => upcoming.setStory(story),
  onOnAir: (story) => {
    const isLive = story !== null;
    $('onAir').classList.toggle('live', isLive);
    if (story) {
      const isWeather = story.id === 'weather';
      $('onAirLabel').textContent = isWeather ? 'Na antenie · Pogoda' : `Na antenie · ${categoryLabel(story.category)}`;
      $('onAirText').textContent = 'Wiadomości na żywo';
      $('storyTitle').textContent = story.headline || story.title;
      $('storyText').textContent = story.radio_text;
      const src = $<HTMLAnchorElement>('storySrc');
      if (story.source_url) {
        src.href = story.source_url;
        src.hidden = false;
      } else {
        src.hidden = true;
      }
    } else {
      $('storySrc').hidden = true;
      if (!engine.isPlaying) {
        $('onAirText').textContent = 'Poza anteną';
      }
    }
  },
  onNextBreak: (at) => {
    upcoming.setNextBreak(at);
    const time = at ? at.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '—';
    for (const id of ['nextBreak', 'onairNext']) { const el = $(id); if (el) el.textContent = time; }
  },
  onTrialEnded: () => { void refreshAccess(); openAuth('register', true); },
  onHostState: (speaking, role) => {
    const label = $('onAirLabel');
    const airText = $('onAirText');
    const isMusicOnly = hostModeBtn.dataset.mode === 'music-only';
    if (speaking) {
      label.textContent = role === 'news' ? 'Wiadomości na żywo' : role === 'jingle' ? 'AmbiRadio' : 'Prowadzący na żywo';
      airText.textContent = role === 'news' ? 'Wiadomości na żywo' : role === 'jingle' ? 'AmbiRadio' : 'Prowadzący na żywo';
    } else {
      label.textContent = 'Wiadomości';
      airText.textContent = isMusicOnly ? 'Tylko muzyka' : (engine.isPlaying ? 'Muzyka' : 'Poza anteną');
    }
  },
  onLevel: renderLevel,
  onStationChange: (st, groupId) => {
    prefs.station = st.id;
    prefs.playGroup = groupId;
    savePrefs();
    renderStations();
    bgAudio.updateMetadata(st.name, groupId ? `AmbiRadio · ${groupById(groupId)?.name ?? ''}` : 'AmbiRadio', st.host);
  },
});
engine.interval = prefs.interval;
engine.newsEnabled = prefs.newsEnabled;
engine.setProgramme(programmeOptions(prefs));
engine.setVolume(prefs.volume);
if (prefs.playGroup) {
  void engine.setGroup(prefs.playGroup, stationById(prefs.station));
}
(window as unknown as { dosRadio: PublicRadioEngine }).dosRadio = engine; // debug handle for runtime probes

async function refreshAccess(): Promise<AccessState> {
  access = await radioApi.me();
  renderAccess();
  engine.programme.aired.setRemote(access.registered ? airedRemote : null);
  void engine.programme.aired.pull();
  void refreshPlusPanel(access.plus).catch((error) => setStatus(`Plus: ${(error as Error).message}`, true));
  renderCategories(); // "Moje źródła" appears only for Plus listeners
  if (access.plus) void flushWizardPlusSetup();
  return access;
}

/**
 * Podcasts picked in the start wizard need the Plus API, which opens only once the trial runs.
 * Example feeds join "Moje źródła"; a pasted link becomes a podcast in "Moje podcasty".
 */
async function flushWizardPlusSetup(): Promise<void> {
  const pending = takePendingPlus(localStorage);
  if (!pending) return;
  try {
    if (pending.feeds.length) {
      const current = await radioApi.newsPreferences();
      await radioApi.saveNewsPreferences(current.keywords, mergeFeeds(current.rss_feeds, pending.feeds));
      if (!prefs.categories.includes('mine')) { prefs.categories = [...prefs.categories, 'mine']; savePrefs(); renderCategories(); void engine.setCategories(prefs.categories); }
    }
    if (pending.link) {
      setStatus('Przygotowuję podcast z Twojego linku. Znajdziesz go w „Moje podcasty”.');
      await radioApi.podcast(undefined, pending.link);
      setStatus('Podcast z Twojego linku jest gotowy w „Moje podcasty”.');
    }
    await refreshPlusPanel(true);
  } catch (error) {
    setStatus(`Kreator: ${(error as Error).message}`, true);
  }
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
  if (engine.isPlaying) { engine.stop(); hideStartNotice(); setStatus('Pauza'); return; }
  // iOS: resume synchronously inside the click; every await below would consume the gesture.
  const ctx = getSharedAudioContext();
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  // First play never waits for the wizard: the radio starts with default prefs and the
  // wizard opens alongside; its answers are applied to the running radio.
  if (!isOnboarded(localStorage)) {
    markOnboarded(localStorage);
    showOnboarding();
  }
  await startPlayback();
}

/** First play opens the wizard alongside the already-starting radio; "Zmień, co chcesz słyszeć" reopens it. Answers apply live, and "Graj" only starts playback if it hasn't started yet. */
function showOnboarding(): void {
  openOnboarding(prefs, (choice: WizardChoice) => {
    const stationBefore = prefs.station;
    savePendingPlus(localStorage, { feeds: choice.podcastFeeds, link: choice.podcastLink });
    applyChoice(choice);
    if (prefs.station !== stationBefore) { void engine.setStation(stationById(prefs.station)); renderStations(); }
    markOnboarded(localStorage);
    if (!engine.isPlaying) void startPlayback();
    else if (access?.plus) void flushWizardPlusSetup();
  }, Boolean(access?.plus));
}

const START_NOTICE_TEXT = 'Muzyka ruszy za kilka sekund — generuję pierwsze nuty. Prowadzący może już mówić.';
function showStartNotice(): void {
  const el = document.getElementById('startNotice');
  if (!el) return;
  el.querySelector('span')!.textContent = START_NOTICE_TEXT;
  el.hidden = false;
}
function hideStartNotice(): void {
  const el = document.getElementById('startNotice');
  if (el) el.hidden = true;
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
  if (!engine.isPlaying) showStartNotice();
  try {
    const outcome = await startPlaybackFlow({
      refreshAccess,
      startTrial: () => radioApi.startTrial(),
      setAccess: (state) => { access = state; renderAccess(); },
      hasPendingDedication: () => engine.hasPendingDedication,
      onceGreetingDone: (cb) => engine.onceGreetingDone(cb),
      engineStart: () => engine.start(),
      engineStop: () => { engine.stop(); hideStartNotice(); },
      openRegisterPrompt: () => openAuth('register', true),
      startTrialCountdown,
    });
    if (outcome === 'register') { hideStartNotice(); return; }
    if (engine.isPlaying) $('onAirText').textContent = 'Muzyka';
  } catch (error) {
    hideStartNotice();
    setStatus((error as Error).message, true);
    engine.stop();
  }
}

async function chooseStation(station: Station, shift = false): Promise<void> {
  const next = nextGenreChoice(prefs.station, prefs.blend, station.id, shift);
  prefs.station = next.station;
  prefs.blend = next.blend;
  prefs.playGroup = null;
  savePrefs();
  renderStations();
  bgAudio.updateMetadata(station.name, 'AmbiRadio', station.host);
  try { await engine.setStation(station); } catch (error) { setStatus((error as Error).message, true); }
}

async function chooseGroup(groupId: MusicGroupId): Promise<void> {
  if (prefs.playGroup === groupId) {
    prefs.playGroup = null;
    savePrefs();
    renderStations();
    await engine.setGroup(null, stationById(prefs.station));
    return;
  }
  const groupStations = stationsForGroup(groupId);
  const targetStation = groupStations.find((s) => s.id === prefs.station) ?? groupStations[0] ?? stationById(prefs.station);
  prefs.playGroup = groupId;
  prefs.station = targetStation.id;
  prefs.blend = null;
  savePrefs();
  renderStations();
  bgAudio.updateMetadata(targetStation.name, `AmbiRadio · ${groupById(groupId)?.name ?? ''}`, targetStation.host);
  try {
    await engine.setGroup(groupId, targetStation);
    if (!engine.isPlaying) await togglePlay();
  } catch (error) {
    setStatus((error as Error).message, true);
  }
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
  $('authTitle').textContent = mode === 'register' ? (trialEnded ? 'Słuchaj AmbiRadio dalej za darmo' : 'Załóż darmowe konto AmbiRadio') : 'Zaloguj się';
  $('authLead').textContent = mode === 'register'
    ? (trialEnded ? 'Twoje 6 godzin pełnego dostępu minęło. Załóż konto i dostań 30 dni Plus za darmo.' : 'Załóż konto, zachowaj swoje ustawienia i dostań 30 dni Plus za darmo.')
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
    $('onairNext').textContent = 'wyłączone';
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

// --- AmbiRadio Plus ("Twoje źródła" + duet podcast) -------------------------------
initPlus({
  onStatus: (text, isError) => setStatus(text, isError),
  stopRadio: () => { if (engine.isPlaying) engine.stop(); },
  setVoiceBed: async (active, keepLock = active) => {
    engine.setExternalVoiceBed(active, keepLock);
    if (active && !engine.isPlaying) {
      await togglePlay();
      engine.setExternalVoiceBed(active, keepLock);
    }
  },
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
    $('onairStation').textContent = custom.name;
    await engine.setStation(custom);
    bgAudio.updateMetadata(custom.name, 'AmbiRadio', 'Twój nastrój');
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

// --- Auto-Ramówka 24/7 -----------------------------------------------------------
const autoRamowkaBtn = $<HTMLButtonElement>('autoRamowkaBtn');
const autoRamowkaBar = $('autoRamowkaBar');
const ramowkaSlotText = $('ramowkaSlotText');
const ramowkaSpotText = $('ramowkaSpotText');
const ramowkaCtaLink = $<HTMLAnchorElement>('ramowkaCtaLink');

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('ramowka') === '1') {
  prefs.autoRamowka = true;
  savePrefs();
}

function renderAutoRamowkaUi(slotLabel: string, hours: string, host: string, spotTitle: string, ctaLabel: string, ctaUrl: string): void {
  const active = Boolean(prefs.autoRamowka);
  autoRamowkaBtn.setAttribute('aria-pressed', String(active));
  autoRamowkaBtn.classList.toggle('active', active);
  autoRamowkaBar.hidden = !active;
  ramowkaSlotText.textContent = `AUTO-RAMÓWKA 24/7 · ${slotLabel} (${hours}) · Prowadzi ${host}`;
  ramowkaSpotText.textContent = spotTitle;
  ramowkaCtaLink.querySelector('span')!.textContent = ctaLabel;
  ramowkaCtaLink.href = ctaUrl;
}

async function syncRamowkaState(): Promise<void> {
  const fallback = computeAutoRamowkaSlot(new Date());
  if (!prefs.autoRamowka) {
    renderAutoRamowkaUi(fallback.label, fallback.hours, fallback.host, fallback.spotTitle, fallback.ctaLabel, fallback.ctaUrl);
    engine.setAutoRamowka(false);
    return;
  }
  const remote = await radioApi.ramowkaState();
  const groupId = (remote?.slot?.groupId ?? remote?.slot?.group ?? fallback.groupId) as MusicGroupId;
  const stationId = remote?.slot?.stationId ?? remote?.slot?.station ?? fallback.stationId;
  const label = remote?.slot?.label ?? fallback.label;
  const hours = remote?.slot?.hours ?? fallback.hours;
  const targetStation = stationById(stationId);
  const host = remote?.slot?.host ?? targetStation.host ?? fallback.host;
  const spotId = remote?.spot?.id ?? fallback.spotId;
  const spotTitle = remote?.spot?.title ?? fallback.spotTitle;
  const ctaLabel = remote?.spot?.cta_label ?? fallback.ctaLabel;
  const ctaUrl = remote?.spot?.cta_url ?? fallback.ctaUrl;

  renderAutoRamowkaUi(label, hours, host, spotTitle, ctaLabel, ctaUrl);
  prefs.interval = 20;
  showInterval();
  engine.setAutoRamowka(true, spotId);

  if (prefs.playGroup !== groupId || prefs.station !== targetStation.id) {
    prefs.playGroup = groupId;
    prefs.station = targetStation.id;
    savePrefs();
    renderStations();
    await engine.setGroup(groupId, targetStation);
  }
}

autoRamowkaBtn.addEventListener('click', () => {
  prefs.autoRamowka = !prefs.autoRamowka;
  if (prefs.autoRamowka) {
    prefs.interval = 20;
  } else {
    prefs.playGroup = null;
    void engine.setGroup(null, stationById(prefs.station));
  }
  savePrefs();
  void syncRamowkaState();
  setStatus(
    prefs.autoRamowka
      ? 'Włączono Auto-Ramówkę 24/7 — stacja i prowadzący dopasowani do pory dnia, serwis co 20 minut.'
      : 'Wyłączono Auto-Ramówkę 24/7 — ręczny wybór stacji.',
  );
});

// --- View Switcher (Klasyczny <-> Orbita 3D) ------------------------------------
const viewClassicBtn = $<HTMLButtonElement>('viewClassicBtn');
const viewOrbitaBtn = $<HTMLButtonElement>('viewOrbitaBtn');
const orbitaShell = $('orbitaShell');
const orbitaFrame = $<HTMLIFrameElement>('orbitaFrame');
let currentView: ViewMode = resolveInitialView(localStorage, window.location.search);
let orbitaLoaded = false;

function renderViewButtons(view: ViewMode): void {
  const isOrbita = view === 'orbita';
  viewClassicBtn.classList.toggle('active', !isOrbita);
  viewClassicBtn.setAttribute('aria-pressed', String(!isOrbita));
  viewOrbitaBtn.classList.toggle('active', isOrbita);
  viewOrbitaBtn.setAttribute('aria-pressed', String(isOrbita));
}

function switchView(view: ViewMode): void {
  currentView = view;
  saveViewPref(localStorage, view);
  renderViewButtons(view);

  if (view === 'orbita') {
    const wasPlaying = engine.isPlaying;
    orbitaShell.hidden = false;
    if (!orbitaLoaded) {
      orbitaLoaded = true;
      const fwd = new URLSearchParams(window.location.search);
      fwd.set('embed', '1');
      orbitaFrame.src = `/orbita.html?${fwd.toString()}`;
      orbitaFrame.addEventListener(
        'load',
        () => {
          orbitaFrame.contentWindow?.postMessage(
            {
              type: 'dosradio:activate-orbita',
              wasPlaying,
              station: prefs.station,
              playGroup: prefs.playGroup ?? null,
              autoRamowka: Boolean(prefs.autoRamowka),
            },
            '*',
          );
          if (wasPlaying) engine.stop();
        },
        { once: true },
      );
    } else {
      orbitaFrame.contentWindow?.postMessage(
        {
          type: 'dosradio:activate-orbita',
          wasPlaying,
          station: prefs.station,
          playGroup: prefs.playGroup ?? null,
          autoRamowka: Boolean(prefs.autoRamowka),
        },
        '*',
      );
      if (wasPlaying) engine.stop();
    }
  } else {
    orbitaShell.hidden = true;
    orbitaFrame.contentWindow?.postMessage({ type: 'dosradio:suspend-orbita' }, '*');
    prefs = loadPrefs(localStorage);
    renderStations();
    renderCategories();
    showInterval();
    void syncRamowkaState();
  }
}

viewClassicBtn.addEventListener('click', () => switchView('classic'));
viewOrbitaBtn.addEventListener('click', () => switchView('orbita'));

// --- Keyboard: Space = play/pause, ArrowLeft/ArrowRight = previous/next station ----
const DIALOG_SELECTOR = '.modal.open, #dos-dedicate-overlay, .drplus-overlay, #dos-soc-overlay.open';
document.addEventListener('keydown', (event) => {
  const blocked = currentView !== 'classic' || Boolean(document.querySelector(DIALOG_SELECTOR));
  const action = classicShortcut(event, blocked);
  if (!action) return;
  event.preventDefault();
  if (action === 'toggle') { void togglePlay(); return; }
  const visibleIds = Array.from(document.querySelectorAll<HTMLElement>('#stations .station')).map((b) => b.dataset.id ?? '');
  const nextId = stepStation(visibleIds, prefs.station, action === 'next' ? 1 : -1);
  if (!nextId) return;
  const station = stationById(nextId);
  setStatus(`Stacja: ${station.name}`);
  void chooseStation(station);
});

window.addEventListener('message', (ev) => {
  const data = ev.data as {
    type?: string;
    view?: ViewMode;
    wasPlaying?: boolean;
    station?: string;
    playGroup?: MusicGroupId | null;
    autoRamowka?: boolean;
  } | null;
  if (!data || typeof data.type !== 'string') return;
  if (data.type === 'dosradio:orbita-audio-started') {
    if (engine.isPlaying) engine.stop();
  } else if (data.type === 'dosradio:switch-view') {
    const targetView: ViewMode = data.view === 'orbita' ? 'orbita' : 'classic';
    prefs = loadPrefs(localStorage);
    if (typeof data.station === 'string') prefs.station = stationById(data.station).id;
    if (data.playGroup !== undefined) prefs.playGroup = data.playGroup;
    if (typeof data.autoRamowka === 'boolean') prefs.autoRamowka = data.autoRamowka;
    savePrefs();
    switchView(targetView);
    if (targetView === 'classic') {
      if (prefs.playGroup) {
        void engine.setGroup(prefs.playGroup, stationById(prefs.station));
      } else {
        void engine.setStation(stationById(prefs.station));
      }
      if (data.wasPlaying && !engine.isPlaying) {
        void startPlayback();
      }
    }
  }
});

// --- Dynamic Catalog Sync & Presence Heartbeat ----------------------------------
async function syncCatalogFromServer(): Promise<void> {
  const payload = await radioApi.catalog();
  if (payload) {
    applyCatalog(payload);
    renderStations();
  }
}

const CLIENT_ID_KEY = 'dosradio.client_id.v1';
function getClientId(): string {
  try {
    let cid = localStorage.getItem(CLIENT_ID_KEY);
    if (!cid) {
      cid = `cli-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      localStorage.setItem(CLIENT_ID_KEY, cid);
    }
    return cid;
  } catch {
    return 'cli-anon';
  }
}

function sendPresenceHeartbeat(): void {
  // Hidden tabs do not count as listening rooms; visibilitychange sends one beat on return.
  if (!engine.isPlaying || currentView !== 'classic' || document.hidden) return;
  void radioApi.presence({
    client_id: getClientId(),
    station_id: prefs.station,
    group_id: prefs.playGroup ?? null,
    view_mode: 'classic',
    ramowka: Boolean(prefs.autoRamowka),
  });
}

setInterval(() => {
  sendPresenceHeartbeat();
  if (prefs.autoRamowka && currentView === 'classic') {
    void syncRamowkaState();
  }
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sendPresenceHeartbeat();
});

document.querySelector('footer')?.append(changeVersionLink());

renderStations();
renderCategories();
engine.setHostMode(prefs.hostMode);
renderHostMode(prefs.hostMode);
const initialStation = stationById(prefs.station);
bgAudio.updateMetadata(initialStation.name, 'AmbiRadio', initialStation.host);
wireClassicDedications(
  engine,
  (sid) => {
    const st = stationById(sid);
    prefs.station = st.id;
    prefs.playGroup = null;
    savePrefs();
    engine.setStation(st);
    renderStations();
  },
  setStatus,
);
wireClassicComments(engine, setStatus);
initShuffle({ currentStationId: () => prefs.station, isPlaying: () => engine.isPlaying, chooseStation, togglePlay });
wireClassicSocialStudio(
  engine,
  (sid) => {
    const st = stationById(sid);
    prefs.station = st.id;
    prefs.playGroup = null;
    savePrefs();
    engine.setStation(st);
    renderStations();
  },
  setStatus,
);
void syncCatalogFromServer();
void syncRamowkaState();
if (currentView === 'orbita') {
  switchView('orbita');
}

// Register PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

if (!leavingForOrbita) refreshAccess().catch((error) => setStatus(`Serwer radia niedostępny: ${(error as Error).message}`, true));
