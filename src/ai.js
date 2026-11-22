import * as THREE from 'three';
import { hostile } from './factions.js';
import { wrap } from './physics.js';
import { U } from './rig.js';

// Three layers of AI:
//  Commander (one per army): every few seconds hands each squad an objective, a control point
//    to take or hold, and sends a second squad on the same point round the flank.
//  Squad: moves as a loose wedge toward its objective; on contact it goes to ground, then
//    advances in bounds (half the squad moves while the other half covers), and falls back
//    to friendly ground when it has been shot to pieces.
//  Brain (one per soldier): spots enemies (line of sight, range, a short reaction delay),
//    picks targets, aims with an error that tightens while tracking, fires in bursts, takes
//    cover, throws grenades at clusters and at enemies dug in behind cover.

const V = () => new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
// distance across the ground, ignoring height (points and waypoints sit on hills and in hollows)
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SIGHT = 70;

export class Commander {
  constructor(world, team) {
    this.world = world;
    this.team = team;
    this.t = Math.random() * 2;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 3;
    const w = this.world;
    const squads = w.squads.filter((s) => s.team === this.team && s.alive.length);
    if (!squads.length) return;
    const pts = w.points;
    if (!pts.length) {
      // no points (sandbox): go after the nearest enemies
      for (const s of squads) if (!s.manual) s.setObjective(null);
      return;
    }
    const load = new Map(pts.map((p) => [p, 0]));
    for (const s of squads) if (s.objective && !s.retreating) load.set(s.objective, (load.get(s.objective) || 0) + 1);
    const cap = Math.max(1, Math.ceil(squads.length / Math.max(1, pts.length - 1)) + 1);
    for (const s of squads) {
      if (s.manual || s.retreating) continue;
      const lead = s.leader;
      if (!lead) continue;
      // keep going if the current objective still makes sense
      const cur = s.objective;
      if (cur && cur.owner !== this.team && s.objT < 50) continue;
      if (cur && cur.owner === this.team && cur.contested) continue;
      let best = null, bs = -Infinity;
      for (const p of pts) {
        const d = lead.pos.distanceTo(p.pos);
        let sc = -d;
        if (p.owner === this.team) sc -= p.contested ? -25 : 70; // defend a point under attack
        else if (p.owner < 0) sc += 22;
        else sc += 8;
        const l = load.get(p) || 0;
        if (l >= cap) sc -= 60 * (l - cap + 1);
        sc += Math.random() * 8;
        if (sc > bs) { bs = sc; best = p; }
      }
      if (best && best !== cur) {
        if (cur) load.set(cur, (load.get(cur) || 1) - 1);
        load.set(best, (load.get(best) || 0) + 1);
        // a second squad on the same point swings wide
        const others = squads.filter((q) => q !== s && q.objective === best);
        s.setObjective(best, others.length % 2 === 1 ? (Math.random() < 0.5 ? -1 : 1) : 0);
      }
    }
  }
}

export class Squad {
  constructor(world, team) {
    this.world = world;
    this.team = team;
    this.members = [];
    this.started = 0;
    this.objective = null;
    this.objT = 0;
    this.flank = 0;
    this.waypoint = null;
    this.anchor = null; // where the squad is heading right now
    this.contact = null; // { pos, t, unit }
    this.bound = 0;
    this.boundT = rand(4, 7);
    this.retreating = false;
    this.manual = false;
    this.facing = 0;
    this.holdA = Math.random() * Math.PI * 2; // where around a point this squad settles
    this.holding = false;
    this.watch = null;
  }

  get alive() { return this.members.filter((m) => m.alive); }
  get leader() { return this.members.find((m) => m.alive) || null; }

  add(u) { this.members.push(u); this.started++; u.slot = this.members.length - 1; }

