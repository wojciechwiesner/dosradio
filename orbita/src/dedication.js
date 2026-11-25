/* Share a station with a personal host greeting & dedication (up to 200 chars). */
import { STATIONS, byId } from './data.js';
import { getLang, stationName } from './i18n.js';

const COPY = {
  pl: {
    btn: 'Dedykuj',
    title: 'Udostępnij stację z dedykacją',
    sub: 'Prowadzący tej stacji przywita wybraną osobę po imieniu, przekaże pozdrowienia od Ciebie i zaprosi do wspólnego słuchania.',
    station: 'Stacja muzyczna',
    to: 'Dla kogo (imię)',
    toPh: 'np. Klaudia',
    from: 'Od kogo (imię)',
    fromPh: 'np. Wojtek',
    msg: 'Dedykacja (opcjonalnie, do 200 znaków)',
    msgPh: 'Kilka słów od siebie — prowadzący przeczyta je na starcie stacji...',
    submit: 'Utwórz link z dedykacją',
    creating: 'Nagrywam zapowiedź...',
    ready: 'Gotowe! Wyślij link odbiorcy:',
    copy: 'Kopiuj link',
    copied: 'Skopiowano do schowka',
    share: 'Udostępnij',
    preview: 'Odsłuchaj zapowiedź',
    close: 'Zamknij',
    gateBadge: 'Dedykowana stacja dla Ciebie',
    gateSub: (st, to, fr) => `Stacja ${st} dla: ${to} · pozdrowienia od: ${fr}`,
    gateEnter: 'Odbierz pozdrowienia i włącz radio',
  },
  en: {
    btn: 'Dedicate',
    title: 'Share station with a dedication',
    sub: 'The station host will greet your recipient by name, read your dedication on air, and invite them to listen.',
    station: 'Music station',
    to: 'For whom (first name)',
    toPh: 'e.g. Anna',
    from: 'From (first name)',
    fromPh: 'e.g. Alex',
    msg: 'Dedication (optional, up to 200 chars)',
    msgPh: 'A short personal message read by the host at the start...',
    submit: 'Create dedication link',
    creating: 'Recording greeting...',
    ready: 'Ready! Share this link:',
    copy: 'Copy link',
    copied: 'Copied to clipboard',
    share: 'Share',
    preview: 'Preview greeting',
    close: 'Close',
    gateBadge: 'A station dedicated to you',
    gateSub: (st, to, fr) => `Station ${st} for ${to} · from ${fr}`,
    gateEnter: 'Hear greeting & start radio',
  },
  ru: {
    btn: 'Посвятить',
    title: 'Поделиться станцией с приветом',
    sub: 'Ведущий станции поприветствует получателя по имени, зачитает ваше послание и пригласит к прослушиванию.',
    station: 'Музыкальная станция',
    to: 'Для кого (имя)',
    toPh: 'напр. Анна',
    from: 'От кого (имя)',
    fromPh: 'напр. Войтек',
    msg: 'Послание (до 200 символов)',
    msgPh: 'Несколько тёплых слов от себя...',
    submit: 'Создать ссылку с приветом',
    creating: 'Записываем приветствие...',
    ready: 'Готово! Отправьте ссылку:',
    copy: 'Скопировать ссылку',
    copied: 'Скопировано',
    share: 'Поделиться',
    preview: 'Прослушать приветствие',
    close: 'Закрыть',
    gateBadge: 'Станция специально для вас',
    gateSub: (st, to, fr) => `Станция ${st} для: ${to} · от: ${fr}`,
    gateEnter: 'Слушать приветствие и радио',
  },
};

const L = () => COPY[getLang()] || COPY.pl;
const mk = (tag, attrs = {}, text = '') => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  if (text) el.textContent = text;
  return el;
};

