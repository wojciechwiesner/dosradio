/** Classic UI Social Hub, Invite-with-Greeting, Creator/YouTuber Radios & Website-Podcast Links (ZERO EMOJI). */
import type { PublicRadioEngine } from '../radio/publicRadioEngine';
import { getActiveStations, stationById } from '../radio/stations';

const CID_KEY = 'dosradio.client_id.v1';
const NAME_KEY = 'dosradio.display_name.v1';
const FAV_KEY = 'dosradio.favorites.v1';

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
  pills?: Array<{ title: string; url: string; note: string }>;
}

function getClientId(): string {
  try {
    let v = localStorage.getItem(CID_KEY);
    if (!v) {
      v = 'cli_' + Math.random().toString(36).slice(2, 11);
      localStorage.setItem(CID_KEY, v);
    }
    return v;
  } catch {
    return 'cli_anon';
  }
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
      .dos-soc-bar{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 14px;align-items:center}
      .dos-soc-chip{background:#151822;border:1px solid rgba(255,255,255,.14);color:#f3f4f6;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
      .dos-soc-chip:hover{border-color:#ff6b3d;color:#fff}
      .dos-soc-chip.fav-on{border-color:#fbbf24;color:#fbbf24}
      .dos-soc-dot{width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981}
      #dos-soc-overlay{position:fixed;inset:0;z-index:9998;background:rgba(7,9,14,.78);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;padding:16px}
      #dos-soc-overlay.open{display:flex}
      .dos-soc-modal{width:min(560px,100%);max-height:88vh;overflow-y:auto;background:#11131c;border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:20px;color:#f3f4f6}
      .dos-soc-tabs{display:flex;gap:6px;margin:10px 0 14px;overflow-x:auto}
      .dos-soc-tab{background:rgba(255,255,255,.06);border:1px solid transparent;color:#cbd5e1;border-radius:999px;padding:7px 12px;font-size:12px;cursor:pointer;white-space:nowrap}
      .dos-soc-tab.on{background:rgba(255,107,61,.2);border-color:#ff6b3d;color:#fff}
      .dos-soc-grid{display:grid;gap:8px;margin-top:8px}
      .dos-soc-in{width:100%;box-sizing:border-box;background:#181b28;border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:10px;padding:9px 11px;font-size:13px}
      .dos-soc-primary{background:#ff6b3d;color:#0b0c10;border:0;border-radius:10px;padding:10px 14px;font-weight:600;font-size:13px;cursor:pointer}
      .dos-soc-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .dos-soc-links a,.dos-soc-links button{background:#1c2030;border:1px solid rgba(255,255,255,.16);color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer}
      .dos-soc-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;background:#171a26;border-radius:10px;margin-bottom:6px;font-size:13px}
    `;
    document.head.appendChild(style);
  }

  const favs = new Set<string>(JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[]);
  const saveFavs = () => localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));

  const hostAnchor = document.getElementById('dedicateBtn')?.parentElement || document.getElementById('status')?.parentElement;
  const bar = el('div', 'dos-soc-bar');
  const btnFriends = el('button', 'dos-soc-chip', 'Znajomi i Wrzutki');
  const btnCreator = el('button', 'dos-soc-chip', 'Własne Radio / YT');
  const btnOutreach = el('button', 'dos-soc-chip', 'Podcast ze Strony WWW');
  const btnFav = el('button', 'dos-soc-chip', 'Ulubiona stacja');
  [btnFriends, btnCreator, btnOutreach, btnFav].forEach((b) => {
    b.type = 'button';
    bar.appendChild(b);
  });
  hostAnchor?.appendChild(bar);

  const syncFav = () => {
    const on = favs.has(engine.currentStation.id);
    btnFav.classList.toggle('fav-on', on);
    btnFav.textContent = on ? 'W ulubionych' : 'Dodaj do ulubionych';
  };
  btnFav.addEventListener('click', () => {
    const sid = engine.currentStation.id;
    if (favs.has(sid)) favs.delete(sid);
    else favs.add(sid);
    saveFavs();
    syncFav();
  });
  setInterval(syncFav, 1500);

  const overlay = el('div');
  overlay.id = 'dos-soc-overlay';
  document.body.appendChild(overlay);

  let tab: 'friends' | 'creator' | 'outreach' = 'friends';
  let shareBox: HTMLElement | null = null;

  const renderShareLinks = (target: HTMLElement, res: Record<string, unknown>) => {
    target.replaceChildren();
    const wrap = el('div', 'dos-soc-links');
    const pairs: Array<[string, string]> = [
      ['WhatsApp', String(res.whatsapp_url || '')],
      ['Telegram', String(res.telegram_url || '')],
      ['E-mail', String(res.mailto_url || '')],
      ['SMS', String(res.sms_url || '')],
    ];
    for (const [label, href] of pairs) {
      if (!href) continue;
      const a = el('a', '', label);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      wrap.appendChild(a);
    }
    const shareUrl = String(res.share_url || '');
    if (shareUrl) {
      const cp = el('button', '', 'Kopiuj link');
      cp.type = 'button';
      cp.onclick = () => {
        void navigator.clipboard?.writeText(shareUrl);
        setStatus('Skopiowano link radiowy do schowka.');
      };
      wrap.appendChild(cp);
    }
    target.appendChild(wrap);
  };

  async function openStudio(nextTab: typeof tab): Promise<void> {
    tab = nextTab;
    overlay.classList.add('open');
    overlay.replaceChildren();
    const modal = el('div', 'dos-soc-modal');
    const top = el('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
    top.appendChild(el('strong', '', 'DOS RADIO · STUDIO SPOŁECZNOŚCIOWE'));
    const close = el('button', 'dos-soc-chip', 'Zamknij');
    close.type = 'button';
    close.onclick = () => overlay.classList.remove('open');
    top.appendChild(close);
    modal.appendChild(top);

    const tabs = el('div', 'dos-soc-tabs');
    const defs: Array<[typeof tab, string]> = [
      ['friends', 'Znajomi i Pozdrowienia'],
      ['creator', 'Własne Radio / YT'],
      ['outreach', 'Podcast ze Strony WWW'],
    ];
    for (const [id, label] of defs) {
      const tb = el('button', `dos-soc-tab${tab === id ? ' on' : ''}`, label);
      tb.type = 'button';
      tb.onclick = () => void openStudio(id);
      tabs.appendChild(tb);
    }
    modal.appendChild(tabs);

    const body = el('div');
    shareBox = el('div');
    const stationSelect = () => {
      const sel = el('select', 'dos-soc-in');
      sel.name = 'station_id';
      for (const s of getActiveStations()) {
        const opt = el('option', '', s.name);
        opt.value = s.id;
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
        const dropBtn = el('button', 'dos-soc-primary', 'Wyślij pozdrowienie');
        dropBtn.type = 'button';
        dropBtn.onclick = async () => {
          const msg = window.prompt(`Wiadomość / pigułka dla ${f.name}:`, 'Dobrego odsłuchu!') || '';
          if (!msg) return;
          const res = await sapi('/social/drops', {
            method: 'POST',
            body: JSON.stringify({ to_friend_id: f.id, to_name: f.name, kind: 'greeting', station_id: engine.currentStation.id, message: msg }),
          });
          if (shareBox) renderShareLinks(shareBox, res);
          setStatus(`Wrzutka wysłana do ${f.name}!`);
        };
        row.appendChild(dropBtn);
        body.appendChild(row);
      }
      const form = el('form', 'dos-soc-grid');
      form.appendChild(el('strong', '', 'Zaproś znajomego wraz z pozdrowieniem'));
      const inFrom = el('input', 'dos-soc-in'); inFrom.name = 'from_name'; inFrom.placeholder = 'Twoje imię'; inFrom.value = localStorage.getItem(NAME_KEY) || '';
      const inName = el('input', 'dos-soc-in'); inName.name = 'name'; inName.placeholder = 'Imię znajomego'; inName.required = true;
      const inPhone = el('input', 'dos-soc-in'); inPhone.name = 'phone'; inPhone.placeholder = 'Telefon (+48...)';
      const inEmail = el('input', 'dos-soc-in'); inEmail.name = 'email'; inEmail.placeholder = 'lub E-mail';
      const inMsg = el('textarea', 'dos-soc-in'); inMsg.name = 'greeting_message'; inMsg.rows = 2; inMsg.placeholder = 'Treść pozdrowienia na antenie...';
      const sub = el('button', 'dos-soc-primary', 'Utwórz zaproszenie z pozdrowieniem'); sub.type = 'submit';
      [inFrom, inName, inPhone, inEmail, stationSelect(), inMsg, sub].forEach((n) => form.appendChild(n));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        if (fd.from_name) localStorage.setItem(NAME_KEY, String(fd.from_name));
        const res = await sapi('/social/friends', { method: 'POST', body: JSON.stringify({ ...fd, with_greeting: true }) });
        if (shareBox) renderShareLinks(shareBox, res);
      };
      body.appendChild(form);
    } else if (tab === 'creator') {
      const form = el('form', 'dos-soc-grid');
      form.appendChild(el('strong', '', 'Stwórz własne radio lub stację Twórcy / YouTubera'));
      const inName = el('input', 'dos-soc-in'); inName.name = 'name'; inName.placeholder = 'Nazwa Twojego radia'; inName.required = true;
      const inCreator = el('input', 'dos-soc-in'); inCreator.name = 'creator_name'; inCreator.placeholder = 'Twórca / Kanał YT';
      const inDesc = el('textarea', 'dos-soc-in'); inDesc.name = 'description'; inDesc.rows = 2; inDesc.placeholder = 'Opisz brzmienie lub modyfikację stacji...';
      const inPills = el('textarea', 'dos-soc-in'); inPills.name = 'pills_raw'; inPills.rows = 3; inPills.placeholder = 'Linki do pigułek / filmów YT (1 w linii: https://... | opis)';
      const sub = el('button', 'dos-soc-primary', 'Utwórz stację na żywo'); sub.type = 'submit';
      [inName, inCreator, stationSelect(), inDesc, inPills, sub].forEach((n) => form.appendChild(n));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        const pills = String(fd.pills_raw || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [u, ...rest] = l.split('|');
          return { url: u.trim(), note: rest.join('|').trim(), title: rest.join('|').trim() || u.trim() };
        });
        const res = await sapi('/custom-radios', { method: 'POST', body: JSON.stringify({ ...fd, base_station_id: fd.station_id, pills }) });
        if (shareBox) renderShareLinks(shareBox, res);
        setStatus(`Utworzono stację: ${String(fd.name)}`);
      };
      body.appendChild(form);
      const list = await sapi<{ radios: CustomRadioItem[] }>('/custom-radios').catch(() => ({ radios: [] }));
      for (const r of list.radios.slice(0, 8)) {
        const row = el('div', 'dos-soc-row');
        row.appendChild(el('span', '', `${r.name} · ${r.creator_name || r.base_station_id}`));
        const play = el('button', 'dos-soc-chip', 'Włącz');
        play.type = 'button';
        play.onclick = () => {
          selectStationById(r.base_station_id);
          overlay.classList.remove('open');
          setStatus(`Słuchasz stacji twórcy: ${r.name}`);
        };
        row.appendChild(play);
        body.appendChild(row);
      }
    } else {
      const form = el('form', 'dos-soc-grid');
      form.appendChild(el('strong', '', 'Wygeneruj link otwierający radio z podcastem o stronie WWW'));
      const inFrom = el('input', 'dos-soc-in'); inFrom.name = 'from_name'; inFrom.placeholder = 'Twoje imię'; inFrom.value = localStorage.getItem(NAME_KEY) || '';
      const inRec = el('input', 'dos-soc-in'); inRec.name = 'recipient_name'; inRec.placeholder = 'Imię odbiorcy (opcjonalnie)';
      const inUrl = el('input', 'dos-soc-in'); inUrl.name = 'url'; inUrl.placeholder = 'Adres strony WWW (https://...)'; inUrl.required = true;
      const inCom = el('textarea', 'dos-soc-in'); inCom.name = 'comment'; inCom.rows = 2; inCom.placeholder = 'Opcjonalny komentarz na start audycji...';
      const sub = el('button', 'dos-soc-primary', 'Generuj link z podcastem'); sub.type = 'submit';
      [inFrom, inRec, inUrl, stationSelect(), inCom, sub].forEach((n) => form.appendChild(n));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        setStatus('Pobieram treść strony WWW i uruchamiam syntezę podcastu...');
        const res = await sapi('/social/url-podcast-link', { method: 'POST', body: JSON.stringify(fd) });
        if (shareBox) renderShareLinks(shareBox, res);
        setStatus(`Gotowe! Link dla strony „${String(res.site_title || '')}” jest aktywny.`);
      };
      body.appendChild(form);
    }

    modal.appendChild(body);
    modal.appendChild(shareBox);
    overlay.appendChild(modal);
  }

  btnFriends.onclick = () => void openStudio('friends');
  btnCreator.onclick = () => void openStudio('creator');
  btnOutreach.onclick = () => void openStudio('outreach');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

  const playVoiceUrls = async (urls: string[]) => {
    const audios = Array.from(document.querySelectorAll('audio'));
    const prev = audios.map((a) => a.volume);
    audios.forEach((a) => { a.volume = Math.min(a.volume, 0.22); });
    for (const u of urls) {
      await new Promise<void>((resolve) => {
        const clip = new Audio(u);
        clip.onended = () => resolve();
        clip.onerror = () => resolve();
        clip.play().catch(() => resolve());
      });
    }
    audios.forEach((a, i) => { a.volume = prev[i] ?? 1; });
  };

  const sp = new URLSearchParams(window.location.search);
  const rSlug = sp.get('r');
  if (rSlug) {
    sapi<{ radio: CustomRadioItem }>(`/custom-radios/${encodeURIComponent(rSlug)}`).then(({ radio }) => {
      if (radio?.base_station_id) {
        selectStationById(stationById(radio.base_station_id).id);
        setStatus(`Stacja autorska: ${radio.name}${radio.creator_name ? ` (${radio.creator_name})` : ''}`);
      }
    }).catch(() => {});
  }
  const wTok = sp.get('w');
  if (wTok) {
    sapi<{ drop: Record<string, any> }>(`/social/drops/${encodeURIComponent(wTok)}/claim`, { method: 'POST', body: '{}' }).then(({ drop }) => {
      if (drop?.station_id) selectStationById(stationById(String(drop.station_id)).id);
      if (drop?.dedication) engine.setPendingDedication(drop.dedication);
      setStatus(`Wrzutka na antenie od ${String(drop?.from_name || 'znajomego')} — kliknij Graj!`);
    }).catch(() => {});
  }
  const pTok = sp.get('p');
  if (pTok) {
    void (async () => {
      for (let i = 0; i < 35; i++) {
        const res = await sapi<{ drop: Record<string, any> }>(`/social/url-podcast-link/${encodeURIComponent(pTok)}`).catch(() => null);
        const d = res?.drop;
        if (!d) return;
        if (i === 0 && d.station_id) selectStationById(stationById(String(d.station_id)).id);
        if (d.podcast?.status === 'ready' && Array.isArray(d.podcast.parts) && d.podcast.parts.length) {
          setStatus(`Audycja o stronie „${String(d.site_title || '')}” gotowa — włącz Graj!`);
          const waitPlay = setInterval(() => {
            if (engine.isPlaying) {
              clearInterval(waitPlay);
              setTimeout(() => void playVoiceUrls(d.podcast.parts.map((p: { url: string }) => p.url)), 2200);
            }
          }, 600);
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    })();
  }

  setInterval(() => {
    void sapi<{ friends_online: FriendItem[]; incoming_live_drops: Array<Record<string, any>> }>('/social/presence', {
      method: 'POST',
      body: JSON.stringify({ station_id: engine.currentStation.id }),
    }).then((res) => {
      const cnt = (res.friends_online || []).length;
      btnFriends.textContent = cnt ? `Znajomi na żywo (${cnt})` : 'Znajomi i Wrzutki';
      for (const d of res.incoming_live_drops || []) {
        if (d.audio_url && engine.isPlaying) void playVoiceUrls([String(d.audio_url)]);
      }
    }).catch(() => {});
  }, 25000);
}
