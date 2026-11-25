import * as THREE from 'three';
import { gaitFor, footAt, hipBob } from './gait.js';

// The soldier: a human figure a little over a metre tall. A torso block (pelvis to shoulder line),
// a head that turns toward what it is aiming at, a pack, and four limbs of two jointed segments:
// arms that reach from the shoulders to the hands on the gun, legs from the hips to the boots.
// pose() turns animation state into part transforms in the unit's own frame (origin on the ground
// under the body, +z forward, +y up, so the right side is -x). Nothing here touches the scene, so
// the same maths drives the instanced crowd, the first-person view and the check suite.
export const U = {
  W: 0.3, H: 0.42, D: 0.2, R: 0.075, // torso block
  LIFT: 0.47, // torso bottom (the pelvis) above the ground when standing
  FOOT: [0.08, 0.04, 0.2], FOOT_X: 0.09, // boot: width, sole thickness, length
  LEG: [0.225, 0.215], HIP_X: 0.085, // thigh and shin, hip to ankle (see solveLegs)
  ARM: [0.22, 0.21], SH_X: 0.168, SH_Y: 0.15, // upper arm and forearm; shoulder joint from the torso centre
  HAND: [0.055, 0.05, 0.06],
  PACK: [0.24, 0.27, 0.1], PACK_Y: 0.7,
  EYE: 0.975,
  RADIUS: 0.3, // ground collision radius
  WEAPON_SCALE: 0.64,
  KNEEL_DROP: 0.15,
};
U.BODY_Y = U.LIFT + U.H / 2;
U.TOP = 1.08; // top of the helmet
U.NECK_Y = U.BODY_Y + U.H / 2 - 0.005; // base of the neck standing

// Per-weapon hold: where the support hand goes along the gun, and how far out from the body
// the gun rides. Filled in from the weapon models' bounds by setWeaponBounds().
export const HOLD = {};
// Per-weapon handling: how far the gun kicks back and climbs per shot, and the reload move
// (support hand target [y, z] in gun space, gun tilt up, roll, and how far it drops).
export const ANIM = {
  rifle: { kick: 0.05, climb: 0.1, hand: [-0.1, 0.07], tilt: 0.35, roll: 0.55, drop: 0.07 },
  smg: { kick: 0.022, climb: 0.05, hand: [-0.17, 0.1], tilt: 0.3, roll: 0.35, drop: 0.06 },
  mg: { kick: 0.035, climb: 0.05, hand: [0.13, 0.1], tilt: 0.5, roll: 0.15, drop: 0.11 },
  plasma: { kick: 0.012, climb: 0.04, hand: [-0.09, 0.08], tilt: 0.2, roll: 0.6, drop: 0.05 },
  launcher: { kick: 0.07, climb: 0.13, hand: [0.1, 0.2], tilt: 0.7, roll: 0.0, drop: 0.08 },
  grenade: { kick: 0, climb: 0, hand: [0, 0], tilt: 0, roll: 0, drop: 0 },
};
export function setWeaponBounds(id, box, muzzle, sight = box.max.y) {
  const s = U.WEAPON_SCALE;
  const half = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * s;
  HOLD[id] = {
    x: 0.12,
    fore: Math.min(box.max.z * s * 0.3, 0.14), // the support hand rides the rear half of the fore-end, within an arm's reach
    foreY: Math.min(-0.03, box.min.y * s * 0.3 - 0.012),
    muzzle: new THREE.Vector3(...muzzle).multiplyScalar(s),
    oneHand: id === 'grenade',
    anim: ANIM[id],
    low: Math.max(0, -box.min.y) * s,
    back: Math.max(0, -box.min.z) * s, // how far the stock reaches behind the grip
    top: box.max.y * s,
    sight: sight * s,
    // gun bounds in its own (scaled) frame, for the dropped-gun physics
    half: new THREE.Vector3().subVectors(box.max, box.min).multiplyScalar(s / 2),
    mid: new THREE.Vector3().addVectors(box.max, box.min).multiplyScalar(s / 2),
  };
}

