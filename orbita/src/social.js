/* Mobile Bottom Nav + 1/4-Circle 2.5D Thumb-Turntable + App-Badge Share + PWA + Social/Creator/URL-Podcast (ZERO EMOJI) */
import { APP_ICONS, buildAppBadgesHtml, bindAppBadges, openQuickShareSheet, isRunningStandalonePwa, triggerPwaInstall } from './shareSheet.js';
import { initThumbTurntable } from './thumbDial.js';
import { buildInvitePreviewHtml, formatInviteShareText, openAuditionInvite, createPodcastHud } from './inviteScreen.js';

const FAV_KEY = 'dosradio.favorites.v1';
const CID_KEY = 'dosradio.client_id.v1';
const NAME_KEY = 'dosradio.display_name.v1';
const HAND_KEY = 'dosradio.thumb_left.v1';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICONS = {
  star: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 1.6l1.95 3.95 4.36.63-3.15 3.07.74 4.34L8 11.54l-3.9 2.05.74-4.34L1.69 6.18l4.36-.63L8 1.6z"/></svg>',
  antena: '<svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="2.2"/><path d="M5.5 14.5a6.4 6.4 0 0 1 0-9M14.5 5.5a6.4 6.4 0 0 1 0 9M2.8 17.2a10.2 10.2 0 0 1 0-14.4M17.2 2.8a10.2 10.2 0 0 1 0 14.4"/></svg>',
  radio: '<svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6.5l11-3M2.5 7.5h15v9.5h-15z"/><circle cx="7" cy="12.2" r="2.2"/><path d="M12 10.5h3.5M12 13.8h3.5"/></svg>',
  mine: '<svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14"/><circle cx="7" cy="5.5" r="1.8" fill="#0e0e14"/><circle cx="13" cy="10" r="1.8" fill="#0e0e14"/><circle cx="8.5" cy="14.5" r="1.8" fill="#0e0e14"/></svg>',
  pods: '<svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="7" y="2.5" width="6" height="9.5" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7 17.5h6"/></svg>',
  friends: '<svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7.5" cy="6.8" r="2.8"/><path d="M2.5 16.5c0-2.6 2.2-4.6 5-4.6s5 2 5 4.6"/><circle cx="14.2" cy="7.5" r="2.1"/><path d="M14.2 12c2 .2 3.3 1.7 3.3 4.3"/></svg>',
};

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

