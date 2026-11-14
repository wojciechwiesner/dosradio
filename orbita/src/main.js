import { STATIONS, N, byId, CATS, TOPIC_IDS, INTERVALS, loadPrefs, savePrefs, sanitizePrefs } from './data.js';
import { t, setLang, detectLang, getLang, LANGS, LANG_NAMES, stationName, stationTag, topicLabel, intervalText, fmtClock, fmtLeft } from './i18n.js';
import { AudioCore } from './audio.js';
import { detectApi, stationFromMood } from './api.js';
import { RadioEngine } from './engine.js';
import { createScene, STEP } from './scene.js';
import { Sales } from './sales.js';
import { radioPane, minePane, podsPane } from './panes.js';
import { stoicThoughts, stoicPill, stoicPillTitle, toParts, gmailSample } from './content.js';

const $ = s => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const vibrate = ms => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
setLang(detectLang());

/* =========================================================  app state  */
const app = {
  api: null, core: new AudioCore(), engine: null, scene: null, sales: null,
  me: null, billing: null, connectors: null,
  mineState: { keywords: [], feeds: [], digest: [], gmailSample: false },
  podState: { pills: [], current: null },
  history: [],
};
let prefs = loadPrefs();
Object.defineProperty(app, 'prefs', { get: () => prefs });

/* =========================================================  toast / announce  */
let toastTimer = 0;
app.toast = (msg, { action, onAction, error, long } = {}) => {
  const el = $('#toast'), btn = $('#toastAct');
  $('#toastMsg').textContent = msg; el.classList.toggle('error', !!error);
  btn.hidden = !action; btn.textContent = action || ''; btn.onclick = () => { el.hidden = true; onAction?.(); };
  el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, long ? 8000 : action ? 4500 : 2600);
};
app.announce = msg => { $('#sr').textContent = msg; };

/* =========================================================  prefs: commit / undo  */
function applyToEngine(prev) {
  const e = app.engine; if (!e) return;
  e.applyPrefs({ ...prefs });
  if (prev.hostMode !== prefs.hostMode) e.setHostMode(prefs.hostMode);
  if (prev.interval !== prefs.interval) e.setInterval(prefs.interval);
  if (prev.categories.join() !== prefs.categories.join()) e.setCategories(prefs.categories);
  if (prev.station !== prefs.station && byId[prefs.station]) e.setStation(byId[prefs.station]);
  e.emitSchedule?.();
}
app.commit = (mutate, msg, { toast = false, render = true } = {}) => {
  const before = JSON.stringify(prefs), prev = prefs;
  const next = structuredClone(prefs); mutate(next);
  const clean = sanitizePrefs(next);
  if (JSON.stringify(clean) === before) return false;
  app.history.push(before); if (app.history.length > 50) app.history.shift();
  prefs = clean; savePrefs(prefs); applyToEngine(prev);
  if (render) { renderCard(); app.renderPane('radio'); syncLabels(); }
  if (msg) { app.announce(msg); if (toast) app.toast(msg, { action: t('undo'), onAction: undo }); }
  return true;
};
function undo() {
  const prev = app.history.pop();
  if (!prev) return app.toast(t('nothingUndo'));
  const old = prefs; prefs = sanitizePrefs(JSON.parse(prev)); savePrefs(prefs); applyToEngine(old);
  if (old.station !== prefs.station) dial.goTo(byId[prefs.station].idx);
  renderCard(); app.renderPane('radio'); syncLabels(); app.toast(t('undone'));
}
app.undo = undo;
app.toggleTopic = id => {
  const on = !prefs.categories.includes(id);
  if (!on && prefs.categories.length === 1) return app.toast(t('pickTopic'));
  app.commit(p => { p.categories = on ? [...p.categories, id] : p.categories.filter(c => c !== id); p.newsEnabled = true; }, `${topicLabel(id)}: ${on ? '+' : '−'}`, { toast: true });
  app.core.tick(true); vibrate(10);
  if (id === 'stoic' && on) app.toast(t('stoicAdded'));
};
app.setDayTopic = id => app.commit(p => { p.dayTopic = p.dayTopic === id ? null : id; if (!p.categories.includes(id)) p.categories.push(id); }, t('dayTopic'));
app.setInterval = n => { app.commit(p => { p.interval = n; }, intervalText(n)); app.core.tick(); };
app.setHostMode = m => app.commit(p => { p.hostMode = m; }, m === 'with-host' ? t('withHost') : t('musicOnlyBtn'), { toast: true });

/* =========================================================  dial physics + input  */
const dial = {
  phi: 0, vel: 0, target: 0, dragging: false, seeking: false, lastIdx: -1, settleTimer: 0, userMoved: false,
  idxAt(phi) { return ((Math.round(-phi / STEP) % N) + N) % N; },
  goTo(idx, instant = false) {
    const cur = -this.phi / STEP; let k = Math.round(cur);
    const d = ((idx - (((k % N) + N) % N)) % N + N) % N; k += d > N / 2 ? d - N : d;
    this.target = -k * STEP; if (instant) { this.phi = this.target; this.vel = 0; }
  },
  nudge(dir) { this.userMoved = true; this.target = -Math.round(-this.target / STEP + dir) * STEP; },
};
app.nudgeDial = () => dial.nudge(1);
dial.goTo(byId[prefs.station].idx, true);
app.goToStation = idx => { dial.userMoved = true; dial.goTo(idx); };

