// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const LIMIT_TEXT = 'Darmowy Plus: 1 podcast dziennie. Kolejny jutro albo wykup Plus.';

vi.mock('../src/ui/pill', () => ({ initPill: vi.fn() }));
vi.mock('../src/audio/iosAudioUnlock', () => ({ getSharedAudioContext: () => ({ currentTime: 0, state: 'running' }) }));

describe('daily podcast limit (HTTP 429)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="podcastBtn"></button>
      <form id="plusPrefsForm"></form>
      <form id="podcastForm"><input id="podcastTopic" value="Sen"></form>
      <button id="plusDigestPlay"></button>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: LIMIT_TEXT, reset_at: 1_800_000_000 }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    )));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('radioApi.podcast rejects with the server message', async () => {
    const { radioApi } = await import('../src/radio/radioApi');
    await expect(radioApi.podcast('Sen')).rejects.toThrow(LIMIT_TEXT);
  });

  it('the Plus panel shows the 429 message in its status area and re-enables the button', async () => {
    const { initPlus } = await import('../src/ui/plus');
    const onStatus = vi.fn();
    initPlus({ onStatus, stopRadio: vi.fn(), enqueuePill: vi.fn() });
    document.getElementById('podcastForm')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith(LIMIT_TEXT, true));
    expect((document.getElementById('podcastBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(onStatus.mock.calls.some(([text]) => /Dogrywamy/.test(String(text)))).toBe(false);
  });
});
