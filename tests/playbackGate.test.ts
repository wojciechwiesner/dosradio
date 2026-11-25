import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEDICATION_GRACE_MS, DEDICATION_MAX_MS, startPlaybackFlow, type AccessLike, type PlaybackGateDeps } from '../src/ui/playbackGate';

function deps(access: AccessLike, pendingDedication: boolean) {
  let greetingCb: ((s: number) => void) | null = null;
  const d = {
    refreshAccess: vi.fn(async () => access),
    startTrial: vi.fn(async () => ({ ...access, trial_started: true })),
    setAccess: vi.fn(),
    hasPendingDedication: vi.fn(() => pendingDedication),
    onceGreetingDone: vi.fn((cb: (s: number) => void) => { greetingCb = cb; }),
    engineStart: vi.fn(async () => {}),
    engineStop: vi.fn(),
    openRegisterPrompt: vi.fn(),
    startTrialCountdown: vi.fn(),
  } satisfies PlaybackGateDeps;
  return { d, finishGreeting: (s: number) => greetingCb?.(s) };
}

const ENDED: AccessLike = { allowed: false, registered: false, trial_started: true };
const FRESH: AccessLike = { allowed: true, registered: false, trial_started: false };

describe('Classic startPlayback gate', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('dedication recipient with the free hour used up still hears the greeting: engine starts, no prompt', async () => {
    const { d } = deps(ENDED, true);
    const outcome = await startPlaybackFlow(d);
    expect(outcome).toBe('dedication-guest');
    expect(d.engineStart).toHaveBeenCalledTimes(1);
    expect(d.openRegisterPrompt).not.toHaveBeenCalled();
    expect(d.startTrial).not.toHaveBeenCalled();
    // The greeting listener is registered before the engine starts (a short greeting may end first).
    expect(d.onceGreetingDone.mock.invocationCallOrder[0]).toBeLessThan(d.engineStart.mock.invocationCallOrder[0]);
  });

  it('soft register prompt comes greeting + ~60 s later, once', async () => {
    const { d, finishGreeting } = deps(ENDED, true);
    await startPlaybackFlow(d);
    finishGreeting(12);
    vi.advanceTimersByTime(DEDICATION_GRACE_MS - 1);
    expect(d.openRegisterPrompt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(d.engineStop).toHaveBeenCalledTimes(1);
    expect(d.openRegisterPrompt).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DEDICATION_MAX_MS);
    expect(d.openRegisterPrompt).toHaveBeenCalledTimes(1);
  });

  it('safety net prompts even when the greeting never reports back', async () => {
    const { d } = deps(ENDED, true);
    await startPlaybackFlow(d);
    vi.advanceTimersByTime(DEDICATION_MAX_MS);
    expect(d.openRegisterPrompt).toHaveBeenCalledTimes(1);
  });

  it('no dedication and no access: register prompt, engine untouched', async () => {
    const { d } = deps(ENDED, false);
    expect(await startPlaybackFlow(d)).toBe('register');
    expect(d.openRegisterPrompt).toHaveBeenCalledTimes(1);
    expect(d.engineStart).not.toHaveBeenCalled();
  });

  it('fresh visitor starts the trial, the countdown and the engine', async () => {
    const { d } = deps(FRESH, false);
    expect(await startPlaybackFlow(d)).toBe('playing');
    expect(d.startTrial).toHaveBeenCalledTimes(1);
    expect(d.setAccess).toHaveBeenCalledWith({ ...FRESH, trial_started: true });
    expect(d.startTrialCountdown).toHaveBeenCalledTimes(1);
    expect(d.engineStart).toHaveBeenCalledTimes(1);
    expect(d.openRegisterPrompt).not.toHaveBeenCalled();
  });
});
