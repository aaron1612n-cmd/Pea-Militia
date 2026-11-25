// Posed intersection check for the soldier: runs every class through a spread of poses with its own
// weapon and reports which pairs of parts sink into each other and how deep (metres).
// Joints and kit that sit on a surface by design are skipped. Run by hand: node tests/pose-clip.mjs [kind...]
import * as THREE from 'three';
import { U, HOLD, makePose, pose, solveLegs, solveArms, setWeaponBounds } from '../src/rig.js';
import { torsoGeo, headGeo, helmetGeo, packGeo, bootGeo, handGeos, pelvisGeo, neckGeo, deltGeo, LIMB } from '../src/anatomy.js';
import { GEAR, KIND_IDS, gearPieces } from '../src/gear.js';
import { WEAPONS, weaponParts } from '../src/weapons.js';

const WEAPON = { rifleman: 'rifle', assault: 'smg', gunner: 'mg', mortar: 'launcher', coil: 'plasma', medic: 'smg' };
const kinds = process.argv.length > 2 ? process.argv.slice(2) : KIND_IDS;
const PIECES = !!process.env.PIECES; // report each piece of worn kit on its own
const DEEP = Number(process.env.DEEP || 0.012); // report anything deeper than this

for (const id of Object.keys(WEAPONS)) { const { muzzle, box, sight } = weaponParts(id); setWeaponBounds(id, box, muzzle, sight); }
const hg = handGeos();
const sc = new THREE.Matrix4().makeScale(U.WEAPON_SCALE, U.WEAPON_SCALE, U.WEAPON_SCALE);
const BASE = {
  body: torsoGeo(5), head: headGeo(), pack: packGeo(), pelvis: pelvisGeo(), neck: neckGeo(), delt: deltGeo(),
  thigh: LIMB.thigh, shin: LIMB.shin, upperArm: LIMB.upperArm, foreArm: LIMB.foreArm, boot: bootGeo('foot'), toe: bootGeo('toe'),
  oL: hg.openL, oR: hg.openR, L: hg.left, R: hg.right, G: hg.leftGrip,
};
const closedCache = new Map();
const closedOf = (g) => { if (!closedCache.has(g)) closedCache.set(g, isClosed(g)); return closedCache.get(g); };
const pos = (g) => g.attributes.position.array;
const idx = (g) => (g.index ? g.index.array : null);

