/**
 * "Moje podcasty" list inside the Plus panel: pure rendering of the rows returned by
 * GET /radio-api/plus/podcasts. Playback is injected, so this file never touches audio.
 */
import type { PodcastListItem } from '../radio/radioApi';

export const EMPTY_TEXT = 'Tu pojawią się Twoje podcasty.';
export const STATUS_TEXT = { generating: 'w przygotowaniu', failed: 'nie udało się' } as const;

const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PENDING_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const FAILED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>';

const dateFormat = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

/** Unix seconds -> "23 listopada 2026". */
export const formatPolishDate = (seconds: number): string => dateFormat.format(new Date(seconds * 1000));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildRow(item: PodcastListItem, onPlay: (item: PodcastListItem) => void): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'plus-podcast-row';
  row.dataset.status = item.status;
  const title = item.title || item.site_title || 'Podcast';
  if (item.status === 'ready') {
    const play = el('button', 'plus-podcast-play');
    play.type = 'button';
    play.innerHTML = PLAY_ICON;
    play.setAttribute('aria-label', `Odtwórz: ${title}`);
    play.addEventListener('click', () => onPlay(item));
    row.append(play);
  } else {
    const state = el('span', 'plus-podcast-state');
    state.innerHTML = item.status === 'failed' ? FAILED_ICON : PENDING_ICON;
    row.append(state);
  }
  const body = el('div', 'plus-podcast-body');
  body.append(el('div', 'plus-podcast-title', title));
  const meta = el('div', 'plus-podcast-meta');
  meta.append(el('span', 'plus-podcast-date', formatPolishDate(item.created_at)));
  if (item.status !== 'ready') meta.append(el('span', 'plus-podcast-status', STATUS_TEXT[item.status]));
  if (item.source === 'link' && item.share_path) {
    const link = el('a', 'plus-podcast-share', 'Link do udostępnienia');
    link.href = item.share_path;
    link.target = '_blank';
    link.rel = 'noopener';
    meta.append(link);
  }
  body.append(meta);
  if (item.summary) body.append(el('div', 'plus-podcast-summary', item.summary));
  row.append(body);
  return row;
}

export function renderPodcastList(
  list: HTMLElement,
  items: PodcastListItem[],
  onPlay: (item: PodcastListItem) => void,
): void {
  list.replaceChildren();
  if (!items.length) {
    list.append(el('li', 'empty', EMPTY_TEXT));
    return;
  }
  for (const item of items) list.append(buildRow(item, onPlay));
}
