import * as THREE from 'three';
import { PLATE } from './world.js';

const HALF = PLATE.size / 2;

// Follow camera behind and above the pea. Mouse/touch steer yaw and pitch; it slides in
// toward the pea rather than dip under the plate.
export class FollowCam {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0.4;
    this.pitch = 0.3;
    this.dist = 2.7;
    this.limits = { minPitch: -0.35, maxPitch: 1.2, minDist: 1.6, maxDist: 5 };
    this.target = new THREE.Vector3(0, 0.62, 0);
    this.frozen = false;
    this.shoulder = 0; // sideways offset so the crosshair isn't hidden behind the pea
    this.shoulderGoal = 0;
    this.height = 0.62;
    this.shake = 0;
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, this.limits.minPitch, this.limits.maxPitch);
  }

  zoom(f) { this.dist = THREE.MathUtils.clamp(this.dist * f, this.limits.minDist, this.limits.maxDist); }

  // Keep a camera position out of the plate. Exposed for tests.
  resolve(pos, target) {
    const top = 0.15;
    const over = (p) => Math.abs(p.x) < HALF + 0.3 && Math.abs(p.z) < HALF + 0.3;
    if (over(pos) && pos.y < top) {
      if (target.y > top) {
        // slide along the view ray toward the pea until clear of the stone
        const t = (target.y - top) / (target.y - pos.y);
        pos.lerpVectors(target, pos, t);
      } else if (pos.y > -PLATE.thick - 0.3) {
        pos.y = top;
      }
    }
    return pos;
  }

  update(dt, focus, snap = false) {
    if (this.frozen) return;
    this.shoulder += (this.shoulderGoal - this.shoulder) * (snap ? 1 : 1 - Math.exp(-6 * dt));
    const goal = new THREE.Vector3(focus.x + Math.cos(this.yaw) * this.shoulder, Math.max(-2, focus.y) + this.height, focus.z - Math.sin(this.yaw) * this.shoulder);
    if (snap) this.target.copy(goal);
    else {
      const a = 1 - Math.exp(-18 * dt), b = 1 - Math.exp(-7 * dt);
      this.target.x += (goal.x - this.target.x) * a;
      this.target.z += (goal.z - this.target.z) * a;
      this.target.y += (goal.y - this.target.y) * b;
    }
    const { yaw, pitch, dist, target } = this;
    const pos = new THREE.Vector3(
      target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.resolve(pos, target);
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    if (this.shake > 0.001) {
      const s = this.shake * 0.04;
      this.camera.rotation.x += (Math.random() - 0.5) * s;
      this.camera.rotation.y += (Math.random() - 0.5) * s;
    }
  }
}
