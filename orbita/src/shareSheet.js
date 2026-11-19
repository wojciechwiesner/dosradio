/* Reusable "Udostępnij przez..." App-Badge Sheet + PWA Install Helper (ZERO EMOJI — pure vector SVG) */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const APP_ICONS = {
  native: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5A8.5 8.5 0 0 1 7.4 19L4 20l1.1-3.3A8.5 8.5 0 1 1 20 11.5z"/><path d="M9.2 8.8c.2-.4.5-.4.8-.4h.5c.2 0 .4.1.5.4l.6 1.4c.1.2 0 .5-.1.7l-.5.6c.5.9 1.3 1.7 2.2 2.2l.6-.5c.2-.1.5-.2.7-.1l1.4.6c.3.1.4.3.4.5v.5c0 .3 0 .6-.4.8-.5.3-1.4.4-2.5 0-2-.7-4-2.7-4.7-4.7-.4-1.1-.3-2 0-2.5z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m21 4-3.2 15.2c-.2 1-.9 1.2-1.7.7l-4.6-3.4-2.2 2.1c-.3.3-.5.4-.9.4l.3-4.7 8.5-7.7c.4-.3-.1-.5-.6-.2L6.1 13 1.6 11.6c-1-.3-1-1 .2-1.5L19.6 3c.8-.3 1.6.2 1.4 1z"/></svg>',
  sms: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h8M8 13h5"/></svg>',
  email: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l2.8-2.8a5 5 0 0 0-7.1-7.1L11.7 5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2.8 2.8a5 5 0 0 0 7.1 7.1L12.3 19"/></svg>',
  install: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M12 7v7"/><path d="m9 11 3 3 3-3"/><path d="M10 18h4"/></svg>',
};

function ensureShareStyles() {
  if (document.getElementById('dosQuickShareCss')) return;
  const st = document.createElement('style');
  st.id = 'dosQuickShareCss';
  st.textContent = `
    #quickShareOverlay{position:fixed;inset:0;z-index:120;background:rgba(5,5,10,.78);backdrop-filter:blur(14px);display:none;align-items:flex-end;justify-content:center;padding:12px;padding-bottom:max(14px,env(safe-area-inset-bottom,0px))}
    @media(min-width:761px){#quickShareOverlay{align-items:center}}
    #quickShareOverlay.open{display:flex}
    .qs-sheet{width:min(440px,100%);background:#101119;border:1px solid rgba(255,255,255,.15);border-radius:22px;padding:18px;color:#f3f4f6;box-shadow:0 24px 64px rgba(0,0,0,.65);font-family:system-ui,-apple-system,sans-serif}
    .qs-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .qs-title{font-family:'Unbounded',system-ui,sans-serif;font-size:14px;font-weight:700;letter-spacing:.01em}
    .qs-close{min-width:44px;min-height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#e2e8f0;font-size:12px;cursor:pointer;padding:0 12px}
    .qs-preview{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:10px 12px;margin-bottom:12px}
    .qs-pv-name{font-weight:700;font-size:13.5px;color:#fff}
    .qs-pv-sub{font-size:11.5px;color:#94a3b8;margin-top:2px;word-break:break-all}
    .qs-greet{display:grid;gap:7px;margin-bottom:14px}
    .qs-in{width:100%;box-sizing:border-box;background:#171925;border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:11px;padding:10px 12px;font-size:13px}
    .qs-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
    .qs-app{appearance:none;border:1px solid rgba(255,255,255,.1);background:#161824;color:#f1f5f9;border-radius:14px;padding:11px 6px;min-height:74px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;cursor:pointer;text-decoration:none;font-size:11.5px;font-weight:600;transition:transform .12s,border-color .15s,background .15s}
    .qs-app:active{transform:scale(.96)}
    .qs-app:hover{border-color:rgba(255,255,255,.28);background:#1c1f2e}
    .qs-ico{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff}
    .qs-ico.native{background:linear-gradient(135deg,#6366f1,#8b5cf6)}
    .qs-ico.wa{background:#25D366;color:#062814}
    .qs-ico.tg{background:#2AABEE;color:#041f2e}
    .qs-ico.sms{background:#34C759;color:#05290f}
    .qs-ico.mail{background:#3B82F6;color:#fff}
    .qs-ico.copy{background:#F59E0B;color:#241400}
    .qs-steps{display:grid;gap:10px;margin:12px 0;font-size:13px;line-height:1.45;color:#cbd5e1}
    .qs-step{display:flex;align-items:center;gap:10px;background:#171925;border:1px solid rgba(255,255,255,.1);padding:10px 12px;border-radius:12px}
    .qs-num{width:24px;height:24px;border-radius:50%;background:#ff6b3d;color:#09090d;font-weight:700;font-size:12px;display:inline-flex;align-items:center;justify-content:center;flex:none}
  `;
  document.head.appendChild(st);
}

