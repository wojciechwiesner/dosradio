// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { prepareDom, frameState } from './helpers/orbitaSceneHarness';

vi.mock('three', async (orig) => (await import('./helpers/orbitaSceneHarness')).mockThree(await orig()));
vi.mock('three/addons/postprocessing/EffectComposer.js', async () => (await import('./helpers/orbitaSceneHarness')).composerStub());
vi.mock('three/addons/postprocessing/RenderPass.js', async () => (await import('./helpers/orbitaSceneHarness')).renderPassStub());
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', async () => (await import('./helpers/orbitaSceneHarness')).bloomStub());
vi.mock('three/addons/postprocessing/OutputPass.js', async () => (await import('./helpers/orbitaSceneHarness')).outputStub());

async function loadScene() {
  prepareDom();
  const { createScene } = await import('../orbita/src/scene.js');
  return createScene(document.createElement('canvas'), {});
}

/** The three concentric ring outlines live as Line children of the dial's parent group. */
function ringOutlines(scene: any): any[] {
  const ring = scene.satObj(-1).parent;
  return ring.children.filter((c: any) => c.isLine && !c.isLineSegments);
}
const rgb = (l: any) => l.material.color.toArray().map((v: number) => +v.toFixed(4));

function run(scene: any, cat: string, frames = 40) {
  for (let i = 0; i < frames; i++) scene.render(frameState({ station: { cat } }), 0.1);
}

describe('Orbita updatePalette ring tinting (81e9a22)', () => {
  it('renders frames without touching a stale ringMat reference', async () => {
    const scene = await loadScene();
    expect(() => run(scene, 'chill', 3)).not.toThrow();
  });

  it('tints each of the 3 ring outlines individually and follows the station palette', async () => {
    const scene = await loadScene();
    const lines = ringOutlines(scene);
    expect(lines).toHaveLength(3);

    run(scene, 'chill');
    const chill = lines.map(rgb);
    // Per-ring tint: the three rings keep distinct colours.
    expect(new Set(chill.map(c => c.join())).size).toBe(3);

    run(scene, 'energia');
    const energia = lines.map(rgb);
    // Palette-driven: switching category recolours every ring.
    lines.forEach((_, i) => expect(energia[i]).not.toEqual(chill[i]));
  });
});
