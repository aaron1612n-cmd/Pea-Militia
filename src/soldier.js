import * as THREE from 'three';
import { createPea, PEA_SCALE, GAIT, BODY_Y, BODY_R } from './pea.js';
import { PLATE } from './world.js';
import { WEAPONS, weaponModel } from './weapons.js';
import { TEAMS } from './factions.js';
import { pushCircle, wrap } from './physics.js';

const HALF = PLATE.size / 2;
export const RADIUS = 0.36; // body radius on the ground plane
export const HIT_R = 0.4;
export const WALK = 1.05; // m/s
const GRAVITY = 17;
const JUMP_V = 4.3;
const RESPAWN_Y = -12;
const SPAWN_Y = 2.2;
const KNEEL_DROP = 0.2 * PEA_SCALE;

let holdMatrix = null; // weapon placement relative to the right hand, shared by every pea

// A pea soldier: walking, jumping, falling, health, weapons and the animation that ties them
// together. Driven each frame through `ctrl` by either the player's input or an AI brain.
export class Soldier {
  constructor({ team = 0, lod = 1, loadout = ['rifle'], drop = true, pos } = {}) {
    this.team = team;
    this.pea = createPea({ palette: TEAMS[team].pea, team, lod });
    this.pea.rotation.order = 'YXZ';
    this.pea.userData.unit = this;
    this.pos = new THREE.Vector3(0, drop ? SPAWN_Y : 0, 0);
    if (pos) this.pos.add(pos);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.grounded = !drop;
    this.coyote = 0;
    this.buffer = 0;
    this.crouch = 0;
    this.cycle = 0;
    this.walk = 0;
    this.air = drop ? 1 : 0;
    this.landT = 1;
    this.landK = 0;
    this.t = Math.random() * 10;
    this.respawns = 0;
    this.jumps = 0;
    this.distance = 0;
    this.back = 1;

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

    this.weapons = loadout.map((id) => ({ id, def: WEAPONS[id], mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve ?? Infinity, heat: 0, locked: 0 }));
    this.wi = 0;
    this.model = null;
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
    this.holdK = 1;
    this.vehicle = null;
    this.ctrl = { wx: 0, wz: 0, jump: false, fire: false, aimAt: null, kneel: false, speed: 1, aiming: false };
    this.setWeapon(0, true);
  }