function getOverlay() {
  ensureShareStyles();
  let ov = document.getElementById('quickShareOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'quickShareOverlay';
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); });
    document.body.appendChild(ov);
  }
  return ov;
}

export function buildAppBadgesHtml({ url, text, title = 'DOS Radio' }) {
  const full = `${text ? text.trim() + ' ' : ''}${url}`.trim();
  const wa = `https://wa.me/?text=${encodeURIComponent(full)}`;
  const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || title)}`;
  const sms = `sms:?body=${encodeURIComponent(full)}`;
  const mail = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent((text ? text + '\n\n' : '') + url)}`;
  return `
    <div class="qs-grid">
      <button type="button" class="qs-app" data-qs-native="1" data-url="${esc(url)}" data-text="${esc(text)}" data-title="${esc(title)}">
        <span class="qs-ico native" aria-hidden="true">${APP_ICONS.native}</span><span>Więcej apek</span>
      </button>
      <a class="qs-app" href="${esc(wa)}" target="_blank" rel="noopener" data-qs-ext="wa">
        <span class="qs-ico wa" aria-hidden="true">${APP_ICONS.whatsapp}</span><span>WhatsApp</span>
      </a>
      <a class="qs-app" href="${esc(tg)}" target="_blank" rel="noopener" data-qs-ext="tg">
        <span class="qs-ico tg" aria-hidden="true">${APP_ICONS.telegram}</span><span>Telegram</span>
      </a>
      <a class="qs-app" href="${esc(sms)}" data-qs-ext="sms">
        <span class="qs-ico sms" aria-hidden="true">${APP_ICONS.sms}</span><span>SMS</span>
      </a>
      <a class="qs-app" href="${esc(mail)}" data-qs-ext="mail">
        <span class="qs-ico mail" aria-hidden="true">${APP_ICONS.email}</span><span>E-mail</span>
      </a>
      <button type="button" class="qs-app" data-qs-copy="${esc(url)}">
        <span class="qs-ico copy" aria-hidden="true">${APP_ICONS.copy}</span><span data-copy-lbl>Kopiuj link</span>
      </button>
    </div>`;
}

export function bindAppBadges(container, onToast) {
  container.querySelectorAll('[data-qs-native]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nav = (window.top && window.top.location?.origin === location.origin ? window.top.navigator : null) || navigator;
      const shareData = { title: btn.dataset.title || 'DOS Radio', text: btn.dataset.text || '', url: btn.dataset.url || location.href };
      if (nav.share) {
        try { await nav.share(shareData); return; } catch {}
      }
      await navigator.clipboard?.writeText(shareData.url);
      onToast?.('Skopiowano link do udostępnienia');
    });
  });
  container.querySelectorAll('[data-qs-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(btn.dataset.qsCopy || '');
      const lbl = btn.querySelector('[data-copy-lbl]');
      if (lbl) { lbl.textContent = 'Skopiowano!'; setTimeout(() => { lbl.textContent = 'Kopiuj link'; }, 2000); }
      onToast?.('Skopiowano link do schowka');
    });
  });
}

