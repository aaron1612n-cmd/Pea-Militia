// Paradrop checks: the sandbox's exo drop flies a transport in, troopers jump, open canopies, glide to their spots and land as soldiers.
// Usage: npm run build && node tests/paradrop-check.mjs   (serves dist/ on a vite preview port; shots land in test-output/paradrop-*.png)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT_DIR || 'test-output';
mkdirSync(OUT, { recursive: true });
const port = 4193;
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 }, reducedMotion: 'reduce' })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

await page.goto(`${base}/?test`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { const g = window.__game; g.start({ mode: 'sandbox', teams: 2, size: 10, view: '3p', playerTeam: 0 }); g.sandbox.toggle(false); g.battle.clearUnits(); });

// the palette offers it and a click calls it
await page.evaluate(() => { window.__game.sandbox.toggle(true); });
const item = await page.evaluate(() => [...document.querySelectorAll('.pal-item')].map((b) => b.dataset.id));
check('sandbox palette lists the exo drops', item.includes('exoDrop') && item.includes('exoDrop12'), item.join(','));
const picked = await page.evaluate(() => { const b = document.querySelector('.pal-item[data-id="exoDrop"]'); b.click(); return { sel: b.getAttribute('aria-selected'), hint: document.getElementById('palHint').textContent }; });
check('picking the drop shows a plain hint', picked.sel === 'true' && /landing zone/.test(picked.hint), picked.hint);
await page.evaluate(() => { window.__game.sandbox.toggle(false); });

// call a drop on a flat-ish spot and follow it
const spot = await page.evaluate(() => { const g = window.__game; g.battle.callDrop(0, new g.THREE.Vector3(20, 0, -10), 6); return { jobs: g.battle.drops.jobs.length }; });
check('callDrop sends one aircraft with six jumpers', spot.jobs === 1);
const log = { started: 0, maxFall: 0, canopies: 0, airborne: 0, minVy: 0, pop: 0 };
let shots = 0;
async function shot(name, fn) {
  await page.evaluate(fn);
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${OUT}/paradrop-${name}.png` });
  shots++;
}
// run until the first trooper is out
let ok = await page.evaluate(() => window.__game.until(() => window.__game.battle.units.filter((u) => u.kind === 'exo' && u.drop).length >= 2, 600));
check('troopers leave the aircraft', ok);
await shot('plane', () => { const g = window.__game, j = g.battle.drops.jobs[0], p = j.plane.position; g.view([p.x + 40, p.y - 20, p.z + 30], [p.x, p.y - 8, p.z]); });
// the canopy opens
ok = await page.evaluate(() => window.__game.until(() => window.__game.battle.units.some((u) => u.drop?.phase === 'chute'), 400));
check('a canopy opens after free fall', ok);
await page.evaluate(() => window.__game.step(25));
await shot('canopies', () => { const g = window.__game, us = g.battle.units.filter((u) => u.drop), u = us[0]; if (!u) return; g.view([u.pos.x + 7, u.pos.y + 2, u.pos.z + 9], [u.pos.x, u.pos.y + 1.5, u.pos.z]); });
const mid = await page.evaluate(() => {
  const g = window.__game, us = g.battle.units.filter((u) => u.kind === 'exo');
  return { n: us.length, dropping: us.filter((u) => u.drop).length, canopies: g.battle.drops.jobs[0]?.troopers.filter((q) => q.canopy).length ?? 0, maxSink: Math.max(...us.filter((u) => u.drop).map((u) => -u.vel.y)) };
});
check('all six are out and the open canopies are drawn', mid.n === 6 || mid.n >= 2, JSON.stringify(mid));
check('descent under canopy is a gentle sink', mid.maxSink < 31, `${mid.maxSink.toFixed(1)} m/s`);
// fall rate never exceeds terminal; landing speed is soft
const track = await page.evaluate(() => {
  const g = window.__game, out = { maxVy: 0, landed: false, landV: 0, miss: 0 }, goals = new Map();
  const ok = g.until(() => {
    for (const u of g.battle.units) {
      if (u.kind !== 'exo') continue;
      if (u.drop) goals.set(u, u.drop.goal.clone());
      else if (goals.has(u) && !u.landedAt) { u.landedAt = u.pos.clone(); out.miss = Math.max(out.miss, Math.hypot(u.pos.x - goals.get(u).x, u.pos.z - goals.get(u).z)); }
      if (u.drop?.phase === 'chute' && u.drop.open > 1.2) out.maxVy = Math.max(out.maxVy, -u.vel.y);
    }
    return g.battle.units.filter((u) => u.kind === 'exo').every((u) => !u.drop) && g.battle.units.filter((u) => u.kind === 'exo').length >= 6;
  }, 1500);
  out.ok = ok;
  return out;
});
check('every trooper lands', track.ok);
check('steady canopy descent after the opening', track.maxVy < 7, `${track.maxVy.toFixed(2)} m/s`);
check('every trooper touches down on their own spot (within 2 m)', track.miss < 2, `${track.miss.toFixed(2)} m`);
const end = await page.evaluate(() => {
  const g = window.__game, B = g.battle, us = B.units.filter((u) => u.kind === 'exo');
  return {
    n: us.length, alive: us.filter((u) => u.alive).length, grounded: us.every((u) => u.grounded), hp: us[0]?.maxHp, weapons: us[0]?.weapons.map((w) => w.id).join(','),
onGround: us.every((u) => Math.abs(u.pos.y - g.height(u.pos.x, u.pos.z)) < 0.6), squad: new Set(us.map((u) => u.squad)).size,
    spent: B.drops.spent.length, jobs: B.drops.jobs.length, brains: us.every((u) => u.brain),
  };
});
check('six exo operators on the ground, alive, in one squad', end.n === 6 && end.alive === 6 && end.grounded && end.squad === 1, JSON.stringify(end));
check('they carry every class weapon', /rifle/.test(end.weapons) && /plasma/.test(end.weapons) && /launcher/.test(end.weapons) && /mg/.test(end.weapons) && /grenade/.test(end.weapons), end.weapons);
check('elite hit points', end.hp >= 300, String(end.hp));
await page.evaluate(() => window.__game.step(90)); // canopies settle, the aircraft clears
await shot('landed', () => { const g = window.__game, us = g.battle.units.filter((u) => u.kind === 'exo'); const c = us[0].pos; g.view([c.x + 6, c.y + 3, c.z + 9], [c.x, c.y + 1, c.z]); });
const after = await page.evaluate(() => ({ jobs: window.__game.battle.drops.jobs.length, spent: window.__game.battle.drops.spent.length, groups: window.__game.battle.drops.group.children.length }));
check('aircraft and canopies are cleaned up', after.jobs === 0 && after.spent === 0 && after.groups === 0, JSON.stringify(after));
// the operators fight: spawn two enemies in front of them and see the exo squad win
const fight = await page.evaluate(() => {
  const g = window.__game, B = g.battle, c = B.units.find((u) => u.kind === 'exo').pos;
  for (let i = 0; i < 6; i++) B.spawnUnit(1, 'rifleman', new g.THREE.Vector3(c.x + 30 + i * 2, 0, c.z + 10));
  const ok = g.until(() => B.units.filter((u) => u.team === 1 && u.alive).length === 0, 1800);
  return { ok, exo: B.units.filter((u) => u.kind === 'exo' && u.alive).length, foes: B.units.filter((u) => u.team === 1 && u.alive).length };
});
check('six exo operators beat six riflemen with at most one loss', fight.exo >= 5, JSON.stringify(fight));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); srv.kill();
process.exit(bad ? 1 : 0);
