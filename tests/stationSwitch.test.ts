/**
 * Feedby 2026-11-10: switching a station left the previous stream audible, and a host break
 * restarted the live model while the voice was still speaking (a hard cut mid-mix).
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stationById } from '../src/radio/stations';
import type { HostClips } from '../src/radio/radioApi';

class FakeAudioParam {
  value = 1;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
}

function fakeNode() {
  return { connect: vi.fn(), disconnect: vi.fn(), gain: new FakeAudioParam() };
}

const elements: FakeAudio[] = [];
const mediaSources: { connected: boolean }[] = [];
const sources: { started: boolean }[] = [];
let clips: HostClips = { jingles: [], chatter: [] };

class FakeAudio {
  src: string;
  paused = true;
  preload = '';
  crossOrigin: string | null = null;
  constructor(src?: string) {
    this.src = src ?? '';
    elements.push(this);
  }
  setAttribute = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  pause = vi.fn(() => { this.paused = true; });
  play() { this.paused = false; return Promise.resolve(); }
  addEventListener = vi.fn();
}

function installDom() {
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('navigator', { userAgent: 'vitest', maxTouchPoints: 0, mediaSession: { playbackState: 'none' } });
  vi.stubGlobal('AudioContext', class {
    currentTime = 0;
    sampleRate = 48000;
    destination = {};
    state = 'running';
    resume = vi.fn(async () => {});
    createGain() { return fakeNode(); }
    createDynamicsCompressor() { return { ...fakeNode(), threshold: { value: 0 }, ratio: { value: 1 } }; }
    createAnalyser() {
      return { ...fakeNode(), fftSize: 0, smoothingTimeConstant: 0, getFloatFrequencyData: vi.fn(), getFloatTimeDomainData: vi.fn() };
    }
    createChannelSplitter() { return fakeNode(); }
    createBiquadFilter() { return { ...fakeNode(), type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: new FakeAudioParam() }; }
    createBufferSource() {
      const source = { started: false, connect: vi.fn(), buffer: null as unknown, onended: null as (() => void) | null, start() { this.started = true; sources.push(this); queueMicrotask(() => this.onended?.()); } };
      return source;
    }
    createMediaElementSource() {
      const node = { connected: true, connect: vi.fn(), disconnect: vi.fn(() => { node.connected = false; }) };
      mediaSources.push(node);
      return node;
    }
    decodeAudioData = vi.fn(async () => ({ duration: 1 }));
  });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/host-clips/')) return { ok: true, json: async () => clips, arrayBuffer: async () => new ArrayBuffer(8) };
    return { ok: true, json: async () => ({ categories: [] }), arrayBuffer: async () => new ArrayBuffer(8) };
  }));
}

beforeEach(() => {
  elements.length = 0;
  mediaSources.length = 0;
  sources.length = 0;
  clips = { jingles: [], chatter: [] };
  installDom();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function engine() {
  const { PublicRadioEngine } = await import('../src/radio/publicRadioEngine');
  const created = new PublicRadioEngine(stationById('dos-groove'), [], {
    onState: () => {}, onStatus: () => {}, onError: () => {}, onQueue: () => {},
    onOnAir: () => {}, onNextBreak: () => {}, onTrialEnded: () => {}, onLevel: () => {},
  });
  await created.start();
  return created;
}

describe('station switch (feedby: previous music kept playing)', () => {
  it('tears the previous stream down once the new station is playing', async () => {
    const radio = await engine();
    expect(elements.filter((el) => !el.paused)).toHaveLength(1);

    await radio.setStation(stationById('lofi-nauka'));

    const live = elements.filter((el) => !el.paused);
    expect(live).toHaveLength(1);
    expect(live[0].src).toContain('/station/lofi-nauka/stream.ogg');
    expect(mediaSources.filter((node) => node.connected)).toHaveLength(1);
  });

  it('keeps the current stream when the new one refuses to play', async () => {
    const radio = await engine();
    const original = elements[0];
    let rejected = 0;
    FakeAudio.prototype.play = async function (this: FakeAudio) {
      if (this.src.includes('micro-house')) { rejected += 1; throw new Error('autoplay blocked'); }
      this.paused = false;
    };

    await radio.setStation(stationById('micro-house'));

    expect(rejected).toBeGreaterThan(0);
    const live = elements.filter((el) => !el.paused);
    expect(live).toHaveLength(1);
    expect(live[0].src).toContain('/station/dos-groove/stream.ogg');
    expect(mediaSources.filter((node) => node.connected)).toHaveLength(1);
    expect(original).toBe(live[0]);
  });
});

describe('separate volumes (feedby: one knob for everything)', () => {
  it('keeps music, voice and ducked music on three independent gains', async () => {
    const radio = await engine();
    const guts = radio as unknown as { master: { gain: { value: number } }; voiceGain: { gain: { value: number } }; musicBus: { gain: { value: number } } };

    radio.setVolume(0.2);
    radio.setVoiceVolume(0.8);
    radio.setDuckLevel(0.5);

    expect(guts.master.gain.value).toBeCloseTo(0.2);
    expect(guts.voiceGain.gain.value).toBeCloseTo(0.8 * 0.4);
    expect(guts.musicBus.gain.value).toBeCloseTo(1);

    guts.musicBus.gain.value = 1;
    radio.setDuckLevel(0.15);
    expect(guts.musicBus.gain.value).toBeCloseTo(1);
  });
});


describe('host break (feedby: model reset cut the mix)', () => {
  it('ducks the live music under the voice instead of restarting it', async () => {
    const radio = await engine();
    const helper = { stop: vi.fn(), pause: vi.fn(), play: vi.fn(async () => {}), resetContext: vi.fn(async () => {}), duck: vi.fn() };
    const guts = radio as unknown as { chunkStreamer: unknown; streamHandle: unknown; helper: unknown; firstBreakDelayMs: number };
    guts.chunkStreamer = null;
    guts.streamHandle = null;
    guts.helper = helper;
    guts.firstBreakDelayMs = 1_000;
    clips = { jingles: [], chatter: ['/radio-api/host/kuba.wav'] };

    await vi.advanceTimersByTimeAsync(2_000);

    expect(helper.stop).not.toHaveBeenCalled();
    expect(helper.play).not.toHaveBeenCalled();
    expect(helper.resetContext).not.toHaveBeenCalled();
    expect(sources.length).toBeGreaterThan(0);
  });
});
