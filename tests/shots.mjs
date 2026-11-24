// Close-up renders of every class: node tests/shots.mjs OUT_DIR [kinds] — uses tests/viewer.html on a vite dev server.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'shots';
const kinds = process.argv[3] ? process.argv[3].split(',') : ['rifleman', 'assault', 'gunner', 'mortar', 'coil', 'medic'];
const views = (process.env.VIEWS || 'front,q3,side,back').split(',');
const modes = (process.env.MODES || 'idle,run').split(',');
const zooms = (process.env.ZOOMS || 'full').split(',');
mkdirSync(out, { recursive: true });
const port = 5199;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${port}/tests/viewer.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
for (const kind of kinds) for (const mode of modes) for (const zoom of zooms) for (const view of views) {
  await page.evaluate((o) => window.shot(o), { kind, view, mode, zoom, phase: Number(process.env.PHASE || 0.15) });
  await page.locator('canvas').screenshot({ path: `${out}/${kind}-${mode}-${zoom}-${view}.png` });
}
if (errs.length) console.log('ERRORS', errs.slice(0, 5));
await browser.close(); srv.kill();
