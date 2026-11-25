import * as THREE from 'three';
import { HOLD, U, makePose } from './rig.js';

// First-person gun, bodycam style: the gun and hands hang in front of the camera, bob with the
// stride, lag behind quick turns, kick on each shot, and come up to the centre line when aiming
// down the sights so the bore sits just under the crosshair.
const E = new THREE.Euler(0, 0, 0, 'YXZ');
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S1 = new THREE.Vector3(1, 1, 1);
const S = new THREE.Vector3(1, 1, 1);
// viewmodel size: the gun is drawn at true size for the soldier, in its own pass with its own field of view
const VM_SCALE = 1.0;
export const VM_FOV = 56; // vertical degrees, independent of the world camera's zoom
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);
const BODY = new THREE.Matrix4();
// Per weapon, in the scaled gun frame (metres, grip at the origin, barrel along +z):
//  relief: eye to rear sight when aiming; rz: where the rear sight sits along the gun;
//  zoom: world field of view factor while aiming (iron sights are a modest step in);
//  rh / lh: trigger hand [y, z] on the grip, support hand [y, z] on the handguard, foregrip, handle or tube.
export const VIEW = {
  rifle: { relief: 0.27, rz: 0.019, zoom: 0.76, rh: [-0.032, -0.006], lh: [-0.04, 0.19] },
  smg: { relief: 0.24, rz: 0.0, zoom: 0.82, rh: [-0.032, -0.006], lh: [-0.03, 0.18] },
  mg: { relief: 0.31, rz: 0.013, zoom: 0.78, rh: [-0.032, -0.006], lh: [-0.055, 0.28] },
  plasma: { relief: 0.33, rz: 0.019, zoom: 0.8, rh: [-0.032, -0.006], lh: [-0.03, 0.17] },
  launcher: { relief: 0.44, rz: 0.01, zoom: 0.78, rh: [-0.032, -0.006], lh: [-0.02, 0.15] },
};
const DEF_VIEW = VIEW.rifle;
const L = new THREE.Matrix4();
const BP = new THREE.Vector3(), BQ = new THREE.Quaternion();
const M = new THREE.Matrix4();
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

// The unseen shoulders follow the hands: slide the body toward them until both arms reach the gun
// without stretching, so the forearms keep their true length however the gun is carried or aimed.
const SH = new THREE.Vector3(), HP = new THREE.Vector3(), SHIFT = new THREE.Vector3(), EX = new THREE.Vector3();
function seatShoulders(p) {
  const max = (U.ARM[0] + U.ARM[1]) * 0.94;
  for (let it = 0; it < 3; it++) {
    SHIFT.set(0, 0, 0);
    for (let i = 0; i < 2; i++) {
      SH.set((i === 0 ? 1 : -1) * U.SH_X, U.SH_Y, -0.005).applyMatrix4(p.body);
      HP.setFromMatrixPosition(p.hands[i]);
      EX.subVectors(HP, SH);
      const d = EX.length();
      if (d > max) SHIFT.addScaledVector(EX, (d - max) / d * 0.5);
    }
    if (SHIFT.lengthSq() < 1e-8) break;
    p.body.elements[12] += SHIFT.x; p.body.elements[13] += SHIFT.y; p.body.elements[14] += SHIFT.z;
  }
}

export class ViewModel {
  constructor() {
    this.pose = makePose();
    this.sway = new THREE.Vector2();
    this.swayV = new THREE.Vector2();
    this.sprintK = 0;
    this.identity = new THREE.Matrix4();
  }