  get weapon() { return this.weapons[this.wi]; }
  get onPlate() { return Math.abs(this.pos.x) <= HALF && Math.abs(this.pos.z) <= HALF; }
  get busy() { return this.reloadT > 0 || this.throwT > 0; }

  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + BODY_Y * PEA_SCALE - KNEEL_DROP * this.kneelK, this.pos.z);
  }
  eye(out = new THREE.Vector3()) {
    return this.center(out).add(new THREE.Vector3(0, 0.12, 0));
  }
  muzzle(out = new THREE.Vector3()) {
    if (this.model && this.model.visible) {
      this.pea.updateMatrixWorld(true);
      return this.model.userData.muzzle.getWorldPosition(out);
    }
    return this.center(out);
  }

  setWeapon(i, force = false) {
    if (i < 0 || i >= this.weapons.length || (i === this.wi && !force)) return;
    this.wi = i;
    this.reloadT = 0;
    this.throwT = 0;
    this.cool = force ? 0 : 0.35;
    const hand = this.pea.userData.rig.hands[1];
    if (this.model) hand.remove(this.model);
    this.model = weaponModel(this.weapon.id);
    if (!holdMatrix) holdMatrix = computeHold(this.pea);
    this.model.matrixAutoUpdate = false;
    this.model.matrix.copy(holdMatrix);
    hand.add(this.model);
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
    if (!this.alive) return;
    if (this.god) return;
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
    this.fallYaw = this.facing;
    if (from && from.pos) {
      // fall away from whoever did it
      this.fallYaw = Math.atan2(from.pos.x - this.pos.x, from.pos.z - this.pos.z);
      if (from !== this && from.team !== undefined) from.kills++;
    }
    if (this.model) this.model.visible = false;
    if (world) world.onDeath(this, from);
  }

  impulse(v) {
    this.vel.add(v);
    if (v.y > 0.5) this.grounded = false;
  }

  // ---- per-frame ----
  update(dt, world) {
    this.t += dt;
    if (!this.alive) return this.updateDead(dt, world);
    if (this.vehicle) return;
    const c = this.ctrl;
    this.cool -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.suppression = Math.max(0, this.suppression - dt * 0.3);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (this.t - this.lastHurt > 5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 7 * dt);
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
      if (before > 0.3 && this.throwT <= 0.3 && !this.thrown) { this.thrown = true; world.releaseThrow(this); }
      if (this.throwT <= 0) {
        this.throwT = 0;
        if (this.weapon.mag <= 0) this.startReload();
      }
    }

    // aim: shoulder toward the aim point; AI turns at a human pace, the player snaps
    const aiming = !!c.aimAt;
    if (aiming) {
      const sx = this.pos.x, sz = this.pos.z, sy = this.center().y + 0.05;
      const yaw = Math.atan2(c.aimAt.x - sx, c.aimAt.z - sz);
      const pitch = Math.atan2(c.aimAt.y - sy, Math.hypot(c.aimAt.x - sx, c.aimAt.z - sz));
      const rate = c.turnRate ?? Infinity;
      const dy = wrap(yaw - this.aimYaw);
      this.aimYaw = wrap(this.aimYaw + Math.sign(dy) * Math.min(Math.abs(dy), rate * dt));
      this.aimPitch += THREE.MathUtils.clamp(pitch - this.aimPitch, -rate * dt, rate * dt);
    } else {
      this.aimYaw = this.facing + this.twist;
      this.aimPitch *= 1 - Math.min(1, dt * 6);
    }

    const def = this.weapon.def;
    const kneel = c.kneel && !c.fire ? 1 : 0;
    this.kneelK += (kneel - this.kneelK) * (1 - Math.exp(-8 * dt));
    const speed = WALK * (c.speed ?? 1) * (def.speed || 1) * (1 - 0.6 * this.kneelK) * (this.vehicle ? 0 : 1);
    this.move(dt, c.wx, c.wz, c.jump, speed, world, aiming && c.aiming !== false);
    c.jump = false;

    if (c.fire) this.fire(world);
    else this.wasFiring = false;
    if (c.reload) { this.startReload(); c.reload = false; }
    this.animate(dt);
  }

  move(dt, wx, wz, jump, speedMax, world, faceAim) {
    const wish = Math.hypot(wx, wz);
    const accel = this.grounded ? 12 : 4;
    const a = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speedMax - this.vel.x) * a;
    this.vel.z += (wz * speedMax - this.vel.z) * a;

    // facing: legs follow the walk direction; when aiming the body turns toward the aim, and
    // a pea backing away walks backwards rather than turning its back
    let goal = null;
    const mv = Math.atan2(wx, wz);
    if (faceAim) {
      if (wish > 0.05) {
        const back = Math.abs(wrap(this.aimYaw - mv)) > 1.9;
        goal = back ? mv + Math.PI : mv;
        const off = wrap(this.aimYaw - goal);
        if (Math.abs(off) > 1.0) goal = this.aimYaw - Math.sign(off) * 1.0;
      } else goal = this.aimYaw;
    } else if (wish > 0.05) goal = mv;
    if (goal !== null) {
      const d = wrap(goal - this.facing);
      this.facing = wrap(this.facing + d * (1 - Math.exp(-12 * dt)));
    }
    const tw = faceAim ? THREE.MathUtils.clamp(wrap(this.aimYaw - this.facing), -1.1, 1.1) : 0;
    this.twist += (tw - this.twist) * (1 - Math.exp(-14 * dt));
    this.back = wish > 0.05 && Math.abs(wrap(mv - this.facing)) > Math.PI / 2 ? -1 : 1;

    if (jump) this.buffer = 0.15;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0 && this.crouch === 0) { this.crouch = 0.07; this.buffer = 0; }
    if (this.crouch > 0) {
      this.crouch -= dt;
      if (this.crouch <= 0) { this.crouch = 0; this.vel.y = JUMP_V; this.grounded = false; this.coyote = 0; this.jumps++; }
    }

    if (!this.grounded) this.vel.y -= GRAVITY * dt;
    const prevY = this.pos.y;
    this.pos.addScaledVector(this.vel, dt);
    if (this.grounded) this.distance += Math.hypot(this.vel.x, this.vel.z) * dt;

    // obstacles: props and vehicles push the body out unless it is above them
    if (world) world.collideBody(this);

    const ground = world ? world.groundAt(this.pos.x, this.pos.z, this.pos.y) : (this.onPlate ? 0 : -Infinity);
    if (this.pos.y <= ground && prevY >= ground - 0.08) {
      if (!this.grounded) {
        this.landK = THREE.MathUtils.clamp(-this.vel.y / 7, 0.35, 1);
        this.landT = 0;
        this.onLand?.(-this.vel.y);
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.grounded && this.pos.y - ground > 0.05) {
      this.grounded = false;
    }
    if (!this.grounded && this.pos.y < -0.02 && this.pos.y > -PLATE.thick - 1.2) {
      const ex = Math.abs(this.pos.x) - HALF, ez = Math.abs(this.pos.z) - HALF;
      if (ex < RADIUS && ez < RADIUS) {
        if (ex > ez) this.pos.x = Math.sign(this.pos.x) * (HALF + RADIUS);
        else this.pos.z = Math.sign(this.pos.z) * (HALF + RADIUS);
      }
    }
    if (this.pos.y < RESPAWN_Y) this.fellOff(world);
  }

  fellOff(world) {
    this.die(null, world);
  }

  fire(world) {
    const w = this.weapon, def = w.def;
    if (this.busy || this.cool > 0) return false;
    if (!def.auto && this.wasFiring && this.semiLatch) return false;
    if (def.heat) { if (w.locked > 0) return false; }
    else if (w.mag <= 0) { this.startReload(); return false; }
    this.wasFiring = true;
    this.shots = (this.shots || 0) + 1;
    this.cool = def.interval;
    this.lastShot = this.t;
    if (def.kind === 'throw') {
      this.throwT = 0.55;
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
    // keep falling if airborne (blown off the plate, or knocked into the air)
    if (!this.grounded || this.vel.lengthSq() > 0.01) {
      this.vel.y -= GRAVITY * dt;
      this.vel.x *= Math.exp(-(this.grounded ? 6 : 0.3) * dt);
      this.vel.z *= Math.exp(-(this.grounded ? 6 : 0.3) * dt);
      this.pos.addScaledVector(this.vel, dt);
      const g = world.groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y <= g && g > -Infinity) { this.pos.y = g; this.vel.y = 0; this.grounded = true; } else this.grounded = false;
    }
    const tilt = Math.min(1.42, this.deadT * this.deadT * 7);
    const lift = PEA_SCALE * Math.max(0, BODY_R * 1.1 - BODY_Y * Math.cos(tilt));
    const sink = this.deadT > 14 ? (this.deadT - 14) * 0.25 : 0;
    this.pea.position.set(this.pos.x, this.pos.y + lift - sink, this.pos.z);
    this.pea.rotation.set(-tilt, this.fallYaw, 0);
    this.pea.userData.pose({ t: this.t, air: 0.35, rise: -0.5, land: 0 }, false);
  }

  animate(dt) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const k = THREE.MathUtils.clamp(speed / WALK, 0, 1);
    this.walk += ((this.grounded ? k : this.walk) - this.walk) * (1 - Math.exp(-10 * dt));
    if (this.grounded) {
      const cadence = GAIT.cadence * (0.75 + 0.25 * k);
      this.cycle = (this.cycle + cadence * dt) % 1;
      this.stride = Math.max(0.001, (speed / PEA_SCALE) * GAIT.stance / (2 * cadence)) * this.back;
    }
    this.air += ((this.grounded ? 0 : 1) - this.air) * (1 - Math.exp(-(this.grounded ? 22 : 14) * dt));
    this.landT += dt;
    const lt = this.landT;
    const land = this.landK * (lt < 0.05 ? lt / 0.05 : 1 - THREE.MathUtils.smoothstep(lt, 0.05, 0.34));
    const holdGoal = this.weapon.def.kind === 'throw' && this.throwT <= 0 ? 0.5 : 1;
    this.holdK += (holdGoal - this.holdK) * (1 - Math.exp(-8 * dt));
    if (this.model) this.model.visible = this.weapon.def.kind !== 'throw' || !this.thrown || this.throwT <= 0;
    const reloadDip = this.reloadT > 0 ? Math.sin(Math.min(1, 1 - this.reloadT / this.weapon.def.reload) * Math.PI) : 0;
    this.pea.position.copy(this.pos);
    this.pea.rotation.set(0, this.facing, 0);
    this.pea.userData.pose({
      t: this.t,
      walk: this.walk,
      cycle: this.cycle,
      stride: this.stride ?? 0.13,
      air: this.air,
      rise: THREE.MathUtils.clamp(this.vel.y / JUMP_V, -1, 1),
      land,
      crouch: this.crouch > 0 ? 1 : 0,
      hold: this.holdK * (1 - 0.35 * reloadDip),
      aim: THREE.MathUtils.clamp(this.aimPitch, -0.7, 0.8) - 0.4 * reloadDip,
      recoil: this.recoil,
      twist: this.twist,
      kneel: this.kneelK,
      throw: this.throwT > 0 ? 1 - this.throwT / 0.55 : 0,
      flinch: this.flinch,
    });
  }
}

