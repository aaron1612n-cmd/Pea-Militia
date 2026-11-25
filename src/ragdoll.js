import * as THREE from 'three';
import { U, HOLD, attachToBody } from './rig.js';

// Cheap ragdolls for hundreds of soldiers. The body block (and the dropped gun) are rigid
// boxes that tumble and land on their corners; hands and feet are loose points on short
// tethers, so they flop and trail behind. Everything sleeps once it settles.
const GRAV = 17;
const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _p = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

class Box {
  // half: half extents; pts: local contact points (corners)
  constructor(half, mass, pts) {
    this.pos = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.w = new THREE.Vector3();
    this.m = mass;
    const [x, y, z] = [half.x * 2, half.y * 2, half.z * 2];
    this.invI = new THREE.Vector3(12 / (mass * (y * y + z * z)), 12 / (mass * (x * x + z * z)), 12 / (mass * (x * x + y * y)));
    this.pts = pts;
    this.rest = 0;
    this.asleep = false;
    this.hits = 0; // ground contacts this step
    this.legs = 0; // 1 while the legs hold the body up, falling to 0 as they give way
    this.fall = 0; this.tip = new THREE.Vector3();
    this.thump = 0; // hardest landing speed since last read
  }

  // world inverse inertia applied to a world vector
  applyInvI(vec, out) {
    _qi.copy(this.q).invert();
    out.copy(vec).applyQuaternion(_qi).multiply(this.invI).applyQuaternion(this.q);
    return out;
  }

  impulseAt(r, j) {
    this.v.addScaledVector(j, 1 / this.m);
    this.w.add(this.applyInvI(_t.crossVectors(r, j), _t));
  }

  step(dt, world) {
    if (this.asleep) return;
    this.v.y -= GRAV * dt;
    // the legs still carry the body for a moment after the hit, then buckle: a falling soldier
    // sags, folds and topples over, instead of dropping like a plank
    if (this.legs > 0) {
      this.legs = Math.max(0, this.legs - dt / 0.6);
      const k = this.legs * this.legs;
      this.v.y += GRAV * dt * k * 0.92;
      this.v.x *= Math.exp(-1.2 * k * dt); this.v.z *= Math.exp(-1.2 * k * dt);
      // gravity pulls the unsupported top of the body over, along the way it was pushed
      const f = (1 - this.legs) * this.fall * dt;
      this.w.x += this.tip.x * f; this.w.z += this.tip.z * f;
    }
    this.pos.addScaledVector(this.v, dt);
    const wl = this.w.length();
    if (wl > 1e-6) {
      _q.setFromAxisAngle(_v.copy(this.w).divideScalar(wl), wl * dt);
      this.q.premultiply(_q).normalize();
    }
    // corners against the ground and prop tops
    let deepest = 0;
    this.hits = 0;
    const gs = this.gs || (this.gs = new Float32Array(this.pts.length));
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < this.pts.length; i++) {
        _r.copy(this.pts[i]).applyQuaternion(this.q);
        _p.copy(this.pos).add(_r);
        if (it === 0) gs[i] = world ? world.groundAt(_p.x, _p.z, _p.y + 0.25) : 0;
        const g = gs[i];
        const pen = g - _p.y;
        if (pen <= 0) continue;
        if (it === 0) { this.hits++; deepest = Math.max(deepest, pen); }
        // velocity of the corner
        const vp = _v.crossVectors(this.w, _r).add(this.v);
        const vn = vp.y;
        if (vn >= 0) continue;
        if (it === 0) this.thump = Math.max(this.thump, -vn);
        _n.set(0, 1, 0);
        const rn = _t.crossVectors(_r, _n);
        const k = 1 / this.m + this.applyInvI(rn, rn).cross(_r).dot(_n);
        const e = 0; // a dead weight doesn't bounce
        const jn = (-(1 + e) * vn) / k;
        // friction against the sliding part, capped by the normal impulse
        const tx = vp.x, tz = vp.z, ts = Math.hypot(tx, tz);
        const jf = ts > 1e-4 ? Math.min(ts * this.m * 0.9, jn * 1.1) / ts : 0;
        this.impulseAt(_r, _p.set(-tx * jf, jn, -tz * jf));
      }
    }
    if (deepest > 0) this.pos.y += deepest * 0.85;
    // rolling resistance and air drag so bodies settle instead of rocking
    const damp = this.hits ? Math.exp(-6.5 * dt) : Math.exp(-0.15 * dt);
    this.w.multiplyScalar(damp);
    if (this.hits >= 2) {
      this.v.x *= Math.exp(-2.6 * dt); this.v.z *= Math.exp(-2.6 * dt);
      // dry friction takes over at a crawl, so a body stops dead instead of creeping (or sliding down a slope)
      const hs = Math.hypot(this.v.x, this.v.z);
      if (hs < 0.9) { const k = Math.max(0, hs - 9 * dt) / (hs || 1); this.v.x *= k; this.v.z *= k; }
    }
    // edge of the slab and prop sides: push the box centre out horizontally
    if (world) {
      const probe = this.probe || (this.probe = { pos: new THREE.Vector3(), vel: this.v });
      probe.pos.copy(this.pos);
      probe.pos.y -= 0.2;
      world.collideBody(probe);
      this.pos.x = probe.pos.x; this.pos.z = probe.pos.z;
    }
    this.age = (this.age || 0) + dt;
    // settled: resting on 2+ corners and barely moving (looser the longer it has been going)
    const lax = this.age > 2.5 ? 4 : 1;
    if (this.hits >= 2 && this.v.lengthSq() < 0.16 * lax && this.w.lengthSq() < 0.7 * lax) {
      this.rest += dt;
      if (this.rest > 0.2) { this.asleep = true; this.v.set(0, 0, 0); this.w.set(0, 0, 0); }
    } else this.rest = 0;
  }

  matrix(out) { return out.compose(this.pos, this.q, ONE); }
}

