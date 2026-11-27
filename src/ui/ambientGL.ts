/** Full-screen audio-reactive WebGL background for AmbiRadio Classic. Returns null when WebGL is unavailable. */
import { FRAGMENT_SRC, VERTEX_SRC } from './ambientGL.glsl';
import {
  AudioFeatures,
  HostPresence,
  MIN_FRAME_MS,
  SCENE_ORDER,
  canvasSize,
  needsFrames,
  nextVariant,
  renderScale,
  SceneFader,
  SectionDetector,
  variantForStation,
  type AudioFrame,
  type HostRole,
  type SceneId,
  type SceneKey,
} from './ambientLogic';

export interface AmbientAudioSource {
  getSpectrum(out: Uint8Array<ArrayBuffer>): void;
  getVoiceLevel(): number;
}

export interface AmbientGL {
  /** Mood + per-station look. `stationId` picks the variant so two stations sharing a mood still differ. */
  setScene(scene: SceneId, stationId?: string): void;
  setPlayerState(state: 'idle' | 'loading' | 'playing' | 'paused'): void;
  setHost(speaking: boolean, role: HostRole): void;
  destroy(): void;
}

/** Test and screenshot overrides, exposed as window.__ambiDebug only with ?ambidebug=1. */
export interface AmbiDebug {
  scene: SceneId | null;
  variant: number | null;
  speaking: boolean | null;
  voice: number | null;
  kick: number | null;
  level: number | null;
}

const SPECTRUM_BINS = 256;
const STATIC_TIME_S = 14;
const UNIFORMS = ['r', 't', 'sa', 'sb', 'va', 'vb', 'mx', 'kick', 'level', 'bass', 'voice', 'host', 'shimmer'] as const;
const sceneIndex = (id: SceneId): number => Math.max(0, SCENE_ORDER.indexOf(id));

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

