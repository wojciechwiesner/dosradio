/**
 * AmbiRadio entry: on the first visit (no saved choice) the root page shows a full-viewport
 * split, Classic on the left and Orbita on the right. Each half is a static preview with one
 * line of description; hover (or a first tap on touch screens) expands it, a click chooses.
 * The choice is remembered in localStorage (`dosradio.ui.version`); both versions link back here
 * with "zmień wersję" (`/?wersja=wybierz`).
 */
import './entrySplit.css';
import type { StorageLike } from './prefs';

export const UI_VERSION_KEY = 'dosradio.ui.version';
export type UiVersion = 'classic' | 'orbita';
export type EntryAction = 'split' | UiVersion;

export const ORBITA_URL = '/orbita.html';
export const CHOOSE_PARAM = 'wersja';
export const CHOOSE_VALUE = 'wybierz';
export const CHANGE_VERSION_URL = `/?${CHOOSE_PARAM}=${CHOOSE_VALUE}`;
/** Links that must land in Classic as they are (e-mail verification, Stripe return, embedded views). */
const PASS_THROUGH_PARAMS = ['verify', 'billing', 'view', 'ramowka', 'embed'];

export function loadUiVersion(storage: StorageLike): UiVersion | null {
  try {
    const value = storage.getItem(UI_VERSION_KEY);
    return value === 'classic' || value === 'orbita' ? value : null;
  } catch {
    return null;
  }
}

export function saveUiVersion(storage: StorageLike, version: UiVersion): void {
  try { storage.setItem(UI_VERSION_KEY, version); } catch { /* private mode: choice lasts this visit */ }
}

/** What the root page does on load: show the split, stay in Classic, or go to Orbita. */
export function entryAction(stored: UiVersion | null, search: string): EntryAction {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  if (params.get(CHOOSE_PARAM) === CHOOSE_VALUE) return 'split';
  if (params.get('view') === 'classic') return 'classic';
  if (PASS_THROUGH_PARAMS.some((name) => params.has(name))) return 'classic';
  return stored ?? 'split';
}

const ARROW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

/** Static Classic poster: a sketch of the functional page (play, level bars, station list). */
const CLASSIC_POSTER = `<svg viewBox="0 0 320 220" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
  <rect x="1" y="1" width="318" height="218" rx="6" fill="none" stroke="currentColor" stroke-opacity=".28"/>
  <rect x="16" y="16" width="120" height="10" fill="currentColor" fill-opacity=".55"/>
  <rect x="250" y="16" width="54" height="10" fill="currentColor" fill-opacity=".22"/>
  <circle cx="40" cy="72" r="22" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M35 62v20l16-10z" fill="currentColor"/>
  ${Array.from({ length: 22 }, (_, i) => {
    const h = 8 + Math.round(26 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.37)));
    return `<rect x="${78 + i * 10}" y="${88 - h}" width="6" height="${h}" fill="currentColor" fill-opacity=".45"/>`;
  }).join('')}
  ${[0, 1, 2, 3].map((row) => `<rect x="16" y="${116 + row * 24}" width="${row === 1 ? 288 : 200 + row * 20}" height="16" fill="none" stroke="currentColor" stroke-opacity="${row === 1 ? '.9' : '.3'}"/>
  <rect x="24" y="${122 + row * 24}" width="${70 + row * 14}" height="4" fill="currentColor" fill-opacity="${row === 1 ? '.9' : '.4'}"/>`).join('')}
</svg>`;

/** Static Orbita poster: stations on orbits around a speaker, warm light from the centre. */
const ORBITA_POSTER = `<svg viewBox="0 0 320 220" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
  <defs>
    <radialGradient id="esCore" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffb347" stop-opacity=".95"/>
      <stop offset=".45" stop-color="#ff6b4a" stop-opacity=".55"/>
      <stop offset="1" stop-color="#7c5cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="160" cy="110" r="96" fill="url(#esCore)" opacity=".45"/>
  <g fill="none" stroke="#ece8f4">
    <ellipse cx="160" cy="110" rx="140" ry="44" stroke-opacity=".22" transform="rotate(-14 160 110)"/>
    <ellipse cx="160" cy="110" rx="104" ry="32" stroke-opacity=".32" transform="rotate(-14 160 110)"/>
    <ellipse cx="160" cy="110" rx="66" ry="20" stroke-opacity=".45" transform="rotate(-14 160 110)"/>
  </g>
  <circle cx="160" cy="110" r="18" fill="#1a0d08" stroke="#ffb347" stroke-width="2"/>
  <circle cx="160" cy="110" r="6" fill="#ffb347"/>
  <g fill="#ece8f4">
    <circle cx="29" cy="138" r="4"/><circle cx="262" cy="64" r="5" fill="#ff6b4a"/><circle cx="96" cy="137" r="3.5"/>
    <circle cx="224" cy="96" r="3"/><circle cx="118" cy="88" r="2.5"/><circle cx="296" cy="88" r="2.5" fill-opacity=".6"/>
  </g>
</svg>`;

