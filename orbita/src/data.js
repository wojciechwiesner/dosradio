/* Shared data + storage. Keys mirror dosradio.theones.io so both apps share state. */
const RAW = [
  ['dos-groove','Kuba','DOS Groove',122,.45,.45,'fokus'],
  ['lofi-nauka','Ola','Lo-fi Nauka',82,.4,.35,'fokus'],
  ['micro-house','Rafał','Microhouse',124,.5,.4,'fokus'],
  ['deep-tech','Kuba','Deep Tech',124,.5,.35,'fokus'],
  ['dub-techno','Rafał','Dub Techno',122,.4,.3,'fokus'],
  ['deep-house','Zosia','Deep House',122,.5,.45,'chill'],
  ['organic-house','Rafał','Organic House',120,.5,.45,'chill'],
  ['deep-ambient','Ida','Głęboki Ambient',60,.25,.3,'chill'],
  ['stoa','Marek','Stoa',66,.25,.35,'chill'],
  ['detroit-techno','Igor','Detroit Techno',128,.55,.5,'energia'],
  ['tech-house','Max','Tech House',126,.6,.55,'energia'],
  ['melodic-house','Lena','Melodic House',122,.55,.6,'energia'],
  ['progressive-house','Max','Progressive House',126,.6,.65,'energia'],
  ['drum-and-bass','Lena','Drum and Bass',174,.7,.5,'energia'],
  ['trance','Zosia','Trance',138,.65,.7,'energia'],
  ['afro-house','Tadek','Afro House',122,.6,.5,'energia'],
  ['poranna-kawa','Zosia','Poranna Kawa',120,.5,.6,'energia'],
  ['liquid-dnb','Lena','Liquid DnB',174,.6,.5,'energia'],
  ['groove-funk','Tadek','Neo Funk',112,.55,.55,'energia'],
  ['club-dance','Max','Klubowy Dance',128,.65,.6,'energia'],
  ['minimal-techno','Igor','Minimal Techno',126,.55,.4,'energia'],
  ['raw-techno','Wiktor','Mocne Techno',134,.75,.35,'energia'],
  ['warm-jazz','Helena','Nocny Jazz',86,.35,.4,'noc'],
  ['trip-hop','Marta','Trip-hop Wieczór',92,.4,.35,'noc'],
  ['nocny-dub','Szymon','Nocny Dub',84,.35,.3,'noc'],
];
export const STATIONS = RAW.map(([id, host, name, bpm, density, brightness, cat], idx) => ({
  id, host, name, bpm, density, brightness, cat, idx,
  freq: (87.6 + idx * (107.8 - 87.6) / (RAW.length - 1)).toFixed(1),
}));
export const N = STATIONS.length;
export const byId = Object.fromEntries(STATIONS.map(s => [s.id, s]));
export const CATS = {
  fokus: { color: '#8f6bff' }, chill: { color: '#35d0b5' }, energia: { color: '#ff4f9a' }, noc: { color: '#4d7dff' },
};
export const TOPIC_IDS = ['ai', 'beauty', 'sport', 'funny', 'stoic', 'mine'];
export const INTERVALS = [1, 3, 5, 10, 15, 30, 60]; // same choices as the main app
export const CO_HOST = { default: 'Ola', Ola: 'Kuba' };
export const coHostFor = host => CO_HOST[host] || CO_HOST.default;

const safe = fn => { try { return fn(); } catch { return null; } };
const read = k => safe(() => JSON.parse(localStorage.getItem(k) || 'null'));
const write = (k, v) => safe(() => localStorage.setItem(k, JSON.stringify(v)));
export const storage = { read, write };

/* ---------- prefs (dosradio.prefs.v1) ---------- */
export const PREFS_KEY = 'dosradio.prefs.v1';
export const DEFAULT_PREFS = {
  station: 'dos-groove', blend: null, categories: ['ai', 'stoic'], interval: 5, volume: 0.9, voiceVolume: 0.9, duckLevel: 0.34,
  hostMode: 'with-host', newsEnabled: true, dayTopic: null, hourlyBulletin: true, weatherCity: '', weatherLat: null, weatherLon: null,
};
export function sanitizePrefs(p) {
  const o = { ...DEFAULT_PREFS, ...(p || {}) };
  if (!byId[o.station]) o.station = DEFAULT_PREFS.station;
  if (o.blend && (!byId[o.blend] || o.blend === o.station)) o.blend = null;
  o.categories = Array.isArray(o.categories) ? TOPIC_IDS.filter(t => o.categories.includes(t)) : ['ai'];
  if (!o.categories.length) o.categories = ['ai'];
  o.interval = Math.min(60, Math.max(1, Math.round(Number(o.interval) || 5)));
  o.hostMode = o.hostMode === 'music-only' ? 'music-only' : 'with-host';
  o.newsEnabled = o.newsEnabled !== false;
  if (o.dayTopic && !o.categories.includes(o.dayTopic)) o.dayTopic = null;
  o.weatherCity = typeof o.weatherCity === 'string' ? o.weatherCity.trim().slice(0, 80) : '';
  return o;
}
export const loadPrefs = () => sanitizePrefs(read(PREFS_KEY));
export function savePrefs(p) { write(PREFS_KEY, { ...(read(PREFS_KEY) || {}), ...p }); }

