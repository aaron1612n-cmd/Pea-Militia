import * as THREE from 'three';
import { hostile } from './factions.js';
import { wrap } from './physics.js';
import { PLATE } from './world.js';

const LIMIT = PLATE.size / 2 - 1.2;
const clampXZ = (v) => { v.x = THREE.MathUtils.clamp(v.x, -LIMIT, LIMIT); v.z = THREE.MathUtils.clamp(v.z, -LIMIT, LIMIT); return v; };
const rand = (a, b) => a + Math.random() * (b - a);
const V = () => new THREE.Vector3();

// A squad shares what its members have seen, picks one target, and hands out roles:
// most members fight from cover and suppress, one flanks when the enemy is dug in,
// and the squad bounds forward or falls back as a group.
export class Squad {
  constructor(world, team, { commanded = false } = {}) {
    this.world = world;
    this.team = team;
    this.members = [];
    this.commanded = commanded; // the player's own squads take Follow / Hold / Attack
    this.known = new Map(); // enemy -> { pos, t, seen }
    this.target = null;
    this.engagedT = 0;
    this.flanker = null;
    this.flankGoal = null;
    this.flankT = 0;
    this.bound = 0; // which half is moving when advancing
    this.boundT = 0;
    this.thinkT = Math.random() * 0.5;
    this.start = 0;
    this.mode = 'idle';
  }

  add(u) {
    this.members.push(u);
    this.start = Math.max(this.start, this.members.length);
  }

  get alive() { return this.members.filter((m) => m.alive); }

  know(e, pos, seen = true) {
    const k = this.known.get(e);
    if (k) { k.pos.copy(pos); k.t = this.world.time; k.seen = k.seen || seen; } else this.known.set(e, { pos: pos.clone(), t: this.world.time, seen });
  }

  centroid(out = V()) {
    const a = this.alive;
    out.set(0, 0, 0);
    for (const m of a) out.add(m.pos);
    return a.length ? out.divideScalar(a.length) : out;
  }

  update(dt) {
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.5;
    const now = this.world.time;
    this.members = this.members.filter((m) => m.alive || m.deadT < 1);
    for (const [e, k] of this.known) if (!e.alive || now - k.t > 14 || (e.isVehicle && e.dead)) this.known.delete(e);
    const alive = this.alive;
    if (!alive.length) return;
    const c = this.centroid();

    // squad target: the nearest threat, sticking with the current one unless another is much closer
    let best = null, bestD = Infinity;
    for (const [e, k] of this.known) {
      let d = k.pos.distanceTo(c) - (e === this.target ? 6 : 0) - (k.seen && now - k.t < 2 ? 3 : 0);
      if (d < bestD) { bestD = d; best = e; }
    }
    this.target = best;
    this.engagedT = best ? this.engagedT + 0.5 : 0;

    const lost = 1 - alive.length / Math.max(1, this.start);
    const hurt = alive.reduce((s, m) => s + m.hp / m.maxHp, 0) / alive.length;
    if (best && (lost > 0.6 || hurt < 0.35) && this.mode !== 'fallback' && !(this.commanded && this.world.order === 'hold')) {
      this.mode = 'fallback';
      this.fallbackT = 8;
    } else if (this.mode === 'fallback') {
      this.fallbackT -= 0.5;
      if (this.fallbackT <= 0) this.mode = best ? 'engage' : 'idle';
    } else this.mode = best ? 'engage' : 'idle';

    // flanking: if the target has been dug in for a while, send one pea around the side
    if (this.flanker && (!this.flanker.alive || !best || this.flankT > 22)) { this.flanker = null; this.flankGoal = null; }
    if (this.flanker) this.flankT += 0.5;
    if (!this.flanker && best && this.mode === 'engage' && alive.length >= 3 && this.engagedT > 6 && !(this.commanded && this.world.order !== 'attack')) {
      const k = this.known.get(best);
      const dug = !k.seen || now - k.t > 2 || (best.kneelK || 0) > 0.5;
      if (dug && Math.random() < 0.5) this.planFlank(best, k.pos, c);
    }

    // bounding: half the squad moves while the other half covers, swapping every few seconds
    this.boundT -= 0.5;
    if (this.boundT <= 0) { this.bound = 1 - this.bound; this.boundT = rand(5, 8); }
  }

