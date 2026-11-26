/* Editorial Radio Audition Invitation Screen + Sender Preview + Live Segmented Podcast HUD (ZERO EMOJI) */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureInviteStyles() {
  if (document.getElementById('dosInviteCss')) return;
  const st = document.createElement('style');
  st.id = 'dosInviteCss';
  st.textContent = `
    #auditionInviteOverlay{position:fixed;inset:0;z-index:130;background:radial-gradient(circle at 50% 22%,rgba(255,107,61,.18),rgba(7,6,11,.94) 68%);backdrop-filter:blur(18px);display:none;align-items:center;justify-content:center;padding:16px}
    #auditionInviteOverlay.open{display:flex}
    .ai-card{width:min(480px,100%);background:linear-gradient(165deg,#131420,#0b0c13);border:1px solid rgba(255,107,61,.42);border-radius:24px;padding:22px 20px;color:#f4f4f6;box-shadow:0 28px 80px rgba(0,0,0,.78);font-family:system-ui,-apple-system,sans-serif}
    .ai-badge{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:rgba(255,107,61,.16);border:1px solid rgba(255,107,61,.45);color:#ffb094;font:600 10px/1 'Azeret Mono',monospace;letter-spacing:.08em;text-transform:uppercase}
    .ai-dot{width:7px;height:7px;border-radius:50%;background:#ff6b3d;box-shadow:0 0 8px #ff6b3d}
    .ai-lead{margin:12px 0 6px;font-size:13.5px;font-weight:500;color:#e2e8f0;letter-spacing:.01em}
    .ai-title{margin:0 0 11px;font-family:'Unbounded',system-ui,sans-serif;font-size:clamp(17px,4.4vw,21px);line-height:1.25;color:#fff}
    .ai-story{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:11px 13px;font-size:13px;line-height:1.48;color:#f1f5f9;margin-bottom:10px}
    .ai-story-lbl{color:#94a3b8;font-size:11.5px;display:block;margin-bottom:3px}
    .ai-story-body{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
    .ai-story-note{display:block;margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,.08);color:#fda4af;font-size:12px}
    .ai-music{display:flex;align-items:center;gap:10px;background:rgba(167,139,250,.09);border:1px solid rgba(167,139,250,.28);border-radius:13px;padding:10px 13px;font-size:12.5px;color:#ddd6fe;margin-bottom:14px}
    .ai-status{font:500 11px/1.35 'Azeret Mono',monospace;color:#cbd5e1;margin-bottom:14px;opacity:.88}
    .ai-actions{display:grid;gap:8px}
    .ai-cta{appearance:none;border:0;border-radius:14px;background:linear-gradient(135deg,#ff6b3d,#f97316);color:#09090d;font:800 14px/1 system-ui,sans-serif;padding:15px 18px;min-height:48px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;box-shadow:0 10px 28px rgba(255,107,61,.32)}
    .ai-cta:disabled{opacity:.6;cursor:wait}
    .ai-skip{appearance:none;border:1px solid rgba(255,255,255,.12);background:transparent;color:#94a3b8;border-radius:12px;padding:10px;font-size:12px;cursor:pointer}
    /* Compact sender preview inside Quick Share Sheet */
    .qs-invite-card{background:linear-gradient(160deg,#161726,#10111a);border:1px solid rgba(255,107,61,.38);border-radius:15px;padding:12px 14px;margin-bottom:12px;font-size:12.5px;line-height:1.45;color:#e2e8f0}
    .qs-inv-kicker{font:600 9.5px/1 'Azeret Mono',monospace;color:#ff9b7a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
    .qs-inv-t{font-family:'Unbounded',system-ui,sans-serif;font-size:13.5px;font-weight:700;color:#fff;margin:3px 0 6px}
    .qs-inv-meta{color:#a5b4fc;font-size:11.5px;margin-top:5px}
    /* Floating Segmented Podcast HUD */
    #podShowHud{position:fixed;left:50%;transform:translateX(-50%);top:44px;z-index:55;width:min(460px,calc(100vw - 20px));background:rgba(14,14,22,.94);border:1px solid rgba(255,107,61,.55);border-radius:14px;padding:9px 12px;color:#f8fafc;box-shadow:0 14px 36px rgba(0,0,0,.6);backdrop-filter:blur(14px);display:none;font-family:system-ui,sans-serif}
    #podShowHud.open{display:block}
    .psh-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .psh-phase{font:700 9.5px/1 'Azeret Mono',monospace;color:#ff8a65;text-transform:uppercase;letter-spacing:.07em}
    .psh-title{font-size:12.5px;font-weight:700;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .psh-sub{font-size:11.5px;color:#cbd5e1;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .psh-btns{display:flex;gap:5px;flex:none}
    .psh-btn{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#f1f5f9;border-radius:8px;padding:5px 9px;font:600 10.5px/1 system-ui,sans-serif;cursor:pointer;min-height:28px}
    .psh-btn.cta{background:#ff6b3d;color:#09090d;border-color:#ff6b3d;font-weight:700}
  `;
  document.head.appendChild(st);
}

export function buildInvitePreviewHtml(inv) {
  if (!inv) return '';
  ensureInviteStyles();
  const title = inv.title || 'Audycja specjalna';
  const about = inv.about || 'wyjątkowy temat przygotowany przez prowadzących AmbiRadio';
  const stName = inv.station_name || inv.stationName || 'Ambi Groove';
  const stGenre = inv.station_genre || inv.stationGenre || 'elektronika i klubowy groove';
  return `
    <div class="qs-invite-card">
      <div class="qs-inv-kicker">Podgląd zaproszenia na ekranie odbiorcy${inv.from_name ? ' · Od: ' + esc(inv.from_name) : ''}</div>
      <div>Zapraszamy do wysłuchania audycji w radiu pt.</div>
      <div class="qs-inv-t">„${esc(title)}”</div>
      <div>która opowiada o: <strong>${esc(about)}</strong></div>
      <div class="qs-inv-meta">Przy muzyce: <strong>${esc(stName)}</strong> (${esc(stGenre)})</div>
    </div>`;
}

