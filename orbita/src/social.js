/* 2.5D Ring Filter + Favorites + Social Friends + Live Drops + Creator Radios + Website-Podcast Outreach (ZERO EMOJI — pure SVG) */

const FAV_KEY = 'dosradio.favorites.v1';
const CID_KEY = 'dosradio.client_id.v1';
const NAME_KEY = 'dosradio.display_name.v1';
const HAND_KEY = 'dosradio.thumb_left.v1';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SVG_STAR = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1.6l1.95 3.95 4.36.63-3.15 3.07.74 4.34L8 11.54l-3.9 2.05.74-4.34L1.69 6.18l4.36-.63L8 1.6z"/></svg>';
const SVG_USERS = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4"/><circle cx="11.5" cy="6" r="2"/><path d="M11.5 9.8c1.8.2 3 1.5 3 3.7"/></svg>';
const SVG_RADIO = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l9-2.5M2 5.5h12v8H2z"/><circle cx="5.5" cy="9.5" r="1.8"/><path d="M9.5 8h3M9.5 11h3"/></svg>';
const SVG_LINK = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 9.5l3-3M5.5 7L4 8.5a2.1 2.1 0 003 3L8.5 10M10.5 9L12 7.5a2.1 2.1 0 00-3-3L7.5 6"/></svg>';

function getClientId() {
  try {
    let v = localStorage.getItem(CID_KEY);
    if (!v) { v = 'orb_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4); localStorage.setItem(CID_KEY, v); }
    return v;
  } catch { return 'orb_anon'; }
}

export function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); }
}
export function saveFavorites(set) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch {}
}

