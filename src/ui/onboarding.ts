/**
 * AmbiRadio start wizard (first play, re-openable with "Zmień, co chcesz słyszeć"): three short,
 * skippable steps, about 30 seconds in total.
 *   1. News topics as chips (+ how often they come in),
 *   2. Podcasts: paste a link or pick real Polish podcasts in five topics,
 *   3. Host personality (or music only).
 * Pure persistence lives in prefs.ts and wizardContent.ts; this file only builds and wires the DOM.
 */
import { availableCategories, type NewsCategory } from '../radio/newsQueue';
import { BREAK_INTERVALS, intervalLabel, type BreakInterval } from '../radio/radioClock';
import type { OnboardingChoice, Prefs } from './prefs';
import {
  PODCAST_EXAMPLES, PODCAST_TOPICS, WIZARD_HOSTS, feedsForExamples, isPodcastLink,
  type PodcastTopic, type WizardHost,
} from './wizardContent';

export const ONBOARDING_HEADLINE = 'AmbiRadio — Ambitnie dla Ciebie';
export const WIZARD_STEPS = ['Wiadomości', 'Podcasty', 'Prowadzący'] as const;

const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>';
const NOTE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const TICK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const LINK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

/** Everything the wizard collects; extends the classic onboarding answers. */
export interface WizardChoice extends OnboardingChoice {
  /** Station of the chosen host, or undefined to keep the current station. */
  station?: string;
  /** RSS feeds of the picked example podcasts (go to "Moje źródła"). */
  podcastFeeds: string[];
  /** A pasted link the podcast generator should turn into an episode. */
  podcastLink: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Toggle button used by cards and chips; `aria-pressed` carries the state. */
function toggleButton(className: string, pressed: boolean): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.setAttribute('aria-pressed', String(pressed));
  return button;
}

const setPressed = (button: HTMLElement, pressed: boolean): void => button.setAttribute('aria-pressed', String(pressed));

function tickChip(label: string, pressed: boolean): HTMLButtonElement {
  const chip = toggleButton('chip', pressed);
  const tick = el('span', 'tick');
  tick.innerHTML = TICK_SVG; // static SVG constant
  chip.append(tick, document.createTextNode(label));
  return chip;
}

/** Host of the current station when it is one of the wizard hosts, else the first one. */
function initialHost(prefs: Prefs): WizardHost {
  if (prefs.hostMode === 'music-only') return WIZARD_HOSTS[WIZARD_HOSTS.length - 1];
  return WIZARD_HOSTS.find((host) => host.station === prefs.station) ?? WIZARD_HOSTS[0];
}

