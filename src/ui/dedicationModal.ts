import type { PublicRadioEngine } from '../radio/publicRadioEngine';
import { STATIONS } from '../radio/stations';

interface DedicationPayload {
  id: string;
  station_id: string;
  station_name: string;
  to_name: string;
  from_name: string;
  message: string;
  host_name: string;
  script: string;
  audio_url: string;
  share_url: string;
  classic_share_url?: string;
  classic_url?: string;
}

function mk<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (style) el.style.cssText = style;
  if (text) el.textContent = text;
  return el;
}

export function wireClassicDedications(
  engine: PublicRadioEngine,
  selectStationById: (id: string) => void,
  setStatus: (msg: string) => void,
): void {
  const btn = document.getElementById('dedicateBtn');
  if (btn) {
    btn.addEventListener('click', () => openClassicDedicationModal(engine.currentStation.id));
  }
  void checkIncomingClassicDedication(engine, selectStationById, setStatus);
}

async function checkIncomingClassicDedication(
  engine: PublicRadioEngine,
  selectStationById: (id: string) => void,
  setStatus: (msg: string) => void,
): Promise<void> {
  const token = new URLSearchParams(window.location.search).get('d');
  if (!token) return;
  try {
    const res = await fetch(`/radio-api/dedications/${encodeURIComponent(token)}`);
    if (!res.ok) return;
    const ded = (await res.json()) as DedicationPayload;
    selectStationById(ded.station_id);
    engine.setPendingDedication(ded);
    if (ded.audio_url) {
      fetch(ded.audio_url, { credentials: 'same-origin' }).catch(() => {});
    }
    setStatus(
      `Dedykowana stacja dla ${ded.to_name} od ${ded.from_name}${ded.message ? ` — „${ded.message}”` : ''}. Kliknij Graj, aby odsłuchać powitanie!`,
    );
  } catch {
    // Ignore invalid or offline dedication token
  }
}

