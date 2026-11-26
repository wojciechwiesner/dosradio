/**
 * Classic view: listener comments for the host.
 * Icon-row button opens a small form, a live feed shows the last accepted comments per
 * station with a "na antenie" badge, and the sender sees "Twój komentarz poszedł na antenę"
 * with the clip and a share link once the host reads it (the viral loop).
 */
import type { PublicRadioEngine } from '../radio/publicRadioEngine';
import type { ListenerComment } from '../radio/radioApi';
import { hostStationId } from '../radio/stations';

const MAX_TEXT = 280;
const MINE_KEY = 'dosradio.myComment';
const NICK_KEY = 'dosradio.commentNick';
const FEED_POLL_MS = 30_000;
const MINE_POLL_MS = 20_000;
const MINE_TTL_MS = 50 * 60_000;

const ICON_MIC =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_SHARE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';

interface MineRef {
  id: string;
  at: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function loadMine(): MineRef | null {
  try {
    const raw = JSON.parse(localStorage.getItem(MINE_KEY) || 'null') as MineRef | null;
    return raw && typeof raw.id === 'string' && Date.now() - raw.at < MINE_TTL_MS ? raw : null;
  } catch {
    return null;
  }
}

function saveMine(ref: MineRef | null): void {
  try {
    if (ref) localStorage.setItem(MINE_KEY, JSON.stringify(ref));
    else localStorage.removeItem(MINE_KEY);
  } catch {
    /* private mode */
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const body = (await res.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : 'Nie udało się wysłać komentarza. Spróbuj za chwilę.';
    throw new Error(detail);
  }
  return body;
}

export async function shareComment(c: ListenerComment, classic = true): Promise<string> {
  const url = `${window.location.origin}${classic ? c.classic_share_url : c.share_url}`;
  const text = `Mój komentarz poszedł na antenę AmbiRadio. Posłuchaj odpowiedzi prowadzącego (${c.host_name}):`;
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title: 'AmbiRadio — Ambitnie dla Ciebie', text, url });
      return 'Udostępniono.';
    } catch {
      /* fall through to clipboard */
    }
  }
  await navigator.clipboard?.writeText(`${text} ${url}`).catch(() => {});
  return 'Link skopiowany.';
}

export function wireClassicComments(engine: PublicRadioEngine, setStatus: (msg: string) => void): void {
  const btn = document.getElementById('commentBtn');
  const feed = document.getElementById('commentFeed');
  if (!btn || !feed) return;
  let feedStation = '';
  let clip: HTMLAudioElement | null = null;

  const playClip = (url: string, button: HTMLButtonElement) => {
    if (clip && !clip.paused) {
      clip.pause();
      button.classList.remove('playing');
      return;
    }
    clip = new Audio(url);
    button.classList.add('playing');
    clip.addEventListener('ended', () => button.classList.remove('playing'));
    void clip.play().catch(() => button.classList.remove('playing'));
  };

  const renderMine = (mine: ListenerComment | null) => {
    feed.querySelector('.cmt-mine')?.remove();
    if (!mine) return;
    const box = el('div', `cmt-mine${mine.on_air ? ' aired' : ''}`);
    const head = el('div', 'cmt-mine-head');
    head.innerHTML = ICON_MIC;
    head.append(el('span', '', mine.on_air ? 'Twój komentarz poszedł na antenę' : 'Twój komentarz czeka na prowadzącego'));
    box.append(head, el('p', 'cmt-mine-text', mine.text));
    if (mine.on_air) {
      const row = el('div', 'cmt-mine-actions');
      if (mine.clip_url) {
        const listen = el('button', 'btn ghost cmt-small');
        listen.type = 'button';
        listen.innerHTML = `${ICON_PLAY}<span>Odsłuchaj</span>`;
        listen.addEventListener('click', () => playClip(mine.clip_url!, listen));
        row.append(listen);
      }
      const share = el('button', 'btn primary cmt-small');
      share.type = 'button';
      share.innerHTML = `${ICON_SHARE}<span>Udostępnij ten moment</span>`;
      share.addEventListener('click', async () => {
        const msg = await shareComment(mine);
        share.querySelector('span')!.textContent = msg;
      });
      row.append(share);
      box.append(row);
    } else {
      box.append(el('p', 'cmt-mine-hint', 'Prowadzący wybiera najciekawsze komentarze i odpowiada w najbliższym wejściu.'));
    }
    feed.prepend(box);
  };

  const renderFeed = (all: ListenerComment[]) => {
    const mineId = loadMine()?.id;
    const items = all.filter((c) => c.id !== mineId);
    feed.querySelector('.cmt-list')?.remove();
    if (!items.length) return;
    const list = el('ul', 'cmt-list');
    list.setAttribute('aria-label', 'Ostatnie komentarze słuchaczy');
    for (const c of items.slice(0, 3)) {
      const li = el('li', `cmt-item${c.on_air ? ' aired' : ''}`);
      if (c.on_air) li.append(el('span', 'cmt-badge', 'na antenie'));
      li.append(el('b', 'cmt-nick', c.nick), el('span', 'cmt-text', c.text));
      list.append(li);
    }
    feed.append(list);
  };

  const refreshFeed = async () => {
    const station = hostStationId(engine.currentStation);
    try {
      const body = await fetchJson<{ comments: ListenerComment[] }>(`/radio-api/comments?station_id=${encodeURIComponent(station)}&limit=3`);
      feedStation = station;
      renderFeed(body.comments || []);
    } catch {
      renderFeed([]);
    }
  };

  let lastMineOnAir = false;
  const refreshMine = async () => {
    const ref = loadMine();
    if (!ref) return renderMine(null);
    try {
      const mine = await fetchJson<ListenerComment>(`/radio-api/comments/${encodeURIComponent(ref.id)}`);
      renderMine(mine);
      if (mine.on_air && !lastMineOnAir) setStatus(`Twój komentarz poszedł na antenę AmbiRadio. Odpowiada: ${mine.host_name}.`);
      lastMineOnAir = mine.on_air;
    } catch {
      saveMine(null);
      renderMine(null);
    }
  };

  btn.addEventListener('click', () => openCommentModal(engine, async (created) => {
    saveMine({ id: created.id, at: Date.now() });
    lastMineOnAir = false;
    renderMine(created);
    setStatus(created.message || 'Dzięki! Prowadzący przeczyta najciekawsze komentarze w najbliższym wejściu.');
    engine.requestHostBreakSoon();
    await refreshFeed();
  }));

  void refreshFeed();
  void refreshMine();
  void checkIncomingComment(feed, setStatus, playClip);
  setInterval(() => void refreshFeed(), FEED_POLL_MS);
  setInterval(() => void refreshMine(), MINE_POLL_MS);
  setInterval(() => {
    if (hostStationId(engine.currentStation) !== feedStation) void refreshFeed();
  }, 3_000);
}

