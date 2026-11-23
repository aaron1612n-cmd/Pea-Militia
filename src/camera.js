import * as THREE from 'three';
import { U } from './rig.js';
import { HALF } from './world.js';
import { height } from './terrain.js';

const V = () => new THREE.Vector3();

// Player camera. Third person sits pulled back over the right shoulder so the crosshair has a
// clear view past the body; first person sits at the visor. Aim-down-sights narrows the view.
// The overview mode is a free tactical camera used by the sandbox palette.
export class PlayerCam {
  constructor(camera) {
    this.camera = camera;
    this.mode = '3p'; // '3p' | '1p' | 'over'
    this.yaw = Math.PI;
    this.pitch = -0.05;
    this.ads = 0;
    this.fov = 70;
    this.shake = 0;
    this.frozen = false;
    this.dist = 3.4;
    this.shoulder = 0.78;
    this.lift = 0.32;
    this.blend = 0; // 0 = 3p, 1 = 1p (smooth switch)
    this.roll = 0;
    this.cockpit = false; // vehicle first person
    this.fpFov = 84;
    this.pos = V();
    this.focus = V();
    // overview
    this.fr = V(); // free-fly camera position
    this.over = { x: 0, z: 0, yaw: Math.PI, pitch: 0.95, height: 40 };
    this.collide = null; // (from, dir, maxT) => t
  }

