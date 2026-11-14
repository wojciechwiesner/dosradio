/* Deck panes: Radio, Mine (own sources + Gmail), Podcasts (generate, pills, programme). Plus pane lives in sales.js */
import { t, topicLabel, intervalText, stationName } from './i18n.js';
import { TOPIC_IDS, INTERVALS, STATIONS } from './data.js';
import { stoicPillTitle } from './content.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// the site's Permissions-Policy may switch these off (nginx sends microphone=(), geolocation=())
const allows = f => { try { return document.featurePolicy ? document.featurePolicy.allowsFeature(f) : true; } catch { return true; } };
const lock = app => (app.me?.plus ? '' : `<span class="lock">${t('plusLock')}</span>`);

export function radioPane(app) {
  const p = app.prefs;
  const html = `
  <section class="group"><h2>${t('host')} <kbd>H</kbd></h2>
    <div class="seg" role="radiogroup">${['with-host', 'music-only'].map(m => `<button type="button" role="radio" data-host="${m}" aria-checked="${p.hostMode === m}">${m === 'with-host' ? t('withHost') : t('musicOnlyBtn')}</button>`).join('')}</div></section>
  <section class="group"><h2>${t('news')} <span class="hint">${t('orMoons')}</span></h2>
    <div class="chips">${TOPIC_IDS.map((id, i) => `<button type="button" class="chip" data-topic="${id}" aria-pressed="${p.categories.includes(id)}"><kbd>${i + 1}</kbd>${esc(topicLabel(id))}<span class="star${p.dayTopic === id ? ' on' : ''}" data-star="${id}" title="${esc(t('dayTopic'))}" role="button" aria-label="${esc(t('dayTopic'))}">★</span></button>`).join('')}</div>
    <div class="ivals" role="group" aria-label="${esc(t('news'))}">${INTERVALS.map(v => `<button type="button" data-iv="${v}" aria-pressed="${p.interval === v}" title="${esc(intervalText(v))}">${v}</button>`).join('')}</div>
    <p class="hint">${esc(t('newsEvery', { x: intervalText(p.interval) }))}</p>
    <label class="toggle"><input type="checkbox" id="hourly" ${p.hourlyBulletin ? 'checked' : ''}> ${t('hourly')}</label>
    <label class="field" for="city">${t('city')}<input id="city" maxlength="80" placeholder="${esc(t('cityPh'))}" value="${esc(p.weatherCity)}" autocomplete="address-level2"></label>
    <div class="row"><button class="btn small" type="button" id="useLoc">${t('useLoc')}</button><span class="hint" id="placeInfo">${esc(p.weatherCity ? t('weatherFor', { c: p.weatherCity }) : p.weatherLat !== null ? t('locOk') : t('noCity'))}</span></div></section>
  <section class="group"><h2>${t('mood')}</h2>
    <form id="moodForm" class="field"><label class="sr-only" for="mood">${t('mood')}</label><textarea id="mood" rows="2" maxlength="240" placeholder="${esc(t('moodPh'))}"></textarea>
      <div class="row" style="justify-content:flex-end"><button type="button" id="micBtn" class="btn icon" aria-label="${esc(t('sayMood'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button><button type="submit" class="btn primary">${t('moodGo')}</button></div></form>
    <div class="chips">${t('moods').map((m, i) => `<button type="button" class="chip" data-mood="${i}">${esc(m)}</button>`).join('')}</div></section>
  <section class="group"><h2>${t('mix')}</h2>
    <label class="field" for="blendSel">${t('mixHint')}<select id="blendSel"><option value="">${t('noMix')}</option>${STATIONS.filter(s => s.id !== p.station).map(s => `<option value="${s.id}" ${p.blend === s.id ? 'selected' : ''}>${esc(stationName(s))} · ${s.bpm} BPM</option>`).join('')}</select></label>
    <p class="hint">${t('mixShift')}</p></section>`;
  return { html, bind: root => {
    root.querySelectorAll('[data-host]').forEach(b => b.addEventListener('click', () => app.setHostMode(b.dataset.host)));
    root.querySelectorAll('[data-topic]').forEach(b => b.addEventListener('click', e => { if (e.target.dataset.star) { app.setDayTopic(e.target.dataset.star); return; } app.toggleTopic(b.dataset.topic); }));
    root.querySelectorAll('[data-iv]').forEach(b => b.addEventListener('click', () => app.setInterval(+b.dataset.iv)));
    root.querySelector('#hourly').addEventListener('change', e => app.commit(p => { p.hourlyBulletin = e.target.checked; }, t('hourly')));
    let tm = 0; root.querySelector('#city').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => app.commit(p => { p.weatherCity = e.target.value.trim(); if (p.weatherCity) { p.weatherLat = null; p.weatherLon = null; } }, null, { render: false }), 600); });
    root.querySelector('#useLoc').addEventListener('click', () => {
      const info = root.querySelector('#placeInfo');
      if (!('geolocation' in navigator)) { info.textContent = t('locNo'); return; }
      info.textContent = t('locAsk');
      navigator.geolocation.getCurrentPosition(pos => app.commit(p => { p.weatherLat = pos.coords.latitude; p.weatherLon = pos.coords.longitude; p.weatherCity = ''; }, t('locOk')), () => { info.textContent = t('locNo'); }, { timeout: 10000, maximumAge: 600000 });
    });
    const form = root.querySelector('#moodForm');
    form.addEventListener('submit', e => { e.preventDefault(); const v = root.querySelector('#mood').value.trim(); if (v) app.applyMood(v); });
    root.querySelector('#mood').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    root.querySelectorAll('[data-mood]').forEach(b => b.addEventListener('click', () => { root.querySelector('#mood').value = b.textContent; app.applyMood(b.textContent, +b.dataset.mood); }));
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = root.querySelector('#micBtn');
    if (!SR || !allows('microphone')) mic.hidden = true;
    if (!('geolocation' in navigator) || !allows('geolocation')) root.querySelector('#useLoc').hidden = true;
    mic.addEventListener('click', () => {
      try {
        const rec = new SR(); rec.lang = { pl: 'pl-PL', en: 'en-GB', ru: 'ru-RU' }[document.documentElement.lang] || 'pl-PL'; rec.interimResults = true;
        mic.classList.add('primary');
        rec.onresult = ev => { const tx = [...ev.results].map(r => r[0].transcript).join(' '); root.querySelector('#mood').value = tx; if (ev.results[ev.results.length - 1].isFinal) app.applyMood(tx); };
        rec.onerror = () => app.toast(t('micNo')); rec.onend = () => mic.classList.remove('primary'); rec.start();
      } catch { app.toast(t('micNo')); }
    });
    root.querySelector('#blendSel').addEventListener('change', e => app.commit(p => { p.blend = e.target.value || null; }, e.target.value ? t('mixOn', { name: e.target.selectedOptions[0].textContent }) : t('mixOff')));
  } };
}