export function initOrbitaSocial({ app, STATIONS, byId, dial, renderCard }) {
  const clientId = getClientId();
  app.favorites = loadFavorites();
  app.ringFilter = 'all';
  app.leftHand = localStorage.getItem(HAND_KEY) === '1';
  app.force25d = false;
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
    if (!r.ok) {
      const err = new Error(j.detail || `HTTP ${r.status}`);
      err.status = r.status; // 429 = daily podcast limit (message is Polish, shown as-is)
      throw err;
    }
    return j;
  };

  if (!document.getElementById('orbSocialCss')) {
    const st = document.createElement('style');
    st.id = 'orbSocialCss';
    st.textContent = `
      #ringBar{display:flex;flex-wrap:wrap;gap:4px;padding:4px 5px;border-radius:10px;background:rgba(12,12,18,.86);border:1px solid rgba(255,255,255,.12);max-width:100%;backdrop-filter:blur(10px)}
      .rb-pill{border:0;background:transparent;color:rgba(244,242,238,.74);font:500 9.5px/1 'Azeret Mono',monospace;padding:6px 8px;min-height:28px;border-radius:999px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;flex:none}
      .rb-pill.on{background:rgba(255,107,61,.24);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,107,61,.65)}
      #socialHubBar{display:flex;gap:5px;flex-wrap:wrap}
      @media(max-width:760px){
        #ringBar{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
        #ringBar::-webkit-scrollbar{display:none}
        #socialHubBar{display:none!important}.hud-br,.hud-bl,#modeBadge{display:none!important}.moon-label{display:none!important}#paletteBtn{display:none!important}
        .hud-tl .sep,.hud-tl > span:nth-of-type(2){display:none!important}
        .hud-tr{gap:6px}
        #classicViewBtn span{display:none}
        #classicViewBtn{width:30px;height:26px;padding:0;justify-content:center}
      }
      .sh-btn{background:rgba(14,12,20,.82);border:1px solid rgba(236,232,244,.16);color:#ece8f4;border-radius:999px;padding:6px 10px;min-height:32px;font:500 10px/1 'Azeret Mono',monospace;display:inline-flex;align-items:center;gap:5px;cursor:pointer;backdrop-filter:blur(12px)}
      .sh-btn:hover{border-color:#ff6b3d;color:#fff}
      .sh-dot,.frMark{display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981}
      .frMark{margin-right:4px}
      #favStarBtn{width:36px;height:36px;padding:0;border-radius:8px;border:1px solid rgba(236,232,244,.16);background:rgba(236,232,244,.04);color:rgba(255,255,255,.78);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
      #favStarBtn.on{color:#fbbf24;border-color:rgba(251,191,36,.65);background:rgba(251,191,36,.14)}
      #favStarBtn.on svg{fill:#fbbf24}
      .sat-label{background:rgba(9,9,15,.84);padding:3px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(6px)}
      .sat-label.tuned{border-color:rgba(255,107,61,.75);background:rgba(22,14,16,.94)}
      #orbPwaBtn{height:26px;padding:0 9px;border-radius:999px;border:1px solid rgba(255,107,61,.55);background:rgba(255,107,61,.16);color:#fff;font:600 9.5px/1 'Azeret Mono',monospace;display:inline-flex;align-items:center;gap:5px;cursor:pointer}
      #orbPwaBtn[hidden]{display:none!important}
      /* Native-grade 5-tab Mobile Bottom Navigation */
      #mobileNav{display:none}
      @media(max-width:760px){
        #mobileNav{position:fixed;left:0;right:0;bottom:0;height:calc(58px + env(safe-area-inset-bottom,0px));padding-bottom:env(safe-area-inset-bottom,0px);background:rgba(10,10,16,.95);border-top:1px solid rgba(255,255,255,.12);backdrop-filter:blur(18px);z-index:45;display:grid;grid-template-columns:repeat(5,1fr)}
        .mn-tab{appearance:none;border:0;background:transparent;color:rgba(226,232,240,.62);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:600 9.5px/1 system-ui,-apple-system,sans-serif;cursor:pointer;min-height:48px;position:relative}
        .mn-tab.on{color:#ff6b3d}
        .mn-badge{position:absolute;top:7px;right:calc(50% - 14px);width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981}
        #card .eyebrow{display:none}
        #card h1{font-size:16px}
        #card .sub{font-size:10px}
      }
      #socModal{position:fixed;inset:0;z-index:85;background:rgba(5,5,9,.78);backdrop-filter:blur(14px);display:none;align-items:center;justify-content:center;padding:12px;padding-bottom:calc(68px + env(safe-area-inset-bottom,0px))}
      #socModal.open{display:flex}
      .sm-box{width:min(540px,100%);max-height:82vh;overflow-y:auto;background:#0e0f17;border:1px solid rgba(255,255,255,.15);border-radius:18px;padding:16px;color:#f3f1ed;font-family:system-ui,sans-serif}
      .sm-tabs{display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;padding-bottom:6px}
      .sm-tab{background:rgba(255,255,255,.06);border:1px solid transparent;color:#cbd5e1;padding:7px 12px;border-radius:999px;font:600 11px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap;min-height:34px}
      .sm-tab.on{background:rgba(255,107,61,.2);border-color:#ff6b3d;color:#fff}
      .sm-f{display:grid;gap:8px;margin:8px 0}
      .sm-in,.sm-ta,.sm-sel{width:100%;box-sizing:border-box;background:#161824;border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:10px;padding:10px 11px;font-size:13px}
      .sm-btn{background:#ff6b3d;color:#09090d;border:0;border-radius:10px;padding:11px 14px;font:700 12.5px/1 system-ui,sans-serif;cursor:pointer;min-height:42px}
      .fr-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;background:#151724;border-radius:11px;margin-bottom:6px;font-size:13px}
      #hijackBanner{position:fixed;top:46px;left:50%;transform:translateX(-50%);z-index:90;background:linear-gradient(90deg,#15131f,#24171a);border:1px solid #ff6b3d;color:#fff;padding:9px 15px;border-radius:999px;font:500 11px/1.3 'Azeret Mono',monospace;box-shadow:0 10px 32px rgba(0,0,0,.6);display:none;max-width:92vw;text-align:center}
    `;
    document.head.appendChild(st);
  }

  /* ---- 1) PWA Install Button in Top Bar ---- */
  const hudTr = document.querySelector('.hud-tr');
  const pwaBtn = document.createElement('button');
  pwaBtn.id = 'orbPwaBtn';
  pwaBtn.type = 'button';
  pwaBtn.innerHTML = `${APP_ICONS.install}<span>Zainstaluj</span>`;
  const syncPwaVis = () => { pwaBtn.hidden = isRunningStandalonePwa(); };
  syncPwaVis();
  pwaBtn.addEventListener('click', () => triggerPwaInstall(msg => app.toast(msg)));
  hudTr?.prepend(pwaBtn);
  window.addEventListener('dos-pwa-installed', syncPwaVis);
  window.top?.addEventListener?.('dos-pwa-installed', syncPwaVis);

  /* ---- 2) Favorite Star inline in #card ---- */
  const cardEl = document.getElementById('card');
  const dedRow = document.getElementById('dedicateBtn')?.parentElement || cardEl;
  const favBtn = document.createElement('button');
  favBtn.id = 'favStarBtn';
  favBtn.type = 'button';
  favBtn.setAttribute('aria-label', 'Ulubiona stacja');
  favBtn.innerHTML = ICONS.star;
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

  /* ---- 3) 3-Orbit Switcher + Thumb Hand / 2.5D Toggle ---- */
  const ringBar = document.createElement('div');
  ringBar.id = 'ringBar';
  const renderRingBar = () => {
    const isMob = innerWidth <= 760;
    const items = [
      ['all', 'Wszystkie'],
      ['fav', `Ulubione (${app.favorites.size})`],
      ['1', 'I · Chill'],
      ['2', 'II · Groove'],
      ['3', 'III · Rave'],
    ];
    ringBar.innerHTML = items.map(([k, lbl]) =>
      `<button type="button" class="rb-pill${app.ringFilter === k ? ' on' : ''}" data-rf="${k}">${lbl}</button>`
    ).join('') + (isMob
      ? `<button type="button" class="rb-pill" id="rbHandBtn">${app.leftHand ? 'Lewy kciuk' : 'Prawy kciuk'}</button>`
      : `<button type="button" class="rb-pill${app.force25d ? ' on' : ''}" id="rb25dBtn">1/4 2.5D</button>`
    ) + (app.force25d && !isMob ? `<button type="button" class="rb-pill" id="rbHandBtn">${app.leftHand ? 'Lewy' : 'Prawy'}</button>` : '');
  };
  app.syncRingBar = renderRingBar;
  const leftCol = document.getElementById('leftCol');
  const onairSec = document.getElementById('onair');
  if (leftCol && onairSec) onairSec.insertAdjacentElement('afterend', ringBar);
  else cardEl?.prepend(ringBar);
  renderRingBar();
  window.addEventListener('resize', renderRingBar);

  /* ---- 4) 1/4-Circle 2.5D 3-Orbit Corner Thumb-Turntable ---- */
  const thumbDial = initThumbTurntable({ app, STATIONS, byId, dial });
  ringBar.addEventListener('click', ev => {
    if (ev.target.closest('#rbHandBtn')) {
      app.leftHand = !app.leftHand;
      localStorage.setItem(HAND_KEY, app.leftHand ? '1' : '0');
      renderRingBar();
      thumbDial.resize();
      return;
    }
    if (ev.target.closest('#rb25dBtn')) {
      app.force25d = !app.force25d;
      renderRingBar();
      thumbDial.resize();
      return;
    }
    const b = ev.target.closest('[data-rf]');
    if (!b) return;
    if (b.dataset.rf === 'fav' && !app.favorites.size) { app.toast('Stuknij gwiazdkę przy stacji, aby dodać ulubione'); return; }
    app.ringFilter = b.dataset.rf;
    renderRingBar();
  });

  /* ---- 5) Simplified "Udostępnij przez..." with Invitation Card Preview + Branded App Badges ---- */
  const stationMetaInvite = (stId, title, about, fromName = '', toName = '', comment = '') => {
    const st = byId[stId] || byId[app.prefs.station] || STATIONS[0];
    return {
      title,
      about,
      station_id: st.id,
      station_name: st.name,
      station_genre: `${st.sub || st.group || 'elektronika'} · ${st.bpm} BPM`,
      from_name: fromName,
      to_name: toName,
      comment,
    };
  };

  app.openQuickShareStation = () => {
    const st = byId[app.prefs.station] || STATIONS[0];
    const baseUrl = `${location.origin}/?station=${encodeURIComponent(st.id)}`;
    const baseInv = stationMetaInvite(st.id, `Antena na żywo · ${st.name}`, `wspólny odsłuch na żywo z prowadzącym ${st.host} i wyselekcjonowanymi pigułkami wiedzy`);
    openQuickShareSheet({
      title: `AmbiRadio · ${st.name}`,
      subtitle: `${st.freq} MHz · ${st.bpm} BPM · Prowadzi ${st.host}`,
      url: baseUrl,
      text: formatInviteShareText(baseInv),
      invite: { html: buildInvitePreviewHtml(baseInv) },
      onToast: m => app.toast(m),
      onCreateGreetingUrl: async ({ toName, message }) => {
        const res = await sapi('/social/drops', {
          method: 'POST',
          body: JSON.stringify({ to_name: toName, kind: 'greeting', station_id: st.id, message }),
        });
        const inv = res.drop?.invite || stationMetaInvite(st.id, `Pozdrowienie na antenie dla: ${toName}`, message, localStorage.getItem(NAME_KEY) || '', toName);
        return {
          url: res.share_url,
          text: formatInviteShareText(inv),
          inviteHtml: buildInvitePreviewHtml(inv),
        };
      },
    });
  };

  /* ---- 6) Desktop Social Strip + Inject Creator/URL-Podcast triggers inside #deck panes ---- */
  const hub = document.createElement('div');
  hub.id = 'socialHubBar';
  const renderHub = () => {
    const onCnt = app.onlineFriends.length;
    hub.innerHTML = `
      <button type="button" class="sh-btn" data-open="friends">${onCnt ? '<span class="sh-dot"></span>' : ''}<span>Znajomi${onCnt ? ` (${onCnt})` : ''}</span></button>
      <button type="button" class="sh-btn" data-open="creator"><span>Własne Radio</span></button>
      <button type="button" class="sh-btn" data-open="outreach"><span>Podcast z WWW</span></button>`;
  };
  ringBar.insertAdjacentElement('afterend', hub);
  renderHub();

  const injectDeckShortcuts = () => {
    const pr = document.getElementById('pane-radio');
    if (pr && !pr.querySelector('#deckCreateRadioBtn')) {
      const b = document.createElement('button');
      b.id = 'deckCreateRadioBtn';
      b.type = 'button';
      b.className = 'sm-btn';
      b.style.cssText = 'margin:0 14px 10px;width:calc(100% - 28px)';
      b.textContent = '+ Stwórz własne radio lub kanał YT';
      b.onclick = () => openModal('creator');
      pr.prepend(b);
    }
    const pp = document.getElementById('pane-pods');
    if (pp && !pp.querySelector('#deckUrlPodBtn')) {
      const b = document.createElement('button');
      b.id = 'deckUrlPodBtn';
      b.type = 'button';
      b.className = 'sm-btn';
      b.style.cssText = 'margin:0 0 12px;width:100%';
      b.textContent = 'Wygeneruj link z podcastem o stronie WWW';
      b.onclick = () => openModal('outreach');
      pp.prepend(b);
    }
  };
  setTimeout(injectDeckShortcuts, 350);
  document.getElementById('deck')?.addEventListener('click', () => setTimeout(injectDeckShortcuts, 60));

  /* ---- 7) Native 5-Tab Mobile Bottom Navigation Bar ---- */
  const mobNav = document.createElement('nav');
  mobNav.id = 'mobileNav';
  mobNav.setAttribute('aria-label', 'Nawigacja mobilna');
  document.body.appendChild(mobNav);

  const modal = document.createElement('div');
  modal.id = 'socModal';
  document.body.appendChild(modal);

  const syncMobileNav = () => {
    const deckOpen = document.getElementById('deck')?.classList.contains('open');
    const socOpen = modal.classList.contains('open');
    const cur = socOpen ? 'friends' : deckOpen ? (app.activeDeckTab || 'radio') : 'antena';
    const onCnt = app.onlineFriends.length;
    const tabs = [
      ['antena', 'Antena', ICONS.antena],
      ['radio', 'Radio', ICONS.radio],
      ['mine', 'Moje', ICONS.mine],
      ['pods', 'Podcast', ICONS.pods],
      ['friends', 'Znajomi', ICONS.friends],
    ];
    mobNav.innerHTML = tabs.map(([id, lbl, svg]) => `
      <button type="button" class="mn-tab${cur === id ? ' on' : ''}" data-mn="${id}">
        ${id === 'friends' && onCnt ? '<span class="mn-badge"></span>' : ''}
        ${svg}<span>${lbl}</span>
      </button>`).join('');
  };
  app.onNavSync = syncMobileNav;
  syncMobileNav();

  mobNav.addEventListener('click', e => {
    const btn = e.target.closest('[data-mn]');
    if (!btn) return;
    const target = btn.dataset.mn;
    if (target === 'antena') {
      modal.classList.remove('open');
      app.closeSheet?.();
    } else if (target === 'friends') {
      app.closeSheet?.();
      openModal('friends');
    } else {
      modal.classList.remove('open');
      app.openTab?.(target);
      setTimeout(injectDeckShortcuts, 50);
    }
    syncMobileNav();
  });

  /* ---- 8) Social / Creator / URL-Podcast Studio Modal ---- */
  let activeTab = 'friends';
  let friendsList = [];
  let customRadios = [];
  let lastShareData = null;

  async function openModal(tab) {
    activeTab = tab || activeTab;
    lastShareData = null;
    modal.classList.add('open');
    syncMobileNav();
    if (activeTab === 'friends') friendsList = (await sapi('/social/friends').catch(() => ({ friends: [] }))).friends || [];
    else if (activeTab === 'creator') customRadios = (await sapi('/custom-radios').catch(() => ({ radios: [] }))).radios || [];
    drawModal();
  }

  function drawModal() {
    const stOpts = STATIONS.filter(s => s.enabled !== false)
      .map(s => `<option value="${esc(s.id)}"${s.id === app.prefs.station ? ' selected' : ''}>${esc(s.name)} (${s.bpm} BPM)</option>`).join('');
    let bodyHtml = '';
    if (activeTab === 'friends') {
      bodyHtml = `
        <div>${friendsList.length ? friendsList.map(f => `
          <div class="fr-row">
            <div><strong>${esc(f.name)}</strong> ${f.online ? `<span style="color:#10b981;font-size:11px"><span class="frMark"></span>${esc(byId[f.station_id]?.name || f.station_id || 'na żywo')}</span>` : '<span style="opacity:.5;font-size:11px">offline</span>'}</div>
            <button type="button" class="sm-btn" style="padding:7px 11px;min-height:34px" data-drop-to="${esc(f.id)}" data-drop-name="${esc(f.name)}">Wyślij wrzutkę</button>
          </div>`).join('') : '<div style="opacity:.65;font-size:12.5px;margin-bottom:8px">Zaproś znajomego wraz z głosowym pozdrowieniem — po kliknięciu linku zostaniecie automatycznie sparowani.</div>'}</div>
        <div id="dropQuickBox"></div>
        <form id="addFriendForm" class="sm-f">
          <strong>Zaproś znajomego z pozdrowieniem</strong>
          <input class="sm-in" name="from_name" placeholder="Twoje imię" value="${esc(localStorage.getItem(NAME_KEY) || '')}" required>
          <input class="sm-in" name="name" placeholder="Imię znajomego (np. Klaudia, Szymon)" required>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input class="sm-in" name="phone" placeholder="Telefon (+48...)">
            <input class="sm-in" name="email" placeholder="lub E-mail">
          </div>
          <select class="sm-sel" name="station_id">${stOpts}</select>
          <textarea class="sm-ta" name="greeting_message" rows="2" placeholder="Pozdrowienie wyczytane przez prowadzącego..."></textarea>
          <button class="sm-btn" type="submit">Dalej: Udostępnij przez aplikację</button>
        </form>`;
    } else if (activeTab === 'creator') {
      bodyHtml = `
        <form id="createRadioForm" class="sm-f">
          <strong>Własne radio na żywo / Kanał Twórcy YT</strong>
          <input class="sm-in" name="name" placeholder="Nazwa stacji (np. Cyber Kodowanie Live)" required>
          <input class="sm-in" name="creator_name" placeholder="Twórca / Kanał YouTube" value="${esc(localStorage.getItem(NAME_KEY) || '')}">
          <select class="sm-sel" name="mode"><option value="describe">Opisz klimat słowami</option><option value="modify">Zmodyfikuj wybraną stację</option></select>
          <select class="sm-sel" name="base_station_id">${stOpts}</select>
          <textarea class="sm-ta" name="description" rows="2" placeholder="Opisz brzmienie i klimat prowadzącego..."></textarea>
          <textarea class="sm-ta" name="pills_raw" rows="2" placeholder="Pigułki Twórcy / Linki YT (1 w linii: https://... | opis)"></textarea>
          <button class="sm-btn" type="submit">Utwórz stację i udostępnij</button>
        </form>
        <div style="margin-top:10px">${customRadios.slice(0, 6).map(r => `
          <div class="fr-row"><div><strong>${esc(r.name)}</strong> <span style="opacity:.6;font-size:11px">${esc(r.creator_name || r.base_station_id)}</span></div>
          <div style="display:flex;gap:6px"><button type="button" class="sh-btn" data-play-radio="${esc(r.slug)}">Włącz</button><button type="button" class="sh-btn" data-share-url="${esc(r.share_url)}" data-share-title="${esc(r.name)}">Udostępnij</button></div></div>`).join('')}</div>`;
    } else {
      bodyHtml = `
        <form id="outreachForm" class="sm-f">
          <strong>Link otwierający radio z podcastem o stronie WWW</strong>
          <input class="sm-in" name="from_name" placeholder="Twoje imię" value="${esc(localStorage.getItem(NAME_KEY) || '')}">
          <input class="sm-in" name="recipient_name" placeholder="Imię odbiorcy (opcjonalnie)">
          <input class="sm-in" name="url" placeholder="Adres strony WWW (https://...)" required>
          <select class="sm-sel" name="station_id">${stOpts}</select>
          <textarea class="sm-ta" name="comment" rows="2" placeholder="Opcjonalny komentarz na wejściu audycji..."></textarea>
          <button class="sm-btn" type="submit">Generuj i udostępnij przez...</button>
        </form>`;
    }
    const badgesSection = lastShareData ? `<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;margin-bottom:8px">Udostępnij przez...</div>${buildAppBadgesHtml(lastShareData)}</div>` : '';
    modal.innerHTML = `<div class="sm-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong style="font-family:'Unbounded',sans-serif;font-size:13.5px">STUDIO SPOŁECZNOŚCIOWE</strong>
        <button type="button" class="sh-btn" id="smCloseBtn">Zamknij</button>
      </div>
      <div class="sm-tabs">
        <button type="button" class="sm-tab${activeTab === 'friends' ? ' on' : ''}" data-tab="friends">Znajomi</button>
        <button type="button" class="sm-tab${activeTab === 'creator' ? ' on' : ''}" data-tab="creator">Własne Radio</button>
        <button type="button" class="sm-tab${activeTab === 'outreach' ? ' on' : ''}" data-tab="outreach">Podcast z WWW</button>
      </div>
      ${bodyHtml}
      ${badgesSection}
    </div>`;
    bindAppBadges(modal, m => app.toast(m));
  }

  hub.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openModal(b.dataset.open); });
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('#smCloseBtn')) { modal.classList.remove('open'); syncMobileNav(); return; }
    const tb = e.target.closest('[data-tab]');
    if (tb) { openModal(tb.dataset.tab); return; }
    const pr = e.target.closest('[data-play-radio]');
    if (pr) { modal.classList.remove('open'); syncMobileNav(); activateCustomRadio(pr.dataset.playRadio); return; }
    const su = e.target.closest('[data-share-url]');
    if (su) {
      openQuickShareSheet({ title: su.dataset.shareTitle || 'Własne Radio', url: su.dataset.shareUrl, text: `Posłuchaj stacji ${su.dataset.shareTitle} na żywo:`, onToast: m => app.toast(m) });
      return;
    }
    const dt = e.target.closest('[data-drop-to]');
    if (dt) {
      modal.querySelector('#dropQuickBox').innerHTML = `<form id="sendDropForm" class="sm-f" style="background:#151726;padding:10px;border-radius:11px;margin-bottom:10px">
        <strong>Wrzutka dla: ${esc(dt.dataset.dropName)}</strong>
        <input type="hidden" name="to_friend_id" value="${esc(dt.dataset.dropTo)}">
        <input type="hidden" name="to_name" value="${esc(dt.dataset.dropName)}">
        <select class="sm-sel" name="kind"><option value="greeting">Pozdrowienie głosowe</option><option value="pill">Pigułka wiedzy (z linku lub tekstu)</option><option value="podcast">Podcast dwugłosowy (z linku WWW lub tematu)</option></select>
        <input class="sm-in" name="source_url" placeholder="Opcjonalny link WWW (https://...)">
        <textarea class="sm-ta" name="message" rows="2" placeholder="Wiadomość lub temat..."></textarea>
        <button class="sm-btn" type="submit">Wyślij na antenę i udostępnij</button>
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
        modal.classList.remove('open'); syncMobileNav();
        const inv = stationMetaInvite(fd.station_id, `Pozdrowienie dla: ${fd.name}`, fd.greeting_message || 'wspólne słuchanie i głosowe przywitanie na antenie', fd.from_name, fd.name);
        openQuickShareSheet({ title: inv.title, url: res.share_url, text: formatInviteShareText(inv), invite: { html: buildInvitePreviewHtml(inv) }, onToast: m => app.toast(m) });
      } else if (f.id === 'sendDropForm') {
        const res = await sapi('/social/drops', { method: 'POST', body: JSON.stringify({ ...fd, station_id: app.prefs.station, topic: fd.message }) });
        modal.classList.remove('open'); syncMobileNav();
        const inv = res.drop?.invite || stationMetaInvite(app.prefs.station, `Audycja dla: ${fd.to_name}`, fd.message || fd.source_url || 'dedykowany materiał na antenie', localStorage.getItem(NAME_KEY) || '', fd.to_name);
        openQuickShareSheet({ title: inv.title, url: res.share_url, text: formatInviteShareText(inv), invite: { html: buildInvitePreviewHtml(inv) }, onToast: m => app.toast(m) });
      } else if (f.id === 'createRadioForm') {
        const pills = String(fd.pills_raw || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
          const [u, ...rest] = l.split('|');
          return { url: u.trim(), note: rest.join('|').trim(), title: rest.join('|').trim() || u.trim() };
        });
        const res = await sapi('/custom-radios', { method: 'POST', body: JSON.stringify({ ...fd, pills }) });
        modal.classList.remove('open'); syncMobileNav();
        activateCustomRadio(res.slug, false);
        const inv = stationMetaInvite(fd.base_station_id, fd.name, fd.description || 'autorska selekcja pigułek wiedzy i brzmienia na żywo', fd.creator_name);
        openQuickShareSheet({ title: `Stacja na żywo: ${fd.name}`, url: res.share_url, text: formatInviteShareText(inv), invite: { html: buildInvitePreviewHtml(inv) }, onToast: m => app.toast(m) });
      } else if (f.id === 'outreachForm') {
        app.toast('Analizuję stronę WWW i przygotowuję wieloczęściową audycję...');
        const res = await sapi('/social/url-podcast-link', { method: 'POST', body: JSON.stringify(fd) });
        modal.classList.remove('open'); syncMobileNav();
        const inv = res.invite || stationMetaInvite(fd.station_id, res.site_title, fd.comment || res.url, fd.from_name, fd.recipient_name, fd.comment);
        openQuickShareSheet({ title: `Audycja: ${inv.title}`, url: res.share_url, text: formatInviteShareText(inv), invite: { html: buildInvitePreviewHtml(inv) }, onToast: m => app.toast(m) });
      }
    } catch (err) {
      if (err.status === 429) { app.toast(err.message, { error: true, long: true }); return; } // daily podcast limit
      app.toast(err.message || 'Błąd połączenia');
    }
  });

  /* ---- 9) Segmented Podcast HUD + Exclusive Voice Playback & Dedicated Link Invitation Screen ---- */
  const banner = document.createElement('div');
  banner.id = 'hijackBanner';
  document.body.appendChild(banner);

  const podHud = createPodcastHud({
    onSkipBreak: () => app.engine?.skipPodcastInterlude?.(),
    onStop: () => app.engine?.stopPodcast?.(),
    onOpenPlus: () => app.openTab?.('plus'),
  });
  if (app.engine?.events) {
    app.engine.events.onPodcastHud = state => {
      if (state) podHud.show(state);
      else podHud.hide();
    };
  }

  const tuneStationImmediate = stId => {
    if (stId && byId[stId]) {
      app.commit(p => { p.station = stId; p.playGroup = false; });
      dial.goTo(byId[stId].idx, true);
      renderCard();
    }
  };

  async function runDropExclusive(drop, prefixLabel) {
    if (drop.station_id) tuneStationImmediate(drop.station_id);
    if (drop.podcast?.parts?.length) {
      await app.engine.playPodcast({
        id: drop.podcast.id || drop.token,
        title: drop.podcast.title || drop.site_title || 'Audycja specjalna',
        summary: drop.podcast.summary || drop.message || '',
        hosts: drop.podcast.hosts,
        parts: drop.podcast.parts,
      });
      return;
    }
    if (drop.audio_url) {
      banner.textContent = `${prefixLabel}: ${drop.from_name || 'Znajomy'} — ${drop.message || drop.pill_text || 'Pozdrowienia!'}`;
      banner.style.display = 'block';
      await app.engine.playExclusiveDrop({ urls: [drop.audio_url], caption: drop.message || drop.pill_text || prefixLabel });
      setTimeout(() => { banner.style.display = 'none'; }, 2400);
    }
  }

  async function activateCustomRadio(slug, showInvite = true) {
    const r = await sapi(`/custom-radios/${encodeURIComponent(slug)}`).catch(() => null);
    if (!r?.radio) return;
    const rad = r.radio;
    tuneStationImmediate(rad.base_station_id);
    if (showInvite) {
      const inv = stationMetaInvite(rad.base_station_id, rad.name, rad.description || 'autorska stacja na żywo wraz z wybranymi pigułkami wiedzy', rad.creator_name);
      openAuditionInvite({
        invite: inv,
        ready: true,
        ctaLabel: 'Włącz autorską stację i muzykę',
        onStart: async () => {
          tuneStationImmediate(rad.base_station_id);
          app.ensureEntered?.();
          if (!app.engine.playing) await app.engine.start({ intro: true });
          for (const pl of (rad.pills || [])) app.engine.enqueuePill({ title: pl.title || rad.name, text: pl.note || pl.title || '' });
        },
      });
    }
  }

  const sp = new URLSearchParams(location.search);
  if (sp.get('station') && byId[sp.get('station')]) tuneStationImmediate(sp.get('station'));
  if (sp.get('r')) activateCustomRadio(sp.get('r'), true);
  if (sp.get('w')) {
    sapi(`/social/drops/${encodeURIComponent(sp.get('w'))}/claim`, { method: 'POST', body: '{}' }).then(res => {
      const d = res.drop;
      if (!d) return;
      tuneStationImmediate(d.station_id);
      const inv = d.invite || stationMetaInvite(d.station_id, `Audycja od: ${d.from_name || 'Znajomego'}`, d.message || d.pill_text || 'dedykowane wejście na antenie', d.from_name, d.to_name);
      openAuditionInvite({
        invite: inv,
        ready: true,
        onStart: async () => {
          tuneStationImmediate(d.station_id);
          await app.core.unlock();
          await runDropExclusive(d, `NA ANTENIE OD ${(d.from_name || 'ZNAJOMEGO').toUpperCase()}`);
        },
      });
    }).catch(() => {});
  }
  if (sp.get('p')) {
    const ptok = sp.get('p');
    (async () => {
      let inviteHandle = null;
      let latestDrop = null;
      let autoStartRequested = false;
      for (let i = 0; i < 45; i++) {
        const res = await sapi(`/social/url-podcast-link/${encodeURIComponent(ptok)}`).catch(() => null);
        const d = res?.drop;
        if (!d) return;
        latestDrop = d;
        if (i === 0 && d.station_id) tuneStationImmediate(d.station_id);
        const isReady = d.podcast?.status === 'ready' && d.podcast.parts?.length > 0;
        const inv = d.invite || stationMetaInvite(d.station_id, d.site_title || 'Audycja specjalna', d.message || 'temat ze strony internetowej', d.from_name, d.to_name, d.comment);
        if (!inviteHandle) {
          inviteHandle = openAuditionInvite({
            invite: inv,
            ready: isReady,
            statusText: isReady
              ? 'Audycja podzielona na części z wejściem, przerwami muzycznymi i wyjściem jest gotowa.'
              : 'Prowadzący właśnie nagrywają w studiu części audycji — za moment startujemy...',
            onStart: async () => {
              autoStartRequested = true;
              tuneStationImmediate(latestDrop.station_id);
              await app.core.unlock();
              if (latestDrop.podcast?.parts?.length) await runDropExclusive(latestDrop, 'AUDYCJA SPECJALNA');
              else if (!app.engine.playing) await app.engine.start({ intro: false });
            },
          });
        } else {
          inviteHandle.update({
            invite: inv,
            ready: isReady,
            statusText: isReady
              ? 'Audycja gotowa — kliknij poniżej, aby wystartować wejście i muzykę.'
              : 'Dogrywamy ostatnie kwestie prowadzących...',
          });
        }
        if (isReady) {
          if (autoStartRequested) await runDropExclusive(d, 'AUDYCJA SPECJALNA');
          return;
        }
        await new Promise(r => setTimeout(r, 2200));
      }
    })();
  }

  const beatPresence = async () => {
    const res = await sapi('/social/presence', { method: 'POST', body: JSON.stringify({ station_id: app.prefs.station, display_name: localStorage.getItem(NAME_KEY) || '' }) }).catch(() => null);
    if (!res) return;
    app.onlineFriends = res.friends_online || [];
    app.friendStations = new Set(app.onlineFriends.map(f => f.station_id).filter(Boolean));
    renderHub();
    syncMobileNav();
    for (const d of (res.incoming_live_drops || [])) {
      /* Never interrupt an active podcast — runDropExclusive queues or waits cleanly */
      if (!app.engine.isPodcastPlaying()) runDropExclusive(d, 'WEJŚCIE NA ŻYWO');
      else if (d.audio_url) app.engine.playExclusiveDrop({ urls: [d.audio_url], caption: d.message || 'Wejście znajomego' });
    }
  };
  beatPresence();
  setInterval(beatPresence, 22000);
  syncFavBtn();
}
