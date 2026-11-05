/**
 * Background audio keep-alive and lock-screen controls for mobile (iOS Safari & Android Chrome).
 *
 * Web Audio contexts alone get suspended by mobile OSes after ~30s of screen-lock.
 * Playing a looped, silent HTML5 <audio> element alongside Web Audio tells the mobile OS
 * that this is an active media playback session, keeping the AudioContext active in the background.
 * MediaSession API gives the listener Play/Pause controls directly on the lock screen / Dynamic Island.
 */

export interface BackgroundAudioControls {
  updateMetadata: (title: string, stationName: string, hostName?: string) => void;
  destroy: () => void;
}

export function initBackgroundAudio(
  onTogglePlay: () => void,
  onSkipNext?: () => void,
): BackgroundAudioControls {
  let silentAudio: HTMLAudioElement | null = null;

  try {
    // 1-second silent stereo WAV encoded inline (base64)
    const silentWav =
      'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
    silentAudio = new Audio(silentWav);
    silentAudio.loop = true;
    silentAudio.volume = 0.01;
    // Play on the first user interaction
    silentAudio.play().catch(() => { /* handled on user tap */ });
  } catch {
    // Fallback if HTMLAudioElement fails
  }

  // Setup MediaSession for lock screen controls
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', onTogglePlay);
      navigator.mediaSession.setActionHandler('pause', onTogglePlay);
      if (onSkipNext) {
        navigator.mediaSession.setActionHandler('nexttrack', onSkipNext);
      }
    } catch {
      // Ignored on platforms without full MediaSession support
    }
  }

  return {
    updateMetadata: (title: string, stationName: string, hostName?: string) => {
      if (!('mediaSession' in navigator)) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist: hostName ? `${stationName} · ${hostName}` : stationName,
          album: 'DOS Radio',
          artwork: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        });
      } catch {
        // Ignored
      }
    },
    destroy: () => {
      if (silentAudio) {
        silentAudio.pause();
        silentAudio.src = '';
        silentAudio = null;
      }
    },
  };
}