  look(dx, dy) {
    if (this.mode === 'over') {
      this.over.yaw -= dx;
      this.over.pitch = THREE.MathUtils.clamp(this.over.pitch + dy, 0.35, 1.45);
      return;
    }
    const sens = 1 - this.ads * 0.45;
    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.35, 1.35);
  }

  // view direction from yaw/pitch (yaw 0 looks toward -z, like the old follow cam)
  forward(out = V()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
  // the direction the player's body faces (unit yaw convention: +z at 0)
  get bodyYaw() { return this.yaw + Math.PI; }

  setMode(m) {
    if (m === 'over' && this.mode !== 'over') {
      this.prevMode = this.mode;
      this.over.x = this.focus.x; this.over.z = this.focus.z;
      this.over.yaw = this.yaw;
    }
    this.mode = m;
  }

  pan(dx, dz) {
    const o = this.over;
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    // dx: screen right, dz: screen up (forward on the ground)
    o.x += c * dx - s * dz;
    o.z += -s * dx - c * dz;
    o.x = THREE.MathUtils.clamp(o.x, -HALF, HALF);
    o.z = THREE.MathUtils.clamp(o.z, -HALF, HALF);
  }

  zoom(f) { this.over.height = THREE.MathUtils.clamp(this.over.height * f, 8, 140); }

  // free camera: fly where you look (forward/back follow the pitch), strafe, rise and sink
  fly(dt, mv, up, fast) {
    const f = this.forward(V());
    const right = V().set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const v = f.multiplyScalar(mv.y).addScaledVector(right, mv.x);
    v.y += up;
    const sp = (fast ? 38 : 13) * dt;
    this.fr.addScaledVector(v, sp);
    this.fr.x = THREE.MathUtils.clamp(this.fr.x, -HALF - 10, HALF + 10);
    this.fr.z = THREE.MathUtils.clamp(this.fr.z, -HALF - 10, HALF + 10);
    this.fr.y = THREE.MathUtils.clamp(this.fr.y, 0.6, 120);
  }

  update(dt, unit, snap = false) {
    if (this.frozen) return;
    const cam = this.camera;
    if (this.mode === 'free') {
      cam.position.copy(this.fr);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(this.pitch, this.yaw, 0);
      this.setFov(68, dt);
      return;
    }
    if (this.mode === 'over') {
      const o = this.over;
      const back = o.height / Math.tan(o.pitch);
      const goal = new THREE.Vector3(o.x + Math.sin(o.yaw) * back, o.height, o.z + Math.cos(o.yaw) * back);
      const a = snap ? 1 : 1 - Math.exp(-10 * dt);
      cam.position.lerp(goal, a);
      cam.lookAt(o.x, 0, o.z);
      this.setFov(55, dt);
      return;
    }
    if (unit.vehicle) { this.updateVehicle(dt, unit.vehicle, snap); return; }
    const k = 1 - Math.exp(-12 * dt);
    this.blend += ((this.mode === '1p' ? 1 : 0) - this.blend) * (snap ? 1 : Math.min(1, k * 1.2));
    const eye = unit.eye(V());
    eye.y += unit.alive ? 0 : -0.5;
    if (snap) this.focus.copy(eye);
    else {
      this.focus.x += (eye.x - this.focus.x) * (1 - Math.exp(-30 * dt));
      this.focus.z += (eye.z - this.focus.z) * (1 - Math.exp(-30 * dt));
      this.focus.y += (eye.y - this.focus.y) * (1 - Math.exp(-14 * dt));
    }
    const f = this.forward(V());
    const right = V().set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // third person: behind, over the right shoulder, a little above the head
    const d = THREE.MathUtils.lerp(this.dist, 1.9, this.ads);
    let side = this.shoulder * (1 - this.ads * 0.25);
    // keep the shoulder pivot out of a wall the player is standing against
    if (this.collide) {
      const t = this.collide(this.focus, right, side + 0.3);
      if (t < side + 0.3) side = Math.max(0, t - 0.3);
    }
    const pivot = this.focus.clone().addScaledVector(right, side).add(V().set(0, this.lift, 0));
    let tp = pivot.clone().addScaledVector(f, -d);
    // keep the camera out of walls and the ground
    if (this.collide) {
      const dir = V().subVectors(tp, pivot);
      const len = dir.length();
      dir.divideScalar(len);
      const t = this.collide(pivot, dir, len + 0.25);
      if (t < len + 0.25) tp = pivot.clone().addScaledVector(dir, Math.max(0.2, t - 0.25));
    }
    tp.y = Math.max(tp.y, 0.25);
    // first person is a chest-mounted bodycam: a touch low, wide, and it moves with the stride
    const fp = this.focus.clone().addScaledVector(f.clone().setY(0).normalize(), 0.16);
    const w = unit.walk * (1 - 0.6 * this.ads) * (unit.sprinting ? 1.6 : 1);
    const c = unit.cycle * Math.PI * 2;
    fp.y -= 0.04;
    fp.y += -Math.abs(Math.cos(c)) * 0.028 * w + 0.014 * w;
    fp.addScaledVector(right, Math.sin(c) * 0.016 * w);
    this.pos.lerpVectors(tp, fp, this.blend);
    cam.position.copy(this.pos);
    cam.lookAt(this.pos.clone().add(f));
    if (this.blend > 0.01) {
      this.roll += ((Math.sin(c) * 0.012 * w - (unit.mx || 0) * unit.walk * 0.02) - this.roll) * (1 - Math.exp(-10 * dt));
      cam.rotateZ(this.roll * this.blend);
    }
    if (this.shake > 0.001) {
      const s = this.shake * 0.02;
      cam.rotation.x += (Math.random() - 0.5) * s;
      cam.rotation.y += (Math.random() - 0.5) * s;
    }
    const base = THREE.MathUtils.lerp(this.fov, this.fpFov, this.blend);
    this.setFov(THREE.MathUtils.lerp(base, base * 0.6, this.ads), dt);
  }

  // Chase camera: high and over the right shoulder, so the hull sits low in the frame and the
  // crosshair looks past it. Cockpit mode sits at the driver's eyes instead.
  updateVehicle(dt, v, snap) {
    const cam = this.camera;
    this.blend += (0 - this.blend) * (snap ? 1 : 0.3);
    const f = this.forward(V());
    if (this.cockpit) {
      const eye = v.cockpitEye(V());
      this.focus.copy(eye);
      this.pos.copy(eye);
      cam.position.copy(eye);
      cam.lookAt(eye.clone().add(f));
      cam.rotateZ(-v.roll * 0.6 * Math.cos(this.yaw - v.yaw));
      if (this.shake > 0.001) {
        const s = this.shake * 0.02;
        cam.rotation.x += (Math.random() - 0.5) * s;
        cam.rotation.y += (Math.random() - 0.5) * s;
      }
      this.setFov(82 - this.ads * 25 + Math.min(8, Math.abs(v.speed) * 0.5), dt);
      return;
    }
    const d0 = v.def;
    const eye = V().set(v.pos.x, v.pos.y + (d0.camUp ?? d0.camHeight * 1.5), v.pos.z);
    if (snap) this.focus.copy(eye);
    else this.focus.lerp(eye, 1 - Math.exp(-16 * dt));
    const right = V().set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const d = d0.camDist * (1 - this.ads * 0.35);
    let side = d0.camSide ?? 1;
    if (this.collide) {
      const t = this.collide(this.focus, right, side + 0.3);
      if (t < side + 0.3) side = Math.max(0, t - 0.3);
    }
    const pivot = this.focus.clone().addScaledVector(right, side);
    let tp = pivot.clone().addScaledVector(f, -d);
    if (this.collide) {
      const dir = V().subVectors(tp, pivot);
      const len = dir.length();
      dir.divideScalar(len);
      const t = this.collide(pivot, dir, len + 0.25);
      if (t < len + 0.25) tp = pivot.clone().addScaledVector(dir, Math.max(1.5, t - 0.25));
    }
    tp.y = Math.max(tp.y, height(tp.x, tp.z) + 0.6);
    this.pos.copy(tp);
    cam.position.copy(tp);
    cam.lookAt(tp.clone().add(f));
    if (this.shake > 0.001) {
      const s = this.shake * 0.02;
      cam.rotation.x += (Math.random() - 0.5) * s;
      cam.rotation.y += (Math.random() - 0.5) * s;
    }
    this.setFov(72 + Math.min(8, Math.abs(v.speed) * 0.7), dt);
  }

  setFov(goal, dt) {
    const cam = this.camera;
    const f = cam.fov + (goal - cam.fov) * (1 - Math.exp(-14 * dt));
    if (Math.abs(f - cam.fov) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
  }
}

export { U };
