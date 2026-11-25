import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const types = process.argv[3].split(',');
const port = 5197;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://localhost:${port}/tests/strider-viewer.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
for (const t of types) for (const v of ['q3', 'back']) { await page.evaluate(([t, v]) => window.showProp(t, v), [t, v]); await page.locator('canvas').screenshot({ path: `${out}/${t}-${v}.png` }); }
await browser.close(); srv.kill();
