import * as THREE from 'three';
import { hostile } from './factions.js';
import { wrap } from './physics.js';
import { U } from './rig.js';
import { height } from './terrain.js';
import { PROPS } from './props.js';

// Three layers of AI:
//  Commander (one per army): every few seconds hands each squad an objective, a control point
//    to take or hold, and sends a second squad on the same point round the flank.
//  Squad: moves as a loose wedge toward its objective; on contact it goes to ground, then
//    advances in bounds (half the squad moves while the other half covers), and falls back
//    to friendly ground when it has been shot to pieces.
//  Brain (one per soldier): spots enemies (line of sight, range, a short reaction delay),
//    picks targets, aims with an error that tightens while tracking, fires in bursts, takes
//    cover, throws grenades at clusters and at enemies dug in behind cover.
//  Morale (per soldier): suppression, wounds, losing mates or the leader and being outnumbered
//    wear it down; soldiers hesitate, cower, fall back, rout, and a beaten few surrender. A
//    leader or friends close by, and quiet, win it back. A squad that mostly breaks retreats.
//  Fireteams: pinned squads split, one half holds and suppresses while the other swings
//    through dead ground to the enemy's flank. Contact reports pass to nearby squads, medics
//    drag casualties out of the line of fire, and squads scatter from artillery and air strikes.

const V = () => new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
// distance across the ground, ignoring height (points and waypoints sit on hills and in hollows)
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const BASE_SIGHT = 70;
let SIGHT = BASE_SIGHT;
// weather and darkness shorten how far soldiers can pick out an enemy
export function setSight(k) { SIGHT = BASE_SIGHT * k; }

const clamp = THREE.MathUtils.clamp;
const stat = (w, k) => { const a = w.aiStats || (w.aiStats = {}); a[k] = (a[k] || 0) + 1; };
const BIG_BLAST = 4.5; // shells and bombs, not grenades

// Battle events reach the AI as they happen (the game clears them every frame): deaths shake
// the dead soldier's squad, blasts make everyone near duck, and a run of heavy blasts in one
// place is incoming fire that squads clear out of.
function hear(w, e) {
  if (e.type === 'death') {
    const v = e.unit, sq = v?.squad;
    if (!sq) return;
    const lead = v === sq.lead || v === sq.members[0];
    for (const m of sq.members) {
      if (m === v || !m.alive || !m.brain) continue;
      const d = Math.hypot(m.pos.x - v.pos.x, m.pos.z - v.pos.z);
      if (d < 30) m.brain.moraleHit((lead ? 0.2 : 0.1) * (d < 12 ? 1 : 0.55));
    }
    if (e.from && e.from.alive && e.from.brain && e.from.team !== v.team) e.from.brain.moraleHit(-0.07);
  } else if (e.type === 'boom') {
    for (const u of w.nearUnits(e.pos.x, e.pos.z, e.r * 3.5 + 6)) {
      if (!u.alive || u.isPlayer || !u.brain) continue;
      u.brain.blastNear(e.pos, e.r, Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z));
    }
    if (e.r < BIG_BLAST) return;
    const rec = w.aiBlasts || (w.aiBlasts = []);
    rec.push({ t: w.time, x: e.pos.x, z: e.pos.z });
    while (rec.length && w.time - rec[0].t > 9) rec.shift();
    let n = 0;
    for (const b of rec) if (Math.hypot(b.x - e.pos.x, b.z - e.pos.z) < 30) n++;
    if (n < 4) return;
    for (const sq of w.squads) {
      const l = sq.alive.length ? sq.leader : null;
      if (l && Math.hypot(l.pos.x - e.pos.x, l.pos.z - e.pos.z) < 28) sq.scatter(e.pos);
    }
  }
}
function listen(w) {
  const ev = w.events;
  if (!ev || ev.aiHook) return;
  ev.aiHook = true;
  const push = ev.push.bind(ev);
  ev.push = (...a) => { for (const e of a) hear(w, e); return push(...a); };
}

