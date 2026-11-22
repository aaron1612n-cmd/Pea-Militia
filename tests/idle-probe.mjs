// Standalone: node tests/idle-probe.mjs   (needs a build; prints the idle report)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { idleSim } from './idle-sim.mjs';
const server = spawn('npx', ['vite', 'preview', '--port', '4181', '--strictPort'], { stdio: 'ignore' });
const base = 'http://localhost:4181';
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.setDefaultTimeout(300000);
await page.goto(`${base}/?test`);
await page.waitForFunction(() => window.__game);
console.log(JSON.stringify(await page.evaluate(idleSim)));
await browser.close(); server.kill();
