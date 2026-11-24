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
import { projectileModel, WEAPONS } from './weapons.js';
import { hostile, TEAMS } from './factions.js';
import { HALF, pointMarker } from './world.js';
import { rayBox, pushCircle, segmentHitsBox, corners, segDist, toLocal } from './physics.js';
import { height, rayTerrain, terrainClear, normalAt } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const EDGE = HALF - 0.6;

// Unit types: loadouts for AI soldiers.
export const KINDS = CLASSES;
// squad mixes, one per army
export const SQUAD_MIX = [
  ['rifleman', 'gunner', 'assault', 'rifleman', 'medic', 'assault', 'rifleman', 'coil', 'mortar'],
  ['rifleman', 'gunner', 'gunner', 'assault', 'rifleman', 'medic', 'flamer', 'rifleman', 'mortar'],
  ['coil', 'flamer', 'rifleman', 'medic', 'coil', 'assault', 'rifleman', 'gunner', 'coil'],
];
export const SQUAD_SIZE = 6;
export const HOLD_WIN = 60; // seconds holding every point

// Uniform grid over the map for neighbour and line queries.
class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(ix, iz) { return ix * 4096 + iz; }
  clear() { this.map.clear(); }
  insert(item, x, z) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(item);
  }
  insertBox(item, b) {
    const r = Math.hypot(b.hx, b.hz);
    const x0 = Math.floor((b.x - r) / this.cell), x1 = Math.floor((b.x + r) / this.cell);
    const z0 = Math.floor((b.z - r) / this.cell), z1 = Math.floor((b.z + r) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = this.key(i, j);
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(item);
    }
  }
  // items in cells overlapping the square around (x, z)
  near(x, z, r, out = []) {
    out.length = 0;
    const stamp = stampN++;
    const x0 = Math.floor((x - r) / this.cell), x1 = Math.floor((x + r) / this.cell);
    const z0 = Math.floor((z - r) / this.cell), z1 = Math.floor((z + r) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = this.map.get(this.key(i, j));
      if (a) for (const it of a) if (it._stamp !== stamp) { it._stamp = stamp; out.push(it); }
    }
    return out;
  }
  // items in cells along a segment (deduplicated with a stamp)
  along(ax, az, bx, bz, stamp, out = []) {
    out.length = 0;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps;
      const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const k = this.key(ix + di, iz + dj);
        if (k === last) continue;
        const a = this.map.get(k);
        if (a) for (const it of a) if (it._stamp !== stamp) { it._stamp = stamp; out.push(it); }
      }
      last = this.key(ix, iz);
    }
    return out;
  }
}

let stampN = 1;