const E = new THREE.Euler(0, 0, 0, 'YXZ');
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const P = new THREE.Vector3();
const S1 = new THREE.Vector3(1, 1, 1);
const T = new THREE.Vector3();
const M = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const lerp = THREE.MathUtils.lerp;
const FO = { along: 0, lift: 0, pitch: 0, stance: 0 };
const HIP_UP = 0.035, ANKLE = 0.092; // hip joint above the body's bottom; ankle above the sole

function compose(out, x, y, z, rx = 0, ry = 0, rz = 0) {
  E.set(rx, ry, rz, 'YXZ');
  Q.setFromEuler(E);
  return out.compose(P.set(x, y, z), Q, S1);
}

// head and pack ride on the body
export function attachToBody(out, headYaw = 0, headPitch = 0) {
  M.copy(out.body);
  // the head turns and tips toward what the soldier is aiming at, pivoting at the base of the neck
  compose(out.head, 0, U.H / 2 - 0.005, 0.004, -headPitch, headYaw, 0);
  out.head.multiplyMatrices(M, out.head);
  out.pack.multiplyMatrices(M, compose(out.pack, 0, U.PACK_Y - U.BODY_Y, -U.D / 2 - U.PACK[2] / 2 + 0.03));
  return out;
}

export function makePose() {
  return {
    body: new THREE.Matrix4(), head: new THREE.Matrix4(), pack: new THREE.Matrix4(),
    feet: [new THREE.Matrix4(), new THREE.Matrix4()], hands: [new THREE.Matrix4(), new THREE.Matrix4()],
    legs: [[new THREE.Matrix4(), new THREE.Matrix4()], [new THREE.Matrix4(), new THREE.Matrix4()]],
    arms: [[new THREE.Matrix4(), new THREE.Matrix4()], [new THREE.Matrix4(), new THREE.Matrix4()]],
    weapon: new THREE.Matrix4(), muzzle: new THREE.Vector3(), showWeapon: true, height: U.TOP,
  };
}

