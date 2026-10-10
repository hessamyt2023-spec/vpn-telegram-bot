#!/usr/bin/env node
// Renders scene/index.html frame by frame with headless Chromium and pipes the
// frames into ffmpeg. Also writes build/cues.json for the sound-design script.
//
//   node scripts/render.cjs                 -> build/video.mp4 (silent)
//   node scripts/render.cjs --still 1.2,4.5 -> build/stills/*.png (quick look)
//   node scripts/render.cjs --cues-only     -> build/cues.json only

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through to global install */ }
  const root = execSync('npm root -g').toString().trim();
  return require(path.join(root, 'playwright'));
}

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const stills = opt('--still');
const cuesOnly = args.includes('--cues-only');
const draft = args.includes('--draft');

function collectAssets() {
  const paths = [
    cfg.screens.desktop_hero, cfg.screens.desktop_full, cfg.screens.detail,
    cfg.screens.mobile_full, ...cfg.screens.montage,
  ];
  const exists = {};
  for (const p of paths) exists[p] = fs.existsSync(path.join(ROOT, p));
  let logo = null;
  const svg = path.join(ROOT, cfg.outro.logo);
  const png = path.join(ROOT, cfg.outro.logo_fallback_png);
  if (fs.existsSync(svg)) logo = { type: 'svg', text: fs.readFileSync(svg, 'utf8') };
  else if (fs.existsSync(png)) logo = { type: 'png', data: 'data:image/png;base64,' + fs.readFileSync(png).toString('base64') };
  return { exists, logo };
}

(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  const assets = collectAssets();
  const missing = Object.entries(assets.exists).filter(([, ok]) => !ok).map(([p]) => p);
  if (missing.length) console.warn(`[render] placeholders used for: ${missing.join(', ')}`);
  if (!assets.logo) console.warn('[render] no Hexano logo found - using placeholder');

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: cfg.video.width, height: cfg.video.height }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('[page error]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.addInitScript(([c, a]) => { window.__CONFIG = c; window.__ASSETS = a; }, [cfg, assets]);
  await page.goto('file://' + path.join(ROOT, 'scene', 'index.html'));
  await page.evaluate(() => window.__ready);

  const cues = await page.evaluate(() => window.__CUES);
  fs.writeFileSync(path.join(BUILD, 'cues.json'), JSON.stringify(cues, null, 1));
  console.log(`[render] ${cues.length} sound cues -> build/cues.json`);
  if (cuesOnly) { await browser.close(); return; }

  if (stills) {
    const stage = await page.$('#stage');
    const dir = path.join(BUILD, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const s of stills.split(',').map(Number)) {
      await page.evaluate(t => window.__seek(t), s);
      const out = path.join(dir, `t${s.toFixed(2).padStart(5, '0')}.png`);
      await stage.screenshot({ path: out });
      console.log('[render] still', out);
    }
    await browser.close();
    return;
  }

  const { fps, duration } = cfg.video;
  const total = Math.round(fps * duration);
  const out = path.join(BUILD, 'video.mp4');
  // CDP capture is ~4x faster than element screenshots; PNG keeps gradients clean,
  // --draft trades that for JPEG speed.
  const cdp = await page.context().newCDPSession(page);
  const shot = draft ? { format: 'jpeg', quality: 92, optimizeForSpeed: true } : { format: 'png', optimizeForSpeed: true };
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', draft ? 'mjpeg' : 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))));

  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await page.evaluate(t => window.__seek(t), f / fps);
    const buf = Buffer.from((await cdp.send('Page.captureScreenshot', shot)).data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 60 === 0) process.stdout.write(`\r[render] frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  console.log(`\n[render] ${total} frames -> build/video.mp4 in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch(e => { console.error(e); process.exit(1); });