// Everything on the field: soldiers, squads, props, projectiles, control points; firing, hits,
// explosions, reinforcements and the rules that connect them.
export class Battle {
  constructor(scene, fx, audio) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.units = [];
    this.squads = [];
    this.props = [];
    this.projectiles = [];
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
  }

  dispose() {
    this.clearAll();
    for (const p of this.points) this.scene.remove(p.model);
    this.points = [];
    for (const d of this.decor) this.scene.remove(d);
    this.decor = [];
    this.batch.clear();
    for (const v of [...this.vehicles]) this.removeVehicle(v);
    this.callins.dispose();
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
  raycast(o, d, maxT, { ignore = null, units = true } = {}) {
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
        if (!u.alive || u === ignore || u.vehicle) continue;
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
    const moving = Math.hypot(shooter.vel.x, shooter.vel.z) > 0.5 ? 1 : 0;
    const sm = shooter.mod?.spread ?? 1;
    if (shooter.mod?.dmgOut > 1 && def.damage) def = { ...def, damage: def.damage * shooter.mod.dmgOut, dps: def.dps && def.dps * shooter.mod.dmgOut };
    const steady = sm * (shooter.isPlayer ? (shooter.ads > 0.5 ? 0.45 : 1) : 1);
    const s = (def.spread || 0) * steady * (1 + moving * 1.2 + shooter.suppression * 1.5) * (1 - 0.35 * shooter.kneelK);
    dir = this.spread(dir, s);
    this.stats.shots++;
    if (def.kind === 'hitscan') this.hitscan(shooter, m, dir, def);
    else if (def.kind === 'projectile') this.launch(def.proj, m, dir.multiplyScalar(def.speed), shooter, def);
    else if (def.kind === 'flame') this.flame(shooter, m, dir, def);
    if (def.kind !== 'flame') this.fx.muzzle(m, dir, def.id === 'mg' ? 1.3 : 1);
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

  hitscan(shooter, from, dir, def) {
    const hit = this.raycast(from, dir, def.range, { ignore: shooter });
    const end = hit.point;
    this.fx.tracer(from.clone().addScaledVector(dir, 0.15), end, def.id === 'mg' ? 0.02 : 0.014);
    this.suppress(shooter, from, end);
    if (hit.vehicle) { hit.vehicle.hit(def.damage, 'bullet', shooter, this); this.fx.impact(end, hit.normal, 'metal'); }
    else if (hit.unit) this.damageUnit(hit.unit, def.damage, shooter, 'bullet', dir);
    else if (hit.prop) { this.damageProp(hit.prop, def.damage * 0.15, shooter); this.fx.impact(end, hit.normal, hit.prop.type === 'wall' || hit.prop.type === 'drum' || hit.prop.type === 'trap' ? 'metalhole' : 'dust'); }
    else if (hit.ground) this.fx.impact(end, hit.normal, 'dust');
  }

  suppress(shooter, a, b) {
    const c = V();
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, half = Math.hypot(b.x - a.x, b.z - a.z) / 2 + 2;
    for (const u of this.unitGrid.near(mx, mz, Math.min(half, 40), this.tmpA)) {
      if (!u.alive || u === shooter || !hostile(u.team, shooter.team)) continue;
      u.center(c);
      const d = segDist(a, b, c);
      if (d < 1.8) {
        u.suppression = Math.min(1, u.suppression + (1.8 - d) * 0.1);
        if (u.isPlayer && d < 1.4) { this.audio.crack(1.4 - d); this.onNearMiss?.(1.4 - d); }
        if (u.squad) u.squad.know(shooter, shooter.pos, false);
      }
    }
  }

  damageUnit(u, dmg, from, kind, dir) {
    if (!u.alive) return;
    if (u.isPlayer && this.god) return;
    const c = u.center();
    this.fx.impact(c.clone().addScaledVector(dir || UP, -0.25), dir ? dir.clone().negate() : UP, 'metal');
    if (Math.random() < 0.5) this.fx.debris(c, TEAMS[u.team].body, 2);
    this.fx.gore.hit(c, dir, dmg, kind, u);
    u.lastHit = { dir: dir ? dir.clone() : null, dmg, kind, t: u.t };
    u.hurt(dmg, from, this, kind);
    if (u.alive && dir && (kind === 'bullet' || kind === 'plasma') && this.fx.gore.level) u.impulse(dir.clone().setY(0).normalize().multiplyScalar(Math.min(2.4, dmg / 35)));
    if (from && from === this.player) this.onHitMarker?.(!u.alive);
    if (u.isPlayer) this.onPlayerHurt?.(dmg, from);
    if (u.squad && from?.pos) u.squad.know(from, from.pos, true);
    if (u.brain) u.brain.hurtBy(from);
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
      if (p.def.explodes) this.explode(c.setY(p.box.y0 + 0.5), 3.4, 110, from, 1);
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

  flame(shooter, from, dir, def) {
    for (let i = 0; i < 3; i++) {
      const v = this.spread(dir, 0.12).multiplyScalar(8 + Math.random() * 3);
      this.fx.flame(from.clone().addScaledVector(dir, 0.1 + i * 0.12), v.add(shooter.vel));
    }
    const dmg = def.dps * def.interval;
    const c = V();
    for (const u of this.unitGrid.near(from.x, from.z, def.range + 1, this.tmpA)) {
      if (!u.alive || u === shooter || u.team === shooter.team) continue;
      u.center(c);
      const v = c.clone().sub(from);
      const along = v.dot(dir);
      if (along < 0 || along > def.range) continue;
      const perp = v.addScaledVector(dir, -along).length();
      if (perp > 0.5 + along * 0.16) continue;
      if (!this.los(from, c)) continue;
      this.damageUnit(u, dmg, shooter, 'fire', dir);
      u.burn = Math.max(u.burn, 2.8);
      u.burnBy = shooter;
      u.suppression = Math.min(1, u.suppression + 0.1);
    }
    for (const p of this.propGrid.near(from.x, from.z, def.range, this.tmpB)) {
      if (p.type !== 'crate' && p.type !== 'drum') continue;
      const pc = new THREE.Vector3(p.box.x, p.box.y0 + p.box.h / 2, p.box.z);
      const along = V().subVectors(pc, from).dot(dir);
      if (along > 0 && along < def.range && segDist(from, from.clone().addScaledVector(dir, def.range), pc) < 0.9) this.damageProp(p, dmg * 0.6, shooter);
    }
  }

  explode(pos, r, dmg, owner, pierce = 1) {
    void pierce;
    this.fx.explosion(pos, r);
    this.audio.play('boom', pos);
    this.onBlast?.(pos, r);
    this.events.push({ type: 'boom', pos: pos.clone(), r });
    const c = V();
    const from = pos.clone().setY(Math.max(pos.y, height(pos.x, pos.z) + 0.3));
    const team = owner?.team ?? -1;
    for (const u of [...this.unitGrid.near(pos.x, pos.z, r * 2.2, this.tmpA)]) {
      if (team >= 0 && u.team === team && u !== owner) continue; // no friendly blast damage
      u.center(c);
      const d = c.distanceTo(pos);
      if (d < r * 2.2 && u.alive) { u.suppression = Math.min(1, u.suppression + 0.6 * (1 - d / (r * 2.2))); u.squad?.know(owner, pos, true); }
      if (d > r) continue;
      const shield = this.los(from, c) ? 1 : 0.3;
      const k = Math.pow(1 - d / r, 0.7) * shield;
      const push = V().subVectors(c, pos).setY(0);
      if (push.lengthSq() < 1e-4) push.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      push.normalize().multiplyScalar(6 * k).add(new THREE.Vector3(0, 3.5 * k, 0));
      if (u.alive) this.damageUnit(u, dmg * k, owner, 'blast', push.clone().normalize());
      if (!(u.isPlayer && this.god)) u.impulse(push);
    }
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const dx = Math.abs(pos.x - v.pos.x), dz = Math.abs(pos.z - v.pos.z);
      const d = Math.hypot(Math.max(0, dx - v.def.hx), Math.max(0, dz - v.def.hz));
      if (d < r && pos.y < v.pos.y + v.def.h + 1.5) {
        if (team >= 0 && v.team === team && owner?.vehicle !== v) continue; // no friendly blast damage
        v.hit(dmg * Math.pow(1 - d / r, 0.7), 'blast', owner, this);
      }
    }
    for (const p of [...this.propGrid.near(pos.x, pos.z, r + 2, this.tmpB)]) {
      const d = Math.hypot(p.box.x - pos.x, p.box.z - pos.z) - Math.max(p.box.hx, p.box.hz) * 0.6;
      if (d < r) this.damageProp(p, dmg * 1.2 * (1 - Math.max(0, d) / r), owner);
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
    u.alive = true; u.rag = null; u.hp = 45; u.deadT = 0; u.vel.set(0, 0, 0); u.suppression = 0; u.burn = 0; u.flinch = 0;
    u.wound = 0; u.lost = 0; u.wounds = null;
    u.onRevive?.();
    this.events.push({ type: 'revive', unit: u });
  }

  onDeath(u, from) {
    const c = u.center();
    this.fx.debris(c, TEAMS[u.team].body, 6);
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
    // pads in a row either side of the base: walkers in a row
    const k = { walker: 14 }[kind] ?? 14;
    const side = Math.cos(f) * (slot ? -1 : 1), sz = -Math.sin(f) * (slot ? -1 : 1);
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
  updatePoints(dt) {
    const n = this.teams.length;
    for (const p of this.points) {
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
      for (const u of this.units) if (u !== this.player && u.brain && u.alive && !u.vehicle) u.brain.update(dt);
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
    this.updateProjectiles(dt);
    this.callins.update(dt);
    this.updatePoints(dt);
    this.updateTeams(dt);
    for (const u of [...this.units]) if (!u.alive && u !== this.player && u.deadT > 14) this.removeUnit(u);
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
