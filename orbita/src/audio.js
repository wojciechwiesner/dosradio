/* Audio graph, music analysis for visuals, voice playback (buffers or browser TTS), demo synth, live music streamers */
import { getLang, locale } from './i18n.js';

export class AudioCore {
  constructor() {
    this.ctx = null; this.kickQueue = []; this.voiceEnv = 0; this.ttsActive = false; this.voiceToken = 0;
    this.f = { kick: 0, level: 0, low: 0, mid: 0, high: 0, centroid: 0.3, voice: 0 };
    this.lowAvg = 0; this.onsetLive = false;
  }
  init() {
    if (this.ctx) return this.ctx;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.limiter = ctx.createDynamicsCompressor(); this.limiter.threshold.value = -2; this.limiter.ratio.value = 12;
    this.out = ctx.createAnalyser(); this.out.fftSize = 512;
    this.master.connect(this.limiter); this.limiter.connect(this.out); this.out.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicDuck = ctx.createGain();
    this.musicBus.connect(this.musicDuck); this.musicDuck.connect(this.master);
    this.musicAn = ctx.createAnalyser(); this.musicAn.fftSize = 1024; this.musicAn.smoothingTimeConstant = 0.55;
    this.musicBus.connect(this.musicAn);
    this.mfreq = new Uint8Array(this.musicAn.frequencyBinCount);
    this.voiceGain = ctx.createGain(); this.voiceGain.gain.value = 0.9;
    this.voiceAn = ctx.createAnalyser(); this.voiceAn.fftSize = 512; this.vbuf = new Float32Array(512);
    this.voiceGain.connect(this.voiceAn); this.voiceAn.connect(this.master);
    // static between stations
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const st = ctx.createBufferSource(); st.buffer = buf; st.loop = true;
    this.staticBp = ctx.createBiquadFilter(); this.staticBp.type = 'bandpass'; this.staticBp.frequency.value = 2400; this.staticBp.Q.value = 0.5;
    this.staticGain = ctx.createGain(); this.staticGain.gain.value = 0;
    st.connect(this.staticBp); this.staticBp.connect(this.staticGain); this.staticGain.connect(this.master); st.start();
    return ctx;
  }
  get t() { return this.ctx ? this.ctx.currentTime : 0; }
  setVolume(v) { this.master && this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.t, 0.05); }
  setStatic(v) {
    if (!this.ctx || Math.abs(v - (this._sv ?? -1)) < 0.004) return; this._sv = v;
    this.staticGain.gain.setTargetAtTime(Math.min(0.2, v), this.t, 0.04);
    this.staticBp.frequency.setTargetAtTime(1800 + v * 5000, this.t, 0.05);
  }
  tick(strong = false) {
    if (!this.ctx) return;
    const t = this.t, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = strong ? 1600 : 2600;
    g.gain.setValueAtTime(strong ? 0.07 : 0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.04);
  }
  duck(level, secs) {
    if (!this.ctx) return;
    const g = this.musicDuck.gain, t = this.t;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(level, t + secs);
  }
  /* ---------- voice ---------- */
  stopVoice() {
    this.voiceToken++;
    if (this.voiceSrc) { try { this.voiceSrc.stop(); } catch { /* ended */ } this.voiceSrc = null; }
    clearInterval(this.pulseTimer); this.ttsActive = false;
  }
  playBuffer(buffer, bus = 'voice') {
    const src = this.ctx.createBufferSource(); src.buffer = buffer;
    src.connect(bus === 'music' ? this.musicBus : this.voiceGain);
    if (bus === 'voice') this.voiceSrc = src;
    return new Promise(res => { src.onended = () => { if (this.voiceSrc === src) this.voiceSrc = null; res(); }; src.start(); });
  }
  /* No synthetic voice. A part without a recording is shown as a caption at reading pace while the host figure
     breathes with it; recordings play through playBuffer. */
  async speak(text, who = 'A', rate = 1.0) {
    const token = ++this.voiceToken;
    this.ttsActive = true;
    try { await this.readCaption(text, rate, token); }
    finally { if (token === this.voiceToken) this.ttsActive = false; }
  }
  readCaption(text, rate, token) {
    const words = text.split(/\s+/).filter(Boolean).length, dur = Math.max(1.8, words * 0.36 / rate) * 1000, t0 = performance.now();
    clearInterval(this.pulseTimer);
    this.pulseTimer = setInterval(() => { this.voiceEnv = 0.25 + Math.random() * 0.35; }, 220);
    return new Promise(res => {
      const poll = setInterval(() => {
        if (token === this.voiceToken && performance.now() - t0 < dur) return;
        clearInterval(poll); if (token === this.voiceToken) clearInterval(this.pulseTimer); res();
      }, 100);
    });
  }
  /* ---------- features for visuals ---------- */
  analyse(dt, playing) {
    const f = this.f;
    let kick = 0;
    if (this.ctx && playing) {
      const now = this.t;
      while (this.kickQueue.length && this.kickQueue[0] <= now) { this.kickQueue.shift(); kick = 1; }
      this.musicAn.getByteFrequencyData(this.mfreq);
      const n = this.mfreq.length, hz = this.ctx.sampleRate / 2 / n;
      let low = 0, mid = 0, high = 0, sum = 0, wsum = 0;
      for (let i = 1; i < n; i++) {
        const v = this.mfreq[i] / 255, fr = i * hz;
        if (fr < 160) low += v; else if (fr < 2000) mid += v; else if (fr < 9000) high += v;
        sum += v; wsum += v * i;
      }
      const lb = Math.ceil(160 / hz), mb = Math.ceil(2000 / hz) - lb, hb = Math.ceil(9000 / hz) - mb - lb;
      low /= lb; mid /= mb; high /= hb;
      const centroid = sum > 0.01 ? (wsum / sum) / n : f.centroid;
      if (this.onsetLive && low > this.lowAvg * 1.2 + 0.04) kick = Math.max(kick, Math.min(1, (low - this.lowAvg) * 4));
      this.lowAvg += (low - this.lowAvg) * Math.min(1, dt * 4);
      const k = Math.min(1, dt * 3);
      f.low += (low - f.low) * k; f.mid += (mid - f.mid) * k; f.high += (high - f.high) * k;
      f.centroid += (Math.min(1, centroid * 3) - f.centroid) * Math.min(1, dt * 0.8);
      f.level += (low * 0.5 + mid * 0.5 - f.level) * Math.min(1, dt * 6);
    }
    f.kick = kick;
    // voice: real analyser for buffers, envelope for TTS
    let v = 0;
    if (this.ctx && this.voiceSrc) {
      this.voiceAn.getFloatTimeDomainData(this.vbuf);
      let s = 0; for (const x of this.vbuf) s += x * x; v = Math.min(1, Math.sqrt(s / this.vbuf.length) * 7);
    }
    if (this.ttsActive) v = Math.max(v, this.voiceEnv);
    this.voiceEnv *= Math.exp(-dt * 7);
    f.voice += (v - f.voice) * Math.min(1, dt * (v > f.voice ? 25 : 10));
    return f;
  }
}