export function openDedicationModal(app, currentStationId) {
  const c = L();
  const modal = document.querySelector('#dedModal');
  const box = document.querySelector('#dedModalBox');
  if (!modal || !box) return;
  box.replaceChildren();

  const head = mk('div');
  head.append(
    mk('div', { className: 'eyebrow' }, 'AMBIRADIO · DEDYKACJA'),
    mk('h2', { id: 'dedTitle', style: 'margin:6px 0' }, c.title),
    mk('p', { className: 'hint', style: 'margin:0 0 12px' }, c.sub),
  );

  const form = mk('form', { style: 'display:flex;flex-direction:column;gap:10px' });
  const selLbl = mk('label', { style: 'display:flex;flex-direction:column;gap:4px;font-size:13px' }, c.station);
  const sel = mk('select', { name: 'station_id', style: 'padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.06);color:inherit;border:1px solid rgba(255,255,255,.14)' });
  for (const s of STATIONS) {
    const opt = mk('option', { value: s.id }, `${stationName(s)} (${s.bpm} BPM)`);
    if (s.id === currentStationId) opt.selected = true;
    sel.appendChild(opt);
  }
  selLbl.appendChild(sel);

  const row = mk('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' });
  const inStyle = 'padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.06);color:inherit;border:1px solid rgba(255,255,255,.14);width:100%';
  const toLbl = mk('label', { style: 'display:flex;flex-direction:column;gap:4px;font-size:13px' }, c.to);
  const toIn = mk('input', { name: 'to_name', maxlength: '40', required: 'required', placeholder: c.toPh, style: inStyle });
  toLbl.appendChild(toIn);
  const frLbl = mk('label', { style: 'display:flex;flex-direction:column;gap:4px;font-size:13px' }, c.from);
  const frIn = mk('input', { name: 'from_name', maxlength: '40', required: 'required', placeholder: c.fromPh, style: inStyle });
  frLbl.appendChild(frIn);
  row.append(toLbl, frLbl);

  const msgLbl = mk('label', { style: 'display:flex;flex-direction:column;gap:4px;font-size:13px' });
  const msgTop = mk('span', { style: 'display:flex;justify-content:space-between' });
  const cntEl = mk('small', { style: 'opacity:.7' }, '0 / 200');
  msgTop.append(mk('span', {}, c.msg), cntEl);
  const msgIn = mk('textarea', { name: 'message', rows: '3', maxlength: '200', placeholder: c.msgPh, style: inStyle });
  msgIn.addEventListener('input', () => { cntEl.textContent = `${msgIn.value.length} / 200`; });
  msgLbl.append(msgTop, msgIn);

  const resBox = mk('div', { style: 'padding:12px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(255,255,255,.04);display:none' });
  const linkIn = mk('input', { readonly: 'readonly', style: `${inStyle};margin:6px 0 8px;font-family:monospace;font-size:12px` });
  const resBtns = mk('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
  const copyBtn = mk('button', { type: 'button', className: 'btn primary' }, c.copy);
  const shareBtn = mk('button', { type: 'button', className: 'btn', style: 'display:none' }, c.share);
  const prevBtn = mk('button', { type: 'button', className: 'btn' }, c.preview);
  const audioEl = mk('audio', { controls: 'controls', style: 'width:100%;margin-top:8px;display:none' });
  resBtns.append(copyBtn, shareBtn, prevBtn);
  resBox.append(mk('div', { style: 'font-size:12px;opacity:.8' }, c.ready), linkIn, resBtns, audioEl);

  const foot = mk('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:6px' });
  const closeBtn = mk('button', { type: 'button', className: 'btn' }, c.close);
  const subBtn = mk('button', { type: 'submit', className: 'btn primary' }, c.submit);
  closeBtn.addEventListener('click', () => { modal.hidden = true; audioEl.pause(); });
  modal.onclick = ev => { if (ev.target === modal) { modal.hidden = true; audioEl.pause(); } };
  foot.append(closeBtn, subBtn);

  form.append(selLbl, row, msgLbl, resBox, foot);
  box.append(head, form);
  modal.hidden = false;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    subBtn.disabled = true;
    const prevTxt = subBtn.textContent;
    subBtn.textContent = c.creating;
    try {
      const res = await app.api.createDedication({
        station_id: sel.value,
        to_name: toIn.value.trim(),
        from_name: frIn.value.trim(),
        message: msgIn.value.trim(),
      });
      const fullUrl = `${location.origin}${res.share_url || `/orbita.html?d=${res.id}`}`;
      linkIn.value = fullUrl;
      resBox.style.display = 'block';
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(fullUrl); app.toast(c.copied); }
        catch { linkIn.select(); document.execCommand('copy'); app.toast(c.copied); }
      };
      if (typeof navigator.share === 'function') {
        shareBtn.style.display = '';
        shareBtn.onclick = () => navigator.share({ title: `AmbiRadio dla ${res.to_name}`, text: res.script, url: fullUrl }).catch(() => {});
      }
      if (res.audio_url) {
        prevBtn.style.display = '';
        prevBtn.onclick = () => { audioEl.style.display = 'block'; audioEl.src = res.audio_url; audioEl.play().catch(() => {}); };
      } else prevBtn.style.display = 'none';
    } catch (err) {
      app.toast(err.message || 'Błąd tworzenia dedykacji', { error: true });
    } finally {
      subBtn.disabled = false;
      subBtn.textContent = prevTxt;
    }
  });
}

export async function loadIncomingDedication(app, prefs, dial) {
  // the HUD share button label comes from i18n (`share`); the dedication is offered inside the share sheet
  const token = new URLSearchParams(location.search).get('d');
  if (!token) return null;
  const ded = await app.api.getDedication(token);
  if (!ded) return null;
  const st = byId[ded.station_id];
  if (st) {
    prefs.station = st.id;
    prefs.playGroup = false;
    app.engine.setStation(st);
    dial.goTo(st.idx, true);
  }
  app.pendingDedication = ded;
  if (ded.audio_url && typeof fetch === 'function') {
    fetch(ded.audio_url, { credentials: 'same-origin' }).catch(() => {});
  }
  const modeEl = document.querySelector('#enterMode');
  const leadEl = document.querySelector('#enter [data-i18n="enterLead"]');
  const enterBtn = document.querySelector('#enterSound');
  if (modeEl) modeEl.textContent = c.gateBadge;
  if (leadEl) {
    const stTitle = st ? stationName(st) : ded.station_name;
    leadEl.textContent = c.gateSub(stTitle, ded.to_name, ded.from_name) + (ded.message ? ` — „${ded.message}”` : '');
  }
  if (enterBtn) enterBtn.textContent = c.gateEnter;
  return ded;
}