async function checkIncomingComment(
  feed: HTMLElement,
  setStatus: (msg: string) => void,
  playClip: (url: string, button: HTMLButtonElement) => void,
): Promise<void> {
  const id = new URLSearchParams(window.location.search).get('k');
  if (!id || !/^k[a-z0-9]{4,23}$/i.test(id)) return;
  try {
    const c = await fetchJson<ListenerComment>(`/radio-api/comments/${encodeURIComponent(id)}`);
    const card = el('div', 'cmt-mine aired cmt-shared');
    const head = el('div', 'cmt-mine-head');
    head.innerHTML = ICON_MIC;
    head.append(el('span', '', c.on_air ? `${c.nick} na antenie AmbiRadio · odpowiada ${c.host_name}` : `Komentarz od: ${c.nick}`));
    card.append(head, el('p', 'cmt-mine-text', c.text));
    if (c.clip_url) {
      const listen = el('button', 'btn primary cmt-small');
      listen.type = 'button';
      listen.innerHTML = `${ICON_PLAY}<span>Posłuchaj odpowiedzi</span>`;
      listen.addEventListener('click', () => playClip(c.clip_url!, listen));
      card.append(listen);
    }
    feed.prepend(card);
    setStatus(`Komentarz od: ${c.nick}. Napisz swój, a może też trafi na antenę AmbiRadio.`);
  } catch {
    /* expired or invalid link */
  }
}

function openCommentModal(engine: PublicRadioEngine, onCreated: (c: ListenerComment) => Promise<void>): void {
  document.getElementById('ambi-comment-overlay')?.remove();
  const station = engine.currentStation;
  const overlay = el('div', 'cmt-overlay');
  overlay.id = 'ambi-comment-overlay';
  const card = el('form', 'cmt-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'cmtTitle');

  const eyebrow = el('div', 'cmt-eyebrow', `AmbiRadio · ${station.name} · prowadzi ${station.host}`);
  const title = el('h2', '', 'Napisz na antenę');
  title.id = 'cmtTitle';
  const sub = el('p', 'cmt-sub', 'Najciekawsze komentarze prowadzący czyta na antenie i odpowiada na nie po swojemu. Bez linków i numerów telefonu.');

  const textLbl = el('label', 'cmt-field');
  const textHead = el('span', 'cmt-field-head');
  const counter = el('span', 'cmt-count', `0 / ${MAX_TEXT}`);
  textHead.append(el('span', '', 'Twój komentarz'), counter);
  const text = el('textarea');
  text.rows = 3;
  text.maxLength = MAX_TEXT;
  text.required = true;
  text.placeholder = 'Co słychać u Ciebie? O co chcesz zapytać prowadzącego?';
  text.addEventListener('input', () => {
    counter.textContent = `${text.value.length} / ${MAX_TEXT}`;
  });
  textLbl.append(textHead, text);

  const nickLbl = el('label', 'cmt-field');
  nickLbl.append(el('span', 'cmt-field-head', 'Podpis (opcjonalnie)'));
  const nick = el('input');
  nick.maxLength = 32;
  nick.placeholder = 'np. Ania z Krakowa';
  nick.value = localStorage.getItem(NICK_KEY) || '';
  nickLbl.append(nick);

  const err = el('div', 'cmt-error');
  err.setAttribute('role', 'alert');
  const foot = el('div', 'cmt-foot');
  const cancel = el('button', 'btn ghost', 'Zamknij');
  cancel.type = 'button';
  const send = el('button', 'btn primary', 'Wyślij do prowadzącego');
  send.type = 'submit';
  foot.append(cancel, send);

  card.append(eyebrow, title, sub, textLbl, nickLbl, err, foot);
  overlay.append(card);
  document.body.append(overlay);
  text.focus();

  const close = () => overlay.remove();
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
  });

  card.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    send.disabled = true;
    send.textContent = 'Wysyłam...';
    try {
      const nickValue = nick.value.trim();
      try {
        localStorage.setItem(NICK_KEY, nickValue);
      } catch {
        /* private mode */
      }
      const created = await fetchJson<ListenerComment>('/radio-api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station_id: hostStationId(station), text: text.value.trim(), nick: nickValue }),
      });
      close();
      await onCreated(created);
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : 'Nie udało się wysłać komentarza.';
    } finally {
      send.disabled = false;
      send.textContent = 'Wyślij do prowadzącego';
    }
  });
}
