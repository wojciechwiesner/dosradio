// Measures Orbita frame times in headless Chromium (Playwright) and optionally takes screenshots.
// Usage (dev server must already serve the built page, e.g. `npm run build:orbita && npx vite --port 5202`):
//   PLAYWRIGHT=/path/to/node_modules/playwright-core/index.mjs node scripts/orbita-perf.mjs \
//     --url http://localhost:5202/orbita.html --mode gpu|software --seconds 10 [--shots docs/ambiradio/shots/x] [--reduced] [--live]
// Without --live, /radio-api is blocked and Orbita runs its built-in demo (browser synth, captions).
// Playwright is not a project dependency on purpose: point PLAYWRIGHT at any playwright or playwright-core install.
// CHROMIUM=/usr/bin/chromium picks the browser binary (defaults to Playwright's bundled one).
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const url = args.url || 'http://localhost:5202/orbita.html';
const mode = args.mode || 'software';
const seconds = Number(args.seconds || 10);
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const flags = ['--autoplay-policy=no-user-gesture-required', '--mute-audio'];
if (mode === 'gpu') flags.push('--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan');
else flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ headless: true, args: flags, executablePath: process.env.CHROMIUM || undefined });

async function measure(viewport, label) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 3 : 2, reducedMotion: args.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error(`[${label}] pageerror:`, e.message));
  // Demo mode by default: block the API so a local backend's trial state cannot change what is measured.
  if (!args.live) await page.route('**/radio-api/**', r => r.abort());
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}embed=1#pl`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__orbita?.app?.scene, null, { timeout: 30000 });
  if (args.css) await page.addStyleTag({ content: args.css }); // experiments, e.g. --css '*{backdrop-filter:none!important}'
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('#gl').getContext('webgl2') || document.querySelector('#gl').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await page.evaluate(() => window.__orbita.app.togglePlay(true)).catch(() => {});
  await page.waitForTimeout(4000); // warm-up: shader compile + adaptive quality settles
  const r = await page.evaluate(secs => new Promise(res => {
    const d = []; let last = performance.now(); const end = last + secs * 1000;
    const step = now => { d.push(now - last); last = now; if (now < end) requestAnimationFrame(step); else res(d); };
    requestAnimationFrame(step);
  }), seconds);
  const sorted = [...r].sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const quality = await page.evaluate(() => window.__orbita.app.scene.quality?.() || null);
  const out = { label, viewport: `${viewport.width}x${viewport.height}`, mode, gpu, frames: r.length,
    fps: +(r.length / seconds).toFixed(1), medianMs: +q(0.5).toFixed(2), p95Ms: +q(0.95).toFixed(2), worstMs: +sorted[sorted.length - 1].toFixed(1), quality };
  if (args.shots) {
    const fs = await import('fs'); fs.mkdirSync(args.shots, { recursive: true });
    await page.screenshot({ path: `${args.shots}/orbita-${viewport.width}x${viewport.height}${args.reduced ? '-reduced' : ''}.png` });
    // caption overlay as it looks while a host speaks (demo: the engine emits the same onHost event)
    await page.evaluate(() => window.__orbita.app.engine.events.onHost({ speaking: true, who: 'A', name: 'Kuba', hosts: ['Kuba'],
      caption: 'Dzień dobry, tu Kuba. Za chwilę wiadomości z twoich tematów, a potem stoicka myśl na dobry początek dnia.' }));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${args.shots}/orbita-${viewport.width}x${viewport.height}${args.reduced ? '-reduced' : ''}-caption.png` });
  }
  await ctx.close();
  return out;
}

const results = [];
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) results.push(await measure(vp, vp.width > 500 ? 'desktop' : 'mobile'));
await browser.close();
console.log(JSON.stringify(results, null, 2));