export function minePane(app) {
  const st = app.mineState;
  const gmail = app.connectors?.gmail || {};
  const digest = st.digest || [];
  const html = `
  <section class="group"><h2>${t('mineTitle')} ${lock(app)}</h2><p class="lead">${t('mineLead')}</p></section>
  <section class="group">
    <div class="connector"><div class="logo">G</div><div style="display:grid;gap:8px;min-width:0">
      <b>${t('gmailTitle')} ${st.gmailSample ? `<span class="tag hot">${t('gmailSample')}</span>` : gmail.connected ? `<span class="tag hot">${t('gmailConnected')}</span>` : ''}</b>
      <p class="hint">${t('gmailLead')}</p>
      <div class="row">${gmail.available && !gmail.connected ? `<button class="btn primary small" type="button" id="gmailConnect">${t('gmailConnect')}</button>` : ''}<button class="btn small" type="button" id="gmailDemo">${t('gmailDemo')}</button></div>
    </div></div>
  </section>
  <section class="group">
    <form id="srcForm" style="display:grid;gap:10px">
      <label class="field" for="kw">${t('keywords')}<input id="kw" value="${esc((st.keywords || []).join(', '))}"></label>
      <label class="field" for="rss">${t('feeds')}<textarea id="rss" rows="3">${esc((st.feeds || []).join('\n'))}</textarea></label>
      <button class="btn primary" type="submit">${t('saveSources')}</button><p class="hint" id="srcInfo" role="status"></p>
    </form>
  </section>
  <section class="group"><h2>${digest.length ? t('digestHead', { n: digest.length }) : t('mineTitle')}</h2>
    ${digest.length ? `<ul class="list">${digest.map(s => `<li><span class="tag hot">${t('yours')}</span><span>${s.source_url ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}</span></li>`).join('')}</ul><button class="btn small" type="button" id="digestPlay">${t('digestPlay')}</button>` : `<p class="hint">${t('digestEmpty')}</p>`}
  </section>`;
  return { html, bind: root => {
    root.querySelector('#gmailConnect')?.addEventListener('click', () => { location.href = gmail.connect_url; });
    root.querySelector('#gmailDemo').addEventListener('click', () => app.gmailSample());
    root.querySelector('#srcForm').addEventListener('submit', e => { e.preventDefault(); app.saveSources(root.querySelector('#kw').value, root.querySelector('#rss').value, root.querySelector('#srcInfo')); });
    root.querySelector('#digestPlay')?.addEventListener('click', () => app.playDigest());
  } };
}

