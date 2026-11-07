/**
 * Pure news helpers for the public DOS Radio client. Fetching, validation and TTS happen on the server.
 */

export type NewsCategory = 'ai' | 'beauty' | 'sport' | 'funny' | 'stoic' | 'mine';

/** The listener's own RSS feeds and keywords (Plus); served as one more topic by /radio-api/news. */
export const PERSONAL_CATEGORY: NewsCategory = 'mine';

export const NEWS_CATEGORIES: { id: NewsCategory; label: string }[] = [
  { id: 'ai', label: 'AI' },
  { id: 'beauty', label: 'Beauty i moda' },
  { id: 'sport', label: 'Sport' },
  { id: 'funny', label: 'Głupie' },
  { id: 'stoic', label: 'Stoicka myśl' },
  { id: 'mine', label: 'Moje źródła' },
];

/** Topics a listener can pick; "Moje źródła" only exists for Plus listeners with their own feeds. */
export function availableCategories(plus: boolean): { id: NewsCategory; label: string }[] {
  return NEWS_CATEGORIES.filter((category) => plus || category.id !== PERSONAL_CATEGORY);
}

export interface QueuedStory {
  id: string;
  title: string;
  /** One sentence, <= 18 words; older servers omit it. */
  headline?: string;
  radio_text: string;
  source_url: string;
  confirmed: boolean;
  category: NewsCategory;
  audio_ready: boolean;
}

export interface CategoryNews {
  category: NewsCategory;
  label: string;
  error: string | null;
  stories: QueuedStory[];
}

/** Round-robin across categories so every chosen topic gets airtime: ai0, sport0, ai1, sport1, ... */
export function interleaveStories(groups: CategoryNews[]): QueuedStory[] {
  const result: QueuedStory[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.stories.length));
  for (let index = 0; index < longest; index++) {
    for (const group of groups) {
      const story = group.stories[index];
      if (story) result.push(story);
    }
  }
  return result;
}

/**
 * Next story not aired yet, preferring ones whose audio is already rendered.
 * Never restarts the cycle: when everything was aired today it returns null and the caller fills the time.
 */
export function pickNextStory(queue: QueuedStory[], aired: ReadonlySet<string>): QueuedStory | null {
  const unaired = queue.filter((story) => !aired.has(story.id));
  return unaired.find((story) => story.audio_ready) ?? unaired[0] ?? null;
}

export function categoryLabel(id: NewsCategory): string {
  return NEWS_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

/** Keep only known categories in canonical order; never return an empty list. */
export function sanitizeCategories(values: string[]): NewsCategory[] {
  const picked = NEWS_CATEGORIES.map((category) => category.id).filter((id) => values.includes(id));
  return picked.length ? picked : ['ai'];
}
