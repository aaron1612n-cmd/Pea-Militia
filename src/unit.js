import * as THREE from 'three';
import { U, pose, makePose } from './rig.js';
import { WEAPONS } from './weapons.js';
import { wrap } from './physics.js';
import { Ragdoll } from './ragdoll.js';

export const RADIUS = U.RADIUS;
export const WALK = 2.2; // m/s
export const SPRINT = 1.65;
const GRAVITY = 17;
const lerp = THREE.MathUtils.lerp;
const JUMP_V = 4.8;
// The fastest any soldier can run on their own: walk pace times the sprint multiplier. One source
// of truth; weapon, stance and suppression modifiers only ever slow a soldier from here.
export const MAX_SPEED = WALK * SPRINT;
const CADENCE = 1.9; // steps per second per foot at walking pace

let nextId = 1;

// One soldier: movement, health, weapons and the animation state that ties them together.
// Driven each frame through `ctrl` by the player's input or an AI brain.
export class Unit {
  constructor({ team = 0, loadout = ['rifle'], pos, kind = 'rifleman' } = {}) {
    this.id = nextId++;
    this.team = team;
    this.kind = kind;
    this.pos = new THREE.Vector3();
    if (pos) this.pos.copy(pos);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.grounded = true;
    this.coyote = 0;
    this.buffer = 0;
    this.cycle = Math.random();
    this.walk = 0;
    this.air = 0;
    this.landT = 1;
    this.landK = 0;
    this.t = Math.random() * 10;
    this.jumps = 0;
    this.distance = 0;
    this.mx = 0; this.mz = 1;

    this.hp = 100;
    this.maxHp = 100;
    this.alive = true;
    this.deadT = 0;
    this.lastHurt = -99;
    this.burn = 0;
    this.suppression = 0;
    this.flinch = 0;
    this.kills = 0;
    this.god = false;
    this.shots = 0;

    this.weapons = loadout.map((id) => ({ id, def: WEAPONS[id], mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve ?? Infinity, heat: 0, locked: 0 }));
    this.wi = 0;
    this.cool = 0;
    this.reloadT = 0;
    this.throwT = 0;
    this.thrown = false;
    this.recoil = 0;
    this.lastShot = -99;
    this.wasFiring = false;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.twist = 0;
    this.kneelK = 0;
    this.ready = 0.6;
    this.ads = 0;
    this.ctrl = { wx: 0, wz: 0, jump: false, fire: false, aimAt: null, kneel: false, speed: 1, sprint: false, turnRate: Infinity };
    this.poseOut = makePose();
    this.poseState = {};
    this.world = new THREE.Matrix4();
    this.box = { x: 0, z: 0, yaw: 0, hx: U.W / 2, hz: U.D / 2, h: U.TOP, y0: 0 };
  }

  get weapon() { return this.weapons[this.wi]; }
  get busy() { return this.reloadT > 0 || this.throwT > 0; }

  // lean: sideways offset (world x/z) of a point at height y above the feet, and its drop
  leanOff(y) {
    const a = (this.leanK || 0) * 0.32, r = Math.max(0, y - (U.LIFT + 0.15));
    const side = -Math.sin(a) * r;
    return [Math.cos(this.facing) * side, -Math.sin(this.facing) * side, r * (1 - Math.cos(a))];
  }
  center(out = new THREE.Vector3()) {
    const p = this.proneK || 0;
    const y = U.BODY_Y - U.KNEEL_DROP * this.kneelK;
    const [lx, lz, ld] = this.leanOff(y);
    return out.set(this.pos.x + lx, this.pos.y + lerp(y - ld, 0.18, p), this.pos.z + lz);
  }
  eye(out = new THREE.Vector3()) {
    const p = this.proneK || 0;
    const y = U.EYE - U.KNEEL_DROP * this.kneelK;
    const [lx, lz, ld] = this.leanOff(y);
    const f = 0.42 * p;
    return out.set(this.pos.x + lx + Math.sin(this.facing) * f, this.pos.y + lerp(y - ld, 0.36, p), this.pos.z + lz + Math.cos(this.facing) * f);
  }
  muzzle(out = new THREE.Vector3()) {
    if (this.muzzleOverride) return out.copy(this.muzzleOverride); // first-person gun
    return out.copy(this.poseOut.muzzle).applyMatrix4(this.world);
  }
  // hit box: the body block, shorter when kneeling
  hitBox() {
    const b = this.box;
    b.x = this.pos.x; b.z = this.pos.z; b.yaw = this.facing;
    b.y0 = this.pos.y + U.LIFT * 0.3 - U.KNEEL_DROP * this.kneelK;
    b.h = U.TOP - U.LIFT * 0.3;
    b.hx = U.W / 2; b.hz = U.D / 2;
    const p = this.proneK || 0;
    if (p > 0.5) { b.y0 = this.pos.y; b.h = U.D + 0.04; b.hz = (U.TOP - U.LIFT) / 2; }
    else if (Math.abs(this.leanK || 0) > 0.05) { const [lx, lz] = this.leanOff(U.BODY_Y); b.x += lx * 0.7; b.z += lz * 0.7; }
    return b;
  }

