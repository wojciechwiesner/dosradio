// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DemoApi } from '../orbita/src/api.js';
import { RadioEngine } from '../orbita/src/engine.js';
import { setLang } from '../orbita/src/i18n.js';

function makeEngine(speak: (...args: unknown[]) => Promise<void>) {
  const core = {
    ctx: { decodeAudioData: vi.fn() },
    duck: vi.fn(),
    playBuffer: vi.fn(async () => {}),
    speak,
  };
  const noop = () => {};
  const engine = new RadioEngine({
    api: new DemoApi(),
    core: core as never,
    prefs: { stationObj: { id: 'dos-groove', host: 'Kuba' }, categories: ['ai'], hostMode: 'with-host', duckLevel: 0.34 },
    events: new Proxy({}, { get: () => noop }) as never,
  });
  engine.playing = true;
  return engine;
}

describe('Orbita dedication intro', () => {
  it('reads the dedication instead of throwing on an undefined kind', async () => {
    setLang('pl');
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const engine = makeEngine(speak);
    const say = vi.spyOn(engine, 'say').mockResolvedValue(undefined as never);

    const run = engine.playDedicationIntro({ script: 'Dla Ani od Tomka', host_name: 'Kuba' });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(run).resolves.toBeUndefined();

    expect(say).toHaveBeenCalledTimes(1);
    const [part, opts] = say.mock.calls[0] as [{ text: string }, { kind: string; hosts: string[] }];
    expect(part.text).toBe('Dla Ani od Tomka');
    expect(opts.kind).toBe('dedication');
    expect(opts.hosts).toEqual(['Kuba']);
    vi.useRealTimers();
  });
});