/* ---------- Demo synth: generative groove shaped by station bpm / density / brightness ---------- */
export class DemoSynth {
  constructor(core) { this.core = core; this.timer = 0; }
  start(station) { this.st = station; if (this.timer) return; this.step = 0; this.next = this.core.t + 0.08; this.timer = setInterval(() => this.pump(), 25); }
  set(station) { this.st = station; }
  stop() { clearInterval(this.timer); this.timer = 0; }
  pump() { const s = this.st; while (this.next < this.core.t + 0.12) { this.sched(this.step, this.next, s); this.next += 60 / s.bpm / 4; this.step++; } }
  sched(step, t, s) {
    const k = step % 16, bar = Math.floor(step / 16);
    const ambient = s.id === 'deep-ambient' || s.id === 'stoa' || s.custom && s.bpm < 75;
    const dnb = s.bpm >= 160, slow = s.bpm < 100;
    const tr = { fokus: 0, chill: -2, energia: 2, noc: -5 }[s.cat] ?? 0;
    const prog = [[57, 60, 64, 67], [53, 57, 60, 64], [60, 64, 67, 71], [55, 59, 62, 67]];
    const chord = prog[Math.floor(bar / 2) % 4].map(n => n + tr);
    if (!ambient) {
      if ((dnb ? [0, 10] : slow ? [0, 7, 10] : [0, 4, 8, 12]).includes(k)) this.kick(t);
      if ((dnb || slow || s.density >= 0.55 ? [4, 12] : []).includes(k)) this.snare(t, slow ? 0.22 : 0.3);
      if (k % 4 === 2) this.hat(t, 0.14 + s.brightness * 0.08); else if (s.density > 0.5 && k % 2 === 1) this.hat(t, 0.04);
      if (k % 4 === 2 || (dnb && k % 8 === 0)) this.bass(t, chord[0] - 24, s, 60 / s.bpm * 0.45);
      if (s.brightness > 0.5 && [3, 6, 11, 14].includes(k) && bar % 4 > 1) this.pluck(t, chord[(k + bar) % 4] + 12, s);
    }
    if (k === 0 && bar % 2 === 0) this.pad(t, chord, s, 60 / s.bpm * 8, ambient ? 0.1 : 0.05);
    if (ambient && k % 8 === 0) { this.bell(t, chord[(step / 8) % 4] + 12); this.core.kickQueue.push(t); }
  }
  get bus() { return this.core.musicBus; }
  env(g, t, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  osc(type, f) { const o = this.core.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  hz = m => 440 * 2 ** ((m - 69) / 12);
  kick(t) { const c = this.core.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.12); this.env(g, t, 0.9, 0.38); o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.4); this.core.kickQueue.push(t); }
  noiseHit(t, type, freq, v, dur) { const c = this.core.ctx, n = c.createBufferSource(); n.buffer = this.core.noise; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; const g = c.createGain(); this.env(g, t, v, dur); n.connect(f); f.connect(g); g.connect(this.bus); n.start(t, Math.random()); n.stop(t + dur + 0.02); }
  snare(t, v) { this.noiseHit(t, 'bandpass', 1900, v, 0.18); }
  hat(t, v) { this.noiseHit(t, 'highpass', 7500, v, 0.045); }
  bass(t, m, s, dur) { const c = this.core.ctx, o = this.osc('sawtooth', this.hz(m)), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'lowpass'; f.frequency.setValueAtTime(220 + s.brightness * 700, t); f.frequency.exponentialRampToValueAtTime(120, t + dur); f.Q.value = 6; this.env(g, t, 0.3, dur); o.connect(f); f.connect(g); g.connect(this.bus); o.start(t); o.stop(t + dur + 0.05); }
  pluck(t, m, s) { const c = this.core.ctx, o = this.osc('triangle', this.hz(m)), g = c.createGain(); this.env(g, t, 0.05 + s.brightness * 0.04, 0.35); o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.4); }
  pad(t, chord, s, dur, v) {
    const c = this.core.ctx, f = c.createBiquadFilter(), g = c.createGain(); f.type = 'lowpass'; f.frequency.value = 500 + s.brightness * 2200;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(this.bus);
    for (const m of chord) for (const det of [-7, 7]) { const o = this.osc('sawtooth', this.hz(m)); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
  }
  bell(t, m) { const c = this.core.ctx, o = this.osc('sine', this.hz(m)), g = c.createGain(); this.env(g, t, 0.08, 2.4); o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 2.5); }
  /* short musical sting between podcast segments */
  sting(station) {
    const s = station, t = this.core.t + 0.05, c = this.core.ctx;
    const tr = { fokus: 0, chill: -2, energia: 2, noc: -5 }[s.cat] ?? 0;
    [57, 60, 64, 67, 72].forEach((m, i) => { const o = this.osc('triangle', this.hz(m + tr)), g = c.createGain(); this.env(g, t + i * 0.12, 0.12, 1.2); o.connect(g); g.connect(this.bus); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 1.3); this.core.kickQueue.push(t + i * 0.12); });
    this.pad(t, [57 + tr, 64 + tr, 69 + tr], s, 2.6, 0.08);
    return new Promise(r => setTimeout(r, 2600));
  }
}

