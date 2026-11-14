/**
 * DOS Radio Plus billing UI: floating "Plus" badge opens a minimal plan modal,
 * plan choice goes through POST /radio-api/billing/checkout and redirects to Stripe.
 * Self-contained by design (own styles, own fetches) — owned by the billing worker.
 */

interface PlanInfo { id: string; name: string; amount_pln: number; interval: string }
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
    'Wszystko, co w planie Plus',
    'Wyższe limity generowania AI',
    'Priorytetowa kolejka podcastów',
    'Najnowsze funkcje jako pierwsza wersja',
  ],
};

const STYLE = `
.drplus-badge{position:fixed;right:20px;bottom:20px;z-index:60;display:flex;align-items:center;gap:8px;
  padding:9px 16px;border-radius:999px;border:1px solid var(--line-strong);cursor:pointer;
  background:rgba(17,18,24,0.85);backdrop-filter:blur(8px);color:var(--text);font:600 13px/1 Inter,-apple-system,sans-serif;
  letter-spacing:0.2px;transition:border-color 0.15s,transform 0.15s}
.drplus-badge:hover{border-color:var(--accent);transform:translateY(-1px)}
.drplus-badge.active{border-color:var(--ok);color:var(--ok)}
.drplus-badge svg{width:14px;height:14px}
.drplus-overlay{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:20px;
  background:rgba(5,6,9,0.72);backdrop-filter:blur(8px)}
.drplus-dialog{width:min(560px,100%);background:var(--bg-2);border:1px solid var(--line-strong);
  border-radius:18px;padding:26px;animation:drplus-in 0.18s ease-out}
@keyframes drplus-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.drplus-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px}
.drplus-head h2{margin:0;font-size:22px;letter-spacing:-0.3px}
.drplus-close{background:none;border:0;color:var(--dim);cursor:pointer;padding:6px;border-radius:8px}
.drplus-close:hover{color:var(--text);background:var(--panel-hover)}
.drplus-close svg{width:16px;height:16px;display:block}
.drplus-status{margin:0 0 18px;color:var(--dim);font-size:13.5px;min-height:18px}
.drplus-status .ok{color:var(--ok)}
.drplus-status .warn{color:var(--accent-2)}
.drplus-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:540px){.drplus-cards{grid-template-columns:1fr}}
.drplus-card{border:1px solid var(--line);border-radius:14px;padding:16px;background:var(--panel);
  display:flex;flex-direction:column;gap:10px;text-align:left}
.drplus-card:hover{border-color:var(--line-strong);background:var(--panel-hover)}
.drplus-card b{font-size:15px}
.drplus-price{font-size:24px;letter-spacing:-0.5px}
.drplus-price small{font-size:13px;color:var(--dim);font-weight:400}
.drplus-card ul{margin:0;padding:0;list-style:none;display:grid;gap:7px;flex:1}
.drplus-card li{display:flex;gap:8px;align-items:flex-start;color:var(--dim);font-size:13px}
.drplus-card li svg{width:13px;height:13px;color:var(--ok);margin-top:3px}
.drplus-buy{margin-top:6px;padding:10px;border-radius:10px;border:1px solid var(--line-strong);
  background:var(--bg);color:var(--text);font:600 13px Inter,sans-serif;cursor:pointer;transition:border-color 0.15s}
.drplus-buy:hover{border-color:var(--accent)}
.drplus-buy[disabled]{opacity:0.55;cursor:default}
.drplus-note{margin:0 0 14px;font-size:13px;color:var(--dim)}
.drplus-error{margin:14px 0 0;color:#ff9a9a;font-size:13px;min-height:16px}
.drplus-foot{margin:16px 0 0;font-size:12px;color:var(--faint)}
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
  button.textContent = planId === 'plus_ai' ? 'Wybieram Plus+AI' : 'Wybieram Plus';
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

function planCard(plan: PlanInfo): HTMLElement {
  const card = document.createElement('div');
  card.className = 'drplus-card';
  const name = document.createElement('b');
  name.textContent = plan.id === 'plus_ai' ? 'Plus+AI' : 'Plus';
  const price = document.createElement('div');
  price.className = 'drplus-price';
  price.append(document.createTextNode(`${plan.amount_pln} zł `));
  const per = document.createElement('small');
  per.textContent = '/ mies.';
  price.append(per);
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
  buy.textContent = plan.id === 'plus_ai' ? 'Wybieram Plus+AI' : 'Wybieram Plus';
  card.append(name, price, list, buy);
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
  dialog.setAttribute('aria-label', 'DOS Radio Plus');
  const head = document.createElement('div');
  head.className = 'drplus-head';
  const title = document.createElement('h2');
  title.textContent = 'DOS Radio Plus';
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
  const badge = document.createElement('button');
  badge.id = 'drplus-badge';
  badge.className = 'drplus-badge';
  badge.type = 'button';
  badge.innerHTML = CHECK_SVG; // static SVG constant
  badge.append(document.createTextNode('Plus'));
  badge.addEventListener('click', openModal);
  document.body.append(badge);
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