  planFlank(target, T, c) {
    const alive = this.alive.filter((m) => m.brain && !m.vehicle);
    // the healthiest pea with a mid-range weapon goes
    const pick = alive.filter((m) => !['mg', 'launcher'].includes(m.weapons[0].id)).sort((a, b) => b.hp - a.hp)[0];
    if (!pick) return;
    const axis = V().subVectors(c, T).setY(0).normalize();
    const range = THREE.MathUtils.clamp((pick.weapons[0].def.ideal[0] + pick.weapons[0].def.ideal[1]) / 2, 6, 14);
    let goal = null, bestS = -Infinity;
    for (const side of [-1, 1]) {
      const a = side * rand(1.1, 1.5);
      const dir = axis.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const p = clampXZ(T.clone().addScaledVector(dir, range));
      // prefer a side that has cover and that isn't on the far side of the enemy
      const spot = this.world.ai.nearestCover(p, 4, T);
      const s = (spot ? 3 : 0) - p.distanceTo(pick.pos) * 0.1 + Math.random();
      if (s > bestS) { bestS = s; goal = spot ? new THREE.Vector3(spot.x, 0, spot.z) : p; }
    }
    this.flanker = pick;
    this.flankGoal = goal;
    this.flankT = 0;
  }

  // where a member should be when there's no fight: formation on the leader / the player
  formation(u) {
    const alive = this.alive;
    const i = alive.indexOf(u);
    const w = this.world;
    if (this.commanded) {
      if (w.order === 'hold') return u.holdPos || u.pos;
      if (w.order === 'follow' && w.player && w.player.alive) {
        const p = w.player.vehicle ? w.player.vehicle.pos : w.player.pos;
        const f = w.player.vehicle ? w.player.vehicle.yaw : w.player.facing;
        const all = w.units.filter((m) => m.brain && m.squad?.commanded && m.alive && !m.vehicle);
        const j = all.indexOf(u);
        const row = Math.floor(j / 2) + 1, side = j % 2 ? 1 : -1;
        const back = 1.4 + row * 1.0 + (w.player.vehicle ? 3 : 0), lat = side * (0.9 + row * 0.6);
        return clampXZ(new THREE.Vector3(p.x - Math.sin(f) * back + Math.cos(f) * lat, 0, p.z - Math.cos(f) * back - Math.sin(f) * lat));
      }
    }
    // hunt: head for the nearest enemy anywhere (they patrol toward the fight)
    const lead = alive[0];
    if (u === lead || !lead) {
      const e = w.nearestHostile(u.team, u.pos);
      if (e && (!this.commanded || w.order === 'attack')) return clampXZ(e.pos.clone().lerp(u.pos, 0.35));
      return u.homePos || u.pos;
    }
    const f = lead.facing;
    const row = Math.floor((i - 1) / 2) + 1, side = (i - 1) % 2 ? 1 : -1;
    return clampXZ(new THREE.Vector3(lead.pos.x - Math.sin(f) * row * 1.3 + Math.cos(f) * side * row * 1.1, 0, lead.pos.z - Math.cos(f) * row * 1.3 - Math.sin(f) * side * row * 1.1));
  }
}

