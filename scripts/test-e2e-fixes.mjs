import { chromium } from 'playwright';

const BASE_URL = process.env.RADIO_BASE || 'https://dosradio.theones.io';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();

  const networkLog = [];
  page.on('response', (res) => {
    networkLog.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });

  page.on('pageerror', (err) => {
    console.error('PAGE_ERROR:', err.message);
  });

  console.log(`Navigating to ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // 1. Check title & basic DOM
  const title = await page.title();
  console.log(`Page title: ${title}`);

  // 2. Click Play to start music & host greeting
  console.log('Clicking Play...');
  await page.click('#play');
  await page.waitForTimeout(3000);

  // 3. Click "Wiadomości teraz" (#newsNow)
  console.log('Clicking "Wiadomości teraz" (#newsNow)...');
  await page.click('#newsNow');
  await page.waitForTimeout(6000);

  // 4. Test AI Mood Composer (prompting music)
  console.log('Testing AI Mood Composer...');
  await page.fill('#moodInput', 'słoneczny poranek w kawiarni, delikatny Rhodes i ciepły bas');
  await page.click('#moodSubmit');
  await page.waitForTimeout(5000);

  const statusText = await page.textContent('#status');
  console.log(`Final Status: ${statusText}`);

  console.log('\nRelevant network calls:');
  networkLog
    .filter((entry) => entry.includes('/radio-api/') || entry.includes('/radio-ws/'))
    .forEach((entry) => console.log(' ', entry));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
