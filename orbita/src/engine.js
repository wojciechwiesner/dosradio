/* Radio engine: port of the dosradio.theones.io player (break scheduler, programme planner, pill queue,
   host clips, ducking) plus podcasts, the opening intro and on-screen hosts/captions. */
import { t, getLang, fmtClock, topicLabel, stationName } from './i18n.js';
import { AiredStore, PillQueue, coHostFor } from './data.js';
import { DemoSynth, LiveMusic } from './audio.js';
import { TrialEnded } from './api.js';
import { introScript } from './content.js';

const MIN = 60000, FIRST_BREAK = 5 * MIN, AFTER_BREAK_GAP = 45000, NEWS_REFRESH = 10 * MIN, HOURLY_MAX = 4 * MIN;
const hourKey = d => `${d.toDateString()}T${d.getHours()}`;
const hasHeadline = s => !!s.headline;
const isMine = s => s.category === 'personal' || s.category === 'mine';

/* interleave categories so topics alternate */
function interleave(cats) { const out = [], max = Math.max(0, ...cats.map(c => c.stories.length)); for (let i = 0; i < max; i++) for (const c of cats) if (c.stories[i]) out.push(c.stories[i]); return out; }
function rank(queue, aired, dayTopic) {
  const score = s => (isMine(s) ? 4 : 0) + (s.category === dayTopic ? 2 : 0) + (s.audio_ready ? 1 : 0);
  return queue.map((s, i) => ({ s, i })).filter(({ s }) => !aired.has(s.id)).sort((a, b) => score(b.s) - score(a.s) || a.i - b.i).map(x => x.s);
}
export function planBreak(c) {
  const ranked = rank(c.queue, c.aired, c.dayTopic);
  if (c.hourlyEnabled && hourKey(c.now) !== c.lastHourlyKey) {
    const full = ranked.slice(0, 2);
    if (full.length || c.weatherEnabled) return { kind: 'hourly', headlines: ranked.slice(2).filter(hasHeadline).slice(0, 4), full, teaser: null, weather: c.weatherEnabled, empty: false };
  }
  const [first, ...rest] = ranked;
  if (!first) return { kind: 'main', headlines: [], full: [], teaser: null, weather: false, empty: true };
  if (c.lastFormat !== 'flash') {
    const h = rest.filter(s => hasHeadline(s) && !c.headlined.has(s.id)).slice(0, 3);
    if (h.length) return { kind: 'flash', headlines: h, full: [], teaser: first, weather: false, empty: false };
  }
  return { kind: 'main', headlines: [], full: [first], teaser: rest[0] ?? null, weather: false, empty: false };
}

export class RadioEngine {
  constructor({ core, api, prefs, events }) {
    this.core = core; this.api = api; this.events = events;
    this.synth = new DemoSynth(core);
    this.liveMusic = new LiveMusic(core, { onTrialEnded: () => this.endTrial(), onError: () => this.recover() });
    this.aired = new AiredStore(api.live ? api.aired : null);
    this.pills = new PillQueue();
    this.queue = []; this.timers = []; this.playing = false; this.speaking = false; this.busy = null;
    this.headlined = new Set(); this.lastFormat = null; this.lastHourlyKey = null;
    this.mode = 'idle'; // idle | music | news | host | podcast | pill | intro
    this.applyPrefs(prefs);
    this.station = prefs.stationObj;
    this.firstBreakMs = FIRST_BREAK;
    this.introDone = false;
    this.clipTimer = 0;
  }
  applyPrefs(p) {
    this.prefs = p; this.interval = p.interval; this.hostMode = p.hostMode; this.categories = p.categories; this.newsEnabled = p.newsEnabled;
    this.dayTopic = p.dayTopic; this.hourlyEnabled = p.hourlyBulletin;
    this.place = (p.weatherCity || (p.weatherLat !== null && p.weatherLon !== null)) ? { city: p.weatherCity, lat: p.weatherLat, lon: p.weatherLon } : null;
    this.core.voiceGain && this.core.voiceGain.gain.setTargetAtTime(p.voiceVolume ?? 0.9, this.core.t, 0.05);
  }
  get hosts() { const a = this.station.host || 'Kuba'; return [a, coHostFor(a)]; }

