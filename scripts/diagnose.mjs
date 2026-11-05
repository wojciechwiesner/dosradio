// Diagnose DOS Radio in real Chrome: what plays, does the EQ move, does the host speak, what the status says.
// Usage: RADIO_BASE=https://dosradio.theones.io OUT=/tmp/x.json node scripts/diagnose.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const base = process.env.RADIO_BASE || 'https://dosradio.theones.io';
const out = process.env.OUT || '/tmp/dosradio-diagnose.json';
const report = { console: [], requests: [], samples: [] };

const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
page.on('console', (m) => report.console.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => report.console.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/radio-api/') || u.includes('/radio-ws/')) {
    report.requests.push(`${r.status()} ${r.request().method()} ${u.replace(base, '').slice(0, 110)} ${r.headers()['x-dosradio-source'] || ''}`);
  }
});
page.on('websocket', (ws) => {
  report.requests.push(`WS open ${ws.url().replace(/key=[^&]+/, 'key=***').slice(0, 120)}`);
  ws.on('close', () => report.requests.push('WS close'));
});

// fresh account so the trial never interferes
await page.goto(base + '/');
await page.evaluate(async () => {
  await fetch('/radio-api/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `probe+diag${Date.now()}@theones.io`, password: 'probe-haslo-123' }) });
});
await page.reload();
await page.click('#play');

for (let second = 0; second < 40; second += 2) {
  await page.waitForTimeout(2000);
  report.samples.push(await page.evaluate(() => {
    const r = window.dosRadio;
    const bars = [...document.querySelectorAll('#bars span')].slice(0, 6).map((b) => b.style.height);
    return {
      t: Math.round(performance.now() / 1000),
      status: document.querySelector('#status')?.textContent,
      playing: r?.isPlaying,
      speaking: r?.speaking,
      ctx: r?.ctx?.state,
      duck: r ? +r.musicBus.gain.value.toFixed(2) : null,
      streamer: !!r?.chunkStreamer,
      helper: !!r?.helper,
      bars: bars.join(' '),
    };
  }));
}
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ samples: report.samples.slice(0, 4).concat(report.samples.slice(-2)), requests: report.requests.slice(0, 25), console: report.console.slice(0, 15) }, null, 1));
await browser.close();
