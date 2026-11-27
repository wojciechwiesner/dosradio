/** "Losuj stację": slot-machine reel, haptics, shake-to-shuffle. Logic is in shuffleLogic.ts; station switching is injected. */
import { getActiveStations, groupById, stationById, type Station } from '../radio/stations';
import { ShakeDetector, parseRecent, pickShuffleStation, pushRecent } from './shuffleLogic';

const RECENT_KEY = 'ambi.shuffle.recent';
const SHAKE_KEY = 'ambi.shuffle.shake';
const HINT_KEY = 'ambi.shuffle.hint';
const REEL_MS = 1400;
const REEL_EASING = 'cubic-bezier(.22,1,.36,1)';
const REEL_ROWS = 22;
const REEL_ROW_PX = 56;
const TOAST_MS = 2500;
const TICK_VIBRATE_MS = 8;
const LAND_VIBRATE_MS = 60;
const SHAKE_HINT = 'Następnym razem po prostu potrząśnij telefonem';

export interface ShuffleHooks {
  currentStationId: () => string;
  isPlaying: () => boolean;
  /** The exact path of a station-list click (prefs, save, renderStations, engine.setStation). */
  chooseStation: (station: Station) => Promise<void>;
  /** The play button's function; the tap is the user gesture that lets audio start. */
  togglePlay: () => Promise<void>;
}

type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

const isTouch = (): boolean => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const vibrate = (pattern: number | number[]): void => { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } };

function shakeEnabled(): boolean {
  const stored = localStorage.getItem(SHAKE_KEY);
  return stored === null ? isTouch() : stored === '1';
}

/** Names for the reel: random enabled stations, ending on the target. */
function reelNames(target: Station, pool: readonly Station[]): string[] {
  const names = Array.from({ length: REEL_ROWS - 1 }, () => pool[Math.floor(Math.random() * pool.length)].name);
  return [...names, target.name];
}

function buildCard(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'shuffle-card';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.hidden = true;
  document.body.append(card);
  return card;
}

export function initShuffle(hooks: ShuffleHooks): void {
  const button = document.getElementById('shuffleBtn');
  if (!(button instanceof HTMLButtonElement)) return; // autocheck: markup missing, feature stays off
  const card = buildCard();
  let busy = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let motionListening = false;
  const detector = new ShakeDetector();

  const showLanded = (station: Station, hint: string | null): void => {
    const group = groupById(station.group);
    card.classList.remove('is-reel');
    card.style.setProperty('--shuffle-color', group?.color ?? 'var(--accent)');
    const name = document.createElement('b');
    name.textContent = station.name;
    const tagline = document.createElement('span');
    tagline.textContent = station.tagline;
    card.replaceChildren(name, tagline);
    if (hint) {
      const note = document.createElement('em');
      note.textContent = hint;
      card.append(note);
    }
    card.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { card.hidden = true; }, TOAST_MS);
  };

  const playReel = (target: Station, pool: readonly Station[]): Promise<void> => new Promise((resolve) => {
    const strip = document.createElement('div');
    strip.className = 'shuffle-strip';
    for (const text of reelNames(target, pool)) {
      const row = document.createElement('div');
      row.textContent = text;
      strip.append(row);
    }
    const window_ = document.createElement('div');
    window_.className = 'shuffle-window';
    window_.append(strip);
    card.classList.add('is-reel');
    card.replaceChildren(window_);
    card.hidden = false;
    clearTimeout(hideTimer);
    void strip.offsetHeight; // commit the start position before the transition
    strip.style.transition = `transform ${REEL_MS}ms ${REEL_EASING}`;
    strip.style.transform = `translateY(-${(REEL_ROWS - 1) * REEL_ROW_PX}px)`;
    // ticks slow down with the reel
    let elapsed = 0;
    let gap = 50;
    const tick = (): void => {
      vibrate(TICK_VIBRATE_MS);
      elapsed += gap;
      gap = Math.round(gap * 1.25);
      if (elapsed < REEL_MS - gap) setTimeout(tick, gap);
    };
    tick();
    setTimeout(resolve, REEL_MS);
  });

  const shuffle = async (viaGesture: boolean, hint: string | null): Promise<void> => {
    if (busy) return;
    const pool = getActiveStations().filter((s) => s.enabled !== false);
    const recent = parseRecent(localStorage.getItem(RECENT_KEY));
    const target = pickShuffleStation(pool, hooks.currentStationId(), recent);
    if (!target) return;
    busy = true;
    button.disabled = true;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(recent, target.id)));
      const wasPlaying = hooks.isPlaying();
      if (viaGesture && !wasPlaying) void hooks.togglePlay(); // sync inside the tap so iOS audio unlock works
      if (!reducedMotion()) await playReel(target, pool);
      vibrate(LAND_VIBRATE_MS);
      await hooks.chooseStation(stationById(target.id));
      showLanded(target, hint);
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  const onMotion = (event: DeviceMotionEvent): void => {
    const g = event.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null || g.z == null || !shakeEnabled()) return;
    if (detector.feed(g.x, g.y, g.z, performance.now())) void shuffle(false, null);
  };

  const startMotion = (): void => {
    if (motionListening || typeof DeviceMotionEvent === 'undefined') return;
    motionListening = true;
    window.addEventListener('devicemotion', onMotion);
  };

  /** Must run synchronously inside the tap. Resolves to true when shake can be used. */
  const askMotionPermission = (): Promise<boolean> => {
    if (typeof DeviceMotionEvent === 'undefined') return Promise.resolve(false);
    const request = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
    if (typeof request !== 'function') return Promise.resolve(true); // Android / desktop: no prompt needed
    return request.call(DeviceMotionEvent).then((r) => r === 'granted').catch(() => false);
  };

  button.addEventListener('click', () => {
    const hintShown = localStorage.getItem(HINT_KEY) === '1';
    const permission = shakeEnabled() && isTouch() ? askMotionPermission() : Promise.resolve(false);
    void permission.then((granted) => {
      if (granted) startMotion();
      let hint: string | null = null;
      if (granted && !hintShown) {
        hint = SHAKE_HINT;
        localStorage.setItem(HINT_KEY, '1');
      }
      return shuffle(true, hint);
    });
  });

  // Android and desktop need no permission: listen right away. iOS waits for the first tap.
  const request = typeof DeviceMotionEvent === 'undefined' ? null : (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
  if (typeof request !== 'function' && isTouch()) startMotion();
}
