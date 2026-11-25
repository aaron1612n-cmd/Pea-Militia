// Close-up renders of props from several angles: node tests/prop-shots.mjs OUT_DIR type[,type...] [views=q3,back] [lite]
// Every variant of each type is shot; `lite` renders the far detail level instead.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const types = process.argv[3].split(',');
const views = (process.argv[4] || 'q3,back').split(',');
const lite = process.argv[5] === 'lite';
const port = 5197;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${port}/tests/strider-viewer.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
for (const t of types) {
  const n = await page.evaluate((t) => window.variantCount?.(t) ?? 1, t);
  for (let v = 0; v < n; v++) for (const view of views) { await page.evaluate(([t, view, v, lite]) => window.showProp(t, view, v, lite), [t, view, v, lite]); await page.locator('canvas').screenshot({ path: `${out}/${t}-${v}-${view}${lite ? '-far' : ''}.png` }); }
}
await browser.close(); srv.kill();
