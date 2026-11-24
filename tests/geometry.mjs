// Geometry checks for the gun models: no loose parts and no coplanar overlapping faces (z-fighting).
// Not part of the browser suite; run by hand with `node tests/geometry.mjs [weaponId...]`.
import * as THREE from 'three';
import { Kit } from '../src/models.js';
import { WEAPONS, weaponParts } from '../src/weapons.js';

const TOUCH = 0.0035; // pieces closer than this count as joined (screws and rings sit on surfaces)
const FIGHT_DIST = 0.0012; // same-facing faces closer than this over a shared area will flicker

// record every piece a build adds, before merging
const pieces = [];
const add = Kit.prototype.add;
Kit.prototype.add = function (geo, mat, o) {
  const before = [...this.parts.values()].reduce((n, l) => n + l.length, 0);
  add.call(this, geo, mat, o);
  const after = [...this.parts.entries()];
  for (const [m, list] of after) if (m === mat) pieces.push({ g: list[list.length - 1], mat, n: before });
  return this;
};

const tris = (g) => {
  const p = g.attributes.position, out = [];
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const area = n.length() / 2;
    if (area < 1e-9) continue;
    n.normalize();
    out.push({ a, b, c, n, d: n.dot(a), area, box: new THREE.Box3().setFromPoints([a, b, c]) });
  }
  return out;
};
const tri = new THREE.Triangle(), Pt = new THREE.Vector3(), Cl = new THREE.Vector3();
function distToTris(pt, T) {
  let best = 1e9;
  for (const t of T) {
    tri.set(t.a, t.b, t.c);
    tri.closestPointToPoint(pt, Cl);
    best = Math.min(best, Cl.distanceTo(pt));
  }
  return best;
}
const ray = new THREE.Ray(), hit = new THREE.Vector3();
function inside(pt, T) {
  let n = 0;
  for (const dir of [[1, 0.0137, 0.0071], [0.0043, 1, 0.011]]) {
    ray.set(pt, new THREE.Vector3(...dir).normalize());
    let c = 0;
    for (const t of T) { tri.set(t.a, t.b, t.c); if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) c++; }
    n += c % 2;
  }
  return n === 2;
}
function samples(T, step = 1) {
  const s = [];
  for (let i = 0; i < T.length; i += step) { const t = T[i]; s.push(t.a, t.b, t.c, new THREE.Vector3().add(t.a).add(t.b).add(t.c).multiplyScalar(1 / 3)); }
  return s;
}
function touches(A, B) {
  const box = A.box.clone().expandByScalar(TOUCH);
  if (!box.intersectsBox(B.box)) return false;
  for (const p of samples(A.T, Math.max(1, Math.floor(A.T.length / 60)))) if (distToTris(p, B.T) < TOUCH) return true;
  for (const p of samples(B.T, Math.max(1, Math.floor(B.T.length / 60)))) if (distToTris(p, A.T) < TOUCH) return true;
  if (inside(A.T[0].a, B.T) || inside(B.T[0].a, A.T)) return true;
  return false;
}
const inTri = (p, t) => { tri.set(t.a, t.b, t.c); tri.getBarycoord(p, Pt); return Pt.x >= -1e-4 && Pt.y >= -1e-4 && Pt.z >= -1e-4; };
function fights(A, B) {
  const out = [];
  if (!A.box.clone().expandByScalar(FIGHT_DIST).intersectsBox(B.box)) return out;
  for (const t of A.T) {
    if (t.area < 2e-6) continue;
    for (const u of B.T) {
      if (t.n.dot(u.n) < 0.995) continue; // same facing only
      if (Math.abs(u.n.dot(t.a) - u.d) > FIGHT_DIST) continue;
      if (!t.box.clone().expandByScalar(FIGHT_DIST).intersectsBox(u.box)) continue;
      let shared = 0;
      for (const [x, y, z] of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.45, 0.45, 0.1], [0.1, 0.45, 0.45], [0.45, 0.1, 0.45]]) {
        const p = new THREE.Vector3().addScaledVector(t.a, x).addScaledVector(t.b, y).addScaledVector(t.c, z);
        if (inTri(p, u)) shared++;
      }
      if (shared >= 2) { out.push({ at: t.a.clone(), dist: Math.abs(u.n.dot(t.a) - u.d) }); break; }
    }
  }
  return out;
}

const ids = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(WEAPONS);
let bad = 0;
for (const id of ids) {
  pieces.length = 0;
  const w = weaponParts(id); // builds once
  void w;
  const P = pieces.map((p, i) => { const T = tris(p.g); const box = new THREE.Box3().setFromBufferAttribute(p.g.attributes.position); return { i, T, box, mat: p.mat }; });
  // connectivity from the first piece (the stock or grip)
  const seen = new Set([0]), q = [0];
  while (q.length) {
    const a = q.pop();
    for (let b = 0; b < P.length; b++) if (!seen.has(b) && touches(P[a], P[b])) { seen.add(b); q.push(b); }
  }
  const loose = P.filter((p) => !seen.has(p.i));
  for (const p of loose) {
    const c = p.box.getCenter(new THREE.Vector3());
    console.log(`  ${id}: LOOSE piece #${p.i} at (${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}) size ${p.box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(3)).join('x')}`);
  }
  let fightN = 0;
  for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
    const f = fights(P[a], P[b]);
    if (f.length) { fightN += f.length; console.log(`  ${id}: Z-FIGHT pieces #${a}/#${b} at (${f[0].at.x.toFixed(3)}, ${f[0].at.y.toFixed(3)}, ${f[0].at.z.toFixed(3)}) d=${f[0].dist.toFixed(5)} (${f.length} tris)`); }
  }
  console.log(`${id}: ${P.length} pieces, ${loose.length} loose, ${fightN} z-fighting triangles`);
  bad += loose.length + fightN;
}
process.exit(bad ? 1 : 0);
