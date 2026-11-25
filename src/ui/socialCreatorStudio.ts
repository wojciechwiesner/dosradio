/** Classic UI Social Hub, App-Badge "Udostępnij przez...", PWA Install & Mobile Bottom Nav (ZERO EMOJI). */
import type { PublicRadioEngine } from '../radio/publicRadioEngine';
import { getActiveStations, stationById } from '../radio/stations';

const CID_KEY = 'dosradio.client_id.v1';
const NAME_KEY = 'dosradio.display_name.v1';
const FAV_KEY = 'dosradio.favorites.v1';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
declare global {
  interface Window {
    __pwaPrompt?: BeforeInstallPromptEvent | null;
  }
}

interface FriendItem {
  id: string;
  name: string;
  online: boolean;
  station_id?: string | null;
}

interface CustomRadioItem {
  slug: string;
  name: string;
  creator_name: string;
  base_station_id: string;
  share_url: string;
}

const BADGE_SVGS: Record<string, string> = {
  native: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  wa: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M20 11.5A8.5 8.5 0 0 1 7.4 19L4 20l1.1-3.3A8.5 8.5 0 1 1 20 11.5z"/><path d="M9.2 8.8c.2-.4.5-.4.8-.4h.5c.2 0 .4.1.5.4l.6 1.4c.1.2 0 .5-.1.7l-.5.6c.5.9 1.3 1.7 2.2 2.2l.6-.5c.2-.1.5-.2.7-.1l1.4.6c.3.1.4.3.4.5v.5c0 .3 0 .6-.4.8-.5.3-1.4.4-2.5 0-2-.7-4-2.7-4.7-4.7-.4-1.1-.3-2 0-2.5z"/></svg>',
  tg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9"><path d="m21 4-3.2 15.2c-.2 1-.9 1.2-1.7.7l-4.6-3.4-2.2 2.1c-.3.3-.5.4-.9.4l.3-4.7 8.5-7.7c.4-.3-.1-.5-.6-.2L6.1 13 1.6 11.6c-1-.3-1-1 .2-1.5L19.6 3c.8-.3 1.6.2 1.4 1z"/></svg>',
  sms: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h8M8 13h5"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M10 13a5 5 0 0 0 7.5.5l2.8-2.8a5 5 0 0 0-7.1-7.1L11.7 5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2.8 2.8a5 5 0 0 0 7.1 7.1L12.3 19"/></svg>',
};

/** Line icons for the action row chips (same 24px grid and 2px stroke as the rest of the classic UI). */
const CHIP_SVGS: Record<string, string> = {
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  friends: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M16 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.7"/></svg>',
  radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="8" width="18" height="13"/><path d="m7 8 10-5"/><circle cx="15" cy="14.5" r="2.5"/><path d="M7 13h3M7 16h3"/></svg>',
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
};

function getClientId(): string {
  try {
    let v = localStorage.getItem(CID_KEY);
    if (!v) { v = 'cli_' + Math.random().toString(36).slice(2, 11); localStorage.setItem(CID_KEY, v); }
    return v;
  } catch { return 'cli_anon'; }
}