const stage = $('#stage');
const pointer = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, nx: 0, ny: 0, dx: 0, dy: 0, inside: false };
const press = { active: false, id: -1, sx: 0, sy: 0, lx: 0, t: 0, moved: false, hold: 0, target: null, shift: false };
let timeScale = 1, timeScaleTarget = 1, wheelAcc = 0;
stage.addEventListener('pointermove', e => {
  pointer.x = e.clientX / innerWidth; pointer.y = 1 - e.clientY / innerHeight; pointer.inside = true;
  pointer.nx = pointer.x * 2 - 1; pointer.ny = pointer.y * 2 - 1;
  if (!press.active || e.pointerId !== press.id) return;
  if (!press.moved && Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > 6) { press.moved = true; clearTimeout(press.hold); stopSeek(); dial.dragging = true; dial.userMoved = true; stage.classList.add('dragging'); }
  if (dial.dragging) {
    const step = e.clientX - press.lx, k = 2.4 / Math.min(innerWidth, 900); press.lx = e.clientX;
    dial.phi += step * k; dial.vel = dial.vel * 0.6 + (step * k) / Math.max(1 / 120, (e.timeStamp - press.t) / 1000) * 0.4; press.t = e.timeStamp;
  }
});
stage.addEventListener('pointerleave', () => { pointer.inside = false; });
stage.addEventListener('pointerdown', e => {
  if (e.button > 0) return; app.ensureEntered(); setSheet(false);
  Object.assign(press, { active: true, id: e.pointerId, sx: e.clientX, lx: e.clientX, sy: e.clientY, t: e.timeStamp, moved: false, target: e.target, shift: e.shiftKey });
  stage.setPointerCapture(e.pointerId); clearTimeout(press.hold);
  press.hold = setTimeout(() => { if (press.active && !press.moved) startSeek(); }, 260);
});
const endPress = e => {
  if (!press.active || e.pointerId !== press.id) return;
  press.active = false; clearTimeout(press.hold); stage.releasePointerCapture?.(e.pointerId);
  if (dial.dragging) { dial.dragging = false; stage.classList.remove('dragging'); dial.target = Math.round((dial.phi + Math.max(-9, Math.min(9, dial.vel)) * 0.22) / STEP) * STEP; }
  else if (dial.seeking) stopSeek();
  else if (e.type === 'pointerup') handleClick(e);
};
stage.addEventListener('pointerup', endPress); stage.addEventListener('pointercancel', endPress);
stage.addEventListener('wheel', e => { e.preventDefault(); app.ensureEntered(); wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (Math.abs(wheelAcc) > 40) { dial.nudge(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; } }, { passive: false });
function startSeek() { dial.seeking = true; dial.userMoved = true; timeScaleTarget = reduceMotion ? 1.5 : 3.6; }
function stopSeek() { if (!dial.seeking) return; dial.seeking = false; timeScaleTarget = 1; dial.target = Math.round((dial.phi + dial.vel * 0.25) / STEP) * STEP; }
function handleClick(e) {
  const lab = press.target?.closest?.('[data-station],[data-topic]');
  const u = lab ? lab.dataset : app.scene.pick(e.clientX, e.clientY);
  if (!u) return;
  if (u.topic) return app.toggleTopic(u.topic);
  if (u.station !== undefined) {
    const s = STATIONS[+u.station];
    if (press.shift) { if (s.id !== prefs.station) app.commit(p => { p.blend = p.blend === s.id ? null : s.id; }, prefs.blend === s.id ? t('mixOff') : t('mixOn', { name: stationName(s) }), { toast: true }); return; }
    app.goToStation(s.idx);
  }
}
addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName), mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') { closeModals(); return; }
  if (typing || !$('#palette').hidden || !$('#info').hidden || !$('#paywall').hidden) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'ArrowRight') { app.ensureEntered(); dial.nudge(1); }
  else if (e.key === 'ArrowLeft') { app.ensureEntered(); dial.nudge(-1); }
  else if (e.code === 'Space' && !e.repeat && document.activeElement === document.body) { e.preventDefault(); app.ensureEntered(); startSeek(); }
  else if (e.key.toLowerCase() === 'h') app.setHostMode(prefs.hostMode === 'with-host' ? 'music-only' : 'with-host');
  else if (e.key.toLowerCase() === 'p') app.togglePlay();
  else if (e.key.toLowerCase() === 'n') app.engine.newsNow();
  else if (/^[1-6]$/.test(e.key)) app.toggleTopic(TOPIC_IDS[+e.key - 1]);
});
addEventListener('keyup', e => { if (e.code === 'Space') stopSeek(); });

