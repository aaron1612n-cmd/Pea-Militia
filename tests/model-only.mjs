// Just the soldier model checks of check.mjs (closed parts, clipping, loose parts, feet), without the rest of the suite.
// Usage: npm run build && node tests/model-only.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { modelChecks, exposeParts } from './model-checks.mjs';
const server = spawn('npx', ['vite', 'preview', '--port', '4192', '--strictPort'], { stdio: 'ignore' });
const base = 'http://localhost:4192';
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
await page.goto(`${base}/?test`);
await page.waitForFunction(() => window.__game);
await page.evaluate(exposeParts);
const g = await page.evaluate(modelChecks);
const bad = g.phases.filter((r) => r.clips.length), loose = g.phases.filter((r) => r.loose.length);
const feet = g.phases.filter((r) => r.minY < -0.003 || (!r.air && r.minY > 0.012 && !/prone 0\.5/.test(r.name)));
console.log(`closed: ${g.closed.length} bad`, g.closed.map((c) => `${c.name}: open=${c.open} vol=${c.vol.toFixed(4)}`).join('; '));
console.log(`${g.phases.length} pose/weapon combinations: ${bad.length} clipping, ${loose.length} loose, ${feet.length} feet off the ground`);
const cat = (l, f) => { const m = {}; for (const r of l) for (const t of f(r)) { const k = t.replace(/[-\d.]+/g, '#').replace(/\(\d+ verts\)/, ''); m[k] = (m[k] || 0) + 1; } return m; };
console.log('clip kinds', JSON.stringify(cat(bad, (r) => r.clips)), '\nloose kinds', JSON.stringify(cat(loose, (r) => r.loose)));
for (const [label, l, f] of [['clips', bad, (r) => r.clips.join(',')], ['loose', loose, (r) => r.loose.join(',')], ['feet', feet, (r) => r.minY.toFixed(3)]]) for (const r of l.slice(0, +(process.env.N || 8))) console.log(`  ${label}  ${r.name}: ${f(r)}`);
await browser.close(); server.kill(); spawn('pkill', ['-f', 'vite preview']);
