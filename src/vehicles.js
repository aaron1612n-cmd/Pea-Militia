import * as THREE from 'three';
import { height } from './terrain.js';
import { pushCircle } from './physics.js';
import { HALF } from './world.js';
import { VEHICLES, CKit, WRECK, clamp } from './vkit.js';
import { STRIDER } from './strider.js';
import './tank.js';

// Vehicles: heavy, believable machines for the big field. Each is one body on the ground with a hull box for
// hits and collisions, a turret and gun that turn on their own, and seats for crew. The models live next to
// their own animation (strider.js, tank.js) and are drawn as ONE skinned mesh each (see vkit.js), so a machine
// costs about three draw calls whatever its part count. World yaw convention matches soldiers: forward is
// (sin yaw, cos yaw).
export { VEHICLES, CKit };
const WL = STRIDER;

const _p = new THREE.Vector3(), _s = new THREE.Vector3();

let vehicleId = 1;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------- the vehicle ----------------
export class Vehicle {
  constructor(kind, team, x, z, yaw = 0) {
    const def = VEHICLES[kind];
    this.id = 1000 + vehicleId++;
    this.kind = kind;
    this.def = def;
    this.isVehicle = true;
    this.team = team;
    this.pos = new THREE.Vector3(x, height(x, z), z);
    this.yaw = yaw;
    this.pitch = 0; this.roll = 0;
    this.vel = new THREE.Vector3();
    this.speed = 0; this.yawRate = 0;
    this.hp = def.hp; this.maxHp = def.hp;
    this.alive = true;
    this.deadT = 0;
    this.t = Math.random() * 10;
    this.lastShot = -99;
    this.kills = 0;
    this.lod = 0; this.tier = 0;
    this.kneelK = 0;
    this.suppression = 0;
    this.seats = Array.from({ length: def.seats }, () => null); // Unit or null
    this.crew = []; // AI crew held here (not in the battle's soldier list)
    this.ctrl = { throttle: 0, steer: 0, brake: false, fire: false, fire2: false, aimAt: null };
    this.tYaw = 0; this.tPitch = 0; // turret relative to the hull, gun relative to the turret
    this.cool = [0, 0];
    this.recoil = 0;
    this.box = { x, z, yaw, hx: def.hx, hz: def.hz, h: def.h, y0: pos0(this.pos) };
    this.parts = def.build(team);
    this.group = this.parts.root;
    this.brain = null;
    this.stuck = 0;
    this.engine = null;
    this.wreckT = 0;
    this.burn = 0;
    this.centerV = new THREE.Vector3();
    this.group.userData.vehicle = this;
    this.syncModel(0);
  }