/* ---------- Live music: Ogg stream element, falling back to the chunk endpoint ---------- */
export class LiveMusic {
  constructor(core, events) { this.core = core; this.events = events; this.handle = null; this.chunks = null; }
  async start(station) {
    this.station = station;
    if (await this.openStream(station)) return true;
    return this.startChunks(station);
  }
  async openStream(station) {
    const el = new Audio(`/radio-api/station/${encodeURIComponent(station.id)}/stream.ogg`);
    el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.setAttribute('playsinline', 'true');
    let src;
    try { src = this.core.ctx.createMediaElementSource(el); } catch { return false; }
    const g = this.core.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.core.musicBus);
    const h = { el, g, destroy: () => { el.pause(); el.removeAttribute('src'); el.load(); try { src.disconnect(); } catch { /* gone */ } } };
    el.addEventListener('error', () => { if (this.handle === h) { this.stopStream(); this.startChunks(this.station); } });
    try { await el.play(); } catch { h.destroy(); return false; }
    g.gain.setTargetAtTime(1, this.core.t, 0.25);
    const old = this.handle; this.handle = h;
    if (old) { old.g.gain.setTargetAtTime(0, this.core.t, 0.15); setTimeout(() => old.destroy(), 900); }
    return true;
  }
  stopStream() { this.handle?.destroy(); this.handle = null; }
  async startChunks(station) {
    this.chunks?.stop();
    this.chunks = new ChunkStreamer(this.core, station.id, this.events);
    return this.chunks.start();
  }
  async setStation(station) {
    this.station = station;
    if (this.chunks) { this.chunks.stop(); this.chunks = null; }
    return this.start(station);
  }
  stop() { this.stopStream(); this.chunks?.stop(); this.chunks = null; }
}
class ChunkStreamer {
  constructor(core, stationId, events) { this.core = core; this.id = stationId; this.events = events; this.running = false; this.gen = 0; this.next = 0; this.last = null; this.fail = 0; this.sources = new Set(); }
  async start() { this.running = true; const g = ++this.gen; const c = await this.fetch(); if (!c || g !== this.gen) { this.running = false; return false; } this.schedule(c); this.loop(g); return true; }
  stop() { this.running = false; this.gen++; for (const s of this.sources) { try { s.stop(this.core.t + 0.05); } catch { /* ended */ } } this.sources.clear(); }
  async loop(g) {
    while (this.running && g === this.gen) {
      const ahead = this.next - this.core.t;
      if (ahead > 15) { await new Promise(r => setTimeout(r, Math.min(5000, (ahead - 15) * 1000))); continue; }
      const c = await this.fetch(); if (!this.running || g !== this.gen) return;
      c ? this.schedule(c) : await new Promise(r => setTimeout(r, 1500));
    }
  }
  schedule(c) {
    const ctx = this.core.ctx, s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = c.buffer; s.connect(g); g.connect(this.core.musicBus);
    const at = Math.max(this.core.t + 0.05, this.next), d = c.buffer.duration, x = 0.08;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + x); g.gain.setValueAtTime(1, Math.max(at + x, at + d - x)); g.gain.linearRampToValueAtTime(0, at + d);
    s.onended = () => { this.sources.delete(s); g.disconnect(); }; s.start(at); this.sources.add(s); this.next = at + d - x;
  }
  async fetch() {
    const after = this.last ? `&after=${encodeURIComponent(this.last)}` : '';
    try {
      const r = await fetch(`/radio-api/station/${this.id}/next-chunk?live_prob=0.3${after}`, { credentials: 'same-origin' });
      if (r.status === 402) { this.events.onTrialEnded?.(); this.stop(); return null; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const seg = r.headers.get('x-dosradio-segment'), buffer = await this.core.ctx.decodeAudioData(await r.arrayBuffer());
      this.last = seg; this.fail = 0; return { buffer };
    } catch (e) { if (++this.fail >= 3) { this.fail = 0; this.events.onError?.(e.message); } return null; }
  }
}
