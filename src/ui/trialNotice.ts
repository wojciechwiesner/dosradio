/**
 * The 6 h full-experience trial in the Classic view: a calm remaining-time label (minutes, no
 * ticking seconds) and one soft register prompt 30 minutes before the end. The prompt reuses the
 * existing /register modal through `onRegister`.
 */
import type { AccessState } from '../radio/radioApi';
import type { StorageLike } from './prefs';

export const TRIAL_SECONDS = 6 * 3600;
export const REGISTER_PROMPT_AT_S = 30 * 60;
export const PROMPT_SHOWN_KEY = 'dosradio.trial.prompt30.v1';

/** 21600 -> "6 h", 20520 -> "5 h 42 min", 2520 -> "42 min", 30 -> "mniej niż minuta". */
export function formatTrialCalm(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return 'mniej niż minuta';
  const minutesTotal = Math.ceil(total / 60);
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** Soft prompt: anonymous listener in a running trial, 30 min or less left, not shown before. */
export function shouldPromptRegister(access: AccessState | null, storage: StorageLike): boolean {
  if (!access || access.registered || !access.trial_started || !access.allowed) return false;
  if (access.trial_remaining > REGISTER_PROMPT_AT_S || access.trial_remaining <= 0) return false;
  return storage.getItem(PROMPT_SHOWN_KEY) !== '1';
}

const CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

export const PROMPT_TITLE = 'Za 30 minut kończy się pełny dostęp';
export const PROMPT_TEXT = 'Załóż darmowe konto AmbiRadio: zachowasz swoje tematy, podcasty i prowadzącego, a po potwierdzeniu e-maila dostaniesz 30 dni Plus.';

/** Non-blocking card in the corner; marks itself as shown so it appears once per browser. */
export function showRegisterPrompt(storage: StorageLike, onRegister: () => void): HTMLElement {
  storage.setItem(PROMPT_SHOWN_KEY, '1');
  document.getElementById('trialPrompt')?.remove();
  const card = document.createElement('aside');
  card.id = 'trialPrompt';
  card.className = 'trial-prompt';
  card.setAttribute('role', 'status');
  const icon = document.createElement('span');
  icon.className = 'trial-prompt-icon';
  icon.innerHTML = CLOCK_SVG; // static SVG constant
  const body = document.createElement('div');
  body.className = 'trial-prompt-body';
  const title = document.createElement('b');
  title.textContent = PROMPT_TITLE;
  const text = document.createElement('p');
  text.textContent = PROMPT_TEXT;
  const actions = document.createElement('div');
  actions.className = 'trial-prompt-actions';
  const register = document.createElement('button');
  register.type = 'button';
  register.className = 'btn primary';
  register.textContent = 'Załóż konto';
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn ghost';
  later.textContent = 'Później';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'trial-prompt-close';
  close.setAttribute('aria-label', 'Zamknij');
  close.innerHTML = CLOSE_SVG; // static SVG constant
  register.addEventListener('click', () => { card.remove(); onRegister(); });
  later.addEventListener('click', () => card.remove());
  close.addEventListener('click', () => card.remove());
  actions.append(register, later);
  body.append(title, text, actions);
  card.append(icon, body, close);
  document.body.append(card);
  return card;
}