  get driver() { return this.seats[0]; }
  get occupied() { return this.seats.some(Boolean) || this.crew.length > 0; }
  get hp01() { return this.hp / this.maxHp; }
  get isPlayerDriven() { return !!this.seats[0]?.isPlayer; }
  get hasPlayer() { return this.seats.some((u) => u?.isPlayer); }
  get speedKmh() { return Math.abs(this.speed) * 3.6; }
  center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + (this.alive ? this.def.lift || 0 : 0) + this.def.h * 0.5, this.pos.z); }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + (this.def.eyeH || 1.8), this.pos.z); }
  hitBox() {
    const b = this.box;
    b.x = this.pos.x; b.z = this.pos.z; b.yaw = this.yaw; b.y0 = this.pos.y + (this.alive ? this.def.lift || 0 : 0); b.h = this.alive ? this.def.h : 1.1;
    return b;
  }
  // gun muzzle and aim for the player's HUD
  muzzlePos(w = 0, out = new THREE.Vector3()) { this.group.updateMatrixWorld(true); return this.parts.muzzles[w].getWorldPosition(out); }
  muzzleDir(w = 0, out = new THREE.Vector3()) {
    this.group.updateMatrixWorld(true);
    const o = this.parts.muzzles[w];
    return out.set(0, 0, 1).transformDirection(o.matrixWorld);
  }
  weapon(i) { return this.def.weapons[i]; }
  // first-person cockpit: hide the outside of the machine, keep the gun so you see it ahead
  setCockpit(on) {
    if (!!this.cockpitOn === on) return;
    this.cockpitOn = on;
    this.parts.setCockpit?.(on);
    for (const m of this.marks || []) m.visible = !on; // bullet marks ride the joints, not the body mesh
  }
  // 0 near, 1 far geometry, 2 far geometry and no shadow: set by the renderer from the camera's distance
  setLod(level) {
    if (level === this.lod) return;
    this.lod = level;
    this.parts.setLod?.(level);
  }
  // where the driver's eyes are, in the world
  cockpitEye(out = new THREE.Vector3()) {
    const l = this.def.cockpit;
    this.group.updateMatrixWorld(true);
    // a seat that rides the turret (a tank's commander) turns with it
    if (this.parts.eyeObj) return this.parts.eyeObj.getWorldPosition(out);
    out.set(l[0], l[1] + (this.parts.hy !== undefined ? this.parts.hy - WL.hip : 0), l[2]);
    return this.group.localToWorld(out);
  }
  hudWeapon() {
    const d = this.def.weapons[0], c = this.cool[0];
    const slow = d.interval > 1;
    return { id: d.id, def: { name: slow && c > 0 ? 'Reloading' : d.name }, mag: slow ? (c > 0 ? 0 : 1) : '', reserve: Infinity, heat: 0 };
  }

  // ---------- crew ----------
  board(unit, seat = 0) {
    if (this.seats[seat] || !this.alive) return false;
    this.seats[seat] = unit;
    unit.vehicle = this; unit.seat = seat;
    unit.pos.copy(this.pos);
    unit.vel.set(0, 0, 0);
    return true;
  }
  // put the occupant of a seat on the ground beside the vehicle; returns the unit
  eject(seat = 0, battle = null) {
    const u = this.seats[seat];
    if (!u) return null;
    this.seats[seat] = null;
    u.vehicle = null; u.seat = -1;
    const side = [1, -1];
    let spot = null;
    for (const s of side) for (const d of [this.def.hx + 1.1, this.def.hx + 2.2]) {
      const x = this.pos.x + Math.cos(this.yaw) * s * d, z = this.pos.z - Math.sin(this.yaw) * s * d;
      let ok = Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2;
      if (ok && battle) for (const p of battle.propGrid.near(x, z, 1.5, battle.tmpB)) if (p.alive && p.box.h > 0.3) { const c = { x, z }; if (pushCircle(c, 0.5, p.box)) { ok = false; break; } }
      if (ok) { spot = [x, z]; break; }
    }
    if (!spot) spot = [this.pos.x + Math.cos(this.yaw) * (this.def.hx + 1.2), this.pos.z - Math.sin(this.yaw) * (this.def.hx + 1.2)];
    u.pos.set(spot[0], height(spot[0], spot[1]), spot[1]);
    u.vel.set(0, 0, 0);
    u.grounded = true;
    return u;
  }

  // ---------- damage ----------
  hit(dmg, kind, from, battle) {
    if (!this.alive) return;
    const a = this.def.armor[kind] ?? this.def.armor.blast;
    const d = dmg * a;
    if (d < 0.5) return;
    this.hp -= d;
    this.lastHurt = this.t;
    if (from?.isPlayer) battle.onHitMarker?.(this.hp <= 0);
    const driver = this.driver;
    if (driver?.isPlayer) battle.onPlayerHurt?.(d * 0.15, from);
    if (this.hp <= 0) this.destroy(from, battle);
  }

  destroy(from, battle) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.wreckT = 0;
    this.brain = null;
    if (from && from.team !== undefined && from.team !== this.team) from.kills = (from.kills || 0) + 3;
    const c = this.center();
    battle.explode(c.clone().setY(c.y + 0.3), 5.2, 160, from || null, 1);
    for (let s = 0; s < this.seats.length; s++) {
      const u = this.seats[s];
      if (u) { this.eject(s, battle); u.hurt(9999, from, battle, 'blast'); u.impulse?.(new THREE.Vector3((Math.random() - 0.5) * 6, 6, (Math.random() - 0.5) * 6)); }
    }
    for (const u of this.crew) { u.vehicle = null; }
    this.crew.length = 0;
    battle.fx.debris(c, '#4a4a45', 14);
    battle.fx.smoke(c, new THREE.Vector3(0, 3, 0), 3, 1);
    battle.onVehicleDestroyed?.(this, from);
    this.engine?.stop(); this.engine = null;
    for (const m of this.parts.meshes) m.material = WRECK;
    this.parts.setDamage?.(2); this.tier = 2;
    // the turret is blown askew (or, on a tank, clean off)
    this.wreckTurret = { yaw: (Math.random() - 0.5) * 0.9, lift: 0.25 };
    this.parts.onDestroy?.(this);
    this.cool = [0, 0];
  }

  // ---------- update ----------
  update(dt, battle) {
    this.t += dt;
    for (let i = 0; i < 2; i++) this.cool[i] = Math.max(0, this.cool[i] - dt);
    this.recoil = Math.max(0, this.recoil - dt * 1.6);
    if (!this.alive) { this.updateWreck(dt, battle); return; }
    this.suppression = 0;
    const tier = this.hp01 < 0.34 ? 2 : this.hp01 < 0.67 ? 1 : 0;
    if (tier !== this.tier) { this.tier = tier; this.parts.setDamage?.(tier); }
    const d = this.def, c = this.ctrl;
    const driven = this.seats[0] || this.crew.length;
    const thr = driven ? clamp(c.throttle, -1, 1) : 0, str = driven ? clamp(c.steer, -1, 1) : 0;
    // ---- drive
    const fwd = _p.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const slope = (height(this.pos.x + fwd.x, this.pos.z + fwd.z) - height(this.pos.x - fwd.x, this.pos.z - fwd.z)) / 2; // rise per metre ahead
    const hurt = this.tier > 1 && d.drive === 'tracked' ? 0.65 : 1; // a wounded engine
    const goal = thr > 0 ? thr * d.maxSpeed * hurt : thr * d.maxRev * hurt;
    let a = d.accel;
    if (c.brake || (goal === 0 && Math.abs(this.speed) > 0.01)) a = d.brake;
    else if (goal * this.speed < 0) a = d.brake;
    // climbing slows, going downhill helps; too steep and the tracks just spin
    const grade = clamp(slope, -1, 1);
    const maxUp = d.maxSlope;
    const climb = goal >= 0 ? grade : -grade; // rise in the direction of travel
    let g = goal * (1 - clamp(climb, 0, maxUp) / maxUp * 0.7);
    if (climb > maxUp) g = Math.sign(goal) * Math.min(Math.abs(g), 0.4);
    const dv = g - this.speed;
    const sp0 = this.speed;
    this.speed += clamp(dv, -a * dt, a * dt);
    this.accel = dt > 0 ? (this.speed - sp0) / dt : 0;
    this.speed -= grade * 9.8 * dt * 0.25 * (Math.abs(this.speed) > 0.05 || c.brake ? 1 : 0.4); // roll with the hill
    if (c.brake && Math.abs(this.speed) < 0.1) this.speed = 0;
    // steering: tracks pivot on the spot, slower when hurtling
    let yawGoal;
    yawGoal = -str * d.turn * (1 - Math.min(0.55, Math.abs(this.speed) / d.maxSpeed * 0.5)) * (this.speed < -0.3 ? -1 : 1);
    this.yawRate += (yawGoal - this.yawRate) * (1 - Math.exp(-6 * dt));
    this.yaw += this.yawRate * dt;
    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    // ---- collisions
    const hitSpeed = this.collide(dt, battle);
    void hitSpeed;
    // ---- ground
    this.settle(dt);
    // ---- turret and guns
    this.aimTurret(dt, battle);
    this.fireControl(dt, battle);
    // ---- tracks and wheels, sound, smoke
    this.wheelPhase = (this.wheelPhase || 0) + this.speed * dt;
    this.effects(dt, battle);
    this.syncModel(dt);
    if (this.footfalls?.length) this.stomp(battle);
    this.updateEngine(battle);
  }

  // each planted foot of a walker shakes the dust and flattens whoever is under it
  stomp(battle) {
    for (const [x, z] of this.footfalls) {
      battle.fx.dust(new THREE.Vector3(x, height(x, z) + 0.1, z), 3, 0.7);
      if (Math.abs(this.speed) < 0.4) continue;
      for (const u of battle.nearUnits(x, z, 2)) {
        if (!u.alive || u.vehicle || u.team === this.team) continue;
        battle.damageUnit(u, 90, this.shooter(), 'blast', _s.set(Math.sin(this.yaw), 0.4, Math.cos(this.yaw)));
      }
    }
    this.footfalls.length = 0;
  }

  // push out of props, crush the low ones, run over soldiers
  collide(dt, battle) {
    const d = this.def, r = d.hx * 0.92;
    let worst = 0;
    const px = this.pos.x, pz = this.pos.z;
    for (const off of [-d.hz * 0.62, 0, d.hz * 0.62]) {
      const c = _p.set(this.pos.x + Math.sin(this.yaw) * off, 0, this.pos.z + Math.cos(this.yaw) * off);
      const circle = { x: c.x, z: c.z };
      for (const p of battle.propGrid.near(circle.x, circle.z, r + 3, battle.tmpB)) {
        if (!p.alive) continue;
        const top = p.box.y0 + p.box.h;
        if (top < this.pos.y + d.step) continue; // a kerb: roll over it
        // low, breakable cover is crushed under the tracks
        if (d.crush && p.hp !== Infinity && p.box.h < (d.crushH || 1.25) && Math.abs(this.speed) > 1.2) {
          const probe = { x: circle.x, z: circle.z };
          if (pushCircle(probe, r * 0.8, p.box)) { battle.damageProp(p, 5000, this.driver || this.crew[0] || null); this.speed *= 0.9; }
          continue;
        }
        const moved = pushCircle(circle, r, p.box);
        if (moved) {
          const dx = circle.x - c.x, dz = circle.z - c.z;
          this.pos.x += dx; this.pos.z += dz;
          const into = Math.abs(this.speed);
          worst = Math.max(worst, into);
          this.speed *= 0.55;
          if (p.hp !== Infinity && into > 3) battle.damageProp(p, into * 60, this.driver || this.crew[0] || null);
          c.x += dx; c.z += dz;
        }
      }
    }
    // stay in the field
    const E = HALF - 3;
    this.pos.x = clamp(this.pos.x, -E, E); this.pos.z = clamp(this.pos.z, -E, E);
    // other vehicles
    for (const o of battle.vehicles) {
      if (o === this || !o.alive && o.deadT > 60) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, min = ((this.def.rad || this.def.hx) + (o.def.rad || o.def.hx)) * 1.25 + 0.6, dist = Math.hypot(dx, dz);
      if (dist < min && dist > 0.01) {
        const k = (min - dist) * (o.alive ? 0.5 : 1);
        this.pos.x -= dx / dist * k; this.pos.z -= dz / dist * k;
        if (o.alive) { o.pos.x += dx / dist * k; o.pos.z += dz / dist * k; }
        this.speed *= 0.8;
      }
    }
    // soldiers underfoot: heavy hulls run them over, friends are shoved aside
    if (Math.abs(this.speed) > 0.6 || true) {
      for (const u of battle.nearUnits(this.pos.x, this.pos.z, d.hz + 1.5)) {
        if (!u.alive || u.vehicle) continue;
        const rel = battle.toLocalBox ? null : null; void rel;
        const dx = u.pos.x - this.pos.x, dz = u.pos.z - this.pos.z;
        const lx = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw), lz = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
        if (Math.abs(lx) > d.hx + 0.25 || Math.abs(lz) > d.hz + 0.25) continue;
        if (u.pos.y > this.pos.y + 1.0) continue;
        if (u.team !== this.team && d.runover && Math.abs(this.speed) > 1.4) {
          battle.damageUnit(u, d.runover, this.driver || this.crew[0], 'blast', _s.set(Math.sin(this.yaw), 0.3, Math.cos(this.yaw)));
        } else {
          // out sideways
          const side = Math.sign(lx) || 1;
          u.pos.x += Math.cos(this.yaw) * side * 0.12; u.pos.z -= Math.sin(this.yaw) * side * 0.12;
        }
      }
    }
    return worst + Math.hypot(this.pos.x - px, this.pos.z - pz) * 0;
  }

  settle(dt) {
    const d = this.def, hx = d.hx * 0.85, hz = d.hz * 0.8;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const at = (lx, lz) => height(this.pos.x + c * lx + s * lz, this.pos.z - s * lx + c * lz);
    const fl = at(-hx, hz), fr = at(hx, hz), bl = at(-hx, -hz), br = at(hx, -hz);
    const gy = Math.max((fl + fr + bl + br) / 4, Math.min(fl, fr, bl, br) + 0.1);
    const tp = Math.atan2((fl + fr) / 2 - (bl + br) / 2, hz * 2); // nose up when positive
    const tr = Math.atan2((fl + bl) / 2 - (fr + br) / 2, hx * 2);
    const k = 1 - Math.exp(-9 * dt);
    if (d.drive === 'legged') {
      this.pos.y += (gy - this.pos.y) * Math.min(1, k * 1.4);
      const tilt = d.tilt ?? 1;
      this.pitch += (tp * tilt - this.pitch) * k;
      this.roll += (tr * tilt - this.roll) * k;
      this.rock = (this.rock || 0) * Math.exp(-4 * dt);
      return;
    }
    // tracks and wheels: lay the hull on the ground plane, then lift it until no point of the
    // footprint is under the surface (so a crest or a kerb can never swallow a wheel)
    const kk = 1 - Math.exp(-14 * dt);
    this.pitch += (tp - this.pitch) * kk;
    this.roll += (tr - this.roll) * kk;
    const tanP = Math.tan(this.pitch), tanR = Math.tan(this.roll);
    let need = -Infinity;
    const ex = d.hx * 0.9, ez = d.hz * 0.92;
    for (const lx of [-ex, 0, ex]) for (const lz of [-ez, -ez / 2, 0, ez / 2, ez]) {
      need = Math.max(need, at(lx, lz) - (lz * tanP - lx * tanR));
    }
    need -= 0.04;
    if (this.pos.y < need) this.pos.y = need;
    else this.pos.y += (need - this.pos.y) * (1 - Math.exp(-10 * dt));
    this.rock = (this.rock || 0) * Math.exp(-4 * dt);
  }

  // turn the turret and gun toward ctrl.aimAt (a world point)
  aimTurret(dt, battle) {
    const t = this.def.turret, c = this.ctrl;
    if (!t || !c.aimAt) return;
    this.group.updateMatrixWorld(true);
    // direction from the turret pivot in hull space
    const pivot = _p.set(...t.pivot).applyMatrix4(this.group.matrixWorld);
    const dir = _s.copy(c.aimAt).sub(pivot);
    const inv = new THREE.Quaternion().copy(this.group.quaternion).invert();
    dir.applyQuaternion(inv).normalize();
    const wantYaw = Math.atan2(dir.x, dir.z);
    const wantPitch = clamp(Math.asin(clamp(dir.y, -1, 1)), t.pitchMin, t.pitchMax);
    const wy = t.yawLimit ? clamp(wantYaw, -t.yawLimit, t.yawLimit) : wantYaw;
    this.tYaw = wrapA(this.tYaw + clamp(wrapA(wy - this.tYaw), -t.rate * dt, t.rate * dt));
    this.tPitch += clamp(wantPitch - this.tPitch, -t.pitchRate * dt, t.pitchRate * dt);
    this.aimErr = Math.abs(wrapA(wantYaw - this.tYaw)) + Math.abs(wantPitch - this.tPitch);
    if (this.def.turret.yawLimit && Math.abs(wantYaw) > this.def.turret.yawLimit + 0.1) this.aimErr = 1; // cannot bear
  }

  shooter() { return this.seats[1] || this.seats[0] || this.crew[0] || this; }

  fireControl(dt, battle) {
    const c = this.ctrl, who = this.shooter();
    if (c.fire && this.cool[0] <= 0) this.fireWeapon(0, battle, who);
    if (c.fire2 && this.def.weapons[1] && this.cool[1] <= 0) this.fireWeapon(1, battle, who);
  }

  fireWeapon(i, battle, who) {
    const w = this.def.weapons[i];
    this.cool[i] = w.interval;
    if (w.alt) { this.alt = -(this.alt || 1); this.parts.muzzles[i].position.x = 0.22 * this.alt; }
    const m = this.muzzlePos(i), dir = this.muzzleDir(i);
    if (w.lob) {
      // a mortar: fixed elevation, speed chosen so the bomb lands on the aim point
      const a = this.ctrl.aimAt, md = this.muzzleDir(0, _s.set(0, 0, 0));
      let hx = md.x, hz = md.z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      const R = a ? clamp(Math.hypot(a.x - m.x, a.z - m.z), w.minRange || 10, w.range) : 40, dy = a ? a.y - m.y : -2;
      const th = w.lob, den = 2 * Math.cos(th) ** 2 * (R * Math.tan(th) - dy);
      const spd = den > 0.5 ? clamp(Math.sqrt(w.gravity * R * R / den), 14, 70) : 40;
      const jit = 1 + (Math.random() - 0.5) * w.spread * 4;
      const vel = new THREE.Vector3(hx * Math.cos(th), Math.sin(th), hz * Math.cos(th)).multiplyScalar(spd * jit);
      battle.stats.shots++;
      battle.launch(w.proj, m, vel, who, w);
      battle.fx.muzzle(m, dir, 1.8);
      battle.fx.steam(m, new THREE.Vector3(0, 4, 0), 5, 0.9);
      battle.fx.smoke(m, new THREE.Vector3(0, 3, 0), 1.0, 0.4);
      battle.audio.play(w.sound, m, who?.isPlayer ? 0.8 : 1);
      battle.heard(who, m);
      this.recoil = 0.6; this.lastShot = this.t;
      return;
    }
    const sp = battle.spread(dir, w.spread + (w.kind === 'hitscan' ? Math.min(0.03, Math.abs(this.speed) * 0.002) : 0));
    battle.stats.shots++;
    if (w.kind === 'projectile') {
      const proj = battle.launch(w.proj, m, sp.multiplyScalar(w.speed), who, w);
      if (w.proj === 'shell') proj.model.scale.setScalar(1.8);
    } else battle.hitscan(who, m, sp, w);
    const big = w.vehicleGun && w.proj === 'shell';
    battle.fx.muzzle(m, dir, big ? 2.6 : 1);
    if (big) {
      // a steam gun vents steam; a diesel tank's cannon throws a fireball of smoke and kicks up the dust under the barrel
      if (w.smoky) { battle.fx.smoke(m, dir.clone().multiplyScalar(5), 2.2, 1); battle.fx.smoke(m, dir.clone().multiplyScalar(2).setY(1.2), 1.6, 0.6); battle.fx.dust(m.clone().setY(this.pos.y + 0.2), 8, 1.4); }
      else { battle.fx.steam(m, dir.clone().multiplyScalar(3), 5, 0.9); battle.fx.smoke(m, dir.clone().multiplyScalar(4), 1.1, 0.4); battle.fx.dust(this.pos.clone().setY(this.pos.y + 0.2), 3, 0.6); }
      this.recoil = 1; this.rock = 1;
    } else if (!w.noRecoil) this.recoil = Math.min(1, this.recoil + 0.25);
    battle.audio.play(w.sound, m, who?.isPlayer ? 0.8 : 1);
    battle.heard(who, m);
    this.lastShot = this.t;
  }

  effects(dt, battle) {
    const fx = battle.fx, d = this.def;
    const moving = Math.abs(this.speed) > 0.5;
    this._steamT = (this._steamT || 0) - dt;
    if (this._steamT <= 0) {
      this._steamT = moving ? 0.12 : 0.35;
      if (d.engine === 'diesel') {
        // exhaust: a thin grey wisp at idle, a thick black cloud when the throttle is open
        const load = clamp(Math.abs(this.ctrl.throttle) + Math.abs(this.yawRate) * 0.6, 0, 1);
        for (const at of d.exhaustAt) {
          const p = _p.set(...at).applyMatrix4(this.group.matrixWorld);
          fx.smoke(p, new THREE.Vector3(0, 1.3 + load * 1.2, 0), 0.5 + load * 0.7, load > 0.3 ? 1 : 0);
        }
      } else {
        const p = _p.set(...d.steamAt).applyMatrix4(this.group.matrixWorld);
        fx.steam(p, new THREE.Vector3(0, 1.4 + Math.abs(this.speed) * 0.1, 0), 1, 0.45);
      }
    }
    if (moving && Math.random() < dt * 14) {
      const s = Math.sign(Math.random() - 0.5), c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      const off = d.dustX ?? 1.0, back = d.dustBack ?? 2.2;
      fx.dust(new THREE.Vector3(this.pos.x + c * s * off - sn * Math.sign(this.speed) * back, this.pos.y + 0.1, this.pos.z - sn * s * off - c * Math.sign(this.speed) * back), 1, d.drive === 'tracked' ? 0.8 : 0.5);
    }
    if (this.hp01 < 0.45 && Math.random() < dt * (1 - this.hp01) * 10) fx.smoke(this.center().setY(this.pos.y + 1.3), new THREE.Vector3(0, 2.2, 0), 1.2, 1);
    if (this.hp01 < 0.2 && Math.random() < dt * 8) fx.burn(this.center().setY(this.pos.y + 1.4));
    // badly hurt: a ruptured line vents steam, or a fuel line trails smoke, from fixed points on the body
    if (this.tier > 1 && d.leaks && Math.random() < dt * 9) {
      const at = d.leaks[(Math.random() * d.leaks.length) | 0], p = _p.set(...at).applyMatrix4(this.group.matrixWorld);
      if (d.engine === 'diesel') fx.smoke(p, new THREE.Vector3(0, 1.8, 0), 0.8, 1); else fx.steam(p, new THREE.Vector3(0, 2.4, 0), 2, 0.55);
    }
  }

  updateWreck(dt, battle) {
    this.deadT += dt;
    this.speed *= Math.exp(-2 * dt);
    this.settle(dt);
    if (Math.random() < dt * 5 && this.deadT < 25) battle.fx.smoke(this.center().setY(this.pos.y + 1.2), new THREE.Vector3(0, 2, 0), 1.3, 1);
    if (this.deadT < 18 && Math.random() < dt * 2) battle.fx.burn(this.center().setY(this.pos.y + 1.1));
    this.syncModel(dt);
  }

  updateEngine(battle) {
    if (!this.alive) return;
    if (!this.engine && battle.audio?.ctx) this.engine = battle.audio.engine(this.def.engine || 'steam');
    this.engine?.set(Math.min(1, Math.abs(this.speed) / this.def.maxSpeed + Math.abs(this.yawRate) * 0.3 + (this.ctrl.throttle ? 0.15 : 0)), this.pos);
  }

  syncModel() {
    const g = this.group, P = this.parts;
    g.position.copy(this.pos);
    g.rotation.order = 'YXZ';
    g.rotation.y = this.yaw;
    g.rotation.x = -this.pitch + (this.rock || 0) * 0.015 * Math.sin(this.t * 18);
    g.rotation.z = this.roll;
    if (P.turretPivot) {
      const piv = this.def.turret.pivot;
      if (this.alive) {
        P.turretPivot.rotation.y = this.tYaw;
        P.gun.rotation.x = -this.tPitch;
        P.gun.position.z = P.gunZ - this.recoil * P.recoilK;
        P.turretPivot.position.y = piv[1];
      } else if (this.wreckTurret && !P.ownWreck) {
        P.turretPivot.rotation.y = this.tYaw + this.wreckTurret.yaw;
        P.turretPivot.rotation.z = 0.25;
        P.gun.rotation.x = 0.3;
        P.turretPivot.position.y = piv[1] + this.wreckTurret.lift * Math.min(1, this.deadT * 2);
      }
    }
    P.animate?.(this);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.engine?.stop(); this.engine = null;
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  }
}

function pos0(p) { return p.y; }

