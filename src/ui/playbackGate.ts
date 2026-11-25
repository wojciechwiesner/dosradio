/**
 * Who may press Play and what happens then (Classic AmbiRadio page).
 *
 * Extracted from dosradio.ts so it can be unit tested without the whole page.
 * A recipient opening a shared dedication link always hears the greeting and the music under it,
 * even when their own free hour is used up; the soft register prompt comes after the greeting
 * plus DEDICATION_GRACE_MS. The server backs this with a short dedication pass cookie.
 */

export interface AccessLike {
  allowed: boolean;
  registered: boolean;
  trial_started: boolean;
}

export interface PlaybackGateDeps<A extends AccessLike = AccessLike> {
  refreshAccess(): Promise<A>;
  startTrial(): Promise<A>;
  setAccess(state: A): void;
  hasPendingDedication(): boolean;
  /** One-shot callback when the dedication greeting ended (0 s when it failed). */
  onceGreetingDone(cb: (durationS: number) => void): void;
  engineStart(): Promise<void>;
  engineStop(): void;
  /** Soft register prompt (Classic: openAuth('register', true)). */
  openRegisterPrompt(): void;
  startTrialCountdown(): void;
  setTimer?(cb: () => void, ms: number): unknown;
}

/** Music keeps playing this long after the dedication greeting before the register prompt. */
export const DEDICATION_GRACE_MS = 60_000;
/** Safety net when the greeting never reports back (decode hang): prompt anyway after this. */
export const DEDICATION_MAX_MS = 5 * 60_000;

export type PlaybackOutcome = 'playing' | 'dedication-guest' | 'register';

export async function startPlaybackFlow<A extends AccessLike>(deps: PlaybackGateDeps<A>): Promise<PlaybackOutcome> {
  const setTimer = deps.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  let state = await deps.refreshAccess();

  if (!state.allowed) {
    if (!deps.hasPendingDedication()) {
      deps.openRegisterPrompt();
      return 'register';
    }
    let prompted = false;
    const prompt = () => {
      if (prompted) return;
      prompted = true;
      deps.engineStop();
      deps.openRegisterPrompt();
    };
    // Registered before start(): a short greeting may finish before the music bed is up.
    deps.onceGreetingDone((durationS) => {
      setTimer(prompt, DEDICATION_GRACE_MS + (durationS > 0 ? 0 : 30_000));
    });
    setTimer(prompt, DEDICATION_MAX_MS);
    await deps.engineStart();
    return 'dedication-guest';
  }

  if (!state.registered && !state.trial_started) {
    state = await deps.startTrial();
    deps.setAccess(state);
  }
  deps.startTrialCountdown();
  await deps.engineStart();
  return 'playing';
}
