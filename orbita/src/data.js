/* Shared data + storage. Keys mirror dosradio.theones.io so both apps share state. */
export const MUSIC_GROUPS = [
  {
    id: 'fokus-puls',
    name: 'Fokus i Puls',
    tagline: 'Równy rytm do pracy i skupienia',
    color: '#2be38b',
    stations: ['dos-groove', 'lofi-nauka', 'micro-house', 'deep-tech', 'dub-techno', 'minimal-techno'],
  },
  {
    id: 'klub-energia',
    name: 'Klub i Energia',
    tagline: 'Parkiet, bas i wysokie tempo',
    color: '#ff9d2b',
    stations: ['tech-house', 'club-dance', 'detroit-techno', 'melodic-house', 'progressive-house', 'trance', 'drum-and-bass', 'liquid-dnb'],
  },
  {
    id: 'synth-filmowa',
    name: 'Synth i Filmowa',
    tagline: 'Analogowe arpeggia, Stranger Synth i kino',
    color: '#ff4d6d',
    stations: ['stranger-synth', 'muzyka-filmowa', 'cyber-noir'],
  },
  {
    id: 'klasyka-instrumentalna',
    name: 'Klasyka i Instrumentalna',
    tagline: 'Smyczki, fortepian i żywe instrumenty',
    color: '#c9a227',
    stations: ['muzyka-klasyczna', 'instrumentalna-akustyczna', 'stoa'],
  },
  {
    id: 'etno-folk',
    name: 'Etno i Folk',
    tagline: 'Rytmy świata, słowiańska dusza i perkusjonalia',
    color: '#e07a5f',
    stations: ['etno-world', 'slowianski-folk', 'afro-house', 'organic-house'],
  },
  {
    id: 'chill-noc',
    name: 'Chill i Noc',
    tagline: 'Ciepły wieczór, jazz, ambient i dub',
    color: '#7aa2f7',
    stations: ['deep-house', 'poranna-kawa', 'groove-funk', 'deep-ambient', 'warm-jazz', 'trip-hop', 'nocny-dub'],
  },
  {
    id: 'techno-rave',
    name: 'Techno i Rave',
    tagline: 'Berlin BCCO, raw, hypnotic, tribal, Goa i twardy parkiet',
    color: '#e11d48',
    stations: ['berlin-bcco-techno', 'raw-techno', 'hypnotic-techno', 'etno-techno', 'tribal-techno', 'goa-trance', 'hard-dance', 'tekk'],
  },
  {
    id: 'przestrzenie-b2b',
    name: 'Przestrzenie i Lokale',
    tagline: 'Salon beauty/spa, lobby hotelowe i poczekalnia',
    color: '#d4a373',
    stations: ['salon-beauty-spa', 'lobby-hotelowe', 'poczekalnia'],
  },
];