/* =========================================================  labels  */
const labelsEl = $('#labels');
const satLabels = STATIONS.map((s, i) => { const el = document.createElement('button'); el.type = 'button'; el.className = 'sat-label'; el.dataset.station = i; el.tabIndex = -1; el.innerHTML = '<b></b><small></small>'; labelsEl.appendChild(el); return el; });
const moonLabels = TOPIC_IDS.map(id => { const el = document.createElement('button'); el.type = 'button'; el.className = 'moon-label'; el.dataset.topic = id; el.tabIndex = -1; labelsEl.appendChild(el); return el; });
const hostLabels = ['A', 'B'].map(() => { const el = document.createElement('div'); el.className = 'host-label'; el.innerHTML = '<i></i><span></span>'; el.style.opacity = 0; labelsEl.appendChild(el); return el; });
function syncLabels() {
  satLabels.forEach((el, i) => { const s = STATIONS[i]; el.firstChild.textContent = stationName(s); el.lastChild.textContent = `${s.freq} · ${s.bpm} BPM`; el.classList.toggle('tuned', s.id === prefs.station); el.classList.toggle('blend', s.id === prefs.blend); });
  moonLabels.forEach((el, i) => { el.textContent = `${i + 1} · ${topicLabel(TOPIC_IDS[i])}`; el.setAttribute('aria-pressed', prefs.categories.includes(TOPIC_IDS[i])); });
}
const pt = { x: 0, y: 0, z: 0 };
function placeLabels() {
  const w = innerWidth, sc = app.scene;
  STATIONS.forEach((s, i) => {
    const el = satLabels[i], front = Math.cos(i * STEP + dial.phi);
    const vis = smooth(w < 760 ? 0.975 : 0.5, w < 760 ? 0.995 : 0.82, front) * (1 - sc.hostVisible() * 0.6);
    if (vis < 0.02) { if (el.style.opacity !== '0') { el.style.opacity = '0'; el.style.pointerEvents = 'none'; } return; }
    sc.project(sc.satObj(i), pt);
    el.style.transform = `translate3d(${pt.x.toFixed(1)}px,${(pt.y + 14).toFixed(1)}px,0) translate(-50%,0) scale(${(0.82 + vis * 0.25).toFixed(3)})`;
    el.style.opacity = vis.toFixed(3); el.style.pointerEvents = vis > 0.4 ? 'auto' : 'none';
  });
  const hv = sc.hostVisible();
  moonLabels.forEach((el, i) => { sc.project(sc.moonObj(i), pt); el.style.transform = `translate3d(${(pt.x + 14).toFixed(1)}px,${(pt.y - 10).toFixed(1)}px,0)`; el.style.opacity = ((0.55 + Math.max(0, Math.min(1, (pt.z + 1) / 3)) * 0.45) * (1 - hv * 0.5)).toFixed(2); });
  const h = hostState;
  ['A', 'B'].forEach((id, i) => {
    const el = hostLabels[i], show = h && (id === 'A' || h.duo) ? hv * (id === 'B' ? sc.duoAmount() : 1) : 0;
    el.style.opacity = show.toFixed(2);
    if (show < 0.02) return;
    sc.project(sc.headObj(id), pt);
    el.style.transform = `translate3d(${pt.x.toFixed(1)}px,${(pt.y - 70).toFixed(1)}px,0) translate(-50%,0)`;
    el.lastChild.textContent = h.hosts[i] || '';
    el.classList.toggle('talking', h.who === id);
  });
}
const smooth = (a, b, x) => { const t2 = Math.max(0, Math.min(1, (x - a) / (b - a))); return t2 * t2 * (3 - 2 * t2); };

/* =========================================================  card, HUD, on-air, schedule, captions  */
function curStation() { return app.moodStation || byId[prefs.station]; }
function renderCard() {
  const s = curStation(), base = byId[prefs.station];
  $('#cardName').textContent = app.moodStation ? `${s.name}` : stationName(s);
  $('#cardTag').textContent = app.moodStation ? `${t('mood')} → ${stationName(base)}` : stationTag(s);
  $('#cardCat').textContent = t(`cat_${base.cat}`); $('#cardFreq').textContent = base.freq; $('#cardBpm').textContent = base.bpm;
  $('#cardHostLbl').textContent = prefs.hostMode === 'with-host' ? t('hostBy') : t('modeLbl');
  $('#cardHostName').textContent = prefs.hostMode === 'with-host' ? base.host : t('musicOnlyLower');
  $('#freqTop').textContent = `${base.freq} MHz`;
  $('#blendInfo').hidden = !prefs.blend; if (prefs.blend) $('#blendName').textContent = stationName(byId[prefs.blend]);
  $('#newsNowBtn').hidden = prefs.hostMode === 'music-only';
  const on = app.engine?.playing;
  $('#playTxt').textContent = on ? t('pause') : t('play');
  $('#playIcon').setAttribute('d', on ? 'M4 2.5h3v11H4zM9 2.5h3v11H9z' : 'M4 2.5v11l9-5.5z');
  $('#playBtn').classList.toggle('playing', !!on);
  $('#prevBtn').setAttribute('aria-label', t('prev')); $('#nextBtn').setAttribute('aria-label', t('next'));
}
let nextBreakAt = null, upcoming = null, hostState = null, onAirStory = null, schedule = [];
const MODE_LABEL = { idle: 'offAir', music: 'music', news: 'newsLive', host: 'hostLive', intro: 'hostLive', podcast: 'podcastLive', pill: 'pillLive' };
function renderOnAir() {
  const m = app.engine?.mode || 'idle';
  $('#onair').classList.toggle('live', m !== 'idle' && m !== 'music');
  $('#onairState').textContent = `${t('onAir')} · ${prefs.hostMode === 'music-only' && m === 'music' ? t('musicOnly') : t(MODE_LABEL[m])}`;
  let line = '';
  if (prefs.hostMode === 'music-only') line = t('breakOff');
  else if (nextBreakAt && app.engine?.playing && !app.engine.speaking) {
    const left = (nextBreakAt - Date.now()) / 1000, title = upcoming ? (upcoming.headline || upcoming.title) : t('schNews');
    line = left > 0 ? t('nextIn', { t: fmtLeft(left), title }) : t('nextSoon', { title });
  } else if (hostState?.title) line = hostState.title;
  $('#nextLine').textContent = line;
  $('#storyBox').hidden = !onAirStory;
  if (onAirStory) { $('#storyTitle').textContent = onAirStory.headline || onAirStory.title; const a = $('#storySrc'); a.hidden = !onAirStory.source_url; if (onAirStory.source_url) { a.href = onAirStory.source_url; a.textContent = new URL(onAirStory.source_url).hostname; } }
}
function renderSchedule() {
  const ol = $('#schedList');
  if (!schedule.length) { ol.innerHTML = `<li class="empty">${t(prefs.hostMode === 'music-only' ? 'breakOff' : 'schEmpty')}</li>`; return; }
  ol.innerHTML = schedule.map(i => `<li><time>${fmtClock(i.at)}</time><span>${escapeHtml(i.label)}</span></li>`).join('');
}
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderCaption() {
  const h = hostState, el = $('#captions');
  if (!h || !h.caption) { el.hidden = true; return; }
  el.hidden = false; $('#capWho').textContent = h.speaking ? (h.who === 'clip' ? (h.title || 'DOS Radio') : h.name || 'DOS Radio') : '♪';
  $('#capText').textContent = h.caption.length > 260 ? h.caption.slice(0, 257) + '…' : h.caption;
}

