// Shared harness for running the REAL orbita/src/scene.js under jsdom.
// Only the WebGL context boundary is stubbed (renderer + post-processing passes);
// three.js math, scene graph and all of scene.js logic stay real.
// Usage in a test file (vi.mock calls must live in the test file itself):
//   vi.mock('three', async (orig) => (await import('./helpers/orbitaSceneHarness')).mockThree(await orig()));
//   vi.mock('three/addons/postprocessing/EffectComposer.js', async () => (await import('./helpers/orbitaSceneHarness')).composerStub());
//   ... same for RenderPass, UnrealBloomPass, OutputPass.

export const registry: { shaders: any[]; groups: any[] } = { shaders: [], groups: [] };

class FakeRenderer {
  domElement: unknown;
  toneMapping = 0;
  constructor(opts: { canvas?: unknown } = {}) { this.domElement = opts.canvas; }
  setPixelRatio() {} setSize() {} setClearColor() {} setRenderTarget() {} render() {} clear() {}
}

export function mockThree(actual: any) {
  class SpyShaderMaterial extends actual.ShaderMaterial {
    constructor(p?: unknown) { super(p); registry.shaders.push(this); }
  }
  class SpyGroup extends actual.Group {
    constructor() { super(); registry.groups.push(this); }
  }
  return { ...actual, WebGLRenderer: FakeRenderer, ShaderMaterial: SpyShaderMaterial, Group: SpyGroup };
}

class NoopPass { uniforms: Record<string, any> = {}; resolution = { set() {} }; strength = 0; }

export function composerStub() {
  return { EffectComposer: class { addPass() {} setPixelRatio() {} setSize() {} render() {} } };
}
export function renderPassStub() { return { RenderPass: NoopPass }; }
export function bloomStub() { return { UnrealBloomPass: NoopPass }; }
export function outputStub() { return { OutputPass: NoopPass }; }

/** Minimal valid per-frame state accepted by scene.render(). */
export function frameState(over: Record<string, unknown> = {}) {
  return {
    f: { level: 0.5, low: 0.4, mid: 0.4, high: 0.3, centroid: 0.32, voice: 0 },
    kick: 0, timeScale: 1, playing: true,
    pointer: { nx: 0, ny: 0, x: 0, y: 0, dx: 0, dy: 0, inside: false },
    station: { cat: 'x' }, tunedIdx: 0, blendIdx: -1, needleIdx: -1,
    interval: 10, topics: [], phi: 0, ringFilter: 'all',
    hosts: null, hide3dRings: false, leftHand: false,
    ...over,
  };
}

/** Prepare jsdom globals scene.js reads at import time; call BEFORE importing scene.js. */
export function prepareDom(width = 390, height = 844) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  registry.shaders.length = 0; registry.groups.length = 0;
}