// s: { t, walk, cycle, stride, mx, mz (local move dir), air, rise, land, kneel, aimPitch, twist,
//      ready (0 lowered .. 1 shouldered), recoil, reload (-1 or 0..1), throw (-1 or 0..1),
//      flinch, ads (0..1, first person centre), fp (first person view), dead (-1 or 0..1 topple), weapon, sprint }
function poseCore(s, out) {
  const t = s.t || 0, walk = s.walk || 0, kneel = s.kneel || 0, air = s.air || 0;
  const mx = s.mx ?? 0, mz = s.mz ?? 1;
  const cyc = s.cycle || 0;
  const dead = s.dead ?? -1;
  // gait: everything about the stride follows ground speed (see gait.js)
  const g = gaitFor(s.speed ?? walk * 2.2);
  const w = walk;
  const ground = 1 - air;
  const kneelStill = kneel * (1 - w); // one knee down; moving crouched is a walk with bent legs
  out.gait = g;

  // ---- feet: planted while they carry the body, lifted and swung through between strikes
  const sx = [0, 0], sy = [0, 0], sz = [0, 0], srx = [0, 0];
  if (dead < 0) {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      footAt((cyc + (i ? 0.5 : 0)) % 1, g, FO);
      let x = side * lerp(U.FOOT_X, 0.065, g.run * w), y = 0, z = 0, rx = 0;
      x += mx * FO.along * w * 0.7; // side steps are shorter
      z += mz * FO.along * w;
      y += FO.lift * w * (1 - 0.45 * kneel);
      rx = -FO.pitch * w * Math.max(0, mz);
      // the foot rolls about its heel at touchdown and its toe at push-off, never into the ground
      { const pt = -rx; y += pt > 0 ? 0.085 * Math.sin(pt) : 0.135 * Math.sin(-pt); }
      // in the air the legs tuck on the way up and reach for the ground on the way down
      if (air > 0) {
        const rise = s.rise || 0;
        const az = i ? -0.09 : 0.11, ay = (i ? 0.17 : 0.1) * (rise > 0 ? 1 : 0.5) + 0.03;
        z = lerp(z, az, air); y = lerp(y, ay, air); rx = lerp(rx, (i ? 0.5 : -0.2), air);
      }
      // kneel: one foot forward, the other tucked back up on its toe
      if (kneelStill > 0) {
        z = lerp(z, i ? 0.25 : -0.26, kneelStill);
        y = lerp(y, i ? 0 : 0.108, kneelStill);
        rx = lerp(rx, i ? 0 : 0.9, kneelStill);
      }
      sx[i] = x; sy[i] = y; sz[i] = z; srx[i] = rx;
    }
  }

  // ---- body: breathes at rest, bobs and dips with the stride, leans into the run, sinks on landing
  const breathe = Math.sin(t * 1.7) * 0.006 * (1 - walk);
  const land = (s.land || 0) * 0.07;
  const bobY = ground * w * hipBob(cyc, g) * (1 - 0.7 * kneel);
  const drop = kneel * U.KNEEL_DROP * (1 - 0.15 * w) + land - air * 0.02 * (s.rise || 0);
  const lean = g.lean * w * ground + 0.12 * kneel + (s.flinch || 0) * -0.1;
  const sway = Math.sin(cyc * Math.PI * 2) * (0.02 + 0.035 * g.run) * w * ground;
  // lean toward the move direction (pitch for forward/back, roll for sideways)
  const mzf = w > 0.05 ? (mz > 0 ? mz : mz * 0.3) : 1;
  const pitchLean = lean * mzf + 0.05 * air * (s.rise || 0);
  const rollLean = -lean * (w > 0.05 ? mx : 0) * 0.7 + sway;
  // the shoulders turn against the hips as the arms swing
  const yaw = -Math.sin(cyc * Math.PI * 2) * g.twist * w * ground * Math.max(0, mz);
  let by = U.BODY_Y + bobY + breathe - drop;
  // never ask a leg to reach further than it can: lower the hips until both feet are in reach
  if (dead < 0) {
    let hip = by - U.H / 2 + HIP_UP;
    for (let i = 0; i < 2; i++) {
      const hx = (i === 0 ? -1 : 1) * U.HIP_X;
      const dx = sx[i] - hx, dz = sz[i];
      const reach = (U.LEG[0] + U.LEG[1]) * 0.985;
      const lim = sy[i] + ANKLE + Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
      if (lim < hip) hip = lim;
    }
    by = hip + U.H / 2 - HIP_UP;
  }
  // the body pivots about its base so leaning doesn't swing the feet
  const base = by - U.H / 2;
  E.set(pitchLean, yaw, rollLean, 'YXZ');
  Q.setFromEuler(E);
  T.set(0, U.H / 2, 0).applyQuaternion(Q);
  out.body.compose(P.set(0, base + T.y, T.z), Q, S1);
  out.body.elements[12] += T.x;

  if (dead >= 0) {
    // topple backwards about the rear bottom edge and settle on the ground
    const k = smooth(0, 1, dead);
    const ang = -k * (Math.PI / 2 - 0.04);
    E.set(ang, 0, 0, 'YXZ');
    Q.setFromEuler(E);
    const pz = -U.D / 2, py = U.LIFT * (1 - k) + 0.075 * k; // lies on its pack
    T.set(0, U.H / 2, U.D / 2).applyQuaternion(Q);
    out.body.compose(P.set(0, py + T.y, pz + T.z), Q, S1);
    by = py + T.y;
  }

  out.pitch = g.lean * w * ground * mzf; // the run's lean alone: held items follow it
  attachToBody(out, THREE.MathUtils.clamp(s.twist || 0, -0.5, 0.5) * 0.3, THREE.MathUtils.clamp(s.aimPitch || 0, -0.6, 0.6) * 0.35 * (dead >= 0 ? 0 : 1));

  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    if (dead >= 0) {
      // lying on its back: the legs stretch out ahead of the hips, toes up
      const k = smooth(0, 1, dead);
      compose(out.feet[i], side * U.FOOT_X * lerp(1, 1.25, k), lerp(0, 0.055, k), lerp(0, 0.36, k), -k * 1.25, 0, 0);
    } else compose(out.feet[i], sx[i], sy[i], sz[i], srx[i], 0, 0);
  }

  // ---- weapon and hands
  const id = s.weapon || 'rifle';
  const h = HOLD[id] || { x: 0.31, fore: 0.25, foreY: -0.04, muzzle: new THREE.Vector3(0, 0.03, 0.5), oneHand: false };
  const ready = s.ready ?? 1, ads = s.ads || 0, recoil = s.recoil || 0;
  const twist = THREE.MathUtils.clamp(s.twist || 0, -0.5, 0.5);
  out.showWeapon = dead < 0;
  if (dead >= 0) {
    const k = smooth(0, 1, dead);
    for (let i = 0; i < 2; i++) compose(out.hands[i], (i ? -1 : 1) * lerp(0.2, 0.24, k), lerp(0.62, 0.035, k), lerp(0.1, 0.0, k), 0, 0, 0);
    out.weapon.copy(out.hands[1]);
    return out;
  }
  const bodyDrop = U.BODY_Y - by;
  if (h.oneHand) {
    // grenade in the right hand; throw: wind up behind, release over the top, follow through
    const th = s.throw ?? -1;
    let rx = -0.24, ry = 0.58, rz = 0.18, lx = 0.22, ly = 0.5, lz = 0.06;
    if (th >= 0) {
      const a = smooth(0, 0.42, th), b = smooth(0.42, 0.62, th), c = smooth(0.62, 1, th);
      rx = lerp(-0.24, -0.3, a); ry = lerp(lerp(0.58, 1.0, a), 0.86, b); rz = lerp(lerp(0.18, -0.04, a), 0.42, b);
      ry = lerp(ry, 0.58, c); rz = lerp(rz, 0.18, c); rx = lerp(rx, -0.24, c);
      lx = lerp(0.22, 0.2, a); ly = lerp(0.5, 0.78, a * (1 - c)); lz = lerp(0.06, 0.3, a * (1 - c));
    }
    compose(out.hands[1], rx, ry - bodyDrop, rz, -0.3, 0, 0);
    compose(out.hands[0], lx, ly - bodyDrop, lz, 0, 0, 0);
    out.weapon.multiplyMatrices(out.hands[1], compose(M, 0, 0.0, 0.03, -Math.PI / 2 + 0.4, 0, 0));
    out.muzzle.setFromMatrixPosition(out.hands[1]);
    return out;
  }

  // shoulder pivot: follows the body's height; the gun stays in a plane beside the body
  const reload = s.reload ?? -1;
  const rk = reload >= 0 ? Math.sin(Math.min(1, reload) * Math.PI) : 0;
  const lowered = 1 - ready;
  // first person pulls the gun in a little lower and further forward so it frames the view
  const fp = (s.fp || 0) * (1 - ads);
  // aimed (shouldered): the gun tucks in beside the cheek and rises to eye level
  const aimK = smooth(0.55, 1, ready) * (1 - rk);
  // (the grip sits in front of the right shoulder; the butt rests in its pocket)
  const px = lerp(-h.x, 0, ads);
  const py = lerp(0.77 + aimK * 0.04, U.EYE - (h.sight || 0.06), ads) - bodyDrop - lowered * 0.09 - rk * h.anim.drop;
  const pz = lerp(0.27, 0.22, ads);
  const pitch = (s.aimPitch || 0) - lowered * 0.55 - rk * h.anim.tilt + recoil * h.anim.climb;
  // twist turns the whole arms-and-gun assembly about the body's axis
  E.set(0, twist, 0, 'YXZ');
  Q2.setFromEuler(E);
  // the rifle crosses in front of the right shoulder: butt at the shoulder, muzzle toward the middle
  E.set(-pitch, twist + 0.2 * (1 - ads), -rk * h.anim.roll, 'YXZ');
  Q.setFromEuler(E);
  T.set(px, py, pz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, twist);
  // the grip sits a little forward and below the shoulder line; recoil kicks it back
  P.set(0, 0, -recoil * h.anim.kick).applyQuaternion(Q).add(T);
  out.weapon.compose(P, Q, S1);
  out.muzzle.copy(h.muzzle).applyMatrix4(out.weapon);
  // trigger hand just under the grip; support hand on the fore-end, or on the mag mid-reload
  out.hands[1].multiplyMatrices(out.weapon, compose(M, 0, -0.032, -0.006));
  const fz = lerp(h.fore, h.anim.hand[1], rk), fy = lerp(h.foreY, h.anim.hand[0], rk);
  out.hands[0].multiplyMatrices(out.weapon, compose(M, 0, fy, fz));
  return out;
}

