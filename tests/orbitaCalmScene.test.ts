// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { prepareDom, frameState } from './helpers/orbitaSceneHarness';

vi.mock('three', async (orig) => (await import('./helpers/orbitaSceneHarness')).mockThree(await orig()));
vi.mock('three/addons/postprocessing/EffectComposer.js', async () => (await import('./helpers/orbitaSceneHarness')).composerStub());
vi.mock('three/addons/postprocessing/RenderPass.js', async () => (await import('./helpers/orbitaSceneHarness')).renderPassStub());
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', async () => (await import('./helpers/orbitaSceneHarness')).bloomStub());
vi.mock('three/addons/postprocessing/OutputPass.js', async () => (await import('./helpers/orbitaSceneHarness')).outputStub());

async function loadScene(cb = {}) {
  prepareDom(1440, 900);
  const { createScene } = await import('../orbita/src/scene.js');
  return createScene(document.createElement('canvas'), cb);
}
const busy = (calm: boolean, i: number) => frameState({
  calm, kick: i % 8 === 0 ? 1 : 0,
  pointer: { nx: Math.sin(i) , ny: Math.cos(i), x: 0.5, y: 0.5, dx: 0.05, dy: 0.05, inside: true },
});

describe('Orbita calm view (prefers-reduced-motion or the M toggle)', () => {
  it('keeps the camera still under pointer movement and kicks', async () => {
    const scene = await loadScene();
    const start = scene.camera.position.clone();
    for (let i = 0; i < 120; i++) scene.render(busy(true, i), 1 / 60);
    expect(scene.camera.position.distanceTo(start)).toBeLessThan(1e-6);
  });

  it('moves the camera slowly (capped speed) outside calm view', async () => {
    const scene = await loadScene();
    let prev = scene.camera.position.clone(), worst = 0;
    for (let i = 0; i < 120; i++) {
      scene.render(busy(false, i), 1 / 60);
      worst = Math.max(worst, scene.camera.position.distanceTo(prev) * 60); prev = scene.camera.position.clone();
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(1.2 + 1e-6); // world units per second
  });

  it('turns off chromatic aberration in calm view', async () => {
    const scene = await loadScene();
    scene.render(busy(true, 0), 1 / 60);
    expect(scene.post().ca).toBe(0);
    scene.render(busy(false, 0), 1 / 60);
    expect(scene.post().ca).toBeGreaterThan(0);
  });
});

describe('Orbita quality reporting', () => {
  it('reports its tier to the page and never exceeds dpr 2', async () => {
    const seen: string[] = [];
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    const scene = await loadScene({ onQuality: (q: string) => seen.push(q) });
    expect(seen.length).toBeGreaterThan(0);
    expect(scene.quality().dpr).toBeLessThanOrEqual(2);
  });
});

describe('Orbita quality governor in calm view', () => {
  it('does not mistake the deliberate 30 fps of calm view for a slow GPU', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const scene = await loadScene();
    const before = scene.quality().tier;
    expect(before).not.toBe('low');
    for (let i = 0; i < 400; i++) scene.render(frameState({ calm: true }), 1 / 30);
    expect(scene.quality().tier).toBe(before);
  });
});

describe('Orbita quality governor on a very slow device', () => {
  it('steps down using the real frame time, not the clamped animation dt', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const scene = await loadScene();
    const before = scene.quality().tier;
    for (let i = 0; i < 8; i++) scene.render(frameState({ frameDt: 1 }), 1 / 20);
    expect(scene.quality().tier).not.toBe(before);
  });
});
