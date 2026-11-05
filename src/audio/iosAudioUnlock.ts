/**
 * iOS / iPadOS audio unlock.
 *
 * Why the iPad was silent:
 *  1. WebKit only lets an AudioContext leave the "suspended" state when
 *     resume() is called synchronously inside a user gesture. Our contexts
 *     are created after awaits (API key modal, worklet addModule), so the
 *     gesture is already consumed and resume() silently does nothing.
 *  2. With the hardware ring/silent switch on, Web Audio is routed to the
 *     "ambient" session and muted. Playing a media element, or setting
 *     navigator.audioSession.type = 'playback' (Safari 16.4+), moves the
 *     page to the playback category, which ignores the silent switch.
 *
 * Fix: install once at page load. On every early gesture we resume every
 * known context synchronously, play a 1-sample silent buffer (the classic
 * WebKit unlock), and start a silent looping <audio> element so the session
 * category is "playback".
 */

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

const trackedContexts = new Set<AudioContext>();
let installed = false;
let mediaUnlocked = false;

/** Register a context so the next user gesture resumes it. */
export function trackAudioContext(ctx: AudioContext): AudioContext {
  trackedContexts.add(ctx);
  return ctx;
}

/** 0.1 s of silent 8 kHz mono PCM WAV, built at runtime (no asset needed). */
function silentWavUrl(): string {
  const sampleRate = 8000;
  const samples = 800;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

let silentElement: HTMLAudioElement | null = null;

function unlockMediaSession(): void {
  const session = (navigator as AudioSessionNavigator).audioSession;
  if (session && session.type !== 'playback') {
    try { session.type = 'playback'; } catch { /* older WebKit */ }
  }
  if (mediaUnlocked) return;
  if (!silentElement) {
    silentElement = document.createElement('audio');
    silentElement.setAttribute('playsinline', '');
    silentElement.setAttribute('x-webkit-airplay', 'deny');
    silentElement.loop = true;
    silentElement.src = silentWavUrl();
  }
  silentElement.play().then(() => { mediaUnlocked = true; }).catch(() => { /* retried on next gesture */ });
}

function kickContext(ctx: AudioContext): void {
  if (ctx.state === 'closed') { trackedContexts.delete(ctx); return; }
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  // A one-sample buffer played inside the gesture is what actually unlocks WebKit.
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
}

let sharedContext: AudioContext | null = null;

/**
 * The single 48 kHz context used by the Lyria host. Created lazily; when the
 * first creation happens inside a gesture (see onGesture) it starts running.
 */
export function getSharedAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = trackAudioContext(new Ctor({ sampleRate: 48000, latencyHint: 'playback' }));
  }
  return sharedContext;
}

/** Set an existing AudioContext (e.g. from KKiK) as the shared host context. */
export function setSharedAudioContext(ctx: AudioContext): AudioContext {
  sharedContext = trackAudioContext(ctx);
  return sharedContext;
}

function onGesture(): void {
  unlockMediaSession();
  // Create the shared context synchronously inside the gesture so WebKit lets it run.
  getSharedAudioContext();
  if ((window as any).vaybeHost) trackedContexts.add((window as any).vaybeHost.context);
  trackedContexts.forEach(kickContext);
}

/** Install gesture listeners once. Safe to call from every page entry point. */
export function installIosAudioUnlock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const events = ['pointerdown', 'touchend', 'click', 'keydown'];
  events.forEach((name) => window.addEventListener(name, onGesture, { capture: true, passive: true }));
  // iOS suspends contexts when the tab goes to background; re-kick on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trackedContexts.forEach((ctx) => {
      if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    });
  });
}

/** Autocheck spot for the health panel / tests. */
export function audioUnlockStatus(): { contexts: string[]; mediaUnlocked: boolean } {
  return { contexts: [...trackedContexts].map((ctx) => ctx.state), mediaUnlocked };
}
