// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { prepareDom, frameState, registry } from './helpers/orbitaSceneHarness';
// @ts-expect-error plain JS module shared with the Orbita bundle
import { openQuickShareSheet } from '../orbita/src/shareSheet.js';

vi.mock('three', async (orig) => (await import('./helpers/orbitaSceneHarness')).mockThree(await orig()));
vi.mock('three/addons/postprocessing/EffectComposer.js', async () => (await import('./helpers/orbitaSceneHarness')).composerStub());
vi.mock('three/addons/postprocessing/RenderPass.js', async () => (await import('./helpers/orbitaSceneHarness')).renderPassStub());
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', async () => (await import('./helpers/orbitaSceneHarness')).bloomStub());
vi.mock('three/addons/postprocessing/OutputPass.js', async () => (await import('./helpers/orbitaSceneHarness')).outputStub());

describe('voice greeting CTA stacks full-width in the quick share sheet (c4b0909)', () => {
  it('puts message input and submit button directly in the form, not side by side in a row', () => {
    openQuickShareSheet({ title: 'T', subtitle: 's', url: 'https://x.test/a', text: 't', onCreateGreetingUrl: async () => null });
    const form = document.getElementById('qsGreetForm') as HTMLFormElement;
    expect(form).toBeTruthy();
    const msg = form.querySelector('input[name="msg"]') as HTMLElement;
    const submit = form.querySelector('button[type="submit"]') as HTMLElement;
    expect(msg.parentElement).toBe(form);
    expect(submit.parentElement).toBe(form);
    // no wrapper that would put input and button in one narrow row
    expect([...form.children].some(c => c !== msg && c.contains(msg) && c.contains(submit))).toBe(false);
  });
});

/** Speaker group = the only scene group whose placement depends on hide3dRings. */
async function speakerPlacement(hide3dRings: boolean, leftHand: boolean) {
  prepareDom();
  const { createScene } = await import('../orbita/src/scene.js');
  const scene = createScene(document.createElement('canvas'), {});
  const groups = [...registry.groups];
  scene.render(frameState({ hide3dRings, leftHand }), 0.016);
  return groups.map(g => ({ x: g.position.x, y: g.position.y, s: g.scale.x }));
}

describe('WebGL speaker core moves into the open corner in 2.5D mode (c4b0909)', () => {
  it('offsets, shrinks and mirrors the speaker by handedness only when 3D rings are hidden', async () => {
    const normal = await speakerPlacement(false, false);
    const rightHand = await speakerPlacement(true, false);
    const leftHand = await speakerPlacement(true, true);
    const idx = normal.findIndex((n, i) => Math.abs(rightHand[i].x - n.x) > 0.3);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(Math.abs(normal[idx].x)).toBeLessThan(0.01);          // centred normally
    expect(rightHand[idx].s).toBeLessThan(normal[idx].s);        // smaller in 2.5D
    expect(Math.sign(rightHand[idx].x)).toBe(-Math.sign(leftHand[idx].x)); // mirrored
    expect(rightHand[idx].x * leftHand[idx].x).toBeLessThan(0);
  });
});
