import * as THREE from 'three';
import { Unit, RADIUS } from './unit.js';
import { U } from './rig.js';
import { Brain, Squad, Commander } from './ai.js';
import { PROPS, propModel, coverSpots } from './props.js';
import { projectileModel, WEAPONS } from './weapons.js';
import { hostile, TEAMS } from './factions.js';
import { HALF, pointMarker } from './world.js';
import { rayBox, pushCircle, segmentHitsBox, corners, segDist, toLocal } from './physics.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const EDGE = HALF - 0.6;

// Unit types: loadouts for AI soldiers.
export const KINDS = {
  rifleman: { name: 'Rifleman', loadout: ['rifle', 'grenade'] },
  assault: { name: 'Assault', loadout: ['smg', 'grenade'] },
  gunner: { name: 'Gunner', loadout: ['mg'] },
  flamer: { name: 'Flamer', loadout: ['flame', 'grenade'] },
  mortar: { name: 'Mortar', loadout: ['launcher'] },
  coil: { name: 'Coil gunner', loadout: ['plasma', 'grenade'] },
};
// squad mixes, one per army
export const SQUAD_MIX = [
  ['rifleman', 'gunner', 'assault', 'rifleman', 'mortar', 'assault', 'rifleman', 'coil'],
  ['rifleman', 'gunner', 'gunner', 'assault', 'rifleman', 'flamer', 'rifleman', 'mortar'],
  ['coil', 'flamer', 'rifleman', 'coil', 'assault', 'rifleman', 'gunner', 'coil'],
];
export const SQUAD_SIZE = 6;

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
  }

  // ---------- setup ----------
  configure(settings) {
    Object.assign(this.settings, settings);
    const n = this.settings.teams;
    this.teams = TEAMS.slice(0, n).map((t, i) => ({
      id: i, tickets: this.settings.tickets, base: baseAt(i, n), spawnT: 0, alive: 0, lost: false,
    }));
    this.commanders = this.teams.map((t) => new Commander(this, t.id));
    this.result = null;
  }

  setPlayer(p) {
    this.player = p;
    this.units.push(p);
  }

  addPoint(name, x, z, r = 8) {
    const m = pointMarker(r);
    m.position.set(x, 0, z);
    this.scene.add(m);
    const p = { name, pos: new THREE.Vector3(x, 0, z), r, owner: -1, capture: 0, capTeam: -1, contested: false, model: m, counts: [0, 0, 0] };
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
    u.pos.y = Math.max(0, this.groundAt(u.pos.x, u.pos.z, 5));
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
    const g = propModel(type);
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    this.scene.add(g);
    const p = { type, def, group: g, hp: def.hp, alive: true, box: { x, z, yaw, hx: def.hx, hz: def.hz, h: def.h }, cover: [] };
    p.cover = coverSpots(p);
    g.traverse((o) => { o.userData.prop = p; });
    this.props.push(p);
    this.propGrid.insertBox(p, p.box);
    return p;
  }

  rebuildPropGrid() {
    this.propGrid.clear();
    for (const p of this.props) this.propGrid.insertBox(p, p.box);
  }

  moveProp(p, x, z, yaw = p.box.yaw) {
    p.box.x = x; p.box.z = z; p.box.yaw = yaw;
    p.group.position.set(x, 0, z);
    p.group.rotation.y = yaw;
    for (const s of p.cover) if (s.owner?.brain?.cover === s) s.owner.brain.releaseCover();
    p.cover = coverSpots(p);
    this.rebuildPropGrid();
  }

  removeProp(p) {
    p.alive = false;
    for (const s of p.cover) if (s.owner?.brain?.cover === s) s.owner.brain.releaseCover();
    this.scene.remove(p.group);
    this.props = this.props.filter((q) => q !== p);
    this.rebuildPropGrid();
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
    for (const p of [...this.props]) this.removeProp(p);
    for (const p of this.projectiles) this.scene.remove(p.model);
    this.projectiles = [];
  }

  dispose() {
    this.clearAll();
    for (const p of this.points) this.scene.remove(p.model);
    this.points = [];
  }

  // ---------- queries ----------
  nearUnits(x, z, r) { return this.unitGrid.near(x, z, r, this.tmpA); }

  groundAt(x, z, y = 0) {
    let g = 0;
    for (const p of this.propGrid.near(x, z, 0.1, this.tmpB)) {
      const b = p.box;
      if (y < b.h - 0.3) continue;
      const [lx, lz] = toLocal(b, x, z);
      if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) g = Math.max(g, b.h);
    }
    return g;
  }

  collideBody(u) {
    for (const p of this.propGrid.near(u.pos.x, u.pos.z, 1, this.tmpB)) if (u.pos.y < p.box.h - 0.06) pushCircle(u.pos, RADIUS, p.box);
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
      for (const u of this.units) {
        if (!u.alive || u === ignore) continue;
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
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t > 0 && t < best.t) {
        const x = o.x + d.x * t, z = o.z + d.z * t;
        if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) best = { t, ground: true, normal: UP.clone() };
      }
    }
    best.point = o.clone().addScaledVector(d, best.t);
    best.hit = !!(best.unit || best.prop || best.ground);
    return best;
  }

  // Clear line between two points (props block; soldiers don't).
  los(a, b) {
    const d = V().subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return true;
    d.divideScalar(len);
    for (const p of this.propGrid.along(a.x, a.z, b.x, b.z, stampN++, this.tmpB)) if (rayBox(a, d, len - 0.05, p.box)) return false;
    return true;
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
    const steady = shooter.isPlayer ? (shooter.ads > 0.5 ? 0.45 : 1) : 1;
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
    if (hit.unit) this.damageUnit(hit.unit, def.damage, shooter, 'bullet', dir);
    else if (hit.prop) { this.damageProp(hit.prop, def.damage * 0.15, shooter); this.fx.impact(end, hit.normal, hit.prop.type === 'wall' || hit.prop.type === 'drum' || hit.prop.type === 'trap' ? 'metal' : 'dust'); }
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
    u.hurt(dmg, from, this, kind);
    if (from && from === this.player) this.onHitMarker?.(!u.alive);
    if (u.isPlayer) this.onPlayerHurt?.(dmg, from);
    if (u.squad && from?.pos) u.squad.know(from, from.pos, true);
    if (u.brain) u.brain.hurtBy(from);
  }

  damageProp(p, dmg, from) {
    if (!p.alive || p.hp === Infinity) return;
    p.hp -= dmg;
    if (p.hp <= 0) {
      const c = new THREE.Vector3(p.box.x, p.box.h / 2, p.box.z);
      this.fx.debris(c, p.def.debris, 16);
      this.fx.dust(c, 6, 1.2);
      this.audio.play('clank', c);
      this.removeProp(p);
      if (p.def.explodes) this.explode(c.setY(0.5), 3.4, 110, from, 1);
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

  predictLanding(pos, vel, g) {
    const a = -0.5 * g, b = vel.y, c = pos.y;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return new THREE.Vector3(pos.x + vel.x * t, 0, pos.z + vel.z * t);
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
      const pc = new THREE.Vector3(p.box.x, p.box.h / 2, p.box.z);
      const along = V().subVectors(pc, from).dot(dir);
      if (along > 0 && along < def.range && segDist(from, from.clone().addScaledVector(dir, def.range), pc) < 0.9) this.damageProp(p, dmg * 0.6, shooter);
    }
  }

  explode(pos, r, dmg, owner, pierce = 1) {
    void pierce;
    this.fx.explosion(pos, r);
    this.audio.play('boom', pos);
    this.events.push({ type: 'boom', pos: pos.clone(), r });
    const c = V();
    const from = pos.clone().setY(Math.max(pos.y, 0.3));
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
        p.landing = p.pos.clone().setY(0);
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

  onDeath(u, from) {
    const c = u.center();
    this.fx.debris(c, TEAMS[u.team].body, 6);
    this.fx.impact(c, UP, 'metal');
    this.events.push({ type: 'death', unit: u, from });
    this.stats.kills++;
    u.brain?.releaseCover();
    this.onKill?.(u, from);
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
            p.owner = top; p.capture = 1;
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
    const standing = this.teams.filter((t) => !t.lost);
    if (!this.result && standing.length <= 1 && this.time > 3) this.result = { winner: standing[0]?.id ?? -1, time: this.time };
  }

  // ---------- frame ----------
  update(rawDt) {
    const dt = rawDt * this.timeScale;
    this.time += dt;
    // spatial grid for this frame
    this.unitGrid.clear();
    for (const u of this.units) if (u.alive) this.unitGrid.insert(u, u.pos.x, u.pos.z);
    if (!this.aiFrozen) {
      for (const c of this.commanders) c.update(dt);
      for (const s of this.squads) s.update(dt);
      for (const u of this.units) if (u !== this.player && u.brain && u.alive) u.brain.update(dt);
    }
    for (const u of this.units) if (u !== this.player) {
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