  /* ---------------- lifecycle ---------------- */
  async start({ intro = !this.introDone } = {}) {
    if (this.playing) return;
    this.core.init(); await this.core.ctx.resume();
    this.playing = true; this.startedAt = new Date(); this.lastBreakAt = null; this.lastBreakEndedAt = null;
    this.headlined.clear(); this.lastFormat = null; this.lastHourlyKey = hourKey(new Date());
    this.aired.pull();
    this.events.onState('loading');
    const ok = await this.startMusic();
    if (!this.playing) return;
    this.events.onStatus(ok ? t('st_playing', { name: stationName(this.station) }) : t('st_reconnect'));
    this.events.onState('playing'); this.setMode('music');
    if (this.hostMode === 'with-host') {
      this.refreshNews(); this.newsTimer = setInterval(() => this.refreshNews(), NEWS_REFRESH);
      if (intro) await this.playIntro();
      this.scheduleNextBreak(); this.scheduleClip();
    } else this.events.onNextBreak(null);
  }
  stop() {
    this.clearSchedule(); clearInterval(this.newsTimer); clearTimeout(this.clipTimer);
    this.synth.stop(); this.liveMusic.stop(); this.core.stopVoice();
    this.playing = false; this.speaking = false; this.busy = null; this.setMode('idle');
    this.events.onState('paused'); this.events.onHost(null);
  }
  async startMusic() {
    this.core.duck(1, 0.3);
    if (!this.api.live) { this.synth.start(this.station); return true; }
    this.core.onsetLive = true;
    return this.liveMusic.start(this.station);
  }
  async setStation(st) {
    this.station = st;
    if (!this.playing) return;
    if (!this.api.live) this.synth.set(st); else await this.liveMusic.setStation(st);
    if (!this.speaking) this.events.onStatus(t('st_playing', { name: stationName(st) }));
  }
  setHostMode(m) {
    this.hostMode = m;
    if (!this.playing) return;
    this.clearSchedule();
    if (m === 'with-host') { this.scheduleNextBreak(); this.scheduleClip(); } else { clearTimeout(this.clipTimer); this.events.onNextBreak(null); this.emitSchedule(); }
  }
  setInterval(n) { this.interval = n; if (this.playing && this.hostMode === 'with-host' && !this.speaking) { this.clearSchedule(); this.scheduleNextBreak(); } }
  async setCategories(c) { this.categories = c; if (this.playing && this.hostMode === 'with-host') await this.refreshNews(); }
  endTrial() { this.stop(); this.events.onTrialEnded(); }
  recover() { if (!this.playing) return; this.events.onStatus(t('st_reconnect')); setTimeout(() => this.playing && this.startMusic(), 2000); }

