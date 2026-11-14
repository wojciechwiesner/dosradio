/* Free-hour experience and conversion: checklist, showcase programme, nudges, paywall/recap, plans, auth. */
import { t, fmtLeft } from './i18n.js';
import { storage } from './data.js';
import { defaultPodcast, defaultPodcastTitle, stoicPill, stoicPillTitle, toParts } from './content.js';

const KEY = 'dosradio.orbita.freehour.v1';
export const STEPS = ['news', 'orbit', 'stoic', 'podcast', 'source'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Sales {
  constructor(app) {
    this.app = app;
    const s = storage.read(KEY) || {};
    this.done = new Set(Array.isArray(s.done) ? s.done : []);
    this.stats = { news: 0, pods: 0, stoic: 0, stations: 1, ...(s.stats || {}) };
    this.credit = typeof s.credit === 'number' ? s.credit : 1;
    this.nudged = new Set(s.nudged || []);
    this.demoRemaining = typeof s.demoRemaining === 'number' ? s.demoRemaining : 3600;
    this.showcaseQueued = false;
    this.authMode = 'register';
  }
  save() { storage.write(KEY, { done: [...this.done], stats: this.stats, credit: this.credit, nudged: [...this.nudged], demoRemaining: this.demoRemaining }); }
  get active() { const me = this.app.me; return !!me && !me.plus; }
  get trial() { const me = this.app.me; return !!me && !me.registered && !me.plus; }

  mark(step) {
    if (this.done.has(step)) return;
    this.done.add(step); this.save(); this.app.renderPane('plus'); this.renderPip();
    if (this.done.size === STEPS.length && this.active) setTimeout(() => this.app.toast(t('fhDoneAll'), { action: t('register'), onAction: () => this.open('plans') }), 1200);
  }
  stat(k, n = 1) { this.stats[k] = (this.stats[k] || 0) + n; this.save(); }
  renderPip() { const pip = document.getElementById('fhPip'); const left = STEPS.length - this.done.size; pip.hidden = !this.active || left === 0; pip.textContent = left; }

  /* Showcase programme for the first hour: default podcast after the first news, stoic pill after the second.
     Live servers can provide their own audio via /radio-api/showcase (see BACKEND.md); otherwise the browser voices read the scripts. */
  async queueShowcase() {
    if (this.showcaseQueued || !this.active) return;
    this.showcaseQueued = true;
    const e = this.app.engine, [a, b] = e.hosts;
    const sc = this.app.api.live ? await this.app.api.showcase() : null;
    const pod = sc?.podcast || { id: 'showcase-default', title: defaultPodcastTitle(), parts: toParts(defaultPodcast(a, b)) };
    const stoic = sc?.stoic || { id: 'showcase-stoic', title: stoicPillTitle(), parts: toParts(stoicPill(a, b)) };
    e.enqueuePill({ ...stoic, showcase: true, whole: true }, true);
    e.enqueuePill({ ...pod, showcase: true, whole: true }, true);
    e.firstBreakMs = 20000; // first news 20 s after the intro instead of 5 min
  }
  showcasePodcast() { const [a, b] = this.app.engine.hosts; return { id: 'showcase-default', title: defaultPodcastTitle(), parts: toParts(defaultPodcast(a, b)) }; }

  /* trial clock (live: server value, decremented locally while playing; demo: stored locally) */
  remaining() { const me = this.app.me; if (!me) return 3600; return this.app.api.live ? me.trial_remaining ?? 3600 : this.demoRemaining; }
  tick() {
    if (!this.trial || !this.app.engine.playing) return this.renderTrial();
    if (this.app.api.live) this.app.me.trial_remaining = Math.max(0, (this.app.me.trial_remaining ?? 3600) - 1);
    else { this.demoRemaining = Math.max(0, this.demoRemaining - 1); if (this.demoRemaining % 10 === 0) this.save(); }
    const r = this.remaining();
    if (r <= 900 && !this.nudged.has(15)) { this.nudged.add(15); this.save(); this.app.toast(t('nudge15'), { action: t('podGo'), onAction: () => this.app.openTab('pods'), long: true }); }
    if (r <= 300 && !this.nudged.has(5)) { this.nudged.add(5); this.save(); this.app.engine.announce(t('tts_5min')); this.app.toast(t('nudge5'), { action: t('register'), onAction: () => this.open('ended'), long: true }); }
    if (r <= 0) { this.app.engine.stop(); this.open('ended'); }
    this.renderTrial();
  }
  renderTrial() {
    const pill = document.getElementById('trialPill');
    pill.hidden = !this.trial;
    if (!this.trial) return;
    const r = this.remaining();
    document.getElementById('trialLeft').textContent = fmtLeft(r);
    document.getElementById('trialRing').setAttribute('stroke-dashoffset', (50.3 * (1 - r / 3600)).toFixed(1));
  }
  skipToEnd() { this.demoRemaining = 1; this.nudged.add(15); this.nudged.add(5); this.save(); if (!this.app.engine.playing) this.open('ended'); }

  /* podcast credit: one free podcast for non-Plus listeners */
  canGenerate() { return this.app.me?.plus || this.credit > 0; }
  useCredit() { if (!this.app.me?.plus) { this.credit = Math.max(0, this.credit - 1); this.save(); } }

  /* ---------------- plus pane ---------------- */
  paneHtml() {
    const me = this.app.me || {}, plan = this.app.billing?.plans || [{ id: 'plus', amount_pln: 39 }, { id: 'plus_ai', amount_pln: 59 }];
    let h = '';
    if (me.plus) h += `<section class="group"><h2>${t('plansTitle')}</h2><p class="lead"><span class="tag hot">${t('plusActive')}</span></p></section>`;
    else {
      const d = this.done.size;
      h += `<section class="group"><h2>${t('fhTitle')} <span class="hint">${t('fhProgress', { d, n: STEPS.length })}</span></h2>
        <div class="progress"><i style="width:${(d / STEPS.length * 100).toFixed(0)}%"></i></div>
        <ol class="steps">${STEPS.map(s => `<li><button type="button" data-step="${s}" class="${this.done.has(s) ? 'done' : ''}"><span class="box">${this.done.has(s) ? '✓' : ''}</span><span>${esc(t('fhSteps')[s])}</span></button></li>`).join('')}</ol>
        ${this.app.api.live ? '' : `<button class="btn small" type="button" data-act="skip">${t('demoSkip')}</button>`}
      </section>`;
      h += `<section class="group"><h2>${t('plansTitle')}</h2>${this.plansHtml(plan)}<p class="hint">${t('stripeNote')}</p></section>`;
    }
    h += `<section class="group">${me.registered ? `<button class="btn wide" type="button" data-act="logout">${t('logout')}</button>` : `<button class="btn primary wide" type="button" data-act="register">${t('register')}</button><button class="btn wide" type="button" data-act="login">${t('haveAccount')}</button>`}</section>`;
    return h;
  }
  plansHtml(plans) {
    const get = id => plans.find(p => p.id === id)?.amount_pln ?? (id === 'plus' ? 39 : 59);
    const card = (id, name, feats, cta, featured) => `<div class="plan${featured ? ' featured' : ''}"><b>${name}</b><div class="price">${get(id)} <small>${t('currency')} ${t('perMonth')}</small></div><ul>${feats.map(f => `<li>${esc(f)}</li>`).join('')}</ul><button class="btn ${featured ? 'primary' : ''} small" type="button" data-plan="${id}">${cta}</button></div>`;
    return `<div class="plans">${card('plus', 'Plus', t('planPlus'), t('choosePlus'), true)}${card('plus_ai', 'Plus+AI', t('planAi'), t('chooseAi'), false)}</div>`;
  }
  bindPane(root) {
    root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => this.goStep(b.dataset.step)));
    root.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => this.checkout(b.dataset.plan, b)));
    root.querySelector('[data-act="register"]')?.addEventListener('click', () => this.open('auth', 'register'));
    root.querySelector('[data-act="login"]')?.addEventListener('click', () => this.open('auth', 'login'));
    root.querySelector('[data-act="logout"]')?.addEventListener('click', () => this.logout());
    root.querySelector('[data-act="skip"]')?.addEventListener('click', () => this.skipToEnd());
  }
  goStep(s) {
    const a = this.app;
    if (s === 'news') { a.ensureEntered(); a.engine.newsNow(); }
    else if (s === 'orbit') { a.ensureEntered(); a.nudgeDial(); }
    else if (s === 'stoic') a.playStoic();
    else if (s === 'podcast') a.openTab('pods', '#podTopic');
    else if (s === 'source') a.openTab('mine', '#gmailDemo');
  }

  /* ---------------- paywall / recap / auth ---------------- */
  open(kind, authMode) {
    const box = document.getElementById('pwBox'), me = this.app.me || {};
    if (authMode) this.authMode = authMode;
    const plans = this.app.billing?.plans || [{ id: 'plus', amount_pln: 39 }, { id: 'plus_ai', amount_pln: 59 }];
    let h = '';
    if (kind === 'ended') {
      const st = this.stats;
      h += `<h2 id="pwTitle">${t('recapTitle')}</h2><p class="lead">${t('recapLead')}</p>
        <div class="stats"><div class="stat"><b>${st.news}</b><span>${t('recapNews')}</span></div><div class="stat"><b>${st.pods}</b><span>${t('recapPods')}</span></div><div class="stat"><b>${st.stoic}</b><span>${t('recapStoic')}</span></div><div class="stat"><b>${st.stations}</b><span>${t('recapStations')}</span></div></div>`;
    } else if (kind === 'auth') h += `<h2 id="pwTitle">${this.authMode === 'register' ? t('register') : t('login')}</h2>`;
    else h += `<h2 id="pwTitle">${t('plansTitle')}</h2>${kind === 'podcastUsed' ? `<p class="lead">${t('podUsed')}</p>` : kind === 'locked' ? `<p class="lead">${t('plusOnly')}</p>` : ''}`;
    if (kind !== 'auth' && me.registered) h += this.plansHtml(plans);
    if (!me.registered) h += this.authHtml(kind === 'auth' ? this.authMode : 'register');
    if (kind !== 'auth' && !me.registered) h += `<details><summary class="hint" style="cursor:pointer">${t('plansTitle')}: 39 / 59 ${t('currency')} ${t('perMonth')}</summary><div style="margin-top:10px">${this.plansHtml(plans)}</div></details>`;
    h += `<p class="hint">${t('stripeNote')}</p><div class="row"><button class="btn small" type="button" data-close>${t('later')}</button></div>`;
    box.innerHTML = h;
    const pw = document.getElementById('paywall'); pw.hidden = false;
    box.querySelector('[data-close]').addEventListener('click', () => { pw.hidden = true; });
    box.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => this.checkout(b.dataset.plan, b)));
    const form = box.querySelector('#authForm');
    if (form) {
      form.addEventListener('submit', e => { e.preventDefault(); this.submitAuth(form); });
      box.querySelector('#authSwitch').addEventListener('click', () => { this.authMode = this.authMode === 'register' ? 'login' : 'register'; this.open('auth'); });
      box.querySelector('#authEmail').focus();
    }
  }
  authHtml(mode) {
    return `<form id="authForm" novalidate>
      <label class="field" for="authEmail">${t('emailLbl')}<input id="authEmail" type="email" autocomplete="email" required></label>
      <label class="field" for="authPw">${t('pwLbl')}<input id="authPw" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" required minlength="8"></label>
      <p class="err" id="authErr" role="alert"></p>
      <button class="btn primary wide" type="submit">${mode === 'register' ? t('register') : t('login')}</button>
      <button class="btn wide" type="button" id="authSwitch">${mode === 'register' ? t('haveAccount') : t('noAccount')}</button>
    </form>`;
  }
  async submitAuth(form) {
    const email = form.querySelector('#authEmail').value.trim(), pw = form.querySelector('#authPw').value, err = form.querySelector('#authErr');
    if (pw.length < 8) { err.textContent = t('pwShort'); return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      if (this.authMode === 'register') { await this.app.api.register(email, pw); form.innerHTML = `<p class="lead">${esc(t('checkMail', { e: email }))}</p>`; return; }
      await this.app.api.login(email, pw);
      document.getElementById('paywall').hidden = true;
      await this.app.refreshMe(); this.app.toast(t('loggedIn'));
      if (!this.app.engine.playing) this.app.togglePlay(true);
    } catch (e) { err.textContent = e.demo ? t('demoAuth') : e.message; }
    finally { btn.disabled = false; }
  }
  async logout() { try { await this.app.api.logout(); } catch { /* ignore */ } this.app.engine.stop(); await this.app.refreshMe(); this.app.toast(t('loggedOut')); }
  async checkout(plan, btn) {
    const me = this.app.me || {};
    if (!me.registered) { this.open('auth', 'register'); document.getElementById('authErr').textContent = t('payLogin'); return; }
    const label = btn.textContent; btn.disabled = true; btn.textContent = t('openingPay');
    try { const r = await this.app.api.checkout(plan); if (r?.url) { location.href = r.url; return; } throw new Error(t('payFail')); }
    catch (e) { this.app.toast(e.demo ? t('demoAuth') : e.status === 503 ? t('payOff') : e.status === 401 ? t('payLogin') : (e.message || t('payFail')), { error: true }); }
    finally { btn.disabled = false; btn.textContent = label; }
  }
}