  setObjective(p, flank = 0) {
    this.objective = p;
    this.objT = 0;
    this.flank = flank;
    this.waypoint = null;
    if (p && flank) {
      const lead = this.leader;
      if (lead) {
        const to = V().subVectors(p.pos, lead.pos).setY(0);
        const d = to.length();
        if (d > 30) {
          to.normalize();
          const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(flank * Math.min(28, d * 0.4));
          this.waypoint = lead.pos.clone().addScaledVector(to, d * 0.55).add(side);
          const H = this.world.settings ? 80 : 80;
          this.waypoint.x = THREE.MathUtils.clamp(this.waypoint.x, -H, H);
          this.waypoint.z = THREE.MathUtils.clamp(this.waypoint.z, -H, H);
        }
      }
    }
  }

  // something hostile seen or heard at pos
  know(unit, pos, seen) {
    if (!unit || !pos) return;
    const now = this.world.time;
    if (!this.contact || now - this.contact.t > 1 || seen) this.contact = { pos: pos.clone(), t: now, unit, seen };
  }

  inContact() { return this.contact && this.world.time - this.contact.t < 6; }

  update(dt) {
    const alive = this.alive;
    if (!alive.length) return;
    this.objT += dt;
    const lead = alive[0];
    const w = this.world;
    // shot to pieces in a fight: fall back to friendly ground and wait for help
    if (!this.retreating && this.started >= 4 && alive.length <= Math.max(1, Math.floor(this.started * 0.34)) && this.inContact()) {
      this.retreating = true;
      this.retreatT = 0;
      const safe = w.points.filter((p) => p.owner === this.team && !p.contested);
      const base = w.teams[this.team]?.base;
      let best = base ? { pos: base } : null, bd = Infinity;
      for (const p of safe) { const d = p.pos.distanceTo(lead.pos); if (d < bd && d > 12) { bd = d; best = p; } }
      this.fallback = best ? best.pos.clone() : lead.pos.clone();
    }
    if (this.retreating) {
      this.retreatT += dt;
      this.anchor = this.fallback;
      if (flat(lead.pos, this.fallback) < 6 || this.retreatT > 30) {
        // regroup: merge into a nearby friendly squad or carry on with what's left
        this.retreating = false;
        const other = w.squads.find((q) => q !== this && q.team === this.team && !q.retreating && q.alive.length && q.alive.length + alive.length <= 8 && q.leader.pos.distanceTo(lead.pos) < 25);
        if (other) {
          for (const m of alive) { other.members.push(m); m.squad = other; if (m.brain) m.brain.squad = other; m.slot = other.members.length - 1; }
          this.members = [];
          return;
        }
        this.started = alive.length;
      }
      return;
    }

    // where to go: a flanking waypoint first, then the objective; in sandbox, the enemy
    let goal = null;
    if (this.waypoint) {
      goal = this.waypoint;
      if (flat(lead.pos, this.waypoint) < 6) this.waypoint = null;
    }
    // each squad aims for its own side of a point so they don't all pile onto the flag
    if (!goal && this.objective) { const o = this.objective.pos; goal = V().set(o.x + Math.cos(this.holdA) * 5, 0, o.z + Math.sin(this.holdA) * 5); }
    if (!goal && !this.manual) {
      const e = this.nearestEnemy(lead.pos);
      goal = e ? e.pos : null;
    }
    if (this.manual && this.order) goal = this.order;

    // bounding overwatch: under fire the anchor creeps forward a few metres at a time
    const contact = this.inContact();
    if (!this.anchor) this.anchor = lead.pos.clone();
    if (goal) {
      const to = V().subVectors(goal, this.anchor).setY(0);
      const d = to.length();
      if (contact) {
        this.boundT -= dt;
        if (this.boundT <= 0) {
          this.boundT = rand(5, 8);
          this.bound ^= 1;
          // push forward if not badly outnumbered nearby
          const ratio = this.localRatio(lead.pos);
          if (ratio >= 0.8 && d > 3) this.anchor.addScaledVector(to.normalize(), Math.min(d, rand(6, 10)));
          else if (ratio < 0.45) {
            // pull back a little toward home
            const base = w.teams[this.team]?.base;
            if (base) this.anchor.addScaledVector(V().subVectors(base, this.anchor).setY(0).normalize(), 5);
          }
        }
      } else {
        // free movement: anchor runs ahead of the leader
        this.bound = 0;
        const ahead = Math.min(d, 9);
        if (d > 0.5) this.anchor.copy(lead.pos).addScaledVector(to.normalize(), ahead).setY(0);
        // on the point: settle on one side of it and watch the way the enemy will come
        this.holding = false;
        if (this.objective && flat(lead.pos, this.objective.pos) < this.objective.r * 1.2) {
          const o = this.objective.pos;
          this.anchor.set(o.x + Math.cos(this.holdA) * 4, 0, o.z + Math.sin(this.holdA) * 4);
          this.holding = true;
          let bd = Infinity;
          for (const t of w.teams) if (t.id !== this.team) { const d = t.base.distanceTo(o); if (d < bd) { bd = d; this.watch = t.base; } }
          if (this.watch) { this.facing = Math.atan2(this.watch.x - o.x, this.watch.z - o.z); return; }
        }
      }
      if (d > 0.5) this.facing = Math.atan2(goal.x - this.anchor.x, goal.z - this.anchor.z);
    } else this.anchor.copy(lead.pos).setY(0);
    if (contact && this.contact.pos) this.facing = Math.atan2(this.contact.pos.x - this.anchor.x, this.contact.pos.z - this.anchor.z);
  }