export class Commander {
  constructor(world, team) {
    this.world = world;
    this.team = team;
    this.t = Math.random() * 2;
    listen(world);
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
    // a couple of squads garrison held ground, the rest push on; nobody sits on a safe point
    const garrisonMax = Math.max(1, Math.floor(squads.length / 4));
    let garrison = squads.filter((s) => s.objective && s.objective.owner === this.team && !s.objective.contested && !s.retreating).length;
    const enemyDist = (p) => {
      let bd = Infinity;
      for (const t of w.teams) if (t.id !== this.team) bd = Math.min(bd, t.base.distanceTo(p.pos));
      return bd;
    };
    for (const s of squads) {
      if (s.manual || s.retreating) continue;
      const lead = s.leader;
      if (!lead) continue;
      const cur = s.objective;
      // commit: keep going while the point is still being taken, or we are on it and winning
      if (cur && cur.owner !== this.team) {
        const onIt = flat(lead.pos, cur.pos) < cur.r * 2;
        if (s.objT < (onIt ? 90 : 60)) continue;
      }
      if (cur && cur.owner === this.team && cur.contested) continue; // defend a point under attack
      const sitting = cur && cur.owner === this.team && !cur.contested;
      if (sitting && garrison <= garrisonMax && s.objT < 45) continue; // allowed garrison, rotates out after a while
      let best = null, bs = -Infinity;
      for (const p of pts) {
        let sc = -lead.pos.distanceTo(p.pos);
        if (p.owner === this.team) {
          if (p.contested) sc += 45; // reinforce a point under attack
          else sc -= 120 + (p === cur ? 40 : 0); // safe: no need
        } else if (p.owner < 0) sc += 26;
        else sc += 34; // enemy ground: take it back
        const l = load.get(p) || 0;
        if (l >= cap) sc -= 60 * (l - cap + 1);
        // points nearer the enemy first, so the line moves forward
        sc -= enemyDist(p) * 0.15;
        if (p === cur) sc -= 25; // freshly done with this one
        sc += Math.random() * 8;
        if (sc > bs) { bs = sc; best = p; }
      }
      if (best && best !== cur) {
        if (cur) load.set(cur, (load.get(cur) || 1) - 1);
        load.set(best, (load.get(best) || 0) + 1);
        if (sitting) garrison--;
        if (best.owner === this.team && !best.contested) garrison++;
        // a second squad on the same point swings wide
        const others = squads.filter((q) => q !== s && q.objective === best);
        s.setObjective(best, others.length % 2 === 1 ? (Math.random() < 0.5 ? -1 : 1) : 0);
      } else if (best === cur) s.objT = 0;
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
    this.cautious = false; // enemy close enough that nobody strolls across open ground
    this.foePos = null;
    this.manv = null; // fireteam flank: { pos, t } while the manoeuvre half swings round
    this.heard = null; // contact report from a neighbouring squad: { pos, at, t }
    this.displace = null; // scattering from heavy blasts: { to, until }
    this.assault = false;
    listen(world);
  }

  get alive() { return this.members.filter((m) => m.alive); }
  get size() { let n = 0; for (const m of this.members) if (m.alive) n++; return n; }
  get leader() {
    const l = this.lead;
    if (l && l.alive && l.squad === this) return l;
    return this.members.find((m) => m.alive) || null;
  }

  // the leader is wedged against something: someone nearer the goal takes the lead
  stalled(u) { if (u === this.leader) this.rotate = true; }

  rotateLeader(goal) {
    const cur = this.leader;
    let best = null, bd = Infinity;
    for (const m of this.members) {
      if (!m.alive || m === cur || (m.brain && m.brain.stallT > 1.5)) continue;
      const d = goal ? flat(m.pos, goal) : 0;
      if (d < bd) { bd = d; best = m; }
    }
    if (best) { this.lead = best; this.anchor = best.pos.clone().setY(0); }
    this.ldStall = 0; this.rotate = false;
  }

  add(u) { this.members.push(u); this.started++; u.slot = this.members.length - 1; }

  setObjective(p, flank = 0) {
    this.objective = p;
    if (p) {
      // squads sharing a point settle on different sides of it
      const n = this.world.squads.filter((q) => q !== this && q.team === this.team && q.objective === p).length;
      this.holdA = (Math.atan2(this.world.teams[this.team]?.base.z - p.pos.z, this.world.teams[this.team]?.base.x - p.pos.x) || 0) + n * 2.2 + rand(-0.3, 0.3);
      this.holdR = 4 + (n % 3) * 2;
    }
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
    // call it out on the radio: squads close to the fight hear where, a moment later and not quite exactly
    if (seen && now - (this.reportT || -9) > 2.5) {
      this.reportT = now;
      for (const q of this.world.squads) {
        if (q === this || q.team !== this.team || q.manual || !q.members.length) continue;
        const l = q.alive.length ? q.leader : null;
        if (!l || flat(l.pos, pos) > 60 || flat(l.pos, pos) < 14) continue;
        if (q.inContact()) continue;
        q.heard = { pos: pos.clone().add(V().set(rand(-3, 3), 0, rand(-3, 3))), at: now + rand(0.5, 1.2), t: now };
      }
    }
  }

  // heavy blasts landing on us: clear out of the beaten zone
  scatter(from) {
    const w = this.world, l = this.leader;
    if (!l || this.manual || this.retreating || w.time < (this.scatterCool || 0)) return;
    this.scatterCool = w.time + 40;
    const dx = l.pos.x - from.x, dz = l.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    // away, with a sideways drift so a squad doesn't run along the shell line
    const sd = Math.random() < 0.5 ? -1 : 1;
    const to = V().set(l.pos.x + (dx / d) * 24 - (dz / d) * 10 * sd, 0, l.pos.z + (dz / d) * 24 + (dx / d) * 10 * sd);
    to.x = clamp(to.x, -w.edge, w.edge); to.z = clamp(to.z, -w.edge, w.edge);
    this.displace = { to, until: w.time + 7 };
    this.manv = null;
    stat(w, 'scatter');
    for (const m of this.alive) m.brain?.moraleHit(0.08);
  }

  startRetreat(lead) {
    const w = this.world;
    this.retreating = true;
    this.retreatT = 0;
    this.manv = null;
    const safe = w.points.filter((p) => p.owner === this.team && !p.contested);
    const base = w.teams[this.team]?.base;
    let best = base ? { pos: base } : null, bd = Infinity;
    for (const p of safe) { const d = p.pos.distanceTo(lead.pos); if (d < bd && d > 12) { bd = d; best = p; } }
    this.fallback = best ? best.pos.clone() : lead.pos.clone();
    stat(w, 'squadRetreat');
  }

  // pinned: the odd-numbered half swings round through ground the enemy can't see while the
  // rest keep their heads down
  startManoeuvre(lead, cp) {
    const w = this.world;
    const to = V().subVectors(cp, lead.pos).setY(0), cd = to.length();
    to.normalize();
    const perp = V().set(-to.z, 0, to.x);
    const eye = V().set(cp.x, height(cp.x, cp.z) + 1.5, cp.z);
    w.nav.build(w.props, w.propVer);
    let best = null, bs = Infinity;
    for (const side of [-1, 1]) for (const lat of [16, 24]) for (const f of [0.55, 0.8]) {
      const x = clamp(lead.pos.x + to.x * cd * f + perp.x * side * lat, -w.edge, w.edge);
      const z = clamp(lead.pos.z + to.z * cd * f + perp.z * side * lat, -w.edge, w.edge);
      if (w.nav.blocked[w.nav.cellOf(x, z)]) continue;
      const hidden = !w.los(eye, V().set(x, height(x, z) + 0.9, z));
      // dead ground first, then a short walk, and the other side to last time
      const sc = (hidden ? 0 : 28) + lat * 0.5 + (side === this.flankSide ? 0 : 3) + Math.random() * 2;
      if (sc < bs) { bs = sc; best = { x, z, side }; }
    }
    if (!best) return false;
    this.flankSide = best.side;
    this.manv = { pos: V().set(best.x, 0, best.z), t: w.time, hidden: bs < 20 };
    stat(w, 'fireteamFlank');
    if (this.manv.hidden) stat(w, 'deadGroundFlank');
    return true;
  }

  inContact() { return this.contact && this.world.time - this.contact.t < 6; }

  update(dt) {
    const alive = this.alive;
    if (!alive.length) return;
    this.objT += dt;
    const lead = this.leader;
    const w = this.world;
    // shot to pieces in a fight, or most of what is left has lost its nerve: fall back to friendly ground
    if (!this.retreating && this.inContact()) {
      let broken = 0;
      for (const m of alive) if (m.brain && m.brain.broken) broken++;
      const shot = this.started >= 4 && alive.length <= Math.max(1, Math.floor(this.started * 0.34));
      if (shot || (alive.length >= 3 && broken >= Math.max(3, Math.ceil(alive.length * 0.6)))) this.startRetreat(lead);
    }
    if (this.displace) {
      if (w.time > this.displace.until || this.retreating) this.displace = null;
      else { this.anchor = this.displace.to; this.facing = Math.atan2(this.displace.to.x - lead.pos.x, this.displace.to.z - lead.pos.z); return; }
    }
    if (this.retreating) {
      this.retreatT += dt;
      this.anchor = this.fallback;
      if (flat(lead.pos, this.fallback) < 6 || this.retreatT > 30) {
        // regroup: merge into a nearby friendly squad or carry on with what's left
        this.retreating = false;
        for (const m of alive) if (m.brain) m.brain.rally(0.3);
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
    if (!goal && this.objective) { const o = this.objective.pos; goal = V().set(o.x + Math.cos(this.holdA) * (this.holdR || 5), 0, o.z + Math.sin(this.holdA) * (this.holdR || 5)); }
    if (!goal && !this.manual) {
      const e = this.nearestEnemy(lead.pos);
      goal = e ? e.pos : null;
    }
    if (this.manual && this.order) goal = this.order;

    // the whole squad follows the leader, so a stuck leader stalls everyone: pass the lead on
    this.ldT = (this.ldT || 0) + dt;
    if (this.ldT >= 1) {
      this.ldT = 0;
      if (!this.ldPos) this.ldPos = lead.pos.clone();
      const moved = this.ldPos.distanceTo(lead.pos);
      this.ldPos.copy(lead.pos);
      const far = goal && flat(lead.pos, goal) > 8;
      if (far && !this.inContact() && !this.holding && moved < 0.5) this.ldStall = (this.ldStall || 0) + 1; else this.ldStall = 0;
    }
    if (this.rotate || (this.ldStall || 0) >= 4) this.rotateLeader(goal);

    // wary: an enemy within ~100 m, seen or not. Move cover to cover in bounds, never stroll across open ground
    this.cautious = false; this.foePos = null;
    let fd = 62;
    for (const m of alive) { const b = m.brain; if (b && b.foe && b.foeD < fd) { fd = b.foeD; this.foePos = b.foe; this.cautious = true; } }
    // a report from a neighbour counts as an enemy about, so squads going into a fight come in wary
    if (!this.foePos && this.heard && w.time >= this.heard.at && w.time - this.heard.t < 9 && flat(lead.pos, this.heard.pos) < 60) { this.foePos = this.heard.pos; this.cautious = true; }
    if (this.cautious && this.objective && flat(lead.pos, this.objective.pos) < this.objective.r * 1.2) this.cautious = false;
    // assault: close to enemy ground and not outnumbered, stop creeping and rush the point
    const obj = this.objective;
    this.assault = false;
    if (obj && obj.owner !== this.team && !this.manual && flat(lead.pos, obj.pos) < obj.r * 2.8 && this.size >= 3 && this.localRatio(lead.pos) >= 1.1) {
      this.assault = true; this.cautious = false;
    }
    // a squad that has crept along for a while without really gaining ground stops being wary and runs
    this.creepT = this.cautious && !this.inContact() ? (this.creepT || 0) + dt : Math.max(0, (this.creepT || 0) - dt * 2);
    if (this.creepT > 18) { this.cautious = false; if (this.creepT > 30) this.creepT = 0; }
    const fight = this.inContact();
    const contact = fight || this.cautious;
    // bounding overwatch: under fire the anchor creeps forward a few metres at a time
    if (!this.anchor) this.anchor = lead.pos.clone();
    if (goal) {
      const to = V().subVectors(goal, this.anchor).setY(0);
      const d = to.length();
      if (contact) {
        // pinned down head-on for too long: swing wide round the enemy's flank
        this.pinT = (this.pinT || 0) + dt;
        if (this.manv) {
          // the flank is on: done when the swinging half arrives (or it takes too long or the fight goes quiet)
          const mv = this.manv, team = alive.filter((m, i) => i % 2 === 1);
          let near = 0;
          for (const m of team) if (flat(m.pos, mv.pos) < 9) near++;
          const el = w.time - mv.t;
          if (el > 28 || !team.length || near >= Math.ceil(team.length / 2) || (!fight && el > 8)) {
            // the base of fire follows up to where the flank ended
            this.anchor.set(mv.pos.x, 0, mv.pos.z);
            this.manv = null;
            this.pinT = 0; this.pinRef = null;
            this.flankCool = w.time + 30;
            stat(w, near ? 'flankArrived' : 'flankAborted');
          }
        } else if (fight && this.pinT > 14 && !this.waypoint && w.time > (this.flankCool || 0) && this.contact?.pos) {
          const cp = this.contact.pos, to = V().subVectors(cp, lead.pos).setY(0), cd = to.length();
          const progress = this.pinRef == null ? 99 : this.pinRef - cd;
          this.pinRef = cd;
          if (progress < 5 && cd > 12 && this.size >= 4 && this.startManoeuvre(lead, cp)) {
            this.flankCool = w.time + 45;
          } else if (progress < 5 && cd > 12 && this.size >= 3) {
            to.normalize();
            const side = this.flankSide = -(this.flankSide || (Math.random() < 0.5 ? -1 : 1));
            const wp = lead.pos.clone().addScaledVector(to, Math.min(cd * 0.6, 20)).addScaledVector(V().set(-to.z, 0, to.x), side * 24);
            wp.x = THREE.MathUtils.clamp(wp.x, -w.edge, w.edge); wp.z = THREE.MathUtils.clamp(wp.z, -w.edge, w.edge);
            wp.y = 0;
            this.waypoint = wp;
            this.flankCool = w.time + 45;
            this.anchor.copy(lead.pos).setY(0);
          }
          this.pinT = 0;
        }
        this.boundT -= dt;
        if (this.boundT <= 0 && this.manv) this.boundT = 2; // the base of fire stays put while the flank goes in
        if (this.boundT <= 0) {
          this.boundT = fight ? rand(4, 6.5) : rand(2.5, 4);
          this.bound ^= 1;
          // push forward if not badly outnumbered nearby
          const ratio = this.localRatio(lead.pos);
          this.holdBounds = ratio >= 0.8 ? 0 : (this.holdBounds || 0) + 1;
          if ((ratio >= 0.8 || this.holdBounds >= 3) && d > 3) { this.anchor.addScaledVector(to.normalize(), Math.min(d, fight ? rand(7, 11) : rand(11, 16))); this.holdBounds = 0; }
          else if (ratio < 0.45 && this.holdBounds < 3) {
            // pull back a little toward home
            const base = w.teams[this.team]?.base;
            if (base) this.anchor.addScaledVector(V().subVectors(base, this.anchor).setY(0).normalize(), 5);
          }
        }
      } else {
        // free movement: anchor runs ahead of the leader
        this.manv = null;
        this.bound = 0;
        this.pinT = 0;
        this.pinRef = null;
        const ahead = Math.min(d, 9);
        if (d > 0.5) this.anchor.copy(lead.pos).addScaledVector(to.normalize(), ahead).setY(0);
        // on the point: settle on one side of it and watch the way the enemy will come
        this.holding = false;
        if (this.objective && flat(lead.pos, this.objective.pos) < this.objective.r * 1.2) {
          const o = this.objective.pos;
          this.anchor.set(o.x + Math.cos(this.holdA) * (this.holdR || 4), 0, o.z + Math.sin(this.holdA) * (this.holdR || 4));
          this.holding = true;
          let bd = Infinity;
          for (const t of w.teams) if (t.id !== this.team) { const d = t.base.distanceTo(o); if (d < bd) { bd = d; this.watch = t.base; } }
          if (this.watch) { this.facing = Math.atan2(this.watch.x - o.x, this.watch.z - o.z); return; }
        }
      }
      if (d > 0.5) this.facing = Math.atan2(goal.x - this.anchor.x, goal.z - this.anchor.z);
    } else this.anchor.copy(lead.pos).setY(0);
    const face = fight && this.contact.pos ? this.contact.pos : this.cautious ? this.foePos : null;
    if (face) this.facing = Math.atan2(face.x - this.anchor.x, face.z - this.anchor.z);
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
    this.defT = 0;
    this.clear = true;
    this.clearT = 0;
    this.blockT = 0;
    this.overwatch = false;
    this.stallT = 0; // how long we've wanted to move and haven't
    this.path = null;
    this.pathGoal = V();
    this.laneP = { x: 0, z: 0 };
    this.pi = 0;
    this.direct = true;
    this.directT = Math.random() * 0.3;
    this.repath = false;
    this.badCover = null;
    this.badUntil = 0;
    this.skill = rand(0.75, 1.2);
    this.blocked = false;
    unit.ctrl.turnRate = 2.8 * this.skill;
    // morale: 1 is cool and steady, 0 is gone. Nerve is how well this soldier takes it.
    this.nerve = rand(0.85, 1.2);
    this.morale = rand(0.85, 1);
    this.broken = false;
    this.state = 'steady'; // steady | shaken | cower | retreat | rout | surrender
    this.diveUntil = 0;
    this.mv = false; // in the fireteam swinging round the flank
    this.drag = null;
    listen(world);
  }

  // ---- morale ----
  moraleHit(k) {
    this.morale = clamp(this.morale - (k > 0 ? k / this.nerve : k), 0, 1);
  }

  rally(k) {
    this.morale = clamp(this.morale + k, 0, 1);
    if (this.morale * this.nerve > 0.42) this.broken = false;
  }

  // a blast nearby: duck, and a close one shakes the nerve
  blastNear(pos, r, d) {
    const u = this.u, w = this.w;
    if (d < r * 3.5) {
      if (!this.cover || d < r * 1.5) this.diveUntil = Math.max(this.diveUntil, w.time + rand(1.2, 2.6));
      this.moraleHit(0.12 * (1 - d / (r * 3.5)) * (r >= BIG_BLAST ? 1.6 : 1));
    }
    // out of nowhere: the squad knows there is trouble in that direction
    const sq = this.squad;
    if (!sq.inContact() && !sq.foePos && d < r * 4 + 10) sq.heard = { pos: pos.clone(), at: w.time, t: w.time };
    void u;
  }

  // where a beaten soldier runs: back toward friendly ground, away from whatever is shooting
  fleeGoal() {
    const u = this.u, w = this.w, sq = this.squad;
    if (this.flee && w.time - this.flee.t < 4) return this.flee.pos;
    const th = sq.contact?.pos || sq.foePos || sq.heard?.pos;
    const base = w.teams[u.team]?.base;
    let ax = 0, az = 0;
    if (th) { ax = u.pos.x - th.x; az = u.pos.z - th.z; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
    let bx = 0, bz = 0;
    if (base) { bx = base.x - u.pos.x; bz = base.z - u.pos.z; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
    let dx = ax + bx * 0.8, dz = az + bz * 0.8;
    const l = Math.hypot(dx, dz);
    if (l < 0.01) { dx = bx || 1; dz = bz; } else { dx /= l; dz /= l; }
    const pos = V().set(clamp(u.pos.x + dx * 30, -w.edge, w.edge), 0, clamp(u.pos.z + dz * 30, -w.edge, w.edge));
    w.nav.build(w.props, w.propVer);
    const c = w.nav.cellOf(pos.x, pos.z);
    if (w.nav.blocked[c]) { const oc = w.nav.open(c); if (oc >= 0) { const q = w.nav.center(oc, { x: 0, z: 0 }); pos.x = q.x; pos.z = q.z; } }
    this.flee = { pos, t: w.time };
    return pos;
  }

  updateMorale() {
    const u = this.u, w = this.w, sq = this.squad;
    const dt = Math.min(1, w.time - (this.mT ?? w.time));
    this.mT = w.time;
    if (dt <= 0) return;
    const sup = u.suppression;
    let m = this.morale;
    // wear
    m -= dt * (sup * 0.1 + (u.hp < 35 ? 0.025 : 0) + (u.shock > 0 ? 0.07 : 0) + (u.bleed > 0.5 ? 0.01 : 0)) / this.nerve;
    let f = 0, e = 0, near = 0;
    for (const o of w.nearUnits(u.pos.x, u.pos.z, 30)) {
      if (!o.alive || o === u) continue;
      if (o.team === u.team) { f++; if (Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z) < 10) near++; }
      else if (hostile(o.team, u.team)) e++;
    }
    const fighting = this.seen || sq.inContact();
    if (fighting && e > f + 1) m -= dt * 0.035 * Math.min(1, (e - f) / 4) / this.nerve;
    // recovery: quiet, company and a leader nearby
    if (sup < 0.2) {
      m += dt * 0.02 * this.nerve;
      if (near >= 3) m += dt * 0.015;
      const l = sq.leader;
      if (l && l !== u && Math.hypot(l.pos.x - u.pos.x, l.pos.z - u.pos.z) < 15) m += dt * (this.broken ? 0.05 : 0.02);
      if (this.cover) m += dt * 0.01;
      if (!fighting) m += dt * 0.02;
    }
    this.morale = clamp(m, 0, 1);
    const eff = this.morale * this.nerve;
    const was = this.state;
    if (!this.broken && eff < 0.22) { this.broken = true; stat(w, 'broke'); }
    else if (this.broken && eff > 0.42 && sup < 0.2) { this.broken = false; stat(w, 'rallied'); }
    let st = 'steady';
    if (this.broken) st = eff < 0.12 ? 'rout' : 'retreat';
    else if (eff < 0.38 && sup > 0.25) st = 'cower';
    else if (eff < 0.5) st = 'shaken';
    // a lone, beaten soldier with the enemy on top of them gives up
    if (was === 'surrender') {
      if (w.time < this.giveUpT || this.foeD < 9) st = 'surrender';
      else { this.morale = 0.5; this.broken = false; st = 'steady'; stat(w, 'surrenderEnded'); }
    } else if (st === 'rout' && this.foeD < 14 && near <= 1 && (u.hp < 55 || this.dry) && this.surrenderOk()) {
      st = 'surrender'; this.giveUpT = w.time + rand(25, 40); stat(w, 'surrender');
    }
    if (st !== was) {
      if (st === 'retreat') stat(w, 'retreatState');
      if (st === 'rout') stat(w, 'routState');
      if (st === 'cower') stat(w, 'cowerState');
    }
    this.state = st;
  }

  surrenderOk() { return !this.u.isPlayer && this.foe && this.w.time > (this.noSurrender || 0); }

  releaseCover() {
    if (this.cover && this.cover.owner === this.u) this.cover.owner = null;
    this.cover = null;
  }

  hurtBy(from) {
    if (!from || !from.alive || from.team === this.u.team) return;
    this.squad.know(from, from.pos, true); // shot at: the whole squad knows there is a fight
    this.badCover = null;
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
    this.moraleFx();
  }

  // what the soldier's nerve does to the controls this frame, whatever the rest of the logic wanted
  moraleFx() {
    const u = this.u, c = u.ctrl, w = this.w, st = this.state;
    if (st === 'surrender') {
      c.fire = false; c.aimAt = null; c.kneel = true; c.prone = false; c.sprint = false; c.wx = c.wz = 0; c.reload = false;
    } else if (st === 'rout') {
      c.fire = false; c.aimAt = null; c.kneel = false; c.prone = false;
    } else if (st === 'retreat') {
      c.kneel = false; c.prone = false;
      c.fire = c.fire && this.dry === false && Math.floor(w.time * 1.5 + u.id) % 4 === 0; // a snap shot over the shoulder
    } else if (st === 'cower') {
      // head down: a burst now and then, fired blind
      c.fire = c.fire && Math.floor(w.time * 0.7 + u.id) % 4 === 0;
      c.kneel = true; c.prone = !this.cover || c.prone;
    } else if (st === 'shaken') {
      c.fire = c.fire && Math.floor(w.time * 2 + u.id) % 3 !== 0;
    }
    if (w.time < this.diveUntil && st !== 'surrender') { c.prone = true; c.fire = false; c.sprint = false; }
  }

  // ---- slow decisions ----
  think() {
    const u = this.u, w = this.w, sq = this.squad;
    const def = u.weapon.def;
    // too hurt to fight: crawl to a medic, or away from the fire
    if (u.down) {
      let g = null, bd = 1e9;
      for (const m of w.nearUnits(u.pos.x, u.pos.z, 45)) {
        if (!m.alive || m === u || m.team !== u.team || m.kind !== 'medic') continue;
        const d = Math.hypot(m.pos.x - u.pos.x, m.pos.z - u.pos.z);
        if (d < bd) { bd = d; g = m; }
      }
      const th = sq.contact?.pos || sq.foePos;
      if (g) this.goal = g.pos.clone();
      else if (th) { const dx = u.pos.x - th.x, dz = u.pos.z - th.z, l = Math.hypot(dx, dz) || 1; this.goal = new THREE.Vector3(u.pos.x + dx / l * 10, 0, u.pos.z + dz / l * 10); }
      else this.goal = u.pos.clone();
      this.goal.y = 0; this.releaseCover(); this.target = null; this.seen = false; this.mission = null;
      return;
    }
    const eye = u.eye(V());
    // nearest hostile on foot within 100 m, seen or not: the squad goes cautious when one is about
    this.foe = null; this.foeD = 1e9;
    for (const e of w.nearUnits(u.pos.x, u.pos.z, 150)) {
      if (!e.alive || !hostile(e.team, u.team)) continue;
      const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z);
      if (d < this.foeD) { this.foeD = d; this.foe = e.pos; }
    }
    // perception: nearest few hostiles in range, checked for line of sight
    const near = w.nearUnits(u.pos.x, u.pos.z, SIGHT);
    const c = this.cands;
    c.length = 0;
    for (const e of near) {
      if (!e.alive || !hostile(e.team, u.team) || e.brain?.state === 'surrender') continue;
      const d2 = (e.pos.x - u.pos.x) ** 2 + (e.pos.z - u.pos.z) ** 2;
      if (d2 > SIGHT * SIGHT) continue;
      c.push({ e, d2 });
    }
    for (const v of w.vehicles) {
      if (!v.alive || !hostile(v.team, u.team)) continue;
      const d2 = (v.pos.x - u.pos.x) ** 2 + (v.pos.z - u.pos.z) ** 2;
      if (d2 <= SIGHT * SIGHT) c.push({ e: v, d2 });
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
      if (e === this.target) sc -= 18; // stick with a target: no flicking between two
      if (sq.focus && e === sq.focus && sq.focus.alive && w.time - sq.focusT < 5) sc -= 12; // the squad's chosen target
      if (e.hp < 40) sc -= 7; // finish the wounded
      if (e.isPlayer) sc -= 2;
      if (d > def.range * 1.1) sc += 40;
      if (e.isVehicle) sc += def.id === 'launcher' || def.id === 'grenade' ? -30 : 45; // only the heavy weapons hurt it
      if (sc < bs) { bs = sc; best = e; bestSeen = noticed; }
    }
    if (best !== this.target) {
      if (best && bestSeen) {
        // new target: a beat to react, aim starts off loose
        this.react = rand(0.25, 0.6) / this.skill * (1 + (1 - this.morale) * 0.9);
        const d = best.pos.distanceTo(u.pos);
        this.err.set(rand(-1, 1), rand(-0.5, 0.8), rand(-1, 1)).normalize().multiplyScalar(0.6 + d * 0.035);
        this.seenT = 0;
      }
      if (!(this.target && this.target.alive && best && best !== this.target && w.time - (this.tgtT || 0) < 1.5 && this.seen)) {
        this.target = bestSeen ? best : this.target && this.target.alive ? this.target : null;
        this.tgtT = w.time;
      }
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

    // ---- nerve
    const mw = u.weapons[0];
    this.dry = !mw.inf && mw.mag <= 0 && mw.reserve <= 0;
    this.updateMorale();
    if (this.state === 'surrender') {
      // hands up: no more fighting, and nobody shoots them
      this.mission = null; this.drag = null; this.releaseCover(); this.target = null; this.seen = false;
      this.goal = u.pos.clone(); this.goal.y = 0;
      return;
    }
    if (this.state === 'retreat' || this.state === 'rout') {
      this.mission = null; this.drag = null; this.releaseCover();
      this.goal = this.fleeGoal().clone(); this.goal.y = 0;
      return;
    }
    if (this.state === 'shaken' && this.goal && Math.random() < 0.25) return; // hesitates before the next move

    // ---- where to stand
    const fireteam = !!sq.manv && !sq.retreating && sq.size >= 4;
    this.mv = fireteam && this.slotIndex() % 2 === 1;
    const slot = sq.retreating ? sq.anchor.clone() : this.mv ? sq.manv.pos.clone() : sq.slot(this.slotIndex());
    const contact = sq.inContact() || this.seen || (sq.cautious && !sq.holding && !!sq.foePos);
    const threat = this.seen ? this.target.pos : (sq.inContact() ? sq.contact.pos : sq.foePos);
    const suppressed = u.suppression > 0.4;
    const lowHp = u.hp < 35;
    this.mission = u.kind === 'medic' && !this.seen && !sq.retreating && u.suppression < 0.3 ? this.medicMission() : null;
    if (this.mission) {
      this.releaseCover();
      const t = this.mission.unit;
      this.goal = Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z) < 1.5 ? u.pos.clone() : t.pos.clone();
    } else if (this.mv && flat(u.pos, sq.manv.pos) > 8) {
      // the flanking half runs for its jump-off point: no stopping to trade shots on the way
      this.releaseCover();
      this.goal = sq.manv.pos.clone();
    } else if (sq.assault && this.state === 'steady' && !lowHp && !suppressed) {
      // final rush onto the point
      this.releaseCover();
      this.goal = slot;
    } else if (contact && threat) {
      // in a fight: take the best cover near the slot that faces the threat
      // bounding overwatch: one half of the squad (by slot parity) keeps its cover and shoots
      // while the other half moves up to the next cover; they swap on the squad's bound
      const bounding = !sq.retreating && sq.size >= 4 && !lowHp;
      this.overwatch = (fireteam && !this.mv) || (bounding && this.slotIndex() % 2 !== sq.bound && flat(u.pos, sq.anchor) < 16 && w.time > (this.hurry || 0));
      const held = this.cover && !this.coverBad(this.cover, threat) && this.cover.prop.alive !== false && (!this.cover.terrain || w.time - this.cover.t < 10);
      if (!held || (!this.overwatch && this.state === 'steady' && this.cover.dist2(slot) > 100 && w.time - (this.coverAt || 0) > 4)) {
        this.releaseCover();
        const range = sq.retreating || lowHp || suppressed ? 14 : 12;
        const from = sq.retreating || lowHp || suppressed ? u.pos : slot;
        let cv = this.findCover(from, threat, range);
        // no solid cover about: use the lie of the land, a dip or reverse slope to fight from
        if (!cv && w.time > this.defT) { this.defT = w.time + 1.5; cv = this.findDefilade(from, threat, range + 4); }
        if (cv) { this.cover = cv; cv.owner = u; this.coverAt = w.time; }
      }
      if (this.cover) {
        // peek from tall cover, crouch behind low cover
        // (hysteresis: hold a peek or a duck for at least a moment so they don't bob in and out)
        const want = this.seen && this.react <= 0 && !u.busy && u.suppression < 0.75;
        if (want !== this.peeking && w.time - (this.peekT || 0) > 0.9) { this.peeking = want; this.peekT = w.time; }
        const shooting = this.peeking;
        this.goal = this.cover.high && shooting ? new THREE.Vector3(this.cover.px, 0, this.cover.pz) : new THREE.Vector3(this.cover.x, 0, this.cover.z);
      } else if (this.seen && def.id === 'smg' && !lowHp && !suppressed) {
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
    if (this.mission === null || !this.mission) {
      const nv = w.nav; nv.build(w.props, w.propVer);
      const gc = nv.cellOf(this.goal.x, this.goal.z);
      if (nv.blocked[gc] && !this.cover) { const oc = nv.open(gc); if (oc >= 0) { const q = nv.center(oc, { x: 0, z: 0 }); this.goal.x = q.x; this.goal.z = q.z; } }
    }
    // out of ammunition and nothing in sight: go to the nearest friendly ammo crate
    {
      const main = u.weapons[0];
      const dry = !main.inf && main.mag <= 0 && main.reserve <= 0;
      const low = !main.inf && main.reserve + main.mag < main.def.mag * 0.8 && !this.seen && !contact;
      if (dry || low) {
        const cr = w.nearestCrate(u.team, u.pos);
        if (cr) { this.releaseCover(); this.goal = new THREE.Vector3(cr.x, 0, cr.z); this.ammoRun = true; }
        else if (dry) { this.releaseCover(); this.goal = this.fleeGoal().clone(); this.goal.y = 0; } // nothing to fight with and no crate: fall back
      }
    }

    // can see them but can't shoot them (crate, wall, crest in the way): give up this spot
    if (this.seen && this.blockT > 1.2 && !this.sidestep) {
      if (this.cover) { this.badCover = this.cover; this.badUntil = w.time + 10; this.releaseCover(); }
      const to = this.target.pos, dx = to.x - u.pos.x, dz = to.z - u.pos.z, l = Math.hypot(dx, dz) || 1;
      this.strafe *= -1;
      this.sidestep = { x: u.pos.x - (dz / l) * 4 * this.strafe + (dx / l) * 1.5, z: u.pos.z + (dx / l) * 4 * this.strafe + (dz / l) * 1.5, t: w.time + 2 };
      this.blockT = 0;
    }
    // grenades: at a cluster, or at someone dug in behind cover
    this.nadeT -= 0.35;
    {
      // an enemy that went to ground behind cover and out of sight: blow them out of it
      const ct = sq.contact, gi = u.weapons.findIndex((x) => x.id === 'grenade');
      if (gi >= 0 && !this.seen && this.nadeT <= 0 && ct && w.time - ct.t < 3 && ct.unit && ct.unit.alive && ct.unit.brain?.cover && !u.busy && u.weapons[gi].mag > 0 && !this.nade) {
        const d = flat(ct.pos, u.pos);
        if (d > 9 && d < 20) {
          let friends = 0;
          for (const f of w.nearUnits(ct.pos.x, ct.pos.z, 4.5)) if (f.alive && f.team === u.team) friends++;
          const lob = u.eye(V()); lob.y += 1.2;
          const landing = ct.pos.clone(); landing.y = height(ct.pos.x, ct.pos.z) + 0.4;
          if (!friends && w.los(lob, landing) && Math.random() < 0.5) { this.nade = { slot: gi, back: u.wi, at: landing }; this.nadeT = rand(10, 18); stat(w, 'clearCoverNade'); }
          else this.nadeT = rand(2, 4);
        }
      }
    }
    const g = u.weapons.findIndex((x) => x.id === 'grenade');
    if (g >= 0 && this.seen && this.nadeT <= 0 && u.weapons[g].mag > 0 && !u.busy) {
      const d = this.target.pos.distanceTo(u.pos);
      if (d > 7 && d < 20) {
        let cluster = 0;
        for (const e of w.nearUnits(this.target.pos.x, this.target.pos.z, 3.5)) if (e.alive && e.team === this.target.team) cluster++;
        const dug = this.target.kneelK > 0.5 || this.target.brain?.cover;
        let friends = 0;
        for (const f of w.nearUnits(this.target.pos.x, this.target.pos.z, 4)) if (f.alive && f.team === u.team) friends++;
        const lob = u.eye(V()); lob.y += 1.2;
        const landing = this.target.pos.clone(); landing.y += 0.4;
        if ((cluster >= 3 || dug) && !friends && w.los(lob, landing) && Math.random() < 0.55) {
          this.nade = { slot: g, back: u.wi, at: this.target.pos.clone() };
          this.nadeT = rand(10, 18);
        } else this.nadeT = rand(1.5, 4);
      }
    }
  }

  // can a round fired from the real muzzle reach the aim point? Props and ground in the way
  // (the same test the bullets get) mean no; lobbed shells are checked along their arc
  shotClear(aim, def) {
    const w = this.w, m = this.u.muzzle(V());
    if (!def.gravity) return w.los(m, aim);
    const d = Math.hypot(aim.x - m.x, aim.z - m.z) || 1;
    const th = 0.5 * Math.asin(Math.min(1, (def.gravity * d) / (def.speed * def.speed)));
    const T = d / (def.speed * Math.cos(th)), vy = def.speed * Math.sin(th);
    const a = m.clone(), b = V();
    for (let i = 1; i <= 6; i++) {
      const t = (T * i) / 6;
      b.set(m.x + ((aim.x - m.x) * i) / 6, m.y + vy * t - 0.5 * def.gravity * t * t, m.z + ((aim.z - m.z) * i) / 6);
      if (i < 6 && !w.los(a, b)) return false;
      a.copy(b);
    }
    return true;
  }

  // ground cover: a spot where a soldier lying or kneeling is hidden from the threat but can
  // still see over the crest when standing (hull-down), or failing that simply hidden
  findDefilade(around, threat, range) {
    const w = this.w, u = this.u, rng = u.weapon.def.range;
    const eye = V().set(threat.x, (threat.y || 0) + 1.5, threat.z);
    let best = null, bs = Infinity;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.6, r = rand(2.5, range);
      const x = around.x + Math.cos(a) * r, z = around.z + Math.sin(a) * r;
      if (Math.abs(x) > w.edge || Math.abs(z) > w.edge) continue;
      const dt = Math.hypot(threat.x - x, threat.z - z);
      if (dt < 12 || dt > rng * 0.85) continue;
      w.nav.build(w.props, w.propVer);
      if (w.nav.blocked[w.nav.cellOf(x, z)]) continue;
      const y = height(x, z);
      if (w.los(eye, V().set(x, y + 0.55, z))) continue; // exposed even when low
      const peek = w.los(eye, V().set(x, y + 1.55, z));
      const sc = Math.hypot(x - u.pos.x, z - u.pos.z) + (peek ? 0 : 6);
      if (sc < bs) { bs = sc; best = { x, z, y }; }
    }
    if (!best) return null;
    const dx = best.x - threat.x, dz = best.z - threat.z, l = Math.hypot(dx, dz) || 1;
    return { x: best.x, z: best.z, nx: dx / l, nz: dz / l, high: false, px: best.x, pz: best.z, prop: { alive: true }, terrain: true, t: w.time, owner: null,
      dist2(p) { return (this.x - p.x) ** 2 + (this.z - p.z) ** 2; } };
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
      if (!m.alive) { if (m.isPlayer || m.deadT > 10 || d > 30 || m.lost || m.corpseHp < 40) continue; sc = d - 8; }
      else if (m.dying) continue; // a mortal wound is past bandaging
      else if (m.hp < 75 || m.bleed > 0.1 || m.down) sc = d + m.hp * 0.15 - (m.down ? 12 : 0);
      else continue;
      if (sc >= bs) continue;
      // not into the middle of a firefight
      let danger = false;
      for (const e of w.nearUnits(m.pos.x, m.pos.z, m.down ? 9 : 13)) if (e.alive && hostile(e.team, u.team)) { danger = true; break; }
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
    if (this.drag && this.drag.unit === t) {
      // haul the casualty by the harness to the cover, then patch them up there
      const dg = this.drag, w = this.w, dd = Math.hypot(dg.to.x - u.pos.x, dg.to.z - u.pos.z);
      if (dd < 1.3 || w.time > dg.until || d > 4 || !t.down) { this.drag = null; this.dragged = t; this.dragging = false; }
      else {
        const dx = dg.to.x - u.pos.x, dz = dg.to.z - u.pos.z;
        c.wx = dx / dd; c.wz = dz / dd; c.speed = 0.5; c.sprint = false; c.aimAt = null; c.fire = false; c.kneel = false;
        t.pos.x = u.pos.x - (dx / dd) * 1.1; t.pos.z = u.pos.z - (dz / dd) * 1.1; t.pos.y = Math.max(t.pos.y, height(t.pos.x, t.pos.z));
        t.vel.set(0, 0, 0);
        this.dragging = true;
        return true;
      }
    }
    if (d > 2.4) { this.reviveT = 0; return false; }
    c.aimAt = null; c.fire = false; c.kneel = true;
    if (m.kind === 'heal' && t.down && this.dragged !== t && this.exposed(t)) { this.startDrag(t); return true; }
    if (m.kind === 'heal') {
      // bandage: kneel beside them and wrap the wound, which stops the bleeding
      this.reviveT = (this.reviveT || 0) + dt;
      if (this.reviveT >= (t.down ? 3 : 2)) { t.bandage(28); this.reviveT = 0; this.mission = null; this.w.audio.play('reload', t.pos, 0.5); }
    } else {
      this.reviveT = (this.reviveT || 0) + dt;
      if (this.reviveT >= 2.5) { this.w.revive(t); this.reviveT = 0; this.mission = null; }
    }
    return true;
  }

  // is this casualty lying where the known enemy can see them?
  exposed(t) {
    const ct = this.squad.contact, w = this.w;
    if (!ct || w.time - ct.t > 8) return false;
    return w.los(V().set(ct.pos.x, height(ct.pos.x, ct.pos.z) + 1.4, ct.pos.z), V().set(t.pos.x, t.pos.y + 0.4, t.pos.z));
  }

  // pick where to drag them: nearby cover facing away from the enemy, or just back out of the line
  startDrag(t) {
    const w = this.w, ct = this.squad.contact;
    const cv = this.findCover(t.pos, ct.pos, 11);
    let to;
    if (cv) to = V().set(cv.x, 0, cv.z);
    else {
      const dx = t.pos.x - ct.pos.x, dz = t.pos.z - ct.pos.z, l = Math.hypot(dx, dz) || 1;
      to = V().set(clamp(t.pos.x + (dx / l) * 9, -w.edge, w.edge), 0, clamp(t.pos.z + (dz / l) * 9, -w.edge, w.edge));
    }
    this.drag = { unit: t, to, until: w.time + 9 };
    stat(w, 'drag');
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
    let best = null;
    const cands = [];
    for (const p of w.propGrid.near(around.x, around.z, range, [])) {
      for (const s of p.cover) {
        if (s.owner && s.owner !== u && s.owner.alive) continue;
        if (s === this.badCover && w.time < this.badUntil) continue;
        const dx = s.x - around.x, dz = s.z - around.z;
        const d = Math.hypot(dx, dz);
        if (d > range) continue;
        const tx = threat.x - s.x, tz = threat.z - s.z;
        const tl = Math.hypot(tx, tz) || 1;
        const facing = (tx * -s.nx + tz * -s.nz) / tl;
        if (facing < 0.5) continue;
        if (tl < 4) continue;
        const travel = Math.hypot(s.x - u.pos.x, s.z - u.pos.z);
        const pt = s.prop?.type;
        // hard cover and fighting positions first; never next to something that explodes
        const kind = PROPS[pt]?.explodes ? 6 : pt === 'bunker' ? -2.5 : (pt === 'sandbags' || pt === 'slab' || pt === 'ruin' || pt === 'stonewall') ? -1.2 : 0;
        const sc = d + travel * 0.5 - facing * 3 + (s.high ? -0.5 : 0) + kind;
        cands.push({ s, sc });
      }
    }
    cands.sort((a, b) => a.sc - b.sc);
    const tgt = V().set(threat.x, (threat.y || 0) + 0.9, threat.z), from = V();
    for (let i = 0; i < Math.min(4, cands.length); i++) {
      const s = cands[i].s, fx = s.high ? s.px : s.x, fz = s.high ? s.pz : s.z;
      from.set(fx, height(fx, fz) + (s.high ? 1.35 : 0.85), fz);
      if (w.los(from, tgt)) { best = s; break; }
    }
    if (best && !best.dist2) best.dist2 = function (p) { return (this.x - p.x) ** 2 + (this.z - p.z) ** 2; };
    return best;
  }

  // where to point the legs this frame: straight at the goal when the way is clear, otherwise
  // along a route round whatever is in the way
  steer(goal, gd, dt) {
    const u = this.u, w = this.w;
    this.directT -= dt;
    if (this.directT <= 0) {
      this.directT = rand(0.2, 0.35);
      this.direct = !w.segBlocked(u.pos.x, u.pos.z, goal.x, goal.z, 0.4);
    }
    if (this.direct && !this.repath) { this.path = null; return goal; }
    const moved = !this.path || (goal.x - this.pathGoal.x) ** 2 + (goal.z - this.pathGoal.z) ** 2 > 9;
    if ((moved || this.repath) && w.navBudget > 0) {
      w.navBudget--;
      this.repath = false;
      this.path = w.route(u.pos.x, u.pos.z, goal.x, goal.z, this.stallT >= 1);
      this.pathGoal.copy(goal);
      this.pi = 0;
    }
    const path = this.path;
    if (!path || !path.length) return goal;
    // cut corners: skip ahead while the next leg is clear
    while (this.pi < path.length - 1 && (Math.hypot(path[this.pi].x - u.pos.x, path[this.pi].z - u.pos.z) < 1 || !w.segBlocked(u.pos.x, u.pos.z, path[this.pi + 1].x, path[this.pi + 1].z, 0.4))) this.pi++;
    // each soldier takes its own lane so a squad doesn't file down a route in one clump
    const wp = path[this.pi], nx = path[Math.min(this.pi + 1, path.length - 1)];
    if (this.pi < path.length - 1) {
      const dx = nx.x - wp.x, dz = nx.z - wp.z, l = Math.hypot(dx, dz) || 1, lane = ((this.u.id % 5) - 2) * 0.55;
      this.laneP.x = wp.x - (dz / l) * lane; this.laneP.z = wp.z + (dx / l) * lane;
      // the lane offset must never push the waypoint into a wall: beside props, stay on the route itself
      const nv = w.nav;
      if (nv.blocked[nv.cellOf(this.laneP.x, this.laneP.z)] || w.segBlocked(wp.x, wp.z, this.laneP.x, this.laneP.z, 0.45)) return wp;
      return this.laneP;
    }
    return wp;
  }

  // nobody stands about without a reason: wanting to move and not moving gets a fresh route, then a
  // sidestep, then a different cover or slot
  watchdog(dt, gd, wl) {
    const u = this.u, w = this.w;
    // slow-progress check: wanting to be somewhere and gaining almost no ground (dithering between
    // covers, turning on the spot, queuing behind a mate) for several seconds: drop the fancy
    // behaviour and just go there for a spell
    this.progT = (this.progT || 0) + dt;
    this.turned = (this.turned || 0) + Math.abs(wrap(u.facing - (this.lastFace ?? u.facing))); this.lastFace = u.facing;
    if (this.progT >= 4) {
      const mv = this.progPos ? Math.hypot(u.pos.x - this.progPos.x, u.pos.z - this.progPos.z) : 9;
      const wants = gd > 3 && !u.busy && !this.mission && !u.down && !this.freezing();
      const spinning = this.turned > 5 && mv < 2.5;
      if (wants && (mv < 1.3 || spinning)) {
        this.hurry = w.time + 7;
        this.hurries = (this.hurries || 0) + 1;
        if (spinning) { this.target = null; this.seen = false; this.react = 0.6; this.lastAim = null; }
        if (this.cover) { this.badCover = this.cover; this.badUntil = w.time + 15; this.releaseCover(); }
        this.repath = true; this.path = null;
        if (this.hurries % 2 === 0) this.squad.stalled(u);
      } else if (mv > 4) this.hurries = 0;
      this.progT = 0; this.turned = 0; this.progPos = this.progPos || V(); this.progPos.copy(u.pos);
    }
    this.stuckT += dt;
    if (this.stuckT < 0.5) return;
    const moved = this.lastPos.distanceTo(u.pos);
    this.lastPos.copy(u.pos);
    this.stuckT = 0;
    const wants = gd > 1.5 && wl > 0.5 && !u.busy && !this.freezing();
    if (wants && moved < 0.4) this.stallT += 0.5; else { this.stallT = 0; return; }
    if (this.stallT >= 1) this.repath = true;
    if (this.stallT >= 2.5 && this.stallT < 3) {
      const side = Math.random() < 0.5 ? -1 : 1, l = wl || 1;
      this.path = null;
      this.sidestep = { x: u.pos.x - (u.ctrl.wz / l) * 3 * side - (u.ctrl.wx / l) * 1.2, z: u.pos.z + (u.ctrl.wx / l) * 3 * side - (u.ctrl.wz / l) * 1.2, t: w.time + 1.5 };
    }
    if (this.stallT >= 5 && this.cover) { this.badCover = this.cover; this.badUntil = w.time + 20; this.releaseCover(); }
    if (this.stallT >= 5) this.squad.stalled(u);
  }

  // ducking, cowering or hands up: standing still is the point, not a stall
  freezing() { return this.state === 'cower' || this.state === 'surrender' || this.w.time < this.diveUntil; }

  // ---- every frame: move, aim, shoot ----
  act(dt) {
    const u = this.u, c = u.ctrl, w = this.w, sq = this.squad;
    const def = u.weapon.def;

    this.dragging = false;
    if (this.mission && this.doMission(dt)) { if (!this.dragging) c.wx = c.wz = 0; c.sprint = false; return; }
    if (this.drag) this.drag = null;
    // movement toward the goal, around props
    let wx = 0, wz = 0;
    let goal = this.goal || u.pos;
    if (this.sidestep && w.time < this.sidestep.t) goal = this.sidestep; else this.sidestep = null;
    const gx = goal.x - u.pos.x, gz = goal.z - u.pos.z;
    const gd = Math.hypot(gx, gz);
    const inCover = this.cover && gd < 0.6;
    if (gd > 0.5) {
      const t = this.steer(goal, gd, dt);
      const dx = t.x - u.pos.x, dz = t.z - u.pos.z, dl = Math.hypot(dx, dz) || 1;
      const k = Math.min(1, gd / 1.2);
      wx = (dx / dl) * k; wz = (dz / dl) * k;
    } else this.path = null;
    // spacing from squadmates
    // in the open under threat, spread out so one burst or blast can't take a clump
    const sp = !this.cover && (this.seen || sq.inContact()) ? 3.8 : 2.8;
    if (this.stallT < 2) for (const m of w.nearUnits(u.pos.x, u.pos.z, sp + 0.2)) {
      if (m === u || !m.alive || m.team !== u.team) continue;
      const dx = u.pos.x - m.pos.x, dz = u.pos.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < sp) { wx += (dx / d) * (sp - d) * 0.5; wz += (dz / d) * (sp - d) * 0.5; }
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
    // dash between covers; the half that is covering stays down
    const dash = sq.cautious && !this.seen && !this.overwatch && gd > 3 && !sq.holding;
    c.sprint = evading || dash || open && ((gd > 7 && (!this.seen || sq.retreating || u.suppression > 0.25)) || gd > 16 || (sq.retreating && gd > 3));
    c.speed = 1;
    // shaken soldiers don't leave cover: a dive on a near miss, a cowering head-down crouch
    if (this.state === 'cower' || w.time < this.diveUntil) c.sprint = false;
    if (this.state === 'retreat' || this.state === 'rout') c.sprint = true;
    // the fireteam running for the flank dashes; so does the final rush
    if (this.mv && gd > 6 && u.suppression < 0.6) c.sprint = true;
    if (sq.assault && gd > 3 && u.suppression < 0.4 && this.state === 'steady') c.sprint = true;

    this.watchdog(dt, gd, wl);

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
      const floor = (0.12 + d * 0.006) / this.skill * (1 + (1 - this.morale) * 0.7);
      const k = Math.exp(-dt * 1.4 * this.skill * (1 - sup * 0.6));
      this.err.multiplyScalar(k);
      if (this.err.length() < floor) this.err.setLength(floor);
      if (Math.hypot(t.vel.x, t.vel.z) > 1) this.err.x += rand(-1, 1) * dt * 0.6;
      const aim = t.center(V()).add(this.err);
      aim.y = Math.max(aim.y, height(aim.x, aim.z) + 0.15); // never aim into the ground
      // lead slow projectiles
      if (def.kind === 'projectile' && def.speed) aim.addScaledVector(t.vel, (d / def.speed) * 0.8);
      if (def.gravity) {
        // ballistic lob: low-angle solution for the range
        const th = 0.5 * Math.asin(Math.min(1, (def.gravity * d) / (def.speed * def.speed)));
        aim.y = u.eye(V()).y + Math.tan(th) * d + (t.pos.y - u.pos.y);
      }
      c.aimAt = aim;
      this.clearT -= dt;
      if (this.clearT <= 0) { this.clearT = 0.12; this.clear = this.shotClear(aim, def); }
      this.blockT = this.clear ? 0 : this.blockT + dt;
      this.lastAim = aim; this.lastAimT = w.time;
      const inRange = d < def.range * 0.95;
      // bursts with pauses; low cover means kneeling between bursts
      let fire = false;
      if (this.react <= 0 && inRange && !this.blocked && this.clear && sup < 0.85) {
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
      if (fire && !this.shotClear(aim, def)) { fire = false; this.clear = false; }
      // mortar: lob only at longer range
      if (def.id === 'launcher' && d < 9) fire = false;
      c.fire = fire;
      c.kneel = (inCover && !this.cover.high) || (!this.cover && (def.id === 'mg' || def.id === 'rifle' || def.id === 'launcher') && wl < 0.3) || (sup > 0.6 && gd < 3);
      if (inCover && !this.cover.high && sup > 0.6) c.fire = false;
      // caught in the open under heavy fire, or a gunner settling in: go prone for a while
      if (!this.cover && (sup > 0.5 || (def.id === 'mg' && wl < 0.2 && this.seenT > 1.5))) this.proneUntil = w.time + rand(2, 4);
      c.prone = w.time < (this.proneUntil || 0) && !sq.retreating && gd < 3 && w.time > (this.hurry || 0); // crawling a long way is lingering
    } else {
      this.react = Math.max(this.react, 0.15);
      c.fire = false;
      // suppressive fire: gunners keep the enemy's heads down where they were last seen
      const ct = sq.contact;
      // the base of fire does the same while the flank goes in, and so does any rifle holding overwatch
      const base = (sq.manv && !this.mv) || (this.overwatch && sq.inContact());
      const gun = def.id === 'mg' || (base && def.kind === 'hitscan' && u.weapon.mag > def.mag * 0.4 && this.state === 'steady');
      if (gun && ct && w.time - ct.t < (def.id === 'mg' ? 4 : 6) && u.weapon.mag > 8 && !u.busy && !this.dry) {
        const dd = Math.hypot(ct.pos.x - u.pos.x, ct.pos.z - u.pos.z);
        if (dd > 6 && dd < def.range * 0.9) {
          c.aimAt = ct.pos.clone().setY(Math.max(U.BODY_Y + ct.pos.y, height(ct.pos.x, ct.pos.z) + 0.15));
          const cad = def.id === 'mg' ? Math.floor(w.time * 2.4 + u.id) % 3 !== 2 : Math.floor(w.time * 1.7 + u.id) % 3 === 0;
          c.fire = cad && w.los(u.muzzle(V()), c.aimAt) && !w.friendlyInLine(u, u.muzzle(V()), c.aimAt);
          if (c.fire && def.id !== 'mg') stat(w, 'suppressShots');
          c.kneel = !this.cover?.high;
          return;
        }
      }
      // no cover and an enemy about: the covering half lies down; anyone shot at goes to ground
      if (!this.cover && sup > 0.4) this.proneUntil = w.time + rand(2, 4);
      const lieLow = !this.cover && sq.cautious && !sq.holding && !sq.retreating && gd < 2.5 && (this.overwatch || sq.size < 4);
      c.prone = ((w.time < (this.proneUntil || 0) && gd < 1) || lieLow) && w.time > (this.hurry || 0);
      // look where trouble was, or where we're going
      const look = sq.contact && w.time - sq.contact.t < 8 ? sq.contact.pos : sq.holding && gd < 1 ? sq.watch : null;
      // keep the gun on the last spot for a moment after losing sight, instead of snapping away
      if (this.lastAim && w.time - this.lastAimT < 1.2) c.aimAt = this.lastAim.setY(Math.max(this.lastAim.y, height(this.lastAim.x, this.lastAim.z) + 0.15));
      else c.aimAt = look ? look.clone().setY(Math.max(U.BODY_Y + look.y, height(look.x, look.z) + 0.15)) : null;
      c.kneel = !!(inCover && (sq.inContact() || sq.cautious));
      if (u.weapon.mag < u.weapon.def.mag * 0.5 && !u.busy) c.reload = true;
    }
    if (u.wi !== 0 && !this.nade && u.weapon.id === 'grenade') u.setWeapon(0);
  }
}
