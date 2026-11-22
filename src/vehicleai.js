import * as THREE from 'three';
import { height } from './terrain.js';
import { hostile } from './factions.js';
import { HALF } from './world.js';

const V = () => new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);

// The driver and gunner of an AI vehicle in one head: pick an objective, drive there round
// whatever is in the way, stop to fight when something worth shooting shows up, and aim the
// turret at the nearest threat, tanks first.
export class VehicleBrain {
  constructor(v, world) {
    this.v = v; this.w = world;
    this.goal = null; this.goalPoint = null;
    this.thinkT = rand(0, 0.5); this.aimT = 0;
    this.target = null; this.seen = false;
    this.dwell = 0;
    this.stuckT = 0; this.reverseT = 0; this.mark = v.pos.clone(); this.markT = 0; this.turnBias = 1;
    this.burst = 0; this.hold = false;
    this.tmp = V(); this.tc = V(); this.eye = V();
    this.heavy = v.def.weapons.findIndex((x) => x.ai === 'heavy');
    this.light = v.def.weapons.findIndex((x) => x.ai === 'light');
  }

  update(dt) {
    const v = this.v;
    if (!v.alive) return;
    // a player in the driver's seat has the controls; an empty machine just sits
    if (v.seats[0]) return;
    if (!v.crew.length) { v.ctrl.throttle = v.ctrl.steer = 0; v.ctrl.fire = v.ctrl.fire2 = false; v.ctrl.brake = true; return; }
    this.thinkT -= dt; this.aimT -= dt;
    if (this.thinkT <= 0) { this.thinkT = rand(0.7, 1.2); this.think(); }
    if (this.aimT <= 0) { this.aimT = rand(0.25, 0.45); this.acquire(); }
    this.drive(dt);
    if (!v.seats[1]?.isPlayer) this.gun(dt);
  }

