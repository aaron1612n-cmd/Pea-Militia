// Strider model check, no browser: (1) every piece each part is built from touches the rest of that part,
// (2) in motion the parts stay joined at the hips, knees, ankles, toes, rams and gun mounts, and nothing
// big sinks into anything it should not. node tests/strider-check.mjs
import * as THREE from 'three';
import { Vehicle, CKit } from '../src/vehicles.js';

const TOUCH = 0.012;
const tri = new THREE.Triangle(), Cl = new THREE.Vector3(), ray = new THREE.Ray(), hit = new THREE.Vector3();
function meshOf(g, m = null) {
  const p = g.attributes.position, idx = g.index ? g.index.array : [...Array(p.count).keys()];
  const T = [], box = new THREE.Box3();
  const v = (i) => { const q = new THREE.Vector3().fromBufferAttribute(p, i); return m ? q.applyMatrix4(m) : q; };
  for (let i = 0; i < idx.length; i += 3) {
    const a = v(idx[i]), b = v(idx[i + 1]), c = v(idx[i + 2]);
    T.push({ a, b, c, box: new THREE.Box3().setFromPoints([a, b, c]) });
    box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
  }
  const pts = [], step = Math.max(1, Math.floor(T.length / 70));
  for (let i = 0; i < T.length; i += step) pts.push(T[i].a, T[i].b, T[i].c);
  return { T, box, pts };
}
function dist(pt, M, cap) {
  let best = cap;
  for (const t of M.T) { if (t.box.distanceToPoint(pt) > best) continue; tri.set(t.a, t.b, t.c); tri.closestPointToPoint(pt, Cl); best = Math.min(best, Cl.distanceTo(pt)); }
  return best;
}
function inside(pt, M) {
  let n = 0;
  for (const dir of [[1, 0.0137, 0.0071], [0.0043, 1, 0.011], [0.0091, 0.0037, 1]]) { ray.set(pt, new THREE.Vector3(...dir).normalize()); let c = 0; for (const t of M.T) if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) c++; n += c % 2; }
  return n >= 2;
}
// closest approach of two meshes (0 when one holds a point of the other)
function gap(A, B, cap = 1) {
  let best = cap;
  if (!A.box.clone().expandByScalar(best).intersectsBox(B.box)) return best;
  for (const p of A.pts) { best = Math.min(best, dist(p, B, best)); if (best < 1e-6) return 0; }
  for (const p of B.pts) { best = Math.min(best, dist(p, A, best)); if (best < 1e-6) return 0; }
  for (const p of A.pts.slice(0, 6)) if (B.box.containsPoint(p) && inside(p, B)) return 0;
  for (const p of B.pts.slice(0, 6)) if (A.box.containsPoint(p) && inside(p, A)) return 0;
  return best;
}

let bad = 0;
// ---- (1) pieces of each part
CKit.log = [];
const v = new Vehicle('walker', 0, 0, 0, 0);
const log = CKit.log; CKit.log = null;
const byKit = new Map();
for (const { kit, g } of log) { if (!byKit.has(kit)) byKit.set(kit, []); byKit.get(kit).push(g); }
for (const [kit, geos] of byKit) {
  const P = geos.map((g) => meshOf(g));
  const parent = P.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) if (find(a) !== find(b) && gap(P[a], P[b], TOUCH) <= TOUCH) parent[find(a)] = find(b);
  const comps = new Map();
  P.forEach((p, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, { n: 0, box: new THREE.Box3() }); const c = comps.get(r); c.n++; c.box.union(p.box); });
  const main = [...comps.values()].sort((x, y) => y.n - x.n)[0];
  const loose = [...comps.values()].filter((c) => c !== main);
  for (const c of loose) { const s = c.box.getSize(new THREE.Vector3()), m = c.box.getCenter(new THREE.Vector3()); console.log(`  ${kit.name || 'kit'}: LOOSE ${c.n} piece(s) ${s.toArray().map((x) => x.toFixed(2)).join('x')} at ${m.toArray().map((x) => x.toFixed(2)).join(',')}`); }
  console.log(`${kit.name || 'kit'}: ${P.length} pieces, ${loose.length} loose`);
  bad += loose.length;
}
// ---- (2) joints in motion
const names = ['hull', 'tMesh', 'gMesh'];
const joints = (v, label) => {
  v.group.updateMatrixWorld(true);
  const P = v.parts, M = (o) => meshOf(o.geometry, o.matrixWorld);
  const [hull, tur, gun] = P.meshes;
  const H = M(hull), Tm = M(tur), G = M(gun);
  const out = [];
  const chk = (name, a, b, max) => { const g = gap(a, b, 1); if (g > max) out.push(`${name} ${g.toFixed(3)}`); };
  chk('turret~hull', Tm, H, TOUCH);
  chk('gun~turret', G, Tm, TOUCH);
  P.legs.forEach((l, i) => {
    const th = M(l.th), sh = M(l.sh), ft = M(l.ft), toe = M(l.toe), rt = M(l.rt), rr = M(l.rr);
    chk(`leg${i} hip`, th, H, TOUCH);
    chk(`leg${i} knee`, th, sh, TOUCH);
    chk(`leg${i} ankle`, sh, ft, TOUCH);
    chk(`leg${i} toe`, toe, ft, TOUCH);
    chk(`leg${i} ram-tube~thigh`, rt, th, TOUCH);
    chk(`leg${i} ram-rod~shin`, rr, sh, TOUCH);
    chk(`leg${i} ram halves`, rt, rr, TOUCH);
  });
  return out.length ? `${label}: ${out.join('; ')}` : null;
};
const seen = new Set();
const report = (label) => { const r = joints(v, label); if (r) { const k = r.replace(/[0-9.]+/g, ''); if (!seen.has(k)) { seen.add(k); console.log('  JOINT ' + r); } bad++; } };
report('standing');
let t = 0;
for (const [speed, turn, secs] of [[5.5, 0, 3], [2.5, 0.6, 2.5], [-2, 0, 1.5], [0, 0, 0.5]]) {
  for (let f = 0; f < secs * 20; f++) {
    const dt = 0.05; t += dt; v.t += dt;
    v.yaw += turn * dt; v.speed = speed;
    v.pos.x += Math.sin(v.yaw) * speed * dt; v.pos.z += Math.cos(v.yaw) * speed * dt;
    v.tYaw = Math.sin(t * 1.3) * 1.2; v.tPitch = Math.sin(t * 0.9) * 0.4;
    v.syncModel(dt);
    if (f % 4 === 0) report(`speed ${speed} frame ${f}`);
  }
}
v.alive = false; v.deadT = 3; v.wreckTurret = { yaw: 0.3, lift: 0.25 }; v.syncModel(0.05); report('wrecked');
console.log(bad ? `${bad} problems` : 'strider ok');
process.exit(bad ? 1 : 0);
