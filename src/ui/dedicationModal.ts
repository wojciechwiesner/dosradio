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
    'position:fixed;inset:0;z-index:9999;background:rgba(8,10,15,.76);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:16px',
  );
  overlay.id = 'dos-dedicate-overlay';

  const card = mk(
    'div',
    'width:100%;max-width:480px;background:#12151e;color:#f3f4f6;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:22px;box-shadow:0 24px 64px rgba(0,0,0,.55)',
  );

  const eyebrow = mk('div', 'font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px', 'AMBIRADIO · DEDYKACJA');
  const h2 = mk('h2', 'margin:0 0 6px;font-size:20px', 'Udostępnij stację z dedykacją');
  const sub = mk(
    'p',
    'margin:0 0 14px;font-size:13px;color:#9ca3af;line-height:1.45',
    'Prowadzący przywita odbiorcę po imieniu, przeczyta Twoje pozdrowienia na starcie i zaprosi do wspólnego słuchania.',
  );

  const inCss = 'width:100%;padding:9px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:#1a1e2b;color:#f9fafb;font-size:14px;box-sizing:border-box';
  const form = mk('form', 'display:flex;flex-direction:column;gap:11px');

  const stLbl = mk('label', 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:#d1d5db', 'Stacja muzyczna');
  const sel = mk('select', inCss);
  for (const s of STATIONS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.bpm} BPM · ${s.host})`;
    if (s.id === currentStationId) opt.selected = true;
    sel.appendChild(opt);
  }
  stLbl.appendChild(sel);

  const grid = mk('div', 'display:grid;grid-template-columns:1fr 1fr;gap:10px');
  const toLbl = mk('label', 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:#d1d5db', 'Dla kogo (imię)');
  const toIn = mk('input', inCss);
  toIn.required = true;
  toIn.maxLength = 40;
  toIn.placeholder = 'np. Klaudia';
  toLbl.appendChild(toIn);

  const frLbl = mk('label', 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:#d1d5db', 'Od kogo (imię)');
  const frIn = mk('input', inCss);
  frIn.required = true;
  frIn.maxLength = 40;
  frIn.placeholder = 'np. Wojtek';
  frLbl.appendChild(frIn);
  grid.append(toLbl, frLbl);

  const msgLbl = mk('label', 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:#d1d5db');
  const msgHead = mk('div', 'display:flex;justify-content:space-between');
  const cnt = mk('span', 'color:#9ca3af', '0 / 200');
  msgHead.append(mk('span', '', 'Dedykacja (do 200 znaków)'), cnt);
  const msgIn = mk('textarea', `${inCss};resize:vertical`);
  msgIn.rows = 3;
  msgIn.maxLength = 200;
  msgIn.placeholder = 'Krótkie pozdrowienia czytane przez prowadzącego...';
  msgIn.addEventListener('input', () => {
    cnt.textContent = `${msgIn.value.length} / 200`;
  });
  msgLbl.append(msgHead, msgIn);

  const resBox = mk('div', 'display:none;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.04)');
  const linkIn = mk('input', `${inCss};font-family:monospace;font-size:12px;margin:6px 0 8px`);
  linkIn.readOnly = true;
  const resRow = mk('div', 'display:flex;gap:8px;flex-wrap:wrap');
  const copyBtn = mk('button', 'padding:8px 14px;border-radius:8px;border:0;background:#f59e0b;color:#111827;font-weight:600;cursor:pointer', 'Kopiuj link');
  copyBtn.type = 'button';
  const prevBtn = mk('button', 'padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#f3f4f6;cursor:pointer', 'Odsłuchaj powitanie');
  prevBtn.type = 'button';
  const audioEl = mk('audio', 'width:100%;margin-top:8px;display:none');
  audioEl.controls = true;
  resRow.append(copyBtn, prevBtn);
  resBox.append(mk('div', 'font-size:12px;color:#9ca3af', 'Link z dedykacją gotowy:'), linkIn, resRow, audioEl);

  const errEl = mk('div', 'display:none;color:#f87171;font-size:12px');
  const foot = mk('div', 'display:flex;justify-content:flex-end;gap:8px;margin-top:4px');
  const closeBtn = mk('button', 'padding:9px 14px;border-radius:9px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#e5e7eb;cursor:pointer', 'Zamknij');
  closeBtn.type = 'button';
  const subBtn = mk('button', 'padding:9px 16px;border-radius:9px;border:0;background:#f59e0b;color:#111827;font-weight:600;cursor:pointer', 'Utwórz link z dedykacją');
  subBtn.type = 'submit';
  foot.append(closeBtn, subBtn);

  const close = () => {
    audioEl.pause();
    overlay.remove();
  };
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
