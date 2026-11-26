import { markUnit, markVehicle } from './hitmarks.js';
import { CLASSES } from './classes.js';
import * as THREE from 'three';
import { Unit, RADIUS } from './unit.js';
import { U } from './rig.js';
import { Brain, Squad, Commander } from './ai.js';
import { PROPS, PropBatch, coverSpots } from './props.js';
import { Nav } from './nav.js';
import { Vehicle } from './vehicles.js';
import { VehicleBrain } from './vehicleai.js';
import { CallIns } from './callins.js';
import { Paradrops } from './paradrop.js';
import { projectileModel, WEAPONS } from './weapons.js';
import { hostile, TEAMS } from './factions.js';
import { HALF, pointMarker, ammoCrate } from './world.js';
import { rayBox, pushCircle, segmentHitsBox, corners, segDist, toLocal } from './physics.js';
import { height, rayTerrain, terrainClear, normalAt } from './terrain.js';
import { GRAVITY, MAX_BULLETS, MATERIALS, materialOf, ballistics, leadPoint, zeroAngle, bulletDamage, chord } from './ballistics.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const EDGE = HALF - 0.6;

// Unit types: loadouts for AI soldiers.
export const KINDS = CLASSES;
// squad mixes, one per army
export const SQUAD_MIX = [
  ['rifleman', 'gunner', 'assault', 'rifleman', 'medic', 'assault', 'rifleman', 'coil', 'mortar'],
  ['rifleman', 'gunner', 'gunner', 'assault', 'rifleman', 'medic', 'assault', 'rifleman', 'mortar'],
  ['coil', 'assault', 'rifleman', 'medic', 'coil', 'assault', 'rifleman', 'gunner', 'coil'],
];
export const SQUAD_SIZE = 6;
export const HOLD_WIN = 60; // seconds holding every point

// Uniform grid over the map for neighbour and line queries. Cells are a flat array (no hashing),
// and clear() empties the cells in place, so rebuilding it every frame allocates nothing.
// Anything past the edge is filed in the nearest edge cell, which queries there also check.
class Grid {
  constructor(cell) {
    this.cell = cell;
    this.off = Math.ceil((HALF + 40) / cell); // cells from the middle to the edge
    this.w = this.off * 2 + 1;
    this.cells = Array.from({ length: this.w * this.w }, () => []);
    this.used = [];
  }
  ci(i) { i += this.off; return i < 0 ? 0 : i >= this.w ? this.w - 1 : i; }
  clear() { for (const a of this.used) a.length = 0; this.used.length = 0; }
  push(i, j, item) {
    const a = this.cells[this.ci(i) * this.w + this.ci(j)];
    if (!a.length) this.used.push(a);
    a.push(item);
  }
  insert(item, x, z) { this.push(Math.floor(x / this.cell), Math.floor(z / this.cell), item); }
  insertBox(item, b) {
    const r = Math.hypot(b.hx, b.hz);
    const x0 = Math.floor((b.x - r) / this.cell), x1 = Math.floor((b.x + r) / this.cell);
    const z0 = Math.floor((b.z - r) / this.cell), z1 = Math.floor((b.z + r) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) this.push(i, j, item);
  }
  // items in cells overlapping the square around (x, z)
  near(x, z, r, out = []) {
    out.length = 0;
    const stamp = stampN++;
    const w = this.w, cells = this.cells;
    const x0 = this.ci(Math.floor((x - r) / this.cell)), x1 = this.ci(Math.floor((x + r) / this.cell));
    const z0 = this.ci(Math.floor((z - r) / this.cell)), z1 = this.ci(Math.floor((z + r) / this.cell));
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = cells[i * w + j];
      for (let k = 0; k < a.length; k++) { const it = a[k]; if (it._stamp !== stamp) { it._stamp = stamp; out.push(it); } }
    }
    return out;
  }
  // items in cells along a segment (deduplicated with a stamp)
  along(ax, az, bx, bz, stamp, out = []) {
    out.length = 0;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / this.cell)); // a sample a cell apart, each with its eight neighbours, covers every cell the segment crosses
    const w = this.w, cells = this.cells;
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps;
      const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const k = this.ci(ix + di) * w + this.ci(iz + dj);
        if (k === last) continue;
        const a = cells[k];
        for (let n = 0; n < a.length; n++) { const it = a[n]; if (it._stamp !== stamp) { it._stamp = stamp; out.push(it); } }
      }
      last = this.ci(ix) * w + this.ci(iz);
    }
    return out;
  }
}

let stampN = 1;

