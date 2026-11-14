/* WebGL scene: dithered speaker + talking hosts, station dial, topic moons, warp streaks, fluid, music-driven palette */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { STATIONS, N, CATS, TOPIC_IDS } from './data.js';

const C = h => new THREE.Color(h);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
import { todPalette, stationSymmetry } from './tod.js';

export const STEP = Math.PI * 2 / N;

export function createScene(canvas, cb) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.setClearColor(0x07060a, 1);
  let dpr = Math.min(devicePixelRatio || 1, 1.75);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const camBase = new THREE.Vector3(0, 3.0, 13), lookAt = new THREE.Vector3(0, -1.1, 0);
  const bgScene = new THREE.Scene(), coreScene = new THREE.Scene();

  /* ---------- fluid (velocity rg, density b), one pass ---------- */
  const FW = 192; let FH = 108;
  const rtO = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  let fA = new THREE.WebGLRenderTarget(FW, FH, rtO), fB = new THREE.WebGLRenderTarget(FW, FH, rtO);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fluidMat = new THREE.ShaderMaterial({
    uniforms: { uPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uPointer: { value: new THREE.Vector2(-9, -9) }, uForce: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uDt: { value: 1 / 60 }, uKick: { value: 0 }, uTime: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.56) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `precision highp float;
      uniform sampler2D uPrev; uniform vec2 uTexel, uPointer, uForce, uCenter; uniform float uAspect, uDt, uKick, uTime; varying vec2 vUv;
      void main(){
        vec2 vel = texture2D(uPrev, vUv).xy;
        vec2 back = vUv - vel * uDt * vec2(1.0/uAspect, 1.0) * 0.6;
        vec4 adv = texture2D(uPrev, back);
        vec4 nb = texture2D(uPrev, back + vec2(uTexel.x,0.)) + texture2D(uPrev, back - vec2(uTexel.x,0.)) + texture2D(uPrev, back + vec2(0.,uTexel.y)) + texture2D(uPrev, back - vec2(0.,uTexel.y));
        vec4 s = mix(adv, nb * 0.25, 0.3);
        vec2 d = vUv - uPointer; d.x *= uAspect; float g = exp(-dot(d,d) / 0.0018);
        s.xy += uForce * g; s.z += min(length(uForce), 3.0) * g * 0.9;
        vec2 dc = vUv - uCenter; dc.x *= uAspect; float rc = length(dc);
        s.xy += (dc / max(rc, 1e-4)) * uKick * 0.9 * exp(-pow((rc - 0.2) / 0.05, 2.0));
        float sw = sin(vUv.y * 9.0 + uTime * 0.35) * cos(vUv.x * 7.0 - uTime * 0.27);
        s.xy += vec2(-dc.y, dc.x) * sw * 0.01;
        s.xy *= 0.968; s.z *= 0.955;
        gl_FragColor = vec4(clamp(s.xy, -3., 3.), clamp(s.z, 0., 2.), 1.);
      }`,
    depthTest: false, depthWrite: false,
  });
  const fluidScene = new THREE.Scene(); fluidScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fluidMat));

  /* ---------- shared lit material for the low-res core buffer: r = lum, g = rim, b = 1 for hosts ---------- */
  const litFrag = `precision highp float; uniform vec3 uLight; uniform float uGlow, uFlag; varying vec3 vN; varying vec3 vView; varying float vR;
    void main(){ vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 V = normalize(-vView);
      float diff = max(dot(N, uLight), 0.0), spec = pow(max(dot(reflect(-uLight, N), V), 0.0), 22.0), fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
      float groove = (uFlag < 0.5 && vR > 0.6 && vR < 1.72) ? 0.72 + 0.28 * step(0.5, fract(vR * 4.5)) : 1.0;
      float lum = 0.06 + diff * 0.8 * groove + spec * 0.55 + uGlow;
      gl_FragColor = vec4(clamp(lum, 0., 1.), fres, uFlag > 0.5 ? 1.0 : vR / 2.6, 1.0); }`;
  const light = new THREE.Vector3(-0.65, 0.62, 0.42).normalize();

  /* speaker */
  const prof = []; const P = (r, h) => prof.push(new THREE.Vector2(r, h));
  for (let i = 0; i <= 10; i++) { const r = i / 10 * 0.55; P(r, -0.62 + 0.3 * Math.cos(r / 0.55 * Math.PI / 2)); }
  for (let i = 1; i <= 22; i++) { const r = 0.55 + i / 22 * 1.2; P(r, -0.62 + (r - 0.55) / 1.2 * 0.62); }
  for (let i = 1; i <= 12; i++) { const r = 1.75 + i / 12 * 0.42; P(r, 0.13 * Math.sin(Math.PI * (r - 1.75) / 0.42)); }
  P(2.25, 0.02); P(2.55, 0.02); P(2.58, -0.05); P(2.6, -0.3);
  const spGeo = new THREE.LatheGeometry(prof, 128); spGeo.rotateX(Math.PI / 2);
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { uPump: { value: 0 }, uEnergy: { value: 0.4 }, uPhase: { value: 0 }, uLight: { value: light }, uGlow: { value: 0 }, uFlag: { value: 0 } },
    vertexShader: `uniform float uPump, uEnergy, uPhase; varying vec3 vN; varying vec3 vView; varying float vR;
      void main(){ vec3 p = position; float r = length(p.xy);
        float cone = smoothstep(2.2, 1.65, r), band = smoothstep(0.5, 0.8, r) * smoothstep(1.8, 1.35, r);
        p.z += uPump * 0.34 * cone + sin(r * 9.0 - uPhase) * 0.04 * uEnergy * band;
        vec3 n = normal; float dw = cos(r * 9.0 - uPhase) * 0.36 * uEnergy * band; vec2 dir = r > 0.001 ? p.xy / r : vec2(0.);
        n.xy -= dir * dw * 0.7; n = normalize(n);
        vN = normalize(normalMatrix * n); vec4 mv = modelViewMatrix * vec4(p, 1.); vView = mv.xyz; vR = r; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: litFrag, side: THREE.DoubleSide,
  });
  const speaker = new THREE.Mesh(spGeo, coreMat);
  const speakerGroup = new THREE.Group(); speakerGroup.add(speaker); coreScene.add(speakerGroup);

  /* hosts: abstract voice forms, no faces. A = a breathing orb inside gyroscope rings, B = a crystal with orbiting rings. */
  const plainVert = `varying vec3 vN; varying vec3 vView; varying float vR;
    void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.); vView = mv.xyz; vR = 0.0; gl_Position = projectionMatrix * mv; }`;
  const orbVert = `varying vec3 vN; varying vec3 vView; varying float vR; uniform float uAmp, uTime;
    void main(){ vec3 p = position;
      float d = (sin(p.x * 4.3 + uTime * 1.9) + sin(p.y * 5.1 - uTime * 1.6) + sin(p.z * 3.7 + uTime * 2.2)) * 0.3333;
      p += normal * d * uAmp;
      vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(p, 1.); vView = mv.xyz; vR = 0.0; gl_Position = projectionMatrix * mv; }`;
  function makeHost(style) {
    const glow = { value: 0 }, amp = { value: 0.03 }, tm = { value: 0 };
    const orbMat = new THREE.ShaderMaterial({ uniforms: { uLight: { value: light }, uGlow: glow, uFlag: { value: 1 }, uAmp: amp, uTime: tm }, vertexShader: orbVert, fragmentShader: litFrag, side: THREE.DoubleSide });
    const solidMat = new THREE.ShaderMaterial({ uniforms: { uLight: { value: light }, uGlow: glow, uFlag: { value: 1 } }, vertexShader: plainVert, fragmentShader: litFrag, side: THREE.DoubleSide });
    const g = new THREE.Group(), head = new THREE.Group(), jaw = new THREE.Group();
    head.position.set(0, 0.2, 0); g.add(head); head.add(jaw);
    const ring = (r, tube, rx, ry) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 96), solidMat); m.rotation.set(rx, ry, 0); head.add(m); return m; };
    let tick;
    if (style === 'B') {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.64, 0), solidMat); head.add(crystal);
      const r1 = ring(1.0, 0.04, 1.25, 0), r2 = ring(0.8, 0.032, 0.35, 1.2);
      tick = (mouth, t, talking, dt) => {
        crystal.rotation.y += dt * (0.35 + mouth * 2.2); crystal.rotation.x = 0.35 + Math.sin(t * 0.7) * 0.12; crystal.scale.setScalar(1 + mouth * 0.22);
        r1.rotation.z += dt * (0.4 + mouth * 3); r2.rotation.z -= dt * (0.55 + mouth * 3.4);
      };
    } else {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 5), orbMat); head.add(orb);
      const rs = [ring(1.0, 0.04, 0, 0), ring(0.86, 0.034, 1.05, 0.5), ring(1.12, 0.03, 0.55, 2.1)];
      tick = (mouth, t, talking, dt) => {
        tm.value = t; amp.value += ((0.03 + mouth * 0.22) - amp.value) * Math.min(1, dt * 10);
        orb.scale.setScalar(1 + mouth * 0.12);
        rs.forEach((r, i) => { r.rotation.z += dt * (0.3 + mouth * 2.6) * (i % 2 ? -1 : 1) * (1 + i * 0.35); });
      };
    }
    g.userData = { head, jaw, mat: orbMat, mouth: 0, tick };
    return g;
  }
  const hostA = makeHost('A'), hostB = makeHost('B');
  const hostsGroup = new THREE.Group(); hostsGroup.add(hostA, hostB); coreScene.add(hostsGroup);
  hostsGroup.position.y = -5;

  let coreRT = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

  /* ---------- warp streaks ---------- */
  const PC = reduceMotion ? 260 : 900, PD = 90;
  const sGeo = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(0.03, 0.03, 1));
  const pData = new Float32Array(PC * 4), pCol = new Float32Array(PC * 3);
  const pal = ['#ff6b3d', '#ff4f9a', '#8f6bff', '#35d0b5', '#4d7dff', '#f2ff5c', '#ffffff'].map(C);
  for (let i = 0; i < PC; i++) {
    const a = Math.random() * Math.PI * 2, r = 2.2 + Math.pow(Math.random(), 0.7) * 22;
    pData.set([Math.cos(a) * r, Math.sin(a) * r * 0.75, Math.random() * PD, Math.random()], i * 4);
    const c = pal[(Math.random() * pal.length) | 0]; pCol.set([c.r, c.g, c.b], i * 3);
  }
  sGeo.setAttribute('aData', new THREE.InstancedBufferAttribute(pData, 4)); sGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(pCol, 3)); sGeo.instanceCount = PC;
  const sMat = new THREE.ShaderMaterial({
    uniforms: { uTravel: { value: 0 }, uStretch: { value: 1 }, uHue: { value: 0 }, uTint: { value: C('#ffffff') }, uVis: { value: 0.05 } },
    vertexShader: `attribute vec4 aData; attribute vec3 aColor; uniform float uTravel, uStretch, uHue; uniform vec3 uTint; varying vec3 vColor; varying float vFade; varying float vT;
      vec3 hue(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
      void main(){ float D = ${PD.toFixed(1)}; float z = mod(aData.z + uTravel * (0.6 + aData.w * 0.8), D) - D * 0.86;
        vec3 p = position; p.z *= uStretch * (0.35 + aData.w * 1.2); p.xy *= 0.6 + aData.w; vT = position.z + 0.5;
        vFade = smoothstep(-D * 0.86, -D * 0.5, z) * (1.0 - smoothstep(6.0, 11.0, z));
        vColor = mix(hue(aColor, uHue), uTint, 0.35);
        gl_Position = projectionMatrix * viewMatrix * vec4(vec3(aData.xy, z) + p, 1.0); }`,
    fragmentShader: 'uniform float uVis; varying vec3 vColor; varying float vFade; varying float vT; void main(){ gl_FragColor = vec4(vColor * vFade * mix(0.08, 1.0, vT * vT) * 2.6 * uVis, 1.0); }',
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const streaks = new THREE.Mesh(sGeo, sMat); streaks.frustumCulled = false; bgScene.add(streaks);

  /* ---------- background: interference field, a standing wave from n symmetric sources ---------- */
  const srgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  const fieldMat = new THREE.ShaderMaterial({
    uniforms: { uAspect: { value: 1 }, uPhase: { value: 0 }, uRing: { value: 9 }, uLow: { value: 0 }, uMid: { value: 0 }, uLevel: { value: 0 }, uMorph: { value: 1 },
      uNA: { value: 5 }, uNB: { value: 5 }, uHostMix: { value: 0 }, uLine: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() }, uBg: { value: new THREE.Color() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: `precision highp float;
      uniform float uAspect, uPhase, uRing, uLow, uMid, uLevel, uMorph, uHostMix; uniform int uNA, uNB; uniform vec3 uLine, uAccent, uBg; varying vec2 vUv;
      float field(vec2 p, int n, float k, float rot){
        float f = 0.0;
        for (int i = 0; i < 8; i++){ if (i >= n) break;
          float a = 6.2831853 * float(i) / float(n) + rot;
          f += cos(k * length(p - vec2(cos(a), sin(a)) * 0.46) - uPhase); }
        return f / float(n);
      }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0; p.y -= 0.12;
        float k = 10.0 + uMid * 5.0, rot = uPhase * 0.025;
        float f = field(p, uNA, k, rot);
        if (uNA != uNB) f = mix(f, field(p, uNB, k, rot), smoothstep(0.0, 1.0, uMorph));
        float v = f * 3.2, w = fwidth(v) * 1.15 + 1e-4;
        float lines = 1.0 - clamp(abs(fract(v + 0.5) - 0.5) / w, 0.0, 1.0);
        float node = 1.0 - clamp(abs(f) / (fwidth(f) * 2.4 + 1e-4), 0.0, 1.0);
        float r = length(p), fade = smoothstep(1.9, 0.15, r) * (1.0 - 0.4 * uHostMix);
        float ringR = uRing * 1.05, ring = exp(-uRing * 2.1) * (1.0 - smoothstep(0.0, 0.035, abs(r - ringR)));
        vec3 col = uBg + uLine * (0.20 * lines + 0.75 * node) * fade * (0.55 + uLevel * 0.9 + uLow * 0.6) + uAccent * (ring * 0.9 + 0.05 * (0.4 + uLevel) * smoothstep(1.3, 0.0, r));
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const fieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fieldMat); fieldMesh.frustumCulled = false; fieldMesh.renderOrder = -100; bgScene.add(fieldMesh);
  const fieldState = { phase: 0, ringT: 9, wasKick: false, a: 5, b: 5, morph: 1, idx: -1, hour: 0, hourAt: -9 };
  const hourOverride = parseFloat(new URLSearchParams(location.search).get('hour'));
  function updateField(s, dt, f, kick) {
    const st = fieldState;
    st.phase += dt * (0.22 + f.level * 1.1) * (s.timeScale || 1);
    const isKick = kick > 0.5; if (isKick && !st.wasKick) st.ringT = 0; else st.ringT += dt; st.wasKick = isKick;
    if (s.tunedIdx !== st.idx && s.tunedIdx >= 0) { st.a = st.b; st.b = stationSymmetry(s.tunedIdx); st.morph = 0; st.idx = s.tunedIdx; }
    st.morph = Math.min(1, st.morph + dt / 1.4); if (st.morph >= 1) st.a = st.b;
    if (elapsed - st.hourAt > 5) { const d = new Date(); st.hour = Number.isFinite(hourOverride) ? hourOverride : d.getHours() + d.getMinutes() / 60; st.hourAt = elapsed; }
    const tp = todPalette(st.hour), u = fieldMat.uniforms;
    u.uLine.value.copy(srgb(tp.line)).lerp(palette.cat, 0.22); u.uAccent.value.copy(srgb(tp.accent)).lerp(palette.accent, 0.3); u.uBg.value.copy(srgb(tp.bg));
    u.uPhase.value = st.phase; u.uRing.value = Math.min(st.ringT, 9); u.uLow.value = f.low; u.uMid.value = f.mid; u.uLevel.value = f.level;
    u.uNA.value = st.a; u.uNB.value = st.b; u.uMorph.value = st.morph; u.uHostMix.value = hostMix; u.uAspect.value = camera.aspect;
  }

  /* ---------- dial ---------- */
  const RING_R = 5.3;
  const ring = new THREE.Group(); ring.position.set(0, -2.15, 0); ring.rotation.x = 0.06; bgScene.add(ring);
  const dialG = new THREE.Group(); ring.add(dialG);
  const ringMat = new THREE.LineBasicMaterial({ color: C('#3b3550') });
  { const pts = []; for (let i = 0; i <= 256; i++) { const a = i / 256 * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * RING_R, 0, Math.cos(a) * RING_R)); } ring.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    const tk = []; for (let i = 0; i < N * 5; i++) { const a = i / (N * 5) * Math.PI * 2, l = i % 5 ? 0.12 : 0.32; tk.push(new THREE.Vector3(Math.sin(a) * (RING_R - l), 0, Math.cos(a) * (RING_R - l)), new THREE.Vector3(Math.sin(a) * RING_R, 0, Math.cos(a) * RING_R)); }
    dialG.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tk), new THREE.LineBasicMaterial({ color: C('#5a5270') }))); }
  const hitGeo = new THREE.SphereGeometry(0.45, 8, 6), hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const satGeo = new THREE.IcosahedronGeometry(0.12, 2);
  const sats = STATIONS.map((s, i) => {
    const a = i * STEP, m = new THREE.Mesh(satGeo, new THREE.MeshBasicMaterial({ color: C(CATS[s.cat].color) }));
    m.position.set(Math.sin(a) * RING_R, 0.22, Math.cos(a) * RING_R);
    const hit = new THREE.Mesh(hitGeo, hitMat); hit.userData.station = i; m.add(hit); dialG.add(m);
    return { mesh: m, hit, base: C(CATS[s.cat].color), glow: 0 };
  });
  const needleMat = new THREE.MeshBasicMaterial({ color: C('#ff6b3d').multiplyScalar(3) });
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.9, 0.035), needleMat); needle.position.set(0, 0.3, RING_R + 0.02); ring.add(needle);
  const ARC = 64, arcGeo = new THREE.BufferGeometry(); arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC + 1) * 3), 3));
  const arcMat = new THREE.LineBasicMaterial({ color: C('#ff6b3d').multiplyScalar(2.2) });
  const arc = new THREE.Line(arcGeo, arcMat); arc.frustumCulled = false; arc.visible = false; bgScene.add(arc);

  /* ---------- topic moons ---------- */
  const moonG = new THREE.Group(); moonG.rotation.set(1.28, 0, 0.18); bgScene.add(moonG);
  const MOON_R = 3.35, moonGeo = new THREE.IcosahedronGeometry(0.16, 1);
  const moons = TOPIC_IDS.map((id, i) => {
    const m = new THREE.Mesh(moonGeo, new THREE.MeshBasicMaterial({ color: C('#6e6880'), wireframe: true }));
    const hit = new THREE.Mesh(hitGeo, hitMat); hit.userData.topic = id; m.add(hit); moonG.add(m);
    return { mesh: m, id, phase: i / TOPIC_IDS.length * Math.PI * 2, on: 0 };
  });
  { const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * MOON_R, 0, Math.sin(a) * MOON_R)); } moonG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: C('#2a2638') }))); }

  /* ---------- post ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(bgScene, camera));
  const comp = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tCore: { value: null }, tFluid: { value: null }, uGrid: { value: new THREE.Vector2(1, 1) }, uCellPx: { value: new THREE.Vector2(10, 10) }, uKick: { value: 0 }, uGlyph: { value: C('#b8b2c8') }, uCat: { value: C('#8f6bff') }, uHost: { value: C('#ffd0bd') }, uHot: { value: C('#ff6b3d') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `precision highp float;
      uniform sampler2D tDiffuse, tCore, tFluid; uniform vec2 uGrid, uCellPx; uniform float uKick; uniform vec3 uGlyph, uCat, uHost, uHot; varying vec2 vUv;
      float box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
      void main(){
        vec4 fl = texture2D(tFluid, vUv); vec3 col = texture2D(tDiffuse, vUv - fl.xy * 0.012).rgb;
        vec2 g = vUv * uGrid, cell = floor(g), cuv = (cell + 0.5) / uGrid;
        vec4 cf = texture2D(tFluid, cuv); vec4 core = texture2D(tCore, cuv - cf.xy * 0.010);
        if (core.a > 0.5) {
          bool host = core.b > 0.97;
          vec2 p = fract(g) - 0.5; float px = 1.0 / min(uCellPx.x, uCellPx.y);
          float lum = clamp(core.r + uKick * (host ? 0.04 : 0.16), 0., 1.), heat = clamp(cf.z * 1.6, 0., 1.);
          float shade = floor(lum * 4.999); if (heat > 0.32) shade = 4.0;
          float d;
          if (shade < 1.0) d = length(p) - 0.07;
          else if (shade < 2.0) d = min(box(p, vec2(0.30, px * 0.6)), box(p, vec2(px * 0.6, 0.30)));
          else if (shade < 3.0) d = abs(length(p) - 0.29) - px * 0.75;
          else if (shade < 4.0) d = abs(box(p, vec2(0.34))) - px * 0.8;
          else d = box(p, vec2(0.41));
          float m = 1.0 - smoothstep(-px * 0.6, px * 0.6, d);
          vec3 base = host ? uHost : uCat;
          vec3 tint = uGlyph * mix(0.35, 1.0, lum);
          if (shade >= 4.0) tint = host ? base * (0.5 + lum * 0.35) : base * (0.9 + lum * 0.5);
          tint = mix(tint, base * (host ? 0.85 : 1.25), smoothstep(0.55, 0.95, core.g) * step(shade, 3.5));
          if (heat > 0.32) tint = uHot * (1.4 + heat * 1.6); else tint = mix(tint, uHot * 1.1, smoothstep(0.12, 0.32, heat));
          col = mix(col * 0.1, tint, m);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  composer.addPass(comp);
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.55, 0.92); composer.addPass(bloom);
  const fin = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uCA: { value: 1 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uFluid: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `precision highp float; uniform sampler2D tDiffuse, uFluid; uniform float uCA, uTime; uniform vec2 uRes; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float bayer(vec2 p){ ivec2 i = ivec2(mod(p, 4.0)); int x = i.x + i.y * 4; float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.; for (int k = 0; k < 16; k++) if (k == x) return m[k] / 16.0; return 0.; }
      void main(){ vec2 uv = vUv + texture2D(uFluid, vUv).xy * 0.004, dir = uv - 0.5; float d = length(dir); vec2 off = dir * d * uCA * 0.014;
        vec3 c = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
        c *= 1.0 - smoothstep(0.42, 0.95, d) * 0.6; vec2 fc = vUv * uRes; c += (bayer(fc) - 0.5) * 0.018 + (hash(fc + uTime) - 0.5) * 0.03;
        gl_FragColor = vec4(max(c, 0.0), 1.0); }`,
  });
  composer.addPass(fin); composer.addPass(new OutputPass());

  /* ---------- size ---------- */
  function resize() {
    const w = innerWidth, h = innerHeight, aspect = w / h;
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); composer.setPixelRatio(dpr); composer.setSize(w, h);
    camera.aspect = aspect; camera.fov = aspect < 0.8 ? 50 : 42;
    camBase.z = aspect < 1 ? THREE.MathUtils.clamp(9.5 / Math.max(aspect, 0.42), 13, 21) : 13; camera.updateProjectionMatrix();
    const bw = Math.floor(w * dpr), bh = Math.floor(h * dpr), target = THREE.MathUtils.clamp(w / 95, 7, 12) * dpr;
    const cols = Math.max(20, Math.round(bw / target)), rows = Math.max(20, Math.round(bh / target));
    coreRT.setSize(cols, rows); comp.uniforms.uGrid.value.set(cols, rows); comp.uniforms.uCellPx.value.set(bw / cols, bh / rows);
    fin.uniforms.uRes.value.set(bw, bh); bloom.resolution.set(bw / 2, bh / 2);
    const fh = Math.round(FW / aspect); if (fh !== FH) { FH = fh; fA.setSize(FW, FH); fB.setSize(FW, FH); }
    fluidMat.uniforms.uTexel.value.set(1 / FW, 1 / FH); fluidMat.uniforms.uAspect.value = aspect;
  }
  addEventListener('resize', resize); resize();

  /* ---------- music-driven palette ---------- */
  const palette = { cat: C('#8f6bff'), host: C('#ffd0bd'), hot: C('#ff6b3d'), accent: C('#ff6b3d') };
  const tmpC = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
  let hueDrift = 0, cssTimer = 0;
  function updatePalette(dt, catHex, f, kick, playing) {
    C(catHex).getHSL(hsl);
    const energy = playing ? f.level : 0.2;
    hueDrift += dt * (0.004 + energy * 0.02);
    const h = (hsl.h + (playing ? (f.centroid - 0.32) * 0.32 + f.low * 0.05 : 0) + Math.sin(hueDrift * 2 * Math.PI) * 0.05 + 1) % 1;
    const s = THREE.MathUtils.clamp(0.5 + (playing ? f.mid * 0.6 : 0.1), 0.45, 0.95), l = THREE.MathUtils.clamp(0.56 + kick * 0.06 + f.high * 0.1, 0.5, 0.72);
    const k = Math.min(1, dt * 1.6);
    palette.cat.lerp(tmpC.setHSL(h, s, l), k);
    palette.host.lerp(tmpC.setHSL((h + 0.08) % 1, 0.55, 0.84), k);
    palette.hot.lerp(tmpC.setHSL((h + 0.45) % 1, 0.95, 0.6), k);
    palette.accent.lerp(tmpC.setHSL((h + 0.45) % 1, 0.92, 0.6), k);
    comp.uniforms.uCat.value.copy(palette.cat); comp.uniforms.uHost.value.copy(palette.host); comp.uniforms.uHot.value.copy(palette.hot);
    sMat.uniforms.uHue.value = (h - hsl.h) * Math.PI * 2 + hueDrift; sMat.uniforms.uTint.value.copy(palette.cat);
    needleMat.color.copy(palette.accent).multiplyScalar(3); arcMat.color.copy(palette.accent).multiplyScalar(2.2);
    ringMat.color.copy(palette.cat).multiplyScalar(0.28);
    cssTimer += dt;
    if (cssTimer > 0.1) { cssTimer = 0; const r = document.documentElement.style; r.setProperty('--accent', '#' + palette.accent.getHexString(THREE.SRGBColorSpace)); r.setProperty('--live', '#' + palette.cat.getHexString(THREE.SRGBColorSpace)); }
  }

  /* ---------- per-frame ---------- */
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), camPos = camBase.clone();
  let elapsed = 0, travel = 0, ripple = 0, hostMix = 0, duo = 0, frameAcc = 0, frameN = 0, lastCheck = 0;
  const raycaster = new THREE.Raycaster();

  function render(s, dt) {
    elapsed += dt;
    const { f, kick, timeScale, pointer } = s;
    updatePalette(dt, CATS[s.station.cat]?.color || '#8f6bff', f, kick, s.playing);
    updateField(s, dt, f, kick);

    camPos.set(camBase.x + pointer.nx * 0.6, camBase.y + pointer.ny * 0.35, camBase.z - (timeScale - 1) * 0.5);
    camera.position.lerp(camPos, Math.min(1, dt * 3)); camera.lookAt(lookAt);

    /* hosts vs speaker */
    hostMix += ((s.hosts ? 1 : 0) - hostMix) * Math.min(1, dt * 2.6);
    duo += ((s.hosts?.duo ? 1 : 0) - duo) * Math.min(1, dt * 3);
    const e = hostMix * hostMix * (3 - 2 * hostMix);
    speakerGroup.scale.setScalar(1 - e * 0.5);
    speakerGroup.position.set(0, 0.15 + Math.sin(elapsed * 0.6) * 0.05 + e * 1.35, -e * 2.4);
    speakerGroup.rotation.y += ((-0.42 + pointer.nx * 0.28 + Math.sin(elapsed * 0.3) * 0.06) - speakerGroup.rotation.y) * Math.min(1, dt * 2.5);
    speakerGroup.rotation.x += ((0.12 - pointer.ny * 0.2) - speakerGroup.rotation.x) * Math.min(1, dt * 2.5);
    ripple += dt * (3 + f.level * 5) * timeScale;
    coreMat.uniforms.uPump.value = s.hosts && s.hosts.who !== 'clip' ? kick * 0.3 : kick;
    coreMat.uniforms.uEnergy.value = 0.25 + f.level * 1.2; coreMat.uniforms.uPhase.value = ripple;

    hostsGroup.visible = hostMix > 0.01;
    hostsGroup.position.set(0, -6 + e * 5.3, 2.2); hostsGroup.scale.setScalar(1.45);
    hostsGroup.rotation.x = 0.1 - pointer.ny * 0.06;
    const sx = 1.25 * duo;
    hostA.position.set(-sx, 0, 0); hostB.position.set(sx, 0, 0);
    hostA.rotation.y = 0.32 * duo + pointer.nx * 0.15; hostB.rotation.y = -0.32 * duo + pointer.nx * 0.15;
    hostB.scale.setScalar(Math.max(0.001, duo)); hostB.visible = duo > 0.02;
    for (const [h, id] of [[hostA, 'A'], [hostB, 'B']]) {
      const u = h.userData, talking = s.hosts?.who === id;
      u.mouth += ((talking ? f.voice : 0) - u.mouth) * Math.min(1, dt * 20);
      u.tick(u.mouth, elapsed, talking, dt);
      u.head.rotation.x = -u.mouth * 0.06 + Math.sin(elapsed * 1.3 + (id === 'B' ? 1 : 0)) * 0.03;
      const look = s.hosts?.duo ? (id === 'A' ? 0.35 : -0.35) * (talking ? 0.3 : 1) : 0;
      u.head.rotation.y += (look + Math.sin(elapsed * 0.5) * 0.05 - u.head.rotation.y) * Math.min(1, dt * 3);
      u.mat.uniforms.uGlow.value += ((talking ? 0.12 + u.mouth * 0.15 : 0) - u.mat.uniforms.uGlow.value) * Math.min(1, dt * 8);
    }

    /* satellites */
    const tuned = s.tunedIdx, blend = s.blendIdx;
    sats.forEach((o, i) => {
      o.glow += ((i === tuned ? 1 : i === s.needleIdx ? 0.6 : i === blend ? 0.5 : 0) - o.glow) * Math.min(1, dt * 6);
      o.mesh.scale.setScalar(1 + o.glow * 0.45 + (i === tuned ? kick * 0.3 : 0));
      o.mesh.material.color.copy(i === tuned ? palette.cat : o.base).multiplyScalar(0.6 + o.glow * 1.25);
    });
    dialG.rotation.y = s.phi;

    /* moons */
    const orbit = THREE.MathUtils.mapLinear(Math.log(s.interval), 0, Math.log(60), 0.55, 0.06) * timeScale;
    moons.forEach((m, i) => {
      m.phase += dt * orbit;
      m.mesh.position.set(Math.cos(m.phase) * MOON_R, Math.sin(m.phase * 2 + i) * 0.08, Math.sin(m.phase) * MOON_R);
      const on = s.topics.includes(m.id) ? 1 : 0; m.on += (on - m.on) * Math.min(1, dt * 6);
      m.mesh.material.wireframe = m.on < 0.5;
      m.mesh.material.color.copy(m.on > 0.5 ? palette.accent : tmpC.set('#6e6880')).multiplyScalar(m.on > 0.5 ? 1.05 + kick * 0.6 : 1);
      m.mesh.rotation.y += dt * 0.8; m.mesh.scale.setScalar(1 + m.on * 0.35);
    });

    /* blend arc */
    arc.visible = blend >= 0 && tuned >= 0;
    if (arc.visible) {
      sats[tuned].mesh.getWorldPosition(tmpV); sats[blend].mesh.getWorldPosition(tmpV2);
      const pos = arcGeo.attributes.position;
      for (let i = 0; i <= ARC; i++) { const t = i / ARC, u = 1 - t; pos.setXYZ(i, u * u * tmpV.x + t * t * tmpV2.x, u * u * tmpV.y + 2 * u * t * 3.6 + t * t * tmpV2.y, u * u * tmpV.z + t * t * tmpV2.z); }
      pos.needsUpdate = true;
    }

    /* streaks */
    travel += dt * (5 + kick * 6) * timeScale * (reduceMotion ? 0.3 : 1);
    sMat.uniforms.uVis.value = 0.05 + Math.min(1, Math.max(0, (timeScale - 1) * 0.5));
    sMat.uniforms.uTravel.value = travel; sMat.uniforms.uStretch.value = 0.8 + (timeScale - 1) * 3.2 + kick * 0.6;

    /* fluid */
    const fu = fluidMat.uniforms;
    fu.uPrev.value = fA.texture; fu.uDt.value = dt; fu.uTime.value = elapsed; fu.uKick.value = kick * 0.6;
    fu.uPointer.value.set(pointer.inside ? pointer.x : -9, pointer.inside ? pointer.y : -9);
    fu.uForce.value.set(pointer.dx / Math.max(dt, 1 / 240) * 0.35, pointer.dy / Math.max(dt, 1 / 240) * 0.35).clampLength(0, 6);
    fu.uCenter.value.set(0.5, 0.56 + e * 0.08);
    renderer.setRenderTarget(fB); renderer.render(fluidScene, quadCam); [fA, fB] = [fB, fA];

    renderer.setRenderTarget(coreRT); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(coreScene, camera);
    renderer.setRenderTarget(null); renderer.setClearColor(0x07060a, 1);
    comp.uniforms.tCore.value = coreRT.texture; comp.uniforms.tFluid.value = fA.texture; comp.uniforms.uKick.value = kick;
    fin.uniforms.uFluid.value = fA.texture; fin.uniforms.uTime.value = elapsed % 100;
    fin.uniforms.uCA.value = reduceMotion ? 0.6 : 1.1 + kick * 1.6 + (timeScale - 1) * 0.9;
    bloom.strength = 0.75 + kick * 0.35 + (timeScale - 1) * 0.15;
    composer.render(dt);

    /* adaptive resolution */
    frameAcc += dt; frameN++;
    if (elapsed - lastCheck > 2.5) { const avg = frameAcc / frameN; frameAcc = 0; frameN = 0; lastCheck = elapsed; if (avg > 1 / 40 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); resize(); } }
  }

  /* projection helpers for DOM labels */
  function project(obj, out) { obj.getWorldPosition(tmpV); const z = tmpV.z; tmpV.project(camera); out.x = (tmpV.x * 0.5 + 0.5) * innerWidth; out.y = (-tmpV.y * 0.5 + 0.5) * innerHeight; out.z = z; return out; }
  function pick(clientX, clientY) {
    raycaster.setFromCamera(new THREE.Vector2(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1), camera);
    const hits = raycaster.intersectObjects([...sats.map(o => o.hit), ...moons.map(m => m.mesh.children[0])], false);
    return hits[0]?.object.userData || null;
  }
  return {
    render, project, pick, camera,
    satObj: i => sats[i].mesh, moonObj: i => moons[i].mesh,
    headObj: id => (id === 'B' ? hostB : hostA).userData.head,
    hostVisible: () => hostMix, duoAmount: () => duo,
  };
}