/* =========================================================  stoic card  */
function stoicOfDay() {
  const live = app.engine?.queue.find(s => s.category === 'stoic' && !s.sample);
  if (live) return { author: topicLabel('stoic'), text: live.radio_text, story: live };
  const list = stoicThoughts(), d = Math.floor(Date.now() / 86400000) % list.length;
  return { author: list[d][0], text: list[d][1] };
}
function renderStoic() { const s = stoicOfDay(); $('#stoicQuote').textContent = s.story ? (s.story.headline || s.story.title) : `„${s.text}”`; $('#stoicAuthor').textContent = s.author; }
app.playStoic = () => {
  app.ensureEntered();
  const s = stoicOfDay();
  const parts = s.story && app.api.live ? [{ kind: 'voice', url: `/radio-api/story/${s.story.id}.wav`, caption: s.text }] : [{ kind: 'tts', who: 'A', text: `${s.author}: ${s.text}` }];
  app.engine.playPodcast({ id: `stoic-${Date.now()}`, title: t('stoicTitle'), parts }, { kind: 'host' });
  app.sales.mark('stoic'); app.sales.stat('stoic');
};

/* =========================================================  deck panes  */
const PANES = { radio: radioPane, mine: minePane, pods: podsPane };
app.renderPane = name => {
  const root = $(`#pane-${name}`); if (!root || !app.engine) return;
  if (name === 'plus') { root.innerHTML = app.sales.paneHtml(); app.sales.bindPane(root); return; }
  const ae = document.activeElement, focusId = root.contains(ae) ? ae.id : null;
  const { html, bind } = PANES[name](app); root.innerHTML = html; bind(root);
  if (focusId) root.querySelector(`#${focusId}`)?.focus();
};
const renderPanes = () => ['radio', 'mine', 'pods', 'plus'].forEach(app.renderPane);
app.openTab = (name, focusSel) => {
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
  ['radio', 'mine', 'pods', 'plus'].forEach(n => { $(`#pane-${n}`).hidden = n !== name; });
  setSheet(true);
  if (focusSel) setTimeout(() => { const el = $(focusSel); el?.scrollIntoView({ block: 'center' }); el?.focus(); }, 60);
};
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => app.openTab(b.dataset.tab)));
function setSheet(open) { if (innerWidth > 760) return; $('#deck').classList.toggle('open', open); $('#deckBtn').setAttribute('aria-expanded', open); }
$('#deckBtn').addEventListener('click', () => setSheet(!$('#deck').classList.contains('open')));
$('#deckClose').addEventListener('click', () => setSheet(false));

