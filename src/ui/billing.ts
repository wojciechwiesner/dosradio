/**
 * AmbiRadio Plus billing UI: floating "Plus" badge opens a minimal plan modal,
 * plan choice goes through POST /radio-api/billing/checkout and redirects to Stripe.
 * Self-contained by design (own styles, own fetches) — owned by the billing worker.
 * Prices are USD; yearly prices are display-only.
 */

import { PLAN_PRICES, formatUsd, yearlyLabel, type PlanPrice } from './pricing';

interface PlanInfo { id: string; name: string; amount_cents?: number; yearly_cents?: number; currency?: string; interval: string }
interface BillingStatus {
  registered: boolean;
  plus: boolean;
  email: string | null;
  checkout_available: boolean;
  plans: PlanInfo[];
  plan?: string;
  plus_until?: number | null;
}

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const PLUS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>';
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12 5 5 9-10"/></svg>';

const PLAN_FEATURES: Record<string, string[]> = {
  plus: [
    'Podcasty w duecie generowane przez AI',
    'Własne tematy i źródła wiadomości',
    'Wszystkie stacje bez limitu czasu',
    'Wsparcie rozwoju stacji',
  ],
  plus_ai: [
    'Wszystko, co w AmbiRadio Plus',
    'Wyższe limity generowania AI',
    'Priorytetowa kolejka podcastów',
    'Najnowsze funkcje jako pierwsza wersja',
  ],
};

const STYLE = `
.drplus-badge{position:fixed;right:16px;bottom:16px;z-index:60;display:inline-flex;align-items:center;gap:8px;
  min-height:44px;padding:0 16px 0 12px;border:1px solid var(--accent);border-radius:0;cursor:pointer;
  background:var(--bg);color:var(--accent);font:700 14px/1 var(--font-sans,system-ui,sans-serif);
  transition:background 0.12s,color 0.12s}
.drplus-badge.inline{position:static;z-index:auto}
.drplus-badge:hover{background:var(--accent);color:var(--on-accent)}
.drplus-badge.active{background:var(--accent);color:var(--on-accent)}
.drplus-badge svg{width:16px;height:16px}
.drplus-overlay{position:fixed;inset:0;z-index:960;display:grid;place-items:center;padding:16px;background:rgba(5,5,6,0.82)}
.drplus-dialog{width:min(600px,100%);max-height:calc(100vh - 32px);overflow-y:auto;background:var(--bg-2);
  border:1px solid var(--line-strong);border-top:4px solid var(--accent);padding:32px;animation:drplus-in 0.16s ease-out}
@keyframes drplus-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.drplus-dialog{animation:none}}
.drplus-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:8px}
.drplus-head h2{margin:0;font-size:32px;letter-spacing:-0.03em;line-height:1.1}
.drplus-close{background:none;border:1px solid transparent;color:var(--dim);cursor:pointer;width:44px;height:44px;display:grid;place-items:center;flex:none}
.drplus-close:hover{color:var(--text);border-color:var(--line-strong)}
.drplus-close svg{width:18px;height:18px;display:block}
.drplus-status{margin:0 0 24px;color:var(--dim);font-size:14px;min-height:1.5em}
.drplus-status .ok,.drplus-status .warn{color:var(--accent)}
.drplus-cards{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line)}
@media(max-width:540px){.drplus-cards{grid-template-columns:1fr}.drplus-dialog{padding:24px}}
.drplus-card{padding:24px;background:var(--bg-2);display:flex;flex-direction:column;gap:16px;text-align:left}
.drplus-card b{font-size:20px;letter-spacing:-0.02em}
.drplus-price{font:700 32px/1 var(--font-mono,monospace);letter-spacing:-0.04em}
.drplus-price small{font-size:14px;color:var(--dim);font-weight:400;letter-spacing:0}
.drplus-year{margin-top:-8px;font:12px/1.5 var(--font-mono,monospace);color:var(--dim)}
.drplus-card ul{margin:0;padding:0;list-style:none;display:grid;gap:8px;flex:1}
.drplus-card li{display:flex;gap:8px;align-items:flex-start;color:var(--dim);font-size:14px}
.drplus-card li svg{width:14px;height:14px;color:var(--accent);margin-top:4px;flex:none}
.drplus-buy{min-height:44px;padding:0 16px;border:1px solid var(--accent);border-radius:0;
  background:var(--accent);color:var(--on-accent);font:700 14px var(--font-sans,sans-serif);cursor:pointer}
.drplus-buy:hover{background:var(--text);border-color:var(--text)}
.drplus-buy[disabled]{opacity:0.4;cursor:default}
.drplus-note{margin:0 0 16px;font-size:14px;color:var(--dim)}
.drplus-error{margin:16px 0 0;color:var(--danger,#ff8a7a);font-size:14px;min-height:1.5em}
.drplus-foot{margin:16px 0 0;font:12px/1.5 var(--font-mono,monospace);color:var(--faint)}
`;

