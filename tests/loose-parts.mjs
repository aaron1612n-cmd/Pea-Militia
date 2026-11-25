// Loose-part check for props: every piece a prop is built from must touch the ground or join the main
// body through a chain of touching pieces. Reports floating pieces by size and place.
// Run by hand: node tests/loose-parts.mjs [propType...]
import * as THREE from 'three';
import { Kit } from '../src/models.js';
import { PROPS, propModel } from '../src/props.js';

const TOUCH = 0.012;
const pieces = [];
const add = Kit.prototype.add;
Kit.prototype.add = function (geo, mat, o) {
  const before = this.parts.has(mat) ? this.parts.get(mat).length : 0;
  add.call(this, geo, mat, o);
  pieces.push(this.parts.get(mat)[before]);
  return this;
};
const tri = new THREE.Triangle(), Cl = new THREE.Vector3();
function mesh(g) {
  const p = g.attributes.position, idx = g.index ? g.index.array : [...Array(p.count).keys()];
  const T = []; const box = new THREE.Box3();
  for (let i = 0; i < idx.length; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, idx[i]), b = new THREE.Vector3().fromBufferAttribute(p, idx[i + 1]), c = new THREE.Vector3().fromBufferAttribute(p, idx[i + 2]);
    T.push({ a, b, c, box: new THREE.Box3().setFromPoints([a, b, c]) });
    box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
  }
  const pts = [], step = Math.max(1, Math.floor(T.length / 50));
  for (let i = 0; i < T.length; i += step) pts.push(T[i].a, T[i].b, T[i].c);
  return { T, box, pts };
}
function dist(pt, M, cap) {
  let best = cap;
  for (const t of M.T) { if (t.box.distanceToPoint(pt) > best) continue; tri.set(t.a, t.b, t.c); tri.closestPointToPoint(pt, Cl); best = Math.min(best, Cl.distanceTo(pt)); }
  return best;
}
const ray = new THREE.Ray(), hit = new THREE.Vector3();
function inside(pt, M) {
  let n = 0;
  for (const dir of [[1, 0.0137, 0.0071], [0.0043, 1, 0.011], [0.0091, 0.0037, 1]]) { ray.set(pt, new THREE.Vector3(...dir).normalize()); let c = 0; for (const t of M.T) if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) c++; n += c % 2; }
  return n >= 2;
}
function joined(A, B) {
  if (!A.box.clone().expandByScalar(TOUCH).intersectsBox(B.box)) return false;
  for (const p of A.pts) if (dist(p, B, TOUCH) < TOUCH) return true;
  for (const p of B.pts) if (dist(p, A, TOUCH) < TOUCH) return true;
  for (const p of A.pts.slice(0, 12)) if (B.box.containsPoint(p) && inside(p, B)) return true;
  for (const p of B.pts.slice(0, 12)) if (A.box.containsPoint(p) && inside(p, A)) return true;
  return false;
}
const types = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(PROPS).filter((k) => !PROPS[k].noModel);
let bad = 0;
for (const type of types) {
  pieces.length = 0;
  propModel(type);
  const P = pieces.map((g) => { g.computeBoundingBox?.(); return mesh(g); });
  const parent = P.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) if (find(a) !== find(b) && joined(P[a], P[b])) parent[find(a)] = find(b);
  const comps = new Map();
  P.forEach((p, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, { n: 0, box: new THREE.Box3() }); const c = comps.get(r); c.n++; c.box.union(p.box); });
  const floating = [...comps.values()].filter((c) => c.box.min.y > 0.02);
  const main = [...comps.values()].sort((x, y) => y.n - x.n)[0];
  const loose = floating.filter((c) => c !== main);
  for (const c of loose) { const s = c.box.getSize(new THREE.Vector3()), m = c.box.getCenter(new THREE.Vector3()); console.log(`  ${type}: FLOATING ${c.n} piece(s) ${s.toArray().map((v) => v.toFixed(2)).join('x')} at ${m.toArray().map((v) => v.toFixed(2)).join(',')} (bottom ${c.box.min.y.toFixed(2)})`); }
  console.log(`${type}: ${P.length} pieces, ${comps.size} groups, ${loose.length} floating`);
  bad += loose.length;
}
process.exit(bad ? 1 : 0);