export function openOnboarding(prefs: Prefs, onDone: (choice: WizardChoice) => void, plus = false): void {
  const topics = availableCategories(plus);
  const modal = document.getElementById('onboardModal');
  if (!modal) throw new Error('missing #onboardModal'); // autocheck spot: page and script must match

  const categories = new Set<NewsCategory>(prefs.newsEnabled ? prefs.categories : []);
  let interval: BreakInterval = prefs.interval;
  let host = initialHost(prefs);
  const pickedPodcasts = new Set<string>();
  let podcastTopic: PodcastTopic = 'tech';
  let step = 0;

  const close = () => { modal.classList.remove('open'); document.removeEventListener('keydown', onKey); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };

  // --- step 1: news topics ---------------------------------------------------------
  const noNews = tickChip('Bez wiadomości', categories.size === 0);
  const categoryChips = topics.map((category) => {
    const chip = tickChip(category.label, categories.has(category.id));
    chip.addEventListener('click', () => {
      if (categories.has(category.id)) categories.delete(category.id); else categories.add(category.id);
      setPressed(chip, categories.has(category.id));
      setPressed(noNews, categories.size === 0);
    });
    return chip;
  });
  noNews.addEventListener('click', () => {
    categories.clear();
    categoryChips.forEach((chip) => setPressed(chip, false));
    setPressed(noNews, true);
  });
  const intervalPills = BREAK_INTERVALS.map((minutes) => {
    const pill = toggleButton('chip chip-sm', interval === minutes);
    pill.textContent = intervalLabel(minutes);
    pill.addEventListener('click', () => {
      interval = minutes;
      intervalPills.forEach((other) => setPressed(other, other === pill));
    });
    return pill;
  });
  const newsPane = el('div', 'wz-pane');
  const newsChips = el('div', 'chips');
  newsChips.append(...categoryChips, noNews);
  const intervalRow = el('div', 'chips');
  intervalRow.append(...intervalPills);
  newsPane.append(
    el('h3', 'wz-title', 'O czym ma mówić prowadzący?'),
    el('p', 'wz-lead', 'Zaznacz tematy wiadomości. Możesz wybrać kilka.'),
    newsChips,
    el('p', 'wz-label', 'Jak często?'),
    intervalRow,
  );

  // --- step 2: podcasts -------------------------------------------------------------
  const linkInput = el('input', 'wz-input');
  linkInput.type = 'url';
  linkInput.placeholder = 'Wklej link do strony lub artykułu';
  linkInput.autocomplete = 'off';
  linkInput.setAttribute('aria-label', 'Link do strony, z której zrobimy podcast');
  const linkError = el('p', 'wz-error');
  linkError.setAttribute('role', 'status');
  const linkRow = el('label', 'wz-link');
  const linkIcon = el('span', 'wz-link-icon');
  linkIcon.innerHTML = LINK_SVG; // static SVG constant
  linkRow.append(linkIcon, linkInput);

  const topicTabs = PODCAST_TOPICS.map((topic) => {
    const tab = toggleButton('chip chip-sm', topic.id === podcastTopic);
    tab.textContent = topic.label;
    tab.addEventListener('click', () => {
      podcastTopic = topic.id;
      topicTabs.forEach((other) => setPressed(other, other === tab));
      renderExamples();
    });
    return tab;
  });
  const tabRow = el('div', 'chips wz-tabs');
  tabRow.append(...topicTabs);
  const exampleList = el('div', 'wz-examples');
  const picked = el('p', 'wz-hint');
  const renderPicked = () => {
    picked.textContent = pickedPodcasts.size
      ? `Wybrane: ${pickedPodcasts.size}. Nowe odcinki trafią do tematu „Moje źródła”.`
      : 'Nowe odcinki wybranych podcastów trafią do tematu „Moje źródła”.';
  };
  const renderExamples = () => {
    exampleList.replaceChildren(...PODCAST_EXAMPLES.filter((example) => example.topic === podcastTopic).map((example) => {
      const card = toggleButton('wz-example', pickedPodcasts.has(example.id));
      const tick = el('span', 'tick');
      tick.innerHTML = TICK_SVG; // static SVG constant
      const text = el('span', 'wz-example-text');
      text.append(el('b', undefined, example.title), el('small', undefined, example.author));
      card.append(tick, text);
      card.addEventListener('click', () => {
        if (pickedPodcasts.has(example.id)) pickedPodcasts.delete(example.id); else pickedPodcasts.add(example.id);
        setPressed(card, pickedPodcasts.has(example.id));
        renderPicked();
      });
      return card;
    }));
  };
  renderExamples();
  renderPicked();
  const podcastPane = el('div', 'wz-pane');
  podcastPane.append(
    el('h3', 'wz-title', 'Twój podcast'),
    el('p', 'wz-lead', 'Wklej link, a prowadzący zrobią z niego audycję. Albo wybierz gotowe polskie podcasty.'),
    linkRow,
    linkError,
    el('p', 'wz-label', 'Gotowe przykłady'),
    tabRow,
    exampleList,
    picked,
  );

  // --- step 3: host ------------------------------------------------------------------
  const hostCards = WIZARD_HOSTS.map((candidate) => {
    const card = toggleButton('ob-card', candidate.id === host.id);
    const icon = el('span', 'ob-icon');
    icon.innerHTML = candidate.station ? MIC_SVG : NOTE_SVG; // static SVG constants
    card.append(icon, el('b', undefined, candidate.name), el('small', undefined, candidate.text));
    card.addEventListener('click', () => {
      host = candidate;
      hostCards.forEach((other) => setPressed(other, other === card));
    });
    return card;
  });
  const hostPane = el('div', 'wz-pane');
  const cards = el('div', 'ob-cards');
  cards.append(...hostCards);
  hostPane.append(
    el('h3', 'wz-title', 'Kto ma prowadzić?'),
    el('p', 'wz-lead', 'Każdy prowadzący ma swój charakter i swoją stację. Zmienisz to w każdej chwili.'),
    cards,
  );

  // --- frame -------------------------------------------------------------------------
  const panes = [newsPane, podcastPane, hostPane];
  const dots = WIZARD_STEPS.map((label, index) => {
    const dot = el('li', 'wz-dot');
    dot.append(el('span', 'wz-dot-num', String(index + 1)), document.createTextNode(label));
    return dot;
  });
  const progress = el('ol', 'wz-progress');
  progress.append(...dots);

  const skip = el('button', 'btn ghost wz-skip', 'Pomiń');
  skip.type = 'button';
  const back = el('button', 'btn ghost', 'Wstecz');
  back.type = 'button';
  const next = el('button', 'btn primary wz-next', 'Dalej');
  next.type = 'button';

  const finish = (skipped: boolean) => {
    const link = linkInput.value.trim();
    close();
    const base: WizardChoice = skipped
      ? { hostMode: prefs.hostMode, categories: prefs.newsEnabled ? prefs.categories : [], interval: prefs.interval, dayTopic: prefs.dayTopic, podcastFeeds: [], podcastLink: null }
      : {
        hostMode: host.station ? 'with-host' : 'music-only',
        categories: [...categories],
        interval,
        dayTopic: prefs.dayTopic,
        station: host.station ?? undefined,
        podcastFeeds: feedsForExamples([...pickedPodcasts]),
        podcastLink: isPodcastLink(link) ? link : null,
      };
    onDone(base);
  };

  const render = () => {
    panes.forEach((pane, index) => { pane.hidden = index !== step; });
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === step);
      dot.classList.toggle('done', index < step);
    });
    back.hidden = step === 0;
    next.textContent = step === panes.length - 1 ? 'Graj' : 'Dalej';
  };

  back.addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
  next.addEventListener('click', () => {
    if (step === 1) {
      const link = linkInput.value.trim();
      if (link && !isPodcastLink(link)) { linkError.textContent = 'To nie wygląda na link. Wklej adres zaczynający się od https://'; return; }
      linkError.textContent = '';
    }
    if (step < panes.length - 1) { step++; render(); next.focus({ preventScroll: true }); return; }
    finish(false);
  });
  skip.addEventListener('click', () => finish(true));

  const head = el('div', 'wz-head');
  head.append(el('span', 'wz-brand', ONBOARDING_HEADLINE), skip);
  const actions = el('div', 'wz-actions');
  actions.append(back, next);
  const dialog = el('div', 'dialog ob-dialog wz-dialog');
  dialog.append(head, progress, ...panes, actions);

  modal.replaceChildren(dialog);
  modal.setAttribute('aria-label', 'Kreator startowy AmbiRadio');
  modal.onclick = (event) => { if (event.target === modal) close(); };
  document.addEventListener('keydown', onKey);
  render();
  modal.classList.add('open');
  next.focus({ preventScroll: true });
}