// One pea's mind: perception, target choice, cover, peeking, bursts, grenades, retreat.
export class Brain {
  constructor(unit, squad, world) {
    this.u = unit;
    this.squad = squad;
    this.world = world;
    this.thinkT = Math.random() * 0.3;
    this.target = null;
    this.visible = false;
    this.seenT = -99;
    this.react = 0;
    this.goal = unit.pos.clone();
    this.cover = null;
    this.phase = 'hide';
    this.phaseT = rand(0.5, 1.5);
    this.burst = 0;
    this.pause = 0;
    this.err = V();
    this.errT = 0;
    this.grenadeCD = rand(4, 10);
    this.state = 'idle';
    this.retreating = false;
    this.evadeT = 0;
    this.skill = rand(0.75, 1.15);
    this.strafeT = 0;
    this.strafe = V();
    this.lastPos = unit.pos.clone();
    this.stuckT = 0;
    this.prevWeapon = 0;
    unit.onHurt = (dmg, from) => this.hurt(dmg, from);
  }

  hurt(dmg, from) {
    const src = from?.vehicle || from;
    if (src && src.team !== undefined && hostile(src.team, this.u.team) && src.pos) {
      this.squad.know(src, src.pos, true);
      if (!this.visible) { this.target = src; this.react = Math.min(this.react, 0.2); }
    }
    if (this.phase === 'peek' && this.cover && dmg > 8) { this.phase = 'hide'; this.phaseT = rand(0.8, 1.6); }
  }

  aimPoint(e, out = V()) {
    return e.isVehicle ? out.copy(e.pos).setY(e.pos.y + e.def.aimY) : e.center(out);
  }

