// Automated build checks: collisions, clipping, loose parts, closed meshes, z-fighting,
// camera fit, UI overlap, buttons (mouse + touch), console errors, turntable renders.
// Usage: npm run build && npm run check            (serves dist/ via vite preview)
//        BASE_URL=https://pea-militia.avadlabs.workers.dev npm run check   (live build)
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT_DIR || 'test-output';
mkdirSync(OUT, { recursive: true });
let base = process.env.BASE_URL;
let server;
if (!base) {
  server = spawn('npx', ['vite', 'preview', '--port', '4180', '--strictPort'], { stdio: 'ignore' });
  base = 'http://localhost:4180';
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
}
const url = `${base.replace(/\/$/, '')}/?test`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(ctxOpts) {
  const ctx = await browser.newContext({ ...ctxOpts, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pea);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

// ---------------- geometry checks (run in page) ----------------
const geometryChecks = () => {
  const { THREE, pea, plate, colliders } = window.__pea;
  const out = {};
  const parts = pea.userData.parts();
  const byName = Object.fromEntries(parts.map((p) => [p.name, p]));
  const v = new THREE.Vector3();

  const worldVerts = (m, max = Infinity) => {
    const n = m.geometry.attributes.position.count;
    const step = Math.max(1, Math.floor(n / max));
    const pts = [];
    for (let i = 0; i < n; i += step) {
      m.getVertexPosition(i, v);
      pts.push(v.clone().applyMatrix4(m.matrixWorld));
    }
    return pts;
  };
  const bbox = (pts) => new THREE.Box3().setFromPoints(pts);
  const rc = new THREE.Raycaster();
  const dirs = [new THREE.Vector3(1, 0.13, 0.07).normalize(), new THREE.Vector3(-0.11, 1, 0.21).normalize(), new THREE.Vector3(0.17, -0.09, -1).normalize()];
  const inside = (p, m) => {
    const side = m.material.side;
    m.material.side = THREE.DoubleSide;
    let votes = 0;
    for (const d of dirs) {
      rc.set(p, d);
      const hits = rc.intersectObject(m, false);
      // collapse duplicate hits on shared edges
      let n = 0, last = -1;
      for (const h of hits) { if (h.distance - last > 1e-5) n++; last = h.distance; }
      if (n % 2 === 1) votes++;
    }
    m.material.side = side;
    return votes >= 2;
  };

  // closed, outward meshes (no gaps / see-through faces)
  const closed = [];
  const edgeCheck = (m) => {
    const g = m.geometry;
    const p = g.attributes.position;
    const key = (i) => `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    const ids = new Map();
    const id = (i) => { const k = key(i); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
    const idx = g.index ? g.index.array : [...Array(p.count).keys()];
    const edges = new Map();
    let vol = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < idx.length; i += 3) {
      const t = [id(idx[i]), id(idx[i + 1]), id(idx[i + 2])];
      for (let k = 0; k < 3; k++) {
        const e = [t[k], t[(k + 1) % 3]];
        const ek = e[0] < e[1] ? `${e[0]}_${e[1]}` : `${e[1]}_${e[0]}`;
        edges.set(ek, (edges.get(ek) || 0) + 1);
      }
      a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
      vol += a.dot(b.clone().cross(c)) / 6;
    }
    let open = 0;
    for (const n of edges.values()) if (n === 1) open++;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    return { name: m.name, open, vol, front: mats.every((x) => x.side === THREE.FrontSide && !x.transparent) };
  };
  for (const m of [...parts, plate]) closed.push(edgeCheck(m));
  out.closed = closed.filter((c) => c.open > 0 || c.vol <= 0 || !c.front);
  out.partCount = parts.length;

  // per animation phase: grounded, no clipping, nothing loose
  const phases = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.48, 2.56, 2.8, 3.2];
  const clipPairs = [
    ['mittL', 'body'], ['mittR', 'body'], ['thumbL', 'body'], ['thumbR', 'body'],
    ['bootL', 'bootR'], ['legL', 'legR'], ['mittL', 'legL'], ['mittR', 'legR'],
    ['helmet', 'eyeL'], ['helmet', 'eyeR'], ['helmet', 'browL'], ['helmet', 'browR'],
    ['browL', 'eyeL'], ['browR', 'eyeR'], ['mouth', 'eyeL'], ['mouth', 'eyeR'], ['strap', 'mouth'],
    ['strap', 'armL'], ['strap', 'armR'], ['strap', 'mittL'], ['strap', 'mittR'],
    ['buckle', 'mouth'], ['buckle', 'armR'], ['buckle', 'mittR'],
  ];
  out.phases = [];
  for (const t of phases) {
    window.__pea.pause(t);
    const r = { t, clips: [], loose: [] };
    const verts = new Map(parts.map((m) => [m, worldVerts(m, 260)]));
    const boxes = new Map([...verts].map(([m, pts]) => [m, bbox(pts)]));
    let minY = Infinity;
    for (const pts of verts.values()) for (const p of pts) minY = Math.min(minY, p.y);
    // full-resolution ground check for boots
    for (const n of ['bootL', 'bootR', 'legL', 'legR']) for (const p of worldVerts(byName[n])) minY = Math.min(minY, p.y);
    r.minY = minY;
    for (const [a, b] of clipPairs) {
      const A = byName[a], B = byName[b];
      if (!boxes.get(A).intersectsBox(boxes.get(B))) continue;
      const n = worldVerts(A, 600).filter((p) => inside(p, B)).length;
      if (n) r.clips.push(`${a} in ${b}: ${n}`);
    }
    // connectivity graph
    const touches = (A, B) => {
      const ba = boxes.get(A).clone().expandByScalar(0.004), bb = boxes.get(B).clone().expandByScalar(0.004);
      if (!ba.intersectsBox(bb)) return false;
      for (const p of verts.get(A)) if (bb.containsPoint(p) && inside(p, B)) return true;
      for (const p of verts.get(B)) if (ba.containsPoint(p) && inside(p, A)) return true;
      return false;
    };
    const seen = new Set([byName.body]);
    const queue = [byName.body];
    while (queue.length) {
      const a = queue.shift();
      for (const b of parts) if (!seen.has(b) && touches(a, b)) { seen.add(b); queue.push(b); }
    }
    r.loose = parts.filter((p) => !seen.has(p)).map((p) => p.name);
    // collider must enclose the pea at every phase
    const c = colliders.pea;
    const ab = c.b.clone().sub(c.a);
    let outside = 0;
    for (const pts of verts.values()) for (const p of pts) {
      const s = THREE.MathUtils.clamp(p.clone().sub(c.a).dot(ab) / ab.lengthSq(), 0, 1);
      if (p.distanceTo(c.a.clone().addScaledVector(ab, s)) > c.r) outside++;
    }
    r.outsideCollider = outside;
    out.phases.push(r);
  }
  window.__pea.pause(0);

  // z-fighting: coplanar, overlapping triangles on different meshes
  const tris = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (const m of [...parts, plate]) {
    const g = m.geometry;
    const idx = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (let i = 0; i < idx.length; i += 3) {
      m.getVertexPosition(idx[i], A); A.applyMatrix4(m.matrixWorld);
      m.getVertexPosition(idx[i + 1], B); B.applyMatrix4(m.matrixWorld);
      m.getVertexPosition(idx[i + 2], C); C.applyMatrix4(m.matrixWorld);
      const n = B.clone().sub(A).cross(C.clone().sub(A));
      const area = n.length() / 2;
      if (area < 1e-7) continue;
      n.normalize();
      const d = n.dot(A);
      const key = `${Math.round(n.x * 50)},${Math.round(n.y * 50)},${Math.round(n.z * 50)},${Math.round(d * 1000)}`;
      tris.push({ m: m.name, key, n, d, c: A.clone().add(B).add(C).divideScalar(3), box: new THREE.Box3().setFromPoints([A.clone(), B.clone(), C.clone()]) });
    }
  }
  const buckets = new Map();
  for (const t of tris) { if (!buckets.has(t.key)) buckets.set(t.key, []); buckets.get(t.key).push(t); }
  const zf = new Set();
  for (const list of buckets.values()) {
    const names = new Set(list.map((t) => t.m));
    if (names.size < 2) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      // distance measured at the triangles themselves, not at the origin: two nearly parallel
      // planes can share d at the origin while sitting millimetres apart where the faces are
      if (a.m === b.m || a.n.dot(b.n) < 0.9995 || Math.abs(b.n.dot(a.c) - b.d) > 2e-4 || Math.abs(a.n.dot(b.c) - a.d) > 2e-4) continue;
      const ia = a.box.clone().intersect(b.box);
      const s = ia.getSize(new THREE.Vector3());
      if (!ia.isEmpty() && [s.x, s.y, s.z].filter((x) => x > 1e-4).length >= 2) zf.add([a.m, b.m].sort().join('/'));
    }
  }
  out.zfight = [...zf];
  out.triangles = tris.length;
  const cam = window.__pea.camera;
  out.depthRatio = cam.far / cam.near;
  return out;
};

// camera collision checks (run in page)
const cameraChecks = () => {
  const { THREE, controls, camera, colliders, pea } = window.__pea;
  const bad = [];
  const c = colliders.pea;
  const ab = c.b.clone().sub(c.a);
  const capsuleDist = (p) => {
    const s = THREE.MathUtils.clamp(p.clone().sub(c.a).dot(ab) / ab.lengthSq(), 0, 1);
    return p.distanceTo(c.a.clone().addScaledVector(ab, s));
  };
  // sweep every direction at minimum zoom, and below-ground attempts at max zoom
  for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 8) {
    for (const pitch of [-0.5, -0.12, 0, 0.4, 0.9, 1.45]) {
      for (const dist of [0.2, controls.limits.minDist, 4, 40]) {
        controls.goal.yaw = yaw; controls.goal.pitch = pitch; controls.goal.dist = dist;
        controls.goal.dist = THREE.MathUtils.clamp(controls.goal.dist, controls.limits.minDist, controls.limits.maxDist);
        Object.assign(controls.cur, { yaw, pitch, dist, target: controls.goal.target.clone() });
        controls.update(1 / 60);
        const p = camera.position;
        if (p.y < colliders.plate.max.y + 0.1) bad.push(`below ground y=${p.y.toFixed(3)}`);
        if (capsuleDist(p) < c.r) bad.push(`inside pea collider yaw=${yaw.toFixed(2)} pitch=${pitch}`);
      }
    }
  }
  // panning stays over the plate
  controls.pan(1e6, 1e6);
  const t = controls.goal.target;
  if (Math.abs(t.x) > colliders.plate.max.x || Math.abs(t.z) > colliders.plate.max.z) bad.push('pan escaped plate');
  controls.fit(true);
  controls.update(1 / 60);
  pea.userData.setPhase(0, true);
  return bad;
};

// default framing: whole pea visible, decent size, no UI covering it
const framingCheck = () => {
  const { THREE, controls, camera, pea } = window.__pea;
  controls.fit(true);
  controls.update(1 / 60);
  camera.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(pea, true);
  const pts = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z).project(camera));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const W = innerWidth, H = innerHeight;
  const rect = { left: ((Math.min(...xs) + 1) / 2) * W, right: ((Math.max(...xs) + 1) / 2) * W, top: ((1 - Math.max(...ys)) / 2) * H, bottom: ((1 - Math.min(...ys)) / 2) * H };
  const inView = xs.every((x) => x > -1 && x < 1) && ys.every((y) => y > -1 && y < 1);
  const frac = Math.max((rect.right - rect.left) / W, (rect.bottom - rect.top) / H);
  const overlaps = [];
  for (const el of document.querySelectorAll('.mark, .hint:not(.gone), .btn')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) overlaps.push(el.className || el.id);
  }
  // UI elements must not overlap each other
  const els = [...document.querySelectorAll('.mark, .hint, .btn')].map((e) => [e.className, e.getBoundingClientRect()]);
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i][1], b = els[j][1];
    if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push(`${els[i][0]}x${els[j][0]}`);
  }
  const offscreen = els.filter(([, r]) => r.left < 0 || r.top < 0 || r.right > W || r.bottom > H).map(([n]) => n);
  return { inView, frac, rect, overlaps, offscreen };
};

// center pixels of the render should be the pea
const centerPixel = () => {
  const { renderer, scene, camera } = window.__pea;
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight * 0.45), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [...px];
};

try {
  // ---------- desktop ----------
  const d = await open({ viewport: { width: 1280, height: 800 } });
  const g = await d.page.evaluate(geometryChecks);
  check('meshes closed + outward + opaque front faces (no gaps / see-through)', g.closed.length === 0, g.closed.map((c) => `${c.name}: open=${c.open} vol=${c.vol.toFixed(4)} front=${c.front}`).join('; '));
  check('z-fighting: no coplanar overlapping faces between meshes', g.zfight.length === 0, g.zfight.join(', ') || `${g.triangles} tris`);
  check('depth precision far/near <= 10000', g.depthRatio <= 10000, String(g.depthRatio));
  for (const r of g.phases) {
    check(`phase t=${r.t}: feet on plate, nothing under it`, r.minY >= -1e-4 && r.minY <= 0.01, `minY=${r.minY.toFixed(4)}`);
    check(`phase t=${r.t}: no clipping`, r.clips.length === 0, r.clips.join('; '));
    check(`phase t=${r.t}: no loose parts (${g.partCount} parts)`, r.loose.length === 0, r.loose.join(', '));
    check(`phase t=${r.t}: pea inside its collider`, r.outsideCollider === 0, `${r.outsideCollider} verts outside`);
  }
  const cam = await d.page.evaluate(cameraChecks);
  check('camera collides with plate and pea; pan clamped to plate', cam.length === 0, cam.slice(0, 4).join('; '));
  const f = await d.page.evaluate(framingCheck);
  check('desktop: pea fully framed at default view', f.inView && f.frac > 0.3 && f.frac < 0.95, `fills ${(f.frac * 100).toFixed(0)}%`);
  check('desktop: UI never covers the pea or overlaps itself', f.overlaps.length === 0 && f.offscreen.length === 0, [...f.overlaps, ...f.offscreen].join(', '));
  const px = await d.page.evaluate(centerPixel);
  check('render: pea visible at screen centre', px[1] > px[0] && px[1] > px[2] && px[1] > 60, px.join(','));

  // turntable + close-ups
  const shots = [];
  // shot distances/targets are authored for a full-size pea; scale them with the model
  const S = await d.page.evaluate(() => window.__pea.pea.scale.x);
  const shoot = async (name, yaw, pitch, dist, target) => {
    dist *= S;
    if (target) target = target.map((x) => x * S);
    await d.page.evaluate(([yaw, pitch, dist, target]) => {
      const c = window.__pea.controls;
      const t = target ? new window.__pea.THREE.Vector3(...target) : c.focus.center.clone();
      Object.assign(c.goal, { yaw, pitch, dist, target: t });
      Object.assign(c.cur, { yaw, pitch, dist, target: t.clone() });
      c.update(1 / 60);
      window.__pea.render();
    }, [yaw, pitch, dist, target]);
    await d.page.screenshot({ path: `${OUT}/${name}.png` });
    shots.push(name);
  };
  for (let i = 0; i < 8; i++) await shoot(`turntable-${String(i * 45).padStart(3, '0')}`, (i * Math.PI) / 4, 0.18, 2.6);
  await shoot('top', 0.3, 1.45, 2.8);
  await shoot('low', 0.4, -0.1, 2.4);
  await shoot('closeup-face', 0, 0.08, 1.2, [0, 0.66, 0]);
  await shoot('closeup-boots', 0.5, 0.15, 1.1, [0, 0.12, 0.05]);
  await shoot('closeup-helmet', 2.4, 0.5, 1.2, [0, 1.05, 0]);
  await shoot('closeup-hand', 1.3, 0.1, 1.1, [0.66, 0.3, 0.1]);
  await shoot('closeup-strap-front', 0, -0.02, 1.6, [0, 0.68, 0]);
  await shoot('closeup-strap-side', 1.2, 0.02, 1.6, [0, 0.68, 0]);
  await shoot('closeup-strap-low', 0.6, -0.3, 1.6, [0, 0.62, 0]);
  await d.page.evaluate(() => { window.__pea.pause(2.48); window.__pea.render(); });
  await shoot('closeup-blink', 0, 0.08, 1.2, [0, 0.66, 0]);
  check('turntable + close-up renders saved', shots.length === 18, `${OUT}/`);

  // desktop button: mouse click (no pointer lock in this build; verify the hit target is the button)
  await d.page.evaluate(() => { window.__pea.resume(); const c = window.__pea.controls; c.goal.yaw = 3; c.goal.dist = 9; });
  const hitD = await d.page.evaluate(() => { const r = document.getElementById('recenter').getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#recenter') !== null; });
  check('desktop: recenter button is the top element at its centre', hitD);
  await d.page.click('#recenter');
  const resetD = await d.page.evaluate(() => { const c = window.__pea.controls; return Math.abs(c.goal.yaw - 0.55) < 1e-6 && Math.abs(c.goal.dist - c.fitDistance()) < 1e-3; });
  check('desktop: recenter button click resets the camera', resetD);
  await d.page.evaluate(() => { const c = window.__pea.controls; c.goal.yaw = 2; });
  await d.page.mouse.move(640, 400);
  await d.page.keyboard.press('KeyR');
  check('desktop: R key recenters', await d.page.evaluate(() => Math.abs(window.__pea.controls.goal.yaw - 0.55) < 1e-6));
  // mouse drag orbits
  const y0 = await d.page.evaluate(() => window.__pea.controls.goal.yaw);
  await d.page.mouse.move(400, 400); await d.page.mouse.down(); await d.page.mouse.move(600, 380, { steps: 6 }); await d.page.mouse.up();
  const y1 = await d.page.evaluate(() => window.__pea.controls.goal.yaw);
  check('desktop: mouse drag orbits', Math.abs(y1 - y0) > 0.2, `${(y1 - y0).toFixed(2)} rad`);
  await d.page.mouse.wheel(0, 400);
  await d.page.click('#recenter');
  await d.page.waitForTimeout(900);
  await d.page.screenshot({ path: `${OUT}/desktop.png` });
  check('desktop: no console errors', d.errors.length === 0, d.errors.slice(0, 3).join(' | '));

  // ---------- phone ----------
  const m = await open({ ...devices['iPhone 13'] });
  const fm = await m.page.evaluate(framingCheck);
  check('phone: pea fully framed at default view', fm.inView && fm.frac > 0.3 && fm.frac < 0.95, `fills ${(fm.frac * 100).toFixed(0)}%`);
  check('phone: UI never covers the pea or overlaps itself', fm.overlaps.length === 0 && fm.offscreen.length === 0, [...fm.overlaps, ...fm.offscreen].join(', '));
  check('phone: touch hint shown', await m.page.evaluate(() => document.documentElement.dataset.input === 'touch'));
  await m.page.screenshot({ path: `${OUT}/phone.png` });
  // one-finger drag via real touch events (CDP)
  const cdp = await m.ctx.newCDPSession(m.page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const yy0 = await m.page.evaluate(() => window.__pea.controls.goal.yaw);
  await touch('touchStart', [[120, 400]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[120 + i * 25, 400]]);
  await touch('touchEnd', []);
  const yy1 = await m.page.evaluate(() => window.__pea.controls.goal.yaw);
  check('phone: one-finger drag orbits', Math.abs(yy1 - yy0) > 0.2, `${(yy1 - yy0).toFixed(2)} rad`);
  const d0 = await m.page.evaluate(() => window.__pea.controls.goal.dist);
  await touch('touchStart', [[150, 400], [240, 400]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[150 - i * 10, 400], [240 + i * 10, 400]]);
  await touch('touchEnd', []);
  const d1 = await m.page.evaluate(() => window.__pea.controls.goal.dist);
  check('phone: pinch zooms in', d1 < d0 * 0.9, `${d0.toFixed(2)} -> ${d1.toFixed(2)}`);
  const hitM = await m.page.evaluate(() => { const r = document.getElementById('recenter').getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#recenter') !== null; });
  check('phone: recenter button is the top element at its centre', hitM);
  await m.page.tap('#recenter');
  const resetM = await m.page.evaluate(() => { const c = window.__pea.controls; return Math.abs(c.goal.yaw - 0.55) < 1e-6 && Math.abs(c.goal.dist - c.fitDistance()) < 1e-3; });
  check('phone: recenter button tap resets the camera', resetM);
  const btn = await m.page.evaluate(() => { const r = document.getElementById('recenter').getBoundingClientRect(); return [r.width, r.height]; });
  check('phone: button is at least 44px', btn[0] >= 44 && btn[1] >= 44, btn.join('x'));
  check('phone: no console errors', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));

  // landscape phone framing
  await m.page.setViewportSize({ width: 844, height: 390 });
  await m.page.waitForTimeout(300);
  const fl = await m.page.evaluate(framingCheck);
  check('phone landscape: pea fully framed, UI clear', fl.inView && fl.overlaps.length === 0 && fl.offscreen.length === 0, `fills ${(fl.frac * 100).toFixed(0)}% ${fl.overlaps.join(',')}`);
  await m.page.screenshot({ path: `${OUT}/phone-landscape.png` });
} catch (e) {
  check('suite ran to completion', false, e.stack || String(e));
}

await browser.close();
if (server) server.kill();
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
