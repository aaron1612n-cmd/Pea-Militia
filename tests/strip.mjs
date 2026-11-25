// Frame strips of any animation: node tests/strip.mjs OUT.png SPEC_JSON
//   spec: { kind, views: ['front','side','q3'], zoom: 'full', cell: 320, frames: [ <pose state>, ... ] }
// One row per view, one column per frame, so a cycle reads left to right. Uses tests/viewer.html on a vite dev server.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [out, specJson] = process.argv.slice(2);
const spec = JSON.parse(specJson);
const views = spec.views || ['side'], kind = spec.kind || 'rifleman', zoom = spec.zoom || 'full', cell = spec.cell || 320, cols = spec.frames.length;
const dir = mkdtempSync(join(tmpdir(), 'strip-'));
const port = 5300 + Math.floor(Math.random() * 400);
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${port}/tests/viewer.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 90000 });
const files = [];
for (const view of views) for (let i = 0; i < spec.frames.length; i++) {
  await page.evaluate((o) => window.shot(o), { kind, view, mode: 'idle', zoom, state: spec.frames[i] });
  const f = join(dir, `${view}-${i}.png`);
  await page.locator('canvas').screenshot({ path: f });
  files.push(f);
}
if (errs.length) console.log('ERRORS', errs.slice(0, 5));
await browser.close(); srv.kill();
execFileSync('python3', [new URL('./sheet.py', import.meta.url).pathname, out, String(cols), String(cell), String(cell), ...files]);
console.log('wrote', out);