// Posture on top of the stance: lean (Q/E) rolls the upper body about the hips; prone lays the
// body face down along the facing, feet behind, and carries the gun forward at ground level.
const R = new THREE.Matrix4();
const R2 = new THREE.Matrix4();
const G = new THREE.Vector3();
const HP = new THREE.Vector3(), HL = new THREE.Matrix4(), HR = new THREE.Matrix4();
const V3 = new THREE.Vector3();
export const PRONE = { PIVOT: U.D / 2 + 0.02, BACK: 0.5, GUN_Y: 0.3, ANGLE: Math.PI / 2 * 0.94 };
export function pose(s, out = makePose()) {
  poseCore(s, out);
  followLean(s, out);
  freeArm(s, out);
  postures(s, out);
  crawl(s, out);
  clutch(s, out);
  return out;
}

// The gun rides with the chest as the body leans into a run, so the two never swing into each other.
const LR = new THREE.Matrix4(), LT = new THREE.Matrix4();
function followLean(s, out) {
  const a = (out.pitch || 0) * (0.5 + 0.5 * (1 - (s.ready ?? 1)));
  if (Math.abs(a) < 0.003 || (s.dead ?? -1) >= 0) return;
  LR.makeTranslation(0, U.LIFT, 0).multiply(LT.makeRotationX(a)).multiply(M2.makeTranslation(0, -U.LIFT, 0));
  out.weapon.premultiply(LR); out.hands[0].premultiply(LR); out.hands[1].premultiply(LR);
  out.muzzle.applyMatrix4(LR);
}

