// Draw calls and triangles per mesh name in a busy battle: node tests/perf-draws.mjs [size] [phone|desktop]  (needs a build)
// Counts visible meshes (and instanced counts) by name, next to renderer.info's total (which includes the shadow pass).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const size = +(process.argv[2] || 40), dev = process.argv[3] || 'phone', q = dev === 'phone' ? 'low' : 'high';
const server = spawn('npx', ['vite', 'preview', '--port', '4192', '--strictPort'], { stdio: 'ignore' });
const base = 'http://localhost:4192';
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: dev === 'phone' ? { width: 390, height: 780 } : { width: 1280, height: 720 }, hasTouch: dev === 'phone' });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.setDefaultTimeout(900000);
await page.goto(`${base}/?test&q=${q}${dev === 'desktop' ? '&post' : ''}`);
await page.waitForFunction(() => window.__game);
const out = await page.evaluate(({ size }) => {
  const g = window.__game;
  g.start({ mode: 'battle', size, view: '3p' });
  g.step(30 * 40);
  g.step(5, 1 / 30);
  const info = g.renderer.info;
  const cam = g.camera; cam.updateMatrixWorld(); const fm = new cam.projectionMatrix.constructor().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const FR = new (cam.frustum?.constructor || (class { }))();
  const planes = (() => { const e = fm.elements, P = []; const row = (i) => [e[i], e[4 + i], e[8 + i], e[12 + i]]; const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3); for (const [a, s] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) P.push(a.map((v, k) => r3[k] + s * v)); return P; })();
  const inView = (o) => { const geo = o.geometry; if (!geo.boundingSphere) geo.computeBoundingSphere(); const bs = geo.boundingSphere; const c = bs.center.clone().applyMatrix4(o.matrixWorld); const sc = o.matrixWorld.getMaxScaleOnAxis(); for (const p of planes) { const l = Math.hypot(p[0], p[1], p[2]); if ((p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3]) / l < -bs.radius * sc) return false; } return true; };
  const rows = {};
  let draws = 0, tris = 0;
  g.scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    let v = o; while (v && v.visible) v = v.parent; if (v) return;
    const n = o.isInstancedMesh ? o.count : 1;
    if (!n) return;
    if (!o.isInstancedMesh && o.frustumCulled && !inView(o)) return;
    const geo = o.geometry, per = geo.index ? geo.index.count / 3 : (geo.attributes.position?.count || 0) / 3;
    let key = o.name || o.parent?.name || ''; if (!key) { let a = o.parent; const ch = []; while (a && ch.length < 3) { ch.push(a.name || a.type); a = a.parent; } key = 'anon<' + ch.join('<') + '>:' + (o.material?.name || o.material?.type) + (o.isInstancedMesh ? ':inst' : ''); }
    const r = (rows[key] ||= { draws: 0, tris: 0 });
    r.draws++; r.tris += per * n; draws++; tris += per * n;
  });
  const top = Object.entries(rows).sort((a, b) => b[1].draws - a[1].draws || b[1].tris - a[1].tris).map(([k, v]) => `${k}: ${v.draws} draws ${Math.round(v.tris)} tris`);
  const dbg = []; g.scene.traverse((o) => { if (o.isMesh && o.visible && !o.name && o.parent && o.parent.type === 'Group' && !o.parent.name && o.parent.parent?.type === 'Scene' && dbg.length < 12) dbg.push([o.parent.children.length, Object.keys(o.parent.userData).join('/'), o.geometry.attributes.position.count, o.material.color?.getHexString(), o.position.toArray().map((v) => +v.toFixed(1)).join(',')].join(' ')); });
  return { dbg, sceneDraws: draws, sceneTris: Math.round(tris), infoCalls: info.render.calls, infoTris: info.render.triangles, top };
}, { size });
console.log(JSON.stringify({ ...out, top: undefined }));
console.log(out.dbg.join('\n'));
console.log(out.top.join('\n'));
if (errs.length) console.log('ERRORS', errs.slice(0, 5));
await browser.close(); server.kill(); spawn('pkill', ['-f', 'vite preview']);
