// Loose-part check for props: every piece a prop is built from must touch the ground or join the main
// body through a chain of touching pieces. Reports floating pieces by size and place.
// Run by hand: node tests/loose-parts.mjs [propType...]
import * as THREE from 'three';
import { Kit } from '../src/models.js';
import { PROPS } from '../src/props.js';
import { buildProp, VARIANTS } from '../src/propbuild.js';
import { buildScene, SCENE_TYPES, SCENE_VARIANTS } from '../src/scenebuild.js';

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
  // solids that overlap without their skins passing near each other (a brick sunk into its mortar core)
  const ca = A.box.getCenter(new THREE.Vector3()), cb = B.box.getCenter(new THREE.Vector3());
  if (B.box.containsPoint(ca) && inside(ca, B)) return true;
  // two crossing bars: some point of the shared box is inside both
  const X = A.box.clone().intersect(B.box);
  if (!X.isEmpty()) {
    const p = new THREE.Vector3();
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) { p.set(X.min.x + (X.max.x - X.min.x) * (i + 0.5) / 4, X.min.y + (X.max.y - X.min.y) * (j + 0.5) / 4, X.min.z + (X.max.z - X.min.z) * (k + 0.5) / 4); if (inside(p, A) && inside(p, B)) return true; }
  }
  if (A.box.containsPoint(cb) && inside(cb, A)) return true;
  return false;
}
const types = process.argv.length > 2 ? process.argv.slice(2).filter((a) => PROPS[a]) : Object.keys(PROPS).filter((k) => !PROPS[k].noModel);
const SCENE_ONLY = process.argv.slice(2).every((a) => SCENE_TYPES.includes(a)) && process.argv.length > 2;
const sceneJobs = (process.argv.length > 2 ? process.argv.slice(2).filter((a) => SCENE_TYPES.includes(a)) : SCENE_TYPES).flatMap((t) => Array.from({ length: SCENE_VARIANTS[t] || 1 }, (_, v) => [`scene:${t}`, v, false]));
const propTypes = types.filter((t) => PROPS[t]);
const jobs = [...propTypes.flatMap((t) => Array.from({ length: VARIANTS[t] || 1 }, (_, v) => [t, v]).flatMap(([a, b]) => [[a, b, false], [a, b, true]])), ...sceneJobs];
void SCENE_ONLY;
let bad = 0;
for (const [type0, v, lite] of jobs) {
  const type = `${type0}.${v}${lite ? '.far' : ''}`;
  pieces.length = 0;
  if (type0.startsWith('scene:')) buildScene(type0.slice(6), v); else buildProp(type0, v, lite);
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
  // a model that dips below its origin pokes through the ground; trees sink their roots, wrecks settle into the mud
  const low = [...comps.values()].filter((c) => c.box.min.y < -(/^scene:(fir|leaf|birch|dead)/.test(type) ? 0.6 : /Hulk/.test(type) ? 0.4 : 0.2));
  for (const c of low) console.log(`  ${type}: BELOW GROUND ${c.n} piece(s) down to ${c.box.min.y.toFixed(2)}`);
  console.log(`${type}: ${P.length} pieces, ${comps.size} groups, ${loose.length} floating, ${low.length} below ground`);
  bad += loose.length + low.length;
}
process.exit(bad ? 1 : 0);
