// In-game close-ups of the world: node tests/world-shots.mjs OUT_DIR [what,...] (needs a build)
// what: prop types (sandbags, ruin ...), tree, wreck, wire, point:N (a control point), over (high overview)
// env: Q=high|low  W=1280 H=720  TIME=hour  WEATHER=clear|rain|...
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'world'; mkdirSync(out, { recursive: true });
const what = (process.argv[3] || 'over').split(',');
const server = spawn('npx', ['vite', 'preview', '--port', '4194', '--strictPort'], { stdio: 'ignore' });
const base = 'http://localhost:4194';
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.setDefaultTimeout(600000);
await page.goto(`${base}/?test&q=${process.env.Q || 'high'}&post`);
await page.waitForFunction(() => window.__game);
await page.evaluate(({ time, weather }) => {
  const g = window.__game;
  g.start({ mode: 'battle', size: 4, view: '3p' });
  if (time || weather) g.atmo.set({ time: time ? +time : undefined, weather });
  g.freeze(true);
}, { time: process.env.TIME, weather: process.env.WEATHER });
for (const w of what) {
  const [kind, arg] = w.split(':');
  const shot = await page.evaluate(({ kind, arg }) => {
    const g = window.__game, b = g.battle;
    let tgt = null, off = [7, 3.5, 7];
    if (kind === 'over') { tgt = [0, 0, 0]; off = [0, 120, 90]; }
    else if (kind === 'point') { const p = b.points[+arg || 0]; tgt = [p.pos.x, p.pos.y + 1.2, p.pos.z]; off = [9, 5, 12]; }
    else if (kind === 'tree' || kind === 'wreck' || kind === 'wire' || kind === 'decor') {
      const grp = b.decor.find((d) => d.name === (kind === 'tree' ? 'trees' : 'decor'));
      const sp = grp?.userData.spots?.[kind]?.[+arg || 0];
      if (!sp) return null;
      tgt = [sp.x, sp.y + 1.2, sp.z]; off = [sp.r ? sp.r * 1.4 : 9, 4, sp.r ? sp.r * 1.4 : 9];
    } else {
      const ps = b.props.filter((p) => p.type === kind);
      const p = ps[+arg || 0];
      if (!p) return null;
      tgt = [p.box.x, p.box.y0 + p.box.h * 0.5, p.box.z];
      const d = Math.max(4, Math.hypot(p.box.hx, p.box.hz, p.box.h) * 2.2);
      off = [Math.sin(p.box.yaw + 0.9) * d, d * 0.45, Math.cos(p.box.yaw + 0.9) * d];
    }
    g.view([tgt[0] + off[0], tgt[1] + off[1], tgt[2] + off[2]], tgt);
    g.step(2, 1 / 60); g.render();
    return true;
  }, { kind, arg });
  if (!shot) { console.log('skip', w); continue; }
  await page.screenshot({ path: `${out}/${w.replace(':', '-')}.png` });
}
console.log(errs.length ? 'ERRORS ' + JSON.stringify(errs.slice(0, 5)) : 'no console errors');
await browser.close(); server.kill(); spawn('pkill', ['-f', 'vite preview']);
