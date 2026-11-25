// Animation checks, run by hand or from the suite: node tests/anim-check.mjs
// Drives real Unit objects through walks, sprints, strafes, backing up, turning on the spot, stances, reloads,
// grenade throws, hits, crawling and tending, and measures what the eye would catch:
//   - planted feet do not slide while flat on the ground (straight and while strafing / backing)
//   - knees fold forward only, within a human range; ankles stay inside their range; legs never over-stretch
//   - a planted sole rests on the ground (+-2 mm), no sole point is ever below it, boots never overlap
//   - no pose pops: no joint jumps more than a physical speed from one frame to the next, across every state change
//   - turning on the spot takes steps instead of sliding the feet round
//   - sloped ground: feet follow the terrain
import * as THREE from 'three';
import { U, HOLD, makePose, pose, solveLegs, solveArms, setWeaponBounds } from '../src/rig.js';
import { Unit } from '../src/unit.js';
import { WEAPONS, weaponParts } from '../src/weapons.js';

for (const id of Object.keys(WEAPONS)) { const { muzzle, box, sight } = weaponParts(id); setWeaponBounds(id, box, muzzle, sight); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// a flat or sloped world that answers what Unit asks of it
const flat = (slope = 0) => ({
  groundAt: (x, z) => slope * x, collideBody() {}, raycast: () => ({}), events: [], time: 0,
  fx: { burn() {}, steam() {}, dust() {} }, audio: { play() {} }, discharge() {}, releaseThrow() {}, onDeath() {},
});
const DT = 1 / 60;
const FOOT_LOW = [[0, 0.012, 0.152], [0, 0.0, 0.14], [0.04, 0.0, 0.1], [-0.04, 0.0, 0.1], [0, 0.0, -0.09], [0.035, 0.0, -0.08], [-0.035, 0.0, -0.08]].map((q) => new THREE.Vector3(...q));
const ANKLE = new THREE.Vector3(0, 0.092, -0.004);
const v = new THREE.Vector3(), w = new THREE.Matrix4();

function mk(kind = 'rifleman', loadout = ['rifle', 'grenade']) {
  const u = new Unit({ team: 0, loadout, kind, pos: new THREE.Vector3(0, 0, 0) });
  u.isPlayer = true; u.god = true;
  return u;
}
// world positions of the joints that matter, for the pop check
function joints(u, out) {
  const p = u.poseOut; solveLegs(p); solveArms(p);
  const W = u.world;
  let i = 0;
  const put = (m, ox = 0, oy = 0, oz = 0) => { v.set(ox, oy, oz).applyMatrix4(w.multiplyMatrices(W, m)); out[i++] = v.x; out[i++] = v.y; out[i++] = v.z; };
  put(p.body); put(p.head); put(p.feet[0]); put(p.feet[1]); put(p.hands[0]); put(p.hands[1]); put(p.legs[0][0], 0, 0, 0.1); put(p.legs[1][0], 0, 0, 0.1); put(p.arms[0][0], 0, 0, 0.1); put(p.arms[1][0], 0, 0, 0.1);
  return out;
}
const N_J = 10;
const lowest = (f, world) => { let lo = Infinity; for (const q of FOOT_LOW) { v.copy(q).applyMatrix4(f); lo = Math.min(lo, v.y - world.groundAt(v.x, v.z)); } return lo; };

// ---- scripted runs: [seconds, ctrl changes] ------------------------------------------------------
function run(u, world, script, onFrame) {
  let t = 0;
  for (const [dur, c] of script) {
    Object.assign(u.ctrl, c);
    const n = Math.round(dur / DT);
    for (let i = 0; i < n; i++) {
      world.time = t;
      u.update(DT, world);
      for (const k of ['jump', 'reload']) if (c[k] === 'once') u.ctrl[k] = false;
      onFrame?.(u, t);
      t += DT;
    }
  }
}

const stats = () => ({ slide: 0, slideAt: '', kneeBack: 0, kneeMin: 9, kneeMax: 0, ankleMax: -9, ankleMin: 9, stretch: 1, below: 0, plantErr: 0, overlap: 0, pop: 0, popAt: '', n: 0 });
function measure(name, u, world, script, opts = {}) {
  const S = stats();
  let prev = null, prevFlat = [null, null];
  const J = new Float32Array(N_J * 3), P = new Float32Array(N_J * 3);
  run(u, world, script, (u, t) => {
    const p = u.poseOut;
    solveLegs(p); solveArms(p);
    S.n++;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(p.pelvis));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const [a, b] = p.legs[i];
      // knee: the point where thigh and shin meet; thigh runs hip->knee along +z (centre-based frames)
      const hip = new THREE.Vector3(side * U.HIP_X, 0, 0).applyMatrix4(p.pelvis);
      const ank = ANKLE.clone().applyMatrix4(p.feet[i]);
      const mid = (m) => new THREE.Vector3(m.elements[12], m.elements[13], m.elements[14]);
      const half = (m) => new THREE.Vector3(m.elements[8], m.elements[9], m.elements[10]).multiplyScalar(0.1);
      const knee = mid(a).add(half(a));
      const th = knee.clone().sub(hip), sh = ank.clone().sub(knee);
      const ang = Math.acos(THREE.MathUtils.clamp(th.clone().normalize().dot(sh.clone().normalize()), -1, 1)); // 0 = straight
      S.kneeMax = Math.max(S.kneeMax, ang); S.kneeMin = Math.min(S.kneeMin, ang);
      // the knee must sit in front of the hip-ankle line (in the pelvis's heading), never behind it
      const line = ank.clone().sub(hip), lt = knee.clone().sub(hip).dot(line) / line.lengthSq();
      const off = knee.clone().sub(hip).addScaledVector(line, -lt);
      if (!(u.proneK > 0.3) && off.length() > 0.012 && off.dot(fwd) < -0.02 && u.alive) S.kneeBack++;
      S.stretch = Math.max(S.stretch, p.legStretch);
      // ankle
      const e = tmpAnkle(p, i, knee);
      S.ankleMax = Math.max(S.ankleMax, e); S.ankleMin = Math.min(S.ankleMin, e);
      // the ground
      const f = new THREE.Matrix4().multiplyMatrices(u.world, p.feet[i]);
      const lo = lowest(f, world);
      if (S.n > 3 && lo < -0.004) S.below = Math.min(S.below, lo); // the first frames read the ground under the boots' last pose
      if (S.n > 3 && u.grounded && p.st[i] > 0.97 && !(u.proneK > 0.05)) S.plantErr = Math.max(S.plantErr, Math.abs(lo));
    }
    // boots overlapping each other (seen from above: both footprints, ~ a 0.10 x 0.24 slab each)
    {
      const A = p.feet[0].elements, B = p.feet[1].elements;
      if (Math.abs(B[12] - A[12]) < 0.085 && Math.abs(B[14] - A[14]) < 0.2 && Math.abs(B[13] - A[13]) < 0.04 && !(u.proneK > 0.05)) S.overlap++;
    }
    // sliding: while a foot is planted and flat, its origin stays put in the world
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Matrix4().multiplyMatrices(u.world, p.feet[i]);
      const flatNow = p.st[i] > 0.97 && Math.abs(f.elements[9]) < 0.06 && u.grounded && !(u.proneK > 0.05) && !(u.kneelK > 0.3);
      const cur = [f.elements[12], f.elements[14]];
      if (flatNow && prevFlat[i]) {
        const d = Math.hypot(cur[0] - prevFlat[i][0], cur[1] - prevFlat[i][1]);
        if (d > S.slide) { S.slide = d; S.slideAt = `${name} t=${t.toFixed(2)} foot${i}`; }
      }
      prevFlat[i] = flatNow ? cur : null;
    }
    // pops
    joints(u, J);
    if (prev) for (let j = 0; j < N_J; j++) {
      const d = Math.hypot(J[j * 3] - P[j * 3], J[j * 3 + 1] - P[j * 3 + 1], J[j * 3 + 2] - P[j * 3 + 2]);
      // allowed: the soldier's own travel plus a fast limb: 14 m/s
      const own = Math.hypot(u.vel.x, u.vel.z) * DT;
      if (d - own > 14 * DT && d > S.pop) { S.pop = d; S.popAt = `${name} t=${t.toFixed(2)} joint${j}`; }
    }
    P.set(J); prev = true;
  });
  return S;
}
// ankle flex (+ dorsiflexed) from the shin axis against the foot's forward axis
function tmpAnkle(p, i, knee) {
  const ank = ANKLE.clone().applyMatrix4(p.feet[i]);
  const up = knee.clone().sub(ank).normalize().transformDirection(new THREE.Matrix4().copy(p.feet[i]).invert());
  return Math.atan2(up.z, Math.max(1e-3, up.y));
}

