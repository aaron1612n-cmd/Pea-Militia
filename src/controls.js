import * as THREE from 'three';
import { PLATE } from './world.js';

// Orbit camera with collision against the plate and the pea's capsule.
// Mouse drag / one-finger drag: orbit. Wheel / pinch: zoom. Right-drag, shift-drag, two-finger drag: pan.
// Keys: WASD / arrows orbit, Q/E or -/+ zoom, R reset.
export class OrbitCam {
  constructor(camera, dom, { colliders, focus }) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders; // { capsules: [{a,b,r}], groundY }
    this.focus = focus; // { center: Vector3, radius }
    this.goal = { yaw: 0.55, pitch: 0.22, dist: 3, target: focus.center.clone() };
    this.cur = { ...this.goal, target: this.goal.target.clone() };
    this.limits = { minDist: 1.1, maxDist: 26, minPitch: -0.12, maxPitch: 1.45, pan: PLATE.size / 2 - 2 };
    this.pointers = new Map();
    this.keys = new Set();
    this.onInteract = null;
    this.bind();
    this.fit(true);
  }

  // Distance that frames the pea's bounding sphere for the current aspect.
  fitDistance() {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const f = Math.min(vfov, hfov);
    return (this.focus.radius / Math.sin(f / 2)) * 1.35;
  }

  fit(snap = false) {
    this.goal.yaw = 0.55;
    this.goal.pitch = 0.22;
    this.goal.dist = THREE.MathUtils.clamp(this.fitDistance(), this.limits.minDist, this.limits.maxDist);
    this.goal.target.copy(this.focus.center);
    if (snap) { Object.assign(this.cur, { ...this.goal, target: this.goal.target.clone() }); }
  }

  bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => {
      d.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey });
      this.pinch = null;
      this.ping();
    });
    const end = (e) => { this.pointers.delete(e.pointerId); this.pinch = null; };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 1) {
        if (p.btn === 2 || p.btn === 1 || p.shift) this.pan(dx, dy);
        else this.orbit(dx, dy);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoom(this.pinch / dist);
        this.pinch = dist;
        this.pan(dx / 2, dy / 2);
      }
    });
    d.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); this.ping(); }, { passive: false });
    addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'KeyR') this.fit(); this.ping(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  ping() { if (this.onInteract) this.onInteract(); }

  orbit(dx, dy) {
    const k = 5.5 / Math.max(320, Math.min(innerWidth, innerHeight));
    this.goal.yaw -= dx * k;
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * k, this.limits.minPitch, this.limits.maxPitch);
  }

  zoom(f) { this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * f, this.limits.minDist, this.limits.maxDist); }

  pan(dx, dy) {
    const s = this.goal.dist * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.goal.yaw), 0, -Math.sin(this.goal.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.goal.yaw), 0, -Math.cos(this.goal.yaw));
    this.goal.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s);
    const L = this.limits.pan;
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -L, L);
    this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, -L, L);
  }

  keyStep(dt) {
    const k = this.keys;
    const r = 1.8 * dt;
    if (k.has('KeyA') || k.has('ArrowLeft')) this.goal.yaw += r;
    if (k.has('KeyD') || k.has('ArrowRight')) this.goal.yaw -= r;
    if (k.has('KeyW') || k.has('ArrowUp')) this.goal.pitch = Math.min(this.limits.maxPitch, this.goal.pitch + r * 0.7);
    if (k.has('KeyS') || k.has('ArrowDown')) this.goal.pitch = Math.max(this.limits.minPitch, this.goal.pitch - r * 0.7);
    if (k.has('KeyE') || k.has('Equal') || k.has('NumpadAdd')) this.zoom(Math.exp(-1.6 * dt));
    if (k.has('KeyQ') || k.has('Minus') || k.has('NumpadSubtract')) this.zoom(Math.exp(1.6 * dt));
  }

  // Push a camera position out of every collider. Exposed for tests.
  resolve(pos) {
    const groundMin = this.colliders.groundY + 0.15;
    for (const c of this.colliders.capsules) {
      const ab = c.b.clone().sub(c.a);
      const t = THREE.MathUtils.clamp(pos.clone().sub(c.a).dot(ab) / ab.lengthSq(), 0, 1);
      const q = c.a.clone().addScaledVector(ab, t);
      const off = pos.clone().sub(q);
      const min = c.r + this.camera.near * 2 + 0.05;
      if (off.length() < min) {
        if (off.lengthSq() < 1e-8) off.set(0, 0, 1);
        pos.copy(q).addScaledVector(off.normalize(), min);
      }
    }
    if (pos.y < groundMin) pos.y = groundMin;
    return pos;
  }

  update(dt) {
    this.keyStep(dt);
    const a = 1 - Math.exp(-dt * 10);
    this.cur.yaw += (this.goal.yaw - this.cur.yaw) * a;
    this.cur.pitch += (this.goal.pitch - this.cur.pitch) * a;
    this.cur.dist += (this.goal.dist - this.cur.dist) * a;
    this.cur.target.lerp(this.goal.target, a);
    const { yaw, pitch, dist, target } = this.cur;
    const pos = new THREE.Vector3(
      target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.resolve(pos);
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }
}
