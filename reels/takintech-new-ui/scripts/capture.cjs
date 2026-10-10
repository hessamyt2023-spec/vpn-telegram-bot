#!/usr/bin/env node
// Screenshots the live site into assets/screens/ with the file names config.json expects.
// Run it on any machine that can open the site:
//
//   npm i -D playwright && npx playwright install chromium     (once)
//   node scripts/capture.cjs https://takintech.ir /services /blog /about /contact
//
// The first URL is the home page; up to four extra paths become page-1..4 (montage).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through to global install */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const [home, ...pages] = process.argv.slice(2);
if (!home) {
  console.error('usage: node scripts/capture.cjs <home-url> [path ...]');
  process.exit(1);
}
const OUT = path.resolve(__dirname, '..', 'assets', 'screens');
fs.mkdirSync(OUT, { recursive: true });

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // scroll through once so lazy images and scroll-reveal animations fire
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
}

(async () => {
  const { chromium, devices } = loadPlaywright();
  const browser = await chromium.launch();

  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await desk.goto(home, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(desk);
  await desk.screenshot({ path: path.join(OUT, 'desktop-hero.png') });
  await desk.screenshot({ path: path.join(OUT, 'desktop-detail.png') });
  await desk.screenshot({ path: path.join(OUT, 'desktop-full.png'), fullPage: true });
  console.log('desktop: hero, detail, full');

  for (let i = 0; i < Math.min(4, pages.length); i++) {
    const url = new URL(pages[i], home).toString();
    await desk.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(desk);
    await desk.screenshot({ path: path.join(OUT, `page-${i + 1}.png`) });
    console.log(`page-${i + 1}: ${url}`);
  }

  const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'] });
  const mob = await ctx.newPage();
  await mob.goto(home, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(mob);
  await mob.screenshot({ path: path.join(OUT, 'mobile-full.png'), fullPage: true });
  console.log('mobile: full');

  await browser.close();
  console.log(`saved to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