let overlay: HTMLElement | null = null;
let redirectNote = '';

function ensureStyles(): void {
  if (document.getElementById('drplus-style')) return;
  const style = document.createElement('style');
  style.id = 'drplus-style';
  style.textContent = STYLE;
  document.head.append(style);
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const response = await fetch(url, { credentials: 'same-origin', ...init });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* non-JSON body */ }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

const loadStatus = async (): Promise<BillingStatus | null> => {
  const { ok, body } = await fetchJson('/radio-api/billing/status');
  return ok ? (body as BillingStatus) : null;
};

function checkoutError(status: number, detail: string | null): string {
  if (status === 401) return 'Zaloguj się, żeby wykupić Plus.';
  if (status === 503) return 'Płatności są w tej chwili niedostępne.';
  return detail || 'Nie udało się otworzyć płatności. Spróbuj ponownie.';
}

async function choosePlan(planId: string, button: HTMLButtonElement, errorLine: HTMLElement): Promise<void> {
  button.disabled = true;
  button.textContent = 'Otwieram płatności...';
  const { ok, status, body } = await fetchJson('/radio-api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan: planId }),
  });
  if (ok && body && typeof (body as { url?: unknown }).url === 'string') {
    location.href = (body as { url: string }).url;
    return;
  }
  const detail = body && typeof (body as { detail?: unknown }).detail === 'string'
    ? (body as { detail: string }).detail : null;
  errorLine.textContent = checkoutError(status, detail);
  button.disabled = false;
  button.textContent = buyLabel(planId);
}

function statusLine(status: BillingStatus | null): string {
  if (!status) return 'Nie udało się pobrać statusu. Odśwież stronę i spróbuj ponownie.';
  if (!status.checkout_available) return '<span class="warn">Płatności są w tej chwili wyłączone — wróć wkrótce.</span>';
  if (status.plus) {
    const until = status.plus_until
      ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(status.plus_until * 1000))
      : null;
    return `<span class="ok">Plus aktywny${until ? ` do ${until}` : ''}. Dzięki za wsparcie!</span>`;
  }
  if (status.registered) return `Zalogowany jako ${status.email}. Wybierz plan, żeby aktywować Plus.`;
  return 'Załóż konto, żeby wykupić Plus — zajmie chwilę.';
}

const fallbackPrice = (id: string): PlanPrice => PLAN_PRICES[id === 'plus_ai' ? 'plus_ai' : 'plus'];

function buyLabel(planId: string): string {
  return `Wybieram ${fallbackPrice(planId).shortName}`;
}

function planCard(plan: PlanInfo): HTMLElement {
  const fallback = fallbackPrice(plan.id);
  // Older servers sent amount_pln; only trust explicit USD cents.
  const usd = plan.currency === 'usd';
  const monthly = usd && plan.amount_cents ? plan.amount_cents : fallback.monthlyCents;
  const yearly = usd && plan.yearly_cents ? plan.yearly_cents : fallback.yearlyCents;
  const card = document.createElement('div');
  card.className = 'drplus-card';
  const name = document.createElement('b');
  name.textContent = fallback.name;
  const price = document.createElement('div');
  price.className = 'drplus-price';
  price.append(document.createTextNode(`${formatUsd(monthly)} `));
  const per = document.createElement('small');
  per.textContent = '/ mies.';
  price.append(per);
  const year = document.createElement('div');
  year.className = 'drplus-year';
  year.textContent = `lub ${yearlyLabel(yearly)}`;
  const list = document.createElement('ul');
  for (const feature of PLAN_FEATURES[plan.id] ?? []) {
    const item = document.createElement('li');
    item.innerHTML = CHECK_SVG; // static SVG constant
    item.append(document.createTextNode(feature));
    list.append(item);
  }
  const buy = document.createElement('button');
  buy.className = 'drplus-buy';
  buy.type = 'button';
  buy.textContent = buyLabel(plan.id);
  card.append(name, price, year, list, buy);
  card.dataset.plan = plan.id;
  return card;
}

