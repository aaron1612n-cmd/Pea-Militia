// Strider close-ups: node tests/strider-shots.mjs OUT_DIR  (env VIEWS, ZOOMS, WALK=secs, SPEED)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'strider-shots';
const views = (process.env.VIEWS || 'front,q3,side,back').split(',');
const zooms = (process.env.ZOOMS || 'full').split(',');
const walks = (process.env.WALKS || '0').split(',').map(Number);
const kind = process.env.KIND || 'walker', hurt = process.env.HURT ? +process.env.HURT : 1, lodL = +(process.env.LOD || 0);
mkdirSync(out, { recursive: true });
const port = 5198;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${port}/tests/strider-viewer.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
for (const w of walks) {
  await page.evaluate(([k, h, l]) => { window.make(0, k); if (h < 1) window.hurt(h); if (l) window.lod(l); }, [kind, hurt, lodL]);
  if (w > 0) await page.evaluate((s) => window.walk(s, 4), w);
  for (const zoom of zooms) for (const view of views) {
    await page.evaluate((o) => window.shot(o), { view, zoom });
    await page.locator('canvas').screenshot({ path: `${out}/${kind}-w${w}-${zoom}-${view}.png` });
  }
}
if (errs.length) console.log('ERRORS', errs.slice(0, 5));
await browser.close(); srv.kill();