  // friendlies vs enemies within 30 m
  localRatio(pos) {
    let f = 0, e = 0;
    for (const u of this.world.nearUnits(pos.x, pos.z, 30)) {
      if (!u.alive) continue;
      if (u.team === this.team) f++;
      else if (hostile(u.team, this.team)) e++;
    }
    return e ? f / e : 9;
  }

  nearestEnemy(p) {
    let best = null, bd = Infinity;
    for (const u of this.world.units) {
      if (!u.alive || !hostile(u.team, this.team)) continue;
      const d = (u.pos.x - p.x) ** 2 + (u.pos.z - p.z) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  // formation slot for member i: a loose wedge facing the squad's direction
  slot(i) {
    const row = Math.floor((i + 1) / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
    const f = this.facing, sp = 3.2;
    const back = row * sp * 0.8, across = side * row * sp;
    return new THREE.Vector3(
      this.anchor.x - Math.sin(f) * back + Math.cos(f) * across, 0,
      this.anchor.z - Math.cos(f) * back - Math.sin(f) * across);
  }
}

export class Brain {
  constructor(unit, squad, world) {
    this.u = unit;
    this.squad = squad;
    this.w = world;
    this.thinkT = Math.random() * 0.4;
    this.target = null;
    this.seen = false;
    this.seenT = 0; // how long the current target has been in view
    this.react = 0;
    this.err = V();
    this.cover = null;
    this.goal = null;
    this.detour = null;
    this.detourT = 0;
    this.burst = 0;
    this.pause = 0;
    this.nadeT = rand(4, 10);
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = rand(1, 3);
    this.cands = [];
    this.lastPos = unit.pos.clone();
    this.stuckT = 0;
    this.skill = rand(0.75, 1.2);
    this.blocked = false;
    unit.ctrl.turnRate = 4.5 * this.skill;
  }

  releaseCover() {
    if (this.cover && this.cover.owner === this.u) this.cover.owner = null;
    this.cover = null;
  }

  hurtBy(from) {
    if (!from || !from.alive || from.team === this.u.team) return;
    // turn on whoever is shooting at us if we have nothing better
    if (!this.target || !this.seen) { this.target = from; this.react = Math.min(this.react, 0.15); }
  }

  update(dt) {
    const u = this.u;
    if (!u.alive) return;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = rand(0.25, 0.45);
      this.think();
    }
    this.act(dt);
  }

  // ---- slow decisions ----
  think() {
    const u = this.u, w = this.w, sq = this.squad;
    const def = u.weapon.def;
    const eye = u.eye(V());
    // perception: nearest few hostiles in range, checked for line of sight
    const near = w.nearUnits(u.pos.x, u.pos.z, SIGHT);
    const c = this.cands;
    c.length = 0;
    for (const e of near) {
      if (!e.alive || !hostile(e.team, u.team)) continue;
      const d2 = (e.pos.x - u.pos.x) ** 2 + (e.pos.z - u.pos.z) ** 2;
      if (d2 > SIGHT * SIGHT) continue;
      c.push({ e, d2 });
    }
    c.sort((a, b) => a.d2 - b.d2);
    let best = null, bs = Infinity, bestSeen = false;
    const tc = V();
    for (let i = 0; i < Math.min(c.length, 6); i++) {
      const { e, d2 } = c[i];
      const d = Math.sqrt(d2);
      e.center(tc);
      tc.y += 0.15;
      const vis = w.los(eye, tc);
      // the field of view is wide but not all round; noise and squad reports cover the rest
      const ang = Math.abs(wrap(Math.atan2(e.pos.x - u.pos.x, e.pos.z - u.pos.z) - u.facing));
      const noticed = vis && (ang < 1.6 || d < 10 || e === this.target || (e.lastShot !== undefined && e.t - e.lastShot < 0.6));
      let sc = d;
      if (!noticed) sc += 200;
      if (e === this.target) sc -= 6;
      if (sq.focus && e === sq.focus && sq.focus.alive && w.time - sq.focusT < 5) sc -= 12; // the squad's chosen target
      if (e.hp < 40) sc -= 7; // finish the wounded
      if (e.isPlayer) sc -= 2;
      if (d > def.range * 1.1) sc += 40;
      if (sc < bs) { bs = sc; best = e; bestSeen = noticed; }
    }
    if (best !== this.target) {
      if (best && bestSeen) {
        // new target: a beat to react, aim starts off loose
        this.react = rand(0.25, 0.6) / this.skill;
        const d = best.pos.distanceTo(u.pos);
        this.err.set(rand(-1, 1), rand(-0.5, 0.8), rand(-1, 1)).normalize().multiplyScalar(0.6 + d * 0.035);
        this.seenT = 0;
      }
      this.target = bestSeen ? best : this.target && this.target.alive ? this.target : null;
    }
    this.seen = !!(this.target && bestSeen && best === this.target);
    if (this.target && !this.target.alive) { this.target = null; this.seen = false; }
    if (this.seen) {
      sq.know(this.target, this.target.pos, true); this.target.spottedUntil = w.time + 2;
      // call the target so the rest of the squad piles on
      if (!sq.focus || !sq.focus.alive || w.time - sq.focusT > 3.5) { sq.focus = this.target; sq.focusT = w.time; }
    }

    // friendlies in the way?
    if (this.seen) {
      const m = u.muzzle(V());
      this.blocked = w.friendlyInLine(u, m, this.target.center(V()));
    } else this.blocked = false;

    // ---- where to stand
    const slot = sq.retreating ? sq.anchor.clone() : sq.slot(this.slotIndex());
    const contact = sq.inContact() || this.seen;
    const threat = this.seen ? this.target.pos : sq.contact?.pos;
    const lowHp = u.hp < 35;
    this.mission = u.kind === 'medic' && !this.seen && !sq.retreating && u.suppression < 0.3 ? this.medicMission() : null;
    if (this.mission) {
      this.releaseCover();
      const t = this.mission.unit;
      this.goal = Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z) < 1.5 ? u.pos.clone() : t.pos.clone();
    } else if (contact && threat) {
      // in a fight: take the best cover near the slot that faces the threat
      if (!this.cover || this.coverBad(this.cover, threat) || this.cover.prop.alive === false || this.cover.dist2(slot) > 100) {
        this.releaseCover();
        const range = sq.retreating || lowHp ? 14 : 9;
        const cv = this.findCover(sq.retreating || lowHp ? u.pos : slot, threat, range);
        if (cv) { this.cover = cv; cv.owner = u; }
      }
      if (this.cover) {
        // peek from tall cover, crouch behind low cover
        // (hysteresis: hold a peek or a duck for at least a moment so they don't bob in and out)
        const want = this.seen && this.react <= 0 && !u.busy && u.suppression < 0.75;
        if (want !== this.peeking && w.time - (this.peekT || 0) > 0.9) { this.peeking = want; this.peekT = w.time; }
        const shooting = this.peeking;
        this.goal = this.cover.high && shooting ? new THREE.Vector3(this.cover.px, 0, this.cover.pz) : new THREE.Vector3(this.cover.x, 0, this.cover.z);
      } else if (this.seen && (def.id === 'smg' || def.id === 'flame') && !lowHp) {
        // close-range weapons press in to their range
        const d = this.target.pos.distanceTo(u.pos);
        const want = (def.ideal[0] + def.ideal[1]) / 2;
        this.goal = d > want ? this.target.pos.clone().lerp(u.pos, want / d) : slot;
      } else this.goal = slot;
    } else if (sq.holding && sq.watch) {
      // holding a point: wait in cover facing the enemy's side
      if (!this.cover || this.cover.prop.alive === false || this.cover.dist2(slot) > 64) {
        this.releaseCover();
        const cv = this.findCover(slot, sq.watch, 8);
        if (cv) { this.cover = cv; cv.owner = u; }
      }
      this.goal = this.cover ? new THREE.Vector3(this.cover.x, 0, this.cover.z) : slot;
    } else {
      this.releaseCover();
      this.goal = slot;
    }
    this.goal.y = 0;

    // grenades: at a cluster, or at someone dug in behind cover
    this.nadeT -= 0.35;
    const g = u.weapons.findIndex((x) => x.id === 'grenade');
    if (g >= 0 && this.seen && this.nadeT <= 0 && u.weapons[g].mag > 0 && !u.busy) {
      const d = this.target.pos.distanceTo(u.pos);
      if (d > 7 && d < 20) {
        let cluster = 0;
        for (const e of w.nearUnits(this.target.pos.x, this.target.pos.z, 3.5)) if (e.alive && e.team === this.target.team) cluster++;
        const dug = this.target.kneelK > 0.5 || this.target.brain?.cover;
        let friends = 0;
        for (const f of w.nearUnits(this.target.pos.x, this.target.pos.z, 4)) if (f.alive && f.team === u.team) friends++;
        if ((cluster >= 3 || dug) && !friends && Math.random() < 0.55) {
          this.nade = { slot: g, back: u.wi, at: this.target.pos.clone() };
          this.nadeT = rand(10, 18);
        } else this.nadeT = rand(1.5, 4);
      }
    }
  }

  // nearest soldier who needs a medic: a fresh body to revive, or a wounded friend to patch up
  medicMission() {
    const u = this.u, w = this.w;
    let best = null, bs = Infinity;
    for (const m of w.units) {
      if (m === u || m.team !== u.team || m.removed) continue;
      const d = Math.hypot(m.pos.x - u.pos.x, m.pos.z - u.pos.z);
      if (d > 40) continue;
      let sc;
      if (!m.alive) { if (m.isPlayer || m.deadT > 10 || d > 30) continue; sc = d - 8; }
      else if (m.hp < 75) sc = d + m.hp * 0.15;
      else continue;
      if (sc >= bs) continue;
      // not into the middle of a firefight
      let danger = false;
      for (const e of w.nearUnits(m.pos.x, m.pos.z, 13)) if (e.alive && hostile(e.team, u.team)) { danger = true; break; }
      if (danger) continue;
      bs = sc; best = { unit: m, kind: m.alive ? 'heal' : 'revive' };
    }
    return best;
  }

  doMission(dt) {
    const m = this.mission, u = this.u, c = u.ctrl;
    const t = m.unit;
    if (!t || (m.kind === 'revive') === t.alive) { this.mission = null; this.reviveT = 0; return false; }
    const d = Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z);
    if (d > 2.4) { this.reviveT = 0; return false; }
    c.aimAt = null; c.fire = false; c.kneel = true;
    if (m.kind === 'heal') t.hp = Math.min(100, t.hp + 16 * dt);
    else {
      this.reviveT = (this.reviveT || 0) + dt;
      if (this.reviveT >= 2.5) { this.w.revive(t); this.reviveT = 0; this.mission = null; }
    }
    return true;
  }