export function podsPane(app) {
  const e = app.engine, prog = e.pills.progress(), sales = app.sales, saved = app.podState.pills || [];
  const free = !app.me?.plus && sales.credit > 0;
  const html = `
  <section class="group"><h2>${t('podTitle')} ${free ? `<span class="tag hot">${t('podFree')}</span>` : lock(app)}</h2>
    <p class="lead">${t('podLead')}</p>
    <form id="podForm" style="display:grid;gap:8px"><label class="field" for="podTopic"><span class="sr-only">${t('podTitle')}</span><input id="podTopic" maxlength="160" placeholder="${esc(t('podPh'))}"></label>
      <div class="chips">${t('podIdeas').map(i => `<button type="button" class="chip" data-idea>${esc(i)}</button>`).join('')}</div>
      <button class="btn primary" type="submit" id="podBtn">${app.podState.current ? t('podStop') : t('podGo')}</button></form>
  </section>
  <section class="group"><h2>${t('showcase')}</h2>
    <ul class="list"><li><button class="btn small" type="button" id="showPlay">${t('showcasePlay')}</button><span>${esc(app.sales.showcasePodcast().title)}</span></li>
    <li><button class="btn small" type="button" id="stoicPlay">${t('showcasePlay')}</button><span>${esc(stoicPillTitle())}</span></li></ul>
  </section>
  ${prog.length ? `<section class="group"><h2>${t('inProgramme')}</h2><ul class="list">${prog.map(x => `<li style="align-items:center"><span style="flex:1">${esc(x.title)} (${x.done}/${x.total})</span><button class="btn small" type="button" data-rm="${esc(x.pillId)}" aria-label="${esc(t('remove'))}">×</button></li>`).join('')}</ul></section>` : ''}
  <section class="group"><h2>${t('pillTitle')} ${lock(app)}</h2><p class="lead">${t('pillLead')}</p>
    <form id="pillForm" style="display:grid;gap:8px"><label class="field" for="pillUrl">${t('pillUrl')}<input id="pillUrl" type="url" maxlength="300" placeholder="https://www.youtube.com/watch?v=…"></label>
      <button class="btn" type="submit">${t('pillGo')}</button><p class="hint" id="pillInfo" role="status"></p></form>
    ${saved.length ? `<h2>${t('myPills')}</h2><ul class="list">${saved.map(p => `<li style="align-items:center"><button class="btn icon" type="button" data-pill="${esc(p.id)}" aria-label="${esc(t('addToProg', { title: p.title }))}">▶</button><span>${esc(p.author ? `${p.title} — ${p.author}` : p.title)}</span></li>`).join('')}</ul>` : ''}
  </section>`;
  return { html, bind: root => {
    const form = root.querySelector('#podForm');
    root.querySelectorAll('[data-idea]').forEach(b => b.addEventListener('click', () => { root.querySelector('#podTopic').value = b.textContent; }));
    form.addEventListener('submit', ev => { ev.preventDefault(); app.generatePodcast(root.querySelector('#podTopic').value.trim()); });
    root.querySelector('#showPlay').addEventListener('click', () => app.playShowcase('podcast'));
    root.querySelector('#stoicPlay').addEventListener('click', () => app.playShowcase('stoic'));
    root.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { e.pills.remove(b.dataset.rm); app.renderPane('pods'); }));
    root.querySelector('#pillForm').addEventListener('submit', ev => { ev.preventDefault(); app.makePill(root.querySelector('#pillUrl').value.trim(), root.querySelector('#pillInfo')); });
    root.querySelectorAll('[data-pill]').forEach(b => b.addEventListener('click', () => app.queueSavedPill(b.dataset.pill)));
  } };
}