function renderModal(dialog: HTMLElement, status: BillingStatus | null): void {
  const errorLine = dialog.querySelector<HTMLElement>('.drplus-error');
  const cards = dialog.querySelector<HTMLElement>('.drplus-cards');
  const statusEl = dialog.querySelector<HTMLElement>('.drplus-status');
  if (!errorLine || !cards || !statusEl) return;
  statusEl.innerHTML = statusLine(status);
  if (redirectNote) {
    const note = document.createElement('p');
    note.className = 'drplus-note';
    note.textContent = redirectNote;
    statusEl.after(note);
    redirectNote = '';
  }
  if (!status) return;
  cards.replaceChildren(...status.plans.map(planCard));
  cards.querySelectorAll<HTMLElement>('.drplus-card').forEach((card) => {
    const planId = card.dataset.plan ?? '';
    const buy = card.querySelector<HTMLButtonElement>('.drplus-buy');
    if (!buy) return;
    buy.disabled = !status.checkout_available;
    buy.addEventListener('click', () => void choosePlan(planId, buy, errorLine));
  });
}

function closeModal(): void {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeModal();
}

function openModal(): void {
  closeModal();
  ensureStyles();
  overlay = document.createElement('div');
  overlay.className = 'drplus-overlay';
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(); });
  const dialog = document.createElement('div');
  dialog.className = 'drplus-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'AmbiRadio Plus');
  const head = document.createElement('div');
  head.className = 'drplus-head';
  const title = document.createElement('h2');
  title.textContent = 'AmbiRadio Plus';
  const close = document.createElement('button');
  close.className = 'drplus-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Zamknij');
  close.innerHTML = CLOSE_SVG; // static SVG constant
  close.addEventListener('click', closeModal);
  head.append(title, close);
  const status = document.createElement('p');
  status.className = 'drplus-status';
  status.textContent = 'Sprawdzam status...';
  const cards = document.createElement('div');
  cards.className = 'drplus-cards';
  const error = document.createElement('p');
  error.className = 'drplus-error';
  const foot = document.createElement('p');
  foot.className = 'drplus-foot';
  foot.textContent = 'Płatności obsługuje Stripe. Subskrypcję możesz anulować w każdej chwili.';
  dialog.append(head, status, cards, error, foot);
  overlay.append(dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  close.focus();
  void loadStatus().then((current) => renderModal(dialog, current));
}

function mountBadge(): void {
  if (document.getElementById('drplus-badge')) return;
  ensureStyles(); // the badge needs its styles before the modal is ever opened
  const badge = document.createElement('button');
  badge.id = 'drplus-badge';
  badge.className = 'drplus-badge';
  badge.type = 'button';
  badge.innerHTML = PLUS_SVG; // static SVG constant
  badge.append(document.createTextNode('Plus'));
  badge.addEventListener('click', openModal);
  // The classic page reserves a slot in its action row; anywhere else the badge floats bottom-right.
  const slot = document.getElementById('plusSlot');
  if (slot) badge.classList.add('inline');
  (slot ?? document.body).append(badge);
  void loadStatus().then((status) => {
    if (status?.plus) badge.classList.add('active');
  });
}

function handleRedirectReturn(): void {
  const params = new URLSearchParams(location.search);
  const result = params.get('billing');
  if (result === 'success') redirectNote = 'Dziękujemy! Potwierdzamy płatność — Plus aktywuje się automatycznie.';
  else if (result === 'cancel') redirectNote = 'Płatność anulowana. Możesz spróbować ponownie kiedy chcesz.';
  if (result) {
    params.delete('billing');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
    openModal();
  }
}

mountBadge();
handleRedirectReturn();
