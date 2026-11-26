// Play-test of movement pace with real keyboard input: walking forward, backing up, strafing and sprinting, measured on the player.
// Usage: npm run build && node tests/move-play.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 4195;
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 320 }, reducedMotion: 'reduce' })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/?test`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { const g = window.__game; g.start({ mode: 'sandbox', teams: 2, size: 10, view: '3p', playerTeam: 0 }); g.sandbox.toggle(false); g.battle.clearUnits(); g.step(20); });
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
async function pace(keys) {
  for (const k of keys) await page.keyboard.down(k);
  const r = await page.evaluate(() => { const g = window.__game; g.step(60); let m = 0, n = 0; g.until(() => { const p = g.player; m += Math.hypot(p.vel.x, p.vel.z); return ++n >= 31; }, 40); return m / n; });
  for (const k of keys) await page.keyboard.up(k);
  await page.evaluate(() => window.__game.step(40));
  return r;
}
const fwd = await pace(['KeyW']), back = await pace(['KeyS']), left = await pace(['KeyA']), right = await pace(['KeyD']), sprint = await pace(['KeyW', 'ShiftLeft']), backSprint = await pace(['KeyS', 'ShiftLeft']);
console.log({ fwd, back, left, right, sprint, backSprint });
check('backing up is about half of walking', back / fwd > 0.45 && back / fwd < 0.65, `${(back / fwd).toFixed(2)}`);
check('strafing is about three quarters of walking', left / fwd > 0.68 && left / fwd < 0.88 && right / fwd > 0.68 && right / fwd < 0.88, `${(left / fwd).toFixed(2)} / ${(right / fwd).toFixed(2)}`);
check('sprinting forward is much faster than walking', sprint / fwd > 1.5, `${(sprint / fwd).toFixed(2)}`);
check('sprint while backing up gives no boost', backSprint / fwd < 0.65, `${(backSprint / fwd).toFixed(2)}`);
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); srv.kill();
process.exit(bad ? 1 : 0);