  slotIndex() {
    const m = this.squad.members.filter((x) => x.alive);
    return Math.max(0, m.indexOf(this.u));
  }

  coverBad(cv, threat) {
    // cover is good when the prop lies between us and the threat
    const tx = threat.x - cv.x, tz = threat.z - cv.z;
    const l = Math.hypot(tx, tz) || 1;
    return (tx * -cv.nx + tz * -cv.nz) / l < 0.35;
  }

  findCover(around, threat, range) {
    const w = this.w, u = this.u;
    let best = null, bs = Infinity;
    for (const p of w.propGrid.near(around.x, around.z, range, [])) {
      for (const s of p.cover) {
        if (s.owner && s.owner !== u && s.owner.alive) continue;
        const dx = s.x - around.x, dz = s.z - around.z;
        const d = Math.hypot(dx, dz);
        if (d > range) continue;
        const tx = threat.x - s.x, tz = threat.z - s.z;
        const tl = Math.hypot(tx, tz) || 1;
        const facing = (tx * -s.nx + tz * -s.nz) / tl;
        if (facing < 0.5) continue;
        if (tl < 4) continue;
        const travel = Math.hypot(s.x - u.pos.x, s.z - u.pos.z);
        const sc = d + travel * 0.5 - facing * 3 + (s.high ? -0.5 : 0);
        if (sc < bs) { bs = sc; best = s; }
      }
    }
    if (best && !best.dist2) best.dist2 = function (p) { return (this.x - p.x) ** 2 + (this.z - p.z) ** 2; };
    return best;
  }

