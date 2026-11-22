import * as THREE from 'three';
import { HOLD, makePose } from './rig.js';

// First-person gun, bodycam style: the gun and hands hang in front of the camera, bob with the
// stride, lag behind quick turns, kick on each shot, and come up to the centre line when aiming
// down the sights so the bore sits just under the crosshair.
const E = new THREE.Euler(0, 0, 0, 'YXZ');
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S1 = new THREE.Vector3(1, 1, 1);
const HAND_S = new THREE.Matrix4().makeScale(0.75, 0.75, 0.75);
const L = new THREE.Matrix4();
const M = new THREE.Matrix4();
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

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
    const rl = u.reloadT > 0 ? Math.sin(Math.min(1, 1 - u.reloadT / u.weapon.def.reload) * Math.PI) : 0;
    const air = u.air;

    camera.updateMatrixWorld();
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
    // hip: low and right, angled a touch inward; sights: bore centred just under the crosshair
    const sightDrop = h.sight;
    const x = lerp(0.17, 0, a) + bobX + sw - this.sprintK * 0.02;
    const y = lerp(-0.2, -sightDrop, a) + bobY + breathe + sh - rl * 0.06 - this.sprintK * 0.05 - air * 0.02;
    const z = lerp(-0.4, -0.17, a) + rec * 0.05;
    const yaw = lerp(0.05, 0, a) + this.sprintK * 0.7 + sw * 2;
    // (positive x rotation tips the barrel down)
    const pitch = -rec * 0.1 * (1 - 0.5 * a) + rl * 0.45 + this.sprintK * 0.35 + sh * 2;
    E.set(pitch, Math.PI + yaw, -rl * 0.4 + bobX * 2, 'YXZ');
    Q.setFromEuler(E);
    L.compose(P.set(x, y, z), Q, S1);
    p.weapon.multiplyMatrices(camera.matrixWorld, L);
    p.hands[1].multiplyMatrices(p.weapon, M.makeTranslation(0, -0.045, -0.01));
    p.hands[0].multiplyMatrices(p.weapon, M.makeTranslation(0, lerp(h.foreY, -0.1, rl), lerp(h.fore, 0.1, rl)));
    p.hands[0].multiply(HAND_S); p.hands[1].multiply(HAND_S);
    p.showWeapon = true;
    p.muzzle.copy(h.muzzle).applyMatrix4(p.weapon);
    return p;
  }
}
