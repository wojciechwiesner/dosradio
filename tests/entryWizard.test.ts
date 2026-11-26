// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CHANGE_VERSION_URL, UI_VERSION_KEY, entryAction, loadUiVersion, mountEntrySplit, saveUiVersion,
} from '../src/ui/entrySplit';
import {
  PENDING_PLUS_KEY, PODCAST_EXAMPLES, PODCAST_TOPICS, WIZARD_HOSTS, feedsForExamples, isPodcastLink, mergeFeeds,
  savePendingPlus, takePendingPlus,
} from '../src/ui/wizardContent';
import { PROMPT_SHOWN_KEY, formatTrialCalm, shouldPromptRegister } from '../src/ui/trialNotice';
import { applyOnboardingChoice, defaultPrefs, type StorageLike } from '../src/ui/prefs';
import { openOnboarding, type WizardChoice } from '../src/ui/onboarding';
import { stationById } from '../src/radio/stations';
import type { AccessState } from '../src/radio/radioApi';

function memoryStorage(): StorageLike & { data: Map<string, string>; removeItem: (key: string) => void } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe('entry split decision', () => {
  it('first visit without a saved choice shows the split', () => {
    expect(entryAction(null, '')).toBe('split');
  });

  it('a saved choice is honoured', () => {
    expect(entryAction('orbita', '')).toBe('orbita');
    expect(entryAction('classic', '')).toBe('classic');
  });

  it('"zmień wersję" forces the split even with a saved choice', () => {
    expect(entryAction('orbita', CHANGE_VERSION_URL.slice(1))).toBe('split');
  });

  it('verification, billing and view links always land in Classic', () => {
    for (const search of ['?verify=abc', '?billing=success', '?view=classic', '?ramowka=1']) {
      expect(entryAction('orbita', search)).toBe('classic');
      expect(entryAction(null, search)).toBe('classic');
    }
  });

  it('stores the choice under dosradio.ui.version and ignores junk', () => {
    const storage = memoryStorage();
    expect(loadUiVersion(storage)).toBeNull();
    saveUiVersion(storage, 'orbita');
    expect(storage.data.get(UI_VERSION_KEY)).toBe('orbita');
    expect(loadUiVersion(storage)).toBe('orbita');
    storage.setItem(UI_VERSION_KEY, 'nonsense');
    expect(loadUiVersion(storage)).toBeNull();
  });
});

