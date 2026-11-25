// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { prepareDom, frameState, registry } from './helpers/orbitaSceneHarness';

vi.mock('three', async (orig) => (await import('./helpers/orbitaSceneHarness')).mockThree(await orig()));
vi.mock('three/addons/postprocessing/EffectComposer.js', async () => (await import('./helpers/orbitaSceneHarness')).composerStub());
vi.mock('three/addons/postprocessing/RenderPass.js', async () => (await import('./helpers/orbitaSceneHarness')).renderPassStub());
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', async () => (await import('./helpers/orbitaSceneHarness')).bloomStub());
vi.mock('three/addons/postprocessing/OutputPass.js', async () => (await import('./helpers/orbitaSceneHarness')).outputStub());

async function fieldHostMix(hide3dRings: boolean) {
  prepareDom();
  const { createScene } = await import('../orbita/src/scene.js');
  const scene = createScene(document.createElement('canvas'), {});
  scene.render(frameState({ hide3dRings, hosts: null }), 0.016);
  const field = registry.shaders.find(m => m.uniforms?.uHostMix);
  return field.uniforms.uHostMix.value as number;
}

describe('Chladni background calms in 2.5D corner turntable mode (d919d12)', () => {
  it('raises the field dimming uniform when 3D rings are hidden, with no hosts on air', async () => {
    const full3d = await fieldHostMix(false);
    const mode25d = await fieldHostMix(true);
    expect(mode25d).toBeGreaterThan(full3d);
  });
});