  // ---- slow loop ----
  think() {
    const u = this.u, w = this.world, now = w.time;
    const eye = u.eye();
    // perception: hostile peas and vehicles in a wide forward arc with a clear line of sight
    let best = null, bestS = -Infinity;
    const weapon = u.weapons[0].def;
    const antiArmor = u.weapons.some((x) => x.def.pierce >= 0.7);
    for (const e of w.targets(u.team)) {
      const p = this.aimPoint(e);
      const d = p.distanceTo(eye);
      if (d > 48) continue;
      const ang = Math.abs(wrap(Math.atan2(p.x - u.pos.x, p.z - u.pos.z) - u.aimYaw));
      if (ang > 1.95 && d > 7 && e !== this.target) continue;
      if (!w.los(eye, p, e)) continue;
      this.squad.know(e, e.isVehicle ? e.pos : e.pos, true);
      let s = 30 / (d + 5);
      if (e === this.target) s += 1.2;
      if (e.hp < e.maxHp * 0.5) s += 0.6;
      if (!e.isVehicle && e.kneelK < 0.5) s += 0.4;
      if (e.isVehicle) s += antiArmor ? 3 : -1.2;
      if (d > weapon.range) s -= 2;
      if (e.brain?.target === u || e.isPlayer) s += 0.5;
      if (s > bestS) { bestS = s; best = e; }
    }
    if (best) {
      if (best !== this.target) this.react = rand(0.25, 0.6) / this.skill;
      this.target = best;
      this.visible = true;
      this.seenT = now;
    } else {
      this.visible = false;
      // fall back on what the squad knows
      const st = this.squad.target;
      if (st && (!this.target || !this.target.alive || this.target.dead)) this.target = st;
      if (this.target && (!this.target.alive || this.target.dead || !this.squad.known.has(this.target))) this.target = st && st.alive ? st : null;
    }

    // danger: a grenade or shell about to go off nearby
    for (const p of w.projectiles) {
      if ((p.type === 'grenade' || p.type === 'shell') && p.landing && p.landing.distanceTo(u.pos) < p.def.radius + 0.8) {
        const away = V().subVectors(u.pos, p.landing).setY(0);
        if (away.lengthSq() < 0.01) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        this.goal.copy(clampXZ(u.pos.clone().addScaledVector(away.normalize(), p.def.radius + 2)));
        this.evadeT = 1.6;
        this.releaseCover();
        return;
      }
    }
    if (this.evadeT > 0) return;

    // retreat when badly hurt; come back once patched up
    const hp = u.hp / u.maxHp;
    if (!this.retreating && hp < 0.35 && this.target) { this.retreating = true; this.releaseCover(); }
    if (this.retreating && (hp > 0.75 || !this.target)) this.retreating = false;

    const known = this.target ? this.squad.known.get(this.target) : null;
    const threat = known ? known.pos : this.target?.pos;
    const sq = this.squad;
    if (!this.target || !threat) {
      this.state = 'idle';
      this.releaseCover();
      this.goal.copy(sq.formation(u));
      // an empty vehicle close by? take it (the player's squad only when ordered to attack)
      if (!sq.commanded || w.order === 'attack') {
        let v = this.boarding;
        if (!v || v.dead || v.driver) {
          v = null;
          for (const c of w.vehicles) if (!c.dead && !c.driver && (!c.claim || c.claim === u || !c.claim.alive) && c.pos.distanceTo(u.pos) < 12 && c.pos.y > -0.2) { v = c; break; }
        }
        this.boarding = v;
        if (v) {
          v.claim = u;
          this.goal.copy(v.pos);
          if (v.pos.distanceTo(u.pos) < v.def.size + 1.1) { v.enter(u, w); this.boarding = null; }
        }
      }
      return;
    }

    const commanded = sq.commanded;
    const order = commanded ? w.order : 'attack';
    let anchor = u.pos, radius = 10;
    if (order === 'follow' && w.player?.alive) { anchor = w.player.vehicle ? w.player.vehicle.pos : w.player.pos; radius = 8; }
    if (order === 'hold') { anchor = u.holdPos || u.pos; radius = 4.5; }

    if (this.retreating || sq.mode === 'fallback') {
      // fall back to cover further from the threat
      this.state = 'retreat';
      const away = V().subVectors(u.pos, threat).setY(0).normalize();
      const back = clampXZ(u.pos.clone().addScaledVector(away, 8));
      if (!this.cover || this.cover.x === undefined || Math.hypot(this.cover.x - threat.x, this.cover.z - threat.z) < u.pos.distanceTo(threat) + 2) {
        this.takeCover(threat, order === 'hold' ? anchor : back, order === 'hold' ? radius : 9, 1.5);
      }
      if (!this.cover) this.goal.copy(back);
      return;
    }

    if (sq.flanker === u && sq.flankGoal) {
      this.state = 'flank';
      this.releaseCover();
      this.goal.copy(sq.flankGoal);
      if (u.pos.distanceTo(sq.flankGoal) < 1.2) { sq.flanker = null; sq.flankGoal = null; this.takeCover(threat, u.pos, 4, 0); }
      return;
    }

    // advance by bounds when out of range, otherwise hold good cover
    const dist = u.pos.distanceTo(threat);
    const [near, far] = weapon.ideal;
    const myHalf = sq.alive.indexOf(u) % 2;
    let push = 0;
    if (order === 'attack' && dist > far && myHalf === sq.bound) push = 1;
    if (dist < near * 0.6 && weapon.kind !== 'flame') push = -1;
    if (push) {
      const dir = V().subVectors(threat, u.pos).setY(0).normalize().multiplyScalar(push);
      anchor = clampXZ(u.pos.clone().addScaledVector(dir, Math.min(8, Math.abs(dist - (near + far) / 2))));
      radius = 5;
    }
    this.state = 'fight';
    const coverOk = this.cover && this.world.ai.protects(this.cover, threat) && this.cover.prop.alive && (!push || this.cover.x === undefined);
    if (!coverOk || push) this.takeCover(threat, anchor, radius, push ? 1 : 0);
    if (!this.cover) {
      // no cover close: fight in the open, sidestepping now and then
      if (this.strafeT <= 0) {
        this.strafeT = rand(1.5, 3);
        const side = V().subVectors(threat, u.pos).setY(0).normalize();
        this.strafe.set(side.z, 0, -side.x).multiplyScalar(rand(-1.5, 1.5));
        this.goal.copy(clampXZ(anchor.clone().add(this.strafe)));
        if (push) this.goal.copy(anchor);
      }
    }

    // grenade: a dug-in enemy at grenade range, or a huddle
    const g = u.weapons.findIndex((x) => x.def.kind === 'throw');
    this.grenadeCD -= 0.3;
    if (g >= 0 && this.grenadeCD <= 0 && u.weapons[g].mag > 0 && !this.target.isVehicle) {
      const huddle = w.units.filter((m) => m.alive && hostile(m.team, u.team) && m.pos.distanceTo(threat) < 3).length;
      const dug = !this.visible && now - this.seenT > 2.5;
      if (dist > 6 && dist < 19 && (dug || huddle >= 2) && Math.random() < 0.6) {
        this.prevWeapon = u.wi;
        u.setWeapon(g);
        u.throwAt = threat.clone();
        this.throwing = 0.4;
        this.grenadeCD = rand(9, 16);
      }
    }
  }