// Sprinting with a gun: it rides in the right hand at the hip while the left arm, released from
// the fore-end, pumps against the legs with the elbow bent. k: 0 on the gun .. 1 swinging free.
const FH = new THREE.Vector3(), FP = new THREE.Vector3(), FQ = new THREE.Quaternion(), FQ2 = new THREE.Quaternion(), FS = new THREE.Vector3();
function freeArm(s, out) {
  const k = s.free || 0;
  if (k < 0.001 || (s.dead ?? -1) >= 0 || (s.prone || 0) > 0.01 || !out.gait) return;
  const g = out.gait;
  const sw = Math.cos((s.cycle || 0) * Math.PI * 2); // left arm forward as the right foot lands
  const fwd = Math.max(0, sw);
  compose(M, U.SH_X + 0.025, -0.2 + 0.07 * g.run + 0.09 * fwd, 0.05 + sw * g.swing * 1.25, -0.5 - 0.6 * g.run - 0.3 * sw, 0, 0.15);
  M2.multiplyMatrices(out.body, M);
  const h = out.hands[0];
  h.decompose(FP, FQ, FS);
  M2.decompose(FH, FQ2, FS);
  FP.lerp(FH, k); FQ.slerp(FQ2, k);
  h.compose(FP, FQ, S1);
}

// Crawling on the belly: the feet take turns pushing, and a downed soldier hauls forward on one hand.
function crawl(s, out) {
  const k = smooth(0, 1, s.prone || 0), w = (s.walk || 0) * k;
  if (w < 0.01) return;
  const c = (s.cycle || 0) * Math.PI * 2;
  for (let i = 0; i < 2; i++) {
    const a = c + (i ? Math.PI : 0), f = out.feet[i];
    f.elements[14] += Math.sin(a) * 0.07 * w;
    f.elements[13] += Math.max(0, -Math.cos(a)) * 0.04 * w;
  }
  if (s.down) {
    const h = out.hands[0], a = c + Math.PI * 0.5;
    h.elements[14] += Math.sin(a) * 0.05 * w;
    h.elements[13] += Math.max(0, Math.cos(a)) * 0.04 * w - 0.03 * w;
  }
}

