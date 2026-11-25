import * as THREE from 'three';
import { height } from './terrain.js';

const V = () => new THREE.Vector3();
const _f = V(), _t = V(), _p = V(), _look = V(), _d = V();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// Follow camera for the free cam. Pick a soldier and the camera glides onto his shoulder.
//   duel  - the camera sits behind him on the line to whoever he is fighting, so both stay in frame
//   chase - plain orbit: the mouse or thumb turns the view around him
// When he dies the camera lingers on the body, then cuts to the soldier who killed him.
export class Spectate {
  constructor(cam, camera, collide) {
    this.cam = cam;
    this.camera = camera;
    this.collide = collide; // (from, dir, maxT) => t
    this.unit = null;
    this.mode = 'duel';
    this.az = 0; // world angle of the line the camera looks along, from the camera to him
    this.dist = 4.6;
    this.off = { yaw: 0, pitch: 0, idle: 9 }; // the viewer's own orbit, added to the automatic view
    this.focus = V();
    this.look = V();
    this.pos = V();
    this.deadT = 0;
    this.killer = null;
    this.cut = 0; // 1 right after a cut, counts down: the card replays its entrance
    this.target = null;
  }

  get active() { return !!this.unit; }

  // the soldiers worth watching, in battle order (squads sit next to each other)
  list(battle, player) {
    return battle.units.filter((u) => u !== player && u.alive && !u.dying);
  }

  follow(u, snap = false) {
    if (!u) return;
    const first = !this.unit;
    this.unit = u;
    this.deadT = 0;
    this.killer = null;
    this.off.yaw = this.off.pitch = 0; this.off.idle = 9;
    this.cut = 1;
    if (first || snap) {
      this.focus.set(u.pos.x, u.pos.y + 1.3, u.pos.z);
      this.az = this.autoAz(u);
    }
    if (snap) this.snapNext = true;
  }

  release() { this.unit = null; this.target = null; this.killer = null; this.deadT = 0; }

  step(battle, player, dir) {
    const l = this.list(battle, player);
    if (!l.length) return null;
    let i = this.unit ? l.indexOf(this.unit) : -1;
    if (i < 0) i = dir > 0 ? -1 : 0;
    const u = l[(i + dir + l.length * 2) % l.length];
    this.follow(u);
    return u;
  }

