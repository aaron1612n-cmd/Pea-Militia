// Quick play-test: start a battle, run a few seconds, optionally reload, screenshot, report console errors.
// Usage: npm run build && node tests/play-shot.mjs OUT_DIR [1p|3p] (env RELOAD=1 to start a reload)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'play', view = process.argv[3] || '3p';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4193', '--strictPort'], { stdio: 'ignore' });
const base = 'http://localhost:4193';
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.setDefaultTimeout(600000);
await page.goto(`${base}/?test&q=high&post`);
await page.waitForFunction(() => window.__game);
const info = await page.evaluate(({ view, reload }) => {
  const g = window.__game;
  g.start({ mode: 'battle', size: 30, view });
  g.step(30 * 12);
  const p = g.player;
  if (reload && p) { p.weapon.mag = Math.max(0, p.weapon.mag - 3); p.reload && p.reload(); p.reloadT = p.reloadDur = 1.4; p.reloadEmpty = false; g.step(14); }
  return { alive: p?.alive, weapon: p?.weapon?.id, reloading: p?.reloadT };
}, { view, reload: !!process.env.RELOAD });
await page.screenshot({ path: `${out}/${view}${process.env.RELOAD ? '-reload' : ''}.png` });
console.log(JSON.stringify(info), errs.length ? 'ERRORS ' + JSON.stringify(errs.slice(0, 5)) : 'no console errors');
await browser.close(); server.kill(); spawn('pkill', ['-f', 'vite preview']);
