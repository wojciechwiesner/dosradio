// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { prepareDom } from './helpers/orbitaSceneHarness';

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
const pt = () => ({ x: 0, y: 0, z: 0 } as any);

describe('Orbita label projection (3122f39)', () => {
  it('starts with the camera already at its rig position, not at the origin', async () => {
    const scene = await loadScene();
    // Frame 0 projections used a camera sitting at (0,0,0): labels were mis-projected.
    expect(scene.camera.position.length()).toBeGreaterThan(1);
    expect(scene.camera.position.z).toBeGreaterThan(scene.camera.position.y);
  });

  it('flags a world point behind the camera so its DOM label can be hidden', async () => {
    const scene = await loadScene();
    const dial = scene.satObj(-1); // dial group fallback: a real Object3D in the scene graph
    const cam = scene.camera;
    const forward = new THREE.Vector3(); cam.getWorldDirection(forward);

    dial.parent?.remove(dial);
    dial.position.copy(cam.position).addScaledVector(forward, -6); // behind camera
    const behind = scene.project(dial, pt());
    expect(behind.behind).toBe(true);

    dial.position.copy(cam.position).addScaledVector(forward, 8); // in front of camera
    const front = scene.project(dial, pt());
    expect(front.behind).toBe(false);
    // in-front point on the view axis lands near the viewport centre
    expect(front.x).toBeGreaterThan(0); expect(front.x).toBeLessThan(window.innerWidth);
  });
});