function worldMesh(g, m) {
  const src = pos(g), n = src.length / 3, out = new Float32Array(src.length), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.set(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]).applyMatrix4(m); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
  const I = idx(g), nt = I ? I.length / 3 : n / 3;
  const T = new Float32Array(nt * 9), N = new Float32Array(nt * 3), box = new THREE.Box3();
  const bb = new Float32Array(nt * 6);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let t = 0; t < nt; t++) {
    const i0 = I ? I[t * 3] : t * 3, i1 = I ? I[t * 3 + 1] : t * 3 + 1, i2 = I ? I[t * 3 + 2] : t * 3 + 2;
    a.fromArray(out, i0 * 3); b.fromArray(out, i1 * 3); c.fromArray(out, i2 * 3);
    a.toArray(T, t * 9); b.toArray(T, t * 9 + 3); c.toArray(T, t * 9 + 6);
    nn.subVectors(b, a).cross(c.clone().sub(a)).normalize().toArray(N, t * 3);
    for (let k = 0; k < 3; k++) { bb[t * 6 + k] = Math.min(a.getComponent(k), b.getComponent(k), c.getComponent(k)); bb[t * 6 + 3 + k] = Math.max(a.getComponent(k), b.getComponent(k), c.getComponent(k)); }
  }
  for (let i = 0; i < n; i++) box.expandByPoint(v.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]));
  // surface samples: every few vertices
  const pts = [], step = Math.max(1, Math.floor(n / 220));
  for (let i = 0; i < n; i += step) pts.push(new THREE.Vector3(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]));
  return { T, N, bb, nt, box, pts, closed: closedOf(g) };
}
const tri = new THREE.Triangle(), P = new THREE.Vector3(), Cp = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), Nn = new THREE.Vector3();
// how far point p sits inside mesh M (0 when outside): distance to the nearest surface if it is behind that surface
const ray = new THREE.Ray(), hit = new THREE.Vector3(), D = [new THREE.Vector3(1, 0.0137, 0.0071).normalize(), new THREE.Vector3(0.0043, 1, 0.011).normalize(), new THREE.Vector3(0.0091, 0.0037, 1).normalize()];
function parity(p, M) {
  let votes = 0;
  for (const d of D) {
    ray.set(p, d);
    let c = 0;
    for (let t = 0; t < M.nt; t++) {
      A.fromArray(M.T, t * 9); B.fromArray(M.T, t * 9 + 3); C.fromArray(M.T, t * 9 + 6);
      if (ray.intersectTriangle(A, B, C, false, hit)) c++;
    }
    votes += c % 2;
  }
  return votes >= 2;
}
function inside(p, M, cap = 0.15) {
  if (!M.closed || !M.box.containsPoint(p) || !parity(p, M)) return 0;
  let best = cap; const cp = new THREE.Vector3();
  for (let t = 0; t < M.nt; t++) {
    const o = t * 6;
    if (p.x < M.bb[o] - best || p.x > M.bb[o + 3] + best || p.y < M.bb[o + 1] - best || p.y > M.bb[o + 4] + best || p.z < M.bb[o + 2] - best || p.z > M.bb[o + 5] + best) continue;
    A.fromArray(M.T, t * 9); B.fromArray(M.T, t * 9 + 3); C.fromArray(M.T, t * 9 + 6);
    tri.set(A, B, C); tri.closestPointToPoint(p, cp);
    best = Math.min(best, cp.distanceTo(p));
  }
  return best;
}
function isClosed(g) {
  const p = g.attributes.position, I = g.index ? g.index.array : null, n = I ? I.length : p.count;
  const ids = new Map(), id = (i) => { const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`; if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const e = new Map();
  for (let i = 0; i < n; i += 3) { const t = [0, 1, 2].map((k) => id(I ? I[i + k] : i + k)); if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue; for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], key = a < b ? `${a}_${b}` : `${b}_${a}`; e.set(key, (e.get(key) || 0) + 1); } }
  for (const c of e.values()) if (c !== 2) return false;
  return true;
}

// pairs that overlap on purpose (joints, kit sunk into what it sits on)
const SKIP = new Set(['upperArm~delt', 'upperArm~foreArm', 'foreArm~hand', 'thigh~shin', 'shin~boot', 'thigh~pelvis', 'pelvis~body', 'body~pack', 'head~helmet', 'head~neck', 'neck~body', 'delt~body', 'gear~body', 'gear~pack', 'boot~toe', 'gear~pelvis', 'helmet~neck', 'thigh~body', 'upperArm~body', 'delt~gear', 'gear~neck', 'pack~neck', 'helmet~body', 'shin~toe', 'thigh~gear', 'boot~shin', 'head~body', 'hand~weapon', 'foreArm~weapon', 'delt~pack', 'upperArm~pack']);
const pairKey = (a, b) => (SKIP.has(`${a}~${b}`) || SKIP.has(`${b}~${a}`));
const base = (n) => (n.startsWith('gear') ? 'gear' : n.replace(/\d$/, ''));

const phases = [];
for (const t of [0, 1.8]) phases.push({ name: `idle ${t}`, t, ready: 0.55 });
for (const [mx, mz, l] of [[0, 1, 'fwd'], [1, 0, 'strafe'], [0, -1, 'back']]) for (const [speed, g] of [[1.4, 'walk'], [2.2, 'jog']]) for (let c = 0; c < 1; c += 0.25) phases.push({ name: `${g} ${l} ${c}`, walk: 1, cycle: c, speed, mx, mz, ready: 1, run: speed > 2 });
for (let c = 0; c < 1; c += 0.25) phases.push({ name: `sprint ${c}`, walk: 1, cycle: c, speed: 3.8, sprint: true, free: 1, ready: 0.15, run: true }, { name: `crouch walk ${c}`, walk: 1, cycle: c, speed: 0.9, kneel: 1, ready: 1 }, { name: `crawl ${c}`, walk: 1, cycle: c, speed: 0.6, prone: 1, ready: 1 });
phases.push({ name: 'kneel', kneel: 1, ready: 1 }, { name: 'kneel lowered', kneel: 1, ready: 0.55 }, { name: 'jump rise', air: 1, rise: 1 }, { name: 'jump fall', air: 1, rise: -1 }, { name: 'land', land: 1 });
for (const p of [-0.9, 0.9]) phases.push({ name: `aim pitch ${p}`, aimPitch: p, ready: 1 });
for (const tw of [-0.5, 0.5]) phases.push({ name: `twist ${tw}`, twist: tw, ready: 1, aimPitch: 0.3 });
for (const r of [0.1, 0.3, 0.5, 0.7, 0.9]) phases.push({ name: `reload ${r}`, reload: r, ready: 1 });
phases.push({ name: 'recoil', recoil: 1, ready: 1 }, { name: 'flinch', flinch: 1, ready: 1 });
for (const l of [-1, 1]) phases.push({ name: `lean ${l}`, lean: l, ready: 1 });
phases.push({ name: 'lean kneel', lean: 1, kneel: 1, ready: 1 });
for (const pr of [0.5, 1]) phases.push({ name: `prone ${pr}`, prone: pr, ready: 1 }, { name: `prone ${pr} aimed`, prone: pr, ready: 1, aimPitch: 0.3 });
for (const d of [0, 0.5, 1]) phases.push({ name: `dead ${d}`, dead: d });
if (process.env.ONLY) { const keep = process.env.ONLY.split(','); for (let i = phases.length - 1; i >= 0; i--) if (!keep.some((k) => phases[i].name.startsWith(k))) phases.splice(i, 1); }

const worst = new Map();
const pz = makePose();
for (const kind of kinds) {
  const gearGeo = GEAR[kind], helmGeo = helmetGeo(kind);
  const wid = WEAPON[kind];
  const pieces = PIECES ? gearPieces(kind).pieces : null;
  const wparts = weaponParts(wid).parts.map((p) => p.geometry.clone().applyMatrix4(sc));
  for (const ph of phases) {
    const s = { t: 0, weapon: wid, ...ph };
    pose(s, pz); solveLegs(pz); solveArms(pz);
    const dead = (ph.dead ?? -1) >= 0;
    const M = {};
    const put = (name, g, m) => { M[name] = worldMesh(g, m); };
    put('body', BASE.body, pz.body); put('head', BASE.head, pz.head); put('helmet', helmGeo, pz.head); put('pack', BASE.pack, pz.pack);
    put('pelvis', BASE.pelvis, pz.pelvis); put('neck', BASE.neck, pz.neck);
    if (PIECES) pieces.forEach((g, i) => put(`gear:${g.userData.name || i}`, g, pz.body)); else put('gear', gearGeo, pz.body);
    for (let k = 0; k < 2; k++) {
      put(`thigh${k}`, BASE.thigh, pz.legs[k][0]); put(`shin${k}`, BASE.shin, pz.legs[k][1]);
      put(`boot${k}`, BASE.boot, pz.feet[k]); put(`toe${k}`, BASE.toe, pz.toes[k]);
      put(`upperArm${k}`, BASE.upperArm, pz.arms[k][0]); put(`foreArm${k}`, BASE.foreArm, pz.arms[k][1]); put(`delt${k}`, BASE.delt, pz.delts[k]);
      const free = pz.curl[k] < 0.5;
      const hid = free ? (k === 0 ? 'oL' : 'oR') : k === 0 ? (HOLD[wid]?.grips?.lk === 'grip' ? 'G' : 'L') : 'R';
      put(`hand${k}`, BASE[hid], pz.hands[k]);
    }
    if (pz.showWeapon && !dead) wparts.forEach((g, i) => put(`weapon${i}`, g, pz.weapon));
    const names = Object.keys(M);
    for (const a of names) for (const b of names) {
      if (a === b) continue;
      const ba = base(a), bb = base(b);
      if (pairKey(ba, bb)) continue;
      // a limb segment and its own neighbours; the opposite side's parts count normally
      if (a.replace(/\D/g, '') && b.replace(/\D/g, '') && a.replace(/\D/g, '') === b.replace(/\D/g, '') && ((ba === 'thigh' && bb === 'boot') || (ba === 'upperArm' && bb === 'hand'))) continue;
      if (ba === 'weapon' && bb === 'weapon') continue;
      if (!M[a].box.clone().expandByScalar(DEEP).intersectsBox(M[b].box)) continue;
      let d = 0;
      for (const p of M[a].pts) d = Math.max(d, inside(p, M[b]));
      if (d > DEEP) {
        const key = `${kind} ${a}~${b}`;
        const w = worst.get(key) || { d: 0, ph: '', n: 0 };
        w.n++;
        if (d > w.d) { w.d = d; w.ph = ph.name; }
        worst.set(key, w);
      }
    }
  }
  process.stderr.write(`${kind} done\n`);
}
const rows = [...worst.entries()].sort((x, y) => y[1].d - x[1].d);
for (const [k, w] of rows) console.log(`${k.padEnd(34)} ${(w.d * 100).toFixed(1)} cm  (${w.n} poses, worst: ${w.ph})`);
console.log(rows.length ? `${rows.length} pairs deeper than ${DEEP * 100} cm` : 'no part pairs sink in');

if (process.env.CLOSED) for (const [k, g] of Object.entries(BASE)) console.log(k, isClosed(g) ? 'closed' : 'OPEN');
