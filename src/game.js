import * as THREE from 'three';
import { Soldier, RADIUS, HIT_R } from './soldier.js';
import { Squad, Brain, AIWorld } from './ai.js';
import { PROPS, propModel, coverSpots } from './props.js';
import { projectileModel, WEAPONS } from './weapons.js';
import { hostile, TEAMS } from './factions.js';
import { PLATE } from './world.js';
import { rayBox, raySphere, pushCircle, segmentHitsBox, corners, segDist, toLocal } from './physics.js';

const HALF = PLATE.size / 2;
const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();

// Unit types: loadouts for AI soldiers.
export const KINDS = {
  rifleman: { name: 'Rifleman', loadout: ['rifle', 'grenade'] },
  assault: { name: 'Assault', loadout: ['smg', 'grenade'] },
  gunner: { name: 'Gunner', loadout: ['mg'] },
  flamer: { name: 'Flamer', loadout: ['flame', 'grenade'] },
  grenadier: { name: 'Mortar', loadout: ['launcher'] },
  plasma: { name: 'Coil gunner', loadout: ['plasma', 'grenade'] },
};
export const SQUADS = [
  ['rifleman', 'gunner', 'assault', 'rifleman', 'grenadier'],
  ['rifleman', 'gunner', 'gunner', 'assault', 'rifleman'],
  ['plasma', 'flamer', 'rifleman', 'plasma', 'assault'],
];

