// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderPodcastList, EMPTY_TEXT, formatPolishDate } from '../src/ui/podcastList';
import type { PodcastListItem } from '../src/radio/radioApi';

const item = (over: Partial<PodcastListItem>): PodcastListItem => ({
  id: 'e1', title: 'Testowy odcinek', summary: 'Krótko o testach.', created_at: Date.UTC(2026, 10, 23, 12) / 1000,
  parts: [{ kind: 'voice', url: '/radio-api/plus/podcast/e1/part_1.wav' }], source: 'plus', status: 'ready', ...over,
});

const render = (items: PodcastListItem[], onPlay = vi.fn()) => {
  const list = document.createElement('ul');
  renderPodcastList(list, items, onPlay);
  return { list, onPlay };
};

describe('renderPodcastList', () => {
  it('shows the empty state', () => {
    const { list } = render([]);
    expect(list.textContent).toBe(EMPTY_TEXT);
  });

  it('renders a ready row with Polish date, summary and a play button that calls back', () => {
    const ready = item({});
    const { list, onPlay } = render([ready]);
    expect(list.querySelector('.plus-podcast-title')?.textContent).toBe('Testowy odcinek');
    expect(list.querySelector('.plus-podcast-date')?.textContent).toBe(formatPolishDate(ready.created_at));
    expect(list.querySelector('.plus-podcast-date')?.textContent).toContain('listopada');
    expect(list.querySelector('.plus-podcast-summary')?.textContent).toBe('Krótko o testach.');
    expect(list.querySelector('.plus-podcast-share')).toBeNull();
    list.querySelector<HTMLButtonElement>('.plus-podcast-play')!.click();
    expect(onPlay).toHaveBeenCalledWith(ready);
  });

  it('renders pending and failed link rows with status, share link and no play button', () => {
    const base = { source: 'link' as const, parts: [], summary: '', share_path: '/orbita.html?p=p_abc' };
    const { list } = render([
      item({ ...base, id: 'a', status: 'generating', title: 'Strona A' }),
      item({ ...base, id: 'b', status: 'failed', title: 'Strona B' }),
    ]);
    expect(list.querySelectorAll('.plus-podcast-play')).toHaveLength(0);
    const statuses = [...list.querySelectorAll('.plus-podcast-status')].map((n) => n.textContent);
    expect(statuses).toEqual(['w przygotowaniu', 'nie udało się']);
    expect(list.querySelector<HTMLAnchorElement>('.plus-podcast-share')!.getAttribute('href')).toBe('/orbita.html?p=p_abc');
  });

  it('does not interpret titles as HTML', () => {
    const { list } = render([item({ title: '<img src=x onerror=alert(1)>' })]);
    expect(list.querySelector('img')).toBeNull();
  });
});