// Everything on the field: soldiers, squads, props, projectiles, control points; firing, hits,
// explosions, reinforcements and the rules that connect them.
const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export class Battle {
  constructor(scene, fx, audio) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.units = [];
    this.squads = [];
    this.props = [];
    this.projectiles = [];
    this.bullets = [];
    this.fx.onTink = (p) => this.audio.play('tink', p, 0.5);
    this.points = [];
    this.player = null;
    this.time = 0;
    this.timeScale = 1;
    this.aiFrozen = false;
    this.god = false;
    this.events = [];
    this.unitGrid = new Grid(6);
    this.propGrid = new Grid(8);
    this.tmpA = []; this.tmpB = [];
    this.teams = [];
    this.settings = { teams: 2, size: 40, tickets: 120, mode: 'battle', playerTeam: 0 };
    this.commanders = [];
    this.onHitMarker = null;
    this.onPlayerHurt = null;
    this.onKill = null;
    this.result = null;
    this.reinforce = true;
    this.stats = { shots: 0, kills: 0 };
    this.decor = []; // scenery the map adds (trees)
    this.batch = new PropBatch(scene);
    this.vehicles = [];
    this.vehicleSpawns = [];
    this.nav = new Nav(HALF);
    this.edge = EDGE;
    this.propVer = 0;
    this.navBudget = 0;
    this.callins = new CallIns(this);
    this.drops = new Paradrops(this);
  }

  // a walking route, or null when there is none (grid rebuilt when props changed)
  route(ax, az, bx, bz, squeeze = false) {
    this.nav.build(this.props, this.propVer);
    return this.nav.path(ax, az, bx, bz, squeeze);
  }

  // ---------- setup ----------
  configure(settings) {
    Object.assign(this.settings, settings);
    const n = this.settings.teams;
    this.teams = TEAMS.slice(0, n).map((t, i) => ({
      id: i, tickets: this.settings.tickets, base: baseAt(i, n), spawnT: 0, alive: 0, lost: false, kills: 0, losses: 0, caps: 0,
    }));
    this.commanders = this.teams.map((t) => new Commander(this, t.id));
    this.callins.reset(n);
    this.result = null;
  }

  setPlayer(p) {
    this.player = p;
    this.units.push(p);
  }

  addPoint(name, x, z, r = 8) {
    const m = pointMarker(r);
    const y = height(x, z);
    m.position.set(x, y, z);
    this.scene.add(m);
    const p = { name, pos: new THREE.Vector3(x, y, z), r, owner: -1, capture: 0, capTeam: -1, contested: false, model: m, counts: [0, 0, 0] };
    this.points.push(p);
    this.paintPoint(p);
    // an ammo crate beside the flag: the owning side's soldiers restock from it
    const crate = ammoCrate();
    const ca = Math.atan2(x, z) + 0.9;
    crate.position.set(x + Math.sin(ca) * 2.6, height(x + Math.sin(ca) * 2.6, z + Math.cos(ca) * 2.6), z + Math.cos(ca) * 2.6);
    crate.rotation.y = ca;
    this.scene.add(crate);
    p.crate = crate; p.fed = new Map();
    return p;
  }

  paintPoint(p) {
    const col = p.owner >= 0 ? TEAMS[p.owner].ui : '#d8d8d4';
    p.model.userData.flag.material.color.set(col);
    p.model.userData.ring.material.color.set(col);
  }

  spawnUnit(team, kind, pos, { squad, yaw } = {}) {
    const u = new Unit({ team, loadout: KINDS[kind].loadout, pos, kind });
    u.pos.x = THREE.MathUtils.clamp(u.pos.x, -EDGE, EDGE);
    u.pos.z = THREE.MathUtils.clamp(u.pos.z, -EDGE, EDGE);
    u.pos.y = this.groundAt(u.pos.x, u.pos.z, height(u.pos.x, u.pos.z) + 5);
    u.facing = u.aimYaw = yaw ?? Math.atan2(-pos.x, -pos.z);
    if (!squad) squad = this.freeSquad(team, pos);
    squad.add(u);
    u.squad = squad;
    u.brain = new Brain(u, squad, this);
    this.units.push(u);
    u.animate(0);
    return u;
  }

  // an elite squad (or two) jumps over `at` from a transport that arrives from the army's own side
  callDrop(team, at, count = 6, kind = 'exo') {
    const base = this.teams[team]?.base || baseAt(team, Math.max(2, this.teams.length));
    const dir = new THREE.Vector3(at.x - base.x, 0, at.z - base.z);
    if (dir.lengthSq() < 4) dir.set(0, 0, -1);
    const planes = Math.ceil(count / 6);
    for (let i = 0; i < planes; i++) this.drops.call(team, at, dir, Array.from({ length: Math.min(6, count - i * 6) }, () => kind), { lateral: (i - (planes - 1) / 2) * 34 });
  }

  freeSquad(team, pos) {
    let s = this.squads.find((q) => q.team === team && q.members.length < SQUAD_SIZE && q.alive.length && q.alive[0].pos.distanceTo(pos) < 10);
    if (!s) { s = new Squad(this, team); this.squads.push(s); }
    return s;
  }

  spawnSquad(team, center, kinds, yaw) {
    const squad = new Squad(this, team);
    this.squads.push(squad);
    const f = yaw ?? Math.atan2(-center.x, -center.z);
    kinds.forEach((k, i) => {
      const row = Math.floor((i + 1) / 2), side = i % 2 ? 1 : -1;
      const p = center.clone().add(new THREE.Vector3(
        -Math.sin(f) * row * 1.6 + Math.cos(f) * side * row * 1.4, 0,
        -Math.cos(f) * row * 1.6 - Math.sin(f) * side * row * 1.4));
      this.spawnUnit(team, k, p, { squad, yaw: f });
    });
    return squad;
  }

  spawnProp(type, x, z, yaw = 0) {
    const def = PROPS[type];
    const g = new THREE.Group(); // transform only; drawn by the batch
    g.rotation.y = yaw;
    const p = { type, def, group: g, hp: def.hp, alive: true, box: { x, z, yaw, hx: def.hx, hz: def.hz, h: def.h, y0: 0 }, cover: [] };
    this.seat(p);
    if (!def.noModel) { this.batch.add(p); this.batch.sync(p); }
    this.props.push(p);
    this.propGrid.insertBox(p, p.box);
    this.propVer++;
    this.refreshCover(p);
    return p;
  }

  // stand a prop on the ground: its footing sits at the lowest corner so nothing floats
  seat(p) {
    const b = p.box;
    let y = height(b.x, b.z);
    for (const [cx, cz] of corners(b, 0)) y = Math.min(y, height(cx, cz));
    b.y0 = y - 0.04;
    p.group.position.set(b.x, b.y0, b.z);
    if (p.slot != null) this.batch.sync(p);
  }

  // cover spots for this prop and its neighbours, minus any that ended up inside another prop
  // or off the field
  refreshCover(p) {
    const near = this.propGrid.near(p.box.x, p.box.z, Math.hypot(p.box.hx, p.box.hz) + 4, []);
    for (const q of near) {
      q.cover = coverSpots(q).filter((s) => {
        if (Math.abs(s.x) > EDGE - 0.5 || Math.abs(s.z) > EDGE - 0.5) return false;
        for (const o of near) {
          if (o === q || !o.alive) continue;
          const [lx, lz] = toLocal(o.box, s.x, s.z);
          if (Math.abs(lx) < o.box.hx + RADIUS && Math.abs(lz) < o.box.hz + RADIUS) return false;
        }
        return true;
      });
    }
  }

  rebuildPropGrid() {
    this.propVer++;
    this.propGrid.clear();
    for (const p of this.props) this.propGrid.insertBox(p, p.box);
  }

  moveProp(p, x, z, yaw = p.box.yaw) {
    p.box.x = x; p.box.z = z; p.box.yaw = yaw;
    p.group.rotation.y = yaw;
    this.seat(p);
    for (const s of p.cover) if (s.owner?.brain?.cover === s) s.owner.brain.releaseCover();
    this.rebuildPropGrid();
    this.refreshCover(p);
  }

  removeProp(p) {
    p.alive = false;
    for (const s of p.cover) if (s.owner?.brain?.cover === s) s.owner.brain.releaseCover();
    this.batch.drop(p);
    if (this.clearing) return;
    this.props = this.props.filter((q) => q !== p);
    this.rebuildPropGrid();
    this.refreshCover(p);
  }

  removeUnit(u) {
    if (u === this.player) return;
    u.alive = false;
    u.removed = true;
    u.brain?.releaseCover();
    this.units = this.units.filter((m) => m !== u);
    if (u.squad) u.squad.members = u.squad.members.filter((m) => m !== u);
  }

  clearUnits() {
    for (const u of [...this.units]) if (u !== this.player) this.removeUnit(u);
    this.squads = [];
  }

  clearAll() {
    this.clearUnits();
    this.clearing = true;
    for (const p of [...this.props]) this.removeProp(p);
    this.clearing = false;
    this.props = [];
    this.rebuildPropGrid();
    for (const p of this.projectiles) this.scene.remove(p.model);
    this.projectiles = [];
    for (const b of this.bullets) this.fx.freeTracer(b.tr);
    this.bullets = [];
  }

  dispose() {
    this.clearAll();
    for (const p of this.points) { this.scene.remove(p.model); if (p.crate) this.scene.remove(p.crate); }
    this.points = [];
    for (const d of this.decor) this.scene.remove(d);
    this.decor = [];
    this.batch.clear();
    for (const v of [...this.vehicles]) this.removeVehicle(v);
    this.callins.dispose();
    this.drops.dispose();
  }

  // ---------- queries ----------
  nearUnits(x, z, r) { return this.unitGrid.near(x, z, r, this.tmpA); }

  // standing height at (x, z) for something at height y: the terrain, or the top of a prop
  // it is already above
  groundAt(x, z, y = 0) {
    let g = height(x, z);
    for (const p of this.propGrid.near(x, z, 0.1, this.tmpB)) {
      const b = p.box, top = b.y0 + b.h;
      if (y < top - 0.3) continue;
      const [lx, lz] = toLocal(b, x, z);
      if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) g = Math.max(g, top);
    }
    return g;
  }

  collideBody(u) {
    for (const p of this.propGrid.near(u.pos.x, u.pos.z, 1, this.tmpB)) if (u.pos.y < p.box.y0 + p.box.h - 0.06) pushCircle(u.pos, RADIUS, p.box);
    if (Math.abs(u.pos.x) > EDGE) { u.pos.x = Math.sign(u.pos.x) * EDGE; u.vel.x = 0; }
    if (Math.abs(u.pos.z) > EDGE) { u.pos.z = Math.sign(u.pos.z) * EDGE; u.vel.z = 0; }
  }

  segBlocked(ax, az, bx, bz, r) {
    for (const p of this.propGrid.along(ax, az, bx, bz, stampN++, this.tmpB)) if (segmentHitsBox(ax, az, bx, bz, p.box, r)) return p;
    return null;
  }
  boxCorners(b, r) { return corners(b, r); }

  // Nearest hit along a ray: soldiers, props, the ground.
  raycast(o, d, maxT, { ignore = null, units = true, skip = null } = {}) {
    let best = { t: maxT, point: null };
    if (units) {
      for (const v of this.vehicles) {
        if (v === ignore?.vehicle || v === ignore || (v.deadT > 40)) continue;
        const cx = v.pos.x - o.x, cz = v.pos.z - o.z;
        const along = cx * d.x + (v.pos.y + 1 - o.y) * d.y + cz * d.z;
        if (along < -6 || along > best.t + 6) continue;
        const h = rayBox(o, d, best.t, v.hitBox());
        if (h && h.t < best.t) best = { t: h.t, vehicle: v, normal: h.n };
      }
      for (const u of this.units) {
        if (!u.alive || u === ignore || u.vehicle || (skip && skip.includes(u))) continue;
        // cheap reject: distance from the body centre to the ray
        const cx = u.pos.x - o.x, cy = u.pos.y + 0.55 - o.y, cz = u.pos.z - o.z;
        const along = cx * d.x + cy * d.y + cz * d.z;
        if (along < -1 || along > best.t + 1) continue;
        const px = cx - d.x * along, py = cy - d.y * along, pz = cz - d.z * along;
        if (px * px + py * py + pz * pz > 0.8) continue;
        const h = rayBox(o, d, best.t, u.hitBox());
        if (h && h.t < best.t) best = { t: h.t, unit: u, normal: h.n };
      }
    }
    const ex = o.x + d.x * maxT, ez = o.z + d.z * maxT;
    for (const p of this.propGrid.along(o.x, o.z, ex, ez, stampN++, this.tmpB)) {
      const h = rayBox(o, d, best.t, p.box);
      if (h && h.t < best.t) { best = { t: h.t, prop: p, normal: h.n }; best.unit = undefined; }
    }
    const tg = rayTerrain(o, d, best.t);
    if (tg >= 0 && tg < best.t) best = { t: tg, ground: true, normal: normalAt(o.x + d.x * tg, o.z + d.z * tg) };
    best.point = o.clone().addScaledVector(d, best.t);
    best.hit = !!(best.unit || best.prop || best.ground || best.vehicle);
    return best;
  }

  // Fog of war: an enemy is known only while you or a teammate has clear line of sight to it.
  // Each frame a few observers look around; what they see gets seenAt and a last-known spot.
  updateSight(dt = 1 / 60) {
    const pl = this.player; if (!pl) return;
    const obs = this.sightObs || (this.sightObs = []);
    if (!this.sightI || this.sightI >= obs.length) {
      this.sightI = 0; obs.length = 0;
      for (const u of this.units) if (u.alive && u.team === pl.team && !u.vehicle) obs.push(u);
      for (const v of this.vehicles) if (v.alive && v.team === pl.team) obs.push(v);
    }
    const eye = V(), tc = V(), end = Math.min(obs.length, this.sightI + Math.min(16, Math.max(4, Math.ceil(obs.length * dt / 0.3)))); // the whole side looks round about three times a second, however big the army
    for (; this.sightI < end; this.sightI++) {
      const o = obs[this.sightI];
      if (!o.alive) continue;
      eye.set(o.pos.x, o.pos.y + (o.isVehicle ? 2.6 : 1.6), o.pos.z);
      const face = o.isVehicle ? o.yaw : o.facing, range = o.isVehicle ? 130 : 100;
      for (const list of [this.units, this.vehicles]) for (const e of list) {
        if (!e.alive || e.vehicle || !hostile(e.team, pl.team)) continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
        if (d2 > range * range) continue;
        if (this.time - e.seenAt < 0.2) continue; // a teammate saw it a moment ago: nothing new to learn
        if (d2 > 100 && face !== undefined && Math.abs(wrapAng(Math.atan2(dx, dz) - face)) > 1.6) continue;
        e.center(tc);
        if (!this.los(eye, tc)) continue;
        e.seenAt = this.time;
        (e.lastKnown || (e.lastKnown = new THREE.Vector3())).copy(e.pos);
      }
    }
  }

  // Clear line between two points (props block; soldiers don't).
  los(a, b) {
    const d = V().subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return true;
    d.divideScalar(len);
    for (const p of this.propGrid.along(a.x, a.z, b.x, b.z, stampN++, this.tmpB)) if (rayBox(a, d, len - 0.05, p.box)) return false;
    return terrainClear(a, b);
  }

  friendlyInLine(u, from, to) {
    const len = from.distanceTo(to);
    const c = V();
    const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2;
    for (const m of this.unitGrid.near(mx, mz, Math.min(len / 2 + 1, 30), this.tmpA)) {
      if (m === u || !m.alive || m.team !== u.team) continue;
      m.center(c);
      if (c.distanceTo(from) > len) continue;
      if (segDist(from, to, c) < 0.6) return true;
    }
    return false;
  }

  // ---------- combat ----------
  aimDir(shooter, muzzle) {
    const t = shooter.ctrl.aimAt;
    if (t) return V().subVectors(t, muzzle).normalize();
    return new THREE.Vector3(Math.sin(shooter.aimYaw) * Math.cos(shooter.aimPitch), Math.sin(shooter.aimPitch), Math.cos(shooter.aimYaw) * Math.cos(shooter.aimPitch));
  }

  spread(dir, s) {
    if (s <= 0) return dir;
    const a = V().crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
    const b = V().crossVectors(dir, a);
    const r = s * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
    return dir.clone().addScaledVector(a, r * Math.cos(th)).addScaledVector(b, r * Math.sin(th)).normalize();
  }

  discharge(shooter, def) {
    const m = shooter.muzzle();
    let dir = this.aimDir(shooter, m);
    if (!shooter.isPlayer && shooter.ctrl.aimAt && def.kind === 'hitscan') {
      // AI fires where the gun actually points, with an error that shrinks with time on target
      // and grows when moving, suppressed, hurt or in shock
      const mv = Math.hypot(shooter.vel.x, shooter.vel.z) > 0.5 ? 1 : 0;
      const err = (0.05 * Math.exp(-(shooter.onT || 0) / 1.1) + 0.004) * (1 + mv * 1.5 + shooter.suppression * 2 + (shooter.arm || 0) * 1.5 + (shooter.shock > 0 ? 2 : 0)) * (1 - 0.35 * shooter.kneelK) / (shooter.brain?.skill || 1);
      const g = new THREE.Vector3(Math.sin(shooter.aimYaw) * Math.cos(shooter.aimPitch), Math.sin(shooter.aimPitch), Math.cos(shooter.aimYaw) * Math.cos(shooter.aimPitch));
      // gun direction, corrected so a settled aim still lands on the target (parallax between eye and muzzle)
      // rounds take time to arrive: lead a moving target and aim high for drop
      const tgt = shooter.brain?.target;
      if (def.mv && tgt?.alive && shooter.ctrl.aimAt) dir = V().subVectors(leadPoint(V(), m, shooter.ctrl.aimAt, tgt.vel, def, shooter.brain.skill || 1), m).normalize();
      dir = g.lerp(dir, Math.min(1, (shooter.onT || 0) / 0.6)).normalize();
      dir = this.spread(dir, err);
    }
    const moving = Math.hypot(shooter.vel.x, shooter.vel.z) > 0.5 ? 1 : 0;
    const sm = shooter.mod?.spread ?? 1;
    if (shooter.mod?.dmgOut > 1 && def.damage) def = { ...def, damage: def.damage * shooter.mod.dmgOut, dps: def.dps && def.dps * shooter.mod.dmgOut };
    const steady = sm * (shooter.isPlayer ? (shooter.ads > 0.5 ? 0.45 : 1) : 1);
    // a hot barrel walks the shots: sustained fire opens the group up
    const wp = shooter.weapon, bh = wp && def.hb ? this.barrelHeat(wp) : 0;
    const s = (def.spread || 0) * (1 + bh * 1.1) * steady * (1 + moving * 1.2 + shooter.suppression * 1.5 + (shooter.recoilBuild || 0) * 1.4) * (1 - 0.35 * shooter.kneelK) * (1 + (shooter.arm || 0) * 1.5 + (shooter.shock > 0 ? 2 : 0) + (shooter.leg || 0) * 0.4);
    dir = this.spread(dir, s);
    // the player's sights are zeroed at a set range: rounds start a hair high and fall onto the aim point
    if (def.mv && !shooter.brain && def.zero) dir.addScaledVector(UP, zeroAngle(def)).normalize();
    if (wp && def.hb) wp.barrel = Math.min(1, bh + def.hb);
    this.stats.shots++;
    if (def.kind === 'hitscan') this.hitscan(shooter, m, dir, def);
    else if (def.kind === 'projectile') this.launch(def.proj, m, dir.multiplyScalar(def.speed), shooter, def);
    this.fx.muzzle(m, dir, def.flash || 1, def.id, bh);
    if (def.casing) this.fx.casing(m, dir, def.casing, def.eject || 0.3, def.cdelay || 0);
    if (def.proj === 'shell') this.fx.steam(m, dir.clone().normalize().multiplyScalar(1.5), 4, 0.5);
    this.audio.play(def.sound, m, shooter.isPlayer ? 0.8 : 1);
    this.heard(shooter, m);
  }

  // shots give away the shooter to enemy squads nearby
  heard(shooter, p) {
    for (const s of this.squads) {
      if (!hostile(s.team, shooter.team)) continue;
      const a = s.leader;
      if (a && Math.abs(a.pos.x - p.x) < 35 && Math.abs(a.pos.z - p.z) < 35) s.know(shooter, shooter.pos, false);
    }
  }

  // barrel heat 0..1: cools lazily, so only guns that fire need updating
  barrelHeat(w) {
    const d = this.time - (w.bt ?? this.time);
    w.barrel = Math.max(0, (w.barrel || 0) - d * 0.09);
    w.bt = this.time;
    return w.barrel;
  }

  // A shot leaves the muzzle as a real round: it flies, drops, slows, and is judged against
  // whatever it meets each step (see stepBullet).
  hitscan(shooter, from, dir, def) {
    const bal = ballistics(def);
    const n = (shooter.tcount = (shooter.tcount || 0) + 1);
    const lit = bal.tracerEvery <= 1 || n % bal.tracerEvery === 0;
    const b = {
      def, owner: shooter, pos: from.clone(), vel: dir.clone().multiplyScalar(bal.mv * (1 + (Math.random() - 0.5) * 0.03)),
      mv: bal.mv, drag: bal.drag, fall: bal.fall, power: bal.pow, dmgK: 1, dist: 0, age: 0, ric: 0, skip: [], seen: new Set(),
      tr: lit ? this.fx.takeTracer(def.id === 'mg' ? 0.02 : 0.014) : null,
    };
    if (this.bullets.length >= MAX_BULLETS) this.endBullet(this.bullets.shift());
    this.bullets.push(b);
    if (this.stepBullet(b, 0.006)) this.bullets.pop(), this.endBullet(b);
  }

  endBullet(b) { this.fx.freeTracer(b.tr); b.tr = null; }

  updateBullets(dt) {
    if (!this.bullets.length) return;
    const n = Math.max(1, Math.ceil(dt / 0.034)), h = dt / n;
    let w = 0;
    for (const b of this.bullets) {
      let dead = false;
      for (let i = 0; i < n && !dead; i++) dead = this.stepBullet(b, h);
      if (dead) { this.endBullet(b); continue; }
      if (b.tr) this.fx.placeTracer(b.tr, b.pos, b.vel);
      this.bullets[w++] = b;
    }
    this.bullets.length = w;
  }

  // Moves a round one step and resolves what it meets. Returns true once it is spent.
  stepBullet(b, dt) {
    const v = b.vel, def = b.def;
    b.age += dt;
    v.multiplyScalar(Math.exp(-b.drag * dt));
    v.y -= GRAVITY * dt;
    let sp = v.length();
    if (b.age > 4 || sp < 25 || b.dist > def.range * 1.6) return true;
    const o = b.pos, d = V().copy(v).divideScalar(sp);
    let left = sp * dt;
    for (let it = 0; it < 4 && left > 1e-4; it++) {
      const hit = this.raycast(o, d, left, { ignore: b.age < 0.2 ? b.owner : null, skip: b.skip });
      if (!hit.hit) { o.addScaledVector(d, left); b.dist += left; break; }
      const dmg = bulletDamage(b), n = hit.normal || UP, at = hit.point;
      this.suppress(b.owner, o, at, b.seen);
      this.corpseShots(o, d, hit.t, dmg);
      b.dist += hit.t; left = Math.max(0, left - hit.t);
      o.copy(at);
      const graze = Math.abs(d.dot(n));
      if (hit.vehicle) {
        if (this.canRicochet(b, graze, MATERIALS.steel)) { this.ricochet(b, d, n, at, 'metal'); break; }
        hit.vehicle.hit(dmg * (0.5 + 0.5 * graze), 'bullet', b.owner, this);
        this.fx.impact(at, n, 'metal');
        markVehicle(hit.vehicle, at.clone().addScaledVector(d, -0.3), d, 0.12 + dmg * 0.004);
        return true;
      }
      if (hit.unit) {
        this.damageUnit(hit.unit, dmg, b.owner, 'bullet', d.clone(), at);
        // a strong round goes on through, weaker and slower
        b.power *= 0.45; b.dmgK *= 0.5; v.multiplyScalar(0.8); b.skip.push(hit.unit);
        if (b.power < 0.3) return true;
        sp = v.length(); continue;
      }
      if (hit.prop) {
        const mat = materialOf(hit.prop);
        this.damageProp(hit.prop, dmg * 0.15, b.owner);
        const col = hit.prop.def?.debris;
        if (this.canRicochet(b, graze, mat)) { this.ricochet(b, d, n, at, mat.fx, col); break; }
        const reach = mat.depth * b.power * Math.min(1, sp / b.mv) * (0.75 + Math.random() * 0.5);
        const thick = chord(hit.prop.box, at, d);
        this.fx.impactMat(at, n, mat.fx, col, 1, hit.prop);
        this.audio.play(mat.snd, at, 0.6);
        if (reach < thick) return true; // stopped inside the cover
        const used = thick / reach, exit = at.clone().addScaledVector(d, thick + 0.03);
        const keep = 1 - used * 0.8;
        b.power *= keep; b.dmgK *= keep; v.multiplyScalar(1 - used * 0.4);
        // the round comes out the far side knocked off line
        const k = 0.02 + used * 0.12;
        v.x += (Math.random() - 0.5) * k * sp; v.y += (Math.random() - 0.5) * k * sp; v.z += (Math.random() - 0.5) * k * sp;
        this.fx.impactMat(exit, d.clone().negate(), mat.fx, col, 0.5, hit.prop);
        o.copy(exit); b.dist += thick; left = Math.max(0, left - thick);
        sp = v.length(); d.copy(v).divideScalar(sp);
        if (b.power < 0.15) return true;
        continue;
      }
      // ground: grazing rounds skip off, others dig in
      if (this.canRicochet(b, graze, MATERIALS.earth)) { this.ricochet(b, d, n, at, 'dust'); break; }
      this.fx.impact(at, n, 'dust');
      return true;
    }
    return false;
  }

  canRicochet(b, graze, mat) { return b.ric < 2 && b.power > 0.2 && graze < mat.ric * (0.7 + Math.random() * 0.6); }

  // bounce off a surface: reflected, slowed, scattered, with sparks and a whine
  ricochet(b, d, n, at, style, col) {
    const v = b.vel, sp = v.length();
    d.reflect(n);
    const k = 0.04 + Math.random() * 0.06;
    d.x += (Math.random() - 0.5) * k; d.y += Math.random() * k * 0.5; d.z += (Math.random() - 0.5) * k;
    if (n.y > 0.5 && d.y < 0.02) d.y = 0.02;
    d.normalize();
    v.copy(d).multiplyScalar(sp * (0.4 + Math.random() * 0.25));
    b.pos.copy(at).addScaledVector(n, 0.06);
    b.ric++; b.power *= 0.5; b.dmgK *= 0.55;
    this.fx.ricochet(at, d, style, col);
    this.audio.play('ricochet', at, 0.7);
    return sp;
  }

  suppress(shooter, a, b, seen) {
    const c = V();
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, half = Math.hypot(b.x - a.x, b.z - a.z) / 2 + 2;
    for (const u of this.unitGrid.near(mx, mz, Math.min(half, 40), this.tmpA)) {
      if (!u.alive || u === shooter || !hostile(u.team, shooter.team) || seen?.has(u)) continue;
      u.center(c);
      const d = segDist(a, b, c);
      if (d < 1.8) {
        seen?.add(u);
        u.suppression = Math.min(1, u.suppression + (1.8 - d) * 0.1);
        if (u.isPlayer && d < 1.4) { this.audio.crack(1.4 - d); this.onNearMiss?.(1.4 - d); }
        if (u.squad) u.squad.know(shooter, shooter.pos, false);
      }
    }
  }

  // where on the body a point is: head and torso kill, limbs cripple and bleed
  hitZone(u, pt) {
    if (!pt || (u.proneK || 0) > 0.5) return 'torso';
    const h = (pt.y - u.pos.y) / (U.TOP - (u.kneelK || 0) * U.KNEEL_DROP);
    if (h > 0.8) return 'head';
    if (h < 0.3) return 'leg';
    const lx = (pt.x - u.pos.x) * Math.cos(u.facing) - (pt.z - u.pos.z) * Math.sin(u.facing);
    if (Math.abs(lx) > U.W * 0.36) return 'arm';
    return 'torso';
  }

  damageUnit(u, dmg, from, kind, dir, point) {
    if (!u.alive) return;
    if (u.isPlayer && this.god) return;
    let zone = 'torso';
    if (kind === 'bullet' && point) {
      zone = this.hitZone(u, point);
      dmg *= { head: 2.6, torso: 0.9, arm: 0.6, leg: 0.7 }[zone];
    }
    const c = u.center();
    // sparks only where a round strikes steel: the helmet, or now and then the vest
    if (kind !== 'bullet' || zone === 'head' || Math.random() < 0.25) this.fx.impact(c.clone().addScaledVector(dir || UP, -0.25), dir ? dir.clone().negate() : UP, 'metal');
    this.fx.gore.hit(c, dir, dmg, kind, u, zone);
    if (kind === 'bullet' || kind === 'plasma') markUnit(u, point || c, dir || UP, zone, kind, (kind === "plasma" ? 0.1 : 0.06) + Math.min(0.04, dmg / 1200));
    u.lastHit = { dir: dir ? dir.clone() : null, dmg, kind, t: u.t, zone };
    u.hurt(dmg, from, this, kind, zone);
    if (u.alive && dir && (kind === 'bullet' || kind === 'plasma') && this.fx.gore.level) u.impulse(dir.clone().setY(0).normalize().multiplyScalar(Math.min(1.6, dmg / 50)));
    if (from && from === this.player) this.onHitMarker?.(!u.alive);
    if (u.isPlayer) this.onPlayerHurt?.(dmg, from);
    if (u.squad && from?.pos) u.squad.know(from, from.pos, true);
    if (u.brain) u.brain.hurtBy(from);
  }

  // The dead stay on the field and keep taking punishment: rounds through the body tear more
  // wounds and eventually the corpse comes apart. They never stop a bullet.
  corpseShots(from, dir, maxT, dmg) {
    const c = V(), mx = from.x + dir.x * maxT / 2, mz = from.z + dir.z * maxT / 2;
    for (const u of this.unitGrid.near(mx, mz, Math.min(maxT / 2 + 1, 40), this.tmpA)) {
      if (u.alive || !u.rag || u.removed) continue;
      c.copy(u.rag.body.pos);
      const ax = c.x - from.x, ay = c.y - from.y, az = c.z - from.z;
      const along = ax * dir.x + ay * dir.y + az * dir.z;
      if (along < 0 || along > maxT) continue;
      const px = ax - dir.x * along, py = ay - dir.y * along, pz = az - dir.z * along;
      if (px * px + py * py + pz * pz > 0.2) continue;
      this.hitCorpse(u, dir, dmg, 'bullet');
    }
  }

  hitCorpse(u, dir, dmg, kind, c) {
    c = c || u.rag.body.pos.clone();
    u.corpseHp -= dmg;
    this.fx.gore.hit(c, dir, dmg * 0.8, kind, u);
    if (kind === 'bullet' && dir) markUnit(u, c, dir, 'torso', kind, 0.05);
    this.fx.impact(c, dir ? dir.clone().negate() : UP, 'metal');
    u.rag.kick(dir.clone().setY(0.1).multiplyScalar(Math.min(2.2, dmg / 30)));
    if (u.corpseHp <= 0 || (kind === 'blast' && dmg > 30)) {
      this.fx.gore.dismember(u, kind === 'blast' ? 2 + Math.floor(Math.random() * 3) : 1, kind === 'blast' ? 6 : 3);
      if (u.corpseHp <= 0) u.corpseHp = 35;
    }
  }

  damageProp(p, dmg, from) {
    if (!p.alive || p.hp === Infinity) return;
    p.hp -= dmg;
    const c = new THREE.Vector3(p.box.x, p.box.y0 + p.box.h / 2, p.box.z);
    if (p.hp <= 0) {
      const big = p.box.hx * p.box.hz;
      this.fx.debris(c, p.def.debris, 16 + Math.min(14, Math.round(big * 6)));
      this.fx.dust(c, 6, 1.2);
      this.audio.play('clank', c);
      const { x, z, yaw } = p.box, rubble = p.box.h > 0.6 && !p.def.explodes;
      this.removeProp(p);
      if (rubble) this.spawnProp('rubble', x, z, yaw);
      if (p.def.explodes) { this.explode(c.setY(p.box.y0 + 0.5), 3.4, 110, from, 1); this.fuelFire(c.setY(height(c.x, c.z)), from); }
      return;
    }
    // chips fly on every hit; each lost third cracks the prop: darker, lower, and softer cover
    if (dmg > 8) this.fx.debris(c, p.def.debris, 2);
    p.maxHp ??= p.hp + dmg;
    const stage = Math.min(2, Math.floor((1 - p.hp / p.maxHp) * 3));
    if ((p.stage ?? 0) >= stage) return;
    p.stage = stage;
    this.fx.debris(c, p.def.debris, 8);
    this.fx.dust(c, 4, 0.9);
    this.audio.play('clank', c);
    this.batch.shade(p, 1 - stage * 0.18);
    if (p.box.h > 0.6) {
      p.box.h *= 0.88;
      p.sy = (p.sy ?? 1) * 0.88;
      this.batch.sync(p);
      for (const s of p.cover) if (s.owner?.brain?.cover === s) s.owner.brain.releaseCover();
      this.propVer++;
      this.refreshCover(p);
    }
  }

  launch(type, pos, vel, owner, def) {
    const model = projectileModel(type);
    model.position.copy(pos);
    this.scene.add(model);
    const p = { type, pos: pos.clone(), vel: vel.clone(), owner, team: owner?.team ?? -1, def, t: 0, model, bounces: 0 };
    if (type === 'grenade' || type === 'shell') p.landing = this.predictLanding(pos, vel, def.gravity);
    this.projectiles.push(p);
    return p;
  }

  // where an arcing throw comes down, stepping along the arc until it meets the ground
  predictLanding(pos, vel, g) {
    for (let t = 0.05; t < 6; t += 0.05) {
      const x = pos.x + vel.x * t, z = pos.z + vel.z * t, y = pos.y + vel.y * t - 0.5 * g * t * t;
      const h = height(x, z);
      if (y <= h && (vel.y - g * t) < 0) return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  releaseThrow(u) {
    const hand = V().setFromMatrixPosition(u.poseOut.hands[1]).applyMatrix4(u.world);
    const def = WEAPONS.grenade;
    let vel;
    const target = u.throwAt || (u.brain ? u.ctrl.aimAt : null);
    if (u.brain && target) {
      const D = Math.hypot(target.x - hand.x, target.z - hand.z);
      const T = THREE.MathUtils.clamp(D / 10, 0.6, 1.6);
      vel = new THREE.Vector3((target.x - hand.x) / T, (target.y - hand.y + 0.5 * def.gravity * T * T) / T, (target.z - hand.z) / T);
    } else {
      const dir = new THREE.Vector3(Math.sin(u.aimYaw) * Math.cos(u.aimPitch), Math.sin(u.aimPitch) + 0.3, Math.cos(u.aimYaw) * Math.cos(u.aimPitch)).normalize();
      vel = dir.multiplyScalar(def.speed * 1.25).add(u.vel);
    }
    const p = this.launch('grenade', hand, vel, u, def);
    p.fuse = def.fuse;
  }

  // How much of a blast gets through whatever stands between the centre and a point:
  // each prop on the line soaks pressure by its material and thickness.
  blastShield(from, to) {
    const d = V().subVectors(to, from), len = d.length();
    if (len < 0.2) return 1;
    d.divideScalar(len);
    let k = 1;
    const e = V();
    for (const p of this.propGrid.along(from.x, from.z, to.x, to.z, stampN++, this.tmpB)) {
      const h = rayBox(from, d, len, p.box);
      if (!h) continue;
      k *= Math.exp(-chord(p.box, e.copy(from).addScaledVector(d, h.t), d) * materialOf(p).absorb * 0.5);
    }
    return Math.max(0.06, k);
  }

  explode(pos, r, dmg, owner, pierce = 1) {
    void pierce;
    this.fx.explosion(pos, r);
    this.audio.play('boom', pos, Math.min(1.4, 0.75 + r * 0.18));
    this.onBlast?.(pos, r);
    this.events.push({ type: 'boom', pos: pos.clone(), r });
    const c = V();
    const from = pos.clone().setY(Math.max(pos.y, height(pos.x, pos.z) + 0.3));
    const team = owner?.team ?? -1;
    const R = r * 1.2; // overpressure reaches a little past the nominal radius, thinning fast
    for (const u of [...this.unitGrid.near(pos.x, pos.z, r * 2.2, this.tmpA)]) {
      if (team >= 0 && u.team === team && u !== owner) continue; // no friendly blast damage
      u.center(c);
      const d = c.distanceTo(pos);
      if (d > r * 2.2) continue;
      const shield = d < 0.6 ? 1 : this.blastShield(from, c);
      const soft = 0.35 + 0.65 * shield;
      if (u.alive) { u.suppression = Math.min(1, u.suppression + 0.6 * (1 - d / (r * 2.2)) * soft); u.squad?.know(owner, pos, true); }
      // shell shock: a close blast leaves a soldier deaf, dazed and cowering
      if (u.alive && d < r * 1.6) {
        const sh = (2.5 + 5 * (1 - d / (r * 1.6))) * soft;
        if (u.shock < sh) { u.shock = sh; if (u.isPlayer) { this.onShock?.(sh); } else if (!u.isPlayer) this.audio.play('moan', c, 0.6); }
      }
      if (d > R) continue;
      const k = Math.min(1, 1.1 * Math.pow(1 - d / R, 1.15)) * shield;
      const push = V().subVectors(c, pos).setY(0);
      if (push.lengthSq() < 1e-4) push.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      push.normalize().multiplyScalar(6.5 * k).add(new THREE.Vector3(0, 3.8 * k, 0));
      if (u.alive) this.damageUnit(u, dmg * k, owner, 'blast', push.clone().normalize());
      else if (u.rag) this.hitCorpse(u, push.clone().normalize(), dmg * k, 'blast', c.clone());
      if (!(u.isPlayer && this.god)) u.impulse(push);
    }
    this.shrapnel(from, r, team, owner, dmg);
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const dx = Math.abs(pos.x - v.pos.x), dz = Math.abs(pos.z - v.pos.z);
      const d = Math.hypot(Math.max(0, dx - v.def.hx), Math.max(0, dz - v.def.hz));
      if (d < r && pos.y < v.pos.y + v.def.h + 1.5) {
        if (team >= 0 && v.team === team && owner?.vehicle !== v) continue; // no friendly blast damage
        v.hit(dmg * Math.pow(1 - d / r, 0.9), 'blast', owner, this);
      }
    }
    for (const p of [...this.propGrid.near(pos.x, pos.z, r + 2, this.tmpB)]) {
      const d = Math.hypot(p.box.x - pos.x, p.box.z - pos.z) - Math.max(p.box.hx, p.box.hz) * 0.6;
      if (d < r) this.damageProp(p, dmg * 1.2 * (1 - Math.max(0, d) / r), owner);
    }
  }

  // burning fuel from a ruptured drum: a flame pool that lights anyone standing in it
  fuelFire(pos, owner) {
    this.fx.fuelFire(pos);
    const c = V();
    for (const u of this.unitGrid.near(pos.x, pos.z, 3.2, this.tmpA)) {
      if (!u.alive || u.center(c).distanceTo(pos) > 2.6) continue;
      u.burn = Math.max(u.burn || 0, 3.5); u.burnBy = owner;
    }
  }

  // Fragments fly out in all directions. Each is a fast sliver that fades with range; cover
  // stops it, soldiers in the open don't.
  shrapnel(from, r, team, owner, dmg) {
    const n = Math.max(14, Math.min(34, Math.round(r * 9))), d = V(), seen = new Set();
    const base = Math.min(55, 10 + dmg * 0.14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() * 0.55 - 0.06) * Math.PI / 2;
      d.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
      const range = r * 4.5;
      const hit = this.raycast(from, d, range, {});
      if (i % 2 === 0) this.fx.fragTrail(from, d, hit.t);
      if (i % 3 === 0) this.suppress(owner || { team }, from, hit.point, seen);
      const fd = base / (1 + hit.t / (r * 1.4));
      if (hit.unit) {
        if (team >= 0 && hit.unit.team === team && hit.unit !== owner) continue;
        this.damageUnit(hit.unit, fd, owner, 'bullet', d.clone(), hit.point);
      } else if (hit.vehicle) {
        this.fx.impact(hit.point, hit.normal, 'metal');
      } else if (hit.prop) {
        this.damageProp(hit.prop, fd * 0.2, owner);
        if (i % 2 === 0) this.fx.impactMat(hit.point, hit.normal, materialOf(hit.prop).fx, hit.prop.def?.debris, 0.6, hit.prop);
      } else if (hit.ground && i % 3 === 0) this.fx.impact(hit.point, hit.normal, 'dust');
    }
    for (const u of this.unitGrid.near(from.x, from.z, r * 2, this.tmpA)) if (!u.alive && u.rag && !u.removed && Math.random() < 0.25) {
      const c = u.rag.body.pos, dx = c.x - from.x, dz = c.z - from.z, dd = Math.hypot(dx, dz);
      if (dd < r * 2) this.hitCorpse(u, V().set(dx, 0.2, dz).normalize(), 20, 'bullet');
    }
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const p of this.projectiles) {
      p.t += dt;
      const g = p.def.gravity || 0;
      const prev = p.pos.clone();
      p.vel.y -= g * dt;
      p.pos.addScaledVector(p.vel, dt);
      const step = V().subVectors(p.pos, prev);
      const len = step.length();
      let done = false;
      if (len > 1e-6) {
        const dir = step.clone().divideScalar(len);
        const hit = this.raycast(prev, dir, len, { ignore: p.t < 0.15 ? p.owner : null });
        if (hit.hit) {
          if (p.type === 'grenade') {
            const n = hit.normal || UP;
            p.pos.copy(hit.point).addScaledVector(n, 0.04);
            p.vel.reflect(n).multiplyScalar(0.35);
            if (n.y > 0.7 && Math.abs(p.vel.y) < 1) { p.vel.y = 0; p.rolling = true; }
            if (p.bounces++ < 4) this.audio.play('clink', p.pos);
          } else {
            p.pos.copy(hit.point);
            this.impact(p, hit, dir);
            done = true;
          }
        }
      }
      if (p.rolling) {
        p.vel.x *= Math.exp(-3 * dt); p.vel.z *= Math.exp(-3 * dt);
        const gy = this.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.1);
        if (p.pos.y <= gy + 0.04) { p.pos.y = gy + 0.04; p.vel.y = 0; } else p.rolling = false;
      }
      if (p.type === 'plasma') this.fx.plasmaTrail(p.pos);
      if (p.type === 'shell' && Math.random() < 0.6) this.fx.steam(p.pos, new THREE.Vector3(0, 0.2, 0), 1, 0.25);
      if (p.type === 'grenade') {
        p.fuse -= dt;
        p.landing = p.pos.clone().setY(height(p.pos.x, p.pos.z));
        if (p.fuse <= 0) { this.explode(p.pos.clone().setY(Math.max(0.15, p.pos.y)), p.def.radius, p.def.damage, p.owner, p.def.pierce); done = true; }
      }
      if (p.t > 8 || p.pos.y < -5 || Math.abs(p.pos.x) > HALF + 20 || Math.abs(p.pos.z) > HALF + 20) done = true;
      if (done) { this.scene.remove(p.model); continue; }
      p.model.position.copy(p.pos);
      if (p.vel.lengthSq() > 0.01) p.model.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.vel.clone().normalize());
      keep.push(p);
    }
    this.projectiles = keep;
  }

  impact(p, hit, dir) {
    const def = p.def;
    if (p.type === 'plasma') {
      this.fx.plasmaBurst(hit.point, def.radius);
      this.audio.play('zap', hit.point, 0.7);
      if (hit.vehicle) hit.vehicle.hit(def.damage, 'plasma', p.owner, this);
      if (hit.unit) this.damageUnit(hit.unit, def.damage, p.owner, 'plasma', dir);
      if (hit.prop) this.damageProp(hit.prop, def.damage * 0.5, p.owner);
      const c = V();
      for (const u of this.unitGrid.near(hit.point.x, hit.point.z, def.radius + 1, this.tmpA)) {
        if (!u.alive || u === hit.unit || u.team === p.team) continue;
        const d = u.center(c).distanceTo(hit.point);
        if (d < def.radius) this.damageUnit(u, def.splash * (1 - d / def.radius), p.owner, 'plasma', dir);
      }
      this.suppress(p.owner || { team: p.team }, hit.point.clone().sub(dir), hit.point);
    } else {
      this.explode(hit.point.clone().addScaledVector(hit.normal || UP, 0.15), def.radius, def.damage, p.owner, def.pierce);
    }
  }

  // a medic gets a fallen soldier back on their feet
  revive(u) {
    u.alive = true; u.dying = false; u.dyK = 0; u.clutch = 0; u.rag = null; u.hp = 45; u.deadT = 0; u.vel.set(0, 0, 0); u.suppression = 0; u.burn = 0; u.flinch = 0;
    u.wound = 0; u.lost = 0; u.wounds = null; u.marks = null; u.bleed = 0; u.leg = 0; u.arm = 0; u.down = false; u.shock = 0; u.stagger = 0; u.corpseHp = 70;
    u.onRevive?.();
    this.events.push({ type: 'revive', unit: u });
  }

  onDeath(u, from) {
    const c = u.center();
    this.fx.impact(c, UP, 'metal');
    const k = u.lastHit?.kind;
    if (k === 'blast' || k === 'fire' || k === 'plasma' || u.burn > 0) this.fx.smoulder(() => (u.rag ? u.rag.body.pos.clone() : u.center()), k === 'fire' || u.burn > 0 ? 5 : 3);
    this.fx.gore.death(u, k, this);
    this.events.push({ type: 'death', unit: u, from });
    this.stats.kills++;
    const tu = this.teams[u.team], tf = from && from.team !== undefined && from.team !== u.team ? this.teams[from.team] : null;
    if (tu) tu.losses++;
    if (tf) tf.kills++;
    u.brain?.releaseCover();
    this.onKill?.(u, from);
  }

  // ---------- vehicles ----------
  addVehicle(kind, team, x, z, yaw = 0, { crew = false } = {}) {
    const v = new Vehicle(kind, team, x, z, yaw);
    this.scene.add(v.group);
    this.vehicles.push(v);
    if (crew) {
      const u = new Unit({ team, loadout: ['rifle'], kind: 'rifleman' });
      u.vehicle = v; u.seat = 0; u.pos.copy(v.pos);
      v.crew.push(u);
      v.brain = new VehicleBrain(v, this);
    }
    return v;
  }
  removeVehicle(v) {
    v.dispose(this.scene);
    this.vehicles = this.vehicles.filter((q) => q !== v);
    for (const u of v.seats) if (u && u.vehicle === v) { u.vehicle = null; }
  }
  // wrecks burn out and vanish; destroyed striders are replaced at the base after a while
  updateVehicles(dt) {
    for (const v of [...this.vehicles]) {
      if (!v.alive && v.deadT > 50) this.removeVehicle(v);
      // keep seated soldiers with their vehicle
      for (const u of v.seats) if (u) { u.pos.copy(v.pos); u.vel.set(0, 0, 0); }
    }
    for (const t of this.teams) {
      if (!t.vehicleQ?.length) continue;
      for (const q of t.vehicleQ) q.t -= dt;
      const due = t.vehicleQ.find((q) => q.t <= 0);
      if (due && this.settings.mode === 'battle' && this.reinforce) { t.vehicleQ = t.vehicleQ.filter((q) => q !== due); this.spawnTeamVehicle(t, true, due.slot, due.kind); }
    }
  }
  spawnTeamVehicle(t, crew = true, slot = 0, kind = 'walker') {
    const f = Math.atan2(-t.base.x, -t.base.z);
    // pads in a row either side of the base: slots 0 and 1 are the near pair, 2 and 3 the next pair out
    const k = 14 + 14 * (slot >> 1), dir = slot & 1 ? -1 : 1;
    const side = Math.cos(f) * dir, sz = -Math.sin(f) * dir;
    const at = { x: t.base.x + side * k + Math.sin(f) * 6, z: t.base.z + sz * k + Math.cos(f) * 6 };
    const v = this.addVehicle(kind, t.id, at.x, at.z, f, { crew });
    v.fromBase = true; v.slot = slot;
    return v;
  }
  onVehicleDestroyed(v) {
    const t = this.teams[v.team];
    if (!t) return;
    if (this.settings.mode === 'battle') t.tickets = Math.max(0, t.tickets - 4);
    if (v.fromBase) (t.vehicleQ ||= []).push({ kind: v.kind, slot: v.slot, t: 50 });
    this.events.push({ type: 'vehicle', vehicle: v });
  }

  // ---------- control points and reinforcements ----------
  // soldiers of the owning side standing at a point's crate refill their pouches (once a minute each)
  restock(p) {
    const c = p.crate.position;
    for (const u of this.unitGrid.near(c.x, c.z, 3.5, this.tmpA)) {
      if (!u.alive || u.team !== p.owner || u.vehicle || Math.hypot(u.pos.x - c.x, u.pos.z - c.z) > 3) continue;
      if (this.time < (p.fed.get(u) || 0)) continue;
      let need = false;
      for (const w of u.weapons) if (!w.inf && w.def.reserve && w.reserve < w.def.reserve) need = true;
      if (!need) continue;
      p.fed.set(u, this.time + 45);
      for (const w of u.weapons) if (!w.inf && w.def.reserve) w.reserve = w.def.reserve;
      this.audio.play('reload', u.pos, 0.6);
      if (u.isPlayer) this.events.push({ type: 'resupply' });
    }
  }

  // nearest friendly-owned crate, for soldiers who have run dry
  nearestCrate(team, pos) {
    let best = null, bd = Infinity;
    for (const p of this.points) {
      if (p.owner !== team || !p.crate) continue;
      const d = (p.crate.position.x - pos.x) ** 2 + (p.crate.position.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = p.crate.position; }
    }
    return best;
  }

  updatePoints(dt) {
    const n = this.teams.length;
    for (const p of this.points) {
      if (p.owner >= 0 && p.crate) this.restock(p);
      p.counts.fill(0);
      for (const u of this.unitGrid.near(p.pos.x, p.pos.z, p.r, this.tmpA)) {
        if (!u.alive) continue;
        if ((u.pos.x - p.pos.x) ** 2 + (u.pos.z - p.pos.z) ** 2 < p.r * p.r) p.counts[u.team]++;
      }
      for (const v of this.vehicles) if (v.alive && v.occupied && (v.pos.x - p.pos.x) ** 2 + (v.pos.z - p.pos.z) ** 2 < p.r * p.r) p.counts[v.team] += 2;
      let top = -1, topN = 0, second = 0;
      for (let t = 0; t < n; t++) {
        if (p.counts[t] > topN) { second = topN; topN = p.counts[t]; top = t; } else if (p.counts[t] > second) second = p.counts[t];
      }
      p.contested = topN > 0 && second > 0;
      if (topN > second) {
        const rate = Math.min(3, topN - second) * 0.09 * dt;
        if (p.owner === top) p.capture = Math.min(1, p.capture + rate);
        else if (p.capTeam === top || p.capture <= 0) {
          p.capTeam = top;
          p.capture += rate;
          if (p.capture >= 1) {
            p.owner = top; p.capture = 1; if (this.teams[top]) this.teams[top].caps++;
            this.paintPoint(p);
            this.events.push({ type: 'capture', point: p, team: top });
          }
        } else {
          p.capture -= rate;
          if (p.capture <= 0) {
            p.capture = 0;
            if (p.owner >= 0) { p.owner = -1; this.paintPoint(p); this.events.push({ type: 'neutral', point: p }); }
            p.capTeam = top;
          }
        }
      }
    }
  }

  // spawn spots: home base, or a held point that isn't under fire
  spawnSpot(team) {
    const T = this.teams[team];
    const held = this.points.filter((p) => p.owner === team && !p.contested);
    if (held.length && Math.random() < 0.6) {
      // the held point nearest the enemy keeps the fight moving
      let best = held[0], bd = Infinity;
      for (const p of held) {
        const d = this.nearestEnemyBaseDist(team, p.pos);
        if (d < bd) { bd = d; best = p; }
      }
      // behind the point, away from the enemy, spread out
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
      const home = this.teams[team].base;
      const back = new THREE.Vector3().subVectors(home, best.pos).setY(0).normalize().multiplyScalar(8);
      return best.pos.clone().add(back).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 8;
    return T.base.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }

  nearestEnemyBaseDist(team, pos) {
    let bd = Infinity;
    for (const t of this.teams) if (t.id !== team) bd = Math.min(bd, t.base.distanceTo(pos));
    return bd;
  }

  updateTeams(dt) {
    if (!this.teams.length) return;
    for (const t of this.teams) t.alive = 0;
    for (const u of this.units) if (u.alive && this.teams[u.team]) this.teams[u.team].alive++;
    if (this.settings.mode !== 'battle') return;
    const size = this.settings.size;
    for (const t of this.teams) {
      t.spawnT -= dt;
      if (t.lost || !this.reinforce || t.spawnT > 0) continue;
      const missing = size - t.alive;
      if (missing >= 3 && t.tickets > 0) {
        const n = Math.min(SQUAD_SIZE, missing, t.tickets);
        const at = this.spawnSpot(t.id);
        const mix = SQUAD_MIX[t.id];
        const off = Math.floor(Math.random() * mix.length);
        const kinds = Array.from({ length: n }, (_, i) => mix[(off + i) % mix.length]);
        this.spawnSquad(t.id, at, kinds);
        t.tickets -= n;
        t.spawnT = 2.5;
      }
    }
    // ticket bleed: armies holding fewer points than the leader lose tickets over time
    this.bleedT = (this.bleedT || 0) + dt;
    if (this.bleedT > 5) {
      this.bleedT = 0;
      const held = this.teams.map((t) => this.points.filter((p) => p.owner === t.id).length);
      const most = Math.max(...held);
      for (const t of this.teams) if (held[t.id] < most && t.tickets > 0) t.tickets = Math.max(0, t.tickets - (most - held[t.id]));
    }
    for (const t of this.teams) if (!t.lost && t.tickets <= 0 && t.alive === 0) t.lost = true;
    // domination: one army holding every point for HOLD_WIN seconds wins the match
    const all = this.points.length > 1 && this.points.every((p) => p.owner === this.points[0].owner && p.owner >= 0 && !p.contested);
    const holder = all ? this.points[0].owner : -1;
    if (holder !== this.holder) { this.holder = holder; this.holdT = 0; }
    this.holdT = holder >= 0 ? (this.holdT || 0) + dt : 0;
    const standing = this.teams.filter((t) => !t.lost);
    if (!this.result && standing.length <= 1 && this.time > 3) this.result = { winner: standing[0]?.id ?? -1, time: this.time, why: 'tickets' };
    if (!this.result && holder >= 0 && this.holdT >= HOLD_WIN) this.result = { winner: holder, time: this.time, why: 'points' };
  }

  // ---------- frame ----------
  update(rawDt) {
    const dt = rawDt * this.timeScale;
    this.time += dt;
    // spatial grid for this frame
    this.unitGrid.clear();
    for (const u of this.units) if (u.alive && !u.vehicle) this.unitGrid.insert(u, u.pos.x, u.pos.z);
    this.navBudget = 3; // routes worked out per tick, so a crowd re-routing at once doesn't stall a frame
    if (!this.aiFrozen) {
      for (const c of this.commanders) c.update(dt);
      for (const s of this.squads) s.update(dt);
      for (const u of this.units) if (u !== this.player && u.brain && u.alive && !u.vehicle && !u.drop) u.brain.update(dt);
      for (const v of this.vehicles) v.brain?.update(dt);
    }
    for (const v of this.vehicles) v.update(dt, this);
    this.updateVehicles(dt);
    for (const u of this.units) if (u !== this.player && !u.vehicle) {
      if (this.aiFrozen && u.alive) { u.animate(0); continue; }
      u.update(dt, this);
    }
    // soldiers don't overlap
    for (const a of this.units) {
      if (!a.alive) continue;
      for (const b of this.unitGrid.near(a.pos.x, a.pos.z, 1, this.tmpA)) {
        if (b === a || b.id < a.id || !b.alive || Math.abs(a.pos.y - b.pos.y) > 0.8) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz, min = RADIUS * 1.9;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2), k = (min - d) / d * 0.5;
          if (a !== this.player) { a.pos.x -= dx * k; a.pos.z -= dz * k; }
          if (b !== this.player) { b.pos.x += dx * k; b.pos.z += dz * k; }
        }
      }
    }
    this.updateSight(dt);
    this.updateProjectiles(dt);
    this.updateBullets(dt);
    this.callins.update(dt);
    this.drops.update(dt);
    this.updatePoints(dt);
    this.updateTeams(dt);
    {
      // the dead are left where they fell; only the oldest go once there are too many
      const dead = this.units.filter((u) => !u.alive && u !== this.player);
      dead.sort((a, b) => b.deadT - a.deadT);
      for (let i = 0; i < dead.length; i++) if (dead[i].deadT > 240 || i < dead.length - 36) this.removeUnit(dead[i]);
    }
    this.squads = this.squads.filter((s) => s.members.length);
    this.fx.update(dt);
    return dt;
  }

  counts() {
    const n = TEAMS.map(() => 0);
    for (const u of this.units) if (u.alive) n[u.team]++;
    return n;
  }
}

export function baseAt(i, n) {
  const R = HALF - 14;
  if (n === 2) return new THREE.Vector3(0, 0, i === 0 ? R : -R);
  const a = Math.PI / 2 + (i * Math.PI * 2) / n;
  return new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
}

export { U };