/* =========================================================  features: mood, sources, gmail, podcasts, pills  */
const MOOD_WORDS = [
  [/deszcz|herbat|wiecz|rain|tea|evening|дожд|чай|вечер/, 'trip-hop'], [/kod|fokus|skupi|prac|focus|work|cod|фокус|работ|код/, 'dos-groove'],
  [/nauk|ucz|stud|lo.?fi|учёб|учеб/, 'lofi-nauka'], [/bieg|trening|siłown|run|workout|gym|бег|трениров/, 'drum-and-bass'],
  [/rano|kaw|poran|morning|coffee|утр|кофе/, 'poranna-kawa'], [/jazz|wino|wine|джаз|вин/, 'warm-jazz'],
  [/medyt|oddech|spok|sen|sleep|calm|meditat|медит|сон|спок/, 'deep-ambient'], [/stoi|filozof|philosoph|стоик|филос/, 'stoa'],
  [/impre|parkiet|tań|klub|party|dance|club|вечерин|танц|клуб/, 'club-dance'], [/techno|warehouse|ciężk|heavy|hard|техно|жёстк/, 'raw-techno'],
  [/tran|euforia|euphor|транс/, 'trance'], [/funk|groove|gitar|guitar|фанк|гитар/, 'groove-funk'], [/noc|chill|night|late|ноч|чилл/, 'nocny-dub'],
];
const PRESET = ['dos-groove', 'trip-hop', 'poranna-kawa', 'nocny-dub'];
app.applyMood = async (text, preset) => {
  app.ensureEntered();
  let st = preset !== undefined ? byId[PRESET[preset]] : null, custom = null;
  if (!st && app.api.live) {
    app.toast(t('moodWork'));
    try {
      const m = stationFromMood(await app.api.mood(text));
      // custom mood stations need the classic app's client-side Lyria session; here we play the closest station
      if (m?.custom) { custom = m; st = STATIONS.reduce((b, s) => (Math.abs(s.bpm - m.bpm) + Math.abs(s.brightness - m.brightness) * 60 < Math.abs(b.bpm - m.bpm) + Math.abs(b.brightness - m.brightness) * 60 ? s : b), STATIONS[0]); }
      else st = m;
    } catch (e) { app.toast(e.message, { error: true }); }
  }
  if (!st) { const low = text.toLowerCase(); const hit = MOOD_WORDS.find(([re]) => re.test(low)); st = hit ? byId[hit[1]] : null; }
  if (!st) return app.toast(t('moodUnknown'));
  if (st.id === prefs.station) app.moodStation = custom; else app.pendingMood = custom;
  dial.userMoved = true; dial.goTo(st.idx);
  app.toast(t('moodPlaying', { name: custom?.name || stationName(st) }));
  renderCard();
};
app.saveSources = async (kwRaw, rssRaw, info) => {
  const kw = kwRaw.split(/[,;\n]/).map(s => s.trim()).filter(Boolean), feeds = rssRaw.split('\n').map(s => s.trim()).filter(Boolean);
  if (kw.length > 20) { info.textContent = t('tooManyKw'); return; }
  if (feeds.length > 10) { info.textContent = t('tooManyFeeds'); return; }
  if (feeds.some(f => !/^https?:\/\//i.test(f))) { info.textContent = t('badFeed'); return; }
  if (app.api.live && !app.me?.plus) { app.sales.open('locked'); return; }
  try {
    await app.api.saveNewsPreferences(kw, feeds);
    app.mineState.keywords = kw; app.mineState.feeds = feeds;
    if (!prefs.categories.includes('mine')) app.commit(p => { p.categories = [...p.categories, 'mine']; }, t('mineOn'));
    info.textContent = t('sourcesSaved'); app.sales.mark('source'); loadDigest();
  } catch (e) { info.textContent = e.message; }
};
async function loadDigest() {
  if (app.api.live && !app.me?.plus) return;
  try {
    const d = await app.api.newsDigest(); app.mineState.digest = d.personal ? d.stories : [];
    if (app.api.live) { const np = await app.api.newsPreferences().catch(() => null); if (np) { app.mineState.keywords = np.keywords; app.mineState.feeds = np.rss_feeds; } }
  } catch { /* plus-only */ }
  app.renderPane('mine');
}
app.gmailSample = async () => {
  app.ensureEntered();
  app.mineState.gmailSample = true;
  const sample = gmailSample();
  app.mineState.digest = [...sample, ...app.mineState.digest.filter(s => !s.sample)];
  if (!app.api.live) app.api.gmail = true;
  if (!prefs.categories.includes('mine')) app.commit(p => { p.categories = [...p.categories, 'mine']; }, t('mineOn'));
  app.renderPane('mine'); app.sales.mark('source');
  app.toast(t('gmailAdded'));
  const e = app.engine;
  if (!e.playing) await app.togglePlay(true);
  await e.refreshNews();
  if (app.api.live) e.queue = [...sample, ...e.queue.filter(s => !s.sample)];
  sample.forEach(s => e.aired.state.ids = e.aired.state.ids.filter(id => id !== s.id));
  e.newsNow();
};
app.playDigest = () => {
  const ds = app.mineState.digest.slice(0, 8);
  const parts = ds.map(s => s.sample || !app.api.live ? { kind: 'tts', who: 'A', text: `${s.title}. ${s.radio_text}` } : { kind: 'voice', url: `/radio-api/story/${s.id}.wav`, caption: s.radio_text });
  app.ensureEntered(); app.engine.playPodcast({ id: `digest-${Date.now()}`, title: t('digestPlay'), parts }, { kind: 'news' });
};
app.generatePodcast = async topic => {
  const e = app.engine;
  if (app.podState.current) { e.stopPodcast(); return; }
  if (!app.sales.canGenerate()) { app.sales.open('podcastUsed'); return; }
  const title = topic || t('podIdeas')[0];
  app.ensureEntered(); app.toast(topic ? t('podWork', { topic }) : t('podWorkDay'));
  const btn = $('#podBtn'); if (btn) btn.disabled = true;
  try {
    const pod = await app.api.podcast(topic || undefined, e.hosts);
    pod.title = pod.title || title; app.sales.useCredit();
    app.podState.current = pod.id || 'pod'; app.renderPane('pods');
    await e.playPodcast({ ...pod, id: app.podState.current });
  } catch (err) {
    if (err.status === 401 || err.status === 402 || err.status === 403) { app.sales.credit = 0; app.sales.save(); app.sales.open('podcastUsed'); }
    else app.toast(err.message, { error: true });
  } finally { if (btn) btn.disabled = false; }
};
app.playShowcase = which => {
  app.ensureEntered();
  const [a, b] = app.engine.hosts;
  const pod = which === 'stoic' ? { id: 'showcase-stoic-now', title: stoicPillTitle(), parts: toParts(stoicPill(a, b)) } : { ...app.sales.showcasePodcast(), id: 'showcase-now' };
  app.engine.playPodcast(pod, { kind: which === 'stoic' ? 'pill' : 'podcast' });
};
app.makePill = async (url, info) => {
  if (!app.api.live) { info.textContent = t('demoLive'); return; }
  if (!app.me?.plus) { app.sales.open('locked'); return; }
  if (!/^https?:\/\//i.test(url)) { info.textContent = t('pillBadUrl'); return; }
  info.textContent = t('pillQueued');
  try {
    const job = await app.api.pill(url);
    for (let i = 0; i < 400; i++) {
      const s = await app.api.pillStatus(job.id);
      if (s.status === 'ready') { info.textContent = t('pillReady', { title: s.title }); app.engine.enqueuePill({ id: s.id, title: s.title, parts: s.parts }); loadPills(); return; }
      if (s.status === 'error') throw new Error(s.error || t('pillTooLong'));
      info.textContent = s.status === 'working' ? t('pillWorking') : t('pillQueued');
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(t('pillTooLong'));
  } catch (e) { info.textContent = e.message; }
};
async function loadPills() { if (!app.api.live || !app.me?.plus) return; try { app.podState.pills = (await app.api.pills()).pills || []; app.renderPane('pods'); } catch { /* ignore */ } }
app.queueSavedPill = id => {
  const p = app.podState.pills.find(x => x.id === id); if (!p) return;
  if (!app.engine.enqueuePill({ id: p.id, title: p.title, parts: p.parts })) return app.toast(t('alreadyIn'));
  app.toast(t('addedToProg', { title: p.title })); app.ensureEntered(); if (!app.engine.playing) app.togglePlay(true);
};

/* =========================================================  palette  */
const palette = $('#palette'), palInput = $('#palInput'), palList = $('#palList');
let palItems = [], palSel = 0;
const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
function commands() {
  const c = STATIONS.map(s => ({ label: stationName(s), hint: `${t(`cat_${s.cat}`)} · ${s.bpm} BPM · ${s.host}`, run: () => app.goToStation(s.idx), keys: `${stationTag(s)} ${s.host} ${s.id}` }));
  TOPIC_IDS.forEach(id => c.push({ label: t(prefs.categories.includes(id) ? 'cmdTopicOff' : 'cmdTopicOn', { t: topicLabel(id) }), hint: t('news'), run: () => app.toggleTopic(id), keys: id }));
  INTERVALS.forEach(v => c.push({ label: `${t('news')} ${intervalText(v)}`, hint: t('news'), run: () => app.setInterval(v), keys: `${v}` }));
  c.push({ label: t('withHost'), hint: 'H', run: () => app.setHostMode('with-host'), keys: 'host' }, { label: t('musicOnlyBtn'), hint: 'H', run: () => app.setHostMode('music-only'), keys: 'music' });
  c.push({ label: t('newsNow'), hint: 'N', run: () => app.engine.newsNow(), keys: 'news' }, { label: t('cmdPodcast'), hint: t('tabPods'), run: () => app.openTab('pods', '#podTopic'), keys: 'podcast' });
  c.push({ label: t('stoicListen') + ': ' + t('stoicTitle'), hint: t('stoicTitle'), run: app.playStoic, keys: 'stoic' }, { label: t('cmdRandom'), hint: '⟳', run: () => app.goToStation((Math.random() * N) | 0), keys: 'random' });
  c.push({ label: app.engine?.playing ? t('pause') : t('play'), hint: 'P', run: () => app.togglePlay(), keys: 'play pause' }, { label: t('cmdUndo'), hint: '⌘Z', run: undo, keys: 'undo' });
  LANGS.forEach(l => c.push({ label: t('cmdLang', { l: LANG_NAMES[l] }), hint: l.toUpperCase(), run: () => switchLang(l), keys: `${l} language` }));
  c.push({ label: t('plansTitle'), hint: t('tabPlus'), run: () => app.sales.open('plans'), keys: 'plus plan' }, { label: t('cmdOpen'), hint: '↗', run: () => { location.href = app.api.live ? '/' : 'https://dosradio.theones.io/'; }, keys: 'classic' });
  return c;
}
function score(q, s) { if (!q) return 1; let qi = 0, sc = 0, prev = -2; for (let i = 0; i < s.length && qi < q.length; i++) if (s[i] === q[qi]) { sc += (i === prev + 1 ? 3 : 1) + (i === 0 || s[i - 1] === ' ' ? 2 : 0); prev = i; qi++; } return qi === q.length ? sc : 0; }
function renderPalette() {
  const q = fold(palInput.value.trim());
  palItems = commands().map(c => ({ ...c, s: score(q, fold(`${c.label} ${c.keys}`)) })).filter(c => c.s > 0).sort((a, b) => b.s - a.s).slice(0, 40);
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  palList.innerHTML = palItems.length ? palItems.map((c, i) => `<li role="option" id="pal-${i}" aria-selected="${i === palSel}"><span>${escapeHtml(c.label)}</span><small>${escapeHtml(c.hint)}</small></li>`).join('') : `<li>${t('nothing')}</li>`;
  [...palList.children].forEach((li, i) => { li.addEventListener('pointerenter', () => { palSel = i; mark(); }); li.addEventListener('click', () => runPal(i)); });
  mark();
}
function mark() { [...palList.children].forEach((li, i) => li.setAttribute('aria-selected', i === palSel)); palInput.setAttribute('aria-activedescendant', `pal-${palSel}`); palList.children[palSel]?.scrollIntoView({ block: 'nearest' }); }
function runPal(i) { const c = palItems[i]; if (!c) return; closeModals(); app.ensureEntered(); c.run(); }
function openPalette() { palette.hidden = false; palInput.value = ''; palInput.placeholder = t('palettePh'); palSel = 0; renderPalette(); palInput.focus(); }
function closeModals() { palette.hidden = true; $('#info').hidden = true; $('#paywall').hidden = true; setSheet(false); }
palInput.addEventListener('input', () => { palSel = 0; renderPalette(); });
palInput.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); mark(); } if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); mark(); } if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); } });
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; }));

