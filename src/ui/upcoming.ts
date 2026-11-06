/** FOMO line under the player: "Za 3:12: <headline of what comes next>", refreshed every second. */
import type { QueuedStory } from '../radio/newsQueue';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** 192000 -> "3:12"; never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / MS_PER_SECOND));
  const seconds = total % SECONDS_PER_MINUTE;
  return `${Math.floor(total / SECONDS_PER_MINUTE)}:${String(seconds).padStart(2, '0')}`;
}

export function upcomingText(at: Date | null, story: QueuedStory | null, now: Date): string {
  if (!at || !story) return '';
  const wait = at.getTime() - now.getTime();
  const label = story.headline || story.title;
  return wait > 0 ? `Za ${formatCountdown(wait)}: ${label}` : `Za chwilę: ${label}`;
}

export interface UpcomingLine {
  setNextBreak: (at: Date | null) => void;
  setStory: (story: QueuedStory | null) => void;
}

export function initUpcoming(element: HTMLElement): UpcomingLine {
  let nextBreak: Date | null = null;
  let story: QueuedStory | null = null;
  const render = () => { element.textContent = upcomingText(nextBreak, story, new Date()); };
  setInterval(render, MS_PER_SECOND);
  return {
    setNextBreak: (at) => { nextBreak = at; render(); },
    setStory: (next) => { story = next; render(); },
  };
}
