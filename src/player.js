import * as THREE from 'three';
import { PLATE } from './world.js';
import { PEA_SCALE, GAIT } from './pea.js';

const HALF = PLATE.size / 2;
const RADIUS = 0.36; // body radius in world units, for the plate's side walls
const WALK = 1.05; // m/s
const GRAVITY = 17;
const JUMP_V = 4.3;
const RESPAWN_Y = -12;
const SPAWN_Y = 2.2;

// Third-person pea: camera-relative movement, turn to face travel, jump, fall off the edge.
export class Player {
  constructor(pea, { drop = true } = {}) {
    this.pea = pea;
    this.pos = new THREE.Vector3(0, drop ? SPAWN_Y : 0, 0);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.grounded = !drop;
    this.coyote = 0;
    this.buffer = 0;
    this.crouch = 0; // jump anticipation timer
    this.cycle = 0;
    this.walk = 0;
    this.air = drop ? 1 : 0;
    this.landT = 1;
    this.landK = 0;
    this.t = 0;
    this.respawns = 0;
    this.jumps = 0;
    this.distance = 0;
  }

  get onPlate() { return Math.abs(this.pos.x) <= HALF && Math.abs(this.pos.z) <= HALF; }

  update(dt, input, camYaw) {
    this.t += dt;
    // camera-relative wish direction
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    const wx = rx * input.move.x + fx * input.move.y;
    const wz = rz * input.move.x + fz * input.move.y;
    const wish = Math.hypot(wx, wz);

    // horizontal velocity eases toward the wish; less control in the air
    const accel = this.grounded ? 12 : 4;
    const a = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * WALK - this.vel.x) * a;
    this.vel.z += (wz * WALK - this.vel.z) * a;

    // face the direction of travel
    if (wish > 0.05) {
      const goal = Math.atan2(wx, wz);
      let d = goal - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * (1 - Math.exp(-12 * dt));
    }

    // jump: short buffer and coyote time, then a quick crouch before lift-off
    if (input.jump) this.buffer = 0.15;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0 && this.crouch === 0) {
      this.crouch = 0.07;
      this.buffer = 0;
    }
    if (this.crouch > 0) {
      this.crouch -= dt;
      if (this.crouch <= 0) {
        this.crouch = 0;
        this.vel.y = JUMP_V;
        this.grounded = false;
        this.coyote = 0;
        this.jumps++;
      }
    }

    // integrate
    if (!this.grounded) this.vel.y -= GRAVITY * dt;
    const prevY = this.pos.y;
    this.pos.addScaledVector(this.vel, dt);
    this.distance += Math.hypot(this.vel.x, this.vel.z) * dt;

    // plate top
    if (this.onPlate && this.pos.y <= 0 && prevY >= -0.05) {
      if (!this.grounded) {
        this.landK = THREE.MathUtils.clamp(-this.vel.y / 7, 0.35, 1);
        this.landT = 0;
      }
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.grounded && !this.onPlate) {
      this.grounded = false; // walked off the edge
    }
    // plate side walls: once below the top, the body can't pass back through the stone
    if (!this.grounded && this.pos.y < -0.02 && this.pos.y > -PLATE.thick - 1.2) {
      const ex = Math.abs(this.pos.x) - HALF, ez = Math.abs(this.pos.z) - HALF;
      if (ex < RADIUS && ez < RADIUS) {
        if (ex > ez) this.pos.x = Math.sign(this.pos.x) * (HALF + RADIUS);
        else this.pos.z = Math.sign(this.pos.z) * (HALF + RADIUS);
      }
    }
    if (this.pos.y < RESPAWN_Y) this.respawn();

    this.animate(dt);
  }

  respawn() {
    this.pos.set(0, SPAWN_Y, 0);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.air = 1;
    this.respawns++;
  }

  animate(dt) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const k = THREE.MathUtils.clamp(speed / WALK, 0, 1);
    this.walk += ((this.grounded ? k : this.walk) - this.walk) * (1 - Math.exp(-10 * dt));
    if (this.grounded) {
      // stride shrinks with speed so the planted foot never slides; cadence eases up a bit too
      const cadence = GAIT.cadence * (0.75 + 0.25 * k);
      this.cycle = (this.cycle + cadence * dt) % 1;
      this.stride = Math.max(0.001, (speed / PEA_SCALE) * GAIT.stance / (2 * cadence));
    }
    this.air += ((this.grounded ? 0 : 1) - this.air) * (1 - Math.exp(-(this.grounded ? 22 : 14) * dt));
    this.landT += dt;
    const lt = this.landT;
    const land = this.landK * (lt < 0.05 ? lt / 0.05 : 1 - THREE.MathUtils.smoothstep(lt, 0.05, 0.34));
    this.pea.position.copy(this.pos);
    this.pea.rotation.y = this.facing;
    this.pea.userData.pose({
      t: this.t,
      walk: this.walk,
      cycle: this.cycle,
      stride: this.stride ?? 0.13,
      air: this.air,
      rise: THREE.MathUtils.clamp(this.vel.y / JUMP_V, -1, 1),
      land,
      crouch: this.crouch > 0 ? 1 : 0,
    });
  }
}

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
    const goal = new THREE.Vector3(focus.x, Math.max(-2, focus.y) + 0.62, focus.z);
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
  }
}
