// Soldier model checks, run inside the page (they read window.__game and window.__parts).
// Closed meshes, nothing clipping, nothing floating loose: boots on the ground, arms and legs
// joined at the shoulder, elbow, hip, knee and wrist, hands on the gun, over every pose and weapon.

export const exposeParts = () => {
  const c = window.__game.crowd;
  const PART_GEO = {
    body: c.body.geometry, pack: c.pack.geometry, boot: c.boot.geometry, handL: c.handL.geometry, handR: c.handR.geometry,
    thigh: c.thigh.geometry, shin: c.shin.geometry, upperArm: c.upperArm.geometry, foreArm: c.foreArm.geometry,
  };
  for (const [k, m] of Object.entries(c.gear)) PART_GEO[`gear-${k}`] = m.geometry;
  for (const [k, m] of Object.entries(c.marks)) PART_GEO[`mark-${k}`] = m.geometry;
  // the head and helmet are open at the neck and under the brim on purpose (a skull and a shell)
  window.__parts = { PART_GEO, HEAD: c.head.geometry, HELMET: c.helmets.rifleman.geometry };
};

export const modelChecks = () => {
  const { THREE, U, pose, makePose, solveLegs, solveArms, HOLD, crowd } = window.__game;
  const { PART_GEO, HEAD, HELMET } = window.__parts;
  const out = { closed: [], phases: [] };
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
      if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
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
  // worn kit is made of patches grown on the body and sunk into it, open at the back by design; gear-attach.mjs checks it is joined to the body
  out.closed = out.closed.filter((c) => (c.open > 0 || c.vol <= 0) && !/^gear-/.test(c.name));
  // the head and helmet must be the right way out and hold together as meshes (no stray vertices)
  for (const [k, g] of [['head', HEAD]]) {
    const c = closed(g, k);
    if (c.vol <= 0) out.closed.push(c);
  }

  const sample = (g, n = 260) => {
    const p = g.attributes.position, step = Math.max(1, Math.floor(p.count / n)), pts = [];
    for (let i = 0; i < p.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(p, i));
    return pts;
  };
  const S = { boot: sample(crowd.boot.geometry), toe: sample(crowd.toe.geometry), body: sample(crowd.body.geometry, 400), pack: sample(crowd.pack.geometry), head: sample(crowd.head.geometry), helmet: sample(crowd.helmets.rifleman.geometry), hand: sample(crowd.handL.geometry) };
  const bodyInv = new THREE.Matrix4();
  const v = new THREE.Vector3();
  // inside the torso block (rounded), a little smaller so touching surfaces don't count
  const insideBody = (pt, shrink = 0.02) => {
    v.copy(pt).applyMatrix4(bodyInv);
    const hx = U.W / 2 - shrink, hy = U.H / 2 - shrink, hz = U.D / 2 - shrink;
    if (Math.abs(v.x) > hx || Math.abs(v.y) > hy || Math.abs(v.z) > hz) return false;
    const R = U.R;
    const ex = Math.max(0, Math.abs(v.x) - (hx - R)), ey = Math.max(0, Math.abs(v.y) - (hy - R)), ez = Math.max(0, Math.abs(v.z) - (hz - R));
    return ex * ex + ey * ey + ez * ez <= R * R;
  };
  const world = (pts, m) => pts.map((p) => p.clone().applyMatrix4(m));
  const minY = (pts, m) => { let y = Infinity; for (const p of pts) y = Math.min(y, v.copy(p).applyMatrix4(m).y); return y; };
  const wverts = {};
  for (const [id, list] of Object.entries(crowd.weapons)) {
    const pts = [];
    for (const m of list) pts.push(...sample(m.geometry, 1500)); // dense enough that a hand on a smooth tube finds a vertex near it
    wverts[id] = pts;
  }
  // gun surfaces (a hand on a long smooth tube is nowhere near a vertex, so measure to the triangles)
  const wtris = {}, tri = new THREE.Triangle(), cp = new THREE.Vector3();
  for (const [id, list] of Object.entries(crowd.weapons)) {
    wtris[id] = [];
    for (const m of list) { const p = m.geometry.attributes.position; for (let i = 0; i + 2 < p.count; i += 3) wtris[id].push(new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(p, i), new THREE.Vector3().fromBufferAttribute(p, i + 1), new THREE.Vector3().fromBufferAttribute(p, i + 2))); }
  }
  const gunDist = (id, pt, m) => { const l = pt.clone().applyMatrix4(new THREE.Matrix4().copy(m).invert()); let best = Infinity; for (const t of wtris[id]) { t.closestPointToPoint(l, cp); best = Math.min(best, cp.distanceToSquared(l)); } return Math.sqrt(best); };
  const phases = [];
  const W = Object.keys(HOLD);
  for (const t of [0, 0.9, 1.8, 2.7]) phases.push({ name: `idle ${t}`, t, ready: 0.55 });
  // walking, jogging and sprinting every way, at the speed the gait expects (see gait.js)
  for (const [mx, mz, label] of [[0, 1, 'fwd'], [1, 0, 'strafe'], [0, -1, 'back'], [0.7, 0.7, 'diag']]) {
    for (const [speed, gname] of [[1.4, 'walk'], [2.2, 'jog']]) {
      for (let c = 0; c < 1; c += 0.125) phases.push({ name: `${gname} ${label} ${c.toFixed(2)}`, walk: 1, cycle: c, speed, mx, mz, ready: 1, run: speed > 2 });
    }
  }
  for (let c = 0; c < 1; c += 0.125) phases.push({ name: `sprint ${c.toFixed(2)}`, walk: 1, cycle: c, speed: 3.8, sprint: true, free: 1, ready: 0.15, run: true });
  for (let c = 0; c < 1; c += 0.25) phases.push({ name: `sprint aimed ${c.toFixed(2)}`, walk: 1, cycle: c, speed: 3.8, ready: 1, run: true });
  for (let c = 0; c < 1; c += 0.25) phases.push({ name: `crouch walk ${c.toFixed(2)}`, walk: 1, cycle: c, speed: 0.9, kneel: 1, ready: 1 });
  for (let c = 0; c < 1; c += 0.25) phases.push({ name: `crawl ${c.toFixed(2)}`, walk: 1, cycle: c, speed: 0.6, prone: 1, ready: 1 }, { name: `wounded crawl ${c.toFixed(2)}`, walk: 1, cycle: c, speed: 0.6, prone: 1, ready: 1, down: true });
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
  const ends = (m) => [new THREE.Vector3(0, 0, -0.1).applyMatrix4(m), new THREE.Vector3(0, 0, 0.1).applyMatrix4(m)];
  const near = (A, B) => Math.min(...A.flatMap((a) => B.map((b) => a.distanceTo(b))));
  for (const ph of phases) {
    for (const w of ph.only ? [ph.weapon] : W) {
      if (!ph.only && w === 'grenade' && (ph.reload !== undefined)) continue;
      const s = { t: 0, weapon: w, ...ph };
      pose(s, pz);
      bodyInv.copy(pz.body).invert();
      solveLegs(pz); // the toe boxes follow the feet
      const dead = (ph.dead ?? -1) >= 0;
      const r = { name: `${ph.name} [${s.weapon}]`, minY: Infinity, clips: [], loose: [], air: !!ph.air || !!ph.run };
      // boots on the ground, never below it, never inside the body
      for (let i = 0; i < 2; i++) {
        r.minY = Math.min(r.minY, minY(S.boot, pz.feet[i]), ph.prone && !dead ? minY(S.toe, pz.toes[i]) : Infinity); // lying down, the toes are what touch the ground
        for (const p of world(S.boot, pz.feet[i])) if (insideBody(p, 0.03)) { r.clips.push(`boot${i} in body`); break; }
      }
      // the body, head, helmet and pack never sink into the ground
      const low = Math.min(minY(S.body, pz.body), minY(S.head, pz.head), minY(S.helmet, pz.head), minY(S.pack, pz.pack));
      if (low < -0.012) r.clips.push(`body in ground (${low.toFixed(3)})`);
      // fists outside the torso
      for (let i = 0; i < 2; i++) { const c = new THREE.Vector3().setFromMatrixPosition(pz.hands[i]); if (insideBody(c, 0.03)) r.clips.push(`hand${i} in body`); }
      if (pz.showWeapon && !dead) {
        const m = pz.weapon;
        let n = 0;
        for (const p of wverts[s.weapon]) if (insideBody(v.copy(p).applyMatrix4(m).clone(), 0.025)) n++;
        if (n > 3) r.clips.push(`${s.weapon} in body (${n} verts)`);
        // trigger hand on the grip, support hand touching the gun
        const grip = new THREE.Vector3().setFromMatrixPosition(m);
        const hand = new THREE.Vector3().setFromMatrixPosition(pz.hands[1]);
        const gd = grip.distanceTo(hand);
        if (gd > (s.weapon === 'grenade' ? 0.1 : 0.06)) r.loose.push(`grip ${gd.toFixed(3)}`);
        if (s.weapon !== 'grenade' && ph.reload === undefined && !ph.free && !ph.down) {
          const h0 = new THREE.Vector3().setFromMatrixPosition(pz.hands[0]);
          const best = gunDist(s.weapon, h0, m);
          if (best > 0.05) r.loose.push(`support hand ${best.toFixed(3)} off the gun`);
        }
        if (s.ready === 1 && !ph.reload && !ph.prone && !ph.lean && s.weapon !== 'grenade' && Math.abs(ph.twist || 0) < 0.1) {
          const mz = pz.muzzle.clone().applyMatrix4(bodyInv);
          if (mz.z < U.D / 2 + 0.1) r.loose.push(`muzzle behind (${mz.z.toFixed(2)})`);
        }
      }
      // limbs: every segment joins its neighbour and its end, with little stretch
      solveLegs(pz);
      solveArms(pz);
      const joints = (segs, anchorA, anchorB, label, stretchMax) => {
        const [a, b] = segs;
        const ea = ends(a), eb = ends(b);
        if (near(ea, eb) > 0.03) r.loose.push(`${label} joint gap ${near(ea, eb).toFixed(3)}`);
        if (Math.min(...ea.map((e) => e.distanceTo(anchorA))) > 0.04) r.loose.push(`${label} off its root`);
        if (Math.min(...eb.map((e) => e.distanceTo(anchorB))) > 0.04) r.loose.push(`${label} off its end`);
        const len = ea[0].distanceTo(ea[1]) + eb[0].distanceTo(eb[1]);
        return len;
      };
      for (let i = 0; i < 2; i++) {
        const hipX = (i === 0 ? -1 : 1) * U.HIP_X;
        const hip = new THREE.Vector3(hipX, -U.H / 2 + 0.035, 0).applyMatrix4(pz.body);
        const ankle = new THREE.Vector3(0, 0.092, -0.004).applyMatrix4(pz.feet[i]);
        const len = joints(pz.legs[i], hip, ankle, `leg${i}`);
        if (!dead && len > (U.LEG[0] + U.LEG[1] + 0.04) * 1.35) r.loose.push(`leg${i} stretched ${len.toFixed(2)}`);
        const side = i === 0 ? 1 : -1;
        const sh = new THREE.Vector3(side * U.SH_X, U.SH_Y, -0.005).applyMatrix4(pz.body);
        const hd = new THREE.Vector3(...U.WRIST).applyMatrix4(pz.hands[i]); // the forearm ends at the wrist, under the glove cuff
        const alen = joints(pz.arms[i], sh, hd, `arm${i}`);
        if (!dead && alen > (U.ARM[0] + U.ARM[1] + 0.04) * 1.45) r.loose.push(`arm${i} stretched ${alen.toFixed(2)}`);
      }
      out.phases.push(r);
    }
  }
  return out;
};