// body contact points: the block's corners pulled in by the rounding, plus the pack's back edge
const B = { x: U.W / 2 - 0.03, y: U.H / 2 - 0.03, z: U.D / 2 - 0.03 };
const BODY_PTS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) BODY_PTS.push(new THREE.Vector3(sx * B.x, sy * B.y, sz * B.z));
for (const sx of [-1, 1]) for (const sy of [-1, 1]) BODY_PTS.push(new THREE.Vector3(sx * (U.PACK[0] / 2 - 0.02), U.PACK_Y - U.BODY_Y + sy * (U.PACK[1] / 2 - 0.02), -U.D / 2 - U.PACK[2] + 0.03));

// the head and helmet lift the body's contact points so it never sinks into the ground
for (const [x, y, z] of [[0, 0.4, 0.0], [-0.08, 0.3, 0.04], [0.08, 0.3, 0.04], [0, 0.3, -0.07]]) BODY_PTS.push(new THREE.Vector3(x, y, z));

// where the limbs hang from, in the body's frame
const ANCHOR = [
  { at: new THREE.Vector3(0.2, -0.16, 0.05), len: 0.12, r: 0.03 }, // left hand (+x)
  { at: new THREE.Vector3(-0.2, -0.16, 0.05), len: 0.12, r: 0.03 },
  { at: new THREE.Vector3(-U.FOOT_X, -U.H / 2 - 0.34, 0.03), len: 0.12, r: 0.03 }, // right foot
  { at: new THREE.Vector3(U.FOOT_X, -U.H / 2 - 0.34, 0.03), len: 0.12, r: 0.03 },
];
const HX = U.W / 2, HY = U.H / 2, HZ = U.D / 2;

export class Ragdoll {
  // unit: the dying soldier (its current pose is the starting pose); kick: world impulse (m/s)
  constructor(unit, kick) {
    const m = new THREE.Matrix4().multiplyMatrices(unit.world, unit.poseOut.body);
    this.body = new Box(new THREE.Vector3(U.W / 2, U.H / 2, U.D / 2 + 0.06), 1, BODY_PTS);
    m.decompose(this.body.pos, this.body.q, _v);
    this.body.v.copy(unit.vel).add(kick);
    // the hit lands high on the body, so it topples away from the shot, slowly: weight, not a spin
    const hitAt = new THREE.Vector3(0, 0.3 + Math.random() * 0.15, 0).applyQuaternion(this.body.q);
    const horiz = _v.copy(kick).setY(0).addScaledVector(unit.vel, 0.5).setY(0);
    const run = Math.hypot(unit.vel.x, unit.vel.z);
    const blast = unit.heavy;
    this.body.w.crossVectors(hitAt, horiz).multiplyScalar(blast ? 4 : 1.1 + Math.min(run, 9) * 0.12);
    this.body.w.y += (Math.random() - 0.5) * Math.min(blast ? 3 : 0.8, kick.length());
    // standing soldiers buckle at the knees; one thrown by a blast or already airborne has nothing to stand on
    if (unit.grounded && !blast) {
      this.body.legs = 1;
      const hl = horiz.length() || 1;
      // fall along the push; a slump with no push falls forward or back at random
      this.body.tip.set(horiz.z / hl, 0, -horiz.x / hl);
      this.body.fall = 5.5 + Math.random() * 2;
    }
    // limbs start where the pose had them
    this.limbs = [];
    const hm = new THREE.Matrix4();
    const parts = [unit.poseOut.hands[0], unit.poseOut.hands[1], unit.poseOut.feet[0], unit.poseOut.feet[1]];
    for (let i = 0; i < 4; i++) {
      hm.multiplyMatrices(unit.world, parts[i]);
      const p = new THREE.Vector3().setFromMatrixPosition(hm);
      const a = ANCHOR[i];
      this.limbs.push({ p, o: p.clone().addScaledVector(this.body.v, -1 / 60), a, foot: i >= 2 });
    }
    // the gun drops out of the hands and tumbles on its own
    const h = HOLD[unit.weapon.id];
    this.gun = null;
    if (h && unit.poseOut.showWeapon) {
      const gh = h.half.clone().max(_v.set(0.03, 0.03, 0.03));
      const pts = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(new THREE.Vector3(sx * gh.x, sy * gh.y, sz * gh.z));
      this.gun = new Box(gh, 0.5, pts);
      this.gunMid = h.mid.clone();
      hm.multiplyMatrices(unit.world, unit.poseOut.weapon);
      hm.decompose(_p, this.gun.q, _v);
      this.gun.pos.copy(this.gunMid).applyQuaternion(this.gun.q).add(_p);
      this.gun.v.copy(this.body.v).multiplyScalar(0.7).add(_v.set(Math.random() - 0.5, 1 + Math.random(), Math.random() - 0.5));
      this.gun.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(9);
    }
    this.t = 0;
    this.asleep = false;
  }