  /* ---------------- news ---------------- */
  async refreshNews() {
    try {
      const { categories } = await this.api.news(this.categories);
      this.queue = interleave(categories);
      this.events.onQueue(this.queue, null); this.emitUpcoming();
    } catch (e) { if (e instanceof TrialEnded) this.endTrial(); }
  }
  ctx(now) {
    return { now, queue: this.queue, aired: this.aired.ids, headlined: this.headlined, dayTopic: this.dayTopic, lastFormat: this.lastFormat, lastHourlyKey: this.lastHourlyKey, hourlyEnabled: this.hourlyEnabled, weatherEnabled: !!this.place };
  }
  nextBreakTime() {
    if (!this.lastBreakAt) return new Date(this.startedAt.getTime() + this.firstBreakMs);
    const a = this.lastBreakAt.getTime() + this.interval * MIN, b = this.lastBreakEndedAt ? this.lastBreakEndedAt.getTime() + AFTER_BREAK_GAP : 0;
    return new Date(Math.max(a, b));
  }
  clearSchedule() { this.timers.forEach(clearTimeout); this.timers = []; }
  scheduleNextBreak() {
    if (this.hostMode === 'music-only' || (!this.newsEnabled && this.pills.isEmpty)) { this.events.onNextBreak(null); this.emitSchedule(); return; }
    const at = this.nextBreakTime(); this.nextSlot = at;
    this.events.onNextBreak(at); this.emitUpcoming(); this.emitSchedule();
    this.timers.push(setTimeout(async () => { await this.airBreak(at); if (this.playing && this.hostMode === 'with-host') this.scheduleNextBreak(); }, Math.max(0, at - Date.now())));
  }
  emitUpcoming() { const p = planBreak(this.ctx(this.nextSlot || new Date())); this.events.onUpcoming(p.full[0] ?? p.teaser ?? null); }
  emitSchedule() {
    const items = [];
    if (this.playing && this.hostMode === 'with-host' && this.nextSlot) {
      let at = this.nextSlot.getTime();
      const pill = this.pills.current();
      for (let i = 0; i < 4; i++) {
        const d = new Date(at), hourly = this.hourlyEnabled && hourKey(d) !== (i === 0 ? this.lastHourlyKey : hourKey(new Date(at - this.interval * MIN)));
        items.push({ at: d, kind: hourly ? 'hourly' : 'news', label: hourly ? t('schHourly') : `${t('schNews')} · ${this.categories.map(topicLabel).join(', ')}` });
        if (i === 0 && pill) items.push({ at: d, kind: 'pill', label: t('schPill', { title: pill.title }) });
        at += this.interval * MIN;
      }
    }
    this.events.onSchedule(items);
  }

  /* parts for one break (live: wav paths with captions; demo: tts text) */
  breakParts(plan, at) {
    const live = this.api.live, hhmm = fmtClock(at), st = this.station.id, parts = [];
    const speak = (text, extra) => parts.push(live && !extra.story?.sample ? { kind: 'voice', caption: text, ...extra } : { kind: 'tts', who: 'A', text, ...extra, url: undefined });
    if (!plan.empty) speak(t(plan.kind === 'hourly' ? 'tts_hourly' : 'tts_intro', { time: hhmm }), { url: `/radio-api/intro.wav?time=${encodeURIComponent(hhmm)}&station=${st}&kind=${plan.kind}`, role: 'intro' });
    for (const s of plan.headlines) speak(s.headline, { url: `/radio-api/story/${s.id}/headline.wav`, storyId: s.id, role: 'headline', story: s });
    for (const s of plan.full) speak(s.radio_text, { url: `/radio-api/story/${s.id}.wav`, storyId: s.id, role: 'story', story: s });
    if (plan.weather && this.place) {
      const p = new URLSearchParams({ station: st }); if (this.place.city) p.set('city', this.place.city);
      if (this.place.lat !== null && this.place.lon !== null) { p.set('lat', this.place.lat.toFixed(3)); p.set('lon', this.place.lon.toFixed(3)); }
      speak(t('tts_weather'), { url: `/radio-api/weather.wav?${p}`, role: 'weather' });
    }
    if (plan.teaser) speak(t('tts_teaser', { h: plan.teaser.headline || plan.teaser.title }), { url: `/radio-api/teaser.wav?${new URLSearchParams({ story: plan.teaser.id, station: st })}`, storyId: plan.teaser.id, role: 'teaser' });
    return parts;
  }
  async airBreak(at, forced = false) {
    if ((this.speaking && !forced) || (!this.playing && !forced) || this.hostMode === 'music-only') return;
    if (forced && this.speaking) this.core.stopVoice();
    this.lastBreakAt = new Date();
    let plan = this.newsEnabled || forced ? planBreak(this.ctx(this.lastBreakAt)) : { empty: true, headlines: [], full: [] };
    if (forced && plan.empty && this.queue.length) plan = { kind: 'flash', headlines: this.queue.slice(1, 4).filter(hasHeadline), full: [this.queue[0]], teaser: null, weather: false, empty: false };
    const pillUnit = this.pills.peekUnit(), pill = this.pills.current();
    if (plan.empty && !pillUnit) { await this.airFiller(); return; }
    const parts = this.breakParts(plan, at || new Date());
    const aired = [];
    this.speaking = true; this.setMode('news');
    try {
      this.core.duck(this.prefs.duckLevel ?? 0.34, 1.2); await sleep(600);
      const deadline = plan.kind === 'hourly' ? Date.now() + HOURLY_MAX : Infinity;
      for (const p of parts) {
        if (!this.speaking || Date.now() > deadline) break;
        if (p.story) { this.events.onOnAir(p.story); this.events.onQueue(this.queue, p.story.id); }
        else if (p.role === 'weather') this.events.onOnAir({ id: 'weather', category: 'weather', title: t('tts_weather'), radio_text: '' });
        const ok = await this.say(p, { kind: 'news', hosts: [this.hosts[0]] });
        if (ok) aired.push(p);
      }
      if (pillUnit && this.speaking) {
        this.setMode('pill'); this.events.onOnAir(null);
        for (const [i, p] of pillUnit.entries()) {
          if (!this.speaking) break;
          await this.say({ ...p, caption: p.caption || pill.title }, { kind: 'pill', hosts: this.hosts, title: pill.title, index: pill.nextIndex + i });
        }
        this.pills.commitUnit(); this.events.onPills();
      }
      if (parts.length && !aired.length && this.api.live) this.events.onStatus(t('st_newsFail'), true);
      this.events.onBreakAired(aired.filter(p => p.role === 'story' || p.role === 'headline').length, plan, aired);
    } catch (e) { if (e instanceof TrialEnded) return this.endTrial(); }
    finally {
      if (!plan.empty) {
        for (const p of aired) { if (p.role === 'story') this.aired.add(p.storyId); else if (p.role === 'headline') this.headlined.add(p.storyId); }
        if (plan.kind === 'hourly') this.lastHourlyKey = hourKey(new Date()); else this.lastFormat = plan.kind;
      }
      this.lastBreakEndedAt = new Date();
      this.speaking = false; this.events.onOnAir(null); this.events.onQueue(this.queue, null); this.events.onHost(null);
      if (this.playing) { this.core.duck(1, 2); this.setMode('music'); }
      this.emitUpcoming();
    }
  }
  async newsNow() {
    if (this.hostMode === 'music-only') return;
    if (!this.playing) await this.start({ intro: false });
    if (!this.queue.length) await this.refreshNews();
    await this.airBreak(new Date(), true);
    if (this.playing && this.hostMode === 'with-host') { this.clearSchedule(); this.scheduleNextBreak(); }
  }
  async airFiller() {
    this.events.onStatus(t('st_filler'));
    const lines = t('tts_chatter');
    await this.hostMoment({ kind: 'tts', who: 'A', text: lines[(Math.random() * lines.length) | 0] }, 'host');
  }

