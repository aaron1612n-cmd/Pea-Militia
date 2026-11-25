import * as THREE from 'three';
import { gaitFor, footAt, curve, IDLE, dirScale } from './clips.js';
import { MAG_DIR } from './weapons.js';

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
  rifle: { x: 0.16, pz: 0.2, rh: [-0.036, -0.012], lh: [0.0, 0.3, 0, 0, 0], mag: [-0.03, 0.085, 0, 0, 0],
    walk: [0, 0, -0.04, 0], run: [-0.02, 0.02, -0.16, 0.1], bob: 0.5 },
  smg: { x: 0.16, pz: 0.2, rh: [-0.036, -0.004], lh: [-0.044, 0.282, 0, 0, 0], lk: 'grip', mag: [-0.095, 0.1, 0, 0, 0],
    walk: [0.01, 0, 0.06, 0], run: [0.03, 0.0, 0.2, 0.12], bob: 0.4 },
  mg: { x: 0.15, pz: 0.19, rh: [-0.036, -0.012], lh: [-0.075, 0.35, 0, 0, 0], mag: [-0.1, 0.12, 0, 0, 0],
    walk: [-0.01, 0, -0.1, 0], run: [-0.03, 0.01, -0.22, 0.14], bob: 1.1 },
  plasma: { x: 0.16, pz: 0.16, rh: [-0.036, -0.012], lh: [-0.034, 0.12, 0, 0, 0], mag: [-0.1, 0.12, 0, 0, 0],
    walk: [0, 0, 0.0, -0.05], run: [0.01, 0, 0.12, -0.1], bob: 0.5 },
  launcher: { x: 0.16, pz: 0.16, rh: [-0.03, 0.0], lh: [-0.04, 0.12, 0, 0, 0], mag: [0.15, 0.1, 0, 0, 0],
    walk: [0.02, 0, 0.2, 0], run: [0.05, 0.02, 0.45, 0.1], bob: 0.9 },
  grenade: null,
};
const anchor = (g, s) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(0, g[0] * s, g[1] * s),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(g[2] || 0, g[3] || 0, g[4] || 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
  return { m, p: new THREE.Vector3().setFromMatrixPosition(m), q: new THREE.Quaternion().setFromRotationMatrix(m) };
};
const NOGL = [0, 0, 0, 0];
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
// vector keyframes: [[u, x, y, z], ...] eased between keys
const HR3 = new THREE.Vector3(), HL3 = new THREE.Vector3(), HRX = new THREE.Vector3();
const vk = (a) => a.map(([u, x, y, z]) => ({ u, v: new THREE.Vector3(x, y, z) }));
function vkeys(k, u, out) {
  if (u <= k[0].u) return out.copy(k[0].v);
  for (let i = 1; i < k.length; i++) if (u <= k[i].u) return out.lerpVectors(k[i - 1].v, k[i].v, smooth(k[i - 1].u, k[i].u, u));
  return out.copy(k[k.length - 1].v);
}
// grenade throw, hands in the body's frame (x + left, y up from the chest centre, z forward)
const THR = {
  R: vk([[0, -0.2, -0.09, 0.19], [0.12, -0.14, -0.04, 0.2], [0.36, -0.3, 0.38, -0.14], [0.58, -0.28, 0.44, 0.32], [0.72, 0.04, -0.12, 0.34], [1, -0.2, -0.09, 0.19]]),
  RX: vk([[0, -0.3, 0, 0], [0.36, -1.1, 0, 0], [0.58, -0.4, 0, 0], [0.72, 0.2, 0, 0], [1, -0.3, 0, 0]]),
  L: vk([[0, 0.2, -0.17, 0.06], [0.1, -0.1, -0.05, 0.2], [0.2, -0.1, -0.05, 0.2], [0.38, 0.3, 0.12, 0.3], [0.6, 0.3, 0.1, 0.28], [1, 0.2, -0.17, 0.06]]),
};
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

// The support hand's reload: leaves the fore-end for the magazine well, pulls the magazine out, goes to the
// pouch on the belt, comes back with the fresh one, seats it with a slap and returns to the fore-end; an
// empty gun finishes with the hand over the top working the charging handle. u is 0..1 (see weaponSlotMatrix,
// which moves the magazine on the same timeline). Mortars take a shell from the pouch to the muzzle instead.
const POUCH = { p: new THREE.Vector3(0.11, -0.15, 0.155), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.2, 0, 'YXZ')) };
const RLT = { def: [0.3, 0.38, 0.42, 0.52], launcher: [0.04, 0.16, 0.2, 0.3] };
const BOLTH = new THREE.Vector3(0.0, 0.05, 0.1), RP = new THREE.Vector3(), RQ = new THREE.Quaternion(), RM = new THREE.Matrix4(), RQ2 = new THREE.Quaternion();
function reloadHand(out, h, id, u, rack) {
  const t = id === 'launcher' ? RLT.launcher : RLT.def;
  const sc = U.WEAPON_SCALE;
  const launcher = id === 'launcher';
  const fb = launcher ? smooth(0.18, 0.3, u) * (1 - smooth(0.84, 0.97, u)) : smooth(0, 0.08, u) * (1 - smooth(0.84, 0.97, u));
  const pull = launcher ? 1 - smooth(0.3, 0.7, u) : u <= 0.3 ? smooth(0.08, 0.3, u) : 1 - smooth(0.52, 0.8, u);
  const toP = smooth(t[0], t[1], u) * (1 - smooth(t[2], t[3], u));
  RP.lerpVectors(h.lhA.p, h.magA.p, fb); RQ.copy(h.lhA.q).slerp(h.magA.q, fb);
  const d = MAG_DIR[id];
  if (d && !launcher) RP.x += d[0] * d[3] * pull * sc, RP.y += d[1] * d[3] * pull * sc, RP.z += d[2] * d[3] * pull * sc;
  else if (launcher) { RP.y += 0.15 * pull * sc; RP.z -= 0.1 * pull * sc; }
  if (rack > 0.001) { RP.lerp(BOLTH, Math.min(1, rack * 1.6)); }
  RM.compose(RP, RQ, S1);
  out.hands[0].multiplyMatrices(out.weapon, RM);
  if (toP > 0.001) {
    RM.compose(POUCH.p, POUCH.q, S1);
    M2.multiplyMatrices(out.body, RM);
    M2.decompose(RP, RQ, FS_);
    out.hands[0].decompose(HP3, RQ2, FS_);
    HP3.lerp(RP, toP); RQ2.slerp(RQ, toP);
    out.hands[0].compose(HP3, RQ2, S1);
  }
}
const FS_ = new THREE.Vector3(), HP3 = new THREE.Vector3();