// A man hit in the body doubles over: the chest folds forward over the hips and the free hand
// goes to the wound. k: 0 upright .. 1 doubled over.
const CP = new THREE.Vector3();
function clutch(s, out) {
  const k = s.dying || 0;
  if (k < 0.01 || (s.dead ?? -1) >= 0 || (s.prone || 0) > 0.3) return;
  const a = 0.55 * k + 0.05 * k * Math.sin((s.t || 0) * 8);
  const py = U.LIFT + 0.15;
  R.makeTranslation(0, py, 0).multiply(R2.makeRotationX(a)).multiply(M.makeTranslation(0, -py, 0));
  for (const m of [out.body, out.head, out.pack, out.weapon, out.hands[0], out.hands[1]]) m.premultiply(R);
  out.muzzle.applyMatrix4(R);
  // the off hand presses the belly
  const h = out.hands[0];
  h.decompose(FP, FQ, FS);
  CP.set(0.07, -0.08, U.D / 2 + 0.04).applyMatrix4(out.body);
  FP.lerp(CP, Math.min(1, k * 1.4));
  h.compose(FP, FQ, S1);
}

function postures(s, out) {
  const h = HOLD[s.weapon || 'rifle'] || {};
  const lean = s.lean || 0, prone = s.prone || 0;
  if (Math.abs(lean) < 0.001 && prone < 0.001) return out;
  const upper = [out.body, out.head, out.pack];
  const held = [out.weapon, out.hands[0], out.hands[1]];
  if (Math.abs(lean) > 0.001) {
    // roll about the forward axis through the hips; +lean tips toward the right (-x)
    const py = U.LIFT + 0.15;
    R.makeTranslation(0, py, 0).multiply(R2.makeRotationZ(lean * 0.32)).multiply(M.makeTranslation(0, -py, 0));
    for (const m of upper) m.premultiply(R);
    for (const m of held) m.premultiply(R);
    out.muzzle.applyMatrix4(R);
  }
  if (prone > 0.001) {
    const k = smooth(0, 1, prone);
    const th = PRONE.ANGLE * k;
    const P0 = PRONE.PIVOT * k + (U.LIFT) * (1 - k);
    // rotate about the x axis through (0, P0, 0), then slide back so the body centre stays put
    R.makeTranslation(0, P0 + 0.05 * Math.sin(Math.PI * k) , -PRONE.BACK * k).multiply(R2.makeRotationX(th)).multiply(M.makeTranslation(0, -P0, 0));
    for (const m of upper) m.premultiply(R);
    for (const f of out.feet) { f.premultiply(R); f.elements[13] -= 0.03 * k * k * k; } // toes rest on the ground
    // the head and neck lift to look where the gun points, instead of pressing the face into the dirt
    HP.setFromMatrixPosition(out.head);
    out.head.premultiply(HL.makeTranslation(-HP.x, -HP.y, -HP.z)).premultiply(HR.makeRotationX(-th * 0.9)).premultiply(HL.makeTranslation(HP.x, HP.y, HP.z));
    // the gun keeps its aim; it moves out past the head, butt just clear of it, low to the ground,
    G.setFromMatrixPosition(out.weapon);
    let headZ = -Infinity;
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) headZ = Math.max(headZ, V3.set(0, sy * U.H / 2, sz * U.D / 2).applyMatrix4(out.body).z);
    const gz = lerp(G.clone().applyMatrix4(R).z, headZ - 0.1 + (h.back || 0.3), k);
    T.set(0, lerp(G.y, Math.max(0.1, Math.min(0.16, (h.low || 0.1) + 0.02)), k) - G.y, gz - G.z);
    R.makeTranslation(T.x, T.y, T.z);
    for (const m of held) m.premultiply(R);
    out.muzzle.applyMatrix4(R);
  }
  return out;
}