// Everything alive on the plate: soldiers, squads, props, vehicles, projectiles; firing,
// hits, explosions and the rules that connect them.
export class World {
  constructor(scene, fx, audio) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.units = [];
    this.squads = [];
    this.props = [];
    this.vehicles = [];
    this.projectiles = [];
    this.player = null;
    this.time = 0;
    this.timeScale = 1;
    this.aiFrozen = false;
    this.god = false;
    this.order = 'follow';
    this.ai = new AIWorld(this);
    this.hits = 0; // player hit markers
    this.onHitMarker = null;
    this.onPlayerHurt = null;
    this.events = [];
  }

  // ---------- spawning ----------
  setPlayer(p) {
    this.player = p;
    this.units.push(p);
    this.scene.add(p.pea);
  }

  playerSquad() {
    let s = this.squads.find((q) => q.commanded && q.alive.length < 6);
    if (!s) { s = new Squad(this, 0, { commanded: true }); this.squads.push(s); }
    return s;
  }

  spawnUnit(team, kind, pos, { squad, yaw } = {}) {
    const u = new Soldier({ team, lod: 0.5, loadout: KINDS[kind].loadout, drop: false, pos });
    u.kind = kind;
    u.pos.y = Math.max(0, this.groundAt(u.pos.x, u.pos.z, 5));
    u.facing = u.aimYaw = yaw ?? (team === 0 ? 0 : Math.atan2(-pos.x, -pos.z));
    u.homePos = pos.clone();
    u.holdPos = pos.clone();
    if (!squad) squad = team === 0 ? this.playerSquad() : this.freeSquad(team, pos);
    squad.add(u);
    u.squad = squad;
    u.brain = new Brain(u, squad, this);
    this.units.push(u);
    this.scene.add(u.pea);
    u.animate(0);
    return u;
  }

  freeSquad(team, pos) {
    let s = this.squads.find((q) => q.team === team && !q.commanded && q.alive.length < 5 && q.alive[0] && q.alive[0].pos.distanceTo(pos) < 8);
    if (!s) { s = new Squad(this, team); this.squads.push(s); }
    return s;
  }

  spawnSquad(team, center, kinds, yaw) {
    const squad = team === 0 ? new Squad(this, 0, { commanded: true }) : new Squad(this, team);
    this.squads.push(squad);
    const f = yaw ?? Math.atan2(-center.x, -center.z);
    kinds.forEach((k, i) => {
      const row = Math.floor((i + 1) / 2), side = i % 2 ? 1 : -1;
      const p = center.clone().add(new THREE.Vector3(-Math.sin(f) * row * 1.2 + Math.cos(f) * side * row * 1.0, 0, -Math.cos(f) * row * 1.2 - Math.sin(f) * side * row * 1.0));
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
    g.userData.prop = p;
    g.traverse((o) => { o.userData.prop = p; });
    this.props.push(p);
    return p;
  }

  moveProp(p, x, z, yaw = p.box.yaw) {
    p.box.x = x; p.box.z = z; p.box.yaw = yaw;
    p.group.position.set(x, 0, z);
    p.group.rotation.y = yaw;
    for (const s of p.cover) if (s.owner?.brain?.cover === s) s.owner.brain.releaseCover();
    p.cover = coverSpots(p);
  }

  removeProp(p) {
    p.alive = false;
    for (const s of p.cover) if (s.owner?.brain?.cover === s) s.owner.brain.releaseCover();
    this.scene.remove(p.group);
    this.props = this.props.filter((q) => q !== p);
  }

  removeUnit(u) {
    if (u === this.player) return;
    if (u.vehicle) u.vehicle.eject?.(u, this);
    u.alive = false;
    u.brain?.releaseCover();
    this.scene.remove(u.pea);
    this.units = this.units.filter((m) => m !== u);
    if (u.squad) u.squad.members = u.squad.members.filter((m) => m !== u);
  }

  addVehicle(v) {
    this.vehicles.push(v);
    this.scene.add(v.group);
    return v;
  }

  removeVehicle(v) {
    for (const s of v.seats || []) if (s.unit) v.eject(s.unit, this);
    v.dispose?.();
    this.scene.remove(v.group);
    this.vehicles = this.vehicles.filter((x) => x !== v);
  }

  clearAll() {
    for (const u of [...this.units]) if (u !== this.player) this.removeUnit(u);
    for (const v of [...this.vehicles]) this.removeVehicle(v);
    for (const p of [...this.props]) this.removeProp(p);
    for (const p of this.projectiles) this.scene.remove(p.model);
    this.projectiles = [];
    this.squads = [];
  }

  // ---------- queries ----------
  targets(team) {
    const out = [];
    for (const u of this.units) if (u.alive && !u.vehicle && hostile(u.team, team)) out.push(u);
    for (const v of this.vehicles) if (!v.dead && v.team >= 0 && hostile(v.team, team)) out.push(v);
    return out;
  }

  nearestHostile(team, p) {
    let best = null, bd = Infinity;
    for (const e of this.targets(team)) {
      const d = e.pos.distanceTo(p);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  obstacles() {
    const out = [];
    for (const p of this.props) if (p.alive) out.push(p.box);
    for (const v of this.vehicles) for (const b of v.boxes()) out.push(b);
    return out;
  }

  segBlocked(ax, az, bx, bz, b, r) { return segmentHitsBox(ax, az, bx, bz, b, r); }
  boxCorners(b, r) { return corners(b, r); }

  groundAt(x, z, y = 0) {
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return -Infinity;
    let g = 0;
    for (const p of this.props) {
      const b = p.box;
      if (y < b.h - 0.25) continue;
      const [lx, lz] = toLocal(b, x, z);
      if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) g = Math.max(g, b.h);
    }
    return g;
  }

  collideBody(u) {
    for (const p of this.props) if (u.pos.y < p.box.h - 0.06) pushCircle(u.pos, RADIUS, p.box);
    for (const v of this.vehicles) for (const b of v.boxes()) if (u.pos.y < (b.y0 || 0) + b.h - 0.06 && u.pos.y + 0.9 > (b.y0 || 0)) pushCircle(u.pos, RADIUS, b);
  }

  // Nearest hit along a ray: peas, vehicles, props, the plate.
  raycast(o, d, maxT, { ignore = null, units = true } = {}) {
    let best = { t: maxT, point: null };
    const c = V();
    if (units) for (const u of this.units) {
      if (!u.alive || u === ignore || u.vehicle) continue;
      u.center(c);
      const t = raySphere(o, d, c, HIT_R, best.t);
      if (t >= 0 && t < best.t) best = { t, unit: u, normal: o.clone().addScaledVector(d, t).sub(c).normalize() };
    }
    for (const p of this.props) {
      const h = rayBox(o, d, best.t, p.box);
      if (h && h.t < best.t) best = { t: h.t, prop: p, normal: h.n };
    }
    for (const v of this.vehicles) {
      if (ignore && (ignore === v || ignore.vehicle === v)) continue;
      for (const b of v.boxes()) {
        const h = rayBox(o, d, best.t, b);
        if (h && h.t < best.t) best = { t: h.t, vehicle: v, normal: h.n };
      }
    }
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t > 0 && t < best.t) {
        const x = o.x + d.x * t, z = o.z + d.z * t;
        if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) best = { t, ground: true, normal: UP.clone() };
      }
    }
    best.point = o.clone().addScaledVector(d, best.t);
    best.hit = !!(best.unit || best.prop || best.vehicle || best.ground);
    return best;
  }

  // Clear line between two points (props and vehicles block; peas don't).
  los(a, b, target = null, propsOnly = false) {
    const d = V().subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return true;
    d.divideScalar(len);
    for (const p of this.props) {
      const h = rayBox(a, d, len - 0.05, p.box);
      if (h) return false;
    }
    if (!propsOnly) for (const v of this.vehicles) {
      if (v === target) continue;
      for (const bx of v.boxes()) if (rayBox(a, d, len - 0.3, bx)) return false;
    }
    return true;
  }

  friendlyInLine(u, from, to) {
    const len = from.distanceTo(to);
    const c = V();
    for (const m of this.units) {
      if (m === u || !m.alive || m.team !== u.team || m.vehicle) continue;
      m.center(c);
      if (c.distanceTo(from) > len) continue;
      if (segDist(from, to, c) < 0.55) return true;
    }
    for (const v of this.vehicles) if (v.team === u.team && !v.dead && segDist(from, to, v.pos) < 1.6 && v.pos.distanceTo(from) < len) return true;
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
    const moving = Math.hypot(shooter.vel.x, shooter.vel.z) > 0.3 ? 1 : 0;
    const s = (def.spread || 0) * (1 + moving * 1.2 + shooter.suppression * 1.5);
    dir = this.spread(dir, s);
    if (def.kind === 'hitscan') this.hitscan(shooter, m, dir, def);
    else if (def.kind === 'projectile') this.launch(def.proj, m, dir.multiplyScalar(def.speed), shooter, def);
    else if (def.kind === 'flame') this.flame(shooter, m, dir, def);
    if (def.kind !== 'flame') this.fx.muzzle(m, dir, def.id === 'mg' ? 1.3 : 1);
    if (def.proj === 'shell') this.fx.steam(m, dir.clone().normalize().multiplyScalar(1.5), 4, 0.5);
    this.audio.play(def.sound, m, shooter.isPlayer ? 0.8 : 1);
    this.heard(shooter, m);
  }

  // shots give away the shooter to enemies nearby
  heard(shooter, p) {
    for (const s of this.squads) {
      if (!hostile(s.team, shooter.team)) continue;
      const a = s.alive[0];
      if (a && a.pos.distanceTo(p) < 22) s.know(shooter.vehicle || shooter, (shooter.vehicle || shooter).pos, false);
    }
  }

  hitscan(shooter, from, dir, def) {
    const hit = this.raycast(from, dir, def.range, { ignore: shooter });
    const end = hit.point;
    this.fx.tracer(from.clone().addScaledVector(dir, 0.15), end, def.id === 'mg' ? 0.016 : 0.011);
    this.suppress(shooter, from, end);
    if (hit.unit) this.damageUnit(hit.unit, def.damage, shooter, 'bullet', dir);
    else if (hit.vehicle) { hit.vehicle.hurt(def.damage * def.pierce, shooter, this); this.fx.impact(end, hit.normal, 'metal'); this.audio.play('ping', end, 0.6); }
    else if (hit.prop) { this.damageProp(hit.prop, def.damage * 0.15, shooter); this.fx.impact(end, hit.normal, hit.prop.type === 'wall' || hit.prop.type === 'drum' || hit.prop.type === 'trap' ? 'metal' : 'dust'); }
    else if (hit.ground) this.fx.impact(end, hit.normal, 'dust');
  }

  suppress(shooter, a, b) {
    const c = V();
    for (const u of this.units) {
      if (!u.alive || u === shooter || !hostile(u.team, shooter.team)) continue;
      u.center(c);
      const d = segDist(a, b, c);
      if (d < 1.6) {
        u.suppression = Math.min(1, u.suppression + (1.6 - d) * 0.12);
        if (u.squad && u.brain) u.squad.know(shooter.vehicle || shooter, (shooter.vehicle || shooter).pos, false);
      }
    }
  }

  juice(u) { return u.team === 1 ? 'yjuice' : u.team === 2 ? 'cjuice' : 'juice'; }

  damageUnit(u, dmg, from, kind, dir) {
    if (!u.alive) return;
    if (u.isPlayer && this.god) return;
    const c = u.center();
    this.fx.impact(c.clone().addScaledVector(dir || UP, -0.3), dir ? dir.clone().negate() : UP, this.juice(u));
    u.hurt(dmg, from, this, kind);
    if (from && (from === this.player || from === this.player?.vehicle)) { this.hits++; this.onHitMarker?.(!u.alive); }
    if (u.isPlayer) this.onPlayerHurt?.(dmg, from);
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
      if (p.def.explodes) this.explode(c.setY(0.4), 3.2, 110, from, 1);
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
    // solve y(t) = 0
    const a = -0.5 * g, b = vel.y, c = pos.y;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return new THREE.Vector3(pos.x + vel.x * t, 0, pos.z + vel.z * t);
  }

  releaseThrow(u) {
    const hand = u.pea.userData.rig.hands[1].getWorldPosition(V());
    const def = WEAPONS.grenade;
    let vel;
    const target = u.throwAt || u.ctrl.aimAt;
    if (u.brain && target) {
      const D = Math.hypot(target.x - hand.x, target.z - hand.z);
      const T = THREE.MathUtils.clamp(D / 10, 0.6, 1.6);
      vel = new THREE.Vector3((target.x - hand.x) / T, (target.y - hand.y + 0.5 * def.gravity * T * T) / T, (target.z - hand.z) / T);
    } else {
      const dir = new THREE.Vector3(Math.sin(u.aimYaw) * Math.cos(u.aimPitch), Math.sin(u.aimPitch) + 0.35, Math.cos(u.aimYaw) * Math.cos(u.aimPitch)).normalize();
      vel = dir.multiplyScalar(def.speed).add(u.vel);
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
    for (const u of this.units) {
      if (!u.alive || u === shooter || u.vehicle) continue;
      u.center(c);
      const v = c.clone().sub(from);
      const along = v.dot(dir);
      if (along < 0 || along > def.range) continue;
      const perp = v.addScaledVector(dir, -along).length();
      if (perp > 0.45 + along * 0.16) continue;
      if (!this.los(from, c, null, true)) continue;
      if (u.team === shooter.team && u !== shooter) continue;
      this.damageUnit(u, dmg, shooter, 'fire', dir);
      u.burn = Math.max(u.burn, 2.8);
      u.burnBy = shooter;
      u.suppression = Math.min(1, u.suppression + 0.1);
    }
    for (const v of this.vehicles) {
      if (v.dead || v === shooter.vehicle) continue;
      const along = V().subVectors(v.pos, from).dot(dir);
      if (along > 0 && along < def.range + 1 && segDist(from, from.clone().addScaledVector(dir, def.range), v.pos) < 1.6) v.hurt(dmg * def.pierce, shooter, this);
    }
    for (const p of this.props) {
      if (p.type !== 'crate' && p.type !== 'drum') continue;
      const pc = new THREE.Vector3(p.box.x, p.box.h / 2, p.box.z);
      const along = V().subVectors(pc, from).dot(dir);
      if (along > 0 && along < def.range && segDist(from, from.clone().addScaledVector(dir, def.range), pc) < 0.8) this.damageProp(p, dmg * 0.6, shooter);
    }
  }

  explode(pos, r, dmg, owner, pierce = 1) {
    this.fx.explosion(pos, r);
    this.audio.play('boom', pos);
    this.events.push({ type: 'boom', pos: pos.clone(), r });
    const c = V();
    const from = pos.clone().setY(Math.max(pos.y, 0.25));
    const team = owner?.team ?? -1;
    for (const u of [...this.units]) {
      if (u.vehicle) continue;
      if (team >= 0 && u.team === team && u !== owner) continue; // no friendly blast damage
      u.center(c);
      const d = c.distanceTo(pos);
      if (d < r * 2.2 && u.alive) u.suppression = Math.min(1, u.suppression + 0.6 * (1 - d / (r * 2.2)));
      if (d > r) continue;
      const shield = this.los(from, c, null, true) ? 1 : 0.3;
      const k = Math.pow(1 - d / r, 0.7) * shield;
      const push = V().subVectors(c, pos).setY(0);
      if (push.lengthSq() < 1e-4) push.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      push.normalize().multiplyScalar(6 * k).add(new THREE.Vector3(0, 3.5 * k, 0));
      if (u.alive) this.damageUnit(u, dmg * k, owner, 'blast', push.clone().normalize());
      if (!(u.isPlayer && this.god)) u.impulse(push);
    }
    for (const v of this.vehicles) {
      if (team >= 0 && v.team === team) continue;
      const d = Math.max(0, v.pos.distanceTo(pos) - v.def.size);
      if (d < r) v.hurt(dmg * pierce * (1 - d / r), owner, this);
    }
    for (const p of [...this.props]) {
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
            // bounce, losing most of the speed; roll to a stop
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
      if (p.type === 'cannon' && Math.random() < 0.5) this.fx.smoke(p.pos, new THREE.Vector3(0, 0.2, 0), 0.4);
      if (p.type === 'grenade') {
        p.fuse -= dt;
        p.landing = p.pos.clone().setY(0);
        if (p.fuse <= 0) { this.explode(p.pos.clone().setY(Math.max(0.15, p.pos.y)), p.def.radius, p.def.damage, p.owner, p.def.pierce); done = true; }
      }
      if (p.t > 6 || p.pos.y < -15) done = true;
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
      if (hit.vehicle) hit.vehicle.hurt(def.damage * def.pierce, p.owner, this);
      if (hit.prop) this.damageProp(hit.prop, def.damage * 0.5, p.owner);
      const c = V();
      for (const u of this.units) {
        if (!u.alive || u === hit.unit || u.vehicle || u.team === p.team) continue;
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
    for (let i = 0; i < 3; i++) this.fx.impact(c, UP, this.juice(u));
    this.events.push({ type: 'death', unit: u, from });
    u.brain?.releaseCover();
    if (u.vehicle) u.vehicle.eject(u, this);
  }

  // ---------- frame ----------
  update(rawDt) {
    const dt = rawDt * this.timeScale;
    this.time += dt;
    for (const s of this.squads) if (!this.aiFrozen) s.update(dt);
    for (const u of this.units) if (u !== this.player && u.brain && !u.vehicle) u.brain.update(dt);
    for (const u of this.units) if (u !== this.player) {
      if (this.aiFrozen && u.alive && u.brain && !u.vehicle) continue;
      u.update(dt, this);
    }
    for (const v of this.vehicles) v.update(dt, this);
    // peas don't overlap each other
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (!a.alive || a.vehicle) continue;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        if (!b.alive || b.vehicle || Math.abs(a.pos.y - b.pos.y) > 0.6) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz, min = RADIUS * 1.7;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2), k = (min - d) / d * 0.5;
          if (a !== this.player) { a.pos.x -= dx * k; a.pos.z -= dz * k; }
          if (b !== this.player) { b.pos.x += dx * k; b.pos.z += dz * k; }
        }
      }
    }
    this.updateProjectiles(dt);
    // tidy up the fallen
    for (const u of [...this.units]) if (!u.alive && u !== this.player && u.deadT > 16) this.removeUnit(u);
    for (const v of [...this.vehicles]) if (v.dead && v.deadT > 20) this.removeVehicle(v);
    this.squads = this.squads.filter((s) => s.members.length || s.commanded);
    this.fx.update(dt);
    return dt;
  }

  counts() {
    const n = TEAMS.map(() => 0);
    for (const u of this.units) if (u.alive) n[u.team]++;
    return n;
  }
}
