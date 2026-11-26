/* Listener comments on air (Orbita HUD): a small form for the host, a live feed of the
   last accepted comments with a "na antenie" badge, and the sender's own state with the
   clip and a share link once the host reads it on air. */
import { getLang } from './i18n.js';

const MAX = 280;
const MINE_KEY = 'dosradio.myComment';
const NICK_KEY = 'dosradio.commentNick';
const MINE_TTL = 50 * 60 * 1000;

const COPY = {
  pl: {
    btn: 'Napisz do prowadzącego',
    title: host => `Napisz na antenę · ${host}`,
    sub: 'Najciekawsze komentarze prowadzący czyta na antenie AmbiRadio i odpowiada po swojemu. Bez linków i numerów telefonu.',
    text: 'Twój komentarz',
    textPh: 'Co słychać u Ciebie? O co chcesz zapytać?',
    nick: 'Podpis (opcjonalnie)',
    nickPh: 'np. Ania z Krakowa',
    send: 'Wyślij do prowadzącego',
    sending: 'Wysyłam...',
    close: 'Zamknij',
    sent: 'Dzięki! Prowadzący przeczyta najciekawsze komentarze w najbliższym wejściu.',
    onAir: 'na antenie',
    mineWait: () => 'Twój komentarz czeka na prowadzącego',
    mineAired: 'Twój komentarz poszedł na antenę',
    listen: 'Odsłuchaj',
    share: 'Udostępnij ten moment',
    shareText: host => `Mój komentarz poszedł na antenę AmbiRadio. Posłuchaj odpowiedzi prowadzącego (${host}):`,
    copied: 'Link skopiowany',
    shared: (nick, host) => `${nick} na antenie AmbiRadio · odpowiada ${host}`,
    error: 'Nie udało się wysłać komentarza.',
  },
  en: {
    btn: 'Write to the host',
    title: host => `Write to ${host}`,
    sub: 'The host reads the most interesting comments on AmbiRadio and answers in their own way. No links or phone numbers.',
    text: 'Your comment',
    textPh: 'What is up? What would you like to ask?',
    nick: 'Signature (optional)',
    nickPh: 'e.g. Anna from Krakow',
    send: 'Send to the host',
    sending: 'Sending...',
    close: 'Close',
    sent: 'Thanks! The host reads the best comments in the next break.',
    onAir: 'on air',
    mineWait: host => `Your comment is waiting for ${host}`,
    mineAired: 'Your comment went on air',
    listen: 'Listen',
    share: 'Share this moment',
    shareText: host => `My comment went on air at AmbiRadio. Hear what ${host} said:`,
    copied: 'Link copied',
    shared: (nick, host) => `${nick} on air at AmbiRadio. ${host} answers.`,
    error: 'Could not send the comment.',
  },
  ru: {
    btn: 'Написать ведущему',
    title: host => `Написать: ${host}`,
    sub: 'Самые интересные комментарии ведущий читает в эфире AmbiRadio и отвечает по-своему. Без ссылок и телефонов.',
    text: 'Твой комментарий',
    textPh: 'Как дела? О чём хочешь спросить?',
    nick: 'Подпись (необязательно)',
    nickPh: 'напр. Аня из Кракова',
    send: 'Отправить ведущему',
    sending: 'Отправляем...',
    close: 'Закрыть',
    sent: 'Спасибо! Ведущий прочитает лучшие комментарии в ближайшем эфире.',
    onAir: 'в эфире',
    mineWait: host => `Твой комментарий ждёт: ${host}`,
    mineAired: 'Твой комментарий прозвучал в эфире',
    listen: 'Слушать',
    share: 'Поделиться моментом',
    shareText: host => `Мой комментарий прозвучал в эфире AmbiRadio. Послушай ответ ведущего ${host}:`,
    copied: 'Ссылка скопирована',
    shared: (nick, host) => `${nick} в эфире AmbiRadio. Отвечает ${host}.`,
    error: 'Не удалось отправить комментарий.',
  },
};
const L = () => COPY[getLang()] || COPY.pl;