// ---- legs: two-segment IK from the hips to the feet -----------
// Segment matrices come out in the same frame as the pose (unit-local, or world for ragdolls):
// origin at the segment's middle, +z along it, length scaled to fit. Reach is stretched, never
// broken, so a limb always joins its hand or foot to the body.
const _s = new THREE.Vector3(), _t = new THREE.Vector3(), _k = new THREE.Vector3(), _d = new THREE.Vector3();
const _pole = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _bp = new THREE.Vector3();
const _a = new THREE.Vector3(), _up = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);
function segment(out, a, b, over) {
  _d.subVectors(b, a);
  const len = _d.length();
  if (len < 1e-5) return out.identity();
  _d.multiplyScalar(1 / len);
  _q.setFromUnitVectors(_z, _d);
  return out.compose(_k.addVectors(a, b).multiplyScalar(0.5), _q, _bs.set(1, 1, (len + over) / SEG_LEN));
}
export const SEG_LEN = 0.2; // nominal length the limb geometry is built at
// joint(out2, root, target, l1, l2, pole): returns the stretch factor used
const _e = new THREE.Vector3();
function joint(out, root, target, l1, l2, pole, over) {
  _d.subVectors(target, root);
  let d = _d.length();
  const reach = l1 + l2;
  const stretch = Math.max(1, d / (reach * 0.995));
  const a = l1 * stretch, b = l2 * stretch;
  d = Math.min(d, (a + b) * 0.995);
  _d.normalize();
  // bend plane from the pole direction; knee/elbow sits off the line by the triangle's height
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  _up.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_up.lengthSq() < 1e-6) _up.set(0, 0, 1).addScaledVector(_d, -_d.z);
  _up.normalize();
  _a.copy(root).addScaledVector(_d, x).addScaledVector(_up, h);
  // a knee or elbow of a body lying down can't sink into the ground (p.floor is set for ragdolls)
  if (FLOOR) { const g = FLOOR(_a.x, _a.z, _a.y) + 0.05; if (_a.y < g) _a.y = g; }
  const full = target.distanceTo(root) > d + 1e-4;
  _e.copy(root).addScaledVector(_d, d); // reachable end (target when within reach)
  segment(out[0], root, _a, over);
  segment(out[1], _a, full ? _e : target, over);
  return stretch;
}
let FLOOR = null;
export const SEG_OVER = 0.0; // limb segments overlap their joints by this much
const _ank = new THREE.Vector3(0, 0.092, -0.004);
export function solveLegs(p) {
  FLOOR = p.floor || null;
  M.copy(p.body);
  M.decompose(_bp, _bq, _bs);
  p.legStretch = 1;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1; // feet[0] is the right foot (-x)
    _s.set(side * U.HIP_X, -U.H / 2 + 0.035, 0).applyMatrix4(p.body);
    _t.copy(_ank).applyMatrix4(p.feet[i]);
    _pole.set(side * 0.12, 0, 1).applyQuaternion(_bq);
    p.legStretch = Math.max(p.legStretch, joint(p.legs[i], _s, _t, U.LEG[0], U.LEG[1], _pole, 0.02));
  }
  FLOOR = null;
  return p;
}
// arms: shoulder joint to the hand, elbows down and out. hands[0] is the left (support) hand at +x.
export function solveArms(p) {
  FLOOR = p.floor || null;
  M.copy(p.body);
  M.decompose(_bp, _bq, _bs);
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    _s.set(side * U.SH_X, U.SH_Y, -0.005).applyMatrix4(p.body);
    _t.setFromMatrixPosition(p.hands[i]);
    _pole.set(side * 0.7, -1, -0.5).applyQuaternion(_bq);
    joint(p.arms[i], _s, _t, U.ARM[0], U.ARM[1], _pole, 0.02);
  }
  FLOOR = null;
  return p;
}