// The weapon's transform inside the right hand, so the gun points straight ahead at the hip.
function computeHold(pea) {
  const prevPos = pea.position.clone(), prevRot = pea.rotation.clone();
  pea.position.set(0, 0, 0);
  pea.rotation.set(0, 0, 0);
  pea.userData.pose({ hold: 1 }, false);
  pea.updateMatrixWorld(true);
  const hand = pea.userData.rig.hands[1];
  const rel = new THREE.Matrix4().copy(pea.matrixWorld).invert().multiply(hand.matrixWorld);
  const p = new THREE.Vector3().setFromMatrixPosition(rel);
  const want = new THREE.Matrix4().makeTranslation(p.x + 0.035, p.y - 0.005, p.z);
  pea.position.copy(prevPos);
  pea.rotation.copy(prevRot);
  return rel.invert().multiply(want);
}

// The player's pea: camera-relative movement from input; aims where the crosshair points.
export class Player extends Soldier {
  constructor(opts = {}) {
    super({ team: 0, lod: 1, loadout: ['rifle', 'smg', 'mg', 'plasma', 'flame', 'launcher', 'grenade'], ...opts });
    this.semiLatch = true;
    this.isPlayer = true;
    this.aimHold = 0;
    this.respawnT = 0;
    this.facing = this.aimYaw = Math.PI; // back to the camera, facing the field
  }

