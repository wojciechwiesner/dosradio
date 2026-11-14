import { describe, expect, it, vi } from 'vitest';
import { createStreamElement } from '../src/audio/streamElement';

function fakeContext(): AudioContext {
  const ctx = {
    createMediaElementSource: vi.fn((el: HTMLAudioElement) => ({
      mediaElement: el,
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  };
  return ctx as unknown as AudioContext;
}

describe('createStreamElement', () => {
  it('plays the stream url through the destination node', () => {
    vi.stubGlobal('Audio', class {
      preload = '';
      crossOrigin: string | null = null;
      src = '';
      constructor(public url: string) { this.src = url; }
      setAttribute(): void { /* playsinline */ }
      pause(): void { /* stopped */ }
      load(): void { /* reloaded */ }
      removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
      addEventListener(): void { /* unused here */ }
    });
    const ctx = fakeContext();
    const destination = {} as AudioNode;
    const handle = createStreamElement(ctx, '/radio-api/station/dos-groove/stream.ogg', destination);

    expect(handle.el.src).toContain('/radio-api/station/dos-groove/stream.ogg');
    expect(handle.el.preload).toBe('auto');
    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(handle.el);
    expect(handle.source.connect).toHaveBeenCalledWith(destination);

    handle.destroy();
    expect(handle.source.disconnect).toHaveBeenCalled();
    expect(handle.el.src).toBe('');
  });
});