  // look: this frame's look input (radians), dt: frame time
  update(dt, camera, u, ads, look) {
    const h = HOLD[u.weapon.id];
    const p = this.pose;
    // sway: the gun trails the view a little and springs back
    this.swayV.x += (-look.dx * 0.9 - this.sway.x * 40) * dt * 6;
    this.swayV.y += (-look.dy * 0.9 - this.sway.y * 40) * dt * 6;
    this.swayV.multiplyScalar(Math.exp(-14 * dt));
    this.sway.addScaledVector(this.swayV, dt * 6);
    this.sway.clampScalar(-0.08, 0.08);
    this.sprintK += ((u.sprinting ? 1 : 0) - this.sprintK) * (1 - Math.exp(-8 * dt));
    const a = ads * (1 - this.sprintK);
    const w = u.walk * (1 - 0.7 * a);
    const c = u.cycle * Math.PI * 2;
    const bobX = Math.sin(c) * 0.014 * w, bobY = -Math.abs(Math.cos(c)) * 0.016 * w + 0.008 * w;
    const breathe = Math.sin(u.t * 1.6) * 0.002 * (1 - a);
    const rec = u.recoil;
    const rp = u.reloadT > 0 ? Math.min(1, 1 - u.reloadT / u.reloadDur) : -1;
    const rl = rp >= 0 ? Math.sin(rp * Math.PI) : 0;
    // an empty gun finishes with a hard pull on the charging handle
    const rack = rp > 0.72 && u.reloadEmpty && u.weapon.def.rack ? Math.sin(((rp - 0.72) / 0.28) * Math.PI) : 0;
    const rb = u.recoilBuild || 0;
    const jam = u.jamT > 0 ? Math.sin(u.t * 24) * 0.5 + 0.5 : 0; // clearing a jam: the gun rocks as the bolt is worked
    const air = u.air;

    camera.updateMatrixWorld();
    // the (unseen) body the arms hang from sits below and behind the eyes; aiming lifts the
    // shoulders so the arms stay short and bent instead of stretching out to the gun
    BODY.makeTranslation(0, lerp(-0.5, -0.3, a), lerp(0.12, 0.1, a)).multiply(FLIP);
    p.body.multiplyMatrices(camera.matrixWorld, BODY);
    const sw = this.sway.x * (1 - 0.6 * a), sh = this.sway.y * (1 - 0.6 * a);
    if (h.oneHand) {
      // grenade: held low right; a throw swings it up and forward
      const th = u.throwT > 0 ? 1 - u.throwT / 0.6 : -1;
      let x = 0.2, y = -0.22, z = -0.38, rx = 0.2;
      if (th >= 0) {
        const up = smooth(0, 0.45, th), out = smooth(0.45, 0.7, th), back = smooth(0.7, 1, th);
        y = lerp(lerp(-0.22, -0.02, up), -0.12, out); z = lerp(lerp(-0.38, -0.22, up), -0.6, out);
        y = lerp(y, -0.22, back); z = lerp(z, -0.38, back); rx = lerp(0.2, -0.6, up * (1 - back));
      }
      E.set(rx, Math.PI, 0, 'YXZ'); Q.setFromEuler(E);
      L.compose(P.set(x + bobX + sw, y + bobY + sh, z), Q, S1);
      p.hands[1].multiplyMatrices(camera.matrixWorld, L);
      p.weapon.multiplyMatrices(p.hands[1], M.makeRotationX(-Math.PI / 2 + 0.4).setPosition(0, 0, 0.03));
      L.compose(P.set(-0.22 + bobX, -0.26 + bobY, -0.42), Q, S1);
      p.hands[0].multiplyMatrices(camera.matrixWorld, L);
      p.showWeapon = !(u.thrown && u.throwT > 0);
      p.muzzle.setFromMatrixPosition(p.hands[1]);
      return p;
    }
    // hip: low and right, angled a touch inward. Aiming brings the rear sight to a believable eye
    // relief on the line of sight (centre of the view), with the gun's sight line level with it,
    // so the notch, the post and the crosshair stack up. A wall close ahead pulls the gun back and
    // tips the muzzle up (high ready) and takes the sights away.
    const V = VIEW[u.weapon.id] || DEF_VIEW;
    const wall = u.wallK || 0;
    const ae = smooth(0, 1, a) * (1 - wall); // eased in and out
    const sightY = h.sight;
    const x = lerp(0.12, 0, ae) + bobX + sw - this.sprintK * 0.02 - wall * 0.02;
    const y = lerp(-0.12, -sightY, ae) + bobY + breathe + sh - rl * h.anim.drop - this.sprintK * 0.05 - air * 0.02 + wall * 0.02;
    const z = lerp(-0.32, -V.relief + V.rz, ae) + rec * h.anim.kick * (1 + rb * 0.7) + rack * 0.035 + jam * 0.01 + wall * 0.13;
    const yaw = lerp(0.05, 0, ae) + this.sprintK * 0.7 + sw * 2 + wall * 0.1;
    // (positive x rotation tips the barrel down)
    const pitch = -rec * h.anim.climb * (1 + rb * 0.9) * (1 - 0.5 * ae) - rb * 0.05 * (1 - 0.4 * ae) + rack * 0.1 + jam * 0.05 + rl * h.anim.tilt + this.sprintK * 0.35 + sh * 2 - wall * 0.5;
    E.set(pitch, Math.PI + yaw + rb * 0.03 * Math.sin(u.shotIdx * 2.1), -rl * h.anim.roll + bobX * 2 + rb * 0.04 * Math.sin(u.shotIdx * 1.7) + wall * 0.05, 'YXZ');
    Q.setFromEuler(E);
    L.compose(P.set(x, y, z), Q, S1);
    p.weapon.multiplyMatrices(camera.matrixWorld, L);
    // trigger hand on the grip, support hand cupping the handguard (or the magazine mid-reload)
    p.hands[1].multiplyMatrices(p.weapon, h.rh.m);
    BP.lerpVectors(h.lhA.p, h.magA.p, rl); BQ.copy(h.lhA.q).slerp(h.magA.q, rl);
    p.hands[0].multiplyMatrices(p.weapon, M.compose(BP, BQ, S1));
    p.showWeapon = true;
    p.muzzle.copy(h.muzzle).applyMatrix4(p.weapon);
    seatShoulders(p);
    return p;
  }
}