const ICON_MIC = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8a2 2 0 0 0-2 2v4.4a2 2 0 0 0 4 0V3.8a2 2 0 0 0-2-2zM12.5 7.2v1a4.5 4.5 0 0 1-9 0v-1M8 12.7v1.8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>';

const mk = (tag, cls = '', text = '') => { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; };
const loadMine = () => { try { const r = JSON.parse(localStorage.getItem(MINE_KEY) || 'null'); return r && Date.now() - r.at < MINE_TTL ? r : null; } catch { return null; } };
const saveMine = r => { try { if (r) localStorage.setItem(MINE_KEY, JSON.stringify(r)); else localStorage.removeItem(MINE_KEY); } catch { /* private mode */ } };

export function initOrbitaComments(app, { stationId, hostName }) {
  const btn = document.querySelector('#commentBtn');
  const feed = document.querySelector('#cmtFeed');
  if (!btn || !feed || !app.api.postComment) return;
  btn.title = L().btn; btn.setAttribute('aria-label', L().btn);
  let feedStation = '', lastAired = false, clip = null;

  const play = (url, b) => {
    if (clip && !clip.paused) { clip.pause(); b.classList.remove('playing'); return; }
    clip = new Audio(url); b.classList.add('playing');
    clip.addEventListener('ended', () => b.classList.remove('playing'));
    clip.play().catch(() => b.classList.remove('playing'));
  };

  const share = async c => {
    const url = `${location.origin}${c.share_url}`;
    const text = L().shareText(c.host_name);
    if (typeof navigator.share === 'function') { try { await navigator.share({ title: 'AmbiRadio — Ambitnie dla Ciebie', text, url }); return; } catch { /* fall back */ } }
    try { await navigator.clipboard.writeText(`${text} ${url}`); } catch { /* no clipboard */ }
    app.toast(L().copied);
  };

  const mineCard = (c, headText) => {
    const box = mk('div', `cmt-mine${c.on_air ? ' aired' : ''}`);
    const head = mk('div', 'cmt-head'); head.innerHTML = ICON_MIC; head.append(mk('span', '', headText));
    box.append(head, mk('p', 'cmt-text', c.text));
    if (c.on_air) {
      const row = mk('div', 'cmt-actions');
      if (c.clip_url) { const l = mk('button', 'btn small'); l.type = 'button'; l.innerHTML = `${ICON_PLAY}<span>${L().listen}</span>`; l.onclick = () => play(c.clip_url, l); row.append(l); }
      if (c.share_url) { const s = mk('button', 'btn small primary', L().share); s.type = 'button'; s.onclick = () => share(c); row.append(s); }
      box.append(row);
    }
    return box;
  };

  const renderMine = c => {
    feed.querySelector('.cmt-mine:not(.cmt-shared)')?.remove();
    if (c) feed.prepend(mineCard(c, c.on_air ? L().mineAired : L().mineWait(c.host_name)));
    feed.hidden = !feed.children.length;
  };

  const renderFeed = all => {
    const mineId = loadMine()?.id;
    const items = all.filter(c => c.id !== mineId);
    feed.querySelector('.cmt-list')?.remove();
    if (items.length) {
      const ul = mk('ul', 'cmt-list');
      for (const c of items.slice(0, 2)) {
        const li = mk('li', c.on_air ? 'aired' : '');
        if (c.on_air) li.append(mk('span', 'cmt-badge', L().onAir));
        li.append(mk('b', '', c.nick), mk('span', 'cmt-line', c.text));
        ul.append(li);
      }
      feed.append(ul);
    }
    feed.hidden = !feed.children.length;
  };

  const refreshFeed = async () => { const sid = stationId(); feedStation = sid; renderFeed(await app.api.comments(sid)); };
  const refreshMine = async () => {
    const ref = loadMine(); if (!ref) return renderMine(null);
    const c = await app.api.comment(ref.id);
    if (!c) { if (!ref.demo) saveMine(null); return; }
    renderMine(c);
    if (c.on_air && !lastAired) app.toast(L().mineAired, { long: true });
    lastAired = c.on_air;
  };

  btn.addEventListener('click', () => openModal(app, stationId(), hostName(), async created => {
    saveMine({ id: created.id, at: Date.now(), demo: !!created.demo }); lastAired = false;
    renderMine(created); app.toast(L().sent, { long: true });
    app.engine?.requestHostBreakSoon?.();
    await refreshFeed();
  }));

  refreshFeed(); refreshMine();
  incoming(app, feed, mineCard);
  setInterval(refreshFeed, 30000);
  setInterval(refreshMine, 20000);
  setInterval(() => { if (stationId() !== feedStation) refreshFeed(); }, 3000);
}

