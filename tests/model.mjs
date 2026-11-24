// Soldier model checks on their own (no battle): closed meshes, no clipping, nothing loose.
// Usage: BASE_URL=http://localhost:5173 node tests/model.mjs   (any build or dev server)
import { chromium } from 'playwright';
import { modelChecks, exposeParts } from './model-checks.mjs';

const base = process.env.BASE_URL || 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/?test`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game);
await page.evaluate(exposeParts);
const g = await page.evaluate(modelChecks);
let bad = 0;
const report = (name, list, fmt) => { if (list.length) { bad++; console.log(`FAIL  ${name}`); for (const r of list.slice(0, 12)) console.log('   ', fmt(r)); } else console.log(`PASS  ${name}`); };
report('parts are closed, outward meshes', g.closed, (c) => `${c.name}: open=${c.open} vol=${c.vol.toFixed(4)}`);
report(`no clipping across ${g.phases.length} pose/weapon combinations`, g.phases.filter((r) => r.clips.length), (r) => `${r.name}: ${r.clips.join(', ')}`);
report('no loose parts: arms, legs, hands and gun joined', g.phases.filter((r) => r.loose.length), (r) => `${r.name}: ${r.loose.join(', ')}`);
report('boots on the ground (never below; one planted unless airborne)', g.phases.filter((r) => r.minY < -0.003 || (!r.air && r.minY > 0.012)), (r) => `${r.name}: ${r.minY.toFixed(3)}`);
report('no page errors', errors, (e) => e);
await browser.close();
process.exit(bad ? 1 : 0);