/* =========================================================  language  */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === getLang()));
  $('#modeBadge').textContent = app.api?.live ? t('live') : t('demo'); $('#modeBadge').classList.toggle('live', !!app.api?.live);
  $('#enterMode').textContent = app.api?.live ? t('enterLive') : t('enterDemo');
  $('#infoList').innerHTML = t('info').map(([a, b]) => `<dt>${escapeHtml(a)}</dt><dd>${escapeHtml(b)}</dd>`).join('');
  syncLabels(); renderCard(); renderOnAir(); renderSchedule(); renderStoic(); renderPanes(); app.sales?.renderTrial(); app.sales?.renderPip();
}
function switchLang(l) {
  setLang(l); try { history.replaceState(null, '', `#${l}`); } catch { /* sandboxed */ }
  applyI18n();
  if (app.engine?.playing) app.engine.refreshNews();
}
document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => switchLang(b.dataset.lang)));
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (LANGS.includes(h) && h !== getLang()) switchLang(h); });

/* =========================================================  play / enter / account  */
let entered = false;
app.ensureEntered = () => { if (!entered) enter(false); };
function enter(sound) {
  entered = true; $('#enter').classList.add('gone');
  app.core.init();
  if (sound) app.togglePlay(true);
}
$('#enterSound').addEventListener('click', e => { e.stopPropagation(); enter(true); });
$('#enterMute').addEventListener('click', e => { e.stopPropagation(); enter(false); });
$('#infoBtn').addEventListener('click', () => { $('#info').hidden = false; });
$('#trialPill').addEventListener('click', () => app.openTab('plus'));
app.refreshMe = async () => {
  try { app.me = await app.api.me(); } catch { app.me = app.me || { allowed: true, registered: false, plus: false }; }
  app.billing = await app.api.billing();
  app.sales.renderTrial(); app.sales.renderPip(); app.renderPane('plus'); app.renderPane('pods'); app.renderPane('mine');
  if (app.me?.plus) { loadDigest(); loadPills(); }
  return app.me;
};
app.togglePlay = async force => {
  const e = app.engine, on = force === true ? true : !e.playing;
  if (!on) { e.stop(); renderCard(); return; }
  try {
    let me = await app.refreshMe();
    if (!me.allowed) { app.sales.open('ended'); return; }
    if (!me.registered && !me.trial_started) { me = app.me = { ...me, ...(await app.api.startTrial()) }; }
    if (app.sales.active) await app.sales.queueShowcase();
    await e.start();
  } catch (err) { app.toast(err.message || t('st_stream'), { error: true }); e.stop(); }
  renderCard();
};
$('#playBtn').addEventListener('click', () => { app.ensureEntered(); app.togglePlay(); });
$('#prevBtn').addEventListener('click', () => { app.ensureEntered(); dial.nudge(-1); });
$('#nextBtn').addEventListener('click', () => { app.ensureEntered(); dial.nudge(1); });
$('#newsNowBtn').addEventListener('click', () => { app.ensureEntered(); app.engine.newsNow(); });
$('#paletteBtn').addEventListener('click', openPalette);
$('#blendClear').addEventListener('click', () => app.commit(p => { p.blend = null; }, t('mixOff'), { toast: true }));
$('#stoicListen').addEventListener('click', app.playStoic);
$('#stoicAdd').addEventListener('click', () => { if (!prefs.categories.includes('stoic')) app.toggleTopic('stoic'); else app.toast(t('stoicAdded')); });

