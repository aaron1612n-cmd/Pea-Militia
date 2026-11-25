// Which meshes cost the triangles in a busy battle: node tests/perf-meshes.mjs [size] (needs a build)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const size = +(process.argv[2] || 40);
const server = spawn('npx', ['vite', 'preview', '--port', '4191', '--strictPort'], { stdio: 'ignore' });
const base = 'http://localhost:4191';
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(900000);
await page.goto(`${base}/?test&q=high&post`);
await page.waitForFunction(() => window.__game);
const out = await page.evaluate(({ size }) => {
  const g = window.__game;
  g.start({ mode: 'battle', size, view: '3p' });
  g.step(30 * 40);
  const rows = {}; let total = 0, draws = 0;
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const geo = o.geometry, per = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    const key = o.name || o.type;
    rows[key] = (rows[key] || 0) + per * n; total += per * n; draws++;
  });
  const cp = g.camera.position, d = { near: 0, mid: 0, far: 0 };
  for (const u of g.battle.units) { if (!u.alive) continue; const dd = u.pos.distanceTo(cp); d[dd < 16 ? 'near' : dd < 52 ? 'mid' : 'far']++; }
  const names = []; g.scene.traverse((o) => { if (o.isMesh && o.visible && (o.name || '').startsWith('crowd-')) names.push(o.name); });
  const crowd = Object.entries(rows).filter(([k]) => k.startsWith('crowd-')).reduce((a, [, v]) => a + v, 0);
  return { names: names.join(' '), total, crowd: Math.round(crowd), draws, d, top: Object.entries(rows).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k}:${Math.round(v)}`) };
}, { size });
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.kill(); spawn('pkill', ['-f', 'vite preview']);