  // where to go
  think() {
    const v = this.v, w = this.w;
    const pts = w.points;
    if (v.hp01 < 0.25 && v.fromBase) {
      const b = w.teams[v.team].base;
      this.goal = b.clone(); this.goalPoint = null; return;
    }
    // a car with only a machine gun keeps clear of armour
    if (this.heavy < 0) {
      for (const o of w.vehicles) {
        if (!o.alive || !hostile(o.team, v.team) || o.def.armor.bullet > 0.1) continue;
        const dx = v.pos.x - o.pos.x, dz = v.pos.z - o.pos.z, d = Math.hypot(dx, dz);
        if (d < 65) { this.goal = new THREE.Vector3(v.pos.x + dx / (d || 1) * 45, 0, v.pos.z + dz / (d || 1) * 45); this.goalPoint = null; this.fleeing = true; return; }
      }
      this.fleeing = false;
    }
    if (pts.length) {
      if (this.goalPoint && this.goalPoint.owner === v.team && !this.goalPoint.contested) { this.dwell += 1; if (this.dwell > 6) { this.goalPoint = null; this.dwell = 0; } }
      if (!this.goalPoint) {
        let best = null, bs = Infinity;
        for (const p of pts) {
          let sc = Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z);
          if (p.owner === v.team && !p.contested) sc += 160;
          if (p.owner >= 0 && p.owner !== v.team) sc -= 25;
          for (const o of w.vehicles) if (o !== v && o.alive && o.team === v.team && o.brain?.goalPoint === p) sc += 60;
          if (sc < bs) { bs = sc; best = p; }
        }
        this.goalPoint = best; this.dwell = 0;
      }
      const p = this.goalPoint;
      // approach from our own side and stop short of the middle so the point can be seen and shot at
      const dx = v.pos.x - p.pos.x, dz = v.pos.z - p.pos.z, l = Math.hypot(dx, dz) || 1;
      const k = Math.min(1, p.r * 0.5 / l);
      this.goal = new THREE.Vector3(p.pos.x + dx * k, 0, p.pos.z + dz * k);
    } else {
      // sandbox: hunt the nearest enemy
      let best = null, bd = Infinity;
      for (const u of w.units) if (u.alive && !u.vehicle && hostile(u.team, v.team)) { const d = Math.hypot(u.pos.x - v.pos.x, u.pos.z - v.pos.z); if (d < bd) { bd = d; best = u; } }
      this.goal = best ? best.pos.clone() : null;
    }
  }

  // pick the best thing to shoot
  acquire() {
    const v = this.v, w = this.w;
    const eye = v.muzzlePos(0, this.eye);
    let best = null, bs = Infinity;
    for (const o of w.vehicles) {
      if (!o.alive || !hostile(o.team, v.team)) continue;
      const d = Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z);
      if (d > 110 || (this.heavy < 0 && o.def.armor.bullet < 0.1)) continue;
      if (!w.los(eye, o.center(this.tc))) continue;
      if (d - 40 < bs) { bs = d - 40; best = o; }
    }
    for (const u of w.nearUnits(v.pos.x, v.pos.z, 75)) {
      if (!u.alive || !hostile(u.team, v.team)) continue;
      const d = Math.hypot(u.pos.x - v.pos.x, u.pos.z - v.pos.z);
      if (d < bs && w.los(eye, u.center(this.tc))) { bs = d; best = u; }
    }
    this.target = best; this.seen = !!best;
    if (best) this.err = V().set(rand(-1, 1), rand(-0.3, 0.6), rand(-1, 1)).multiplyScalar(0.5 + Math.hypot(best.pos.x - v.pos.x, best.pos.z - v.pos.z) * 0.012);
    // stop and fight when it is close and in the open; keep rolling otherwise
    if (best && v.def.drive === 'tracked') { const d = Math.hypot(best.pos.x - v.pos.x, best.pos.z - v.pos.z); this.hold = d < 34 && !!best.isVehicle || d < 16; }
    else this.hold = false;
  }

  blocked(x, z, yaw) {
    const v = this.v, w = this.w, r = v.def.hx + 0.45;
    if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) return true;
    const gy = height(x, z), here = v.pos.y;
    if (Math.abs(gy - here) > 1.8 + Math.abs(here - gy) * 0) { /* a cliff or a wall of hill */ if (gy - here > 1.4) return true; }
    for (const p of w.propGrid.near(x, z, r + 3, w.tmpB)) {
      if (!p.alive) continue;
      if (p.box.y0 + p.box.h < here + 0.3) continue;
      if (p.hp !== Infinity && p.box.h < 1.25) continue; // crushed under the tracks
      const [lx, lz] = [(x - p.box.x) * Math.cos(p.box.yaw) - (z - p.box.z) * Math.sin(p.box.yaw), (x - p.box.x) * Math.sin(p.box.yaw) + (z - p.box.z) * Math.cos(p.box.yaw)];
      const dx = Math.max(0, Math.abs(lx) - p.box.hx), dz = Math.max(0, Math.abs(lz) - p.box.hz);
      if (dx * dx + dz * dz < r * r) return true;
    }
    for (const o of w.vehicles) if (o !== v && Math.hypot(o.pos.x - x, o.pos.z - z) < (v.def.hx + o.def.hx) * 1.3 + 1) return true;
    return false;
  }
  clearAhead(yaw, dist) {
    const v = this.v;
    for (let d = 3; d <= dist; d += 3) if (this.blocked(v.pos.x + Math.sin(yaw) * d, v.pos.z + Math.cos(yaw) * d, yaw)) return false;
    return true;
  }

  drive(dt) {
    const v = this.v, c = v.ctrl;
    c.brake = false;
    // stuck watchdog: wanted to move, did not; back up and turn
    this.markT += dt;
    if (this.markT > 1.5) {
      const moved = Math.hypot(v.pos.x - this.mark.x, v.pos.z - this.mark.z);
      if (!this.hold && this.goal && c.throttle > 0.4 && moved < 0.8 && this.reverseT <= 0) { this.reverseT = rand(1.4, 2.4); this.turnBias = Math.random() < 0.5 ? -1 : 1; }
      this.mark.copy(v.pos); this.markT = 0;
    }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      c.throttle = -0.8; c.steer = this.turnBias;
      return;
    }
    if (!this.goal || this.hold) { c.throttle = 0; c.steer = 0; c.brake = true; return; }
    const dx = this.goal.x - v.pos.x, dz = this.goal.z - v.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 6) { c.throttle = 0; c.steer = 0; c.brake = true; return; }
    const want = Math.atan2(dx, dz);
    const look = clamp(6 + Math.abs(v.speed) * 1.6, 7, 16);
    let heading = want;
    if (!this.clearAhead(want, Math.min(look, dist))) {
      heading = null;
      for (const off of [0.4, -0.4, 0.8, -0.8, 1.25, -1.25, 1.8, -1.8]) {
        const o = off * (this.turnBias < 0 ? -1 : 1);
        if (this.clearAhead(want + o, look)) { heading = want + o; break; }
      }
      if (heading === null) { this.reverseT = 1.2; this.turnBias = -this.turnBias; return; }
    }
    const err = wrap(heading - v.yaw);
    c.steer = clamp(-err * 2.4, -1, 1);
    if (v.def.drive === 'tracked') c.throttle = Math.abs(err) > 1.3 ? 0 : clamp(1 - Math.abs(err) / 1.5, 0.2, 1) * Math.min(1, dist / 14);
    else c.throttle = clamp(1 - Math.abs(err) / 2.4, 0.35, 1) * Math.min(1, Math.max(0.35, dist / 14)); // cars and skiffs turn on the move
    // a fixed-forward gun means pointing the whole machine at the enemy
    const lim = v.def.turret?.yawLimit;
    if (lim && this.target?.alive) {
      const te = wrap(Math.atan2(this.target.pos.x - v.pos.x, this.target.pos.z - v.pos.z) - v.yaw);
      if (Math.abs(te) > lim * 0.6) c.steer = clamp(-te * 2.4, -1, 1);
    }
  }

  gun(dt) {
    const v = this.v, c = v.ctrl, w = this.w;
    c.fire = false; c.fire2 = false;
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      // gun forward, a little above the horizon
      c.aimAt = V().set(v.pos.x + Math.sin(v.yaw) * 40, v.pos.y + 2.2, v.pos.z + Math.cos(v.yaw) * 40);
      return;
    }
    const aim = t.center(V());
    if (t.isVehicle) aim.y = t.pos.y + 0.9;
    // lead a moving target a little, and shoot a bit off at long range
    aim.add(this.err || V());
    const d = Math.hypot(t.pos.x - v.pos.x, t.pos.z - v.pos.z);
    aim.y += this.heavy >= 0 ? d * d * 0.00022 : 0; // allow for the shell's drop
    c.aimAt = aim;
    if (!this.seen || (v.aimErr ?? 1) > 0.06) return;
    const key = (i) => (i === 0 ? 'fire' : 'fire2');
    // heavy gun: armour, clumps, and anything at a safe distance; never on top of our own
    if (this.heavy >= 0) {
      let friends = 0;
      for (const f of w.nearUnits(t.pos.x, t.pos.z, 6)) if (f.alive && f.team === v.team) friends++;
      let clump = 0;
      for (const e of w.nearUnits(t.pos.x, t.pos.z, 4)) if (e.alive && hostile(e.team, v.team)) clump++;
      if (!friends && d > 11 && (t.isVehicle || clump >= 2 || d > 30)) c[key(this.heavy)] = true;
    }
    // light gun: soldiers, in bursts
    if (this.light >= 0 && !t.isVehicle && d < v.def.weapons[this.light].range * 0.9) {
      this.burst -= dt;
      if (this.burst > -0.5) c[key(this.light)] = this.burst > 0 || (this.burst = rand(0.5, 1.2), true);
      else this.burst = rand(0.5, 1.0);
    }
  }
}