  takeCover(threat, anchor, radius, push) {
    const spot = this.world.ai.findCover(this.u, threat, anchor, radius, push, this.cover);
    if (spot !== this.cover) {
      this.releaseCover();
      if (spot) { spot.owner = this.u; this.cover = spot; this.goal.set(spot.x, 0, spot.z); this.phase = 'hide'; this.phaseT = rand(0.3, 0.9); }
    }
    if (!spot && this.cover === null) this.goal.copy(anchor === this.u.pos ? this.u.pos : anchor);
  }

  releaseCover() {
    if (this.cover && this.cover.owner === this.u) this.cover.owner = null;
    this.cover = null;
  }

  // ---- every frame ----
  update(dt) {
    const u = this.u, w = this.world, c = u.ctrl;
    if (!u.alive) { this.releaseCover(); return; }
    if (w.aiFrozen) { c.wx = c.wz = 0; c.fire = false; return; }
    this.thinkT -= dt;
    this.evadeT -= dt;
    this.strafeT -= dt;
    this.react -= dt;
    if (this.thinkT <= 0) { this.thinkT = rand(0.25, 0.4); this.think(); }

    // throwing a grenade: face the spot, throw, then switch back
    if (this.throwing !== undefined && this.throwing !== null) {
      this.throwing -= dt;
      c.wx = c.wz = 0;
      c.aimAt = u.throwAt;
      c.turnRate = 6;
      c.kneel = false;
      const ready = Math.abs(wrap(Math.atan2(u.throwAt.x - u.pos.x, u.throwAt.z - u.pos.z) - u.aimYaw)) < 0.15;
      c.fire = this.throwing < 0 && ready && u.throwT <= 0 && !u.thrown;
      if (u.thrown && u.throwT <= 0) { u.setWeapon(this.prevWeapon); this.throwing = null; c.fire = false; }
      if (this.throwing < -3) { u.setWeapon(this.prevWeapon); this.throwing = null; }
      u.thrown = u.thrown && u.throwT > 0;
      return;
    }

    // where to stand
    let goal = this.goal;
    const atCover = this.cover && Math.hypot(u.pos.x - this.cover.x, u.pos.z - this.cover.z) < 0.45;
    const T = this.target;
    let fight = !!T && this.state !== 'idle';
    if (atCover) {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.phase === 'hide') {
          const pinned = u.suppression > 0.6 && Math.random() < 0.7;
          if (pinned || u.reloadT > 0) this.phaseT = rand(0.6, 1.4);
          else { this.phase = 'peek'; this.phaseT = rand(1.4, 3.2); }
        } else { this.phase = 'hide'; this.phaseT = rand(0.7, 1.8) * (1 + u.suppression); }
      }
      const w0 = u.weapon;
      if (this.phase === 'hide' && !w0.def.heat && w0.mag < w0.def.mag * 0.5) u.startReload();
      if (this.cover.high && this.phase === 'peek') goal = new THREE.Vector3(this.cover.px, 0, this.cover.pz);
    }
    const peekPos = this.cover && this.cover.high && this.phase === 'peek';
    if (peekPos) goal = new THREE.Vector3(this.cover.px, 0, this.cover.pz);
    c.kneel = !!(atCover && this.phase === 'hide' && !this.cover.high);

    // steer: around props, apart from friends
    const to = V().subVectors(goal, u.pos).setY(0);
    const dist = to.length();
    let wx = 0, wz = 0;
    if (dist > 0.18) {
      const wp = w.ai.pathAround(u.pos, goal);
      const d = V().subVectors(wp, u.pos).setY(0).normalize();
      const k = Math.min(1, dist / 0.5);
      wx = d.x * k; wz = d.z * k;
    }
    for (const m of w.units) {
      if (m === u || !m.alive || m.vehicle) continue;
      const dx = u.pos.x - m.pos.x, dz = u.pos.z - m.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.81 && d2 > 1e-6) { const d = Math.sqrt(d2); wx += (dx / d) * (0.9 - d) * 1.5; wz += (dz / d) * (0.9 - d) * 1.5; }
    }
    const l = Math.hypot(wx, wz);
    if (l > 1) { wx /= l; wz /= l; }
    c.wx = wx; c.wz = wz;
    const rushing = this.state === 'retreat' || this.state === 'flank' || this.evadeT > 0 || (this.cover && !atCover && fight);
    c.speed = rushing ? 1.75 : this.state === 'idle' ? 1.25 : 1;

    // unstick: if walking but not moving, nudge sideways
    if (l > 0.3) {
      if (u.pos.distanceTo(this.lastPos) < 0.05 * dt * 60) this.stuckT += dt; else this.stuckT = 0;
      if (this.stuckT > 1.2) { this.releaseCover(); this.goal.copy(clampXZ(u.pos.clone().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2))))); this.stuckT = 0; }
    }
    this.lastPos.copy(u.pos);

    // aim and shoot
    c.fire = false;
    c.turnRate = 4.5;
    if (!fight || !T || this.evadeT > 0) { c.aimAt = null; c.aiming = false; return; }
    const known = this.squad.known.get(T);
    const tp = this.visible ? this.aimPoint(T) : known ? known.pos.clone().setY(0.45) : null;
    if (!tp) { c.aimAt = null; return; }
    const weapon = u.weapon.def;
    const muzzle = u.center();
    const d = tp.distanceTo(muzzle);
    // aim error drifts per burst: worse at range, when moving, when suppressed or shooting blind
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = rand(0.4, 0.9);
      const e = (0.12 + d * 0.022 + u.suppression * 0.5 + (l > 0.3 ? 0.25 : 0) + (this.visible ? 0 : 0.6)) / this.skill;
      this.err.set(rand(-e, e), rand(-e * 0.6, e * 0.6), rand(-e, e));
    }
    let aim = tp.clone().add(this.err);
    if (this.visible && T.vel && !T.isVehicle) aim.addScaledVector(T.vel, Math.min(0.5, d / 60));
    if (weapon.gravity) aim = this.lob(muzzle, aim, weapon);
    c.aimAt = aim;
    c.aiming = true;
    const suppressing = !this.visible && (this.squad.flanker || this.cover) && known && this.world.time - known.t < 6 && weapon.kind === 'hitscan';
    const peeking = !this.cover || !atCover || this.phase === 'peek';
    const canShoot = (this.visible || suppressing) && this.react <= 0 && d < weapon.range;
    const facing = Math.abs(wrap(Math.atan2(aim.x - u.pos.x, aim.z - u.pos.z) - u.aimYaw)) < 0.14;
    if (!canShoot || !facing || !peeking) return;
    if (weapon.kind === 'flame' && d > weapon.range * 0.9) return;
    if (this.world.friendlyInLine(u, muzzle, aim)) return;
    if (u.weapon.heat > 0.85) return;
    // bursts
    this.pause -= dt;
    if (this.pause > 0) return;
    c.fire = true;
    if (u.shots !== this.lastShots) {
      this.lastShots = u.shots;
      this.burst--;
      if (this.burst <= 0) {
        const [a, b] = weapon.burst;
        this.burst = Math.round(rand(a, b));
        this.pause = weapon.auto ? rand(0.25, 0.7) : rand(0.15, 0.6);
      }
    }
  }

  // aim point that lands a lobbed shot (speed fixed) on the target
  lob(from, to, def) {
    const dx = to.x - from.x, dz = to.z - from.z, D = Math.hypot(dx, dz), H = to.y - from.y;
    const v = def.speed, g = def.gravity;
    const disc = v ** 4 - g * (g * D * D + 2 * H * v * v);
    const th = disc > 0 ? Math.atan((v * v - Math.sqrt(disc)) / (g * D)) : Math.PI / 4;
    return new THREE.Vector3(from.x + dx, from.y + Math.tan(th) * D, from.z + dz);
  }
}

