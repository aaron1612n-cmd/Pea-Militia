// Like perf-probe, but counts every pass of a frame (shadow, main, post) instead of the last one: node tests/perf-count.mjs [size] [phone|desktop] [q]   (needs a build)
// Runs a busy battle and prints draw calls, triangles and per-stage CPU milliseconds. GPU time is not
// measured (headless software GL), so this tracks what the game asks the GPU to do and what JS costs.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const size = +(process.argv[2] || 40), dev = process.argv[3] || 'phone', q = process.argv[4] || (dev === 'phone' ? 'low' : 'high');
const server = spawn('npx', ['vite', 'preview', '--port', '4190', '--strictPort'], { stdio: 'ignore' });
const base = 'http://localhost:4190';
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: dev === 'phone' ? { width: 390, height: 780 } : { width: 1280, height: 720 }, hasTouch: dev === 'phone' });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.setDefaultTimeout(900000);
await page.goto(`${base}/?test&q=${q}${dev === 'desktop' ? '&post' : ''}`);
await page.waitForFunction(() => window.__game);
const out = await page.evaluate(async ({ size }) => {
  const g = window.__game;
  g.start({ mode: 'battle', size, view: '3p' });
  const info = g.renderer.info;
  g.step(30 * 40); // 40 s of fighting so there are corpses, blood and fire
  const rows = [];
  const samples = 40;
  let calls = 0, tris = 0, geos = 0, tex = 0, prog = 0;
  const t = { frame: 0, render: 0 };
  for (let i = 0; i < samples; i++) {
    info.autoReset = false; info.reset();
    const a = performance.now();
    g.step(1, 1 / 30);
    t.frame += performance.now() - a;
    calls += info.render.calls; tris += info.render.triangles; info.reset();
    geos = info.memory.geometries; tex = info.memory.textures; prog = info.programs.length;
  }
  const b = g.battle;
  return { calls: calls / samples, tris: Math.round(tris / samples), geos, tex, prog, frameMs: t.frame / samples, units: b.units.length, alive: b.units.filter((u) => u.alive).length, hook: !!window.__perf && window.__perf.snapshot?.() };
}, { size });
console.log(JSON.stringify(out));
if (errs.length) console.log('ERRORS', errs.slice(0, 5));
await browser.close(); server.kill();