export function formatInviteShareText(inv) {
  const title = inv?.title || 'Audycja specjalna';
  const about = String(inv?.about || '').trim();
  const stName = inv?.station_name || inv?.stationName || 'AmbiRadio';
  const stGenre = inv?.station_genre || inv?.stationGenre || '';
  return `${title} — audycja w AmbiRadio (ambiradio.com). Zapraszamy do wysłuchania${about ? ` (opowiada o: ${about.slice(0, 110)})` : ''} — przy muzyce ${stName}${stGenre ? ` (${stGenre})` : ''}:`;
}

export function openAuditionInvite({ invite, ready = true, statusText = '', ctaLabel = 'Włącz audycję i muzykę', onStart, onDismiss }) {
  ensureInviteStyles();
  const enterGate = document.getElementById('enter');
  if (enterGate) enterGate.classList.add('gone');

  let ov = document.getElementById('auditionInviteOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'auditionInviteOverlay';
    document.body.appendChild(ov);
  }
  let state = { invite, ready, statusText, ctaLabel };

  const draw = () => {
    const inv = state.invite || {};
    const fromBadge = inv.from_name ? `ZAPROSZENIE OD: ${inv.from_name}` : 'ZAPROSZENIE DO RADIA NA ŻYWO';
    const stName = inv.station_name || 'Ambi Groove';
    const stGenre = inv.station_genre || 'klubowa elektronika i groove';
    ov.innerHTML = `
      <div class="ai-card" role="dialog" aria-modal="true" aria-label="Zaproszenie do odsłuchu audycji">
        <div class="ai-badge"><span class="ai-dot"></span><span>${esc(fromBadge)}</span></div>
        <p class="ai-lead">${inv.to_name ? `Cześć ${esc(inv.to_name)}! ` : ''}Zapraszamy do wysłuchania audycji w radiu:</p>
        <h2 class="ai-title">„${esc(inv.title || 'Audycja specjalna AmbiRadio')}”</h2>
        <div class="ai-story">
          <span class="ai-story-lbl">Audycja opowiada o:</span>
          <span class="ai-story-body">${esc(inv.about || 'wybranym temacie przygotowanym przez prowadzących na żywo')}</span>
          ${inv.comment ? `<span class="ai-story-note">Wiadomość od nadawcy: „${esc(inv.comment)}”</span>` : ''}
        </div>
        <div class="ai-music">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 15V5l8-2v10"/><circle cx="6.5" cy="15" r="2.5"/><circle cx="14.5" cy="13" r="2.5"/></svg>
          <span>Przy muzyce stacji <strong>${esc(stName)}</strong> · ${esc(stGenre)}</span>
        </div>
        ${state.statusText ? `<div class="ai-status">${esc(state.statusText)}</div>` : ''}
        <div class="ai-actions">
          <button type="button" class="ai-cta" id="aiStartBtn"${state.ready === false ? ' disabled' : ''}>
            <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M4 2.5v11l9.5-5.5z"/></svg>
            <span>${esc(state.ready === false ? 'Przygotowujemy audycję...' : state.ctaLabel)}</span>
          </button>
          <button type="button" class="ai-skip" id="aiSkipBtn">Przejdź do samego radia</button>
        </div>
      </div>`;
    ov.querySelector('#aiStartBtn')?.addEventListener('click', () => {
      ov.classList.remove('open');
      onStart?.();
    });
    ov.querySelector('#aiSkipBtn')?.addEventListener('click', () => {
      ov.classList.remove('open');
      onDismiss?.();
    });
  };

  draw();
  ov.classList.add('open');
  return {
    update(patch) { state = { ...state, ...patch }; draw(); },
    close() { ov.classList.remove('open'); },
  };
}

export function createPodcastHud({ onSkipBreak, onStop, onOpenPlus }) {
  ensureInviteStyles();
  let hud = document.getElementById('podShowHud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'podShowHud';
    document.body.appendChild(hud);
  }
  return {
    show({ phase, title, subtitle = '', canSkipBreak = false, ctaLabel = '' }) {
      hud.innerHTML = `
        <div class="psh-top">
          <div style="min-width:0;flex:1">
            <div class="psh-phase">${esc(phase)}</div>
            <div class="psh-title">${esc(title)}</div>
          </div>
          <div class="psh-btns">
            ${ctaLabel ? `<button type="button" class="psh-btn cta" data-psh-cta>${esc(ctaLabel)}</button>` : ''}
            ${canSkipBreak ? `<button type="button" class="psh-btn" data-psh-skip>Dalej</button>` : ''}
            <button type="button" class="psh-btn" data-psh-stop>Stop</button>
          </div>
        </div>
        ${subtitle ? `<div class="psh-sub">${esc(subtitle)}</div>` : ''}`;
      hud.querySelector('[data-psh-skip]')?.addEventListener('click', () => onSkipBreak?.());
      hud.querySelector('[data-psh-stop]')?.addEventListener('click', () => onStop?.());
      hud.querySelector('[data-psh-cta]')?.addEventListener('click', () => onOpenPlus?.());
      hud.classList.add('open');
    },
    hide() {
      hud.classList.remove('open');
    },
  };
}