/* =========================================================  engine events  */
function engineEvents() {
  return {
    onState: () => { renderCard(); renderOnAir(); },
    onStatus: (msg, err) => { app.announce(msg); if (err) app.toast(msg, { error: true }); },
    onQueue: () => { renderStoic(); },
    onUpcoming: s => { upcoming = s; },
    onOnAir: s => { onAirStory = s && s.id !== 'weather' ? s : null; renderOnAir(); },
    onNextBreak: d => { nextBreakAt = d; renderOnAir(); },
    onSchedule: items => { schedule = items; renderSchedule(); },
    onHost: h => {
      hostState = h ? { ...h, duo: (h.hosts || []).length > 1 } : null;
      if (h) hostState.who = h.speaking ? h.who : null;
      renderCaption(); renderOnAir();
    },
    onMode: () => renderOnAir(),
    onPills: () => app.renderPane('pods'),
    onIntroDone: () => {},
    onBreakAired: (n, plan, aired) => {
      if (n > 0) { app.sales.stat('news', n); app.sales.mark('news'); }
      if (aired.some(p => p.story?.category === 'stoic')) { app.sales.stat('stoic'); app.sales.mark('stoic'); }
    },
    onPodcastEnd: (pod, finished) => {
      if (pod.id === app.podState.current) {
        app.podState.current = null; app.renderPane('pods');
        if (finished) { app.sales.stat('pods'); app.sales.mark('podcast'); if (!app.me?.plus) setTimeout(() => app.toast(t('afterPod'), { action: t('choosePlus'), onAction: () => app.sales.open('plans'), long: true }), 800); }
      }
      if (finished && /stoic/.test(pod.id)) { app.sales.stat('stoic'); app.sales.mark('stoic'); }
    },
    onTrialEnded: () => { app.sales.open('ended'); renderCard(); },
  };
}