function compose(out, x, y, z, rx = 0, ry = 0, rz = 0) {
  E.set(rx, ry, rz, 'YXZ');
  Q.setFromEuler(E);
  return out.compose(P.set(x, y, z), Q, S1);
}

// a boot at (x, y, z) pitched by rx and turned by ry (toe up turns about the origin: the caller lifts it off the heel;
// toe down turns about the ball of the foot, so the toes stay planted while the heel rises)
const FV = new THREE.Vector3(), FQ0 = new THREE.Quaternion();
function footMat(out, x, y, z, rx, ry = 0, rz = 0) {
  E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
  if (rx > 0) {
    E.set(0, ry, 0, 'YXZ'); FQ0.setFromEuler(E);
    FV.set(0, 0, U.BALL).applyQuaternion(FQ0).sub(T.set(0, 0, U.BALL).applyQuaternion(Q));
    return out.compose(P.set(x + FV.x, y + FV.y, z + FV.z), Q, S1);
  }
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
    st: [1, 1], fx: new Float32Array(6), dims: U, // how planted each foot is; foot targets [x, z, yaw] per foot; body proportions
  };
}

// The body's part in a grenade throw: wind back (turn away, lean back, load the legs), then whip round and
// forward through the release (turn into it, lean over it, drop onto the front foot), then recover. u: 0..1.
const TB = { yaw: 0, pitch: 0, drop: 0 };
function throwBody(u) {
  if (u < 0) { TB.yaw = TB.pitch = TB.drop = 0; return TB; }
  const a = smooth(0.1, 0.4, u), b = smooth(0.4, 0.58, u), c = smooth(0.66, 1, u);
  TB.yaw = lerp(lerp(0, -0.5, a), 0.42, b) * (1 - c);
  TB.pitch = lerp(lerp(0, -0.12, a), 0.3, b) * (1 - c);
  TB.drop = lerp(lerp(0, 0.02, a), 0.04, b) * (1 - c);
  return TB;
}
// s: { t, walk, cycle, speed, mx, mz (local move dir), air, rise, land, kneel, aimPitch, twist,
//      ready (0 lowered .. 1 shouldered), recoil, reload (-1 or 0..1), throw (-1 or 0..1),
//      flinch, ads (0..1, first person centre), fp (first person view), dead (-1 or 0..1 topple), weapon, sprint,
//      pf: planted feet while standing { k, x[2], z[2], yaw[2], lift[2] } (see planter.js),
//      gnd: [h0, h1] ground height under each foot relative to the unit's origin, slope: [[pitch, roll], ...],
//      dims: body proportions (default U) }
const FOOT_LOW = [[0, 0.012, 0.152], [0, 0.0, 0.14], [0.04, 0.0, 0.1], [-0.04, 0.0, 0.1], [0, 0.0, -0.09], [0.035, 0.0, -0.08], [-0.035, 0.0, -0.08]].map((q) => new THREE.Vector3(...q));
const FP0 = new THREE.Vector3();
// the lowest sole point of a boot above the ground under it, in the frame the boot matrix is in. gy: the ground
// under the boot's origin; pitch: the ground's fall away toward the toe (rad), so a boot on a slope is measured
// against the slope and not against level ground
function soleLow(f, gy = 0, gx = 0, gz = 0, s = null) { // the lowest point of the sole above the ground: the terrain itself when it can be asked, else a plane through the boot
  let lo = Infinity;
  const wr = s && s.wref && s.wx !== undefined ? s.wref : null;
  const c = wr ? Math.cos(s.wf) : 1, sn = wr ? Math.sin(s.wf) : 0;
  for (const q of FOOT_LOW) {
    FP0.copy(q).applyMatrix4(f);
    if (wr) lo = Math.min(lo, FP0.y - (wr.groundAt(s.wx + FP0.x * c + FP0.z * sn, s.wz - FP0.x * sn + FP0.z * c, s.wy + 0.2) - s.wy));
    else lo = Math.min(lo, FP0.y - (gy + gx * (FP0.x - f.elements[12]) + gz * (FP0.z - f.elements[14])));
  }
  return lo;
}
const GA = {};
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function poseCore(s, out) {
  const D = s.dims || U;
  out.dims = D;
  const ls = D.LS || 1;
  const t = s.t || 0, walk = s.walk || 0, kneel = s.kneel || 0, air = s.air || 0;
  const mx = s.mx ?? 0, mz = s.mz ?? 1;
  const cyc = s.cycle || 0;
  const dead = s.dead ?? -1;
  // gait: clips blended by ground speed (see clips.js)
  const g = gaitFor(s.speed ?? walk * 2.2, cyc, GA, ls, dirScale(mx, mz));
  const w = walk;
  const ground = 1 - air;
  const limp = Math.abs(s.limp || 0);
  const kneelStill = kneel * (1 - w); // one knee down; moving crouched is a walk with bent legs
  const prone = s.prone || 0;
  const dirK = 0.25 + 0.75 * Math.max(0, mz); // the stride's twist and lean follow the way you face, less when sidestepping or backing
  out.gait = g;
  out.mvReload = s.reload ?? -1; out.mvRack = s.rack || 0; out.mvRecoil = s.recoil || 0; // drives the gun's moving parts (magazine, bolt)
  const pf = s.pf && s.pf.k > 0.001 ? s.pf : null;
  if (!out.st) out.st = [1, 1];

  // ---- feet: planted while they carry the body, lifted and swung through between strikes
  if (dead < 0) {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      footAt((cyc + (i ? 0.5 : 0)) % 1, g, FO);
      const a = FO.along * w * ground;
      // a sidestep widens the stance so the feet never cross. Each boot takes up the wider (and bladed) stance while it is in
      // the air, so a planted one never slides sideways to get there
      if (!out.wf) { out.wf = [Math.abs(mx) * w, Math.abs(mx) * w]; }
      if (pf && pf.k > 0.93) out.wf[i] = 0; // standing: the planter owns the stance, which is the narrow one
      else if (FO.stance < 0.5 || ground < 0.5) out.wf[i] += (Math.abs(mx) * w - out.wf[i]) * (ground < 0.5 ? 1 : 0.4);
      const wf = out.wf[i];
      let x = side * lerp(D.FOOT_X, D.FOOT_X * 0.72, g.run * w) * (1 + 0.95 * wf) + mx * a;
      let z = mz * a, y = FO.lift * Math.min(1, w * 2.4) * (1 - 0.45 * kneel), ry = side * 0.09 * (1 - 0.6 * g.run * w), rx = -FO.pitch * w * Math.max(0, mz), rz = 0;
      // a sidestep passes the swinging foot in front of (right foot) or behind (left foot) the planted one
      // a sidestep goes in a bladed stance (left foot forward, right back) so the feet pass each other fore and aft, never through
      { const sw = (FO.stance ? 0 : Math.sin(Math.PI * FO.k)) * w * Math.abs(mx); z += (i ? 1 : -1) * (0.15 * wf * (1 - 0.3 * sw)) * ls; y += 0.04 * ls * sw; }
      if (limp && side === Math.sign(s.limp)) { z *= 1 - 0.4 * limp; y *= 1 - 0.55 * limp; } // the hurt leg takes a short, flat step
      // heel strike rolls about the heel: the sole's heel stays on the ground while the toe comes down
      if (rx < 0) y += 0.085 * Math.sin(-rx);
      // in the air the legs tuck on the way up and reach for the ground on the way down
      if (air > 0) {
        const up = smooth(-0.5, 0.5, s.rise || 0); // 1 rising, 0 falling
        const az = lerp(i ? -0.04 : 0.1, i ? -0.1 : 0.07, up), ay = lerp(lerp(0.02, 0.08, i), lerp(0.17, 0.1, i), up) + 0.03;
        x += (side * 0.01) * air; z = lerp(z, az, air); y = lerp(y, ay, air); rx = lerp(rx, lerp(i ? 0.25 : 0.3, i ? 0.5 : -0.2, up), air);
      }
      // kneel: one foot forward, the other tucked back up on its toe
      if (kneelStill > 0) {
        z = lerp(z, i ? 0.25 : -0.26, kneelStill);
        y = lerp(y, 0, kneelStill);
        rx = lerp(rx, i ? 0 : 0.95, kneelStill);
      }
      // feet planted while standing: the planter owns them (turning on the spot takes real steps)
      if (pf) {
        const k = pf.k * (1 - w);
        x = lerp(x, pf.x[i], k); z = lerp(z, pf.z[i], k); ry = lerp(ry, pf.yaw[i], k); y += pf.lift[i] * k;
        rx = lerp(rx, pf.lift[i] > 0.004 ? -0.12 * Math.min(1, pf.lift[i] / 0.04) : 0, k);
      }
      // foot lock: a boot that is down stays where it landed in the world, whatever the clips and the planter blend to.
      // The gap between the lock and the clip's own foot is eased out once the boot lifts, so nothing snaps.
      if (s.wx !== undefined) {
        const L = out.lk || (out.lk = [{ on: false, wx: 0, wz: 0, wy: 0, ex: 0, ez: 0, ey: 0, clr: 0, pw: false, pwx: 0, pwz: 0 }, { on: false, wx: 0, wz: 0, wy: 0, ex: 0, ez: 0, ey: 0, clr: 0, pw: false, pwx: 0, pwz: 0 }]);
        const l = L[i], c = Math.cos(s.wf), sn = Math.sin(s.wf);
        let down = ground > 0.5 && kneelStill < 0.5 && (pf && pf.k * (1 - w) > 0.5 ? pf.lift[i] < 0.004 : FO.stance >= 0.5);
        if (down) {
          if (!l.on) { l.on = true; l.wx = s.wx + x * c + z * sn; l.wz = s.wz - x * sn + z * c; l.wy = s.wf + ry; }
          const dx = l.wx - s.wx, dz = l.wz - s.wz;
          const lx = dx * c - dz * sn, lz = dx * sn + dz * c, ly = wrapA(l.wy - s.wf);
          l.ex = lx - x; l.ez = lz - z; l.ey = wrapA(ly - ry);
          if (Math.hypot(l.ex, l.ez) > 0.4) down = false; // strayed too far from where the stride wants it: let go
          else { x = lx; z = lz; ry = ly; }
        }
        if (!down) {
          l.on = false;
          x += l.ex; z += l.ez; ry += l.ey;
          const d = Math.exp(-16 * (s.dt || 0.016));
          l.ex *= d; l.ez *= d; l.ey *= d;
        }
        // a boot never scrapes along the ground: the faster it travels over it, the higher it clears it
        const nwx = s.wx + x * c + z * sn, nwz = s.wz - x * sn + z * c;
        if (l.pw && ground > 0.5) {
          const wv = Math.hypot(nwx - l.pwx, nwz - l.pwz) / Math.max(1e-3, s.dt || 0.016);
          const want = Math.min(0.04 * ls, Math.max(0, wv - 0.25) * 0.02);
          l.clr += (want - l.clr) * (want > l.clr ? 0.8 : 0.35);
          y += l.clr * (1 - kneelStill);
        } else l.clr = 0;
        l.pwx = nwx; l.pwz = nwz; l.pw = true;
      }
      // the planted foot sits on the ground under it, flat to a slope; a swinging one follows the terrain it passes over
      const gh = s.gnd ? s.gnd[i] : 0;
      const st = ground * (1 - smooth(0, 0.025, y)) * (kneelStill > 0.5 ? 0 : 1);
      out.st[i] = st;
      y += gh;
      if (s.slope) { // the sole lies flat to the ground: pitched along the boot, rolled across it
        const gx = s.slope[i][0], gz = s.slope[i][1], sy = Math.sin(ry), cy = Math.cos(ry);
        rx += Math.atan(-(gx * sy + gz * cy)) * st; rz += Math.atan(gx * cy - gz * sy) * st;
      }
      // the heel comes up about the ball of the foot while the toe box stays flat on the ground (it hinges)
      const flat = Math.min(1, Math.max(0, 1 - (y - gh) / 0.05));
      out.toeRel[i] = rx > 0 ? -rx * 0.97 * flat + 0.2 * (1 - flat) * Math.min(rx, 0.6) / 0.6 : 0;
      footMat(out.feet[i], x, y, z, rx, ry, rz);
      out.fx[i * 3] = x; out.fx[i * 3 + 1] = z; out.fx[i * 3 + 2] = ry;
    }
    // two boots never share the ground: keep the soles a boot's width apart wherever they overlap fore and aft and
    // at the same height. Smooth in all three, so a boot that is stepping over the other is never snapped aside.
    for (let it = 0; it < 2; it++) {
      const A = out.feet[0].elements, B = out.feet[1].elements;
      const dx = B[12] - A[12], dz = Math.abs(B[14] - A[14]), dy = Math.abs(B[13] - A[13]);
      const wgt = (1 - smooth(0.24, 0.3, dz)) * (1 - smooth(0.04, 0.09, dy));
      const need = Math.min(0.06, (0.108 - dx) * wgt); // the right boot (A) stays on the right (-x)
      if (need > 0) { // the boot in the air gives way; one planted on the ground stays where it is
        const ga = 1 - out.st[0], gb = 1 - out.st[1], tot = ga + gb, fa = tot > 0.02 ? ga / tot : 0.5;
        A[12] -= need * fa; B[12] += need * (1 - fa);
      }
    }
  } else { out.toeRel[0] = out.toeRel[1] = 0; out.st[0] = out.st[1] = 0; }

  // ---- body: breathes at rest, bobs and dips with the stride, leans into the run, sinks on landing
  const idle = (1 - w) * (1 - kneel) * (1 - prone) * ground;
  const ph = t / 4.2, shiftPh = t / 9;
  const breathe = curve(IDLE.breathe, ph, true) * 0.005 * (1 - w) + Math.sin(t * 1.7) * 0.0 * (1 - walk);
  const shift = curve(IDLE.shift, shiftPh, true) * idle;
  const land = (s.land || 0) * 0.07 * ls;
  const bobY = ground * w * (g.bob - 0.03 * limp * ls);
  const hx = s.hx || 0, hz = s.hz || 0, stag = Math.min(1, s.stag || 0), tb = throwBody(s.throw ?? -1);
  const drop = kneel * D.KNEEL_DROP * (1 - 0.15 * w) + land - air * 0.02 * (s.rise || 0) + tb.drop + 0.025 * stag;
  const lean = g.lean * w * ground + 0.12 * kneel + (s.flinch || 0) * -0.1;
  // lean toward the move direction (pitch for forward/back, roll for sideways)
  const mzf = w > 0.05 ? (mz > 0 ? mz : mz * 0.3) : 1;
  const pitchLean = lean * mzf + 0.05 * air * (s.rise || 0) + g.bounce * w * ground * dirK + curve(IDLE.breathe, ph, true) * 0.01 * idle + hx + tb.pitch - 0.14 * stag;
  const limpRoll = limp * w * ground * Math.sign(s.limp || 0) * 0.1 * (0.5 + 0.5 * Math.cos((cyc - (s.limp > 0 ? 0.5 : 0)) * Math.PI * 2));
  const rollLean = -lean * (w > 0.05 ? mx : 0) * 0.7 + g.chestRoll * w * ground + limpRoll + 0.018 * shift + hz + 0.09 * stag * Math.sin(t * 10.5);
  // the shoulders turn against the hips as the arms swing
  const yaw = g.twist * w * ground * dirK + tb.yaw + 0.07 * stag * Math.sin(t * 7.3);
  // the pelvis turns, tips and rolls against the chest: the lower spine takes up part of every lean and twist
  const alive = dead < 0;
  const pYaw = g.yaw * w * ground * dirK, pRoll = -g.roll * w * ground - 0.02 * shift, pPitch = 0.5 * pitchLean + g.pitch * w * ground;
  out.spine[0] = alive ? pYaw - yaw : 0;
  out.spine[1] = alive ? pPitch - pitchLean : 0;
  out.spine[2] = alive ? pRoll - rollLean : 0;
  out.curl[0] = out.curl[1] = 1; out.trig = 0;
  let by = D.BODY_Y + bobY + breathe - drop;
  // never ask a leg to reach further than it can: lower the hips until both feet are in reach
  if (dead < 0) {
    let hip = by - D.H / 2 + HIP_UP;
    for (let i = 0; i < 2; i++) {
      const hx = (i === 0 ? -1 : 1) * D.HIP_X;
      T.set(0, ANKLE, -0.004).applyMatrix4(out.feet[i]); // where the ankle actually is, with the foot rolled
      const dx = T.x - hx, dz = T.z;
      const reach = (D.LEG[0] + D.LEG[1]) * 0.985;
      const lim = T.y + Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
      if (lim < hip) hip = lim;
    }
    by = hip + D.H / 2 - HIP_UP;
  }
  // the body pivots about its base so leaning doesn't swing the feet
  const base = by - D.H / 2;
  E.set(pitchLean, yaw, rollLean, 'YXZ');
  Q.setFromEuler(E);
  T.set(0, D.H / 2, 0).applyQuaternion(Q);
  const bx = (-g.sway * w * ground * dirK + 0.012 * shift) * 1;
  out.body.compose(P.set(bx, base + T.y, T.z), Q, S1);
  out.body.elements[12] += T.x;

  if (dead >= 0) {
    // topple backwards about the rear bottom edge and settle on the ground
    const k = smooth(0, 1, dead);
    const ang = -k * (Math.PI / 2 - 0.04);
    E.set(ang, 0, 0, 'YXZ');
    Q.setFromEuler(E);
    const pz = -D.D / 2, py = D.LIFT * (1 - k) + 0.075 * k; // lies on its pack
    T.set(0, D.H / 2, D.D / 2).applyQuaternion(Q);
    out.body.compose(P.set(0, py + T.y, pz + T.z), Q, S1);
    by = py + T.y;
  }

  out.pitch = g.lean * w * ground * mzf; // the run's lean alone: held items follow it
  // the head looks where the gun points, holds level against the body's lean and bounce, and wanders when nobody is watching
  const look = curve(IDLE.look, t / 13, true) * 0.16 * idle * (1 - (s.ready ?? 1) * 0.7), lookP = curve(IDLE.lookPitch, t / 13, true) * 0.05 * idle;
  attachToBody(out, THREE.MathUtils.clamp(s.twist || 0, -0.5, 0.5) * 0.3 + look - yaw * 0.6,
    THREE.MathUtils.clamp(s.aimPitch || 0, -0.6, 0.6) * 0.35 * (dead >= 0 ? 0 : 1) + (pitchLean * 0.75 + lookP - hx * 0.9) * (dead >= 0 ? 0 : 1));

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
    // grenade in the right hand. The left hand pulls the pin, points at the target as the right arm cocks
    // behind the head, then the arm whips over the top; the body does the work (see throwBody)
    const th = s.throw ?? -1;
    const rest = THR.R[0], restL = THR.L[0];
    if (th >= 0) { vkeys(THR.R, th, HR3); vkeys(THR.L, th, HL3); vkeys(THR.RX, th, HRX); }
    else { HR3.copy(rest.v); HL3.copy(restL.v); HRX.set(-0.3, 0, 0); }
    compose(M, HR3.x, HR3.y, HR3.z, HRX.x, HRX.y, HRX.z);
    out.hands[1].multiplyMatrices(out.body, M);
    compose(M, HL3.x, HL3.y, HL3.z, 0, 0, 0);
    out.hands[0].multiplyMatrices(out.body, M);
    out.curl[0] = th >= 0 ? lerp(0.45, 0.8, smooth(0.0, 0.14, th) * (1 - smooth(0.2, 0.3, th))) : 0.45;
    out.weapon.multiplyMatrices(out.hands[1], compose(M, 0, 0.0, 0.03, -Math.PI / 2 + 0.4, 0, 0));
    out.muzzle.setFromMatrixPosition(out.hands[1]);
    return out;
  }

  // shoulder pivot: follows the body's height; the gun stays in a plane beside the body
  const reload = s.reload ?? -1;
  // the gun comes up and over for the reload fast, stays tilted while the hand works the magazine, and settles at the end
  const rk = reload >= 0 ? smooth(0, 0.14, reload) * (1 - smooth(0.84, 1, reload)) : 0;
  const gl = s.gl || NOGL; // the gun's own lag behind the turning body
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
  const seat = reload >= 0 ? Math.sin(smooth(0.6, 0.72, reload) * Math.PI) : 0; // the magazine seats with a small jolt
  const px = lerp(-h.x, 0, ads) + gl[2];
  const py = lerp(0.77 + aimK * 0.04, U.EYE - (h.sight || 0.06), ads) - bodyDrop - lowered * 0.09 - rk * h.anim.drop + car(0) + gbY + gl[3] - seat * 0.008;
  const pz = lerp(h.pz ?? 0.27, 0.22, ads) - car(1) + gbZ;
  const pitch = (s.aimPitch || 0) - lowered * 0.55 - rk * h.anim.tilt + recoil * h.anim.climb + car(2) + gl[1] - seat * 0.04;
  // twist turns the whole arms-and-gun assembly about the body's axis
  E.set(0, twist, 0, 'YXZ');
  Q2.setFromEuler(E);
  // the rifle crosses in front of the right shoulder: butt at the shoulder, muzzle toward the middle
  E.set(-pitch, twist + 0.12 * (1 - ads) + car(3) + gl[0], -rk * h.anim.roll + bobR, 'YXZ');
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
  if (reload >= 0) reloadHand(out, h, id, reload, s.rack || 0); else out.hands[0].multiplyMatrices(out.weapon, h.lhA.m);
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
  tend(s, out);
  dragged(s, out);
  groundFeet(s, out);
  if ((s.lod || 0) < 2) legPass(s, out);
  return out;
}
// Lying down (or fallen), the boots turn toes-down; lift each one until its lowest point (toe tip, heel, welt) rests on the ground
function groundFeet(s, out) {
  const k = (s.dead ?? -1) >= 0 ? smooth(0, 0.3, s.dead) : smooth(0.3, 0.9, s.prone || 0);
  if (k <= 0) return;
  for (const f of out.feet) {
    let lo = Infinity;
    for (const q of FOOT_LOW) lo = Math.min(lo, V3.copy(q).applyMatrix4(f).y);
    if (lo < 0.004) f.elements[13] += (0.004 - lo) * k;
  }
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
const PLANT = new THREE.Vector3(), TV = new THREE.Vector3();
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

// Crawling on the belly: the legs take turns, one knee drawn up and out and pushing while the other trails, the
// shoulders swing against the hips with every pull, and a downed soldier rolls half onto the hip and hauls
// forward on one hand, the hurt leg dragging.
const CW = new THREE.Matrix4(), CQ = new THREE.Quaternion();
function crawl(s, out) {
  const k = smooth(0, 1, s.prone || 0), w = (s.walk || 0) * k;
  const down = s.down ? k : 0;
  if (w < 0.01 && down < 0.01) return;
  const c = (s.cycle || 0) * Math.PI * 2;
  const side = Math.sign(s.limp || 1) || 1;
  if (w >= 0.01) {
    for (let i = 0; i < 2; i++) {
      const a = c + (i ? Math.PI : 0), f = out.feet[i];
      const hurt = down && (i === 0 ? -1 : 1) === side; // the hurt leg just trails
      const push = Math.sin(a), draw = Math.max(0, -Math.cos(a));
      f.elements[14] += (0.5 - 0.5 * push) * (hurt ? 0.03 : 0.1) * w; // never past the leg's reach: the pushing leg is full out behind, the other draws up
      f.elements[13] += draw * (hurt ? 0.0 : 0.05) * w;
      f.elements[12] += (i ? 1 : -1) * draw * (hurt ? 0 : 0.045) * w; // the knee comes up and out
    }
    // shoulders and gun swing against the hips with the pull
    const yw = Math.sin(c) * 0.07 * w;
    R.makeTranslation(0, 0, -0.1).multiply(R2.makeRotationY(yw)).multiply(M.makeTranslation(0, 0, 0.1));
    for (const m of [out.body, out.head, out.pack, out.weapon, out.hands[0], out.hands[1]]) m.premultiply(R);
    out.muzzle.applyMatrix4(R);
  }
  if (down > 0.01) {
    // on the hip: roll about the long axis, lifting the body so it never sinks into the dirt
    const roll = 0.55 * side * down;
    R.makeTranslation(0, 0.1, 0).multiply(R2.makeRotationZ(-roll)).multiply(M.makeTranslation(0, -0.1, 0));
    R.elements[13] += 0.05 * Math.abs(Math.sin(roll)) * 1.2;
    for (const m of [out.body, out.head, out.pack, out.weapon, out.hands[0], out.hands[1]]) m.premultiply(R);
    out.muzzle.applyMatrix4(R);
    // the free hand reaches out ahead, claws the ground and pulls the body up to it
    const h = out.hands[0], a = c + Math.PI * 0.5, reach = 0.5 + 0.5 * Math.sin(a);
    h.decompose(FP, FQ, FS);
    FP.set(0.2 * -side, 0.03 + 0.05 * Math.max(0, Math.cos(a)), 0.28 + 0.24 * reach);
    h.compose(FP, FQ, S1);
    out.curl[0] = 0.5 + 0.5 * (1 - reach);
  }
}

// Tending: kneeling over a casualty (or a wound of one's own), the gun slung across the chest and both hands working
// at a point on the ground or the body. tendAt is where, in the unit frame; the hands press and wrap in small strokes.
// Dragging (drag > 0): backing away while both hands haul on the harness of the casualty held in front.
const SLING = new THREE.Matrix4().compose(new THREE.Vector3(0.05, -0.12, 0.18), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.15, 0.35, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
const TQ = new THREE.Quaternion(), TQ2 = new THREE.Quaternion(), TS = new THREE.Vector3();
function slung(out, k) {
  CW.multiplyMatrices(out.body, SLING);
  out.weapon.decompose(TV, TQ, TS); CW.decompose(FP, TQ2, TS);
  TV.lerp(FP, k); TQ.slerp(TQ2, k);
  out.weapon.compose(TV, TQ, S1);
  out.muzzle.copy(HOLD[out.wid]?.muzzle || TS).applyMatrix4(out.weapon);
}
function tend(s, out) {
  const k = s.tend || 0, dr = s.drag || 0;
  if ((k < 0.01 && dr < 0.01) || (s.dead ?? -1) >= 0 || (s.prone || 0) > 0.4) return;
  const t = s.t || 0;
  out.wid = s.weapon || 'rifle';
  if (!HOLD[out.wid]?.oneHand) slung(out, Math.max(k, dr));
  const at = s.tendAt || [0.1, 0.12, 0.45];
  for (let i = 0; i < 2; i++) {
    const side = i ? -1 : 1, h = out.hands[i];
    h.decompose(FP, FQ, FS);
    if (dr > 0.01) {
      // hands on the harness collar in front, a little wider than the shoulders, hauling in time with the steps
      const pull = Math.sin((s.cycle || 0) * Math.PI * 2 + i * 0.6) * 0.02;
      TV.set(side * 0.1, -0.2, 0.36 + pull).applyMatrix4(out.body);
      FP.lerp(TV, dr);
    }
    if (k > 0.01) {
      const st = Math.sin(t * 5.5 + i * 2.2) * 0.035, ct = Math.cos(t * 5.5 + i * 2.2) * 0.025;
      TV.set(at[0] + side * 0.07 + ct * (i ? 1 : 0.3), at[1] + 0.02 + 0.02 * Math.max(0, st) * (i ? 0 : 1), at[2] + st * (i ? 1 : 0.4));
      FP.lerp(TV, k);
    }
    FQ2.setFromEuler(E.set(0.9, 0, side * 0.3, 'YXZ'));
    FQ.slerp(FQ2, Math.max(k, dr) * 0.8);
    h.compose(FP, FQ, S1);
    out.curl[i] = lerp(out.curl[i], 0.55, Math.max(k, dr));
  }
  out.trig = 0;
}

// A casualty being hauled: flat on the back, head toward the medic, arms slack, heels trailing, the gun slung.
// Built as the dead pose (the topple's resting state) and blended in, so the drop to the ground is smooth too.
const DRG = [];
function dragged(s, out) {
  const k = s.drg || 0;
  if (k < 0.002 || (s.dead ?? -1) >= 0) return;
  const tmp = DRG[0] || (DRG[0] = makePose());
  const s2 = { ...s, dead: 1, drg: 0, prone: 0, walk: 0, kneel: 0, down: false, throw: -1, reload: -1 };
  poseCore(s2, tmp); freeArmSkip(tmp);
  const parts = ['body', 'head', 'pack'];
  for (const n of parts) mixMat(out[n], tmp[n], k);
  for (let i = 0; i < 2; i++) { mixMat(out.feet[i], tmp.feet[i], k); mixMat(out.hands[i], tmp.hands[i], k); }
  // the arms hang slack by the sides, a little out
  for (let i = 0; i < 2; i++) { out.hands[i].elements[12] += (i ? -1 : 1) * 0.04 * k; out.hands[i].elements[14] += 0.12 * k; }
  out.toeRel[0] = out.toeRel[1] = 0;
  out.showWeapon = true; out.wid = s.weapon || 'rifle';
  slung(out, k);
  out.curl[0] = out.curl[1] = 0.5;
  out.pitch = 0;
}
const freeArmSkip = () => {};
const MQa = new THREE.Quaternion(), MQb = new THREE.Quaternion(), MPa = new THREE.Vector3(), MPb = new THREE.Vector3(), MSa = new THREE.Vector3();
function mixMat(a, b, k) {
  a.decompose(MPa, MQa, MSa); b.decompose(MPb, MQb, MSa);
  MPa.lerp(MPb, k); MQa.slerp(MQb, k);
  a.compose(MPa, MQa, S1);
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
    const k = smooth(0.2, 1, prone);
    const th = PRONE.ANGLE * k;
    const P0 = PRONE.PIVOT * k + (U.LIFT) * (1 - k);
    // rotate about the x axis through (0, P0, 0), then slide back so the body centre stays put
    R.makeTranslation(0, P0 + 0.05 * Math.sin(Math.PI * k) , -PRONE.BACK * k).multiply(R2.makeRotationX(th)).multiply(M.makeTranslation(0, -P0, 0));
    for (const m of upper) m.premultiply(R);
    for (const f of out.feet) { f.premultiply(R); f.elements[13] -= 0.03 * k * k * k; } // toes rest on the ground
    // going down: the support hand leaves the gun and plants on the ground ahead to take the weight
    const plant = Math.sin(Math.PI * smooth(0.18, 0.95, prone)) * (1 - 0.0 * k);
    if (plant > 0.01 && out.hands[0]) {
      out.hands[0].decompose(FP, FQ, FS);
      PLANT.set(0.17, 0.035, 0.3 + 0.1 * k);
      // within an arm's reach of the shoulder: the hand drops toward the ground, never stretches to it
      TV.set(U.SH_X, U.SH_Y, -0.005).applyMatrix4(out.body);
      PLANT.sub(TV); const pl = PLANT.length(); if (pl > 0.36) PLANT.multiplyScalar(0.36 / pl); PLANT.add(TV);
      FP.lerp(PLANT, plant * 0.85);
      out.hands[0].compose(FP, FQ, S1);
    }
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
function swingClear(inv, root, target, x, h, out) {
  _sd.crossVectors(_d, _up); // the way the elbow turns
  const up0 = _y2.copy(_up), ctr = _sp.copy(root).addScaledVector(_d, x);
  const pen = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    _ep.copy(ctr).addScaledVector(up0, c * h).addScaledVector(_sd, s * h);
    let p = 0;
    for (const t of [0.5, 0.75, 1]) p = Math.max(p, torsoDepth(inv, _k.lerpVectors(root, _ep, t), 0.04) - 0.012);
    for (const t of [0.15, 0.35, 0.55, 0.75]) p = Math.max(p, torsoDepth(inv, _k.lerpVectors(_ep, target, t), 0.033) - 0.012);
    return p;
  };
  // the elbow swings out only as far as it has to, and moves there continuously: it never jumps round the shoulder
  const prev = out.swA || 0;
  let bestA = 0;
  if (pen(0) > 0) {
    let best = Infinity;
    const tries = prev ? [prev, ...SWING.slice(1)] : SWING.slice(1);
    for (const a of tries) { const p = pen(a); if (p < best - 1e-4) { best = p; bestA = a; } if (p <= 0) break; }
  }
  const a = prev + Math.max(-0.3, Math.min(0.3, bestA - prev));
  out.swA = a;
  if (a) { const c = Math.cos(a), s = Math.sin(a); _up.copy(up0).multiplyScalar(c).addScaledVector(_sd, s); }
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
  if (avoid) swingClear(avoid, root, target, x, h, out);
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
// Legs: a ball hip, a hinge knee and a hinged ankle. The knee only folds forward (the bend plane is set by the
// pole: the way the pelvis faces, turned toward the way the foot points by at most 35 degrees, which is what
// a hip can twist), the shin keeps the thigh's roll so the knee is a true hinge, and a leg that cannot reach
// stretches a little rather than breaking.
const _kn = new THREE.Vector3(), _fz = new THREE.Vector3(), _pq = new THREE.Quaternion();
const KNEE_TURN = 0.6; // how far the knee follows the foot's yaw (of the yaw between pelvis and foot)
const KNEE_MAX_YAW = 0.6; // rad: the hip cannot twist the thigh further than this against the pelvis
function legPole(pelvisQ, foot, side, pole) {
  // the foot's yaw against the pelvis's, turned to a bend direction (clamped to what the hip allows)
  _fz.set(foot.elements[8], 0, foot.elements[10]);
  const fy = _fz.lengthSq() > 1e-4 ? Math.atan2(_fz.x, _fz.z) : 0;
  _pole.set(0, 0, 1).applyQuaternion(pelvisQ);
  const py = Math.atan2(_pole.x, _pole.z);
  let dy = fy - py;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const yaw = py + THREE.MathUtils.clamp(dy * KNEE_TURN, -KNEE_MAX_YAW, KNEE_MAX_YAW) + side * 0.07; // knees track just outside the toes
  return pole.set(Math.sin(yaw), 0, Math.cos(yaw));
}
function hipOf(p, side, D, out) { return out.set(side * D.HIP_X, 0, 0).applyMatrix4(p.pelvis); }
export function solveLegs(p) {
  FLOOR = p.floor || null;
  solveTorso(p);
  p.pelvis.decompose(_bp, _bq, _bs);
  p.legStretch = 1;
  const D = p.dims || U;
  const e = p.feet;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1; // feet[0] is the right foot (-x)
    hipOf(p, side, D, _s);
    _t.copy(_ank).applyMatrix4(e[i]);
    legPole(_bq, e[i], side, _pole);
    p.legStretch = Math.max(p.legStretch, joint(p.legs[i], _s, _t, D.LEG[0], D.LEG[1], _pole, 0.02, 1, null, 0));
  }
  FLOOR = null;
  return p;
}
// Joint limits the pose has to respect after the feet are placed: the ankle only folds so far (dorsiflexion up,
// plantarflexion down) and a planted sole rests on the ground, so a foot never pokes through the terrain or hovers over it.
const DORSI = 0.5, PLANTAR = 0.95; // rad
const _fi = new THREE.Matrix4(), _ax = new THREE.Vector3(), _fq = new THREE.Quaternion(), _fp = new THREE.Vector3(), _fs = new THREE.Vector3();
export function legPass(s, out) {
  const D = out.dims || U;
  if ((s.dead ?? -1) >= 0) return;
  solveTorso(out);
  out.pelvis.decompose(_bp, _bq, _bs);
  // lifting a boot onto its sole changes where the shin points, so the limit and the sole are settled together
  for (let pass = 0; pass < 3; pass++) {
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1, f = out.feet[i];
    // where the shin points: solve the leg once with the foot as placed
    hipOf(out, side, D, _s);
    _t.copy(_ank).applyMatrix4(f);
    legPole(_bq, f, side, _pole);
    const tmp = out.legs[i];
    joint(tmp, _s, _t, D.LEG[0], D.LEG[1], _pole, 0.02, 1, null, 0);
    // the shin's forward lean against the foot's own up axis (in the foot's frame): + is dorsiflexion, the toe toward the shin
    const e = tmp[1].elements;
    _kn.set(-e[8], -e[9], -e[10]).normalize(); // up the shin
    _fz.copy(_kn).transformDirection(_fi.copy(f).invert());
    const flex = Math.atan2(_fz.z, Math.max(1e-3, _fz.y));
    const over = (flex > DORSI ? flex - DORSI : flex < -PLANTAR ? flex + PLANTAR : 0);
    if (Math.abs(over) > 1e-3) {
      // turn the foot about the ankle, about its own side-to-side axis, until the joint is back in range
      _ax.set(f.elements[0], f.elements[1], f.elements[2]).normalize();
      f.decompose(_fp, _fq, _fs);
      T.copy(_ank).applyMatrix4(f); // the ankle in the unit frame
      _pq.setFromAxisAngle(_ax, over); // toe down when dorsiflexion is over the limit (the heel comes up)
      _fq.premultiply(_pq);
      T.sub(_fp.copy(_ank).applyQuaternion(_fq));
      f.compose(_fp.copy(T), _fq, S1);
    }
  }
  // a planted sole rests exactly on the ground (flat to a slope); a swinging boot only has to stay out of it. This also holds
  // while going down or getting up, so a boot never sinks through the ground on the way.
  for (let i = 0; i < 2; i++) {
    const f = out.feet[i], gy = s.gnd ? s.gnd[i] : 0, gxs = s.slope ? s.slope[i][0] : 0, gzs = s.slope ? s.slope[i][1] : 0;
    const lo = soleLow(f, gy, gxs, gzs, s.lod > 0 ? null : s), st = (out.st ? out.st[i] : 0) * (1 - smooth(0.02, 0.2, s.prone || 0));
    let dy = -lo * st;
    if (lo + dy < 0.0005) dy += 0.0005 - (lo + dy);
    f.elements[13] += dy;
  }
  }
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