  // input: { move:{x,y}, jump, fire, aim }, camYaw, aimPoint (world)
  update(dt, world, input, camYaw, aimPoint) {
    if (!this.alive) {
      this.respawnT += dt;
      super.update(dt, world);
      if (this.respawnT > 3) this.respawn(world);
      return;
    }
    if (input) {
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      this.ctrl.wx = rx * input.move.x + fx * input.move.y;
      this.ctrl.wz = rz * input.move.x + fz * input.move.y;
      this.ctrl.jump = input.jump;
      this.ctrl.fire = input.fire;
      if (input.fire || input.aim) this.aimHold = 2.2;
      this.aimHold -= dt;
      this.ctrl.aimAt = this.aimHold > 0 ? aimPoint : null;
      this.ctrl.aiming = this.aimHold > 0;
    }
    super.update(dt, world);
  }

  fellOff(world) {
    this.respawn(world, true);
  }

  respawn(world, fell = false) {
    this.pos.set(0, SPAWN_Y, 0);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.air = 1;
    this.respawns++;
    if (!this.alive || fell) {
      this.alive = true;
      this.hp = this.maxHp;
      this.burn = 0;
      this.respawnT = 0;
      this.deadT = 0;
      for (const w of this.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve ?? Infinity; w.heat = 0; w.locked = 0; }
      if (this.model) this.model.visible = true;
      this.reloadT = this.throwT = 0;
      world?.onRespawn?.(this);
    }
  }
}