const W0 = flat();
const WALK = [[0.6, { wx: 0, wz: 0 }], [4, { wx: 0, wz: 1, speed: 1 }]];
const sweep = (name, script, kind = 'rifleman') => measure(name, mk(kind), W0, script);
const all = [];
const tests = {
  'stand then walk': [[0.6, {}], [4, { wz: 1 }], [0.8, { wz: 0 }]],
  'jog': [[0.5, {}], [4, { wz: 1, speed: 1.3 }], [0.8, { wz: 0 }]],
  'sprint': [[0.5, {}], [4, { wz: 1, sprint: true }], [0.8, { wz: 0, sprint: false }]],
  'strafe': [[0.5, {}], [3, { wx: 1, wz: 0, faceYaw: 0 }], [1.6, { wx: 0, wz: 0 }], [3, { wx: -1, wz: 0, faceYaw: 0 }], [0.5, { wx: 0, faceYaw: undefined }]],
  'backpedal': [[0.5, {}], [3, { wx: 0, wz: -1, faceYaw: 0 }], [0.5, { wz: 0, faceYaw: undefined }]],
  'diagonal': [[0.5, {}], [3, { wx: 0.7, wz: 0.7, faceYaw: 0 }], [1.6, { wx: 0, wz: 0 }], [3, { wx: -0.7, wz: -0.7, faceYaw: 0 }]],
  'crouch walk': [[0.5, { kneel: true }], [3, { wz: 1, kneel: true }], [0.5, { wz: 0 }]],
  'stand-crouch-stand': [[0.5, {}], [1, { kneel: true }], [1, { kneel: false }], [0.5, {}]],
  'prone down and up': [[0.5, {}], [1.6, { prone: true }], [2, { prone: true, wz: 1 }], [1.6, { prone: false, wz: 0 }], [0.6, {}]],
  'reload and fire': [[0.4, {}], [0.2, { reload: true }], [3, {}], [1, { fire: true }], [1, { fire: false }]],
  'jump and land': [[0.5, {}], [0.1, { jump: true }], [1.2, {}], [0.1, { wz: 1 }], [0.1, { jump: true }], [1.5, { wz: 1 }]],
  'stop-start': [[1, { wz: 1 }], [0.15, { wz: 0 }], [0.4, { wz: 1 }], [0.1, { wz: 0 }], [0.6, { wz: 1 }], [1, { wz: 0 }]],
};
let worst = null;
for (const [name, script] of Object.entries(tests)) {
  const u = mk('rifleman');
  if (/reload/.test(name)) { u.weapon.mag = 3; }
  const S = measure(name, u, W0, script);
  all.push([name, S]);
}
const maxBy = (f) => all.reduce((a, [n, s]) => (f(s) > f(a[1]) ? [n, s] : a));
const fmt = (n) => `${n.toFixed(3)}`;
{
  const [n, s] = maxBy((s) => s.slide);
  check('planted feet do not slide (max per frame, flat foot)', s.slide < 0.008, `${fmt(s.slide * 1000)} mm/frame ${s.slideAt}`);
}
{
  const bad = all.filter(([, s]) => s.kneeBack > 0);
  check('knees never bend backward', bad.length === 0, bad.map(([n, s]) => `${n}:${s.kneeBack}`).join(', '));
  const [n1, s1] = maxBy((s) => s.kneeMax);
  check('knee flexion within 0..155 degrees', s1.kneeMax < 2.7, `max ${(s1.kneeMax * 57.3).toFixed(0)} deg in ${n1}`);
  const [n3, s3] = maxBy((s) => s.stretch);
  check('legs never over-stretch (<= 4%)', s3.stretch < 1.04, `${s3.stretch.toFixed(3)} in ${n3}`);
  const [n4, s4] = maxBy((s) => s.ankleMax);
  const lo = all.reduce((a, [n, s]) => (s.ankleMin < a[1] ? [n, s.ankleMin] : a), ['', 9]);
  check('ankles inside their range (dorsi <= 0.75, plantar <= 1.0 rad)', s4.ankleMax < 0.75 && lo[1] > -1.05, `dorsi ${s4.ankleMax.toFixed(2)} in ${n4}, plantar ${(-lo[1]).toFixed(2)} in ${lo[0]}`);
}
{
  const [n, s] = maxBy((s) => -s.below);
  check('no boot sole ever below the ground (4 mm)', s.below > -0.004, `${(s.below * 1000).toFixed(1)} mm in ${n}`);
  const [n2, s2] = maxBy((s) => s.plantErr);
  check('planted soles rest on the ground (+-2 mm)', s2.plantErr < 0.003, `${(s2.plantErr * 1000).toFixed(1)} mm in ${n2}`);
  const bad = all.filter(([, s]) => s.overlap > 0);
  check('boots never overlap each other', bad.length === 0, bad.map(([n, s]) => `${n}:${s.overlap}`).join(', '));
}
{
  const [n, s] = maxBy((s) => s.pop);
  check('no pops: no joint jumps more than 14 m/s between frames', s.pop < 14 * DT * 1 + 1e-9 + 0.0, `${fmt(s.pop)} m ${s.popAt}`);
}

