/**
 * First-play onboarding modal: host or not, which news areas, how often. Re-openable from the page.
 * Pure persistence lives in prefs.ts; this file only builds and wires the DOM.
 */
import { availableCategories, type NewsCategory } from '../radio/newsQueue';
import { BREAK_INTERVALS, intervalLabel, type BreakInterval } from '../radio/radioClock';
import type { HostMode } from '../radio/publicRadioEngine';
import type { OnboardingChoice, Prefs } from './prefs';

export const ONBOARDING_HEADLINE = 'Najlepsze radio to takie, które gra i mówi to, co ty chcesz.';
export const ONBOARDING_SUBHEAD = 'Więc co chcesz usłyszeć?';

const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>';
const NOTE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const TICK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>';

const STAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';

const HOST_CARDS: { mode: HostMode; title: string; text: string; icon: string }[] = [
  { mode: 'with-host', title: 'Z prowadzącym', text: 'Ktoś do pogadania między piosenkami.', icon: MIC_SVG },
  { mode: 'music-only', title: 'Sama muzyka', text: 'Cisza w eterze, gra tylko muzyka.', icon: NOTE_SVG },
];


function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function sectionTitle(step: string, text: string): HTMLElement {
  const title = el('h3', 'ob-step');
  title.append(el('span', 'ob-num', step), document.createTextNode(text));
  return title;
}

/** Toggle button used by cards, chips and interval pills; `aria-pressed` carries the state. */
function toggleButton(className: string, pressed: boolean): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.setAttribute('aria-pressed', String(pressed));
  return button;
}

function setPressed(button: HTMLElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', String(pressed));
}

export function openOnboarding(prefs: Prefs, onDone: (choice: OnboardingChoice) => void, plus = false): void {
  const topics = availableCategories(plus);
  const modal = document.getElementById('onboardModal');
  if (!modal) throw new Error('missing #onboardModal'); // autocheck spot: page and script must match

  let hostMode: HostMode = prefs.hostMode;
  const categories = new Set<NewsCategory>(prefs.newsEnabled ? prefs.categories : []);
  let interval: BreakInterval = prefs.interval;
  let dayTopic: NewsCategory | null = prefs.newsEnabled ? prefs.dayTopic : null;

  const close = () => { modal.classList.remove('open'); document.removeEventListener('keydown', onKey); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };

  const hostCards = HOST_CARDS.map((card) => {
    const button = toggleButton('ob-card', hostMode === card.mode);
    const icon = el('span', 'ob-icon');
    icon.innerHTML = card.icon; // static SVG constant
    button.append(icon, el('b', undefined, card.title), el('small', undefined, card.text));
    button.addEventListener('click', () => {
      hostMode = card.mode;
      hostCards.forEach((other) => setPressed(other, other === button));
    });
    return button;
  });

  const noNews = toggleButton('chip', categories.size === 0);
  const stars = new Map<NewsCategory, HTMLButtonElement>();
  const renderStars = () => stars.forEach((star, id) => {
    setPressed(star, dayTopic === id);
    star.hidden = !categories.has(id);
  });

  const categoryChips = topics.map((category) => {
    const chip = toggleButton('chip', categories.has(category.id));
    const tick = el('span', 'tick');
    tick.innerHTML = TICK_SVG; // static SVG constant
    chip.append(tick, document.createTextNode(category.label));
    chip.addEventListener('click', () => {
      if (categories.has(category.id)) categories.delete(category.id); else categories.add(category.id);
      if (!categories.has(category.id) && dayTopic === category.id) dayTopic = null;
      setPressed(chip, categories.has(category.id));
      setPressed(noNews, categories.size === 0);
      renderStars();
    });
    return chip;
  });
  noNews.append(document.createTextNode('Bez wiadomości'));
  noNews.addEventListener('click', () => {
    categories.clear();
    dayTopic = null;
    categoryChips.forEach((chip) => setPressed(chip, false));
    setPressed(noNews, true);
    renderStars();
  });

  /** Chip plus a star: the star marks the topic of the day (at most one). */
  const categoryItems = topics.map((category, index) => {
    const star = toggleButton('chip-star', dayTopic === category.id);
    star.innerHTML = STAR_SVG; // static SVG constant
    star.setAttribute('aria-label', `Temat dnia: ${category.label}`);
    star.title = 'Temat dnia: usłyszysz o nim najwięcej';
    star.addEventListener('click', () => {
      dayTopic = dayTopic === category.id ? null : category.id;
      renderStars();
    });
    stars.set(category.id, star);
    const wrap = el('span', 'chip-wrap');
    wrap.append(categoryChips[index], star);
    return wrap;
  });
  renderStars();

  const intervalPills = BREAK_INTERVALS.map((minutes) => {
    const pill = toggleButton('chip', interval === minutes);
    pill.textContent = intervalLabel(minutes);
    pill.addEventListener('click', () => {
      interval = minutes;
      intervalPills.forEach((other) => setPressed(other, other === pill));
    });
    return pill;
  });

  const go = el('button', 'btn primary ob-go', 'Graj!');
  go.type = 'button';
  go.addEventListener('click', () => {
    close();
    onDone({ hostMode, categories: [...categories], interval, dayTopic });
  });

  const dialog = el('div', 'dialog ob-dialog');
  dialog.append(
    el('h2', 'ob-headline', ONBOARDING_HEADLINE),
    el('p', 'ob-sub', ONBOARDING_SUBHEAD),
    sectionTitle('1', 'Z prowadzącym czy bez?'),
    el('div', 'ob-cards'),
    sectionTitle('2', 'Jakie wiadomości cię interesują?'),
    el('div', 'chips'),
    el('p', 'ob-hint', 'Gwiazdka przy temacie oznacza temat dnia: o nim usłyszysz najwięcej.'),
    sectionTitle('3', 'Jak często mają wchodzić?'),
    el('div', 'chips'),
    go,
  );
  const [cards, newsChips, intervalChips] = Array.from(dialog.querySelectorAll('.ob-cards, .chips'));
  cards.append(...hostCards);
  newsChips.append(...categoryItems, noNews);
  intervalChips.append(...intervalPills);

  modal.replaceChildren(dialog);
  modal.onclick = (event) => { if (event.target === modal) close(); };
  document.addEventListener('keydown', onKey);
  modal.classList.add('open');
  go.focus();
}
