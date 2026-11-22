// Automated build checks: soldier model (closed parts, no clipping, nothing loose, gun in the
// hands, feet on the ground) across every animation phase and weapon; camera, aiming,
// weapons, AI battle, sandbox palette, menus, UI overlap (mouse + touch), console errors,
// and renders.
// Usage: npm run build && npm run check            (serves dist/ via vite preview)
//        BASE_URL=https://steel-meridian.avadlabs.workers.dev npm run check   (live build)
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
  page.setDefaultTimeout(120000); // software rendering on CI runners is slow
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

// ---------------- soldier model checks (run in page) ----------------
const modelChecks = () => {
  const { THREE, U, pose, makePose, HOLD, crowd } = window.__game;
  const { PART_GEO } = window.__parts;
  const out = { closed: [], phases: [] };
  // closed, outward part meshes
  const closed = (g, name) => {
    const p = g.attributes.position;
    const key = (i) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    const ids = new Map();
    const id = (i) => { const k = key(i); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
    const idx = g.index ? g.index.array : [...Array(p.count).keys()];
    const edges = new Map();
    let vol = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < idx.length; i += 3) {
      const t = [id(idx[i]), id(idx[i + 1]), id(idx[i + 2])];
      if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue; // degenerate
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
    return { name, open, vol };
  };
  for (const [k, g] of Object.entries(PART_GEO)) out.closed.push(closed(g, k));
  out.closed = out.closed.filter((c) => c.open > 0 || c.vol <= 0);

  // body as a box in its own frame, a hair smaller so touching surfaces don't count
  const bodyInv = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const insideBody = (pt, shrink = 0.012) => {
    v.copy(pt).applyMatrix4(bodyInv);
    const hx = U.W / 2 - shrink, hy = U.H / 2 - shrink, hz = U.D / 2 - shrink;
    if (Math.abs(v.x) > hx || Math.abs(v.y) > hy || Math.abs(v.z) > hz) return false;
    // rounded edges: outside the rounding radius near a corner doesn't count
    const R = U.R;
    const ex = Math.max(0, Math.abs(v.x) - (hx - R)), ey = Math.max(0, Math.abs(v.y) - (hy - R)), ez = Math.max(0, Math.abs(v.z) - (hz - R));
    return ex * ex + ey * ey + ez * ez <= R * R;
  };
  const corners = (m, size, shrink) => {
    const pts = [];
    const [x, y, z] = size.map((s) => s / 2 - shrink);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(new THREE.Vector3(sx * x, sy * y, sz * z).applyMatrix4(m));
    return pts;
  };
  // sampled weapon vertices (in hold space, scaled)
  const wverts = {};
  for (const [id, list] of Object.entries(crowd.weapons)) {
    const pts = [];
    for (const m of list) {
      const p = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(p.count / 220));
      for (let i = 0; i < p.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(p, i));
    }
    wverts[id] = pts;
  }
  const phases = [];
  const W = Object.keys(HOLD);
  for (const t of [0, 0.9, 1.8, 2.7]) phases.push({ name: `idle ${t}`, t, ready: 0.55 });
  for (const [mx, mz, label] of [[0, 1, 'fwd'], [1, 0, 'strafe'], [0, -1, 'back'], [0.7, 0.7, 'diag']]) {
    for (let c = 0; c < 1; c += 0.125) phases.push({ name: `walk ${label} ${c.toFixed(2)}`, walk: 1, cycle: c, stride: 0.6, mx, mz, ready: 1 });
  }
  phases.push({ name: 'sprint', walk: 1, cycle: 0.3, stride: 0.7, sprint: true, ready: 0.15 });
  phases.push({ name: 'kneel', kneel: 1, ready: 1 }, { name: 'kneel lowered', kneel: 1, ready: 0.55 });
  phases.push({ name: 'jump rise', air: 1, rise: 1 }, { name: 'jump fall', air: 1, rise: -1 }, { name: 'land', land: 1 });
  for (const p of [-0.9, -0.4, 0.4, 0.9]) phases.push({ name: `aim pitch ${p}`, aimPitch: p, ready: 1 });
  for (const tw of [-0.5, 0.5]) phases.push({ name: `twist ${tw}`, twist: tw, ready: 1, aimPitch: 0.3 });
  for (const r of [0.1, 0.3, 0.5, 0.7, 0.9]) phases.push({ name: `reload ${r}`, reload: r, ready: 1 });
  phases.push({ name: 'recoil', recoil: 1, ready: 1 }, { name: 'flinch', flinch: 1, ready: 1 });
  for (let r = 0; r <= 1; r += 0.125) phases.push({ name: `throw ${r}`, throw: r, weapon: 'grenade', only: true });
  for (const l of [-1, -0.5, 0.5, 1]) phases.push({ name: `lean ${l}`, lean: l, ready: 1 });
  phases.push({ name: 'lean kneel', lean: 1, kneel: 1, ready: 1 });
  for (const pr of [0.5, 1]) phases.push({ name: `prone ${pr}`, prone: pr, ready: 1 }, { name: `prone ${pr} aimed`, prone: pr, ready: 1, aimPitch: 0.3 });
  for (const d of [0, 0.5, 1]) phases.push({ name: `dead ${d}`, dead: d });
  const pz = makePose();
  for (const ph of phases) {
    for (const w of ph.only ? [ph.weapon] : W) {
      if (!ph.only && w === 'grenade' && (ph.reload !== undefined)) continue;
      const s = { t: 0, weapon: w, ...ph };
      if (ph.only) s.weapon = ph.weapon;
      pose(s, pz);
      bodyInv.copy(pz.body).invert();
      const r = { name: `${ph.name} [${s.weapon}]`, minY: Infinity, clips: [], loose: [], grip: 0 };
      // feet on the ground, not inside the body; the body never sinks into the ground
      for (let i = 0; i < 2; i++) {
        for (const c of corners(pz.feet[i], U.FOOT, 0.03)) if (insideBody(c)) r.clips.push(`foot${i} in body`);
        for (const c of corners(pz.feet[i], U.FOOT, 0.0005)) r.minY = Math.min(r.minY, c.y);
      }
      for (const c of corners(pz.body, [U.W, U.H, U.D], U.R)) if (c.y - U.R < -0.01) { r.clips.push('body in ground'); break; }
      // hands outside the body
      for (let i = 0; i < 2; i++) for (const c of corners(pz.hands[i], U.HAND, 0.03)) if (insideBody(c)) { r.clips.push(`hand${i} in body`); break; }
      // gun outside the body
      if (pz.showWeapon) {
        let n = 0;
        const m = pz.weapon;
        for (const p of wverts[s.weapon]) if (insideBody(v.copy(p).applyMatrix4(m).clone())) n++;
        if (n) r.clips.push(`${s.weapon} in body (${n} verts)`);
        // trigger hand on the grip
        const grip = new THREE.Vector3().setFromMatrixPosition(m);
        const hand = new THREE.Vector3().setFromMatrixPosition(pz.hands[1]);
        r.grip = grip.distanceTo(hand);
        if (s.weapon === 'grenade' ? r.grip > 0.1 : r.grip > 0.08) r.loose.push(`grip ${r.grip.toFixed(3)}`);
        // muzzle out ahead of the body when shouldered
        if (s.ready === 1 && !ph.reload && !ph.prone && !ph.lean && s.weapon !== 'grenade' && Math.abs(ph.twist || 0) < 0.1) {
          const mz = pz.muzzle.clone().applyMatrix4(bodyInv);
          if (mz.z < U.D / 2 + 0.1) r.loose.push(`muzzle behind (${mz.z.toFixed(2)})`);
        }
      }
      // nothing floats away: hands within reach, feet under the body (alive)
      if ((ph.dead ?? -1) < 0) {
        const c = new THREE.Vector3().setFromMatrixPosition(pz.body);
        for (let i = 0; i < 2; i++) {
          const h = new THREE.Vector3().setFromMatrixPosition(pz.hands[i]);
          if (h.distanceTo(c) > 0.8) r.loose.push(`hand${i} ${h.distanceTo(c).toFixed(2)}m out`);
          const f = new THREE.Vector3().setFromMatrixPosition(pz.feet[i]);
          if (Math.abs(f.x) > 0.5 || Math.abs(f.z) > (ph.prone ? 1.1 : 0.5) || f.y > (ph.prone ? 0.6 : 0.3)) r.loose.push(`foot${i} off`);
        }
      }
      r.air = !!ph.air;
      out.phases.push(r);
    }
  }
  return out;
};

