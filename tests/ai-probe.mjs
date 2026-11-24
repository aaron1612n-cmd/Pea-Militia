// Standalone: node tests/ai-probe.mjs   (needs a build; prints the AI movement and morale report)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { aiSim } from './ai-sim.mjs';
const server = spawn('npx', ['vite', 'preview', '--port', '4182', '--strictPort'], { stdio: 'ignore' });
const base = 'http://localhost:4182';
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.setDefaultTimeout(900000);
await page.goto(`${base}/?test`);
await page.waitForFunction(() => window.__game);
console.log(JSON.stringify(await page.evaluate(aiSim, { seconds: +(process.argv[2] || 180), size: 50 })));
if (errs.length) console.log('ERRORS', errs.slice(0, 5));
await browser.close(); server.kill();