  // nearest soldier to a point on screen (pixels), from the markers the HUD last drew
  pick(pts, x, y, reach) {
    let best = null, bd = reach * reach;
    for (const p of pts) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p.u; }
    }
    return best;
  }

  // nearest to the camera when nothing is under the crosshair
  nearest(battle, player) {
    const c = this.camera.position;
    let best = null, bd = Infinity;
    for (const u of this.list(battle, player)) {
      const d = u.pos.distanceToSquared(c);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  toggleMode() { this.mode = this.mode === 'duel' ? 'chase' : 'duel'; this.off.yaw = this.off.pitch = 0; return this.mode; }

  nudge(dx, dy) {
    if (!dx && !dy) return;
    this.off.yaw -= dx; this.off.pitch = THREE.MathUtils.clamp(this.off.pitch + dy, -0.7, 0.9);
    this.off.idle = 0;
  }
  zoom(f) { this.dist = THREE.MathUtils.clamp(this.dist * f, 2, 16); }

  // who he is shooting at, if anyone: the AI's current target, while it is alive and in range
  foe(u) {
    const t = u.brain?.target;
    if (!t || !t.alive || t.team === u.team) return null;
    return u.pos.distanceTo(t.pos) < 140 ? t : null;
  }

  autoAz(u) {
    const t = this.foe(u);
    if (t) return Math.atan2(t.pos.x - u.pos.x, t.pos.z - u.pos.z);
    return u.facing;
  }

  // called when anyone dies: if it is the soldier we follow, remember who did it
  onKill(u, from) {
    if (u === this.unit) { this.killer = from && from.alive !== false && from.pos ? from : null; this.deadT = 0.0001; }
  }

  update(dt, battle, player, reduced) {
    const u = this.unit;
    if (!u) { this.target = null; return; }
    const cam = this.cam;
    if (!u.alive) {
      // kill cam: hold on the body, drifting round it, then cut to whoever did it (or the next soldier)
      this.deadT += dt;
      if (this.deadT > 1.7) {
        const next = this.killer && this.killer.alive && !this.killer.isPlayer && battle.units.includes(this.killer) ? this.killer : this.nearestTo(battle, player, u.pos);
        if (!next) { this.release(); return; }
        this.follow(next, true);
      }
    }
    const dead = !u.alive;
    // the point we look at: his chest, smoothed so footsteps don't shake the picture
    _f.set(u.pos.x, u.pos.y + (dead ? 0.5 : u.proneK > 0.5 ? 0.6 : 1.25), u.pos.z);
    if (this.snapNext) this.focus.copy(_f);
    else this.focus.lerp(_f, damp(dead ? 4 : 11, dt));
    const foe = dead ? this.killer : this.foe(u);
    this.target = dead ? null : foe;
    // the viewer's own orbit eases back to the automatic view when they let go (duel only)
    this.off.idle += dt;
    if (this.mode === 'duel' && this.off.idle > 2.5) {
      const k = damp(1.6, dt);
      this.off.yaw -= this.off.yaw * k; this.off.pitch -= this.off.pitch * k;
    }
    let want;
    if (this.mode === 'chase') want = u.facing + this.off.yaw; // camera behind him, turned by the viewer
    else want = (foe ? Math.atan2(foe.pos.x - u.pos.x, foe.pos.z - u.pos.z) : u.facing) + this.off.yaw;
    if (dead && !reduced) want = this.az + dt * 0.35; // slow orbit round the body
    else if (dead) want = this.az;
    this.az += wrap(want - this.az) * (this.snapNext ? 1 : damp(dead ? 3 : 3.4, dt));
    // distance: close on a lone soldier, a little farther when the fight is far so both read
    const sep = foe ? Math.hypot(foe.pos.x - u.pos.x, foe.pos.z - u.pos.z) : 0;
    const dGoal = (this.dist + (this.mode === 'duel' ? Math.min(3.5, sep * 0.05) : 0)) * (dead ? 1.25 : 1);
    this.d = this.d === undefined || this.snapNext ? dGoal : this.d + (dGoal - this.d) * damp(3, dt);
    const el = (this.mode === 'duel' ? 0.2 : 0.16) + this.off.pitch;
    // camera sits behind him along the line to his foe, nudged to the right shoulder so he is not in the way
    const sx = Math.cos(this.az), sz = -Math.sin(this.az); // screen-right of that line
    const side = dead ? 0 : 0.85;
    _p.set(
      this.focus.x - Math.sin(this.az) * Math.cos(el) * this.d + sx * side,
      this.focus.y + Math.sin(el) * this.d + 0.35,
      this.focus.z - Math.cos(this.az) * Math.cos(el) * this.d + sz * side,
    );
    // keep out of walls and the ground
    if (this.collide) {
      _d.subVectors(_p, this.focus);
      const len = _d.length();
      if (len > 0.01) {
        _d.divideScalar(len);
        const t = this.collide(this.focus, _d, len + 0.25);
        if (t < len + 0.25) _p.copy(this.focus).addScaledVector(_d, Math.max(0.8, t - 0.25));
      }
    }
    _p.y = Math.max(_p.y, height(_p.x, _p.z) + 0.7);
    if (this.snapNext) this.pos.copy(_p); else this.pos.lerp(_p, damp(7, dt));
    // where to look: the soldier, leaning toward his foe so the fight sits in the middle of the frame
    _look.copy(this.focus);
    _look.y -= 0.35; // seat him a little high in the frame, clear of the bar
    if (foe && this.mode === 'duel') {
      const fx = foe.pos.x - this.focus.x, fz = foe.pos.z - this.focus.z, l = Math.hypot(fx, fz) || 1;
      const lead = Math.min(l * 0.4, 9);
      _look.x += (fx / l) * lead; _look.z += (fz / l) * lead;
      _look.y += (foe.pos.y + 1.1 - _look.y) * Math.min(0.5, lead / l);
    }
    if (this.snapNext) this.look.copy(_look); else this.look.lerp(_look, damp(7, dt));
    // hand it to the free camera
    _t.subVectors(this.look, this.pos);
    const len = _t.length() || 1;
    cam.fr.copy(this.pos);
    cam.yaw = Math.atan2(-_t.x, -_t.z);
    cam.pitch = Math.asin(THREE.MathUtils.clamp(_t.y / len, -1, 1));
    this.snapNext = false;
    this.cut = Math.max(0, this.cut - dt * 2.2);
  }

  nearestTo(battle, player, p) {
    let best = null, bd = Infinity;
    for (const u of this.list(battle, player)) {
      const d = u.pos.distanceToSquared(p);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
}