export function openQuickShareSheet({ title, subtitle, url, text, onCreateGreetingUrl, onToast }) {
  const ov = getOverlay();
  let currentUrl = url;
  let currentText = text;

  const render = () => {
    ov.innerHTML = `
      <div class="qs-sheet" role="dialog" aria-modal="true" aria-label="Udostępnij przez">
        <div class="qs-head">
          <span class="qs-title">Udostępnij przez...</span>
          <button type="button" class="qs-close" data-qs-close>Zamknij</button>
        </div>
        <div class="qs-preview">
          <div class="qs-pv-name">${esc(title)}</div>
          <div class="qs-pv-sub">${esc(subtitle || currentUrl)}</div>
        </div>
        ${onCreateGreetingUrl ? `
        <form class="qs-greet" id="qsGreetForm">
          <input class="qs-in" name="to_name" placeholder="Dla kogo? (opcjonalnie, np. Klaudia)">
          <div style="display:flex;gap:6px">
            <input class="qs-in" name="msg" placeholder="Dopisz pozdrowienie głosowe na start...">
            <button type="submit" class="qs-close" style="background:#ff6b3d;color:#09090d;border-color:#ff6b3d;font-weight:700;white-space:nowrap">Dodaj głos</button>
          </div>
        </form>` : ''}
        <div id="qsBadgesMount">${buildAppBadgesHtml({ url: currentUrl, text: currentText, title })}</div>
      </div>`;
    ov.querySelector('[data-qs-close]')?.addEventListener('click', () => ov.classList.remove('open'));
    bindAppBadges(ov, onToast);
    const gf = ov.querySelector('#qsGreetForm');
    if (gf && onCreateGreetingUrl) {
      gf.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(gf);
        const msg = String(fd.get('msg') || '').trim();
        const toName = String(fd.get('to_name') || '').trim();
        if (!msg && !toName) return;
        const btn = gf.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Nagrywam...'; }
        try {
          const res = await onCreateGreetingUrl({ toName: toName || 'Ciebie', message: msg || 'Wskakuj na wspólny odsłuch!' });
          if (res?.url) {
            currentUrl = res.url;
            currentText = res.text || currentText;
            subtitle = `Z głosowym pozdrowieniem od prowadzącego · ${currentUrl}`;
            onToast?.('Dodano głosowe pozdrowienie do linku!');
            render();
          }
        } catch (err) {
          onToast?.(err.message || 'Nie udało się dodać pozdrowienia');
          if (btn) { btn.disabled = false; btn.textContent = 'Dodaj głos'; }
        }
      });
    }
  };
  render();
  ov.classList.add('open');
}

export function isRunningStandalonePwa() {
  const hostWin = (window.top && window.top.location?.origin === location.origin) ? window.top : window;
  return !!(hostWin.matchMedia?.('(display-mode: standalone)').matches || hostWin.navigator?.standalone);
}

export async function triggerPwaInstall(onToast) {
  const hostWin = (window.top && window.top.location?.origin === location.origin) ? window.top : window;
  const deferred = hostWin.__pwaPrompt || window.__pwaPrompt;
  if (deferred) {
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') {
      hostWin.__pwaPrompt = null;
      window.__pwaPrompt = null;
      onToast?.('Instalowanie aplikacji DOS Radio...');
    }
    return;
  }
  const ov = getOverlay();
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  ov.innerHTML = `
    <div class="qs-sheet" role="dialog" aria-modal="true" aria-label="Zainstaluj aplikację DOS Radio">
      <div class="qs-head">
        <span class="qs-title">Zainstaluj DOS Radio</span>
        <button type="button" class="qs-close" data-qs-close>Zamknij</button>
      </div>
      <div class="qs-preview">
        <div class="qs-pv-name">Aplikacja PWA na pełnym ekranie</div>
        <div class="qs-pv-sub">Szybki start z ikony na ekranie głównym i ciągłe granie w tle.</div>
      </div>
      <div class="qs-steps">
        ${isIOS ? `
          <div class="qs-step"><span class="qs-num">1</span><span>Stuknij ikonę <strong>Udostępnij</strong> na dolnym lub górnym pasku przeglądarki Safari.</span></div>
          <div class="qs-step"><span class="qs-num">2</span><span>Wybierz z listy <strong>Dodaj do ekranu początkowego</strong> i potwierdź przyciskiem <strong>Dodaj</strong>.</span></div>
        ` : `
          <div class="qs-step"><span class="qs-num">1</span><span>Kliknij ikonę <strong>Zainstaluj DOS Radio</strong> w pasku adresu (lub otwórz menu przeglądarki).</span></div>
          <div class="qs-step"><span class="qs-num">2</span><span>Wybierz <strong>Zainstaluj aplikację</strong> / <strong>Dodaj do ekranu głównego</strong>.</span></div>
        `}
      </div>
    </div>`;
  ov.querySelector('[data-qs-close]')?.addEventListener('click', () => ov.classList.remove('open'));
  ov.classList.add('open');
}