  /* ---------------- voice ---------------- */
  /* one spoken part; returns true when it played */
  async say(p, ctx) {
    const who = p.who || 'A';
    const name = ctx.hosts.length > 1 ? ctx.hosts[who === 'B' ? 1 : 0] : ctx.hosts[0];
    if (p.kind === 'bumper' || p.kind === 'music') {
      this.events.onHost({ ...ctx, speaking: false, who: null, caption: '♪' });
      this.core.duck(1, 0.4);
      if (p.url) { const b = await this.decode(p.url); if (b) await this.core.playBuffer(b, 'music'); }
      else await this.synth.sting(this.station);
      this.core.duck(this.prefs.duckLevel ?? 0.34, 0.6);
      return true;
    }
    const caption = p.text || p.caption || '';
    this.events.onHost({ ...ctx, speaking: true, who: p.kind === 'clip' ? 'clip' : who, name, caption });
    if (p.kind === 'tts' || (!p.url && caption)) { await this.core.speak(caption, who); return true; }
    const buf = await this.decode(p.url);
    if (!buf) return false;
    await this.core.playBuffer(buf, 'voice');
    return true;
  }
  async decode(url) {
    try { return await this.core.ctx.decodeAudioData(await this.api.audio(url)); }
    catch (e) { if (e instanceof TrialEnded) throw e; return null; }
  }
  async hostMoment(part, kind) {
    if (this.speaking) return;
    this.speaking = true; this.setMode('host');
    try { this.core.duck(this.prefs.duckLevel ?? 0.34, 0.8); await sleep(400); await this.say(part, { kind, hosts: [this.hosts[0]] }); }
    finally { this.speaking = false; this.events.onHost(null); if (this.playing) { this.core.duck(1, 1.6); this.setMode('music'); } }
  }
  /* The opening: host explains what the radio is and can do. Live tries the station's welcome clip first. */
  async playIntro() {
    this.introDone = true;
    this.speaking = true; this.setMode('intro');
    try {
      this.core.duck(0.22, 0.6); await sleep(500);
      const lines = introScript(this.hosts[0]);
      for (const text of lines) {
        if (!this.speaking || !this.playing) break;
        await this.say({ kind: 'tts', who: 'A', text }, { kind: 'intro', hosts: [this.hosts[0]] });
      }
    } finally {
      this.speaking = false; this.events.onHost(null); this.events.onIntroDone();
      if (this.playing) { this.core.duck(1, 1.8); this.setMode('music'); }
      this.lastBreakAt = null; this.startedAt = new Date();
    }
  }
  scheduleClip() {
    clearTimeout(this.clipTimer);
    const wait = (6 + Math.random() * 6) * MIN;
    this.clipTimer = setTimeout(async () => {
      if (this.playing && this.hostMode === 'with-host' && !this.speaking) {
        const clips = this.api.live ? await this.api.hostClips(this.station.id) : null;
        const urls = clips ? [...clips.jingles, ...clips.chatter] : [];
        const part = urls.length ? { kind: 'voice', url: urls[(Math.random() * urls.length) | 0], caption: t('tts_jingle') }
          : { kind: 'tts', who: 'A', text: Math.random() < 0.4 ? t('tts_jingle') : t('tts_chatter')[(Math.random() * 3) | 0] };
        await this.hostMoment(part, 'host');
      }
      if (this.playing) this.scheduleClip();
    }, wait);
  }
  /* a spoken line outside the schedule (sales nudges, thought of the day) */
  async announce(text, kind = 'host') { if (!this.playing || this.speaking) return false; await this.hostMoment({ kind: 'tts', who: 'A', text }, kind); return true; }