async function sapi<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const dname = localStorage.getItem(NAME_KEY) || '';
  const res = await fetch(`/radio-api${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': getClientId(),
      ...(dname ? { 'X-Display-Name': encodeURIComponent(dname) } : {}),
      ...(init.headers || {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(body.detail || `HTTP ${res.status}`));
  return body as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

export function wireClassicSocialStudio(
  engine: PublicRadioEngine,
  selectStationById: (id: string) => void,
  setStatus: (msg: string, isError?: boolean) => void,
): void {
  if (!document.getElementById('dos-social-studio-css')) {
    const style = el('style');
    style.id = 'dos-social-studio-css';
    style.textContent = `
      .dos-soc-bar{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0;align-items:center}
      .dos-soc-chip{background:transparent;border:1px solid var(--line-strong);color:var(--text);border-radius:0;padding:0 16px 0 12px;min-height:44px;font:500 14px/1.2 var(--font-sans);cursor:pointer;display:inline-flex;align-items:center;gap:8px;text-align:left}
      .dos-soc-chip svg{width:18px;height:18px;flex:none}
      .dos-soc-chip:hover{border-color:var(--text);background:var(--bg-3)}
      .dos-soc-chip.fav-on{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
      .dos-soc-chip.fav-on svg{fill:currentColor}
      .dos-pwa-btn{background:transparent;border:1px solid var(--line-strong);color:var(--text);border-radius:0;min-height:44px;padding:0 12px;font:500 14px var(--font-sans);cursor:pointer}
      .dos-pwa-btn:hover{border-color:var(--text)}
      .dos-pwa-btn[hidden]{display:none}
      #dos-soc-overlay{position:fixed;inset:0;z-index:9998;background:rgba(5,5,6,.82);display:none;align-items:center;justify-content:center;padding:16px}
      #dos-soc-overlay.open{display:flex}
      .dos-soc-modal{width:min(520px,100%);max-height:86vh;overflow-y:auto;background:var(--bg-2);border:1px solid var(--line-strong);border-top:4px solid var(--accent);padding:24px;color:var(--text)}
      .dos-soc-modal strong{font-size:20px;letter-spacing:-.02em}
      .dos-soc-tabs{display:flex;gap:0;margin:16px 0;overflow-x:auto;border-bottom:1px solid var(--line)}
      .dos-soc-tab{background:transparent;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;color:var(--dim);padding:0 16px;min-height:44px;font:500 14px var(--font-sans);cursor:pointer;white-space:nowrap}
      .dos-soc-tab:hover{color:var(--text)}
      .dos-soc-tab.on{border-bottom-color:var(--accent);color:var(--text)}
      .dos-soc-grid{display:grid;gap:8px;margin-top:8px}
      .dos-soc-in{width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line-strong);color:var(--text);border-radius:0;min-height:44px;padding:10px 12px;font:16px var(--font-sans)}
      .dos-soc-in:focus{outline:none;border-color:var(--accent)}
      .dos-soc-primary{background:var(--accent);color:var(--on-accent);border:0;border-radius:0;padding:0 16px;font:700 14px var(--font-sans);cursor:pointer;min-height:44px}
      .dos-soc-primary:hover{background:var(--text)}
      .dos-app-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:8px;background:var(--line);border:1px solid var(--line)}
      .dos-app-tile{background:var(--bg-2);border:0;color:var(--text);border-radius:0;padding:8px;min-height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-decoration:none;font:500 12px var(--font-sans);cursor:pointer}
      .dos-app-tile:hover{background:var(--bg-3)}
      .dos-app-ico{width:40px;height:40px;display:flex;align-items:center;justify-content:center;color:#fff}
      .dos-soc-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
      @media(max-width:760px){
        body{padding-bottom:72px}
        #classicMobNav{position:fixed;left:0;right:0;bottom:0;height:calc(56px + env(safe-area-inset-bottom,0px));padding-bottom:env(safe-area-inset-bottom,0px);background:var(--bg);border-top:1px solid var(--line-strong);z-index:900;display:grid;grid-template-columns:repeat(5,1fr)}
        #orbitaShell:not([hidden]) ~ #classicMobNav{display:none!important}
        .cmn-btn{border:0;background:transparent;color:var(--dim);font:500 12px/1.2 var(--font-sans);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:56px;cursor:pointer}
        .cmn-btn:hover,.cmn-btn:active{color:var(--accent)}
      }
      @media(min-width:761px){#classicMobNav{display:none}}
    `;
    document.head.appendChild(style);
  }

  /* ---- PWA Install Button in Classic Top Header ---- */
  const isStandalone = () => Boolean(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone);
  const topActions = document.querySelector('.top-actions');
  const pwaBtn = el('button', 'dos-pwa-btn', 'Zainstaluj aplikację');
  pwaBtn.type = 'button';
  pwaBtn.hidden = isStandalone();
  window.addEventListener('dos-pwa-installed', () => { pwaBtn.hidden = true; });
  pwaBtn.onclick = async () => {
    if (window.__pwaPrompt) {
      await window.__pwaPrompt.prompt();
      const ch = await window.__pwaPrompt.userChoice.catch(() => null);
      if (ch?.outcome === 'accepted') window.__pwaPrompt = null;
      return;
    }
    window.alert('Aby zainstalować DOS Radio na ekranie głównym: otwórz menu przeglądarki lub przycisk Udostępnij i wybierz „Dodaj do ekranu początkowego / Zainstaluj aplikację”.');
  };
  topActions?.prepend(pwaBtn);

  const favs = new Set<string>(JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[]);
  const saveFavs = () => localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));

  const hostAnchor = document.getElementById('dedicateBtn')?.parentElement || document.getElementById('status')?.parentElement;
  const bar = el('div', 'dos-soc-bar');
  const iconChip = (icon: string, label: string) => {
    const chip = el('button', 'dos-soc-chip');
    chip.type = 'button';
    chip.innerHTML = CHIP_SVGS[icon]; // static SVG constant
    chip.append(el('span', 'dos-soc-label', label));
    return chip;
  };
  const btnShareQuick = iconChip('share', 'Udostępnij');
  const btnFriends = iconChip('friends', 'Znajomi');
  const btnCreator = iconChip('radio', 'Własne radio');
  const btnOutreach = iconChip('web', 'Podcast z WWW');
  const btnFav = iconChip('star', 'Do ulubionych');
  const favLabel = btnFav.querySelector('.dos-soc-label')!;
  [btnShareQuick, btnFriends, btnCreator, btnOutreach, btnFav].forEach((b) => bar.appendChild(b));
  hostAnchor?.appendChild(bar);

  const syncFav = () => {
    const on = favs.has(engine.currentStation.id);
    btnFav.classList.toggle('fav-on', on);
    btnFav.setAttribute('aria-pressed', String(on));
    favLabel.textContent = on ? 'W ulubionych' : 'Do ulubionych';
  };
  btnFav.onclick = () => {
    const sid = engine.currentStation.id;
    if (favs.has(sid)) favs.delete(sid); else favs.add(sid);
    saveFavs(); syncFav();
  };
  setInterval(syncFav, 1500);

  const overlay = el('div');
  overlay.id = 'dos-soc-overlay';
  document.body.appendChild(overlay);

  const renderAppBadgeGrid = (target: HTMLElement, url: string, text: string, title = 'DOS Radio') => {
    target.replaceChildren();
    const hdr = el('div', '', 'Udostępnij przez...');
    hdr.style.cssText = 'font-weight:700;font-size:13px;margin-top:12px';
    target.appendChild(hdr);
    const grid = el('div', 'dos-app-grid');
    const full = `${text ? text + ' ' : ''}${url}`.trim();
    const makeTile = (lbl: string, bg: string, fg: string, svgKey: string, href?: string, onClick?: () => void) => {
      const node = href ? el('a', 'dos-app-tile') : el('button', 'dos-app-tile');
      if (href && node instanceof HTMLAnchorElement) { node.href = href; node.target = '_blank'; node.rel = 'noopener'; }
      if (!href && node instanceof HTMLButtonElement) node.type = 'button';
      const ico = el('span', 'dos-app-ico');
      ico.style.background = bg; ico.style.color = fg;
      ico.innerHTML = BADGE_SVGS[svgKey] || '';
      node.appendChild(ico);
      node.appendChild(el('span', '', lbl));
      if (onClick) node.onclick = onClick;
      grid.appendChild(node);
    };
    makeTile('Więcej apek', '#6366f1', '#fff', 'native', undefined, () => {
      if (navigator.share) void navigator.share({ title, text, url }).catch(() => {});
      else { void navigator.clipboard?.writeText(url); setStatus('Skopiowano link.'); }
    });
    makeTile('WhatsApp', '#25D366', '#062814', 'wa', `https://wa.me/?text=${encodeURIComponent(full)}`);
    makeTile('Telegram', '#2AABEE', '#041f2e', 'tg', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
    makeTile('SMS', '#34C759', '#05290f', 'sms', `sms:?body=${encodeURIComponent(full)}`);
    makeTile('E-mail', '#3B82F6', '#fff', 'mail', `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(full)}`);
    makeTile('Kopiuj link', '#F59E0B', '#241400', 'copy', undefined, () => {
      void navigator.clipboard?.writeText(url);
      setStatus('Skopiowano link do schowka.');
    });
    target.appendChild(grid);
  };

  btnShareQuick.onclick = () => {
    overlay.classList.add('open');
    overlay.replaceChildren();
    const modal = el('div', 'dos-soc-modal');
    const top = el('div'); top.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
    top.appendChild(el('strong', '', `Udostępnij · ${engine.currentStation.name}`));
    const cl = el('button', 'dos-soc-chip', 'Zamknij'); cl.type = 'button'; cl.onclick = () => overlay.classList.remove('open');
    top.appendChild(cl); modal.appendChild(top);
    const badgeMount = el('div');
    renderAppBadgeGrid(badgeMount, `${location.origin}/?station=${encodeURIComponent(engine.currentStation.id)}`, `Posłuchaj stacji ${engine.currentStation.name} w DOS Radio:`);
    modal.appendChild(badgeMount);
    overlay.appendChild(modal);
  };

  let tab: 'friends' | 'creator' | 'outreach' = 'friends';
  async function openStudio(nextTab: typeof tab): Promise<void> {
    tab = nextTab;
    overlay.classList.add('open');
    overlay.replaceChildren();
    const modal = el('div', 'dos-soc-modal');
    const top = el('div'); top.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
    top.appendChild(el('strong', '', 'STUDIO SPOŁECZNOŚCIOWE'));
    const close = el('button', 'dos-soc-chip', 'Zamknij'); close.type = 'button'; close.onclick = () => overlay.classList.remove('open');
    top.appendChild(close); modal.appendChild(top);

    const tabs = el('div', 'dos-soc-tabs');
    for (const [id, label] of [['friends', 'Znajomi'], ['creator', 'Własne Radio'], ['outreach', 'Podcast z WWW']] as const) {
      const tb = el('button', `dos-soc-tab${tab === id ? ' on' : ''}`, label);
      tb.type = 'button'; tb.onclick = () => void openStudio(id);
      tabs.appendChild(tb);
    }
    modal.appendChild(tabs);

    const body = el('div');
    const shareBox = el('div');
    const stationSelect = () => {
      const sel = el('select', 'dos-soc-in'); sel.name = 'station_id';
      for (const s of getActiveStations()) {
        const opt = el('option', '', s.name); opt.value = s.id;
        if (s.id === engine.currentStation.id) opt.selected = true;
        sel.appendChild(opt);
      }
      return sel;
    };

    if (tab === 'friends') {
      const data = await sapi<{ friends: FriendItem[] }>('/social/friends').catch(() => ({ friends: [] }));
      for (const f of data.friends) {
        const row = el('div', 'dos-soc-row');
        row.appendChild(el('span', '', `${f.name} (${f.online ? `na żywo: ${f.station_id || 'radio'}` : 'offline'})`));
        const dropBtn = el('button', 'dos-soc-primary', 'Pozdrów'); dropBtn.type = 'button';
        dropBtn.onclick = async () => {
          const msg = window.prompt(`Pozdrowienie / pigułka dla ${f.name}:`, 'Dobrego odsłuchu!') || '';
          if (!msg) return;
          const res = await sapi('/social/drops', { method: 'POST', body: JSON.stringify({ to_friend_id: f.id, to_name: f.name, kind: 'greeting', station_id: engine.currentStation.id, message: msg }) });
          renderAppBadgeGrid(shareBox, String(res.share_url || ''), `Wrzutka na antenę DOS Radio dla ${f.name}:`);
        };
        row.appendChild(dropBtn); body.appendChild(row);
      }
      const form = el('form', 'dos-soc-grid');
      const inFrom = el('input', 'dos-soc-in'); inFrom.name = 'from_name'; inFrom.placeholder = 'Twoje imię'; inFrom.value = localStorage.getItem(NAME_KEY) || '';
      const inName = el('input', 'dos-soc-in'); inName.name = 'name'; inName.placeholder = 'Imię znajomego'; inName.required = true;
      const inPhone = el('input', 'dos-soc-in'); inPhone.name = 'phone'; inPhone.placeholder = 'Telefon (+48...)';
      const inEmail = el('input', 'dos-soc-in'); inEmail.name = 'email'; inEmail.placeholder = 'lub E-mail';
      const inMsg = el('textarea', 'dos-soc-in'); inMsg.name = 'greeting_message'; inMsg.rows = 2; inMsg.placeholder = 'Pozdrowienie głosowe na antenie...';
      const sub = el('button', 'dos-soc-primary', 'Utwórz i udostępnij przez...'); sub.type = 'submit';
      [inFrom, inName, inPhone, inEmail, stationSelect(), inMsg, sub].forEach((n) => form.appendChild(n));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        if (fd.from_name) localStorage.setItem(NAME_KEY, String(fd.from_name));
        const res = await sapi('/social/friends', { method: 'POST', body: JSON.stringify({ ...fd, with_greeting: true }) });
        renderAppBadgeGrid(shareBox, String(res.share_url || ''), `Cześć ${String(fd.name)}! Pozdrowienie na antenie DOS Radio:`);
      };
      body.appendChild(form);
    } else if (tab === 'creator') {
      const form = el('form', 'dos-soc-grid');
      const inName = el('input', 'dos-soc-in'); inName.name = 'name'; inName.placeholder = 'Nazwa Twojego radia'; inName.required = true;
      const inCreator = el('input', 'dos-soc-in'); inCreator.name = 'creator_name'; inCreator.placeholder = 'Twórca / Kanał YT';
      const inDesc = el('textarea', 'dos-soc-in'); inDesc.name = 'description'; inDesc.rows = 2; inDesc.placeholder = 'Opisz klimat lub modyfikację...';
      const inPills = el('textarea', 'dos-soc-in'); inPills.name = 'pills_raw'; inPills.rows = 2; inPills.placeholder = 'Linki YT / pigułki (1 w linii)';
      const sub = el('button', 'dos-soc-primary', 'Utwórz stację i udostępnij'); sub.type = 'submit';
      [inName, inCreator, stationSelect(), inDesc, inPills, sub].forEach((n) => form.appendChild(n));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        const pills = String(fd.pills_raw || '').split('\n').map((l) => l.trim()).filter(Boolean).map((u) => ({ url: u, title: u, note: '' }));
        const res = await sapi('/custom-radios', { method: 'POST', body: JSON.stringify({ ...fd, base_station_id: fd.station_id, pills }) });
        renderAppBadgeGrid(shareBox, String(res.share_url || ''), `Posłuchaj mojej stacji ${String(fd.name)} w DOS Radio:`);
      };
      body.appendChild(form);
    } else {
      const form = el('form', 'dos-soc-grid');
      const inFrom = el('input', 'dos-soc-in'); inFrom.name = 'from_name'; inFrom.placeholder = 'Twoje imię'; inFrom.value = localStorage.getItem(NAME_KEY) || '';
      const inRec = el('input', 'dos-soc-in'); inRec.name = 'recipient_name'; inRec.placeholder = 'Imię odbiorcy';
      const inUrl = el('input', 'dos-soc-in'); inUrl.name = 'url'; inUrl.placeholder = 'Adres strony WWW (https://...)'; inUrl.required = true;
      const inCom = el('textarea', 'dos-soc-in'); inCom.name = 'comment'; inCom.rows = 2; inCom.placeholder = 'Opcjonalny komentarz na start...';
      const sub = el('button', 'dos-soc-primary', 'Generuj link i udostępnij przez...'); sub.type = 'submit';
      [inFrom, inRec, inUrl, stationSelect(), inCom, sub].forEach((n) => form.appendChild(n));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        try {
          const res = await sapi('/social/url-podcast-link', { method: 'POST', body: JSON.stringify(fd) });
          renderAppBadgeGrid(shareBox, String(res.share_url || ''), `Posłuchaj audycji o stronie ${String(res.site_title || '')}:`);
        } catch (error) {
          shareBox.textContent = (error as Error).message; // e.g. the daily podcast limit (HTTP 429)
        }
      };
      body.appendChild(form);
    }
    modal.appendChild(body); modal.appendChild(shareBox); overlay.appendChild(modal);
  }

  btnFriends.onclick = () => void openStudio('friends');
  btnCreator.onclick = () => void openStudio('creator');
  btnOutreach.onclick = () => void openStudio('outreach');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

  /* ---- Classic Mobile Bottom Nav ---- */
  const cNav = el('nav'); cNav.id = 'classicMobNav';
  const navItems: Array<[string, () => void]> = [
    ['Orbita', () => document.getElementById('viewOrbitaBtn')?.click()],
    ['Stacje', () => document.getElementById('stationsSection')?.scrollIntoView({ behavior: 'smooth' })],
    ['Moje', () => document.querySelector('.settings')?.scrollIntoView({ behavior: 'smooth' })],
    ['Podcast', () => document.getElementById('plusPanel')?.scrollIntoView({ behavior: 'smooth' })],
    ['Znajomi', () => void openStudio('friends')],
  ];
  for (const [lbl, fn] of navItems) {
    const b = el('button', 'cmn-btn', lbl); b.type = 'button'; b.onclick = fn; cNav.appendChild(b);
  }
  document.body.appendChild(cNav);

  const sp = new URLSearchParams(window.location.search);
  if (sp.get('station')) selectStationById(stationById(String(sp.get('station'))).id);
  const rSlug = sp.get('r');
  if (rSlug) {
    sapi<{ radio: CustomRadioItem }>(`/custom-radios/${encodeURIComponent(rSlug)}`).then(({ radio }) => {
      if (radio?.base_station_id) selectStationById(stationById(radio.base_station_id).id);
    }).catch(() => {});
  }
}