const RAW = [
  ['dos-groove','Kuba','DOS Groove',122,.45,.45,'fokus','fokus-puls'],
  ['lofi-nauka','Ola','Lo-fi Nauka',82,.4,.35,'fokus','fokus-puls'],
  ['micro-house','Rafał','Microhouse',124,.5,.4,'fokus','fokus-puls'],
  ['deep-tech','Kuba','Deep Tech',124,.5,.35,'fokus','fokus-puls'],
  ['dub-techno','Rafał','Dub Techno',122,.4,.3,'fokus','fokus-puls'],
  ['deep-house','Zosia','Deep House',122,.5,.45,'chill','chill-noc'],
  ['organic-house','Rafał','Organic House',120,.5,.45,'chill','etno-folk'],
  ['deep-ambient','Ida','Głęboki Ambient',60,.25,.3,'chill','chill-noc'],
  ['stoa','Marek','Stoa',66,.25,.35,'chill','klasyka-instrumentalna'],
  ['detroit-techno','Igor','Detroit Techno',128,.55,.5,'energia','klub-energia'],
  ['tech-house','Max','Tech House',126,.6,.55,'energia','klub-energia'],
  ['melodic-house','Lena','Melodic House',122,.55,.6,'energia','klub-energia'],
  ['progressive-house','Max','Progressive House',126,.6,.65,'energia','klub-energia'],
  ['drum-and-bass','Lena','Drum and Bass',174,.7,.5,'energia','klub-energia'],
  ['trance','Zosia','Trance',138,.65,.7,'energia','klub-energia'],
  ['afro-house','Tadek','Afro House',122,.6,.5,'energia','etno-folk'],
  ['poranna-kawa','Zosia','Poranna Kawa',120,.5,.6,'energia','chill-noc'],
  ['liquid-dnb','Lena','Liquid DnB',174,.6,.5,'energia','klub-energia'],
  ['groove-funk','Tadek','Neo Funk',112,.55,.55,'energia','chill-noc'],
  ['club-dance','Max','Klubowy Dance',128,.65,.6,'energia','klub-energia'],
  ['minimal-techno','Igor','Minimal Techno',126,.55,.4,'energia','fokus-puls'],
  ['raw-techno','Wiktor','Raw Techno',138,.8,.35,'energia','techno-rave'],
  ['berlin-bcco-techno','Wiktor','Berlin BCCO Techno',140,.78,.42,'energia','techno-rave'],
  ['hypnotic-techno','Rafał','Hypnotic Techno',134,.68,.32,'fokus','techno-rave'],
  ['etno-techno','Kuba','Etno Techno',126,.66,.46,'fokus','techno-rave'],
  ['tribal-techno','Wiktor','Tribal',136,.82,.44,'energia','techno-rave'],
  ['goa-trance','Wiktor','Goa Trance',142,.78,.58,'energia','techno-rave'],
  ['hard-dance','Filip','Hard Dance',148,.84,.54,'energia','techno-rave'],
  ['tekk','Wiktor','Tekk',155,.86,.38,'energia','techno-rave'],
  ['salon-beauty-spa','Ola','Salon Beauty & Spa',96,.34,.56,'chill','przestrzenie-b2b'],
  ['lobby-hotelowe','Helena','Lobby Hotelowe',104,.42,.54,'chill','przestrzenie-b2b'],
  ['poczekalnia','Ola','Poczekalnia',76,.24,.5,'chill','przestrzenie-b2b'],
  ['warm-jazz','Helena','Nocny Jazz',86,.35,.4,'noc','chill-noc'],
  ['trip-hop','Marta','Trip-hop Wieczór',92,.4,.35,'noc','chill-noc'],
  ['nocny-dub','Szymon','Nocny Dub',84,.35,.3,'noc','chill-noc'],
  ['stranger-synth','Igor','Stranger Synth',108,.55,.45,'noc','synth-filmowa'],
  ['muzyka-filmowa','Marek','Muzyka Filmowa',88,.5,.45,'chill','synth-filmowa'],
  ['cyber-noir','Wiktor','Cyber Noir',94,.4,.35,'noc','synth-filmowa'],
  ['muzyka-klasyczna','Helena','Muzyka Klasyczna',76,.4,.45,'fokus','klasyka-instrumentalna'],
  ['instrumentalna-akustyczna','Ida','Instrumentalna Akustyczna',90,.35,.45,'chill','klasyka-instrumentalna'],
  ['etno-world','Tadek','Etno i World',104,.5,.5,'chill','etno-folk'],
  ['slowianski-folk','Marta','Słowiański Folk',106,.5,.45,'energia','etno-folk'],
];
export const STATIONS = RAW.map(([id, host, name, bpm, density, brightness, cat, group], idx) => ({
  id, host, name, bpm, density, brightness, cat, group, idx,
  freq: (87.6 + idx * (107.8 - 87.6) / (RAW.length - 1)).toFixed(1),
}));
export const N = STATIONS.length;
export const byId = Object.fromEntries(STATIONS.map(s => [s.id, s]));
export const groupById = id => MUSIC_GROUPS.find(g => g.id === id) || null;
export const stationsForGroup = gid => {
  const g = groupById(gid);
  if (!g) return STATIONS.filter(s => s.group === gid && s.enabled !== false);
  return g.stations.map(sid => byId[sid]).filter(s => s && s.enabled !== false);
};
export const nextStationInGroup = (gid, curId) => {
  const list = stationsForGroup(gid);
  if (!list.length) return byId[curId] || STATIONS[0];
  const i = list.findIndex(s => s.id === curId);
  return list[(i + 1) % list.length];
};
export function applyCatalog(payload) {
  if (!payload || !Array.isArray(payload.stations)) return STATIONS;
  for (const raw of payload.stations) {
    if (!raw || typeof raw.id !== 'string') continue;
    if (raw.enabled === false) {
      if (byId[raw.id]) byId[raw.id].enabled = false;
      continue;
    }
    if (byId[raw.id]) {
      Object.assign(byId[raw.id], {
        name: raw.name ?? byId[raw.id].name,
        host: raw.host ?? byId[raw.id].host,
        bpm: typeof raw.bpm === 'number' ? raw.bpm : byId[raw.id].bpm,
        group: raw.group ?? byId[raw.id].group,
        enabled: true,
      });
    } else {
      const idx = STATIONS.length;
      const st = {
        id: raw.id,
        host: raw.host || 'Kuba',
        name: raw.name || raw.id,
        tagline: raw.tagline || '',
        bpm: Number(raw.bpm) || 120,
        density: Number(raw.density) || 0.5,
        brightness: Number(raw.brightness) || 0.5,
        cat: raw.category || 'fokus',
        group: raw.group || 'fokus-puls',
        idx,
        freq: (87.6 + (idx % 32) * 0.6).toFixed(1),
        custom: true,
        enabled: true,
      };
      STATIONS.push(st);
      byId[st.id] = st;
      const g = groupById(st.group);
      if (g && !g.stations.includes(st.id)) g.stations.push(st.id);
    }
  }
  return STATIONS;
}
export function computeAutoRamowkaSlot(now = new Date()) {
  let h = now.getHours();
  try {
    const parts = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: 'numeric', hour12: false }).formatToParts(now);
    const hp = parts.find(p => p.type === 'hour');
    if (hp) h = Number.parseInt(hp.value, 10) % 24;
  } catch { /* fallback */ }
  const spots = [
    { id: 'zrobimy-ai', title: 'zrobi.my — Automatyzacja AI i agenci głosowi dla firm' },
    { id: 'dosradio-ramowka', title: 'DOS Radio — Auto-Ramówka 24/7 i własne pasma muzyczne' },
    { id: 'zrobimy-wdrozenia', title: 'zrobi.my — Dedykowane wdrożenia AI w 14 dni' },
  ];
  const spot = spots[Math.floor((h * 60 + now.getMinutes()) / 20) % spots.length];
  if (h >= 6 && h < 9) return { id: 'poranny-rozruch', label: 'Poranny Rozruch', hours: '06:00–09:00', groupId: 'fokus-puls', stationId: 'poranna-kawa', host: 'Zosia', spotId: spot.id, spotTitle: spot.title, ctaLabel: 'Zamów wdrożenie AI · zrobi.my', ctaUrl: 'https://zrobi.my?utm_source=dosradio&utm_medium=ramowka' };
  if (h >= 9 && h < 13) return { id: 'gleboki-fokus', label: 'Głęboki Fokus', hours: '09:00–13:00', groupId: 'fokus-puls', stationId: 'dos-groove', host: 'Kuba', spotId: spot.id, spotTitle: spot.title, ctaLabel: 'Zamów wdrożenie AI · zrobi.my', ctaUrl: 'https://zrobi.my?utm_source=dosradio&utm_medium=ramowka' };
  if (h >= 13 && h < 17) return { id: 'popoludniowy-puls', label: 'Popołudniowy Puls', hours: '13:00–17:00', groupId: 'synth-filmowa', stationId: 'stranger-synth', host: 'Igor', spotId: spot.id, spotTitle: spot.title, ctaLabel: 'Zamów wdrożenie AI · zrobi.my', ctaUrl: 'https://zrobi.my?utm_source=dosradio&utm_medium=ramowka' };
  if (h >= 17 && h < 20) return { id: 'zlota-godzina', label: 'Złota Godzina', hours: '17:00–20:00', groupId: 'etno-folk', stationId: 'organic-house', host: 'Rafał', spotId: spot.id, spotTitle: spot.title, ctaLabel: 'Zamów wdrożenie AI · zrobi.my', ctaUrl: 'https://zrobi.my?utm_source=dosradio&utm_medium=ramowka' };
  if (h >= 20 && h < 24) return { id: 'wieczorny-klub-synth', label: 'Wieczorny Klub & Synth', hours: '20:00–24:00', groupId: 'klub-energia', stationId: 'melodic-house', host: 'Lena', spotId: spot.id, spotTitle: spot.title, ctaLabel: 'Zamów wdrożenie AI · zrobi.my', ctaUrl: 'https://zrobi.my?utm_source=dosradio&utm_medium=ramowka' };
  return { id: 'nocna-cisza', label: 'Nocna Cisza', hours: '00:00–06:00', groupId: 'chill-noc', stationId: 'warm-jazz', host: 'Helena', spotId: spot.id, spotTitle: spot.title, ctaLabel: 'Zamów wdrożenie AI · zrobi.my', ctaUrl: 'https://zrobi.my?utm_source=dosradio&utm_medium=ramowka' };
}
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
export const VIEW_KEY = 'dosradio.view.v1';
export function saveViewPref(v) { safe(() => localStorage.setItem(VIEW_KEY, v === 'orbita' ? 'orbita' : 'classic')); }
export function loadViewPref() { return safe(() => localStorage.getItem(VIEW_KEY)) === 'orbita' ? 'orbita' : 'classic'; }
export const DEFAULT_PREFS = {
  station: 'dos-groove', blend: null, categories: ['ai', 'stoic'], interval: 5, volume: 0.9, voiceVolume: 0.9, duckLevel: 0.24,
  hostMode: 'with-host', newsEnabled: true, dayTopic: null, hourlyBulletin: true, weatherCity: '', weatherLat: null, weatherLon: null,
  playGroup: null, activeGroup: null, autoRamowka: false,
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
  o.playGroup = o.playGroup && groupById(o.playGroup) ? o.playGroup : null;
  o.activeGroup = o.activeGroup && groupById(o.activeGroup) ? o.activeGroup : null;
  o.autoRamowka = o.autoRamowka === true;
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