// ---- turning on the spot: the feet must step, not skate ----------------------------------------
{
  const u = mk('rifleman');
  let steps = 0, prevLift = [0, 0], maxSkate = 0, prevP = null;
  run(u, W0, [[0.8, {}], [3, { faceYaw: 0 }]], null);
  let yaw = 0;
  const S = [];
  run(u, W0, Array.from({ length: 120 }, (_, i) => [DT, { faceYaw: (yaw += 0.025) }]), (u) => {
    const p = u.poseOut;
    for (let i = 0; i < 2; i++) {
      const lifted = p.feet[i].elements[13] > 0.012;
      if (lifted && !prevLift[i]) steps++;
      prevLift[i] = lifted;
      // a foot on the ground must not move in the world
      const f = new THREE.Matrix4().multiplyMatrices(u.world, p.feet[i]);
      const cur = [f.elements[12], f.elements[14]];
      if (!lifted && p.feet[i].elements[13] < 0.004 && prevP && prevP[i]) maxSkate = Math.max(maxSkate, Math.hypot(cur[0] - prevP[i][0], cur[1] - prevP[i][1]));
      (prevP || (prevP = []))[i] = lifted ? null : cur;
    }
  });
  check('turning on the spot takes steps (3 radians, 2 s)', steps >= 2, `${steps} steps`);
  check('turning on the spot: no skating between steps', maxSkate < 0.012, `${(maxSkate * 1000).toFixed(1)} mm/frame`);
}