// World-level AI helpers: cover spots, line-of-sight protection, routing around props.
export class AIWorld {
  constructor(world) { this.world = world; }

  spots() {
    const out = [];
    for (const p of this.world.props) if (p.alive) for (const s of p.cover) out.push(s);
    return out;
  }

  // is a crouched pea at this spot hidden from the threat?
  protects(spot, threat) {
    const dx = threat.x - spot.x, dz = threat.z - spot.z;
    const d = Math.hypot(dx, dz) || 1;
    if ((dx * spot.nx + dz * spot.nz) / d > -0.25) return false;
    const a = new THREE.Vector3(threat.x, 0.55, threat.z);
    const b = new THREE.Vector3(spot.x, spot.high ? 0.5 : 0.3, spot.z);
    return !this.world.los(a, b, null, true);
  }

  findCover(u, threat, anchor, radius, push, current) {
    let best = null, bestS = -Infinity;
    const def = u.weapons[0].def;
    const ideal = (def.ideal[0] + def.ideal[1]) / 2;
    for (const s of this.spots()) {
      if (s.owner && s.owner !== u && s.owner.alive) continue;
      const da = Math.hypot(s.x - anchor.x, s.z - anchor.z);
      if (da > radius) continue;
      const dt = Math.hypot(s.x - threat.x, s.z - threat.z);
      if (dt < 2.5) continue;
      let sc = -Math.hypot(s.x - u.pos.x, s.z - u.pos.z) * 0.35 - da * 0.2 - Math.abs(dt - ideal) * 0.12;
      if (push > 0) sc -= dt * 0.3;
      if (push < 0) sc += dt * 0.2;
      if (s === current) sc += 1.5;
      for (const m of this.world.units) if (m !== u && m.alive && m.team === u.team && Math.hypot(m.pos.x - s.x, m.pos.z - s.z) < 1.1) sc -= 2;
      if (sc + 8 < bestS) continue;
      if (!this.protects(s, threat)) continue;
      sc += 6;
      if (s.high) sc += 0.4;
      if (sc > bestS) { bestS = sc; best = s; }
    }
    return best;
  }

