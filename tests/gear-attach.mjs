// Attachment check for the soldier's worn kit: every piece of every class must be joined to the
// body (the torso shell or the pack) through a chain of touching pieces, so nothing floats.
// Also checks the helmet strap against the head. Run by hand: node tests/gear-attach.mjs [kind...]
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { U } from '../src/rig.js';
import { torsoGeo, headGeo, helmetGeo } from '../src/anatomy.js';
import { gearPieces, KIND_IDS, PK } from '../src/gear.js';

const TOUCH = 0.0045; // pieces closer than this count as joined (sunk 4 mm into what they sit on)
const tri = new THREE.Triangle(), Cl = new THREE.Vector3(), ray = new THREE.Ray(), hit = new THREE.Vector3();

function mesh(g) {
  const p = g.attributes.position, idx = g.index ? g.index.array : [...Array(p.count).keys()];
  const T = [];
  const box = new THREE.Box3();
  for (let i = 0; i < idx.length; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, idx[i]), b = new THREE.Vector3().fromBufferAttribute(p, idx[i + 1]), c = new THREE.Vector3().fromBufferAttribute(p, idx[i + 2]);
    T.push({ a, b, c, box: new THREE.Box3().setFromPoints([a, b, c]) });
    box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
  }
  const pts = [];
  const step = Math.max(1, Math.floor(T.length / 90));
  for (let i = 0; i < T.length; i += step) pts.push(T[i].a, T[i].b, T[i].c, new THREE.Vector3().add(T[i].a).add(T[i].b).add(T[i].c).multiplyScalar(1 / 3));
  return { T, box, pts };
}
function dist(pt, M, cap = Infinity) {
  let best = cap;
  for (const t of M.T) {
    if (t.box.distanceToPoint(pt) > best) continue;
    tri.set(t.a, t.b, t.c);
    tri.closestPointToPoint(pt, Cl);
    best = Math.min(best, Cl.distanceTo(pt));
  }
  return best;
}
function inside(pt, M) {
  let n = 0;
  for (const dir of [[1, 0.0137, 0.0071], [0.0043, 1, 0.011], [0.0091, 0.0037, 1]]) {
    ray.set(pt, new THREE.Vector3(...dir).normalize());
    let c = 0;
    for (const t of M.T) if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) c++;
    n += c % 2;
  }
  return n >= 2;
}
// how close two meshes come to each other (0 when one holds a point of the other)
function gap(A, B) {
  let best = Infinity;
  if (!A.box.clone().expandByScalar(0.05).intersectsBox(B.box)) return best;
  for (const p of A.pts) { best = Math.min(best, dist(p, B, best)); if (best < 1e-6) return 0; }
  for (const p of B.pts) { best = Math.min(best, dist(p, A, best)); if (best < 1e-6) return 0; }
  if (best > 0 && (inside(A.pts[0], B) || inside(B.pts[0], A))) return 0;
  return best;
}

const torso = mesh(torsoGeo(6));
const pg = new RoundedBoxGeometry(...U.PACK, 3, 0.04);
pg.translate(PK.x, PK.y, PK.z);
const pack = mesh(pg);

let bad = 0;
const kinds = process.argv.length > 2 ? process.argv.slice(2) : KIND_IDS;
for (const kind of kinds) {
  const { pieces, marks } = gearPieces(kind);
  const P = pieces.map((g) => ({ name: g.userData.name, ...mesh(g) }));
  const body = [torso, pack];
  const joined = new Set();
  const q = [];
  P.forEach((p, i) => { if (body.some((b) => gap(p, b) <= TOUCH)) { joined.add(i); q.push(i); } });
  while (q.length) {
    const a = q.pop();
    for (let b = 0; b < P.length; b++) if (!joined.has(b) && gap(P[a], P[b]) <= TOUCH) { joined.add(b); q.push(b); }
  }
  const loose = P.filter((_, i) => !joined.has(i));
  for (const p of loose) {
    const near = Math.min(...body.map((b) => gap(p, b)), ...P.filter((o) => o !== p && joined.has(P.indexOf(o))).map((o) => gap(p, o)));
    console.log(`  ${kind}: LOOSE ${p.name} (${near.toFixed(4)} m from anything attached)`);
  }
  // marks (cross, emitters, antenna tip) sit on a piece or the body
  let looseMarks = 0;
  for (const g of marks) {
    const m = mesh(g);
    const near = Math.min(...body.map((b) => gap(m, b)), ...P.map((o) => gap(m, o)));
    if (near > TOUCH) { looseMarks++; console.log(`  ${kind}: LOOSE mark at ${m.box.getCenter(new THREE.Vector3()).toArray().map((v) => v.toFixed(3))} (${near.toFixed(4)} m)`); }
  }
  console.log(`${kind}: ${P.length} pieces, ${loose.length} loose, ${marks.length} marks, ${looseMarks} loose`);
  bad += loose.length + looseMarks;
}

// helmet strap and chin cup against the head: nothing hovers off the face
{
  const head = mesh(headGeo()), helmet = mesh(helmetGeo());
  const g = gap(helmet, head);
  console.log(`helmet to head: ${g.toFixed(4)} m`);
  if (g > TOUCH) bad++;
}
process.exit(bad ? 1 : 0);