interface HalfSpec {
  version: UiVersion;
  name: string;
  kicker: string;
  text: string;
  poster: string;
}

const HALVES: HalfSpec[] = [
  { version: 'classic', name: 'Classic', kicker: 'Surowo i funkcjonalnie', text: 'Stacje, wiadomości i ustawienia na jednej stronie. Wszystko pod ręką, nic zbędnego.', poster: CLASSIC_POSTER },
  { version: 'orbita', name: 'Orbita', kicker: 'Immersyjnie', text: 'Kręcisz tarczą, stacje krążą wokół głośnika, a prowadzący pojawia się w kadrze.', poster: ORBITA_POSTER },
];

function half(spec: HalfSpec, choose: (version: UiVersion) => void, expand: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `es-half es-${spec.version}`;
  button.dataset.version = spec.version;
  button.setAttribute('aria-label', `${spec.name}: ${spec.text}`);
  button.innerHTML = `
    <span class="es-poster">${spec.poster}</span>
    <span class="es-copy">
      <span class="es-kicker">${spec.kicker}</span>
      <span class="es-name">${spec.name}</span>
      <span class="es-text">${spec.text}</span>
      <span class="es-cta">Wybierz ${spec.name} ${ARROW_SVG}</span>
    </span>`; // static constants only
  // Touch screens have no hover: the first tap expands the half, the second one chooses. The state is
  // read on pointerdown, before the focus that the same tap causes expands the half.
  let expandedBeforeTap = true;
  button.addEventListener('pointerdown', (event) => {
    expandedBeforeTap = event.pointerType === 'mouse' || button.dataset.expanded === 'true';
  });
  button.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') expand(button); });
  button.addEventListener('focus', () => expand(button));
  button.addEventListener('click', () => {
    const wasExpanded = expandedBeforeTap;
    expandedBeforeTap = true; // keyboard activation has no pointerdown: choose directly
    if (!wasExpanded) { expand(button); return; }
    choose(spec.version);
  });
  return button;
}

/**
 * Shows the split over the page. `onChoose` runs after the choice is saved; for Orbita the
 * default action navigates to /orbita.html, Classic just removes the overlay.
 */
export function mountEntrySplit(storage: StorageLike, onChoose?: (version: UiVersion) => void): HTMLElement {
  document.getElementById('entrySplit')?.remove();
  const root = document.createElement('div');
  root.id = 'entrySplit';
  root.className = 'entry-split';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'entrySplitTitle');

  const head = document.createElement('header');
  head.className = 'es-head';
  head.innerHTML = `<span class="es-brand" id="entrySplitTitle">AmbiRadio <span>Ambitnie dla Ciebie</span></span>
    <span class="es-question">Jak chcesz słuchać? Zmienisz to w każdej chwili.</span>`;

  const halves = document.createElement('div');
  halves.className = 'es-halves';
  const choose = (version: UiVersion) => {
    saveUiVersion(storage, version);
    root.classList.add('es-leaving');
    document.documentElement.classList.remove('es-lock');
    if (onChoose) onChoose(version);
    if (version === 'orbita') { window.location.href = ORBITA_URL; return; }
    window.setTimeout(() => root.remove(), 220);
  };
  const buttons: HTMLButtonElement[] = [];
  const expand = (target: HTMLButtonElement) => {
    buttons.forEach((button) => { button.dataset.expanded = String(button === target); });
    halves.dataset.focus = target.dataset.version ?? '';
  };
  for (const spec of HALVES) buttons.push(half(spec, choose, expand));
  halves.append(...buttons);
  halves.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    buttons.forEach((button) => { button.dataset.expanded = 'false'; });
    delete halves.dataset.focus;
  });

  root.append(head, halves);
  document.documentElement.classList.add('es-lock');
  document.body.append(root);
  return root;
}

/** Small "zmień wersję" link for the Classic page. */
export function changeVersionLink(className = 'change-version'): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = CHANGE_VERSION_URL;
  link.className = className;
  link.textContent = 'zmień wersję';
  return link;
}

/**
 * Called first thing by the Classic entry point. Returns true when the page is leaving for
 * Orbita (the caller may skip work); otherwise shows the split when there is no saved choice.
 */
export function initEntry(storage: StorageLike, search: string, onChoose?: (version: UiVersion) => void): boolean {
  const action = entryAction(loadUiVersion(storage), search);
  if (new URLSearchParams(search).get('view') === 'classic') saveUiVersion(storage, 'classic');
  if (action === 'orbita') {
    window.location.replace(ORBITA_URL);
    return true;
  }
  if (action === 'split') {
    if (new URLSearchParams(search).has(CHOOSE_PARAM)) history.replaceState(null, '', window.location.pathname);
    mountEntrySplit(storage, onChoose);
  }
  return false;
}
