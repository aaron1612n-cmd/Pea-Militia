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
  ARM: [0.22, 0.17], SH_X: 0.168, SH_Y: 0.15, // upper arm and forearm (elbow to wrist); shoulder joint from the torso centre
  WRIST: [0, -0.012, -0.058], // the wrist, in the hand's own frame (the hand mesh carries the glove cuff around it)
  BALL: 0.07, // ball of the foot, ahead of the boot origin: the toe box hinges here
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
// Hand anchors per gun, in the gun's own (unscaled hold) units: grip at the origin, barrel along +z.
//  rh: trigger hand on the pistol grip [y, z]; its index finger lies along the receiver by the trigger.
//  lh: support hand on the real hold of that gun: [y, z, rx, ry, rz]. The hand model wraps a bar along
//      z with its palm under it ('cup'); a vertical foregrip turns it a quarter about x so it wraps along y.
//  mag: where the support hand goes to work the magazine (or shell) mid-reload.
// Walk / run carry: [lift, pull back, pitch (+ muzzle up), yaw] added to the ready pose, and how hard the
// gun bobs with each stride. Each gun is carried the way it is meant to be: rifle low-ready, SMG high at
// the chest, MG slung on the hip, coil gun across the body, mortar on the shoulder.
const QV = Math.PI / 2;
export const GRIPS = {
  rifle: { x: 0.11, pz: 0.24, rh: [-0.036, -0.012], lh: [0.0, 0.3, 0, 0, 0], mag: [-0.03, 0.085, 0, 0, 0],
    walk: [0, 0, -0.04, 0], run: [-0.02, 0.02, -0.16, 0.1], bob: 0.5 },
  smg: { x: 0.11, pz: 0.24, rh: [-0.036, -0.004], lh: [-0.044, 0.282, 0, 0, 0], lk: 'grip', mag: [-0.095, 0.1, 0, 0, 0],
    walk: [0.01, 0, 0.06, 0], run: [0.03, 0.0, 0.2, 0.12], bob: 0.4 },
  mg: { x: 0.1, pz: 0.23, rh: [-0.036, -0.012], lh: [-0.075, 0.35, 0, 0, 0], mag: [-0.1, 0.12, 0, 0, 0],
    walk: [-0.01, 0, -0.1, 0], run: [-0.03, 0.01, -0.22, 0.14], bob: 1.1 },
  plasma: { x: 0.11, pz: 0.26, rh: [-0.036, -0.012], lh: [-0.034, 0.12, 0, 0, 0], mag: [-0.1, 0.12, 0, 0, 0],
    walk: [0, 0, 0.0, -0.05], run: [0.01, 0, 0.12, -0.1], bob: 0.5 },
  launcher: { x: 0.08, pz: 0.2, rh: [-0.03, 0.0], lh: [-0.04, 0.12, 0, 0, 0], mag: [0.15, 0.1, 0, 0, 0],
    walk: [0.02, 0, 0.2, 0], run: [0.05, 0.02, 0.45, 0.1], bob: 0.9 },
  grenade: null,
};
const anchor = (g, s) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(0, g[0] * s, g[1] * s),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(g[2] || 0, g[3] || 0, g[4] || 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
  return { m, p: new THREE.Vector3().setFromMatrixPosition(m), q: new THREE.Quaternion().setFromRotationMatrix(m) };
};
export function setWeaponBounds(id, box, muzzle, sight = box.max.y) {
  const s = U.WEAPON_SCALE;
  const G = GRIPS[id];
  const half = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * s;
  HOLD[id] = {
    x: G ? G.x : 0.12,
    pz: G ? G.pz : 0.27,
    fore: Math.min(box.max.z * s * 0.3, 0.14), // the support hand rides the rear half of the fore-end, within an arm's reach
    foreY: Math.min(-0.03, box.min.y * s * 0.3 - 0.012),
    muzzle: new THREE.Vector3(...muzzle).multiplyScalar(s),
    oneHand: id === 'grenade',
    anim: ANIM[id],
    grips: G,
    rh: G ? anchor([G.rh[0], G.rh[1]], s) : null,
    lhA: G ? anchor(G.lh, s) : null,
    magA: G ? anchor(G.mag, s) : null,
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

const BP = new THREE.Vector3(), BQ = new THREE.Quaternion();
// out = parent * (anchor a blended toward anchor b by k)
function blendAnchor(out, parent, a, b, k) {
  BP.lerpVectors(a.p, b.p, k); BQ.copy(a.q).slerp(b.q, k);
  M2.compose(BP, BQ, S1);
  return out.multiplyMatrices(parent, M2);
}

function compose(out, x, y, z, rx = 0, ry = 0, rz = 0) {
  E.set(rx, ry, rz, 'YXZ');
  Q.setFromEuler(E);
  return out.compose(P.set(x, y, z), Q, S1);
}

// a boot at (x, y, z) pitched by rx: toe up turns about the origin (the caller lifts it off the heel); toe
// down turns about the ball of the foot, so the toes stay planted while the heel rises
const FV = new THREE.Vector3();
function footMat(out, x, y, z, rx) {
  if (rx > 0) {
    E.set(rx, 0, 0, 'YXZ'); Q.setFromEuler(E);
    FV.set(0, 0, U.BALL).sub(T.set(0, 0, U.BALL).applyQuaternion(Q));
    return out.compose(P.set(x, y + FV.y, z + FV.z), Q, S1);
  }
  return compose(out, x, y, z, rx);
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
    pelvis: new THREE.Matrix4(), neck: new THREE.Matrix4(), toes: [new THREE.Matrix4(), new THREE.Matrix4()], delts: [new THREE.Matrix4(), new THREE.Matrix4()],
    spine: [0, 0, 0], // pelvis against the chest: yaw, pitch, roll (rad)
    toeRel: [0, 0], // toe box against the rest of the boot (rad, positive tips the toe down)
    curl: [1, 1], trig: 0, // fingers: 0 open .. 1 closed on the gun; the trigger finger of the right hand straight (1) or on the trigger (0)
    sway: new Float32Array(10), // secondary motion of worn kit: [x, z] swing of hip kit (right, left), antennas, straps, tags
    feet: [new THREE.Matrix4(), new THREE.Matrix4()], hands: [new THREE.Matrix4(), new THREE.Matrix4()],
    legs: [[new THREE.Matrix4(), new THREE.Matrix4()], [new THREE.Matrix4(), new THREE.Matrix4()]],
    arms: [[new THREE.Matrix4(), new THREE.Matrix4()], [new THREE.Matrix4(), new THREE.Matrix4()]],
    weapon: new THREE.Matrix4(), muzzle: new THREE.Vector3(), showWeapon: true, height: U.TOP,
    mvReload: -1, mvRack: 0, mvRecoil: 0,
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
  const limp = Math.abs(s.limp || 0);
  const kneelStill = kneel * (1 - w); // one knee down; moving crouched is a walk with bent legs
  out.gait = g;
  out.mvReload = s.reload ?? -1; out.mvRack = s.rack || 0; out.mvRecoil = s.recoil || 0; // drives the gun's moving parts (magazine, bolt)

  // ---- feet: planted while they carry the body, lifted and swung through between strikes
  if (dead < 0) {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      footAt((cyc + (i ? 0.5 : 0)) % 1, g, FO);
      let x = side * lerp(U.FOOT_X, 0.065, g.run * w), y = 0, z = 0, rx = 0;
      x += mx * FO.along * w * 0.7; // side steps are shorter
      x = side < 0 ? Math.min(x, -0.055) : Math.max(x, 0.055); // a foot never crosses the midline: the legs would scissor through each other
      z += mz * FO.along * w;
      y += FO.lift * w * (1 - 0.45 * kneel);
      if (limp && side === Math.sign(s.limp)) { z *= 1 - 0.4 * limp; y *= 1 - 0.55 * limp; } // the hurt leg takes a short, flat step
      rx = -FO.pitch * w * Math.max(0, mz);
      // the foot rolls about its heel at touchdown; at push-off it pivots about the ball of the foot (see footMat)
      if (rx < 0) y += 0.085 * Math.sin(-rx);
      // in the air the legs tuck on the way up and reach for the ground on the way down
      if (air > 0) {
        const rise = s.rise || 0;
        const az = i ? -0.09 : 0.11, ay = (i ? 0.17 : 0.1) * (rise > 0 ? 1 : 0.5) + 0.03;
        z = lerp(z, az, air); y = lerp(y, ay, air); rx = lerp(rx, (i ? 0.5 : -0.2), air);
      }
      // kneel: one foot forward, the other tucked back up on its toe
      if (kneelStill > 0) {
        z = lerp(z, i ? 0.25 : -0.26, kneelStill);
        y = lerp(y, 0, kneelStill);
        rx = lerp(rx, i ? 0 : 0.95, kneelStill);
      }
      // the heel comes up about the ball of the foot while the toe box stays flat on the ground (it hinges)
      const flat = Math.min(1, Math.max(0, 1 - y / 0.05));
      out.toeRel[i] = rx > 0 ? -rx * 0.97 * flat + 0.2 * (1 - flat) * Math.min(rx, 0.6) / 0.6 : 0;
      footMat(out.feet[i], x, y, z, rx);
    }
  } else out.toeRel[0] = out.toeRel[1] = 0;

  // ---- body: breathes at rest, bobs and dips with the stride, leans into the run, sinks on landing
  const breathe = Math.sin(t * 1.7) * 0.006 * (1 - walk);
  const land = (s.land || 0) * 0.07;
  const bobY = ground * w * (hipBob(cyc, g) * (1 - 0.7 * kneel) - 0.03 * limp);
  const drop = kneel * U.KNEEL_DROP * (1 - 0.15 * w) + land - air * 0.02 * (s.rise || 0);
  const lean = g.lean * w * ground + 0.12 * kneel + (s.flinch || 0) * -0.1;
  const sway = Math.sin(cyc * Math.PI * 2) * (0.02 + 0.035 * g.run) * w * ground;
  // lean toward the move direction (pitch for forward/back, roll for sideways)
  const mzf = w > 0.05 ? (mz > 0 ? mz : mz * 0.3) : 1;
  const pitchLean = lean * mzf + 0.05 * air * (s.rise || 0);
  const rollLean = -lean * (w > 0.05 ? mx : 0) * 0.7 + sway + limp * w * ground * Math.sign(s.limp || 0) * 0.1 * (0.5 + 0.5 * Math.cos((cyc - (s.limp > 0 ? 0.5 : 0)) * Math.PI * 2));
  // the shoulders turn against the hips as the arms swing
  const yaw = -Math.sin(cyc * Math.PI * 2) * g.twist * w * ground * Math.max(0, mz);
  // the pelvis turns, tips and rolls against the chest: the lower spine takes up part of every lean and twist
  const alive = dead < 0;
  out.spine[0] = alive ? -1.3 * yaw : 0;
  out.spine[1] = alive ? -0.4 * pitchLean : 0;
  out.spine[2] = alive ? -0.8 * rollLean : 0;
  out.curl[0] = out.curl[1] = 1; out.trig = 0;
  let by = U.BODY_Y + bobY + breathe - drop;
  // never ask a leg to reach further than it can: lower the hips until both feet are in reach
  if (dead < 0) {
    let hip = by - U.H / 2 + HIP_UP;
    for (let i = 0; i < 2; i++) {
      const hx = (i === 0 ? -1 : 1) * U.HIP_X;
      T.set(0, ANKLE, -0.004).applyMatrix4(out.feet[i]); // where the ankle actually is, with the foot rolled
      const dx = T.x - hx, dz = T.z;
      const reach = (U.LEG[0] + U.LEG[1]) * 0.985;
      const lim = T.y + Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
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
    }
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
    out.curl[0] = out.curl[1] = 1 - 0.8 * k; // the grip loosens
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
    out.curl[0] = 0.45;
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
  // carry: each gun has its own walk and run position (both hands stay on it), plus a bob in time with the stride
  const gr = h.grips;
  const mv = w * ground * (1 - ads) * (1 - rk * 0.6) * (s.prone ? 0 : 1);
  const cr = g.run;
  const car = (i) => mv * lerp(gr.walk[i], gr.run[i], cr);
  const cc = cyc * Math.PI * 2;
  const bobA = gr.bob * mv * (0.4 + cr);
  const gbY = -Math.abs(Math.cos(cc)) * 0.012 * bobA, bobR = Math.sin(cc) * 0.05 * bobA, gbZ = Math.cos(cc * 2) * 0.006 * bobA;
  // (the grip sits in front of the right shoulder; the butt rests in its pocket)
  const px = lerp(-h.x, 0, ads);
  const py = lerp(0.77 + aimK * 0.04, U.EYE - (h.sight || 0.06), ads) - bodyDrop - lowered * 0.09 - rk * h.anim.drop + car(0) + gbY;
  const pz = lerp(h.pz ?? 0.27, 0.22, ads) - car(1) + gbZ;
  const pitch = (s.aimPitch || 0) - lowered * 0.55 - rk * h.anim.tilt + recoil * h.anim.climb + car(2);
  // twist turns the whole arms-and-gun assembly about the body's axis
  E.set(0, twist, 0, 'YXZ');
  Q2.setFromEuler(E);
  // the rifle crosses in front of the right shoulder: butt at the shoulder, muzzle toward the middle
  E.set(-pitch, twist + 0.12 * (1 - ads) + car(3), -rk * h.anim.roll + bobR, 'YXZ');
  Q.setFromEuler(E);
  T.set(px, py, pz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, twist);
  // the grip sits a little forward and below the shoulder line; recoil kicks it back
  P.set(0, 0, -recoil * h.anim.kick).applyQuaternion(Q).add(T);
  out.weapon.compose(P, Q, S1);
  // a crouched or running body leans its chest into the grip: ride the gun out in front of the chest, never in it
  M.copy(out.body).invert();
  T.set(out.weapon.elements[12], out.weapon.elements[13], out.weapon.elements[14]).applyMatrix4(M);
  const need = (U.D / 2 + 0.045) - T.z;
  if (need > 0 && Math.abs(T.y) < U.H / 2 + 0.05) {
    const k = Math.min(need, 0.07);
    out.weapon.elements[12] += out.body.elements[8] * k; out.weapon.elements[13] += out.body.elements[9] * k; out.weapon.elements[14] += out.body.elements[10] * k;
  }
  out.muzzle.copy(h.muzzle).applyMatrix4(out.weapon);
  // both hands ride anchors on the gun: the trigger hand on the grip, the support hand on this gun's
  // fore-end, foregrip or handle, sliding to the magazine mid-reload
  out.hands[1].multiplyMatrices(out.weapon, h.rh.m);
  blendAnchor(out.hands[0], out.weapon, h.lhA, h.magA, rk);
  // the trigger finger lies along the frame until the gun fires; the support hand closes on the fore-end or the magazine
  out.trig = ready > 0.5 && recoil < 0.05 && rk < 0.05 ? 1 : 0;
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
  const k = 0; // both hands stay on the gun; the stride is carried by the gun's own run pose
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
  out.curl[0] = lerp(1, 0.5, k);
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
    out.head.premultiply(HL.makeTranslation(-HP.x, -HP.y, -HP.z)).premultiply(HR.makeRotationX(-th * 0.9)).premultiply(HL.makeTranslation(HP.x, HP.y + 0.012 * k, HP.z + 0.05 * k)); // lifted forward of the pack, so the helmet's back clears it
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

// ---- legs and arms: two-segment IK from the root joint to the end joint -----------
// Segment matrices come out in the same frame as the pose (unit-local, or world for ragdolls):
// origin at the segment's middle, +z along it, +y the front of a leg (the knee side) or the top of
// an arm, length scaled to fit. The roll about the bone is set, not left to chance: a bend plane
// from the pole, and a twist toward the foot or hand at the far end of the limb. Reach is
// stretched, never broken, so a limb always joins its hand or foot to the body.
const _s = new THREE.Vector3(), _t = new THREE.Vector3(), _k = new THREE.Vector3(), _d = new THREE.Vector3();
const _pole = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _bp = new THREE.Vector3();
const _a = new THREE.Vector3(), _up = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _zz = new THREE.Vector3(), _mid = new THREE.Vector3(), _y1 = new THREE.Vector3(), _tw = new THREE.Vector3();
export const SEG_LEN = 0.2; // nominal length the limb geometry is built at
function segment(out, a, b, over, yHint) {
  _d.subVectors(b, a);
  const len = _d.length();
  if (len < 1e-5) return out.identity();
  _zz.copy(_d).multiplyScalar(1 / len);
  _y.copy(yHint).addScaledVector(_zz, -yHint.dot(_zz));
  if (_y.lengthSq() < 1e-8) { _y.set(0, 1, 0).addScaledVector(_zz, -_zz.y); if (_y.lengthSq() < 1e-8) _y.set(0, 0, 1); }
  _y.normalize();
  _x.crossVectors(_y, _zz);
  const sz = (len + over) / SEG_LEN;
  _mid.addVectors(a, b).multiplyScalar(0.5);
  return out.set(_x.x, _y.x, _zz.x * sz, _mid.x, _x.y, _y.y, _zz.y * sz, _mid.y, _x.z, _y.z, _zz.z * sz, _mid.z, 0, 0, 0, 1);
}
// An elbow can swing about the shoulder-to-wrist line without changing either segment's length: turn it
// the least that keeps the upper arm and forearm out of the chest (a rounded block in body space).
const _y2 = new THREE.Vector3(), _sd = new THREE.Vector3(), _ep = new THREE.Vector3(), _bl = new THREE.Vector3(), _sp = new THREE.Vector3();
const SWING = [0, 0.2, -0.2, 0.4, -0.4, 0.65, -0.65, 0.9, -0.9, 1.2, -1.2];
function torsoDepth(inv, p, r) {
  _bl.copy(p).applyMatrix4(inv);
  const qx = Math.abs(_bl.x) - (U.W / 2 - U.R), qy = Math.abs(_bl.y) - (U.H / 2 - U.R), qz = Math.abs(_bl.z) - (U.D / 2 - U.R);
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - U.R;
  return Math.max(0, r - d);
}
function swingClear(inv, root, target, x, h) {
  _sd.crossVectors(_d, _up); // the way the elbow turns
  const up0 = _y2.copy(_up), ctr = _sp.copy(root).addScaledVector(_d, x);
  let best = Infinity, bestA = 0;
  for (const a of SWING) {
    const c = Math.cos(a), s = Math.sin(a);
    _ep.copy(ctr).addScaledVector(up0, c * h).addScaledVector(_sd, s * h);
    let pen = 0;
    for (const t of [0.5, 0.75, 1]) pen = Math.max(pen, torsoDepth(inv, _k.lerpVectors(root, _ep, t), 0.04) - 0.012);
    for (const t of [0.15, 0.35, 0.55, 0.75]) pen = Math.max(pen, torsoDepth(inv, _k.lerpVectors(_ep, target, t), 0.033) - 0.012);
    if (pen < best - 1e-4) { best = pen; bestA = a; }
    if (pen <= 0) break;
  }
  if (bestA) { const c = Math.cos(bestA), s = Math.sin(bestA); _up.copy(up0).multiplyScalar(c).addScaledVector(_sd, s); }
}
// joint(out, root, target, l1, l2, pole, over, sgn, twist, k): returns the stretch factor used.
// sgn: +1 puts +y on the bend side (legs, the knee), -1 on the outside of the bend (arms, the elbow
// point). twist: unit vector the far segment's +y turns toward, by k (the shin toward the toes,
// the forearm toward the back of the hand).
function joint(out, root, target, l1, l2, pole, over, sgn, twist, k, avoid = null) {
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
  if (avoid) swingClear(avoid, root, target, x, h);
  _a.copy(root).addScaledVector(_d, x).addScaledVector(_up, h);
  // a knee or elbow of a body lying down can't sink into the ground (p.floor is set for ragdolls)
  if (FLOOR) { const g = FLOOR(_a.x, _a.z, _a.y) + 0.05; if (_a.y < g) _a.y = g; }
  const full = target.distanceTo(root) > d + 1e-4;
  _k.copy(root).addScaledVector(_d, d); // reachable end (target when within reach)
  _y1.copy(_up).multiplyScalar(sgn);
  segment(out[0], root, _a, over, _y1);
  if (twist && k > 0) { _tw.copy(_y1).multiplyScalar(1 - k).addScaledVector(twist, k); if (_tw.lengthSq() > 1e-6) _y1.copy(_tw); }
  segment(out[1], _a, full ? _k : target, over, _y1);
  return stretch;
}
let FLOOR = null;
export const SEG_OVER = 0.0; // limb segments overlap their joints by this much
const _ank = new THREE.Vector3(0, 0.092, -0.004);
const _tz = new THREE.Vector3();

// pelvis, neck and toe boxes: the parts that hang off the others
const _tq = new THREE.Quaternion(), _tq2 = new THREE.Quaternion(), _tp = new THREE.Vector3(), _ts = new THREE.Vector3();
export function solveTorso(p) {
  // the pelvis sits at the hip line and takes its own yaw, pitch and roll against the chest
  compose(M2, 0, -U.H / 2 + HIP_UP, 0, p.spine[1], p.spine[0], p.spine[2]);
  p.pelvis.multiplyMatrices(p.body, M2);
  // the neck is the head's yaw and tip, halfway: it carries the head on the shoulders
  p.body.decompose(_tp, _tq, _ts);
  p.head.decompose(_tp, _tq2, _ts);
  _tq.slerp(_tq2, 0.55);
  p.neck.compose(_tp, _tq, S1);
  // each boot's toe box hinges at the ball of the foot
  for (let i = 0; i < 2; i++) {
    const a = p.toeRel[i];
    if (Math.abs(a) < 1e-3) { p.toes[i].copy(p.feet[i]); continue; }
    E.set(a, 0, 0, 'YXZ'); Q.setFromEuler(E);
    FV.set(0, 0, U.BALL).sub(T.set(0, 0, U.BALL).applyQuaternion(Q));
    p.toes[i].multiplyMatrices(p.feet[i], M.compose(P.set(0, FV.y, FV.z), Q, S1));
  }
  return p;
}
export function solveLegs(p) {
  FLOOR = p.floor || null;
  solveTorso(p);
  p.pelvis.decompose(_bp, _bq, _bs);
  p.legStretch = 1;
  const e = p.feet;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1; // feet[0] is the right foot (-x)
    _s.set(side * U.HIP_X, 0, 0).applyMatrix4(p.pelvis);
    _t.copy(_ank).applyMatrix4(e[i]);
    _pole.set(side * 0.12, 0, 1).applyQuaternion(_bq);
    // the shin turns toward the way the foot points
    _tz.set(e[i].elements[8], 0, e[i].elements[10]);
    p.legStretch = Math.max(p.legStretch, joint(p.legs[i], _s, _t, U.LEG[0], U.LEG[1], _pole, 0.02, 1, _tz.lengthSq() > 1e-4 ? _tz.normalize() : null, 0.45));
  }
  FLOOR = null;
  return p;
}
// arms: shoulder joint to the wrist, elbows down and out. hands[0] is the left (support) hand at +x.
// The shoulder girdle rides with the arm: reaching forward rolls the shoulder out, raising the hand shrugs it up.
const _h = new THREE.Vector3(), _hy = new THREE.Vector3(), _bi = new THREE.Matrix4();
export function solveArms(p) {
  FLOOR = p.floor || null;
  p.body.decompose(_bp, _bq, _bs);
  _bi.copy(p.body).invert();
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const hm = p.hands[i];
    _h.setFromMatrixPosition(hm).applyMatrix4(_bi);
    const reachF = THREE.MathUtils.clamp((_h.z - 0.12) / 0.3, 0, 1), raise = THREE.MathUtils.clamp((_h.y - (U.SH_Y - 0.3)) / 0.3, 0, 1);
    _s.set(side * (U.SH_X - 0.006 * reachF), U.SH_Y + 0.016 * raise, -0.005 + 0.022 * reachF).applyMatrix4(p.body);
    _t.set(...U.WRIST).applyMatrix4(hm);
    _pole.set(side * 0.7, -1, -0.5).applyQuaternion(_bq);
    _hy.set(hm.elements[4], hm.elements[5], hm.elements[6]).normalize();
    joint(p.arms[i], _s, _t, U.ARM[0], U.ARM[1], _pole, 0.02, -1, _hy, 0.6, _bi);
    // the deltoid ball that closes the shoulder: the upper arm's frame, unstretched, at the joint
    const d = p.delts[i], a0 = p.arms[i][0].elements, zl = Math.hypot(a0[8], a0[9], a0[10]) || 1;
    d.copy(p.arms[i][0]);
    d.elements[8] /= zl; d.elements[9] /= zl; d.elements[10] /= zl;
    d.elements[12] = _s.x; d.elements[13] = _s.y; d.elements[14] = _s.z;
  }
  FLOOR = null;
  return p;
}