export function createAmbientGL(audio: AmbientAudioSource, onLost?: () => void): AmbientGL | null {
  let canvas: HTMLCanvasElement;
  let gl: WebGLRenderingContext | null = null;
  try {
    canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  if (!gl) return null;
  const program = buildProgram(gl);
  if (!program) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
  const loc = Object.fromEntries(UNIFORMS.map((name) => [name, gl!.getUniformLocation(program, name)])) as Record<
    (typeof UNIFORMS)[number],
    WebGLUniformLocation | null
  >;

  canvas.className = 'ambient-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)');
  const features = new AudioFeatures();
  const host = new HostPresence();
  const spectrum = new Uint8Array(new ArrayBuffer(SPECTRUM_BINS));
  const fader = new SceneFader({ scene: 'focus', variant: 0 });
  const sections = new SectionDetector();
  let variantShifts = 0;
  let playing = false;
  let idleSince = performance.now();
  let clock = STATIC_TIME_S;
  let last = 0;
  let raf = 0;
  let frame: AudioFrame = { bass: 0, kick: 0, level: 0, voice: 0 };
  let forced = false;
  let dead = false;
  let debugSpeaking: boolean | null = null;

  const debug: AmbiDebug = { scene: null, variant: null, speaking: null, voice: null, kick: null, level: null };

  function resize(): void {
    const size = canvasSize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, renderScale(window.innerWidth, coarse.matches));
    canvas.width = size.w;
    canvas.height = size.h;
    gl!.viewport(0, 0, size.w, size.h);
    draw();
  }

  function draw(): void {
    if (dead) return;
    const g = gl!;
    g.uniform2f(loc.r, canvas.width, canvas.height);
    g.uniform1f(loc.t, clock);
    g.uniform1f(loc.sa, sceneIndex(fader.from.scene));
    g.uniform1f(loc.sb, sceneIndex(fader.to.scene));
    g.uniform1f(loc.va, fader.from.variant);
    g.uniform1f(loc.vb, fader.to.variant);
    g.uniform1f(loc.mx, fader.mix);
    g.uniform1f(loc.kick, frame.kick);
    g.uniform1f(loc.level, frame.level);
    g.uniform1f(loc.bass, frame.bass);
    g.uniform1f(loc.voice, frame.voice);
    g.uniform1f(loc.host, host.presence);
    g.uniform1f(loc.shimmer, host.shimmer);
    g.drawArrays(g.TRIANGLES, 0, 3);
  }

  function readAudio(dt: number): void {
    audio.getSpectrum(spectrum);
    frame = features.update(spectrum, audio.getVoiceLevel(), dt);
    if (debug.kick !== null) frame.kick = debug.kick;
    if (debug.level !== null) frame.level = debug.level;
    if (debug.voice !== null) frame.voice = debug.voice;
  }

  function transitioning(): boolean {
    return !fader.settled || !host.settled;
  }

  function tick(now: number): void {
    raf = 0;
    if (dead) return;
    if (now - last < MIN_FRAME_MS) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016);
    last = now;
    clock += dt;
    fader.update(dt);
    host.update(dt);
    readAudio(dt);
    // A breakdown, drop or the next track in the mix: fade to another look of the same mood.
    if (playing && host.presence < 0.01 && !debug.scene && sections.update(frame, dt)) {
      variantShifts += 1;
      const cur = fader.target;
      fader.set({ scene: cur.scene, variant: nextVariant(cur.variant) });
    }
    draw();
    const gate = {
      hidden: document.hidden,
      reduced: motion.matches,
      playing: playing || forced,
      idleMs: now - idleSince,
      transitioning: transitioning(),
    };
    if (needsFrames(gate)) raf = requestAnimationFrame(tick);
  }

  /** Restart the loop (or draw one static frame under reduced motion). */
  function wake(): void {
    if (dead) return;
    if (motion.matches) {
      fader.snap();
      host.snap();
      frame = { bass: 0, kick: 0, level: 0, voice: debug.voice ?? 0 };
      clock = STATIC_TIME_S;
      draw();
      return;
    }
    if (!raf && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  const api: AmbientGL = {
    setScene(scene, stationId) {
      if (debug.scene) return;
      const key: SceneKey = { scene, variant: stationId ? variantForStation(stationId) : fader.target.variant };
      sections.reset();
      fader.set(key);
      wake();
    },
    setPlayerState(state) {
      playing = state === 'playing' || state === 'loading';
      if (!playing) { idleSince = performance.now(); sections.reset(); }
      wake();
    },
    setHost(speaking, role) {
      if (debugSpeaking !== null) return;
      host.setSpeaking(speaking, role);
      if (speaking) sections.reset(); // ducked music under the host is not a section change
      wake();
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.remove();
    },
  };

  function onVisibility(): void {
    if (!document.hidden) wake();
  }

  if (new URLSearchParams(window.location.search).get('ambidebug') === '1') {
    const force = (): void => {
      forced = true;
      idleSince = performance.now();
      wake();
    };
    const exposed = {
      /** Read-only: the last audio frame measured from the real engine output (for E2E checks). */
      get live(): AudioFrame & { presence: number } { return { ...frame, presence: host.presence }; },
      /** Read-only fade state: from/to scene + variant, eased mix, section-driven look changes so far. */
      get fade() {
        return { from: { ...fader.from }, to: { ...fader.to }, mix: fader.mix, settled: fader.settled, variantShifts };
      },
      get scene(): SceneId | null { return debug.scene; },
      set scene(v: SceneId | null) {
        debug.scene = v;
        if (v && SCENE_ORDER.includes(v)) fader.set({ scene: v, variant: debug.variant ?? fader.target.variant });
        force();
      },
      get variant(): number | null { return debug.variant; },
      set variant(v: number | null) {
        debug.variant = v;
        if (v !== null) fader.set({ scene: fader.target.scene, variant: v });
        force();
      },
      get speaking(): boolean | null { return debugSpeaking; },
      set speaking(v: boolean | null) {
        debugSpeaking = v;
        debug.speaking = v;
        host.setSpeaking(!!v, 'host');
        force();
      },
      get voice(): number | null { return debug.voice; },
      set voice(v: number | null) { debug.voice = v; force(); },
      get kick(): number | null { return debug.kick; },
      set kick(v: number | null) { debug.kick = v; force(); },
      get level(): number | null { return debug.level; },
      set level(v: number | null) { debug.level = v; force(); },
    } satisfies AmbiDebug & { readonly live: unknown; readonly fade: unknown };
    (window as unknown as { __ambiDebug: typeof exposed }).__ambiDebug = exposed;
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    api.destroy();
    onLost?.();
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  motion.addEventListener('change', wake);
  resize();
  return api;
}