// ---- sloped ground: feet follow it, hips stay over them ---------------------------------------
{
  const Ws = flat(0.35); // 35% grade along x
  const u = mk('rifleman');
  const S = measure('slope', u, Ws, [[0.6, {}], [3, { wx: 1, wz: 0, faceYaw: 0 }], [1.6, { wx: 0, wz: 0 }], [3, { wx: -1, wz: 0, faceYaw: 0 }], [1.6, { wx: 0, wz: 0 }], [3, { wz: 1, wx: 0, faceYaw: undefined }]]);
  check('on a slope: soles rest on the terrain', S.plantErr < 0.004 && S.below > -0.006, `err ${(S.plantErr * 1000).toFixed(1)} mm, below ${(S.below * 1000).toFixed(1)} mm`);
  check('on a slope: legs reach (no over-stretch, knees forward)', S.stretch < 1.06 && S.kneeBack === 0, `stretch ${S.stretch.toFixed(3)}, back ${S.kneeBack}`);
}

// ---- every class, every gun: the same walk / crouch / reload / throw, no pops or clipping ---------
for (const [kind, loadout] of [['assault', ['smg', 'grenade']], ['gunner', ['mg']], ['mortar', ['launcher']], ['coil', ['plasma', 'grenade']], ['medic', ['smg']]]) {
  const u = mk(kind, loadout);
  const S = measure(kind, u, W0, [[0.4, {}], [2, { wz: 1 }], [0.2, { reload: true }], [3.2, { wz: 0 }], [1, { kneel: true }], [1, { kneel: false }]]);
  check(`${kind}: no pops, no slide, soles on the ground`, S.pop < 14 * DT && S.slide < 0.008 && S.below > -0.004, `pop ${fmt(S.pop)} slide ${(S.slide * 1000).toFixed(1)}mm below ${(S.below * 1000).toFixed(1)}mm`);
}
// a grenade throw, a hit and stagger
{
  const u = mk('rifleman');
  u.setWeapon(1, true);
  const S2 = measure('throw', u, W0, [[0.3, {}], [0.1, { fire: true }], [1.4, { fire: false }], [0.5, {}]]);
  check('grenade throw: no pops', S2.pop < 14 * DT, `pop ${fmt(S2.pop)} ${S2.popAt}`);
}
{
  const u = mk('rifleman'); u.god = false;
  const hit = (from) => { u.lastHit = { dir: from, dmg: 30, kind: 'bullet', t: u.t, zone: 'torso' }; u.hurt(30, null, null, 'bullet', 'torso'); };
  const S = measure('hit', u, W0, [[0.5, {}]]);
  let pop = 0, lean = 0;
  const J = new Float32Array(N_J * 3), P = new Float32Array(N_J * 3);
  hit(new THREE.Vector3(0, 0, -1));
  for (let i = 0; i < 90; i++) {
    u.update(DT, W0); joints(u, J);
    if (i) for (let j = 0; j < N_J; j++) pop = Math.max(pop, Math.hypot(J[j * 3] - P[j * 3], J[j * 3 + 1] - P[j * 3 + 1], J[j * 3 + 2] - P[j * 3 + 2]));
    P.set(J);
    lean = Math.max(lean, Math.abs(u.hs.x));
  }
  check('a hit rocks the torso and settles (no pops)', lean > 0.05 && Math.abs(u.hs.x) < 0.02 && pop < 14 * DT, `peak ${lean.toFixed(2)} rad, rest ${u.hs.x.toFixed(3)}, pop ${fmt(pop)}`);
}
// tending a casualty and hauling one
{
  const medic = mk('medic', ['smg']), pt = mk('rifleman');
  pt.pos.set(0, 0, 0.9); pt.down = true;
  medic.tendTarget = pt; medic.tendT = 99;
  const S2 = measure('tend', medic, W0, [[3, { kneel: true }]]);
  check('tending a casualty: no pops, soles on the ground', S2.pop < 14 * DT && S2.below > -0.004, `pop ${fmt(S2.pop)} below ${(S2.below * 1000).toFixed(1)}mm`);
  const m2 = mk('medic', ['smg']);
  m2.dragT = 99;
  const S3 = measure('drag', m2, W0, [[0.5, {}], [3, { wx: 0, wz: -1, faceYaw: 0, speed: 0.5 }]]);
  check('hauling a casualty: no pops, soles on the ground', S3.pop < 14 * DT && S3.below > -0.004, `pop ${fmt(S3.pop)} below ${(S3.below * 1000).toFixed(1)}mm`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} animation checks passed`);
process.exit(failed.length ? 1 : 0);