  /* ---------------- podcasts & pills ---------------- */
  async playPodcast(pod, { kind = 'podcast' } = {}) {
    if (!this.playing) await this.start({ intro: false });
    this.clearSchedule(); this.core.stopVoice();
    this.speaking = true; this.setMode(kind);
    const hosts = this.hosts; let voiceIdx = 0;
    this.busy = pod.id;
    try {
      this.core.duck(0.18, 0.8); await sleep(500);
      for (let i = 0; i < pod.parts.length; i++) {
        if (this.busy !== pod.id || !this.playing) break;
        const p = pod.parts[i];
        // live podcast parts do not say who speaks: alternate voices between the two hosts
        const who = p.who || (p.kind === 'voice' ? (voiceIdx++ % 2 ? 'B' : 'A') : 'A');
        this.events.onStatus(t('podPlaying', { title: pod.title, i: i + 1, n: pod.parts.length }));
        await this.say({ ...p, who, caption: p.text || p.caption || pod.title }, { kind, hosts, title: pod.title, index: i });
      }
      if (this.busy === pod.id) this.events.onStatus(t('podDone', { title: pod.title }));
    } finally {
      const finished = this.busy === pod.id; this.busy = null;
      this.speaking = false; this.events.onHost(null);
      if (this.playing) { this.core.duck(1, 1.8); this.setMode('music'); if (this.hostMode === 'with-host') this.scheduleNextBreak(); }
      this.events.onPodcastEnd(pod, finished);
    }
  }
  stopPodcast() { this.busy = null; this.core.stopVoice(); }
  enqueuePill(p, front = false) {
    const ok = this.pills.enqueue(p, front);
    if (ok && this.playing && this.hostMode === 'with-host' && !this.speaking) { this.clearSchedule(); this.scheduleNextBreak(); }
    this.events.onPills(); return ok;
  }
  setMode(m) { this.mode = m; this.events.onMode(m); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export { getLang };