/* ---------- aired ids per day (dosradio.aired.v1), optional remote sync ---------- */
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export class AiredStore {
  constructor(remote = null) { this.remote = remote; this.state = this.load(); }
  load() { const s = read('dosradio.aired.v1'); const day = dayKey(new Date()); return s && s.day === day && Array.isArray(s.ids) ? s : { day, ids: [] }; }
  roll() { const d = dayKey(new Date()); if (this.state.day !== d) { this.state = { day: d, ids: [] }; this.persist(); } }
  get ids() { this.roll(); return new Set(this.state.ids); }
  has(id) { return this.ids.has(id); }
  add(id) { this.roll(); if (this.state.ids.includes(id)) return; this.state.ids = [...this.state.ids, id].slice(-500); this.persist(); this.push(); }
  persist() { write('dosradio.aired.v1', this.state); }
  async pull() { if (!this.remote) return; const ids = await this.remote.fetchIds(this.state.day).catch(() => null); if (ids) this.merge(ids); }
  async push() { if (!this.remote) return; const ids = await this.remote.pushIds(this.state.day, this.state.ids).catch(() => null); if (ids) this.merge(ids); }
  merge(ids) { const m = [...new Set([...this.state.ids, ...ids])].slice(-500); if (m.length !== this.state.ids.length) { this.state.ids = m; this.persist(); } }
}

/* ---------- pill queue (dosradio.pillQueue.v1) — "W programie" ---------- */
const PQ_KEY = 'dosradio.pillQueue.v1';
export class PillQueue {
  constructor() {
    const raw = read(PQ_KEY);
    this.items = Array.isArray(raw) ? raw.filter(x => x && typeof x.pillId === 'string' && Array.isArray(x.parts) && Number.isInteger(x.nextIndex) && x.nextIndex < x.parts.length) : [];
    this.listeners = new Set();
  }
  get isEmpty() { return this.items.length === 0; }
  enqueue(p, front = false) {
    if (!p.parts?.length || this.items.length >= 10 || this.items.some(x => x.pillId === p.id)) return false;
    const item = { pillId: p.id, title: p.title, parts: p.parts, nextIndex: 0, showcase: !!p.showcase, whole: !!p.whole };
    front ? this.items.unshift(item) : this.items.push(item); this.save(); return true;
  }
  remove(id) { this.items = this.items.filter(x => x.pillId !== id); this.save(); }
  jumpTo(id, n) { const it = this.items.find(x => x.pillId === id); if (!it || n < 1 || n > it.parts.length) return false; it.nextIndex = n - 1; this.save(); return true; }
  peekUnit() { // a voice part followed by a clip airs as one unit
    const it = this.items[0]; if (!it) return null;
    const rest = it.parts.slice(it.nextIndex);
    if (!rest.length) return null;
    if (it.whole) return rest; // scripted showcase pieces air in one go
    return rest[0].kind !== 'clip' && rest[1]?.kind === 'clip' ? rest.slice(0, 2) : rest.slice(0, 1);
  }
  current() { return this.items[0] || null; }
  commitUnit() { const it = this.items[0], u = this.peekUnit(); if (!it || !u) return; it.nextIndex += u.length; if (it.nextIndex >= it.parts.length) this.items.shift(); this.save(); }
  progress() { return this.items.map(x => ({ pillId: x.pillId, title: x.title, done: x.nextIndex, total: x.parts.length })); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() {
    // showcase (demo-generated) pills hold tts parts that the main app cannot play: keep them out of shared storage
    write(PQ_KEY, this.items.filter(x => !x.showcase && x.parts.every(p => p.url)));
    this.listeners.forEach(f => f());
  }
}