function openClassicDedicationModal(currentStationId: string): void {
  const existing = document.getElementById('dos-dedicate-overlay');
  if (existing) existing.remove();

  const overlay = mk(
    'div',
    'position:fixed;inset:0;z-index:9999;background:rgba(5,5,6,.82);display:flex;align-items:center;justify-content:center;padding:16px',
  );
  overlay.id = 'dos-dedicate-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Udostępnij stację z dedykacją');

  const card = mk(
    'div',
    'width:100%;max-width:480px;max-height:calc(100vh - 32px);overflow-y:auto;background:var(--bg-2);color:var(--text);border:1px solid var(--line-strong);border-top:4px solid var(--accent);padding:32px 24px 24px',
  );

  const eyebrow = mk('div', 'font:500 12px/1.4 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:8px', 'AmbiRadio · Dedykacja');
  const h2 = mk('h2', 'margin:0 0 8px;font-size:32px;line-height:1.1;letter-spacing:-.03em', 'Udostępnij stację z dedykacją');
  const sub = mk(
    'p',
    'margin:0 0 24px;font-size:14px;color:var(--dim);line-height:1.5',
    'Prowadzący przywita odbiorcę po imieniu, przeczyta Twoje pozdrowienia na starcie i zaprosi do wspólnego słuchania.',
  );

  const inCss = 'width:100%;min-height:44px;padding:10px 12px;border-radius:0;border:1px solid var(--line-strong);background:var(--bg);color:var(--text);font:16px var(--font-sans);box-sizing:border-box';
  const form = mk('form', 'display:flex;flex-direction:column;gap:16px');

  const stLbl = mk('label', 'display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--dim)', 'Stacja muzyczna');
  const sel = mk('select', inCss);
  for (const s of STATIONS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.bpm} BPM · ${s.host})`;
    if (s.id === currentStationId) opt.selected = true;
    sel.appendChild(opt);
  }
  stLbl.appendChild(sel);

  const grid = mk('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px');
  const toLbl = mk('label', 'display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--dim)', 'Dla kogo (imię)');
  const toIn = mk('input', inCss);
  toIn.required = true;
  toIn.maxLength = 40;
  toIn.placeholder = 'np. Klaudia';
  toLbl.appendChild(toIn);

  const frLbl = mk('label', 'display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--dim)', 'Od kogo (imię)');
  const frIn = mk('input', inCss);
  frIn.required = true;
  frIn.maxLength = 40;
  frIn.placeholder = 'np. Wojtek';
  frLbl.appendChild(frIn);
  grid.append(toLbl, frLbl);

  const msgLbl = mk('label', 'display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--dim)');
  const msgHead = mk('div', 'display:flex;justify-content:space-between');
  const cnt = mk('span', 'color:var(--faint);font-family:var(--font-mono)', '0 / 200');
  msgHead.append(mk('span', '', 'Dedykacja (do 200 znaków)'), cnt);
  const msgIn = mk('textarea', `${inCss};resize:vertical`);
  msgIn.rows = 3;
  msgIn.maxLength = 200;
  msgIn.placeholder = 'Krótkie pozdrowienia czytane przez prowadzącego...';
  msgIn.addEventListener('input', () => {
    cnt.textContent = `${msgIn.value.length} / 200`;
  });
  msgLbl.append(msgHead, msgIn);

  const resBox = mk('div', 'display:none;padding:16px;border:1px solid var(--accent);background:var(--accent-soft)');
  const linkIn = mk('input', `${inCss};font-family:monospace;font-size:12px;margin:6px 0 8px`);
  linkIn.readOnly = true;
  const resRow = mk('div', 'display:flex;gap:8px;flex-wrap:wrap');
  const copyBtn = mk('button', 'min-height:44px;padding:0 16px;border:0;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer', 'Kopiuj link');
  copyBtn.type = 'button';
  const prevBtn = mk('button', 'min-height:44px;padding:0 16px;border:1px solid var(--line-strong);background:transparent;color:var(--text);cursor:pointer', 'Odsłuchaj powitanie');
  prevBtn.type = 'button';
  const audioEl = mk('audio', 'width:100%;margin-top:8px;display:none');
  audioEl.controls = true;
  resRow.append(copyBtn, prevBtn);
  resBox.append(mk('div', 'font:500 12px var(--font-mono);color:var(--text)', 'Link z dedykacją gotowy:'), linkIn, resRow, audioEl);

  const errEl = mk('div', 'display:none;color:var(--danger);font-size:14px');
  const foot = mk('div', 'display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:8px');
  const closeBtn = mk('button', 'min-height:44px;padding:0 16px;border:1px solid var(--line-strong);background:transparent;color:var(--text);cursor:pointer', 'Zamknij');
  closeBtn.type = 'button';
  const subBtn = mk('button', 'min-height:44px;padding:0 16px;border:0;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer', 'Utwórz link z dedykacją');
  subBtn.type = 'submit';
  foot.append(closeBtn, subBtn);

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };
  const close = () => {
    audioEl.pause();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  form.append(stLbl, grid, msgLbl, errEl, resBox, foot);
  card.append(eyebrow, h2, sub, form);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errEl.style.display = 'none';
    subBtn.disabled = true;
    subBtn.textContent = 'Nagrywam zapowiedź...';
    try {
      const resp = await fetch('/radio-api/dedications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          station_id: sel.value,
          to_name: toIn.value.trim(),
          from_name: frIn.value.trim(),
          message: msgIn.value.trim(),
          lang: 'pl',
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as DedicationPayload;
      const shareUrl = `${window.location.origin}${data.classic_share_url || data.classic_url || `/?d=${data.id}`}`;
      linkIn.value = shareUrl;
      resBox.style.display = 'block';
      copyBtn.onclick = async () => {
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
        copyBtn.textContent = 'Skopiowano!';
        setTimeout(() => {
          copyBtn.textContent = 'Kopiuj link';
        }, 1800);
      };
      prevBtn.onclick = () => {
        audioEl.style.display = 'block';
        audioEl.src = data.audio_url;
        void audioEl.play();
      };
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : 'Nie udało się utworzyć dedykacji.';
      errEl.style.display = 'block';
    } finally {
      subBtn.disabled = false;
      subBtn.textContent = 'Utwórz link z dedykacją';
    }
  });
}