async function incoming(app, feed, mineCard) {
  const id = new URLSearchParams(location.search).get('k');
  if (!id || !/^k[a-z0-9]{4,23}$/i.test(id)) return;
  const c = await app.api.comment(id);
  if (!c) return;
  const card = mineCard(c, L().shared(c.nick, c.host_name));
  card.classList.add('cmt-shared');
  feed.prepend(card); feed.hidden = false;
}

function openModal(app, stationId, hostName, onCreated) {
  const c = L();
  const modal = document.querySelector('#cmtModal');
  const box = document.querySelector('#cmtModalBox');
  if (!modal || !box) return;
  box.replaceChildren();
  const head = mk('div');
  head.append(mk('div', 'eyebrow', 'AmbiRadio'), mk('h2', '', c.title(hostName)), mk('p', 'hint', c.sub));
  head.querySelector('h2').id = 'cmtTitle';
  const form = mk('form', 'cmt-form');
  const tl = mk('label', 'cmt-field'); const top = mk('span', 'cmt-top'); const cnt = mk('small', '', `0 / ${MAX}`);
  top.append(mk('span', '', c.text), cnt);
  const ta = mk('textarea'); ta.rows = 3; ta.maxLength = MAX; ta.required = true; ta.placeholder = c.textPh;
  ta.addEventListener('input', () => { cnt.textContent = `${ta.value.length} / ${MAX}`; });
  tl.append(top, ta);
  const nl = mk('label', 'cmt-field'); nl.append(mk('span', '', c.nick));
  const ni = mk('input'); ni.maxLength = 32; ni.placeholder = c.nickPh; ni.value = localStorage.getItem(NICK_KEY) || '';
  nl.append(ni);
  const err = mk('p', 'cmt-err'); err.setAttribute('role', 'alert');
  const foot = mk('div', 'cmt-foot');
  const close = mk('button', 'btn', c.close); close.type = 'button';
  const send = mk('button', 'btn primary', c.send); send.type = 'submit';
  foot.append(close, send);
  form.append(tl, nl, err, foot);
  box.append(head, form);
  modal.hidden = false; ta.focus();
  const hide = () => { modal.hidden = true; };
  close.onclick = hide;
  modal.onclick = ev => { if (ev.target === modal) hide(); };
  modal.onkeydown = ev => { if (ev.key === 'Escape') hide(); };
  form.addEventListener('submit', async ev => {
    ev.preventDefault(); err.textContent = ''; send.disabled = true; send.textContent = c.sending;
    try {
      const nick = ni.value.trim();
      try { localStorage.setItem(NICK_KEY, nick); } catch { /* private mode */ }
      const created = await app.api.postComment({ station_id: stationId, text: ta.value.trim(), nick });
      hide(); await onCreated(created);
    } catch (e) { err.textContent = e.message || c.error; }
    finally { send.disabled = false; send.textContent = c.send; }
  });
}