  // ---- every frame: move, aim, shoot ----
  act(dt) {
    const u = this.u, c = u.ctrl, w = this.w, sq = this.squad;
    const def = u.weapon.def;

    if (this.mission && this.doMission(dt)) { c.wx = c.wz = 0; c.sprint = false; return; }
    // movement toward the goal, around props
    let wx = 0, wz = 0;
    const goal = this.goal || u.pos;
    const gx = goal.x - u.pos.x, gz = goal.z - u.pos.z;
    const gd = Math.hypot(gx, gz);
    const inCover = this.cover && gd < 0.6;
    if (gd > 0.5) {
      let tx = goal.x, tz = goal.z;
      this.detourT -= dt;
      if (this.detour && this.detourT > 0) { tx = this.detour.x; tz = this.detour.z; if (Math.hypot(tx - u.pos.x, tz - u.pos.z) < 0.6) this.detour = null; }
      else {
        this.detour = null;
        const look = Math.min(gd, 7);
        const ex = u.pos.x + (gx / gd) * look, ez = u.pos.z + (gz / gd) * look;
        const p = w.segBlocked(u.pos.x, u.pos.z, ex, ez, 0.35);
        if (p && !(this.cover && this.cover.prop === p && gd < 2)) {
          // round the nearest clear corner
          let best = null, bs = Infinity;
          for (const [cx, cz] of w.boxCorners(p.box, 0.75)) {
            if (w.segBlocked(u.pos.x, u.pos.z, cx, cz, 0.3) === p) continue;
            const sc = Math.hypot(cx - u.pos.x, cz - u.pos.z) + Math.hypot(goal.x - cx, goal.z - cz);
            if (sc < bs) { bs = sc; best = { x: cx, z: cz }; }
          }
          if (best) { this.detour = best; this.detourT = 1.2; tx = best.x; tz = best.z; }
        }
      }
      const dx = tx - u.pos.x, dz = tz - u.pos.z, dl = Math.hypot(dx, dz) || 1;
      const k = Math.min(1, gd / 1.2);
      wx = (dx / dl) * k; wz = (dz / dl) * k;
    }
    // spacing from squadmates
    for (const m of w.nearUnits(u.pos.x, u.pos.z, 2.8)) {
      if (m === u || !m.alive || m.team !== u.team) continue;
      const dx = u.pos.x - m.pos.x, dz = u.pos.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 2.6) { wx += (dx / d) * (2.6 - d) * 0.5; wz += (dz / d) * (2.6 - d) * 0.5; }
    }
    // a little lateral shuffle in a firefight when not in cover
    if (this.seen && !this.cover && def.id !== 'mg' && gd < 1.5) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = rand(1.2, 2.8); }
      const yaw = Math.atan2(this.target.pos.x - u.pos.x, this.target.pos.z - u.pos.z);
      wx += Math.cos(yaw) * this.strafe * 0.35; wz += -Math.sin(yaw) * this.strafe * 0.35;
    }
    let wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    // an enemy grenade about to go off nearby: get away from it
    let evading = false;
    for (const g of w.projectiles) {
      if (g.type !== 'grenade' || (g.owner && g.owner.team === u.team)) continue;
      const gx0 = u.pos.x - g.pos.x, gz0 = u.pos.z - g.pos.z, gd0 = Math.hypot(gx0, gz0);
      if (gd0 < 5.5 && g.fuse < 1.8) { wx = (gx0 / (gd0 || 1)); wz = (gz0 / (gd0 || 1)); evading = true; break; }
    }
    // smooth the steering so pushes from squadmates and detours don't twitch the legs
    const sm = 1 - Math.exp(-7 * dt);
    c.wx += (wx - c.wx) * sm; c.wz += (wz - c.wz) * sm;
    if (Math.hypot(c.wx, c.wz) < 0.06) c.wx = c.wz = 0;
    wl = Math.hypot(c.wx, c.wz);
    // sprint when far from the squad and nobody is shooting
    // run when there's ground to cover: advancing, flanking, falling back, or caught in the open
    // (the unit itself stops sprinting the moment it needs to shoot or runs out of stamina)
    const open = !this.cover || gd > 3;
    c.sprint = evading || open && ((gd > 7 && (!this.seen || sq.retreating || u.suppression > 0.25)) || gd > 16 || (sq.retreating && gd > 3));
    c.speed = 1;

    // stuck on something: step sideways, away from the way we were pushing
    this.stuckT += dt;
    if (this.stuckT > 1) {
      const moved = this.lastPos.distanceTo(u.pos);
      if (wl > 0.4 && moved < 0.3) {
        const side = Math.random() < 0.5 ? -1 : 1, l = wl || 1;
        this.detour = { x: u.pos.x - (c.wz / l) * 2.5 * side - (c.wx / l) * 0.8, z: u.pos.z + (c.wx / l) * 2.5 * side - (c.wz / l) * 0.8 };
        this.detourT = 1.2;
      }
      this.lastPos.copy(u.pos);
      this.stuckT = 0;
    }

    // grenade throw in progress
    if (this.nade) {
      const n = this.nade;
      if (u.wi !== n.slot) { u.setWeapon(n.slot); u.cool = 0.2; }
      u.throwAt = n.at;
      c.aimAt = n.at.clone().setY(n.at.y + 1);
      c.kneel = false;
      if (u.throwT <= 0 && !u.thrown) c.fire = u.cool <= 0;
      else c.fire = false;
      if (u.thrown && u.throwT <= 0) { u.setWeapon(n.back); this.nade = null; u.throwAt = null; }
      return;
    }

    // aim
    const t = this.target;
    const sup = u.suppression;
    if (t && t.alive && this.seen) {
      this.react -= dt;
      this.seenT += dt;
      // aim error tightens while tracking; suppression and movement loosen it
      const d = t.pos.distanceTo(u.pos);
      const floor = (0.12 + d * 0.006) / this.skill;
      const k = Math.exp(-dt * 1.4 * this.skill * (1 - sup * 0.6));
      this.err.multiplyScalar(k);
      if (this.err.length() < floor) this.err.setLength(floor);
      if (Math.hypot(t.vel.x, t.vel.z) > 1) this.err.x += rand(-1, 1) * dt * 0.6;
      const aim = t.center(V()).add(this.err);
      // lead slow projectiles
      if (def.kind === 'projectile' && def.speed) aim.addScaledVector(t.vel, (d / def.speed) * 0.8);
      if (def.gravity) {
        // ballistic lob: low-angle solution for the range
        const th = 0.5 * Math.asin(Math.min(1, (def.gravity * d) / (def.speed * def.speed)));
        aim.y = u.eye(V()).y + Math.tan(th) * d + (t.pos.y - u.pos.y);
      }
      c.aimAt = aim;
      this.lastAim = aim; this.lastAimT = w.time;
      const inRange = d < def.range * (def.kind === 'flame' ? 1 : 0.95);
      // bursts with pauses; low cover means kneeling between bursts
      let fire = false;
      if (this.react <= 0 && inRange && !this.blocked && sup < 0.85) {
        if (this.pause > 0) this.pause -= dt;
        else {
          fire = true;
          if (u.shots !== this.lastShots) { this.lastShots = u.shots; this.burst--; }
          if (this.burst <= 0) {
            this.burst = Math.round(rand(def.burst[0], def.burst[1]));
            this.pause = def.auto ? rand(0.25, 0.7) : rand(0.1, 0.5);
            fire = false;
          }
        }
      }
      // mortar: lob only at longer range
      if (def.id === 'launcher' && d < 9) fire = false;
      c.fire = fire;
      c.kneel = (inCover && !this.cover.high) || (!this.cover && (def.id === 'mg' || def.id === 'rifle' || def.id === 'launcher') && wl < 0.3) || sup > 0.6;
      if (inCover && !this.cover.high && sup > 0.6) c.fire = false;
      // caught in the open under heavy fire, or a gunner settling in: go prone for a while
      if (!this.cover && (sup > 0.8 || (def.id === 'mg' && wl < 0.2 && this.seenT > 1.5))) this.proneUntil = w.time + rand(2, 4);
      c.prone = w.time < (this.proneUntil || 0) && !sq.retreating;
    } else {
      this.react = Math.max(this.react, 0.15);
      c.fire = false;
      // suppressive fire: gunners keep the enemy's heads down where they were last seen
      const ct = sq.contact;
      if (def.id === 'mg' && ct && w.time - ct.t < 4 && u.weapon.mag > 8 && !u.busy) {
        const dd = Math.hypot(ct.pos.x - u.pos.x, ct.pos.z - u.pos.z);
        if (dd > 6 && dd < def.range * 0.9) {
          c.aimAt = ct.pos.clone().setY(U.BODY_Y + ct.pos.y);
          c.fire = Math.floor(w.time * 2.4 + u.id) % 3 !== 2 && !w.friendlyInLine(u, u.muzzle(V()), c.aimAt);
          c.kneel = !this.cover?.high;
          return;
        }
      }
      c.prone = w.time < (this.proneUntil || 0) && gd < 1;
      // look where trouble was, or where we're going
      const look = sq.contact && w.time - sq.contact.t < 8 ? sq.contact.pos : sq.holding && gd < 1 ? sq.watch : null;
      // keep the gun on the last spot for a moment after losing sight, instead of snapping away
      if (this.lastAim && w.time - this.lastAimT < 1.2) c.aimAt = this.lastAim;
      else c.aimAt = look ? look.clone().setY(U.BODY_Y + look.y) : null;
      c.kneel = !!(inCover && sq.inContact());
      if (u.weapon.mag < u.weapon.def.mag * 0.5 && !u.busy) c.reload = true;
    }
    if (u.wi !== 0 && !this.nade && u.weapon.id === 'grenade') u.setWeapon(0);
  }
}