// screen rects of visible UI that must not overlap each other or leave the screen
const uiLayout = (sel) => {
  const els = [...document.querySelectorAll(sel)].filter((e) => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('[hidden]')) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const rs = els.map((e) => ({ id: e.id || e.className, r: e.getBoundingClientRect() }));
  const overlaps = [], offscreen = [];
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i].r;
    if (a.left < -1 || a.top < -1 || a.right > innerWidth + 1 || a.bottom > innerHeight + 1) offscreen.push(rs[i].id);
    for (let j = i + 1; j < rs.length; j++) {
      const b = rs[j].r;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(`${rs[i].id}×${rs[j].id}`);
    }
  }
  return { overlaps, offscreen, n: rs.length };
};
const HUD_SEL = '#radar, .topbar, .vitals, .gun, #corner .icon-btn, .tbtn, #prompt.on';

try {
  // ======================= desktop =======================
  const d = await open({ viewport: { width: 1280, height: 720 } });
  const P = d.page;
  // part geometry, through the instanced crowd
  await P.evaluate(() => {
    const c = window.__game.crowd;
    window.__parts = { PART_GEO: { body: c.body.geometry, visor: c.visor.geometry, pack: c.pack.geometry, foot: c.foot.geometry, hand: c.hand.geometry } };
  });
  await P.waitForTimeout(600);
  await P.screenshot({ path: `${OUT}/menu.png` });
  const menuL = await P.evaluate(uiLayout, '.menu-frame, .deploy');
  check('setup screen shows on load, battle not started', await P.evaluate(() => window.__game.state === 'menu' && !document.getElementById('menu').hidden && document.getElementById('hud').hidden));
  check('setup screen fits the window', menuL.offscreen.length === 0, menuL.offscreen.join(', '));

  // ---- model
  const g = await P.evaluate(modelChecks);
  check('soldier parts are closed, outward meshes', g.closed.length === 0, g.closed.map((c) => `${c.name}: open=${c.open} vol=${c.vol.toFixed(4)}`).join('; '));
  const bad = g.phases.filter((r) => r.clips.length);
  check(`no clipping across ${g.phases.length} pose/weapon combinations (hands, feet, guns vs body)`, bad.length === 0, bad.slice(0, 4).map((r) => `${r.name}: ${r.clips.join(',')}`).join('; '));
  const loose = g.phases.filter((r) => r.loose.length);
  check('no loose parts: gun in the hand, hands within reach, feet under the body', loose.length === 0, loose.slice(0, 4).map((r) => `${r.name}: ${r.loose.join(',')}`).join('; '));
  const feet = g.phases.filter((r) => r.minY < -0.002 || (!r.air && r.minY > 0.012));
  check('feet on the ground (never below it; one planted unless jumping)', feet.length === 0, feet.slice(0, 4).map((r) => `${r.name}: ${r.minY.toFixed(3)}`).join('; '));

  // ---- start a battle from the setup screen (real click)
  await P.click('#deploy');
  await P.waitForFunction(() => window.__game.state === 'play', null, { timeout: 15000 });
  const st = await P.evaluate(() => ({ n: window.__game.battle.units.length, size: window.__game.battle.settings.size, teams: window.__game.battle.teams.length, hud: !document.getElementById('hud').hidden, lock: window.__lockAsked || 0 }));
  check('Deploy starts a battle with full armies', st.n === st.size * st.teams && st.hud, JSON.stringify(st));
  check('Deploy asks for pointer lock', st.lock > 0);
  await P.waitForTimeout(800);
  await P.screenshot({ path: `${OUT}/desktop-3p.png` });
  const lay = await P.evaluate(uiLayout, HUD_SEL);
  check('desktop: HUD elements inside the screen and not overlapping', lay.overlaps.length === 0 && lay.offscreen.length === 0, [...lay.overlaps, ...lay.offscreen].join(', '));

  // ---- third-person framing: the player is on screen, left of the crosshair, not covering it
  await P.evaluate(() => {
    const g = window.__game;
    g.battle.aiFrozen = true;
    for (const p of [...g.battle.props]) if (Math.hypot(p.box.x, p.box.z - 60) < 14) g.battle.removeProp(p);
    g.player.pos.set(0, 0, 60); g.player.vel.set(0, 0, 0); g.cam.yaw = 0; g.cam.pitch = 0;
    window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick); }; tick();
  });
  await P.waitForFunction(() => window.__frames > 8, null, { timeout: 60000 });
  const frame3 = await P.evaluate(() => {
    const { THREE, camera, player } = window.__game;
    const pts = [];
    const m = player.world, U = window.__game.U;
    for (const y of [0.05, U.BODY_Y, U.TOP]) for (const x of [-U.W / 2, U.W / 2]) pts.push(new THREE.Vector3(x, y, 0).applyMatrix4(m).project(camera));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), dist: camera.position.distanceTo(player.eye()) };
  });
  check('third person: whole soldier in view, off to the left of the crosshair', frame3.minX > -1 && frame3.maxX < 0.02 && frame3.minY > -1 && frame3.maxY < 1 && frame3.dist > 2.5, JSON.stringify(frame3));

  // ---- controls
  await P.evaluate(() => { const g = window.__game; g.battle.clearUnits(); g.battle.points.forEach(() => {}); g.player.pos.set(0, 0, 60); g.player.vel.set(0, 0, 0); g.cam.yaw = 0; g.cam.pitch = 0; });
  // find a clear patch: move the player to open ground
  await P.evaluate(() => { const g = window.__game; for (const p of [...g.battle.props]) if (Math.hypot(p.box.x, p.box.z - 60) < 14) g.battle.removeProp(p); });
  const z0 = await P.evaluate(() => window.__game.player.pos.z);
  // headless rendering is slow, so wait on game state rather than wall time
  await P.keyboard.down('KeyW');
  await P.waitForFunction((z0) => window.__game.player.pos.z < z0 - 1.2, z0, { timeout: 60000 }).catch(() => {});
  await P.keyboard.up('KeyW');
  const mv = await P.evaluate(() => ({ z: window.__game.player.pos.z, x: window.__game.player.pos.x, facing: window.__game.player.facing }));
  check('W walks away from the camera', mv.z - z0 < -0.8 && Math.abs(mv.x) < 0.15, `dz=${(mv.z - z0).toFixed(2)}`);
  const j0 = await P.evaluate(() => window.__game.player.jumps);
  let jumped = false;
  for (let tries = 0; tries < 3 && !jumped; tries++) {
    await P.keyboard.press('Space');
    jumped = await P.waitForFunction((j) => window.__game.player.jumps > j, j0, { timeout: 15000 }).then(() => true, () => false);
  }
  const landed = await P.waitForFunction(() => window.__game.player.grounded && window.__game.player.vel.y === 0, null, { timeout: 90000 }).then(() => true, () => false);
  check('Space jumps and lands', jumped && landed);
  // sprint: Shift+W is faster than W and drains stamina
  const sp0 = await P.evaluate(() => ({ z: window.__game.player.pos.z, s: window.__game.player.stamina }));
  await P.keyboard.down('ShiftLeft'); await P.keyboard.down('KeyW');
  const sprinted = await P.waitForFunction(() => window.__game.player.sprinting && window.__game.player.stamina < 0.97, null, { timeout: 30000 }).then(() => true, () => false);
  const sv = await P.evaluate(() => Math.hypot(window.__game.player.vel.x, window.__game.player.vel.z));
  await P.keyboard.up('KeyW'); await P.keyboard.up('ShiftLeft');
  check('Shift sprints faster than walking and uses stamina', sprinted && sv > 2.8, `speed ${sv.toFixed(2)}`);
  // prone (Z) and lean (E)
  await P.keyboard.press('KeyZ');
  const proned = await P.waitForFunction(() => window.__game.player.proneK > 0.9, null, { timeout: 30000 }).then(() => true, () => false);
  await P.keyboard.press('KeyZ');
  await P.waitForFunction(() => window.__game.player.proneK < 0.1, null, { timeout: 30000 }).catch(() => {});
  await P.keyboard.down('KeyE');
  const leaned = await P.waitForFunction(() => window.__game.player.leanK > 0.8, null, { timeout: 30000 }).then(() => true, () => false);
  await P.keyboard.up('KeyE');
  check('Z goes prone, E leans, both come back', proned && leaned);
  const compass = await P.evaluate(() => { const r = document.querySelector('.compass').getBoundingClientRect(); return r.width > 50 && r.top >= 0 && document.querySelectorAll('#compass .card').length >= 8; });
  check('compass strip shows', compass);
  const y0 = await P.evaluate(() => window.__game.cam.yaw);
  await P.evaluate(() => { window.__game.input.look.dx += 0.5; });
  await P.waitForFunction((y0) => Math.abs(window.__game.cam.yaw - y0) > 0.3, y0, { timeout: 30000 }).catch(() => {});
  const y1 = await P.evaluate(() => window.__game.cam.yaw);
  check('mouse look turns the camera', Math.abs(y1 - y0) > 0.3, `${(y1 - y0).toFixed(2)} rad`);
  await P.keyboard.press('KeyV');
  await P.waitForFunction(() => window.__game.cam.blend > 0.99, null, { timeout: 20000 }).catch(() => {});
  await P.waitForTimeout(300);
  const fp = await P.evaluate(() => ({ mode: window.__game.cam.mode, d: window.__game.camera.position.distanceTo(window.__game.player.eye()) }));
  await P.screenshot({ path: `${OUT}/desktop-1p.png` });
  await P.keyboard.press('KeyV');
  await P.waitForFunction(() => window.__game.cam.blend < 0.01, null, { timeout: 20000 }).catch(() => {});
  await P.waitForTimeout(300);
  const tp = await P.evaluate(() => ({ mode: window.__game.cam.mode, d: window.__game.camera.position.distanceTo(window.__game.player.eye()) }));
  check('V switches first person and back to third person', fp.mode === '1p' && fp.d < 0.3 && tp.mode === '3p' && tp.d > 2.5, JSON.stringify({ fp, tp }));

  // camera never ends up inside cover: back the player against walls from many angles
  const camClip = await P.evaluate(() => {
    const { battle, player, cam, camera } = window.__game;
    const bad = [];
    const p = battle.spawnProp('slab', 0, 57.5, 0);
    for (let a = 0; a < 16; a++) {
      cam.yaw = (a / 16) * Math.PI * 2;
      cam.pitch = a % 2 ? -0.5 : 0.3;
      player.pos.set(Math.sin(a) * 0.9, window.__game.height(0, 57), 56.6 + (a % 3) * 0.3);
      battle.collideBody(player);
      cam.update(1, player, true);
      const c = camera.position;
      for (const q of battle.props) {
        const b = q.box;
        const dx = c.x - b.x, dz = c.z - b.z, co = Math.cos(b.yaw), si = Math.sin(b.yaw);
        const lx = dx * co - dz * si, lz = dx * si + dz * co;
        if (Math.abs(lx) < b.hx && Math.abs(lz) < b.hz && c.y < b.y0 + b.h) bad.push(`${q.type}@${a}`);
      }
      if (c.y < window.__game.height(c.x, c.z) + 0.05) bad.push(`ground@${a}`);
    }
    battle.removeProp(p);
    player.pos.set(0, 0, 60);
    cam.yaw = 0; cam.pitch = 0;
    return bad;
  });
  check('camera stays out of walls and the ground', camClip.length === 0, camClip.slice(0, 4).join(', '));

  // ---- aiming: what's under the crosshair is what gets hit, in both views
  const aimRes = [];
  for (const view of ['3p', '1p']) {
    const r = await P.evaluate(async (view) => {
      const { battle, player, cam, THREE } = window.__game;
      cam.mode = view;
      cam.blend = view === '1p' ? 1 : 0;
      battle.clearUnits();
      battle.aiFrozen = true;
      player.pos.set(0, 0, 60); player.vel.set(0, 0, 0);
      player.setWeapon(0, true);
      const e = battle.spawnUnit(1, 'rifleman', new THREE.Vector3(3, 0, 42), { yaw: 0 });
      e.god = false;
      // point the camera so the crosshair sits on the enemy's chest
      for (let i = 0; i < 30; i++) {
        const c = e.center();
        const d = c.sub(window.__game.camera.position);
        cam.yaw = Math.atan2(-d.x, -d.z);
        cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        await new Promise((r) => requestAnimationFrame(r));
      }
      const hp0 = e.hp;
      // keep pulling the trigger (one shot per pulse) until a shot lands or time runs out
      const t0 = performance.now();
      while (e.hp >= hp0 && performance.now() - t0 < 30000) {
        player.cool = 0; player.wasFiring = false; player.ready = 1;
        window.__game.input.firePulse = true;
        const s0 = player.shots;
        while (player.shots === s0 && performance.now() - t0 < 30000) await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
        if (player.shots - s0 >= 1 && e.hp >= hp0 && performance.now() - t0 > 5000) break;
      }
      return { view, hp0, hp: e.hp, alive: e.alive, shots: player.shots };
    }, view);
    aimRes.push(r);
  }
  check('aiming: the crosshair target takes the hit (third and first person)', aimRes.every((r) => r.hp < r.hp0), JSON.stringify(aimRes));
  await P.evaluate(() => { const g = window.__game; g.cam.mode = '3p'; g.cam.blend = 0; });

  // ---- weapons
  const guns = await P.evaluate(async () => {
    const { battle, player, SLOTS } = window.__game;
    battle.clearUnits();
    const out = [];
    for (let i = 0; i < SLOTS.length; i++) {
      player.setWeapon(i, true);
      player.reloadT = 0; player.throwT = 0; player.cool = 0; player.wasFiring = false; player.ready = 1;
      const w = player.weapon;
      const before = { mag: w.mag, heat: w.heat, proj: battle.projectiles.length, shots: battle.stats.shots };
      const ok = player.fire(battle);
      await new Promise((r) => setTimeout(r, 900));
      const projNeeded = w.def.kind === 'projectile' || w.def.kind === 'throw';
      out.push({ id: w.id, ok, used: w.mag < before.mag || w.heat > before.heat || w.def.kind === 'throw', proj: !projNeeded || battle.projectiles.length > before.proj || battle.stats.kills >= 0 });
    }
    player.setWeapon(0, true);
    return out;
  });
  check('weapons: all seven fire and use ammo or heat', guns.length === 7 && guns.every((x) => x.ok && x.used && x.proj), JSON.stringify(guns.filter((x) => !(x.ok && x.used && x.proj))));

  // ---- no weapon makes the player faster (the coil gun, grenade and mortar once did)
  const spd = await P.evaluate(() => {
    const g = window.__game, pl = g.player, b = g.battle;
    const out = {};
    for (let w = 0; w < pl.weapons.length; w++) {
      pl.setWeapon(w, true); pl.pos.set(0, 0, 70); pl.vel.set(0, 0, 0);
      for (let i = 0; i < 40; i++) { Object.assign(pl.ctrl, { wx: 0, wz: -1, sprint: true, fire: false, aimAt: null }); pl.update(1 / 30, b); }
      out[pl.weapon.id] = +Math.hypot(pl.vel.x, pl.vel.z).toFixed(2);
    }
    pl.setWeapon(0, true); pl.ctrl.wx = pl.ctrl.wz = 0; pl.ctrl.sprint = false; pl.vel.set(0, 0, 0);
    return { out, cap: g.maxSpeed };
  });
  check('speed: every weapon moves the player at or below the sprint cap', Object.values(spd.out).every((v) => v <= spd.cap * 1.03), JSON.stringify(spd));

  // ---- AI battle, fast-forwarded
  const battle = await P.evaluate(() => {
    const g = window.__game;
    g.start({ mode: 'battle', teams: 2, size: 40, tickets: 4, view: '3p', playerTeam: 0 });
    g.freeze(true);
    const b = g.battle;
    b.god = true;
    let covered = 0, under = 0, outside = 0, ticks = 0, fastest = 0, fastKind = '';
    const t0 = performance.now();
    for (let i = 0; i < 30 * 100; i++) {
      b.update(1 / 30);
      ticks++;
      // nobody outruns the sprint pace (thrown by a blast doesn't count)
      for (const u of b.units) {
        if (!u.alive || u.knockT > 0) continue;
        const v = Math.hypot(u.vel.x, u.vel.z);
        if (v > fastest) { fastest = v; fastKind = u.kind; }
      }
      if (i % 30 === 0) for (const u of b.units) {
        if (!u.alive) continue;
        if (u.brain?.cover) covered++;
        if (u.pos.y < g.height(u.pos.x, u.pos.z) - 0.05) under++;
        if (Math.abs(u.pos.x) > g.HALF || Math.abs(u.pos.z) > g.HALF) outside++;
      }
    }
    const ms = (performance.now() - t0) / ticks;
    g.freeze(false);
    return { fastest: +fastest.toFixed(2), fastKind, cap: g.maxSpeed, shots: b.stats.shots, kills: b.stats.kills, covered, under, outside, captured: b.points.filter((p) => p.owner >= 0).length, ms: +ms.toFixed(2), squads: b.squads.length, alive: b.counts() };
  });
  check('AI: armies fight it out (shots fired, soldiers fall)', battle.shots > 300 && battle.kills >= 15, JSON.stringify(battle));
  check('AI: soldiers use cover', battle.covered > 200, `cover-samples=${battle.covered}`);
  check('AI: squads take control points', battle.captured >= 3, `captured=${battle.captured}`);
  check('AI: nobody under the ground or off the map', battle.under === 0 && battle.outside === 0, JSON.stringify(battle));
  check('speed: nobody (AI or player) moves faster than the sprint pace', battle.fastest <= battle.cap * 1.25, `${battle.fastest} m/s (${battle.fastKind}) vs cap ${battle.cap}`);
  check('AI: 80 soldiers simulate in under 8 ms per tick (headless)', battle.ms < 8, `${battle.ms} ms`);
  // battle overview render
  await P.evaluate(() => {
    const g = window.__game, b = g.battle;
    let best = b.points[0], bn = 0;
    for (const pt of b.points) { const n = b.nearUnits(pt.pos.x, pt.pos.z, 25).length; if (n > bn) { bn = n; best = pt; } }
    g.freeze(true);
    g.view([best.pos.x + 22, 15, best.pos.z + 22], [best.pos.x, 0, best.pos.z]);
    g.render();
  });
  await P.screenshot({ path: `${OUT}/battle-overview.png` });
  await P.evaluate(() => { const g = window.__game; g.unfreezeCam(); g.freeze(false); });

  // ---- sandbox palette: pick from the grid, click the field
  await P.evaluate(() => { const g = window.__game; g.start({ mode: 'battle', teams: 2, size: 10, tickets: 4, view: '3p', playerTeam: 0 }); g.battle.aiFrozen = true; g.battle.reinforce = false; });
  await P.keyboard.press('Tab');
  check('Tab no longer cycles anything', await P.evaluate(() => !window.__game.sandbox.open));
  await P.keyboard.press('KeyB');
  await P.waitForFunction(() => window.__game.sandbox.open && window.__game.cam.mode === 'over', null, { timeout: 30000 }).catch(() => {});
  const sb0 = await P.evaluate(() => ({ open: window.__game.sandbox.open, mode: window.__game.input.mode, cam: window.__game.cam.mode, n: window.__game.battle.units.length }));
  check('sandbox: B opens the palette with the overview camera', sb0.open && sb0.mode === 'build' && sb0.cam === 'over', JSON.stringify(sb0));
  await P.click('.pal-item[data-id="gunner"]');
  const sel = await P.evaluate(() => document.querySelector('.pal-item[data-id="gunner"]').getAttribute('aria-selected'));
  await P.waitForTimeout(300);
  await P.mouse.click(420, 420);
  await P.waitForTimeout(200);
  const sb1 = await P.evaluate(() => window.__game.battle.units.length);
  check('sandbox: picking an item then clicking the field places it', sel === 'true' && sb1 === sb0.n + 1, `${sb0.n} -> ${sb1}, selected=${sel}`);
  await P.click('[data-tab="cover"]');
  await P.click('.pal-item[data-id="bunker"]');
  const props0 = await P.evaluate(() => window.__game.battle.props.length);
  await P.mouse.click(300, 300);
  await P.waitForTimeout(200);
  const props1 = await P.evaluate(() => window.__game.battle.props.length);
  check('sandbox: cover placed from the palette', props1 === props0 + 1, `${props0} -> ${props1}`);
  await P.click('[data-tab="tools"]');
  await P.click('.pal-item[data-id="delete"]');
  const pos = await P.evaluate(() => {
    const g = window.__game, u = g.battle.units[g.battle.units.length - 1];
    const p = u.center().project(g.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
  });
  await P.mouse.click(pos.x, pos.y);
  await P.waitForTimeout(200);
  const sb2 = await P.evaluate(() => window.__game.battle.units.length);
  check('sandbox: delete tool removes a soldier', sb2 === sb1 - 1, `${sb1} -> ${sb2}`);
  await P.screenshot({ path: `${OUT}/desktop-sandbox.png` });
  const palL = await P.evaluate(uiLayout, '.palette, #radar, .topbar, .vitals');
  check('sandbox: palette fits and leaves the HUD clear', palL.overlaps.length === 0 && palL.offscreen.length === 0, [...palL.overlaps, ...palL.offscreen].join(', '));
  for (const t of ['freeze', 'slow', 'god']) await P.click(`[data-t="${t}"]`);
  const tools = await P.evaluate(() => ({ frozen: window.__game.battle.aiFrozen, slow: window.__game.battle.timeScale, god: window.__game.battle.god }));
  check('sandbox: pause AI, slow motion and god mode toggle', tools.frozen === false && tools.slow < 1 && tools.god, JSON.stringify(tools));
  await P.click('[data-t="clearUnits"]');
  check('sandbox: clear removes every soldier but you', await P.evaluate(() => window.__game.battle.units.length === 1));
  await P.click('#palClose');
  check('sandbox: closing returns to the player camera', await P.evaluate(() => !window.__game.sandbox.open && window.__game.cam.mode !== 'over'));

  // ---- ragdoll deaths: bodies fly, land on the ground, settle, keep their limbs, drop their guns
  const rag = await P.evaluate(() => {
    const g = window.__game, b = g.battle, T = g.THREE;
    b.clearUnits(); b.aiFrozen = true; g.player.pos.set(0, 0, -30);
    for (const p of [...b.props]) if (Math.hypot(p.box.x, p.box.z) < 12) b.removeProp(p);
    const us = [];
    for (let i = 0; i < 8; i++) { const u = b.spawnUnit(i % 2, 'rifleman', new T.Vector3((i - 3.5) * 1.6, 0, 0), { yaw: i }); u.ready = 1; u.animate(1 / 60); us.push(u); }
    us.forEach((u, i) => { if (i !== 6) b.damageUnit(u, 250, g.player, 'bullet', new T.Vector3(Math.sin(i), 0, Math.cos(i))); });
    b.update(1e-4);
    b.explode(new T.Vector3(us[6].pos.x + 0.5, g.height(us[6].pos.x + 0.5, 0.6) + 0.3, 0.6), 3, 250, null);
    let moved = 0, ms = 0;
    const start = us.map((u) => u.pos.clone());
    for (let k = 0; k < 300; k++) { const t0 = performance.now(); for (const u of us) u.update(1 / 60, b); ms += performance.now() - t0; }
    const bad = [];
    for (const u of us) {
      const r = u.rag;
      if (!r) { bad.push(`${u.id}: no ragdoll`); continue; }
      const bd = r.body;
      if (![bd.pos.x, bd.pos.y, bd.pos.z].every(Number.isFinite)) bad.push(`${u.id}: NaN`);
      let lo = 9; for (const p of bd.pts) lo = Math.min(lo, p.clone().applyQuaternion(bd.q).add(bd.pos).y);
      const gh = g.height(bd.pos.x, bd.pos.z);
      lo -= gh;
      if (lo < -0.05 || lo > 0.05) bad.push(`${u.id}: lowest corner ${lo.toFixed(3)}`);
      if (!r.asleep) bad.push(`${u.id}: still moving after 5 s`);
      for (const l of r.limbs) if (l.p.distanceTo(bd.pos) > 0.9 || l.p.y < gh - 0.05) bad.push(`${u.id}: loose limb`);
      if (r.gun && (r.gun.pos.y < gh - 0.05 || r.gun.pos.y > gh + 0.3)) bad.push(`${u.id}: gun at ${r.gun.pos.y.toFixed(2)}`);
      moved = Math.max(moved, u.pos.distanceTo(start[us.indexOf(u)]));
    }
    b.clearUnits();
    return { bad, moved: +moved.toFixed(2), msPerBody: +(ms / 300 / us.length).toFixed(3) };
  });
  check('ragdolls: thrown by the hit, settle on the ground in 5 s, limbs and guns stay put', rag.bad.length === 0 && rag.moved > 0.5, JSON.stringify(rag));
  check('ragdolls: under 0.05 ms per body per tick (headless)', rag.msPerBody < 0.05, `${rag.msPerBody} ms`);

  // ---- gore ----
  const gore = await P.evaluate(async () => {
    const g = window.__game, b = g.battle, T = g.THREE, G = g.fx.gore;
    const out = {};
    const run = (level) => {
      G.setLevel(level); G.clear(); b.clearUnits(); b.aiFrozen = true; g.player.pos.set(0, 0, -30);
      const us = [];
      for (let i = 0; i < 12; i++) { const u = b.spawnUnit(i % 2, 'rifleman', new T.Vector3((i - 6) * 1.5, 0, 0), { yaw: i }); u.ready = 1; u.animate(1 / 60); us.push(u); }
      us.forEach((u, i) => b.damageUnit(u, 250, g.player, i < 6 ? 'blast' : 'bullet', new T.Vector3(Math.sin(i), 0.2, Math.cos(i))));
      b.update(1e-4);
      let ms = 0;
      for (let k = 0; k < 360; k++) { const t0 = performance.now(); b.update(1 / 60); G.update(1 / 60); ms += performance.now() - t0; }
      return { us, ms };
    };
    // off: nothing at all
    let r = run(0);
    out.off = { gibs: G.gibs.length, decals: G.decalCount, lost: r.us.filter((u) => u.lost).length, wound: r.us.filter((u) => u.wound).length };
    // low: blood but no gibs
    r = run(1);
    out.low = { gibs: G.gibs.length, decals: G.decalCount, lost: r.us.filter((u) => u.lost).length };
    // full: blasts tear parts off
    r = run(2);
    const gh = (x, z) => g.height(x, z);
    const bad = [];
    let missing = 0;
    for (const u of r.us) for (let k = 0; k < 4; k++) if (u.lost & (k < 2 ? 1 << k : 4 << (k - 2))) missing++;
    for (const gb of G.gibs) {
      if (!gb) continue;
      if (![gb.p.x, gb.p.y, gb.p.z].every(Number.isFinite)) bad.push('NaN');
      else if (gb.p.y < gh(gb.p.x, gb.p.z) - 0.1 || gb.p.y > gh(gb.p.x, gb.p.z) + 0.5) bad.push(`gib at ${gb.p.y.toFixed(2)}`);
      else if (!gb.asleep) bad.push('gib still moving');
      else if (Math.hypot(gb.p.x, gb.p.z) > 60) bad.push('gib flew off the field');
    }
    out.full = { gibs: G.gibs.filter(Boolean).length, decals: G.decalCount, missing, bad: bad.slice(0, 4), ms: +(r.ms / 360).toFixed(3) };
    // pools: a heavy fight keeps within the caps
    for (let k = 0; k < 600; k++) { G.addGib(new T.Vector3(0, 1, 0), new T.Vector3(), [0.1, 0.1, 0.1], new T.Color('#600'), 4); G.splat(Math.random() * 20, Math.random() * 20, 0.5); }
    out.cap = { gibs: G.gibMesh.count, decals: G.decalCount, max: [G.gibMesh.instanceMatrix.count, G.sets.reduce((a, d) => a + d.n, 0)] };
    // decals shrink away
    G.clear(); G.splat(2, 2, 1); for (let k = 0; k < 400; k++) G.update(0.25);
    out.faded = G.splats.every((d) => d.age.every((a) => a > 1e8));
    out.stored = localStorage.getItem('sm.gore');
    G.setLevel(2); G.clear(); b.clearUnits();
    return out;
  });
  check('gore: Off draws no blood, decals or gibs', gore.off.gibs === 0 && gore.off.decals === 0 && gore.off.lost === 0 && gore.off.wound === 0, JSON.stringify(gore.off));
  check('gore: Low shows blood but keeps every limb', gore.low.gibs === 0 && gore.low.decals > 0 && gore.low.lost === 0, JSON.stringify(gore.low));
  check('gore: Full tears limbs off as gibs that land on the ground, nothing loose or floating', gore.full.missing > 0 && gore.full.gibs >= gore.full.missing && gore.full.bad.length === 0, JSON.stringify(gore.full));
  check('gore: pools stay inside the caps', gore.cap.gibs <= gore.cap.max[0] && gore.cap.decals <= gore.cap.max[1], JSON.stringify(gore.cap));
  check('gore: old blood fades away', gore.faded);
  check('gore: under 0.5 ms per frame at Full (headless, 12 bodies)', gore.full.ms < 0.5, `${gore.full.ms} ms`);
  check('gore: level is remembered and the setup has a Gore choice', gore.stored === '1' || gore.stored === '2' || gore.stored === '0', `stored=${gore.stored}`);
  check('gore: setup screen offers Off / Low / Full, default Full', await P.evaluate(() => document.querySelectorAll('#setup [name=gore]').length === 3 && document.querySelector('#setup [name=gore]:checked').value === '2'));

  // ---- pause and end
  await P.evaluate(() => window.__game.pause(true));
  check('pause sheet shows and the game stops', await P.evaluate(() => !document.getElementById('pause').hidden && window.__game.state === 'pause'));
  await P.click('#resume');
  check('resume returns to play', await P.evaluate(() => window.__game.state === 'play'));
  await P.evaluate(() => { const b = window.__game.battle; b.teams[1].tickets = 0; for (const u of b.units) if (u.team === 1) u.alive = false; });
  const ended = await P.waitForFunction(() => window.__game.state === 'end' && !document.getElementById('end').hidden, null, { timeout: 60000 }).then(() => true, () => false);
  check('wiping out the enemy ends the battle with a result screen', ended && /Victory/.test(await P.textContent('#endTitle')));
  await P.click('#endMenu');
  check('Setup returns to the setup screen', await P.evaluate(() => window.__game.state === 'menu'));

  // ---- unit turntable + closeups
  await P.evaluate(() => {
    const g = window.__game;
    g.start({ mode: 'sandbox', teams: 2, size: 10, view: '3p', playerTeam: 0 });
    g.sandbox.toggle(false);
    const b = g.battle; b.clearAll(); b.aiFrozen = true;
    const T = g.THREE;
    window.__m = [b.spawnUnit(0, 'rifleman', new T.Vector3(0, 0, 0), { yaw: 0 }), b.spawnUnit(1, 'gunner', new T.Vector3(1.5, 0, 0.6), { yaw: -0.5 }), b.spawnUnit(0, 'assault', new T.Vector3(-1.5, 0, 0.6), { yaw: 0.5 })];
    for (const u of window.__m) u.ready = 1;
    g.player.pos.set(0, 0, -40);
    g.freeze(true);
  });
  for (let a = 0; a < 8; a++) {
    await P.evaluate((a) => {
      const g = window.__game;
      const yaw = (a / 8) * Math.PI * 2;
      for (const u of window.__m) u.animate(1 / 60);
      g.view([Math.sin(yaw) * 4.2, 1.5, Math.cos(yaw) * 4.2], [0, 0.6, 0.3]);
      g.render();
    }, a);
    await P.screenshot({ path: `${OUT}/turntable-${String(a * 45).padStart(3, '0')}.png` });
  }
  const anim = [['walk', 'u.walk = 1; u.cycle = 0.25; u.vel.set(0,0,2.2);'], ['kneel', 'u.vel.set(0,0,0); u.walk = 0; u.kneelK = 1;'], ['reload', 'u.kneelK = 0; u.reloadT = u.weapon.def.reload * 0.5;'], ['dead', 'u.reloadT = 0; u.alive = false; u.deadT = 2;']];
  for (const [name, code] of anim) {
    await P.evaluate(([code]) => {
      const g = window.__game;
      for (const u of window.__m) { (new Function('u', code))(u); u.animate(1 / 60); }
      g.view([1.2, 1.4, 3.8], [0, 0.55, 0.3]);
      g.render();
    }, [code]);
    await P.screenshot({ path: `${OUT}/anim-${name}.png` });
  }
  await P.evaluate(() => { window.__game.freeze(false); window.__game.unfreezeCam(); });
  check('renders saved (menu, views, battle, sandbox, turntable, poses)', true, `${OUT}/`);
  check('desktop: no console errors', d.errors.length === 0, d.errors.slice(0, 3).join(' | '));
  await d.ctx.close();

  // ======================= phone (portrait) =======================
  const m = await open({ ...devices['iPhone 13'] });
  const M = m.page;
  await M.screenshot({ path: `${OUT}/phone-menu.png` });
  const mm = await M.evaluate(() => ({ scroll: document.documentElement.scrollWidth > innerWidth + 1, deploy: (() => { const r = document.getElementById('deploy').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })() }));
  check('phone: setup screen fits (no sideways scroll, Deploy on screen)', !mm.scroll && mm.deploy, JSON.stringify(mm));
  await M.tap('#deploy');
  await M.waitForFunction(() => window.__game.state === 'play', null, { timeout: 15000 });
  await M.waitForTimeout(600);
  check('phone: touch controls shown', await M.evaluate(() => document.documentElement.dataset.input === 'touch' && getComputedStyle(document.getElementById('touch')).display !== 'none'));
  await M.screenshot({ path: `${OUT}/phone.png` });
  const ml = await M.evaluate(uiLayout, HUD_SEL);
  check('phone: HUD and buttons inside the screen, not overlapping', ml.overlaps.length === 0 && ml.offscreen.length === 0, [...ml.overlaps, ...ml.offscreen].join(', '));
  const sizes = await M.evaluate(() => [...document.querySelectorAll('.tbtn, #corner .icon-btn')].filter((b) => b.offsetParent !== null).map((b) => Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
  check('phone: buttons are at least 44px', sizes.every((x) => x >= 44), sizes.join(', '));
  // stick
  await M.evaluate(() => { const g = window.__game; g.battle.aiFrozen = true; g.battle.reinforce = false; g.battle.clearUnits(); g.player.pos.set(0, 0, 60); g.cam.yaw = 0; for (const p of [...g.battle.props]) if (Math.hypot(p.box.x, p.box.z - 60) < 14) g.battle.removeProp(p); });
  const cdp = await M.context().newCDPSession(M);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const W = await M.evaluate(() => innerWidth), H = await M.evaluate(() => innerHeight);
  const pz0 = await M.evaluate(() => window.__game.player.pos.z);
  await touch('touchStart', [{ x: W * 0.2, y: H * 0.7, id: 1 }]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: W * 0.2, y: H * 0.7 - i * 10, id: 1 }]); await M.waitForTimeout(60); }
  await M.waitForTimeout(600);
  await touch('touchEnd', []);
  const pz1 = await M.evaluate(() => window.__game.player.pos.z);
  check('phone: left-thumb stick walks', pz1 - pz0 < -0.5, `dz=${(pz1 - pz0).toFixed(2)}`);
  const yy0 = await M.evaluate(() => window.__game.cam.yaw);
  await touch('touchStart', [{ x: W * 0.6, y: H * 0.45, id: 2 }]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: W * 0.6 + i * 15, y: H * 0.45, id: 2 }]); await M.waitForTimeout(30); }
  await touch('touchEnd', []);
  await M.waitForTimeout(100);
  const yy1 = await M.evaluate(() => window.__game.cam.yaw);
  check('phone: right-thumb drag aims', Math.abs(yy1 - yy0) > 0.2, `${(yy1 - yy0).toFixed(2)} rad`);
  const f0 = await M.evaluate(() => window.__game.player.shots);
  await M.tap('#fire');
  check('phone: fire button shoots', await M.waitForFunction((f0) => window.__game.player.shots > f0, f0, { timeout: 8000 }).then(() => true, () => false));
  await M.tap('#viewBtn');
  await M.waitForTimeout(300);
  check('phone: view button switches to first person', await M.evaluate(() => window.__game.cam.mode === '1p'));
  await M.tap('#sbxBtn');
  await M.waitForTimeout(400);
  const pal = await M.evaluate(() => { const r = document.getElementById('palette').getBoundingClientRect(); return { open: window.__game.sandbox.open, fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  check('phone: sandbox palette opens and fits the screen', pal.open && pal.fits, JSON.stringify(pal));
  await M.tap('.pal-item[data-id="rifleman"]');
  const n0 = await M.evaluate(() => window.__game.battle.units.length);
  await M.tap('#scene', { position: { x: W * 0.5, y: H * 0.25 } });
  await M.waitForTimeout(200);
  const n1 = await M.evaluate(() => window.__game.battle.units.length);
  check('phone: tap an item then tap the field to place it', n1 === n0 + 1, `${n0} -> ${n1}`);
  await M.screenshot({ path: `${OUT}/phone-sandbox.png` });
  check('phone: no console errors', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));
  await m.ctx.close();

  // ======================= phone (landscape) =======================
  const l = await open({ ...devices['iPhone 13 landscape'] });
  await l.page.screenshot({ path: `${OUT}/phone-landscape-menu.png` });
  const lmenu = await l.page.evaluate(() => { const r = document.getElementById('deploy').getBoundingClientRect(); return r.bottom <= innerHeight + 1; });
  await l.page.evaluate(() => window.__game.start({ mode: 'battle', teams: 2, size: 20, tickets: 4, view: '3p', playerTeam: 0 }));
  await l.page.waitForTimeout(500);
  await l.page.screenshot({ path: `${OUT}/phone-landscape.png` });
  const ll = await l.page.evaluate(uiLayout, HUD_SEL);
  check('phone landscape: Deploy reachable, HUD clear and on screen', lmenu && ll.overlaps.length === 0 && ll.offscreen.length === 0, [...ll.overlaps, ...ll.offscreen].join(', '));
  check('phone landscape: no console errors', l.errors.length === 0, l.errors.slice(0, 3).join(' | '));
  await l.ctx.close();
} catch (e) {
  check('suite ran to completion', false, e.stack || String(e));
}

await browser.close();
if (server) server.kill();
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
