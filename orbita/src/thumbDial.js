/* 1/4-Circle 2.5D 3-Orbit Corner Thumb-Turntable (exact mobile proposal ergonomics, ZERO EMOJI) */

const RINGS_META = {
  1: { label: 'I · Chill', color: '#38bdf8' },
  2: { label: 'II · Groove', color: '#a78bfa' },
  3: { label: 'III · Rave', color: '#ff6b3d' },
};

export function initThumbTurntable({ app, STATIONS, byId, dial }) {
  if (!document.getElementById('thumbDialCss')) {
    const st = document.createElement('style');
    st.id = 'thumbDialCss';
    st.textContent = `
      #thumbStage{position:fixed;left:0;right:0;top:116px;bottom:192px;z-index:8;display:none;touch-action:none;user-select:none;-webkit-user-select:none}
      body.mode-25d #thumbStage{display:block}
      @media(min-width:761px){body.mode-25d #thumbStage{left:320px;right:345px;top:64px;bottom:56px}}
      #thumbCv{width:100%;height:100%;display:block}
      .td-hint{position:absolute;left:14px;bottom:8px;font:500 10px/1.35 'Azeret Mono',monospace;color:rgba(226,232,240,.52);pointer-events:none;max-width:210px}
      body.mode-25d .td-right .td-hint{left:14px;right:auto;text-align:left}
      body.mode-25d .td-left .td-hint{right:14px;left:auto;text-align:right}
      body.mode-25d #labels .sat-label{display:none!important}
    `;
    document.head.appendChild(st);
  }

  const wrap = document.createElement('div');
  wrap.id = 'thumbStage';
  wrap.innerHTML = `<canvas id="thumbCv"></canvas><div class="td-hint" id="tdHint">Przesuwaj kciukiem po 1/4 łuku lub stuknij stację na 3 orbitach</div>`;
  document.body.appendChild(wrap);

  const cv = wrap.querySelector('#thumbCv');
  const ctx = cv.getContext('2d');

  let angleOffset = 0;
  let vel = 0;
  let dragging = false;
  let lastPos = null;
  let dragDist = 0;
  let hitNodes = [];
  let ringRadiiPx = [135, 198, 262];
  let lastTickKey = '';
  let settleTimer = 0;

  const syncModeClass = () => {
    const use25d = innerWidth <= 760 || app.force25d === true;
    document.body.classList.toggle('mode-25d', use25d);
    wrap.classList.toggle('td-left', !!app.leftHand);
    wrap.classList.toggle('td-right', !app.leftHand);
    app.hide3dRings = use25d;
    return use25d;
  };

  function resize() {
    if (!syncModeClass()) return;
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.floor(r.width * dpr));
    cv.height = Math.max(1, Math.floor(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const maxDim = Math.min(r.width * 0.94, r.height * 0.94);
    ringRadiiPx = [maxDim * 0.46, maxDim * 0.69, maxDim * 0.92];
  }
  window.addEventListener('resize', resize);
  setTimeout(resize, 30);

  function tuneStation(st) {
    if (!st || st.id === app.prefs.station) return;
    app.ensureEntered?.();
    app.commit(p => { p.station = st.id; p.playGroup = false; }, st.name);
    dial.goTo(st.idx, true);
    try { navigator.vibrate?.(8); } catch {}
  }

  function snapNearestOnNeedle(w, h) {
    if (!hitNodes.length) return;
    const rightHand = !app.leftHand;
    const needleAngle = rightHand ? -Math.PI * 0.74 : -Math.PI * 0.26;
    const rf = app.ringFilter || 'all';
    const pool = hitNodes.filter(n =>
      rf === 'all' || (rf === 'fav' ? app.favorites?.has(n.st.id) : n.st.ring === Number(rf))
    );
    const list = pool.length ? pool : hitNodes;
    let best = null, bestDiff = 999;
    for (const n of list) {
      const d = Math.abs(n.angle - needleAngle);
      if (d < bestDiff) { bestDiff = d; best = n; }
    }
    if (best && bestDiff < 0.18) tuneStation(best.st);
  }

  wrap.addEventListener('pointerdown', e => {
    app.ensureEntered?.();
    dragging = true;
    lastPos = { x: e.clientX, y: e.clientY };
    dragDist = 0;
    vel = 0;
    clearTimeout(settleTimer);
    try { wrap.setPointerCapture(e.pointerId); } catch {}
  });

  wrap.addEventListener('pointermove', e => {
    if (!dragging || !lastPos) return;
    const dx = e.clientX - lastPos.x, dy = e.clientY - lastPos.y;
    dragDist += Math.hypot(dx, dy);
    const rightHand = !app.leftHand;
    const delta = (rightHand ? (-dx + dy * 0.62) : (dx + dy * 0.62)) * 0.0046;
    angleOffset += delta;
    vel = delta * 0.42;
    lastPos = { x: e.clientX, y: e.clientY };
  });

  const endDrag = e => {
    if (!dragging) return;
    dragging = false;
    const r = wrap.getBoundingClientRect();
    if (dragDist < 9 && e.type === 'pointerup') {
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bestD = 30;
      for (const h of hitNodes) {
        const d = Math.hypot(h.x - mx, h.y - my);
        if (d < bestD) { bestD = d; best = h.st; }
      }
      if (best) {
        tuneStation(best);
        return;
      }
      /* Check if user tapped one of the 3 ring arcs directly to filter/focus it */
      const rightHand = !app.leftHand;
      const ox = rightHand ? r.width + 24 : -24, oy = r.height + 28;
      const distSpindle = Math.hypot(mx - ox, (my - oy) / 0.92);
      ringRadiiPx.forEach((rad, idx) => {
        if (Math.abs(distSpindle - rad) < 16) {
          app.ringFilter = app.ringFilter === String(idx + 1) ? 'all' : String(idx + 1);
          app.syncRingBar?.();
          try { navigator.vibrate?.(5); } catch {}
        }
      });
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => snapNearestOnNeedle(r.width, r.height), 260);
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  function drawFrame(ts) {
    requestAnimationFrame(drawFrame);
    if (!syncModeClass()) return;
    const r = wrap.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (w < 40 || h < 40) return;
    if (Math.abs(cv.width - Math.floor(w * Math.min(devicePixelRatio || 1, 2))) > 4) resize();

    ctx.clearRect(0, 0, w, h);
    if (!dragging) {
      angleOffset += vel;
      vel *= 0.93;
      if (Math.abs(vel) < 0.00015) vel = 0;
    }

    const rightHand = !app.leftHand;
    const ox = rightHand ? w + 24 : -24;
    const oy = h + 28;
    const startA = rightHand ? -Math.PI * 0.985 : -Math.PI * 0.515;
    const endA = rightHand ? -Math.PI * 0.485 : -Math.PI * 0.015;
    const needleAngle = rightHand ? -Math.PI * 0.74 : -Math.PI * 0.26;
    const rf = app.ringFilter || 'all';

    /* Subtle corner spindle glow */
    const grad = ctx.createRadialGradient(ox, oy, 20, ox, oy, ringRadiiPx[2] + 44);
    grad.addColorStop(0, 'rgba(255,107,61,0.10)');
    grad.addColorStop(0.65, 'rgba(139,124,248,0.05)');
    grad.addColorStop(1, 'rgba(7,6,10,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    /* Tuning needle ray across the 1/4-circle 3 orbits */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ox + Math.cos(needleAngle) * (ringRadiiPx[0] - 28), oy + Math.sin(needleAngle) * (ringRadiiPx[0] - 28) * 0.92);
    ctx.lineTo(ox + Math.cos(needleAngle) * (ringRadiiPx[2] + 24), oy + Math.sin(needleAngle) * (ringRadiiPx[2] + 24) * 0.92);
    ctx.strokeStyle = 'rgba(255, 107, 61, 0.55)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    hitNodes = [];
    const labelBoxes = [];
    const candidates = [];

    [1, 2, 3].forEach((rk, ri) => {
      const meta = RINGS_META[rk];
      const rad = ringRadiiPx[ri];
      const isFocus = rf === 'all' || rf === 'fav' || Number(rf) === rk;

      /* 1/4-circle 2.5D elliptical groove arc */
      ctx.beginPath();
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const a = startA + (i / steps) * (endA - startA);
        const px = ox + Math.cos(a) * rad;
        const py = oy + Math.sin(a) * rad * 0.92;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = isFocus ? meta.color + '88' : 'rgba(255,255,255,0.10)';
      ctx.lineWidth = isFocus ? 2.2 : 1.1;
      ctx.stroke();

      /* Tactile tick marks on outer thumb rim */
      if (rk === 3) {
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
          const a = startA + (i / 28) * (endA - startA);
          const r0 = rad + 9, r1 = rad + (i % 4 === 0 ? 16 : 12);
          ctx.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0 * 0.92);
          ctx.lineTo(ox + Math.cos(a) * r1, oy + Math.sin(a) * r1 * 0.92);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      /* Ring badge near top/side of arc */
      const lblA = rightHand ? endA - 0.04 : startA + 0.04;
      const rlx = Math.max(28, Math.min(w - 28, ox + Math.cos(lblA) * rad));
      const rly = Math.max(12, oy + Math.sin(lblA) * rad * 0.92);
      ctx.font = '600 9.5px "Azeret Mono", monospace';
      ctx.fillStyle = isFocus ? meta.color : 'rgba(255,255,255,0.28)';
      ctx.textAlign = rightHand ? 'right' : 'left';
      ctx.fillText(meta.label, rlx, rly - 6);

      const ringStations = STATIONS.filter(s =>
        s.enabled !== false && s.ring === rk && (rf !== 'fav' || app.favorites?.has(s.id))
      );
      if (!ringStations.length) return;

      const span = Math.PI * 0.50;
      ringStations.forEach((st, slot) => {
        const speedMul = 1.12 - rk * 0.1;
        const rawT = ((slot / Math.max(1, ringStations.length)) + angleOffset * speedMul) % 1;
        const normT = (rawT + 1) % 1;
        const a = rightHand
          ? (-Math.PI * 0.98 + normT * span)
          : (-Math.PI * 0.02 - normT * span);
        const x = ox + Math.cos(a) * rad;
        const y = oy + Math.sin(a) * rad * 0.92;
        if (x < 6 || x > w - 6 || y < 8 || y > h - 8) return;

        const isSel = st.id === app.prefs.station;
        const isFav = !!app.favorites?.has(st.id);
        const friendObj = app.onlineFriends?.find(f => f.station_id === st.id);
        const nearNeedle = Math.abs(a - needleAngle) < 0.065;

        if (nearNeedle && (dragging || Math.abs(vel) > 0.002)) {
          const tk = `${rk}:${st.id}`;
          if (tk !== lastTickKey) {
            lastTickKey = tk;
            try { app.core?.tick?.(); navigator.vibrate?.(4); } catch {}
          }
        }

        hitNodes.push({ x, y, a, angle: a, st });
        const alpha = (isFocus || isSel || friendObj) ? 1 : 0.24;
        ctx.save();
        ctx.globalAlpha = alpha;

        if (friendObj) {
          const p = 1 + 0.18 * Math.sin(ts * 0.005);
          ctx.beginPath(); ctx.arc(x, y, 13 * p, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)'; ctx.lineWidth = 1.8; ctx.stroke();
        }
        if (isSel) {
          ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2);
          ctx.fillStyle = meta.color + '35'; ctx.fill();
        }

        const nr = isSel ? 7.5 : friendObj ? 6.2 : 4.8;
        ctx.beginPath(); ctx.arc(x, y, nr, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? '#ffffff' : meta.color;
        ctx.fill();

        if (isFav) {
          ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.8; ctx.stroke();
        }
        ctx.restore();

        const prio = (isSel ? 1000 : 0) + (friendObj ? 400 : 0) + (isFav ? 180 : 0) + (isFocus ? 80 : 0) - Math.abs(a - needleAngle) * 60;
        if (isSel || friendObj || (isFocus && (Math.abs(a - needleAngle) < 0.28 || isFav))) {
          candidates.push({ x, y, nr, st, meta, isSel, isFav, friendObj, prio });
        }
      });
    });

    /* Clamped AABB Anti-Collision Pill Labels (ZERO edge clipping) */
    candidates.sort((a, b) => b.prio - a.prio);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxPills = innerWidth <= 760 ? 6 : 10;
    let shown = 0;
    for (const c of candidates) {
      if (!c.isSel && shown >= maxPills) continue;
      const text = c.friendObj ? `${c.st.name} · ${c.friendObj.initials || c.friendObj.name.slice(0, 2).toUpperCase()}` : c.st.name;
      ctx.font = `${c.isSel ? 700 : 500} ${c.isSel ? 11.5 : 10.5}px system-ui, -apple-system, sans-serif`;
      const tw = Math.ceil(ctx.measureText(text).width) + 16;
      const th = 22;
      const lx = Math.max(tw / 2 + 8, Math.min(w - tw / 2 - 8, c.x));
      const ly = Math.max(th / 2 + 6, Math.min(h - th / 2 - 6, c.y - c.nr - 14));
      const box = { x: lx - tw / 2 - 4, y: ly - th / 2 - 3, w: tw + 8, h: th + 6 };
      const hit = labelBoxes.some(b => !(box.x + box.w < b.x || box.x > b.x + b.w || box.y + box.h < b.y || box.y > b.y + b.h));
      if (hit && !c.isSel) continue;
      labelBoxes.push(box);
      shown++;

      ctx.save();
      ctx.fillStyle = c.isSel ? 'rgba(20, 14, 18, 0.94)' : 'rgba(10, 11, 18, 0.86)';
      ctx.strokeStyle = c.isSel ? '#ff6b3d' : c.friendObj ? '#34d399' : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = c.isSel ? 1.4 : 1;
      ctx.beginPath();
      ctx.roundRect(lx - tw / 2, ly - th / 2, tw, th, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.isSel ? '#ffffff' : '#e2e8f0';
      ctx.fillText(text, lx, ly + 0.5);
      ctx.restore();
    }
  }
  requestAnimationFrame(drawFrame);

  return { resize, syncModeClass };
}