/* =========================================================  frame loop  */
const clockEl = $('#clock'), speedEl = $('#speedVal');
let last = performance.now(), sessionMs = 0, beat = 0, kickEnv = 0, secAcc = 0, onAirAcc = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20); last = now; sessionMs += dt * 1000;
  const e = app.engine;
  /* dial physics */
  if (dial.seeking) { dial.vel += (-(timeScale - 1) * 1.15 - dial.vel) * Math.min(1, dt * 3); dial.phi += dial.vel * dt; }
  else if (!dial.dragging) { const k = 95, damp = 2 * Math.sqrt(k) * 0.8; dial.vel += ((dial.target - dial.phi) * k - dial.vel * damp) * dt; dial.phi += dial.vel * dt; }
  const idx = dial.idxAt(dial.phi);
  if (idx !== dial.lastIdx) { if (dial.lastIdx !== -1) { app.core.tick(); vibrate(5); } dial.lastIdx = idx; }
  const off = Math.abs(-dial.phi / STEP - Math.round(-dial.phi / STEP));
  const moving = dial.dragging || dial.seeking || Math.abs(dial.vel) > 0.05;
  app.core.setStatic(moving && e.playing ? Math.min(1, off * 2 + Math.abs(dial.vel) * 0.04) * 0.2 : 0);
  if (!moving && off < 0.02 && STATIONS[idx].id !== prefs.station && !dial.settleTimer) {
    dial.settleTimer = setTimeout(() => {
      dial.settleTimer = 0; const s = STATIONS[dial.idxAt(dial.phi)];
      app.moodStation = app.pendingMood || null; app.pendingMood = null;
      app.commit(p => { p.station = s.id; if (p.blend === s.id) p.blend = null; }, t('tuned', { name: stationName(s), bpm: s.bpm }));
      if (dial.userMoved) { app.sales.stats.stations++; app.sales.save(); app.sales.mark('orbit'); }
    }, 120);
  }
  timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * (timeScaleTarget > timeScale ? 2.2 : 3.5));
  /* audio features */
  const f = app.core.analyse(dt, e?.playing);
  if (e?.playing) { if (f.kick) kickEnv = Math.max(kickEnv, f.kick); }
  else { const s = byId[prefs.station]; beat += dt * s.bpm / 60; if (beat >= 1) { beat -= 1; if (s.bpm >= 80) kickEnv = Math.max(kickEnv, 0.55); } }
  kickEnv *= Math.exp(-dt * (reduceMotion ? 14 : 8));
  const kick = reduceMotion ? kickEnv * 0.3 : kickEnv;
  pointer.dx = pointer.x - pointer.px; pointer.dy = pointer.y - pointer.py; pointer.px = pointer.x; pointer.py = pointer.y;

  app.scene.render({
    f, kick, timeScale, pointer, phi: dial.phi, playing: !!e?.playing, station: byId[prefs.station],
    tunedIdx: byId[prefs.station].idx, needleIdx: idx, blendIdx: prefs.blend ? byId[prefs.blend].idx : -1,
    topics: prefs.categories, interval: prefs.interval,
    hosts: hostState ? { duo: hostState.duo, who: hostState.who } : null,
  }, dt);
  placeLabels();

  const ms = Math.floor(sessionMs);
  clockEl.textContent = `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}:${String(ms % 1000).padStart(3, '0')}`;
  speedEl.textContent = `${timeScale.toFixed(2)}x`;
  secAcc += dt; if (secAcc >= 1) { secAcc -= 1; app.sales.tick(); }
  onAirAcc += dt; if (onAirAcc >= 0.5) { onAirAcc = 0; renderOnAir(); }
  requestAnimationFrame(frame);
}

/* =========================================================  boot  */
(async function boot() {
  app.api = await detectApi();
  app.engine = new RadioEngine({ core: app.core, api: app.api, prefs: { ...prefs, stationObj: byId[prefs.station] }, events: engineEvents() });
  app.sales = new Sales(app);
  app.scene = createScene($('#gl'), {});
  try { app.connectors = await app.api.connectors(); } catch { app.connectors = null; }
  applyI18n();
  app.refreshMe();
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopSeek(); });
  window.__orbita = { app, dial };
  requestAnimationFrame(t0 => { last = t0; frame(t0); });
})();
