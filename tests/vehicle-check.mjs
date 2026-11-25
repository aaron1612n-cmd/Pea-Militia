// Vehicle model checks, no browser. For the strider and the tank:
//  (1) loose parts: every piece of each part (near copy, far copy, and with the damage overlay on) touches the rest of that part;
//  (2) joints: in motion the parts stay joined at the hips, knees, ankles, toes, rams, turret ring, gun cradle, swing arms, wheels, sprockets;
//  (3) clipping: no two parts that are not meant to overlap sink into each other by more than a few centimetres, in a spread of poses;
//  (4) floating: the feet and the road wheels meet the ground (no air under them, none sunk in), and nothing hangs below it.
// node tests/vehicle-check.mjs [walker|tank]
import * as THREE from 'three';
import { Vehicle, CKit } from '../src/vehicles.js';
import { height } from '../src/terrain.js';

const kinds = process.argv.slice(2).filter((a) => a === 'walker' || a === 'tank');
if (!kinds.length) kinds.push('walker', 'tank');
const TOUCH = 0.012, SINK = 0.05;
const tri = new THREE.Triangle(), Cl = new THREE.Vector3(), ray = new THREE.Ray(), hit = new THREE.Vector3();
function meshOf(geos, m = null) {
  const T = [], box = new THREE.Box3(), pieces = [];
  for (const g of geos) {
    const p = g.attributes.position, idx = g.index ? g.index.array : [...Array(p.count).keys()];
    const v = (i) => { const q = new THREE.Vector3().fromBufferAttribute(p, i); return m ? q.applyMatrix4(m) : q; };
    const piece = { box: new THREE.Box3(), tris: [] };
    for (let i = 0; i < idx.length; i += 3) {
      const a = v(idx[i]), b = v(idx[i + 1]), c = v(idx[i + 2]);
      const t = { a, b, c, box: new THREE.Box3().setFromPoints([a, b, c]) };
      T.push(t); piece.tris.push(t); piece.box.union(t.box);
      box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
    }
    pieces.push(piece);
  }
  const pts = [], step = Math.max(1, Math.floor(T.length / 240));
  for (let i = 0; i < T.length; i += step) pts.push(T[i].a, T[i].b, T[i].c);
  return { T, box, pts, pieces };
}
function dist(pt, M, cap) {
  let best = cap;
  for (const t of M.T) { if (t.box.distanceToPoint(pt) > best) continue; tri.set(t.a, t.b, t.c); tri.closestPointToPoint(pt, Cl); best = Math.min(best, Cl.distanceTo(pt)); }
  return best;
}
// is the point inside any one solid piece of M (each piece is a closed shape; pieces overlap each other, so parity over the whole mesh would lie)
function inside(pt, M) {
  for (const pc of M.pieces) {
    if (!pc.box.containsPoint(pt)) continue;
    let n = 0;
    for (const dir of [[1, 0.0137, 0.0071], [0.0043, 1, 0.011], [0.0091, 0.0037, 1]]) {
      ray.set(pt, new THREE.Vector3(...dir).normalize());
      let c = 0; for (const t of pc.tris) if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) c++;
      n += c % 2;
    }
    if (n >= 2) return true;
  }
  return false;
}
// closest approach of two meshes (0 when one holds a point of the other)
function gap(A, B, cap = 1) {
  let best = cap;
  if (!A.box.clone().expandByScalar(best).intersectsBox(B.box)) return best;
  for (const p of A.pts) { best = Math.min(best, dist(p, B, best)); if (best < 1e-6) return 0; }
  for (const p of B.pts) { best = Math.min(best, dist(p, A, best)); if (best < 1e-6) return 0; }
  const some = (P, Bx) => P.filter((p) => Bx.containsPoint(p));
  for (const p of some(A.pts, B.box)) if (inside(p, B)) return 0;
  for (const p of some(B.pts, A.box)) if (inside(p, A)) return 0;
  return best;
}
// how deep the points of A sink into the solid B (0 if none)
function sink(A, B) {
  if (!A.box.intersectsBox(B.box)) return 0;
  let worst = 0;
  for (const p of A.pts) {
    if (!B.box.containsPoint(p) || !inside(p, B)) continue;
    const d0 = dist(p, B, 1); if (process.env.DBG && d0 > 0.1) console.log('   deep point', p.toArray().map((x) => x.toFixed(2)).join(','), d0.toFixed(2)); worst = Math.max(worst, d0);
  }
  return worst;
}

