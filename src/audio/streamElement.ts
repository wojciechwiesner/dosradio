/**
 * Plays the station's continuous Ogg stream through a real <audio> element.
 * A genuine media element (not Web Audio alone) is what keeps Chrome on
 * Android alive after the browser is closed; the element feeds the music bus
 * so ducking still applies.
 */

export interface StreamHandle {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  destroy: () => void;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

export function createStreamElement(
  ctx: AudioContext,
  url: string,
  destination: AudioNode,
): StreamHandle {
  const el = new Audio(url);
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  el.setAttribute('playsinline', 'true');

  const source = ctx.createMediaElementSource(el);
  source.connect(destination);

  if (navigator.mediaSession) {
    navigator.mediaSession.playbackState = 'playing';
  }

  return {
    el,
    source,
    destroy: () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
      source.disconnect();
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none';
    },
  };
}
