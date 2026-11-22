import * as THREE from 'three';

// The soldier: an upright rounded block with a visor, a small pack, and free-floating hands
// and feet. pose() turns animation state into part transforms in the unit's own frame
// (origin on the ground under the body, +z forward, +y up, so the right side is -x). Nothing here touches the scene,
// so the same maths drives the instanced crowd, the first-person view and the check suite.
export const U = {
  W: 0.46, H: 0.92, D: 0.32, R: 0.1, // body block
  LIFT: 0.16, // body bottom above the ground when standing
  FOOT: [0.15, 0.085, 0.25], FOOT_X: 0.12,
  HAND: [0.1, 0.1, 0.12],
  VISOR: [0.4, 0.095, 0.05], VISOR_Y: 0.86,
  PACK: [0.3, 0.32, 0.12], PACK_Y: 0.6,
  EYE: 0.86,
  RADIUS: 0.3, // ground collision radius
  WEAPON_SCALE: 0.92,
  KNEEL_DROP: 0.13,
};
U.BODY_Y = U.LIFT + U.H / 2;
U.TOP = U.LIFT + U.H;

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
  flame: { kick: 0.0, climb: 0.012, hand: [-0.15, 0.1], tilt: 0.1, roll: 0.2, drop: 0.07 },
  launcher: { kick: 0.07, climb: 0.13, hand: [0.1, 0.3], tilt: 0.7, roll: 0.0, drop: 0.08 },
  grenade: { kick: 0, climb: 0, hand: [0, 0], tilt: 0, roll: 0, drop: 0 },
};
export function setWeaponBounds(id, box, muzzle, sight = box.max.y) {
  const s = U.WEAPON_SCALE;
  const half = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * s;
  HOLD[id] = {
    x: U.W / 2 + Math.max(half, U.HAND[0] / 2) + 0.025, // gun plane clear of the body side
    fore: Math.min(box.max.z * s * 0.55, 0.3),
    foreY: Math.min(-0.03, box.min.y * s * 0.35),
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

function compose(out, x, y, z, rx = 0, ry = 0, rz = 0) {
  E.set(rx, ry, rz, 'YXZ');
  Q.setFromEuler(E);
  return out.compose(P.set(x, y, z), Q, S1);
}

// visor and pack ride on the body
export function attachToBody(out, headYaw = 0, headPitch = 0) {
  M.copy(out.body);
  // the head (visor) turns and tips toward what the soldier is aiming at; it rides on the body's surface
  const hy = U.VISOR_Y - U.BODY_Y;
  compose(out.visor, 0, hy, 0, -headPitch, headYaw, 0);
  out.visor.multiply(M2.makeTranslation(0, 0, U.D / 2 + 0.006));
  out.visor.multiplyMatrices(M, out.visor);
  out.pack.multiplyMatrices(M, compose(out.pack, 0, U.PACK_Y - U.BODY_Y, -U.D / 2 - U.PACK[2] / 2 + 0.02));
  return out;
}

export function makePose() {
  return {
    body: new THREE.Matrix4(), visor: new THREE.Matrix4(), pack: new THREE.Matrix4(),
    feet: [new THREE.Matrix4(), new THREE.Matrix4()], hands: [new THREE.Matrix4(), new THREE.Matrix4()],
    arms: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()], showArms: true,
    weapon: new THREE.Matrix4(), muzzle: new THREE.Vector3(), showWeapon: true, height: U.TOP,
  };
}

// One foot over a walk cycle: on the ground and sliding back for 60%, then lifting through.
function footAt(p, stride) {
  const STANCE = 0.6;
  if (p < STANCE) return { along: lerp(0.5, -0.5, p / STANCE) * stride, lift: 0, pitch: 0 };
  const k = (p - STANCE) / (1 - STANCE);
  const lift = Math.sin(k * Math.PI);
  // toe up on the way through, never dipping below the ground
  return { along: lerp(-0.5, 0.5, smooth(0, 1, k)) * stride, lift, pitch: Math.sin(k * Math.PI * 2) * 0.18 * lift };
}

// s: { t, walk, cycle, stride, mx, mz (local move dir), air, rise, land, kneel, aimPitch, twist,
//      ready (0 lowered .. 1 shouldered), recoil, reload (-1 or 0..1), throw (-1 or 0..1),
//      flinch, ads (0..1, first person centre), fp (first person view), dead (-1 or 0..1 topple), weapon, sprint }
function poseCore(s, out) {
  const t = s.t || 0, walk = s.walk || 0, kneel = s.kneel || 0, air = s.air || 0;
  const mx = s.mx ?? 0, mz = s.mz ?? 1;
  const cyc = s.cycle || 0;
  const stride = s.stride ?? 0.3;
  const dead = s.dead ?? -1;

  // ---- body: bob twice per cycle, sway once, lean into the walk, sink on landing/kneeling
  const breathe = Math.sin(t * 1.7) * 0.006 * (1 - walk);
  const bob = -Math.abs(Math.cos(cyc * Math.PI * 2)) * 0.03 * walk + 0.015 * walk;
  const land = (s.land || 0) * 0.07;
  const drop = kneel * U.KNEEL_DROP + land - air * 0.02 * (s.rise || 0);
  const lean = 0.09 * walk * (s.sprint ? 1.8 : 1) + 0.12 * kneel + (s.flinch || 0) * -0.1;
  const sway = Math.sin(cyc * Math.PI * 2) * 0.03 * walk;
  // lean toward the move direction (pitch for forward/back, roll for sideways)
  const pitchLean = lean * (walk > 0.05 ? mz : 1) + 0.05 * air * (s.rise || 0);
  const rollLean = -lean * (walk > 0.05 ? mx : 0) * 0.7 + sway;
  let by = U.BODY_Y + bob + breathe - drop;
  // the body pivots about its base so leaning doesn't swing the feet
  const base = by - U.H / 2;
  E.set(pitchLean, 0, rollLean, 'YXZ');
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
    const pz = -U.D / 2, py = U.LIFT * (1 - k);
    T.set(0, U.H / 2, U.D / 2).applyQuaternion(Q);
    out.body.compose(P.set(0, py + T.y, pz + T.z), Q, S1);
    by = py + T.y;
  }

  attachToBody(out, THREE.MathUtils.clamp(s.twist || 0, -0.5, 0.5) * 0.3, THREE.MathUtils.clamp(s.aimPitch || 0, -0.6, 0.6) * 0.35 * (dead >= 0 ? 0 : 1));

  // ---- feet
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    let x = side * U.FOOT_X, y = U.FOOT[1] / 2, z = 0, rx = 0;
    if (dead >= 0) {
      // lying on its back: feet tip up, soles toward the sky
      const k = smooth(0, 1, dead);
      rx = -k * 1.4;
      // lift by the rotated box's half extent so the toe never digs in
      y = (U.FOOT[1] / 2) * Math.cos(-rx) + (U.FOOT[2] / 2) * Math.sin(-rx) + 0.001;
    } else {
      const f = footAt((cyc + (i ? 0.5 : 0)) % 1, stride);
      const w = walk;
      x += mx * f.along * w * 0.6; // side steps are shorter
      z += mz * f.along * w;
      y += f.lift * 0.045 * w + air * (0.03 + (i ? 0.02 : 0));
      rx = -f.pitch * w * mz + air * 0.25;
      // kneel: one foot forward, the other tucked back up on its toe
      if (kneel > 0) {
        z = lerp(z, i ? 0.27 : -0.3, kneel);
        y = lerp(y, i ? U.FOOT[1] / 2 : U.FOOT[1] / 2 + 0.05, kneel);
        rx = lerp(rx, i ? 0 : 0.3, kneel);
      }
    }
    compose(out.feet[i], x, y, z, rx, 0, 0);
  }

  // ---- weapon and hands
  const id = s.weapon || 'rifle';
  const h = HOLD[id] || { x: 0.31, fore: 0.25, foreY: -0.04, muzzle: new THREE.Vector3(0, 0.03, 0.5), oneHand: false };
  const ready = s.ready ?? 1, ads = s.ads || 0, recoil = s.recoil || 0;
  const twist = THREE.MathUtils.clamp(s.twist || 0, -0.5, 0.5);
  out.showWeapon = dead < 0;
  if (dead >= 0) {
    const k = smooth(0, 1, dead);
    for (let i = 0; i < 2; i++) compose(out.hands[i], (i ? 1 : -1) * lerp(0.36, 0.42, k), lerp(0.55, U.HAND[1] / 2, k), lerp(0.1, -0.35, k), 0, 0, 0);
    out.weapon.copy(out.hands[1]);
    return out;
  }
  const bodyDrop = U.BODY_Y - by;
  if (h.oneHand) {
    // grenade in the right hand; throw: wind up behind, release over the top, follow through
    const th = s.throw ?? -1;
    let rx = -0.34, ry = 0.62, rz = 0.22, lx = 0.34, ly = 0.55, lz = 0.06;
    if (th >= 0) {
      const a = smooth(0, 0.42, th), b = smooth(0.42, 0.62, th), c = smooth(0.62, 1, th);
      rx = lerp(-0.34, -0.46, a); ry = lerp(lerp(0.62, 1.1, a), 0.92, b); rz = lerp(lerp(0.22, 0.0, a), 0.5, b);
      ry = lerp(ry, 0.62, c); rz = lerp(rz, 0.22, c); rx = lerp(rx, -0.34, c);
      lx = lerp(0.34, 0.33, a); ly = lerp(0.55, 0.85, a * (1 - c)); lz = lerp(0.06, 0.42, a * (1 - c));
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
  // the gun is held out in front of the chest, butt against the front of the body, so neither arm
  // ever has to pass through the torso: right hand on the grip, left hand forward on the fore-end
  const px = lerp(lerp(-0.14, -0.2, fp), 0, ads);
  const py = lerp(U.EYE - 0.12 + aimK * 0.04 - fp * 0.09, U.EYE - 0.085, ads) - bodyDrop - lowered * 0.1 - rk * h.anim.drop;
  const pz = lerp(Math.max(0.17, U.D / 2 + 0.09 + (s.sprint ? 0.1 : 0) + Math.max(0, -(s.aimPitch || 0)) * 0.2 + (h.back || 0.3) - 0.13) + fp * 0.1, 0.02, ads);
  const pitch = (s.aimPitch || 0) - lowered * 0.55 - rk * h.anim.tilt + recoil * h.anim.climb;
  // twist turns the whole arms-and-gun assembly about the body's axis
  E.set(0, twist, 0, 'YXZ');
  Q2.setFromEuler(E);
  E.set(-pitch, twist, -rk * h.anim.roll, 'YXZ');
  Q.setFromEuler(E);
  T.set(px, py, pz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, twist);
  // the grip sits a little forward and below the shoulder line; recoil kicks it back
  P.set(0, -0.05, 0.13 - recoil * h.anim.kick).applyQuaternion(Q).add(T);
  out.weapon.compose(P, Q, S1);
  out.muzzle.copy(h.muzzle).applyMatrix4(out.weapon);
  // trigger hand just under the grip; support hand on the fore-end, or on the mag mid-reload
  out.hands[1].multiplyMatrices(out.weapon, compose(M, 0, -0.045, -0.01));
  let fz = lerp(h.fore, h.anim.hand[1], rk);
  const fy = lerp(h.foreY, h.anim.hand[0], rk);
  // keep the support hand within reach of the left shoulder: slide it back along the gun if needed
  SH0.set(U.W / 2 + 0.055, U.BODY_Y + SHY - bodyDrop, U.D / 2 + 0.02);
  for (let i = 0; i < 12; i++) {
    out.hands[0].multiplyMatrices(out.weapon, compose(M, 0, fy, fz));
    if (SH0.distanceTo(P.setFromMatrixPosition(out.hands[0])) <= ARM.UPPER + ARM.FORE - 0.04) break;
    fz -= 0.02;
  }
  return out;
}

// Posture on top of the stance: lean (Q/E) rolls the upper body about the hips; prone lays the
// body face down along the facing, feet behind, and carries the gun forward at ground level.
const R = new THREE.Matrix4();
const R2 = new THREE.Matrix4();
const G = new THREE.Vector3();
const V3 = new THREE.Vector3();
export const PRONE = { PIVOT: U.D / 2 + 0.01, BACK: 0.46, GUN_Y: 0.3, ANGLE: Math.PI / 2 * 0.94 };
export function pose(s, out = makePose()) {
  poseCore(s, out);
  postures(s, out);
  // shoulders sit on the body's upper corners
  SHL.set(U.W / 2 + 0.055, SHY, U.D / 2 + 0.02).applyMatrix4(out.body);
  SHR.set(-(U.W / 2 + 0.055), SHY, U.D / 2 + 0.02).applyMatrix4(out.body);
  armsFor(out, SHL, SHR, out.body, smooth(0, 1, s.prone || 0));
  return out;
}

// Two-segment arms from each shoulder to its hand with the elbow bent down and out.
// hands[0] is the support hand (left, +x), hands[1] the trigger hand (right, -x).
const SH0 = new THREE.Vector3();
const SHL = new THREE.Vector3(), SHR = new THREE.Vector3();
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
export const SHY = 0.15; // shoulder height above the body's centre
const ARM = { W: 0.085, UPPER: 0.34, FORE: 0.34 };
function seg(m, a, b, extra = 0.03) {
  Z.subVectors(b, a);
  const len = Z.length() + extra;
  Z.normalize();
  X.crossVectors(THREE.Object3D.DEFAULT_UP, Z);
  if (X.lengthSq() < 1e-6) X.set(1, 0, 0);
  X.normalize();
  Y.crossVectors(Z, X);
  m.makeBasis(X.multiplyScalar(ARM.W), Y.multiplyScalar(ARM.W), Z.multiplyScalar(len));
  m.setPosition(C.addVectors(a, b).multiplyScalar(0.5));
}
const SIDE = new THREE.Vector3(), FWD = new THREE.Vector3();
export function armsFor(out, shl, shr, ref, prone = 0) {
  const sh = [shl, shr];
  for (let i = 0; i < 2; i++) {
    A.copy(sh[i]);
    B.setFromMatrixPosition(out.hands[i]);
    D.subVectors(B, A);
    const len = Math.min(D.length(), ARM.UPPER + ARM.FORE - 0.01);
    const mid = C.addVectors(A, B).multiplyScalar(0.5).clone();
    const h = Math.sqrt(Math.max(0, ARM.UPPER * ARM.UPPER - (len / 2) * (len / 2)));
    // bend: down and outward (away from the body centre), kept perpendicular to the arm
    const side = i === 0 ? 1 : -1;
    // elbows hang down and a little out (a short reach folds the arm, so swing the elbow wider);
    // lying prone they point out to the sides and up instead. Directions are in the soldier's
    // horizontal frame, not the tilted body's, so a lean or a prone body doesn't flip them.
    SIDE.set(1, 0, 0); FWD.set(0, 0, 1);
    if (ref) { SIDE.transformDirection(ref); FWD.transformDirection(ref); }
    SIDE.y = 0; FWD.y = 0;
    if (SIDE.lengthSq() < 1e-4) SIDE.set(1, 0, 0); else SIDE.normalize();
    if (FWD.lengthSq() < 1e-4) FWD.set(0, 0, 0); else FWD.normalize();
    const out_ = (0.25 + Math.max(0, 0.5 - len) * 3) * side;
    Y.set(0, lerp(-1, 0, prone), 0).addScaledVector(SIDE, out_ * lerp(1, 4, prone)).addScaledVector(FWD, 0.5 * (1 - prone));
    D.normalize();
    Y.addScaledVector(D, -Y.dot(D)).normalize();
    const E = mid.addScaledVector(Y, h);
    seg(out.arms[i * 2], sh[i], E);
    seg(out.arms[i * 2 + 1], E, B, 0.0);
  }
}

function postures(s, out) {
  const h = HOLD[s.weapon || 'rifle'] || {};
  const lean = s.lean || 0, prone = s.prone || 0;
  if (Math.abs(lean) < 0.001 && prone < 0.001) return out;
  const upper = [out.body, out.visor, out.pack];
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
    // the gun keeps its aim; it moves out past the head, butt just clear of it, low to the ground,
    // with both arms reaching forward along it
    G.setFromMatrixPosition(out.weapon);
    let headZ = -Infinity;
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) headZ = Math.max(headZ, V3.set(0, sy * U.H / 2, sz * U.D / 2).applyMatrix4(out.body).z);
    // (and far enough that the arms stretch out ahead instead of folding back into the body)
    const shZ = V3.set(0, SHY, U.D / 2).applyMatrix4(out.body).z;
    const gz = lerp(G.clone().applyMatrix4(R).z, Math.max(headZ + 0.03 + (h.back || 0.3), shZ + 0.56), k);
    T.set(0, lerp(G.y, Math.max(0.1, Math.min(0.16, (h.low || 0.1) + 0.02)), k) - G.y, gz - G.z);
    R.makeTranslation(T.x, T.y, T.z);
    for (const m of held) m.premultiply(R);
    out.muzzle.applyMatrix4(R);
  }
  return out;
}