  // extra push after death (blasts that land on a body)
  kick(v) {
    this.body.asleep = false; this.body.rest = 0;
    this.body.v.add(v);
    this.body.w.add(_v.set(-v.z, 0, v.x).multiplyScalar(0.9)).add(_t.set(0, (Math.random() - 0.5) * 4, 0));
    if (this.gun) { this.gun.asleep = false; this.gun.v.addScaledVector(v, 1.2); }
    this.asleep = false;
  }

  step(dt, world) {
    this.floor = world ? (x, z, y) => world.groundAt(x, z, y + 0.3) : null;
    if (this.asleep) return;
    this.t += dt;
    const n = dt > 1 / 50 ? 2 : 1;
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      this.body.step(h, world);
      this.gun?.step(h, world);
      this.stepLimbs(h, world);
    }
    if (this.body.asleep && (!this.gun || this.gun.asleep) && this.t > 1.2) this.asleep = true;
  }

  stepLimbs(dt, world) {
    const b = this.body;
    _qi.copy(b.q).invert();
    for (const l of this.limbs) {
      // verlet with damping
      _v.subVectors(l.p, l.o).multiplyScalar(0.955); // limp limbs: heavy, they swing little and settle fast
      l.o.copy(l.p);
      l.p.add(_v);
      l.p.y -= GRAV * dt * dt * 1.25;
      // tether to the anchor on the body
      _r.copy(l.a.at).applyQuaternion(b.q).add(b.pos);
      _t.subVectors(l.p, _r);
      const d = _t.length();
      if (d > l.a.len) l.p.copy(_r).addScaledVector(_t, l.a.len / d);
      // keep out of the body block
      _t.subVectors(l.p, b.pos).applyQuaternion(_qi);
      const r = l.a.r;
      const ox = HX + r - Math.abs(_t.x), oy = HY + r - Math.abs(_t.y), oz = HZ + r - Math.abs(_t.z);
      if (ox > 0 && oy > 0 && oz > 0) {
        if (ox < oy && ox < oz) _t.x += Math.sign(_t.x || 1) * ox;
        else if (oy < oz) _t.y += Math.sign(_t.y || 1) * oy;
        else _t.z += Math.sign(_t.z || 1) * oz;
        l.p.copy(_t.applyQuaternion(b.q).add(b.pos));
      }
      // ground, with friction
      let g = (world ? world.groundAt(l.p.x, l.p.z, l.p.y + 0.2) : 0) + r;
      if (l.foot && world) {
        // boots are 0.2 m long and lie along the body's z axis: toe and heel must clear the ground too
        for (const dz of [-0.1, 0.1]) {
          _t.set(0, 0, dz).applyQuaternion(b.q).add(l.p);
          g = Math.max(g, world.groundAt(_t.x, _t.z, _t.y + 0.2) + r + 0.02 - _t.y + l.p.y);
        }
      }
      if (l.p.y < g) {
        l.p.y = g;
        l.o.x += (l.p.x - l.o.x) * 0.4;
        l.o.z += (l.p.z - l.o.z) * 0.4;
        if (l.o.y < g) l.o.y = g;
      }
    }
  }

  // write world-space part matrices into a pose (unit.world is set to identity by the caller)
  write(out, sink = 0) {
    this.body.matrix(out.body);
    out.body.elements[13] -= sink;
    attachToBody(out);
    const parts = [out.hands[0], out.hands[1], out.feet[0], out.feet[1]];
    for (let i = 0; i < 4; i++) {
      _p.copy(this.limbs[i].p);
      _p.y -= sink;
      parts[i].compose(_p, this.body.q, ONE);
    }
    out.showWeapon = !!this.gun;
    out.floor = this.floor;
    if (this.gun) {
      _p.copy(this.gunMid).applyQuaternion(this.gun.q).negate().add(this.gun.pos);
      _p.y -= sink;
      out.weapon.compose(_p, this.gun.q, ONE);
    }
    return out;
  }

  // landing speed since last asked (for thuds)
  takeThump() {
    const k = Math.max(this.body.thump, this.gun ? this.gun.thump * 0.6 : 0);
    this.body.thump = 0;
    if (this.gun) this.gun.thump = 0;
    return k;
  }
}