describe('entry split DOM', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('renders two halves with one-line descriptions and no emoji', () => {
    const root = mountEntrySplit(memoryStorage(), () => undefined);
    const halves = root.querySelectorAll<HTMLButtonElement>('.es-half');
    expect([...halves].map((half) => half.dataset.version)).toEqual(['classic', 'orbita']);
    expect(root.querySelectorAll('.es-text')).toHaveLength(2);
    expect(root.textContent).toContain('AmbiRadio');
    expect(root.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('choosing Classic saves it and removes the overlay', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const chosen: string[] = [];
    const root = mountEntrySplit(storage, (version) => chosen.push(version));
    root.querySelector<HTMLButtonElement>('.es-classic')!.click();
    expect(storage.data.get(UI_VERSION_KEY)).toBe('classic');
    expect(chosen).toEqual(['classic']);
    vi.runAllTimers();
    expect(document.getElementById('entrySplit')).toBeNull();
    vi.useRealTimers();
  });
});

describe('start wizard content', () => {
  it('has real https feeds for every podcast topic', () => {
    for (const topic of PODCAST_TOPICS) {
      expect(PODCAST_EXAMPLES.filter((example) => example.topic === topic.id).length).toBeGreaterThanOrEqual(2);
    }
    for (const example of PODCAST_EXAMPLES) expect(example.feed).toMatch(/^https:\/\/[^\s]+$/);
    expect(new Set(PODCAST_EXAMPLES.map((example) => example.feed)).size).toBe(PODCAST_EXAMPLES.length);
  });

  it('every host leads a real station', () => {
    for (const host of WIZARD_HOSTS.filter((candidate) => candidate.station)) {
      expect(stationById(host.station!).id).toBe(host.station);
    }
    expect(WIZARD_HOSTS.some((host) => host.station === null)).toBe(true);
  });

  it('recognises links and merges feeds without duplicates up to the limit', () => {
    expect(isPodcastLink('https://example.com/a')).toBe(true);
    expect(isPodcastLink('example')).toBe(false);
    expect(isPodcastLink('ftp://example.com')).toBe(false);
    expect(mergeFeeds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(mergeFeeds([], Array.from({ length: 12 }, (_, i) => `f${i}`))).toHaveLength(10);
    expect(feedsForExamples(['nauka-to-lubie'])).toEqual(['https://feeds.castos.com/d4vo5']);
  });

  it('parks the Plus setup until the trial and hands it out once', () => {
    const storage = memoryStorage();
    savePendingPlus(storage, { feeds: [], link: null });
    expect(storage.data.has(PENDING_PLUS_KEY)).toBe(false);
    savePendingPlus(storage, { feeds: ['https://feeds.castos.com/d4vo5'], link: 'https://example.com/artykul' });
    expect(takePendingPlus(storage)).toEqual({ feeds: ['https://feeds.castos.com/d4vo5'], link: 'https://example.com/artykul' });
    expect(takePendingPlus(storage)).toBeNull();
  });

  it('applies the host station and resets the blend', () => {
    const prefs = { ...defaultPrefs(), blend: 'lofi-nauka' };
    const next = applyOnboardingChoice(prefs, { hostMode: 'with-host', categories: ['sport'], interval: 10, station: 'stoa' });
    expect(next.station).toBe('stoa');
    expect(next.blend).toBeNull();
    expect(next.categories).toEqual(['sport']);
    const same = applyOnboardingChoice(prefs, { hostMode: 'with-host', categories: ['sport'], interval: 10 });
    expect(same.station).toBe(prefs.station);
    expect(same.blend).toBe('lofi-nauka');
  });
});

describe('start wizard DOM', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    const modal = document.createElement('div');
    modal.id = 'onboardModal';
    document.body.append(modal);
  });

  const buttonByText = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('#onboardModal button')].find((button) => button.textContent?.trim() === text)!;

  it('walks three steps and returns topics, podcasts and host', () => {
    let result: WizardChoice | null = null;
    openOnboarding(defaultPrefs(), (choice) => { result = choice; });
    buttonByText('Sport').click();
    buttonByText('Dalej').click();
    document.querySelector<HTMLInputElement>('.wz-input')!.value = 'https://example.com/artykul';
    buttonByText('Nauka').click();
    document.querySelector<HTMLButtonElement>('.wz-example')!.click();
    buttonByText('Dalej').click();
    [...document.querySelectorAll<HTMLButtonElement>('.ob-card')].find((card) => card.textContent?.includes('Marek'))!.click();
    buttonByText('Graj').click();
    expect(result).not.toBeNull();
    const choice = result as unknown as WizardChoice;
    expect(choice.categories).toEqual(['ai', 'sport']);
    expect(choice.station).toBe('stoa');
    expect(choice.hostMode).toBe('with-host');
    expect(choice.podcastFeeds).toEqual(['https://feeds.castos.com/d4vo5']);
    expect(choice.podcastLink).toBe('https://example.com/artykul');
  });

  it('rejects a pasted non-link on the podcast step', () => {
    openOnboarding(defaultPrefs(), () => undefined);
    buttonByText('Dalej').click();
    document.querySelector<HTMLInputElement>('.wz-input')!.value = 'nie link';
    buttonByText('Dalej').click();
    expect(document.querySelector('.wz-error')!.textContent).toContain('link');
    expect(document.querySelectorAll<HTMLElement>('.wz-pane')[1].hidden).toBe(false);
  });

  it('"Pomiń" keeps the current settings', () => {
    let result: WizardChoice | null = null;
    const prefs = defaultPrefs();
    openOnboarding(prefs, (choice) => { result = choice; });
    buttonByText('Pomiń').click();
    const choice = result as unknown as WizardChoice;
    expect(choice.categories).toEqual(prefs.categories);
    expect(choice.station).toBeUndefined();
    expect(choice.podcastFeeds).toEqual([]);
  });
});

describe('6 h trial indicator', () => {
  const access = (remaining: number, extra: Partial<AccessState> = {}): AccessState => ({
    allowed: remaining > 0, registered: false, email: null, trial_started: true, trial_remaining: remaining,
    plus: remaining > 0, trial_plus: remaining > 0, ...extra,
  });

  it('formats calmly in hours and minutes', () => {
    expect(formatTrialCalm(21600)).toBe('6 h');
    expect(formatTrialCalm(20520)).toBe('5 h 42 min');
    expect(formatTrialCalm(2520)).toBe('42 min');
    expect(formatTrialCalm(30)).toBe('mniej niż minuta');
  });

  it('prompts once, only in the last 30 minutes of an anonymous trial', () => {
    const storage = memoryStorage();
    expect(shouldPromptRegister(access(3 * 3600), storage)).toBe(false);
    expect(shouldPromptRegister(access(1801), storage)).toBe(false);
    expect(shouldPromptRegister(access(1800), storage)).toBe(true);
    expect(shouldPromptRegister(access(600, { registered: true }), storage)).toBe(false);
    expect(shouldPromptRegister(access(0), storage)).toBe(false);
    storage.setItem(PROMPT_SHOWN_KEY, '1');
    expect(shouldPromptRegister(access(600), storage)).toBe(false);
  });
});