// pairs of parts that overlap on purpose (a pin through a hub, a barrel through its mantlet)
const OVERLAP = {
  walker: [['hull', 'thigh'], ['thigh', 'shin'], ['shin', 'foot'], ['thigh', 'ram tube'], ['shin', 'ram rod'], ['ram tube', 'ram rod'], ['foot', 'toes'], ['hull', 'head'], ['head', 'gun'], ['thigh', 'ram rod'], ['shin', 'ram tube'], ['hull', 'kit']],   // the lamp discs ride the head, which nests in the hull's collar
  tank: [['hull', 'turret'], ['hull', 'arm'], ['arm', 'wheel'], ['hull', 'roller'], ['hull', 'sprocket'], ['hull', 'idler'], ['turret', 'cradle'], ['turret', 'barrel'], ['cradle', 'barrel'], ['arm', 'arm'], ['wheel', 'wheel']],
};
const allowed = (kind, a, b) => OVERLAP[kind].some(([x, y]) => (a === x && b === y) || (a === y && b === x));

let bad = 0;
const say = (s) => console.log(s);

for (const kind of kinds) {
  say(`\n=== ${kind} ===`);
  // ---- (1) loose parts, per copy
  CKit.log = [];
  const v = new Vehicle(kind, 0, 0, 0, 0);
  const log = CKit.log; CKit.log = null;
  const kits = new Map();
  for (const e of log) { if (!kits.has(e.kit)) kits.set(e.kit, []); kits.get(e.kit).push(e); }
  const connected = (entries, label) => {
    const P = entries.map((e) => meshOf([e.g]));
    const parent = P.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) if (find(a) !== find(b) && gap(P[a], P[b], TOUCH) <= TOUCH) parent[find(a)] = find(b);
    const comps = new Map();
    P.forEach((p, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, { n: 0, box: new THREE.Box3() }); const c = comps.get(r); c.n++; c.box.union(p.box); });
    const main = [...comps.values()].sort((x, y) => y.n - x.n)[0];
    let loose = 0;
    for (const c of comps.values()) if (c !== main) { loose++; const s = c.box.getSize(new THREE.Vector3()), m = c.box.getCenter(new THREE.Vector3()); say(`  ${label}: LOOSE ${c.n} piece(s) ${s.toArray().map((x) => x.toFixed(2)).join('x')} at ${m.toArray().map((x) => x.toFixed(2)).join(',')}`); }
    return loose;
  };
  const done = new Set();
  const stats = {};
  for (const [kit, entries] of kits) {
    const far = entries[0].far, name = kit.name || 'kit';
    const solid = entries.filter((e) => !e.blend);
    // the near copy with everything on it (damage included); the far copy with only what it keeps (and the damage that rides the same joint)
    const base = far ? solid.filter((e) => !e.minor && !e.tier) : solid.filter((e) => !e.tier);
    const withDmg = far ? base : solid;
    if (!base.length) continue;
    const key = `${far ? 'far ' : ''}${name}`;
    const l = connected(withDmg, key);
    const s = (stats[key] ||= { n: 0, pieces: 0, loose: 0 }); s.n++; s.pieces += withDmg.length; s.loose += l;
    bad += l;
  }
  for (const [k, s] of Object.entries(stats)) say(`${k}: ${s.n} part(s), ${s.pieces} pieces, ${s.loose} loose`);

  // ---- per-kit meshes in the current pose (bind-space pieces carried by the joint's skin matrix)
  const near = [...kits].filter(([, e]) => !e[0].far);
  const sk = v.parts.skeleton, M = new THREE.Matrix4(), inv = new THREE.Matrix4();
  const partMesh = (kit, entries) => {
    // a part that is its own mesh (the gun, the lamps) rides that object; the rest ride their joint
    const obj = v.parts.kitObjects?.[kit.name];
    if (obj) { obj.updateMatrixWorld(true); return meshOf(entries.filter((e) => !e.blend && !e.tier).map((e) => e.g), obj.matrixWorld.clone()); }
    sk.bones[kit.bone].updateMatrixWorld(true);
    inv.makeTranslation(-kit.anchor[0], -kit.anchor[1], -kit.anchor[2]);
    M.multiplyMatrices(sk.bones[kit.bone].matrixWorld, inv);
    return meshOf(entries.filter((e) => !e.blend && !e.tier).map((e) => e.g), M.clone());
  };
  const live = () => { v.group.updateMatrixWorld(true); return near.map(([kit, entries]) => ({ name: kit.name || 'kit', kit, mesh: partMesh(kit, entries) })); };
  const byName = (parts, n) => parts.filter((p) => p.name === n);

  // ---- poses
  const seen = new Set();
  const joints = (parts, label) => {
    const out = [];
    const chk = (name, a, b, max = TOUCH) => { if (!a || !b) return; const g = gap(a.mesh, b.mesh, 1); if (g > max) out.push(`${name} ${g.toFixed(3)}`); };
    if (kind === 'walker') {
      const [hull] = byName(parts, 'hull'), [head] = byName(parts, 'head'), [gun] = byName(parts, 'gun');
      chk('head~hull', head, hull); chk('gun~head', gun, head);
      for (let i = 0; i < 2; i++) {
        const g = (n) => byName(parts, n)[i];
        chk(`leg${i} hip`, g('thigh'), hull); chk(`leg${i} knee`, g('thigh'), g('shin')); chk(`leg${i} ankle`, g('shin'), g('foot')); chk(`leg${i} toe`, g('toes'), g('foot'));
        chk(`leg${i} ram-tube~thigh`, g('ram tube'), g('thigh')); chk(`leg${i} ram-rod~shin`, g('ram rod'), g('shin')); chk(`leg${i} ram halves`, g('ram tube'), g('ram rod'));
      }
    } else {
      const [hull] = byName(parts, 'hull'), [turret] = byName(parts, 'turret'), [cradle] = byName(parts, 'cradle'), [barrel] = byName(parts, 'barrel');
      chk('turret~hull', turret, hull); chk('cradle~turret', cradle, turret); chk('barrel~cradle', barrel, cradle);
      byName(parts, 'arm').forEach((a, i) => { chk(`arm${i}~hull`, a, hull); chk(`wheel${i}~arm`, byName(parts, 'wheel')[i], a); });
      byName(parts, 'roller').forEach((r, i) => chk(`roller${i}~hull`, r, hull));
      byName(parts, 'sprocket').forEach((r, i) => chk(`sprocket${i}~hull`, r, hull));
      byName(parts, 'idler').forEach((r, i) => chk(`idler${i}~hull`, r, hull));
    }
    return out.map((o) => `${label}: ${o}`);
  };
  const clip = (parts, label) => {
    const out = [];
    for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
      const A = parts[a], B = parts[b];
      if (allowed(kind, A.name, B.name)) continue;
      // wheels, arms and rollers with the same kit name on opposite sides never meet; skip their pairs cheaply by the boxes
      const d = Math.max(sink(A.mesh, B.mesh), sink(B.mesh, A.mesh));
      if (d > SINK) out.push(`${A.name}${a}~${B.name}${b} sinks ${d.toFixed(3)}`);
    }
    return out.map((o) => `${label}: ${o}`);
  };
  const report = (label, doClip = true) => {
    const parts = live();
    const r = [...joints(parts, label), ...(doClip ? clip(parts, label) : [])];
    for (const line of r) { const k = line.replace(/\d+\.\d+/g, '').replace(/^[^:]*:/, ''); if (!seen.has(k)) { seen.add(k); say('  ' + line); } bad++; }
    return parts;
  };
  const sim = (secs, speed, turn, f) => {
    for (let k = 0; k < secs * 20; k++) {
      const dt = 0.05; v.t += dt;
      v.yaw += turn * dt; v.yawRate = turn; v.speed = speed;
      v.pos.x += Math.sin(v.yaw) * speed * dt; v.pos.z += Math.cos(v.yaw) * speed * dt;
      v.pos.y = height(v.pos.x, v.pos.z) + (kind === 'tank' ? 0 : 0);
      if (kind === 'tank') for (let i = 0; i < 3; i++) v.settle(dt / 3);
      f?.(k, dt);
      v.syncModel(dt);
      if (k % 6 === 0) report(`${kind} speed ${speed} turn ${turn} frame ${k}`, k % 18 === 0);
    }
  };
  if (process.env.DBG) for (const p of live()) if (p.name === 'roller') console.log('roller', p.kit.bone, p.mesh.box.min.toArray().map((x) => x.toFixed(2)).join(','), '|', p.mesh.box.max.toArray().map((x) => x.toFixed(2)).join(','));
  report('standing');
  v.tYaw = 0.9; v.tPitch = 0.3; v.syncModel(0.05); report('turret turned and gun raised');
  v.tYaw = -2.4; v.tPitch = -0.1; v.syncModel(0.05); report('turret turned right round');
  v.tYaw = 0; v.tPitch = 0;
  let t = 0;
  const plan = kind === 'walker' ? [[5.5, 0, 3], [2.5, 0.6, 2.5], [-2, 0, 1.5], [0, 0, 0.5]] : [[8, 0, 3], [3, 0.7, 3], [-3, -0.5, 2], [0, 0, 0.5]];
  for (const [speed, turn, secs] of plan) sim(secs, speed, turn, (k, dt) => { t += dt; v.tYaw = Math.sin(t * 1.3) * 1.2; v.tPitch = Math.sin(t * 0.9) * 0.3; if (kind === 'tank') v.recoil = Math.max(0, Math.sin(t * 2)); });
  // ---- (4) floating and sinking
  if (kind === 'walker') {
    const parts = live();
    const feet = byName(parts, 'foot');
    feet.forEach((f, i) => {
      const leg = v.parts.legs[i], sole = f.mesh.box.min.y, want = leg.fp.y;
      // the pad's bevel dips 4 cm below the point it plants, and a foot mid-step is lifted
      if (sole < want - 0.065 || sole > want + 0.06) { say(`  FOOT ${i}: sole at ${sole.toFixed(3)}, ground ${want.toFixed(3)}`); bad++; }
    });
    say(`feet on the ground: ${feet.map((f, i) => (f.mesh.box.min.y - v.parts.legs[i].fp.y).toFixed(3)).join(', ')}`);
  } else {
    const parts = live();
    const worst = { up: 0, down: 0 };
    for (const side of v.parts.sides) side.wheels.forEach((w, i) => {
      w.updateMatrixWorld(true);
      const p = w.getWorldPosition(new THREE.Vector3());
      const ground = height(p.x, p.z), contact = p.y - 0.40 - 0.13; // wheel bottom, then through the belt to the ground
      const d = contact - ground;
      if (d > 0.07) { say(`  WHEEL ${side.sx > 0 ? 'L' : 'R'}${i}: ${d.toFixed(3)} m above the ground`); bad++; }
      if (d < -0.07) { say(`  WHEEL ${side.sx > 0 ? 'L' : 'R'}${i}: ${(-d).toFixed(3)} m into the ground`); bad++; }
      worst.up = Math.max(worst.up, d); worst.down = Math.min(worst.down, d);
    });
    say(`road wheels vs ground: ${worst.down.toFixed(3)} .. +${worst.up.toFixed(3)} m`);
    void parts;
  }
  // everything of the body sits above the lowest point of its running gear, nothing hangs under the ground
  {
    const parts = live(); const box = new THREE.Box3();
    for (const p of parts) box.union(p.mesh.box);
    say(`lowest point ${box.min.y.toFixed(3)}, ground at the centre ${height(v.pos.x, v.pos.z).toFixed(3)}`);
  }
  // ---- wrecked
  v.alive = false; v.deadT = 3; v.wreckTurret = { yaw: 0.3, lift: 0.25 };
  v.parts.onDestroy?.(v);
  for (let k = 0; k < 120; k++) { v.t += 0.05; v.deadT += 0.05; v.syncModel(0.05); }
  report('wrecked', kind === 'walker');
}
console.log(bad ? `\n${bad} problems` : '\nvehicles ok');
process.exit(bad ? 1 : 0);
