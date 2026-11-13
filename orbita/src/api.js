/* Backend access. LiveApi talks to dosradio.theones.io (same origin). DemoApi mirrors the shapes with local content. */
import { getLang } from './i18n.js';
import { demoNews, gmailSample, demoPodcast, toParts } from './content.js';
import { byId } from './data.js';

export class TrialEnded extends Error { constructor() { super('trial-ended'); } }
const isPlus = u => u.includes('/radio-api/plus/');
async function req(url, init) {
  const r = await fetch(url, { credentials: 'same-origin', ...init });
  if (r.status === 402 && !isPlus(url)) throw new TrialEnded();
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); if (typeof j.detail === 'string') msg = j.detail; } catch { /* not json */ }
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r.json();
}
const post = (u, b) => req(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const put = (u, b) => req(u, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const q = o => new URLSearchParams(o).toString();

export class LiveApi {
  live = true;
  me() { return req('/radio-api/me'); }
  startTrial() { return post('/radio-api/trial/start'); }
  register(email, password) { return post('/radio-api/register', { email, password }); }
  login(email, password) { return post('/radio-api/login', { email, password }); }
  logout() { return post('/radio-api/logout'); }
  news(cats) { return req(`/radio-api/news?${q({ cats: cats.join(','), lang: getLang() })}`); }
  mood(text) { return post('/radio-api/mood', { mood: text, lang: getLang() }); }
  newsPreferences() { return req('/radio-api/plus/news-preferences'); }
  saveNewsPreferences(keywords, rss_feeds) { return put('/radio-api/plus/news-preferences', { keywords, rss_feeds }); }
  newsDigest() { return req('/radio-api/plus/news-digest'); }
  podcast(topic) { return post('/radio-api/plus/podcast', { ...(topic ? { topic } : {}), lang: getLang() }); }
  pills() { return req('/radio-api/plus/pills'); }
  pill(url) { return post('/radio-api/plus/pill', { url }); }
  pillsBatch(text) { return post('/radio-api/plus/pills/batch', { text }); }
  pillStatus(id) { return req(`/radio-api/plus/pill/${encodeURIComponent(id)}`); }
  async hostClips(stationId) { try { const j = await req(`/radio-api/host-clips/${encodeURIComponent(stationId)}`); return { jingles: j.jingles ?? [], chatter: j.chatter ?? [] }; } catch { return null; } }
  billing() { return req('/radio-api/billing/status').catch(() => null); }
  checkout(plan) { return post('/radio-api/billing/checkout', { plan }); }
  /* proposed endpoints (see BACKEND.md); the UI falls back gracefully when they are missing */
  showcase() { return req(`/radio-api/showcase?${q({ lang: getLang() })}`).catch(() => null); }
  connectors() { return req('/radio-api/plus/connectors').catch(() => null); }
  aired = {
    fetchIds: async day => { const r = await fetch(`/radio-api/aired?day=${encodeURIComponent(day)}`, { credentials: 'same-origin' }); return r.ok ? (await r.json()).ids ?? null : null; },
    pushIds: async (day, ids) => { const r = await fetch('/radio-api/aired', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day, ids }) }); return r.ok ? (await r.json()).ids ?? null : null; },
  };
  async audio(path) {
    const sep = path.includes('?') ? '&' : '?';
    const url = /\/(intro|teaser|weather)\.wav/.test(path) ? `${path}${sep}lang=${getLang()}` : path;
    const r = await fetch(url, { credentials: 'same-origin' });
    if (r.status === 402 && !isPlus(path)) throw new TrialEnded();
    if (!r.ok) throw new Error(`Audio HTTP ${r.status}`);
    return r.arrayBuffer();
  }
}

/* Demo: no server. Everything is generated locally and labelled as a sample. */
export class DemoApi {
  live = false;
  constructor() { this.trialRemaining = 3600; this.started = false; this.registered = false; this.prefs = { keywords: [], rss_feeds: [] }; this.gmail = false; this.podcastsMade = 0; }
  async me() { return { allowed: this.trialRemaining > 0 || this.registered, registered: this.registered, trial_started: this.started, trial_remaining: this.trialRemaining, plus: false, demo: true }; }
  async startTrial() { this.started = true; return this.me(); }
  async register() { const e = new Error('demo'); e.demo = true; throw e; }
  async login() { const e = new Error('demo'); e.demo = true; throw e; }
  async logout() { return {}; }
  async news(cats) {
    const n = demoNews(cats.filter(c => c !== 'mine'));
    if (cats.includes('mine') && this.gmail) n.categories.unshift({ category: 'mine', stories: gmailSample() });
    return n;
  }
  async mood() { return null; } // handled by the local matcher in ui
  async newsPreferences() { return this.prefs; }
  async saveNewsPreferences(keywords, rss_feeds) { this.prefs = { keywords, rss_feeds }; return this.prefs; }
  async newsDigest() { return this.gmail ? { personal: true, fallback: false, stories: gmailSample() } : { personal: false, fallback: false, stories: [] }; }
  async podcast(topic, hosts) {
    await new Promise(r => setTimeout(r, 1400));
    this.podcastsMade++;
    return { id: `demo-pod-${Date.now()}`, title: topic, parts: toParts(demoPodcast(topic, hosts[0], hosts[1])), demo: true };
  }
  async pills() { return { pills: [] }; }
  async pill() { const e = new Error('demo'); e.demo = true; throw e; }
  async pillsBatch() { const e = new Error('demo'); e.demo = true; throw e; }
  async pillStatus() { return { status: 'error' }; }
  async hostClips() { return null; }
  async billing() { return { registered: false, plus: false, checkout_available: false, plans: [{ id: 'plus', amount_pln: 39 }, { id: 'plus_ai', amount_pln: 59 }], demo: true }; }
  async checkout() { const e = new Error('demo'); e.demo = true; throw e; }
  async showcase() { return null; }
  async connectors() { return { gmail: { available: false, demo: true } }; }
  aired = null;
  async audio() { throw new Error('demo has no audio files'); }
}

export async function detectApi() {
  try {
    const r = await fetch('/radio-api/me', { credentials: 'same-origin' });
    if (r.status !== 404 && (r.headers.get('content-type') || '').includes('json')) return new LiveApi();
  } catch { /* offline or blocked */ }
  return new DemoApi();
}
export const stationFromMood = j => {
  if (!j) return null;
  const id = j.station?.id || j.station || j.id;
  if (typeof id === 'string' && byId[id]) return byId[id];
  if (j.name) return { id: j.id || 'mood', name: j.name, tagline: j.tagline || '', host: j.host || 'Kuba', bpm: j.bpm || 118, density: j.density ?? 0.5, brightness: j.brightness ?? 0.5, cat: 'chill', custom: true, freq: '—' };
  return null;
};
