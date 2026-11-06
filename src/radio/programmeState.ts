/**
 * Mutable memory of the programme within one listening session: what format aired last, which headlines
 * were read, when the last hourly bulletin ran. Fully-aired stories live in the persisted AiredStore.
 */
import type { AiredStore } from './airedStore';
import type { NewsCategory, QueuedStory } from './newsQueue';
import { hourKey, type BreakClip, type BreakContext, type BreakPlan, type ShortFormat, type WeatherPlace, hasWeatherPlace } from './programme';

export class ProgrammeState {
  dayTopic: NewsCategory | null = null;
  hourlyEnabled = true;
  place: WeatherPlace | null = null;

  private readonly headlined = new Set<string>();
  private lastFormat: ShortFormat | null = null;
  private lastHourlyKey: string | null = null;

  constructor(readonly aired: AiredStore) {}

  /** A new listening session never opens with the hourly bulletin of the hour it started in. */
  startSession(now: Date): void {
    this.headlined.clear();
    this.lastFormat = null;
    this.lastHourlyKey = hourKey(now);
  }

  context(queue: QueuedStory[], now: Date): BreakContext {
    return {
      now,
      queue,
      aired: this.aired.ids,
      headlined: this.headlined,
      dayTopic: this.dayTopic,
      lastFormat: this.lastFormat,
      lastHourlyKey: this.lastHourlyKey,
      hourlyEnabled: this.hourlyEnabled,
      weatherEnabled: hasWeatherPlace(this.place),
    };
  }

  /** Book what was actually played: a story counts as aired only when its full audio ran. */
  record(plan: BreakPlan, played: BreakClip[], now: Date): void {
    for (const clip of played) {
      if (!clip.storyId) continue;
      if (clip.role === 'story') this.aired.add(clip.storyId);
      else if (clip.role === 'headline') this.headlined.add(clip.storyId);
    }
    if (plan.kind === 'hourly') this.lastHourlyKey = hourKey(now);
    else this.lastFormat = plan.kind;
  }
}