  setWeapon(i, force = false) {
    if (i < 0 || i >= this.weapons.length || (i === this.wi && !force)) return;
    this.wi = i;
    this.reloadT = 0;
    this.throwT = 0;
    this.cool = force ? 0 : 0.35;
  }

  cycleWeapon(d) {
    const n = this.weapons.length;
    this.setWeapon((this.wi + d + n) % n);
  }

  startReload() {
    const w = this.weapon;
    if (this.busy || w.def.heat || w.mag >= w.def.mag || w.reserve <= 0) return false;
    this.reloadT = w.def.reload;
    return true;
  }

  hurt(dmg, from, world, kind = 'bullet') {
    if (!this.alive || this.god) return;
    this.hp -= dmg;
    this.lastHurt = this.t;
    this.flinch = Math.min(1, this.flinch + dmg / 40);
    if (this.onHurt) this.onHurt(dmg, from, kind);
    if (this.hp <= 0) this.die(from, world);
  }

  die(from, world) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.deadT = 0;
    if (from && from.pos && from !== this) {
      // fall away from whoever did it
      this.facing = Math.atan2(from.pos.x - this.pos.x, from.pos.z - this.pos.z);
      if (from.team !== undefined) from.kills++;
    }
    // ragdoll: thrown along the killing hit, harder for heavy hits and blasts
    const h = this.lastHit;
    const kick = new THREE.Vector3();
    if (h && h.dir && this.t - h.t < 0.05) {
      const k = h.kind === 'blast' ? 1.5 : THREE.MathUtils.clamp(1.6 + h.dmg / 25, 1.8, 5);
      kick.copy(h.dir).setY(0).normalize().multiplyScalar(k);
      kick.y = h.kind === 'blast' ? 1.5 : 0.6 + Math.random() * 0.6;
    } else {
      // burned or bled out: slump forward or back
      const a = this.facing + (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5);
      kick.set(Math.sin(a) * 1.3, 0.2, Math.cos(a) * 1.3);
    }
    this.vel.set(0, 0, 0);
    this.rag = new Ragdoll(this, kick);
    this.lastThud = 0;
    if (world) world.onDeath(this, from);
  }

  impulse(v) {
    if (this.rag && !this.alive) { this.rag.kick(v.clone().multiplyScalar(1.3)); return; }
    this.vel.add(v);
    this.knockT = 0.6;
    if (v.y > 0.5) this.grounded = false;
  }

  // ---- per-frame ----
  update(dt, world) {
    this.t += dt;
    if (!this.alive) return this.updateDead(dt, world);
    this.rag = null;
    const c = this.ctrl;
    this.cool -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.suppression = Math.max(0, this.suppression - dt * 0.35);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (this.t - this.lastHurt > 6 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 6 * dt);
    if (this.burn > 0) {
      this.burn -= dt;
      if (Math.random() < dt * 25) world.fx.burn(this.center());
      this.hurt(14 * dt, this.burnBy, world, 'fire');
      if (!this.alive) return;
    }
    for (const w of this.weapons) {
      if (w.def.heat) {
        w.heat = Math.max(0, w.heat - dt * (w.locked > 0 ? 0.55 : 0.35));
        w.locked = Math.max(0, w.locked - dt);
      }
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const w = this.weapon;
        const take = this.god ? w.def.mag - w.mag : Math.min(w.def.mag - w.mag, w.reserve);
        w.mag += take;
        if (!this.god) w.reserve -= take;
        this.reloadT = 0;
      }
    }
    if (this.throwT > 0) {
      const before = this.throwT;
      this.throwT -= dt;
      if (before > 0.32 && this.throwT <= 0.32 && !this.thrown) { this.thrown = true; world.releaseThrow(this); }
      if (this.throwT <= 0) {
        this.throwT = 0;
        if (this.weapon.mag <= 0) this.startReload();
      }
    }

    // aim: AI turns at a human pace, the player snaps to the crosshair
    const aiming = !!c.aimAt;
    if (aiming) {
      const sx = this.pos.x, sz = this.pos.z, sy = this.eye().y - 0.1;
      const yaw = Math.atan2(c.aimAt.x - sx, c.aimAt.z - sz);
      const pitch = Math.atan2(c.aimAt.y - sy, Math.hypot(c.aimAt.x - sx, c.aimAt.z - sz));
      const rate = c.turnRate ?? Infinity;
      const dy = wrap(yaw - this.aimYaw);
      this.aimYaw = wrap(this.aimYaw + Math.sign(dy) * Math.min(Math.abs(dy), rate * dt));
      this.aimPitch += THREE.MathUtils.clamp(pitch - this.aimPitch, -rate * dt, rate * dt);
      this.aimPitch = THREE.MathUtils.clamp(this.aimPitch, -1.2, 1.2);
    } else {
      this.aimYaw = this.facing + this.twist;
      this.aimPitch *= 1 - Math.min(1, dt * 6);
    }

    const def = this.weapon.def;
    // stamina: sprinting drains it; once spent you jog until it's a third back
    if (this.stamina === undefined) { this.stamina = 1; this.winded = false; }
    let sprint = c.sprint && !c.fire && !this.busy && Math.hypot(c.wx, c.wz) > 0.3 && !this.winded;
    if (sprint) { this.stamina -= dt / 7; this.restT = 0.9; if (this.stamina <= 0) { this.stamina = 0; this.winded = true; sprint = false; } }
    else { this.restT = Math.max(0, (this.restT || 0) - dt); if (this.restT <= 0) this.stamina = Math.min(1, this.stamina + dt / 5); }
    if (this.winded && this.stamina > 0.35) this.winded = false;
    const prone = c.prone && this.grounded ? 1 : 0;
    if (prone) sprint = false;
    this.proneK = (this.proneK || 0) + (prone - (this.proneK || 0)) * (1 - Math.exp(-5 * dt));
    const lean = !sprint && this.proneK < 0.3 ? THREE.MathUtils.clamp(c.lean || 0, -1, 1) : 0;
    this.leanK = (this.leanK || 0) + (lean - (this.leanK || 0)) * (1 - Math.exp(-10 * dt));
    const kneel = c.kneel && !sprint && !prone ? 1 : 0;
    this.kneelK += (kneel - this.kneelK) * (1 - Math.exp(-9 * dt));
    const speed = WALK * (c.speed ?? 1) * (def.move || 1) * (sprint ? SPRINT : 1) * (1 - 0.6 * this.kneelK) * (1 - 0.72 * this.proneK) * (1 - 0.5 * Math.abs(this.leanK)) * (1 - 0.25 * this.suppression);
    this.sprinting = sprint;
    this.move(dt, c.wx, c.wz, c.jump && this.proneK < 0.3, speed, world, aiming || c.faceYaw !== undefined);
    c.jump = false;

    const readyGoal = sprint ? 0.15 : aiming || c.fire ? 1 : 0.55;
    this.ready += (readyGoal - this.ready) * (1 - Math.exp(-10 * dt));
    if (c.fire && !sprint && this.ready > 0.7) this.fire(world);
    else if (!c.fire) this.wasFiring = false;
    if (c.reload) { this.startReload(); c.reload = false; }
    this.animate(dt);
  }

  move(dt, wx, wz, jump, speedMax, world, faceAim) {
    const wish = Math.hypot(wx, wz);
    const accel = this.grounded ? 11 : 3;
    const a = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speedMax - this.vel.x) * a;
    this.vel.z += (wz * speedMax - this.vel.z) * a;
    // hard cap on self-propelled speed (blasts and hits get a moment to throw a soldier further)
    this.knockT = Math.max(0, (this.knockT || 0) - dt);
    const hv = Math.hypot(this.vel.x, this.vel.z), cap = Math.min(MAX_SPEED, Math.max(speedMax, 0.01)) * 1.02;
    if (hv > cap && this.knockT <= 0) { this.vel.x *= cap / hv; this.vel.z *= cap / hv; }

    // facing: aiming units square up to the aim (strafing and backing off as needed);
    // otherwise they turn to where they walk
    let goal = null;
    const c = this.ctrl;
    if (c.faceYaw !== undefined) goal = c.faceYaw;
    else if (faceAim) goal = this.aimYaw;
    else if (wish > 0.25) goal = Math.atan2(wx, wz);
    if (goal !== null) {
      if (c.faceYaw !== undefined) this.facing = wrap(goal);
      else this.facing = wrap(this.facing + wrap(goal - this.facing) * (1 - Math.exp(-(faceAim ? 10 : 6) * dt)));
    }
    const tw = faceAim ? THREE.MathUtils.clamp(wrap(this.aimYaw - this.facing), -0.5, 0.5) : 0;
    this.twist += (tw - this.twist) * (1 - Math.exp(-14 * dt));

    if (jump) this.buffer = 0.15;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0) {
      this.vel.y = JUMP_V; this.grounded = false; this.coyote = 0; this.buffer = 0; this.jumps++;
    }

    if (!this.grounded) this.vel.y -= GRAVITY * dt;
    const prevY = this.pos.y;
    this.pos.addScaledVector(this.vel, dt);
    if (this.grounded) this.distance += Math.hypot(this.vel.x, this.vel.z) * dt;

    if (world) world.collideBody(this);

    const ground = world ? world.groundAt(this.pos.x, this.pos.z, this.pos.y) : 0;
    if (this.pos.y <= ground && prevY >= ground - 0.3) {
      if (!this.grounded) {
        this.landK = THREE.MathUtils.clamp(-this.vel.y / 7, 0.3, 1);
        this.landT = 0;
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y < ground) {
      this.pos.y = ground; this.vel.y = 0; this.grounded = true;
    } else if (this.grounded && this.pos.y - ground > 0.05) {
      // walking downhill: keep the feet on the slope instead of skipping into the air;
      // stepping off something tall still falls
      if (this.vel.y <= 0 && this.pos.y - ground < 0.32) this.pos.y = ground;
      else this.grounded = false;
    }
  }

  fire(world) {
    const w = this.weapon, def = w.def;
    if (this.busy || this.cool > 0) return false;
    if (!def.auto && this.wasFiring && this.semiLatch) return false;
    if (def.heat) { if (w.locked > 0) return false; }
    else if (w.mag <= 0) { this.startReload(); return false; }
    this.wasFiring = true;
    this.shots++;
    this.cool = def.interval;
    this.lastShot = this.t;
    if (def.kind === 'throw') {
      this.throwT = 0.6;
      this.thrown = false;
      if (!this.god) w.mag--;
      world.audio.play('throw', this.pos);
      return true;
    }
    world.discharge(this, def);
    if (def.heat) {
      w.heat += def.heat;
      if (w.heat >= 1) { w.heat = 1; w.locked = 1.6; world.fx.steam(this.muzzle(), new THREE.Vector3(0, 0.8, 0), 4, 0.35); }
    } else if (!this.god) w.mag--;
    this.recoil = def.kind === 'flame' ? 0.15 : 1;
    if (w.mag <= 0 && !def.heat && def.kind !== 'throw') this.startReload();
    return true;
  }

  updateDead(dt, world) {
    this.deadT += dt;
    if (this.burn > 0) { this.burn -= dt; if (Math.random() < dt * 15) world.fx.burn(this.center()); }
    if (this.rag) {
      this.rag.step(dt, world);
      const b = this.rag.body.pos;
      this.pos.x = b.x; this.pos.z = b.z;
      this.pos.y = world ? world.groundAt(b.x, b.z, b.y) : 0;
      const th = this.rag.takeThump();
      if (th > 2.2 && this.t - this.lastThud > 0.25 && world?.audio) {
        this.lastThud = this.t;
        world.audio.play('thud', b, Math.min(1, th / 6));
        if (th > 3.5) world.fx?.dust(b.clone().setY(this.pos.y + 0.05), 2, 0.5);
      }
      this.animate(dt);
      return;
    }
    if (!this.grounded || this.vel.lengthSq() > 0.01) {
      this.vel.y -= GRAVITY * dt;
      const drag = Math.exp(-(this.grounded ? 6 : 0.3) * dt);
      this.vel.x *= drag; this.vel.z *= drag;
      this.pos.addScaledVector(this.vel, dt);
      if (world) world.collideBody(this);
      const g = world ? world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.2) : 0;
      if (this.pos.y <= g) { this.pos.y = g; this.vel.y = 0; this.grounded = true; } else this.grounded = false;
    }
    this.animate(dt);
  }

  animate(dt) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const k = THREE.MathUtils.clamp(speed / WALK, 0, 1.6);
    this.walk += ((this.grounded && this.alive ? Math.min(1, k) : 0) - this.walk) * (1 - Math.exp(-10 * dt));
    if (speed > 0.05) {
      // move direction in the body's frame, for feet and lean
      const c = Math.cos(this.facing), s = Math.sin(this.facing);
      const lx = (this.vel.x * c - this.vel.z * s) / speed, lz = (this.vel.x * s + this.vel.z * c) / speed;
      this.mx += (lx - this.mx) * (1 - Math.exp(-12 * dt));
      this.mz += (lz - this.mz) * (1 - Math.exp(-12 * dt));
    }
    if (this.grounded) {
      const cadence = CADENCE * (0.7 + 0.3 * Math.min(k, 1.6));
      this.cycle = (this.cycle + cadence * dt) % 1;
      this.stride = THREE.MathUtils.clamp(speed / cadence * 0.6, 0.02, 0.7);
    }
    this.air += ((this.grounded ? 0 : 1) - this.air) * (1 - Math.exp(-(this.grounded ? 22 : 14) * dt));
    this.landT += dt;
    const lt = this.landT;
    const land = this.landK * (lt < 0.05 ? lt / 0.05 : 1 - THREE.MathUtils.smoothstep(lt, 0.05, 0.34));
    const s = this.poseState;
    s.t = this.t; s.walk = this.walk; s.cycle = this.cycle; s.stride = this.stride ?? 0.3;
    s.mx = this.mx; s.mz = this.mz; s.air = this.air; s.rise = THREE.MathUtils.clamp(this.vel.y / JUMP_V, -1, 1);
    s.land = land; s.kneel = this.kneelK; s.aimPitch = THREE.MathUtils.clamp(this.aimPitch, -0.9, 0.9);
    s.twist = this.twist; s.ready = this.ready; s.recoil = this.recoil;
    s.reload = this.reloadT > 0 ? 1 - this.reloadT / this.weapon.def.reload : -1;
    s.throw = this.throwT > 0 ? 1 - this.throwT / 0.6 : -1;
    s.flinch = this.flinch; s.ads = this.ads; s.fp = this.fp || 0; s.sprint = this.sprinting;
    s.lean = this.alive ? this.leanK || 0 : 0; s.prone = this.alive ? this.proneK || 0 : 0;
    s.dead = this.alive ? -1 : Math.min(1, this.deadT / 0.7);
    s.weapon = this.weapon.id;
    if (this.rag && !this.alive) {
      // the ragdoll writes world-space parts; sink into the ground before removal
      this.world.identity();
      this.rag.write(this.poseOut, this.deadT > 10 ? (this.deadT - 10) * 0.2 : 0);
      return;
    }
    pose(s, this.poseOut);
    this.poseOut.showWeapon = this.alive && !(this.weapon.def.kind === 'throw' && this.thrown && this.throwT > 0);
    this.world.makeRotationY(this.facing).setPosition(this.pos.x, this.pos.y - (this.deadT > 10 ? (this.deadT - 10) * 0.2 : 0), this.pos.z);
  }
}