  nearestCover(p, r, threat) {
    let best = null, bd = r;
    for (const s of this.spots()) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd && (!threat || this.protects(s, threat) === false || true)) { bd = d; best = s; }
    }
    return best;
  }

  // next waypoint toward goal, stepping around the first prop or vehicle in the way
  pathAround(from, goal) {
    const w = this.world;
    let block = null, bd = Infinity;
    const r = 0.42;
    for (const b of w.obstacles()) {
      const d = Math.hypot(b.x - from.x, b.z - from.z);
      if (d > bd || d > Math.hypot(goal.x - from.x, goal.z - from.z) + Math.max(b.hx, b.hz) + 1) continue;
      if (w.segBlocked(from.x, from.z, goal.x, goal.z, b, r)) { bd = d; block = b; }
    }
    if (!block) return goal;
    let best = null, bs = Infinity;
    for (const [x, z] of w.boxCorners(block, r + 0.25)) {
      const s = Math.hypot(x - from.x, z - from.z) + Math.hypot(goal.x - x, goal.z - z);
      if (Math.hypot(x - from.x, z - from.z) < 0.2) continue;
      if (s < bs) { bs = s; best = [x, z]; }
    }
    return best ? new THREE.Vector3(best[0], 0, best[1]) : goal;
  }
}
