// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LiveApi, DemoApi } from '../orbita/src/api.js';
import { RadioEngine } from '../orbita/src/engine.js';
import { setLang } from '../orbita/src/i18n.js';

describe('Orbita voice recordings at start & showcase', () => {
  it('builds language-aware intro and nudge WAV URLs on LiveApi', () => {
    const api = new LiveApi();
    setLang('pl');
    expect(api.orbitaIntroUrl('dos-groove', 0)).toBe('/radio-api/orbita/intro/dos-groove/0.wav?lang=pl');
    expect(api.orbitaNudgeUrl('5min', 'dos-groove')).toBe('/radio-api/orbita/nudge/5min.wav?station=dos-groove&lang=pl');

    setLang('en');
    expect(api.orbitaIntroUrl('dos-groove', 2)).toBe('/radio-api/orbita/intro/dos-groove/2.wav?lang=en');
    setLang('pl');

    const demo = new DemoApi();
    expect(demo.orbitaIntroUrl()).toBeNull();
    expect(demo.orbitaNudgeUrl()).toBeNull();
  });

  it('plays Kuba recorded WAV clips during playIntro when live instead of silent caption-only speak', async () => {
    setLang('pl');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) });
    vi.stubGlobal('fetch', fetchMock);

    const api = new LiveApi();
    const playedBuffers: unknown[] = [];
    const hostEvents: Array<{ name?: string; caption?: string } | null> = [];
    const speakSpy = vi.fn();

    const fakeCore = {
      ctx: { decodeAudioData: vi.fn(async () => ({ duration: 1.2 })) },
      duck: vi.fn(),
      playBuffer: vi.fn(async (buf: unknown) => { playedBuffers.push(buf); }),
      speak: speakSpy,
    };

    const engine = new RadioEngine({
      api,
      core: fakeCore as never,
      prefs: { stationObj: { id: 'dos-groove', host: 'Kuba' }, categories: ['ai'], hostMode: 'with-host', duckLevel: 0.34 },
      events: {
        onMode: () => {},
        onState: () => {},
        onStation: () => {},
        onHost: (ev: { name?: string; caption?: string } | null) => { hostEvents.push(ev); },
        onStatus: () => {},
        onNews: () => {},
        onNextBreak: () => {},
        onAired: () => {},
        onTrialEnded: () => {},
        onIntroDone: () => {},
      },
    });
    engine.playing = true;

    await engine.playIntro();

    expect(playedBuffers).toHaveLength(4);
    expect(speakSpy).not.toHaveBeenCalled();
    expect(hostEvents[0]?.name).toBe('Kuba');
    expect(hostEvents[0]?.caption).toContain('Cześć, tu Kuba.');

    const introUrls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(introUrls).toContain('/radio-api/orbita/intro/dos-groove/0.wav?lang=pl');
    expect(introUrls).toContain('/radio-api/orbita/intro/dos-groove/3.wav?lang=pl');
    vi.unstubAllGlobals();
  });

  it('falls back gracefully to caption pacing when audio fetch fails', async () => {
    setLang('pl');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    vi.stubGlobal('fetch', fetchMock);

    const api = new LiveApi();
    const speakSpy = vi.fn(async () => {});
    const fakeCore = {
      ctx: { decodeAudioData: vi.fn() },
      duck: vi.fn(),
      playBuffer: vi.fn(),
      speak: speakSpy,
    };

    const engine = new RadioEngine({
      api,
      core: fakeCore as never,
      prefs: { stationObj: { id: 'dos-groove', host: 'Kuba' }, categories: ['ai'], hostMode: 'with-host', duckLevel: 0.34 },
      events: {
        onMode: () => {},
        onState: () => {},
        onStation: () => {},
        onHost: () => {},
        onStatus: () => {},
        onNews: () => {},
        onNextBreak: () => {},
        onAired: () => {},
        onTrialEnded: () => {},
        onIntroDone: () => {},
      },
    });
    engine.playing = true;

    await engine.playIntro();
    expect(speakSpy).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });
});