export function initOrbitaSocial({ app, STATIONS, byId, dial, renderCard, rebuildSatLabels }) {
  const clientId = getClientId();
  app.favorites = loadFavorites();
  app.ringFilter = 'all';
  app.leftHand = localStorage.getItem(HAND_KEY) === '1';
  app.friendStations = new Set();
  app.onlineFriends = [];

  const sapi = async (path, opts = {}) => {
    const dname = localStorage.getItem(NAME_KEY) || '';
    const r = await fetch(`/radio-api${path}`, {
      credentials: 'include',
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': clientId,
        ...(dname ? { 'X-Display-Name': encodeURIComponent(dname) } : {}),
        ...(opts.headers || {}),
      },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
    return j;
  };

  /* ---- Inject sleek obsidian CSS ---- */
  if (!document.getElementById('orbSocialCss')) {
    const st = document.createElement('style');
    st.id = 'orbSocialCss';
    st.textContent = `
      #ringBar{display:flex;flex-wrap:wrap;gap:4px;padding:4px 5px;margin-bottom:2px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.11);max-width:100%}
      #ringBar::-webkit-scrollbar{display:none}
      .rb-pill{border:0;background:transparent;color:rgba(244,242,238,.72);font:500 9.5px/1 'Azeret Mono',monospace;padding:5px 8px;border-radius:999px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;transition:.16s}
      .rb-pill.on{background:rgba(255,107,61,.22);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,107,61,.6)}
      .rb-hand{display:none}
      @media(max-width:760px){.rb-hand{display:inline-flex}}
      #socialHubBar{display:flex;gap:5px;flex-wrap:wrap}
      .sh-btn{background:rgba(14,12,20,.78);border:1px solid rgba(236,232,244,.16);color:#ece8f4;border-radius:999px;padding:6px 9px;font:500 10px/1 'Azeret Mono',monospace;display:inline-flex;align-items:center;gap:5px;cursor:pointer;backdrop-filter:blur(12px)}
      .sh-btn:hover{border-color:#ff6b3d;color:#fff}
      .sh-dot{width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981}
      #favStarBtn{width:34px;height:34px;padding:0;border:1px solid rgba(236,232,244,.16);background:rgba(236,232,244,.04);color:rgba(255,255,255,.75);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
      #favStarBtn.on{color:#fbbf24;border-color:rgba(251,191,36,.65);background:rgba(251,191,36,.14)}
      #favStarBtn.on svg{fill:#fbbf24}
      .sat-label{background:rgba(9,9,15,.82);padding:3px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(6px)}
      .sat-label.tuned{border-color:rgba(255,107,61,.75);background:rgba(22,14,16,.92)}
      @media(max-width:760px){.moon-label{display:none!important}#card{padding:11px 12px;gap:7px}}
      @media(min-width:761px){#card{bottom:46px;padding:12px 15px;gap:8px}}
      .satLabel .favMark{color:#fbbf24;margin-right:3px}
      .satLabel .frMark{display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;margin-right:4px;box-shadow:0 0 6px #10b981}
      #socModal{position:fixed;inset:0;z-index:85;background:rgba(5,5,9,.76);backdrop-filter:blur(14px);display:none;align-items:center;justify-content:center;padding:14px}
      #socModal.open{display:flex}
      .sm-box{width:min(580px,100%);max-height:88vh;overflow-y:auto;background:#0e0e14;border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:18px;color:#f3f1ed;font-family:system-ui,sans-serif}
      .sm-tabs{display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:10px;overflow-x:auto}
      .sm-tab{background:rgba(255,255,255,.05);border:1px solid transparent;color:#bbb;padding:7px 12px;border-radius:999px;font:500 11px/1 'Azeret Mono',monospace;cursor:pointer;white-space:nowrap}
      .sm-tab.on{background:rgba(255,107,61,.18);border-color:#ff6b3d;color:#fff}
      .sm-f{display:grid;gap:8px;margin:10px 0}
      .sm-in,.sm-ta,.sm-sel{width:100%;box-sizing:border-box;background:#161621;border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:10px;padding:9px 11px;font-size:13px}
      .sm-btn{background:#ff6b3d;color:#09090d;border:0;border-radius:10px;padding:10px 14px;font:600 12px/1 'Azeret Mono',monospace;cursor:pointer}
      .sm-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
      .sm-links a,.sm-links button{background:#1b1b28;border:1px solid rgba(255,255,255,.16);color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px;font:500 11px/1 'Azeret Mono',monospace;cursor:pointer}
      .fr-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#151520;border-radius:10px;margin-bottom:6px}
      #hijackBanner{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:90;background:linear-gradient(90deg,#15131f,#24171a);border:1px solid #ff6b3d;color:#fff;padding:10px 16px;border-radius:999px;font:500 11.5px/1.3 'Azeret Mono',monospace;box-shadow:0 10px 32px rgba(0,0,0,.6);display:none;max-width:92vw;text-align:center}
    `;
    document.head.appendChild(st);
  }

  /* ---- 1) Favorite Star inline in #card action row ---- */
  const cardEl = document.getElementById('card');
  const dedRow = document.getElementById('dedicateBtn')?.parentElement || cardEl;
  const favBtn = document.createElement('button');
  favBtn.id = 'favStarBtn';
  favBtn.type = 'button';
  favBtn.title = 'Dodaj / usuń z ulubionych';
  favBtn.innerHTML = SVG_STAR;
  dedRow?.appendChild(favBtn);
  const syncFavBtn = () => favBtn.classList.toggle('on', app.favorites.has(app.prefs.station));
  favBtn.addEventListener('click', () => {
    const sid = app.prefs.station;
    if (app.favorites.has(sid)) app.favorites.delete(sid); else app.favorites.add(sid);
    saveFavorites(app.favorites);
    syncFavBtn();
    renderRingBar();
    app.toast(app.favorites.has(sid) ? 'Dodano do ulubionych' : 'Usunięto z ulubionych');
  });
  app.syncFavBtn = syncFavBtn;

  /* ---- 2) 3-Ring 2.5D Filter Bar cleanly docked at top of #card ---- */
  const ringBar = document.createElement('div');
  ringBar.id = 'ringBar';
  const renderRingBar = () => {
    const items = [
      ['all', 'Wszystkie'],
      ['fav', `Ulubione (${app.favorites.size})`],
      ['1', 'I · Chill'],
      ['2', 'II · Groove'],
      ['3', 'III · Rave'],
    ];
    ringBar.innerHTML = items.map(([k, lbl]) =>
      `<button type="button" class="rb-pill${app.ringFilter === k ? ' on' : ''}" data-rf="${k}">${lbl}</button>`
    ).join('') + `<button type="button" class="rb-pill rb-hand" id="rbHandBtn">${app.leftHand ? 'Lewy kciuk' : 'Prawy kciuk'}</button>`;
  };
  if (cardEl) cardEl.prepend(ringBar); else document.body.appendChild(ringBar);
  renderRingBar();
  ringBar.addEventListener('click', ev => {
    const hb = ev.target.closest('#rbHandBtn');
    if (hb) {
      app.leftHand = !app.leftHand;
      localStorage.setItem(HAND_KEY, app.leftHand ? '1' : '0');
      renderRingBar();
      return;
    }
    const b = ev.target.closest('[data-rf]');
    if (!b) return;
    const rf = b.dataset.rf;
    if (rf === 'fav' && !app.favorites.size) { app.toast('Kliknij gwiazdkę przy stacji, aby dodać ulubione'); return; }
    app.ringFilter = rf;
    renderRingBar();
  });

  /* ---- 3) Social / Creator / URL-Podcast Hub docked inside #leftCol ---- */
  const hub = document.createElement('div');
  hub.id = 'socialHubBar';
  const renderHub = () => {
    const onCnt = app.onlineFriends.length;
    hub.innerHTML = `
      <button type="button" class="sh-btn" data-open="friends">${onCnt ? '<span class="sh-dot"></span>' : ''}${SVG_USERS}<span>Znajomi${onCnt ? ` (${onCnt})` : ''}</span></button>
      <button type="button" class="sh-btn" data-open="creator">${SVG_RADIO}<span>Własne Radio</span></button>
      <button type="button" class="sh-btn" data-open="outreach">${SVG_LINK}<span>Podcast z WWW</span></button>
    `;
  };
  const leftCol = document.getElementById('leftCol');
  const onairSec = document.getElementById('onair');
  if (leftCol && onairSec) onairSec.insertAdjacentElement('afterend', hub);
  else document.body.appendChild(hub);
  renderHub();

  const banner = document.createElement('div');
  banner.id = 'hijackBanner';
  document.body.appendChild(banner);

  const modal = document.createElement('div');
  modal.id = 'socModal';
  document.body.appendChild(modal);

  let activeTab = 'friends';
  let friendsList = [];
  let customRadios = [];
  let lastLinksHtml = '';

  const shareRowHtml = res => {
    if (!res?.share_url) return '';
    return `<div class="sm-links">
      <a href="${esc(res.whatsapp_url)}" target="_blank" rel="noopener">WhatsApp</a>
      <a href="${esc(res.telegram_url)}" target="_blank" rel="noopener">Telegram</a>
      <a href="${esc(res.mailto_url)}">E-mail</a>
      <a href="${esc(res.sms_url)}">SMS</a>
      <button type="button" data-copy="${esc(res.share_url)}">Kopiuj link</button>
    </div>`;
  };

  async function openModal(tab) {
    activeTab = tab || activeTab;
    modal.classList.add('open');
    if (activeTab === 'friends') {
      const r = await sapi('/social/friends').catch(() => ({ friends: [] }));
      friendsList = r.friends || [];
    } else if (activeTab === 'creator') {
      const r = await sapi('/custom-radios').catch(() => ({ radios: [] }));
      customRadios = r.radios || [];
    }
    drawModal();
  }

  function drawModal() {
    const stOpts = STATIONS.filter(s => s.enabled !== false)
      .map(s => `<option value="${esc(s.id)}"${s.id === app.prefs.station ? ' selected' : ''}>${esc(s.name)} (${s.bpm} BPM)</option>`).join('');
    let bodyHtml = '';
    if (activeTab === 'friends') {
      bodyHtml = `
        <div style="font-size:12px;opacity:.75;margin-bottom:8px">Twoi znajomi (kliknij, aby wrzucić pozdrowienie, pigułkę lub podcast prosto na ich antenę):</div>
        <div>${friendsList.length ? friendsList.map(f => `
          <div class="fr-row">
            <div><strong>${esc(f.name)}</strong> ${f.online ? `<span style="color:#10b981;font-size:11px"><span class="frMark"></span>słucha ${esc(byId[f.station_id]?.name || f.station_id || 'radia')}</span>` : '<span style="opacity:.5;font-size:11px">offline</span>'}</div>
            <button type="button" class="sm-btn" style="padding:6px 10px" data-drop-to="${esc(f.id)}" data-drop-name="${esc(f.name)}">Wyślij wrzutkę</button>
          </div>`).join('') : '<div style="opacity:.6;font-size:12px;margin-bottom:10px">Brak zapisanych znajomych — zaproś pierwszą osobę poniżej.</div>'}</div>
        <div id="dropQuickBox"></div>
        <hr style="border:0;border-top:1px solid rgba(255,255,255,.1);margin:14px 0">
        <form id="addFriendForm" class="sm-f">
          <strong>Zaproś znajomego wraz z pozdrowieniem na antenie</strong>
          <input class="sm-in" name="from_name" placeholder="Twoje imię / ksywka" value="${esc(localStorage.getItem(NAME_KEY) || '')}" required>
          <input class="sm-in" name="name" placeholder="Imię znajomego (np. Klaudia, Szymon)" required>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input class="sm-in" name="phone" placeholder="Telefon (np. +48 500...)">
            <input class="sm-in" name="email" placeholder="lub E-mail">
          </div>
          <select class="sm-sel" name="station_id">${stOpts}</select>
          <textarea class="sm-ta" name="greeting_message" rows="2" placeholder="Treść pozdrowienia wyczytanego przez prowadzącego po otwarciu radia..."></textarea>
          <button class="sm-btn" type="submit">Utwórz zaproszenie z pozdrowieniem</button>
        </form>
        <div id="socLinksOut">${lastLinksHtml}</div>`;
    } else if (activeTab === 'creator') {
      bodyHtml = `
        <form id="createRadioForm" class="sm-f">
          <strong>Stwórz własne radio na żywo (lub kanał Twórcy / YouTubera)</strong>
          <input class="sm-in" name="name" placeholder="Nazwa stacji (np. Cyber Kodowanie Live)" required>
          <input class="sm-in" name="creator_name" placeholder="Twórca / Kanał YouTube" value="${esc(localStorage.getItem(NAME_KEY) || '')}">
          <select class="sm-sel" name="mode"><option value="describe">Opisz klimat słowami (AI dobierze pasmo)</option><option value="modify">Zmodyfikuj istniejącą stację</option></select>
          <select class="sm-sel" name="base_station_id">${stOpts}</select>
          <textarea class="sm-ta" name="description" rows="2" placeholder="Opisz brzmienie i charakter prowadzącego (np. Mroczny berliński techno puls z krótkimi wejściami o AI)..."></textarea>
          <textarea class="sm-ta" name="pills_raw" rows="3" placeholder="Pigułki Twórcy / Linki YouTube lub WWW (po 1 w linii: https://... | Twój komentarz)"></textarea>
          <button class="sm-btn" type="submit">Uruchom własną stację i wygeneruj link</button>
        </form>
        <div id="socLinksOut">${lastLinksHtml}</div>
        <div style="margin-top:12px"><strong>Ostatnie stacje społeczności:</strong>
          ${customRadios.map(r => `<div class="fr-row" style="margin-top:6px"><div><strong>${esc(r.name)}</strong> <span style="opacity:.6;font-size:11px">${esc(r.creator_name || r.base_station_id)} · ${(r.pills || []).length} pigułek</span></div><div class="sm-links" style="margin:0"><button type="button" data-play-radio="${esc(r.slug)}">Włącz</button><button type="button" data-copy="${esc(r.share_url)}">Link</button></div></div>`).join('')}
        </div>`;
    } else {
      bodyHtml = `
        <form id="outreachForm" class="sm-f">
          <strong>Wygeneruj link otwierający stację z podcastem o stronie WWW</strong>
          <input class="sm-in" name="from_name" placeholder="Twoje imię" value="${esc(localStorage.getItem(NAME_KEY) || '')}">
          <input class="sm-in" name="recipient_name" placeholder="Imię odbiorcy (opcjonalnie)">
          <input class="sm-in" name="url" placeholder="Adres strony WWW (np. https://twojafirma.pl)" required>
          <select class="sm-sel" name="station_id">${stOpts}</select>
          <textarea class="sm-ta" name="comment" rows="2" placeholder="Opcjonalny komentarz / pozdrowienie na wejściu audycji..."></textarea>
          <button class="sm-btn" type="submit">Generuj spersonalizowany link radiowy</button>
        </form>
        <div id="socLinksOut">${lastLinksHtml}</div>`;
    }
    modal.innerHTML = `<div class="sm-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong style="font-family:'Unbounded',sans-serif;font-size:14px">ANTENA SPOŁECZNOŚCIOWA</strong>
        <button type="button" class="sh-btn" id="smCloseBtn">Zamknij</button>
      </div>
      <div class="sm-tabs">
        <button type="button" class="sm-tab${activeTab === 'friends' ? ' on' : ''}" data-tab="friends">Znajomi i Pozdrowienia</button>
        <button type="button" class="sm-tab${activeTab === 'creator' ? ' on' : ''}" data-tab="creator">Własne Radio / YT</button>
        <button type="button" class="sm-tab${activeTab === 'outreach' ? ' on' : ''}" data-tab="outreach">Podcast ze Strony WWW</button>
      </div>
      ${bodyHtml}
    </div>`;
  }

  hub.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) { lastLinksHtml = ''; openModal(b.dataset.open); } });
  modal.addEventListener('click', async e => {
    if (e.target === modal || e.target.closest('#smCloseBtn')) { modal.classList.remove('open'); return; }
    const tb = e.target.closest('[data-tab]');
    if (tb) { lastLinksHtml = ''; openModal(tb.dataset.tab); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { navigator.clipboard?.writeText(cp.dataset.copy); app.toast('Skopiowano link do schowka'); return; }
    const pr = e.target.closest('[data-play-radio]');
    if (pr) { modal.classList.remove('open'); activateCustomRadio(pr.dataset.playRadio); return; }
    const dt = e.target.closest('[data-drop-to]');
    if (dt) {
      const box = modal.querySelector('#dropQuickBox');
      box.innerHTML = `<form id="sendDropForm" class="sm-f" style="background:#151522;padding:10px;border-radius:10px;margin-top:8px">
        <strong>Wrzutka na antenę dla: ${esc(dt.dataset.dropName)}</strong>
        <input type="hidden" name="to_friend_id" value="${esc(dt.dataset.dropTo)}">
        <input type="hidden" name="to_name" value="${esc(dt.dataset.dropName)}">
        <select class="sm-sel" name="kind"><option value="greeting">Pozdrowienie głosowe</option><option value="pill">Pigułka wiedzy (z linku lub tekstu)</option><option value="podcast">Podcast dwugłosowy (z linku WWW lub tematu)</option></select>
        <input class="sm-in" name="source_url" placeholder="Opcjonalny link WWW (https://...)">
        <textarea class="sm-ta" name="message" rows="2" placeholder="Wiadomość, temat lub komentarz..."></textarea>
        <button class="sm-btn" type="submit">Wyślij na żywo + utwórz link</button>
      </form>`;
    }
  });

  modal.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const fd = Object.fromEntries(new FormData(f).entries());
    if (fd.from_name) localStorage.setItem(NAME_KEY, String(fd.from_name).trim());
    try {
      if (f.id === 'addFriendForm') {
        const res = await sapi('/social/friends', { method: 'POST', body: JSON.stringify({ ...fd, with_greeting: true }) });
        lastLinksHtml = shareRowHtml(res);
        app.toast('Gotowe! Wyślij zaproszenie z pozdrowieniem 1 kliknięciem');
        openModal('friends');
      } else if (f.id === 'sendDropForm') {
        const res = await sapi('/social/drops', { method: 'POST', body: JSON.stringify({ ...fd, station_id: app.prefs.station, topic: fd.message }) });
        lastLinksHtml = shareRowHtml(res);
        app.toast('Wrzutka wysłana na antenę!');
        drawModal();
      } else if (f.id === 'createRadioForm') {
        const pills = String(fd.pills_raw || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
          const [u, ...rest] = l.split('|');
          return { url: u.trim(), note: rest.join('|').trim(), title: rest.join('|').trim() || u.trim() };
        });
        const res = await sapi('/custom-radios', { method: 'POST', body: JSON.stringify({ ...fd, pills }) });
        lastLinksHtml = `<div class="sm-links"><button type="button" data-copy="${esc(res.share_url)}">Kopiuj link stacji: ${esc(res.share_url)}</button><button type="button" data-play-radio="${esc(res.slug)}">Włącz teraz</button></div>`;
        openModal('creator');
      } else if (f.id === 'outreachForm') {
        app.toast('Analizuję stronę WWW i przygotowuję podcast...');
        const res = await sapi('/social/url-podcast-link', { method: 'POST', body: JSON.stringify(fd) });
        lastLinksHtml = `<div style="font-size:12px;color:#10b981;margin-top:6px">Strona odczytana: <strong>${esc(res.site_title)}</strong> — podcast generuje się w tle!</div>` + shareRowHtml(res);
        drawModal();
      }
    } catch (err) { app.toast(err.message || 'Błąd połączenia'); }
  });

  /* ---- 4) Audio Playback over Ducked Live Music ---- */
  async function playVoiceSequence(urls, labelText) {
    banner.textContent = labelText;
    banner.style.display = 'block';
    try { app.core?.duck?.(0.24, 0.35); } catch {}
    for (const u of urls) {
      await new Promise(res => {
        const a = new Audio(u);
        a.onended = res; a.onerror = res;
        a.play().catch(res);
      });
    }
    try { app.core?.duck?.(1.0, 0.55); } catch {}
    setTimeout(() => { banner.style.display = 'none'; }, 2500);
  }

  function playDropWhenReady(drop, prefixLabel) {
    const run = async () => {
      await new Promise(r => setTimeout(r, 2600));
      if (drop.audio_url) {
        await playVoiceSequence([drop.audio_url], `${prefixLabel}: ${drop.from_name || 'Znajomy'} — ${drop.message || drop.pill_text || 'Pozdrowienia!'}`);
      } else if (drop.podcast?.parts?.length) {
        await playVoiceSequence(drop.podcast.parts.map(p => p.url), `${prefixLabel}: ${drop.site_title || drop.podcast.topic || 'Audycja specjalna'}`);
      }
    };
    if (app.engine?.playing) run();
    else {
      const iv = setInterval(() => { if (app.engine?.playing) { clearInterval(iv); run(); } }, 600);
    }
  }

  async function activateCustomRadio(slug) {
    const r = await sapi(`/custom-radios/${encodeURIComponent(slug)}`).catch(() => null);
    if (!r?.radio) return;
    const rad = r.radio;
    if (byId[rad.base_station_id]) {
      app.commit(p => { p.station = rad.base_station_id; }, `${rad.name} (${rad.creator_name || 'Radio Twórcy'})`);
      dial.goTo(byId[rad.base_station_id].idx, false);
    }
    banner.textContent = `STACJA AUTORSKA: ${rad.name}${rad.creator_name ? ' · ' + rad.creator_name : ''}${rad.pills?.length ? ` · Pigułek: ${rad.pills.length}` : ''}`;
    banner.style.display = 'block';
    renderCard();
  }

  /* ---- 5) Boot Deep-Links (?w=, ?p=, ?r=) + Presence Heartbeat ---- */
  const sp = new URLSearchParams(location.search);
  if (sp.get('r')) activateCustomRadio(sp.get('r'));
  if (sp.get('w')) {
    sapi(`/social/drops/${encodeURIComponent(sp.get('w'))}/claim`, { method: 'POST', body: '{}' }).then(res => {
      const d = res.drop;
      if (d?.station_id && byId[d.station_id]) { app.commit(p => { p.station = d.station_id; }); dial.goTo(byId[d.station_id].idx, true); }
      banner.textContent = `WRZUTKA OD ${d.from_name || 'ZNAJOMEGO'} — kliknij Start, aby odsłuchać na antenie!`;
      banner.style.display = 'block';
      playDropWhenReady(d, `NA ANTENIE OD ${(d.from_name || 'ZNAJOMEGO').toUpperCase()}`);
    }).catch(() => {});
  }
  if (sp.get('p')) {
    const ptok = sp.get('p');
    const pollPod = async () => {
      for (let i = 0; i < 40; i++) {
        const res = await sapi(`/social/url-podcast-link/${encodeURIComponent(ptok)}`).catch(() => null);
        const d = res?.drop;
        if (!d) return;
        if (i === 0 && d.station_id && byId[d.station_id]) { app.commit(p => { p.station = d.station_id; }); dial.goTo(byId[d.station_id].idx, true); }
        if (d.podcast?.status === 'ready' && d.podcast.parts?.length) {
          playDropWhenReady(d, `AUDYCJA O STRONIE ${d.site_title || ''}${d.comment ? ' · ' + d.comment : ''}`);
          return;
        }
        banner.textContent = `Przygotowujemy spersonalizowany podcast o ${d.site_title || 'stronie'}...`;
        banner.style.display = 'block';
        await new Promise(r => setTimeout(r, 2500));
      }
    };
    pollPod();
  }

  const beatPresence = async () => {
    const res = await sapi('/social/presence', { method: 'POST', body: JSON.stringify({ station_id: app.prefs.station, display_name: localStorage.getItem(NAME_KEY) || '' }) }).catch(() => null);
    if (!res) return;
    app.onlineFriends = res.friends_online || [];
    app.friendStations = new Set(app.onlineFriends.map(f => f.station_id).filter(Boolean));
    renderHub();
    for (const d of (res.incoming_live_drops || [])) playDropWhenReady(d, 'WEJŚCIE NA ŻYWO');
  };
  beatPresence();
  setInterval(beatPresence, 22000);
  syncFavBtn();
}
