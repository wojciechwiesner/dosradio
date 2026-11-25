/**
 * Data and pure helpers for the AmbiRadio start wizard (onboarding.ts): podcast examples,
 * host personalities and the Plus setup that waits until the trial (and with it Plus) is on.
 * No DOM here, so everything is unit-testable.
 */
import type { StorageLike } from './prefs';

export type PodcastTopic = 'tech' | 'biznes' | 'sport' | 'kultura' | 'nauka';

export interface PodcastExample {
  id: string;
  topic: PodcastTopic;
  title: string;
  author: string;
  /** Public RSS feed; checked with curl on 2026-11-25 (HTTP 200, valid RSS 2.0, language pl). */
  feed: string;
}

export const PODCAST_TOPICS: { id: PodcastTopic; label: string }[] = [
  { id: 'tech', label: 'Tech/AI' },
  { id: 'biznes', label: 'Biznes' },
  { id: 'sport', label: 'Sport' },
  { id: 'kultura', label: 'Kultura' },
  { id: 'nauka', label: 'Nauka' },
];

/** Real, publicly available Polish podcasts. Their new episodes land in "Moje źródła". */
export const PODCAST_EXAMPLES: PodcastExample[] = [
  { id: 'ai-po-ludzku', topic: 'tech', title: 'Sztuczna inteligencja po ludzku', author: 'Politechnika Łódzka', feed: 'https://anchor.fm/s/1173e91b8/podcast/rss' },
  { id: 'przekleta-technologia', topic: 'tech', title: 'Przeklęta Technologia', author: 'Niezależny podcast', feed: 'https://anchor.fm/s/ebfbc73c/podcast/rss' },
  { id: 'biznes-2-0', topic: 'biznes', title: 'Biznes 2.0', author: 'Maciej Wieczorek', feed: 'https://www.spreaker.com/show/3683818/episodes/feed' },
  { id: 'biznes-i-pieniadze', topic: 'biznes', title: 'Biznes i pieniądze', author: 'Onet', feed: 'https://rss.audio.ringpublishing.com/b1fa999a-3a19-4b6c-b066-95b6d8028a70.db20aea95aa6edf5aab2b9e25cf54e89.xml' },
  { id: 'misja-sport', topic: 'sport', title: 'Misja sport', author: 'Marciniak, Kadziewicz', feed: 'https://rss.audio.ringpublishing.com/ae6b9e61-b282-4132-bf9e-c3cb3da448ad.09af9ccccf23b3f0fcf4d8519e934ecf.xml' },
  { id: 'to-jest-sport-pl', topic: 'sport', title: 'To jest Sport.pl', author: 'Sport.pl', feed: 'https://anchor.fm/s/da5fc730/podcast/rss' },
  { id: 'kultura-na-weekend', topic: 'kultura', title: 'Kultura na weekend', author: 'Polityka', feed: 'https://www.polityka.pl/rss/podcasts.xml?list=2434' },
  { id: 'clickbait', topic: 'kultura', title: 'Clickbait', author: 'WP Kultura', feed: 'https://anchor.fm/s/8afced30/podcast/rss' },
  { id: 'nauka-to-lubie', topic: 'nauka', title: 'Nauka To Lubię', author: 'Tomasz Rożek', feed: 'https://feeds.castos.com/d4vo5' },
  { id: 'z-nauka-po-imieniu', topic: 'nauka', title: 'Z nauką po imieniu', author: 'Radio TOK FM', feed: 'https://anchor.fm/s/1117cf148/podcast/rss' },
];

export interface WizardHost {
  id: string;
  name: string;
  /** Station the host leads; picking the host tunes to it. Null = music without a host. */
  station: string | null;
  text: string;
}

/** Three distinct personalities from server/app/hosts.py, plus "music only". */
export const WIZARD_HOSTS: WizardHost[] = [
  { id: 'kuba', name: 'Kuba', station: 'dos-groove', text: 'Spokojny i skupiony. Pilnuje rytmu, kiedy pracujesz.' },
  { id: 'zosia', name: 'Zosia', station: 'poranna-kawa', text: 'Słoneczna, z uśmiechem w głosie. Dobry start dnia.' },
  { id: 'marek', name: 'Marek', station: 'stoa', text: 'Mądry i wyważony. Krótkie zdania, stoicki spokój.' },
  { id: 'none', name: 'Sama muzyka', station: null, text: 'Bez prowadzącego. Gra tylko muzyka.' },
];

export const MAX_RSS_FEEDS = 10;

/** True for a pasted http(s) link the podcast generator can read. */
export function isPodcastLink(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Existing feeds first, new ones appended without duplicates, capped at the server limit. */
export function mergeFeeds(existing: string[], added: string[], max = MAX_RSS_FEEDS): string[] {
  const merged = [...existing];
  for (const feed of added) if (!merged.includes(feed)) merged.push(feed);
  return merged.slice(0, max);
}

export function feedsForExamples(ids: string[]): string[] {
  return PODCAST_EXAMPLES.filter((example) => ids.includes(example.id)).map((example) => example.feed);
}

// --- Plus setup waiting for the trial --------------------------------------------------
// The wizard runs before the first play, i.e. before the trial (and Plus) starts. What needs
// the Plus API is parked here and sent once /radio-api/me reports plus.

export const PENDING_PLUS_KEY = 'dosradio.wizard.plus.v1';

export interface PendingPlusSetup {
  feeds: string[];
  link: string | null;
}

export function savePendingPlus(storage: StorageLike, setup: PendingPlusSetup): void {
  if (!setup.feeds.length && !setup.link) return;
  storage.setItem(PENDING_PLUS_KEY, JSON.stringify(setup));
}

/** Reads and removes the parked setup (one shot, so a reload never sends it twice). */
export function takePendingPlus(storage: StorageLike & Partial<Pick<Storage, 'removeItem'>>): PendingPlusSetup | null {
  const raw = storage.getItem(PENDING_PLUS_KEY);
  if (!raw) return null;
  if (storage.removeItem) storage.removeItem(PENDING_PLUS_KEY); else storage.setItem(PENDING_PLUS_KEY, '');
  try {
    const parsed = JSON.parse(raw) as Partial<PendingPlusSetup>;
    const feeds = Array.isArray(parsed.feeds) ? parsed.feeds.filter((feed): feed is string => typeof feed === 'string' && isPodcastLink(feed)) : [];
    const link = typeof parsed.link === 'string' && isPodcastLink(parsed.link) ? parsed.link.trim() : null;
    return feeds.length || link ? { feeds, link } : null;
  } catch {
    return null;
  }
}
