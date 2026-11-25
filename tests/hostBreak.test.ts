import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostClipPlayer } from '../src/radio/hostClipPlayer';

function stubFetch(breakBody: unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('/host-break/')) return { ok: true, json: async () => breakBody };
    return { ok: true, json: async () => ({ jingles: ['/j0.wav'], chatter: ['/c0.wav'] }) };
  }));
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live host breaks (listener comments on air, persona links)', () => {
  it('prefers the live break once, then falls back to static clips', async () => {
    stubFetch({ break: { id: 'b1', kind: 'comment', text: 'Ania pisze...', url: '/radio-api/host-break/dos-groove/b1.wav', comment: null } });
    const player = new HostClipPlayer({ stationId: () => 'dos-groove', canPlay: () => true, play: async () => {} }, () => 0);
    expect(await player.freshLiveUrl('dos-groove')).toBe('/radio-api/host-break/dos-groove/b1.wav');
    expect(await player.freshLiveUrl('dos-groove')).toBeNull(); // same break is not replayed to the same listener
  });

  it('plays the live break on the next tick and static clips when the server has none', async () => {
    vi.useFakeTimers();
    stubFetch({ break: null });
    const played: string[] = [];
    const player = new HostClipPlayer({ stationId: () => 'dos-groove', canPlay: () => true, play: async (u) => { played.push(u); } }, () => 0);
    player.soon(1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(played).toEqual(['/j0.wav']);
    player.stop();
  });
});
