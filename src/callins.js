import * as THREE from 'three';
import { height } from './terrain.js';
import { TEAMS } from './factions.js';

// Call-ins: support the player (or an AI army) calls onto a spot of the field.
//   strike  - a jet crosses the field along a line and drops a stick of bombs
//   barrage - artillery rains shells over a patch of ground
//   supply  - a crate parachutes in; friends near it are healed and rearmed
// Each army has its own cooldown per kind. Blasts never hurt the caller's own side.
export const CALLINS = {
  strike: { name: 'Airstrike', cd: 80, delay: 3.2, hint: 'Jet drops a line of bombs along your view' },
  barrage: { name: 'Barrage', cd: 60, delay: 3, hint: 'Shells rain on the marked ground' },
  supply: { name: 'Supply drop', cd: 45, delay: 2, hint: 'Heals and rearms friends near the crate' },
};
export const ORDER = ['strike', 'barrage', 'supply'];
export const RANGE = 170; // how far from the caller a target can be

const UP = new THREE.Vector3(0, 1, 0);

// one shell profile shared by every bomb and shell: pointed nose, round body, finned tail
const shellGeo = new THREE.LatheGeometry([[0, 0.55], [0.07, 0.4], [0.13, 0.15], [0.14, -0.2], [0.1, -0.42], [0.16, -0.5], [0.16, -0.58], [0, -0.58]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
const shellMat = new THREE.MeshStandardMaterial({ color: '#4a4f4a', roughness: 0.6, metalness: 0.5 });
const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 46, 6, 1, true);
beamGeo.translate(0, 23, 0);
const ringGeo = new THREE.RingGeometry(0.92, 1, 40);
ringGeo.rotateX(-Math.PI / 2);
const crateGeo = new THREE.BoxGeometry(1.1, 0.8, 1.1);
const canopyGeo = new THREE.SphereGeometry(1.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const lineGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 3);
const crateMat = new THREE.MeshStandardMaterial({ color: '#6f6a4c', roughness: 0.8 });

function jetModel() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#59616a', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
  // fuselage: a lathe profile laid along -z
  const body = new THREE.Mesh(new THREE.LatheGeometry([[0, 3.6], [0.25, 3], [0.55, 1.6], [0.6, -0.5], [0.45, -2.6], [0.3, -3.4], [0, -3.5]].map(([r, z]) => new THREE.Vector2(r, z)), 12), mat);
  body.rotation.x = -Math.PI / 2;
  body.scale.set(1, 1, 0.8);
  g.add(body);
  // swept wings and tailplane as flat planforms
  const wing = new THREE.Shape();
  wing.moveTo(0, 1.4); wing.lineTo(4.6, -1.8); wing.lineTo(4.6, -2.6); wing.lineTo(0, -1.9); wing.lineTo(-4.6, -2.6); wing.lineTo(-4.6, -1.8);
  const w = new THREE.Mesh(new THREE.ShapeGeometry(wing), mat);
  w.rotation.x = -Math.PI / 2; w.position.y = -0.05;
  g.add(w);
  const tail = new THREE.Shape();
  tail.moveTo(0, -2.2); tail.lineTo(1.9, -3.4); tail.lineTo(1.9, -3.8); tail.lineTo(-1.9, -3.8); tail.lineTo(-1.9, -3.4);
  const t = new THREE.Mesh(new THREE.ShapeGeometry(tail), mat);
  t.rotation.x = -Math.PI / 2; t.position.y = 0.02;
  g.add(t);
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(0, 1.5); fin.lineTo(-0.7, 1.5); fin.lineTo(-1.5, 0);
  const f = new THREE.Mesh(new THREE.ShapeGeometry(fin), mat);
  f.rotation.y = Math.PI / 2; f.position.set(0, 0.3, 1.6);
  g.add(f);
  return g;
}

export class CallIns {
  constructor(battle) {
    this.b = battle;
    this.cd = []; // cd[team][kind] seconds left
    this.jobs = [];
    this.shells = [];
    this.fx = []; // beams, rings, crates: things to remove
    this.think = []; // AI timers per team
    this.group = new THREE.Group();
    battle.scene.add(this.group);
  }

  reset(teams) {
    this.cd = Array.from({ length: teams }, () => ({ strike: 25, barrage: 15, supply: 10 }));
    this.think = Array.from({ length: teams }, () => 20 + Math.random() * 15);
  }

  left(team, kind) { return Math.max(0, this.cd[team]?.[kind] ?? 0); }
  ready(team, kind) { return !!this.cd[team] && this.cd[team][kind] <= 0; }

  // owner: the unit that called it (credit for kills) or null for an army's own AI
  call(team, kind, at, dir, owner = null) {
    if (!this.ready(team, kind)) return false;
    const def = CALLINS[kind];
    this.cd[team][kind] = def.cd;
    const pos = new THREE.Vector3(at.x, height(at.x, at.z), at.z);
    const d = dir ? new THREE.Vector3(dir.x, 0, dir.z) : new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
    d.normalize();
    const src = owner || { team, kills: 0 }; // a stub still carries the side, so blasts spare friends
    const job = { kind, team, pos, dir: d, owner: src, t: 0, def, n: 0, seen: new Set() };
    if (kind === 'strike') {
      job.jet = jetModel();
      job.jet.visible = false;
      this.group.add(job.jet);
      job.dist = 260; job.speed = 125; job.alt = 48;
      job.travel = job.speed * 0.9 * Math.sqrt(2 * (job.alt - 1) / 22); // bombs keep the jet's speed while they fall
      job.t = -def.delay;
    } else if (kind === 'barrage') job.t = -def.delay;
    else if (kind === 'supply') {
      job.t = -def.delay;
      job.state = 'wait';
    }
    this.jobs.push(job);
    this.marker(job);
    this.b.audio.play('radio', pos, 0.6);
    if (team !== this.b.player?.team && this.b.player?.alive && pos.distanceTo(this.b.player.pos) < 55 && kind !== 'supply') this.b.events.push({ type: 'incoming', kind, pos: pos.clone() });
    return true;
  }

  marker(job) {
    const col = new THREE.Color(TEAMS[job.team].ui);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    beam.position.copy(job.pos);
    const r = job.kind === 'barrage' ? 16 : job.kind === 'strike' ? 11 : 5.5;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, depthWrite: false, fog: false }));
    ring.position.copy(job.pos).y += 0.25;
    ring.scale.setScalar(r);
    this.group.add(beam, ring);
    job.beam = beam; job.ring = ring;
    // strike: the ring stretches into a lane along the run
    if (job.kind === 'strike') { ring.scale.set(r, 1, r); }
    this.fx.push(job);
    this.b.fx.emitters.push({ t: 0, life: job.def.delay + 6, rate: 4, acc: 0, fn: (e, fx) => fx.smoke(job.pos.clone().setY(job.pos.y + 0.3), new THREE.Vector3(fx.rnd(0.2), 1.6, fx.rnd(0.2)), 1.3, 0) });
  }

  makeShell(from, vel, owner, scale = 1, radius = 5, dmg = 150) {
    const m = new THREE.Mesh(shellGeo, shellMat);
    m.scale.setScalar(scale);
    m.position.copy(from);
    this.group.add(m);
    this.shells.push({ m, pos: from.clone(), vel: vel.clone(), owner, radius, dmg });
    this.b.audio.play('whistle', from, 0.8);
  }

  update(dt) {
    const b = this.b;
    for (const c of this.cd) for (const k of ORDER) c[k] -= dt;
    this.ai(dt);
    for (const j of [...this.jobs]) this.step(j, dt);
    // shells in flight
    for (const s of [...this.shells]) {
      s.vel.y -= 22 * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.m.position.copy(s.pos);
      s.m.quaternion.setFromUnitVectors(UP, s.vel.clone().normalize());
      const gy = height(s.pos.x, s.pos.z);
      if (s.pos.y <= gy + 0.2) {
        b.explode(new THREE.Vector3(s.pos.x, gy + 0.2, s.pos.z), s.radius, s.dmg, s.owner, 1);
        this.group.remove(s.m);
        this.shells.splice(this.shells.indexOf(s), 1);
      }
    }
    // marker fade
    for (const j of this.fx) {
      const a = j.fade ?? 1;
      if (j.beam) j.beam.material.opacity = 0.55 * a * (0.7 + 0.3 * Math.sin(b.time * 8));
      if (j.ring) j.ring.material.opacity = 0.6 * a;
    }
  }

  step(j, dt) {
    const b = this.b;
    j.t += dt;
    if (j.t < 0) return;
    if (j.kind === 'strike') {
      if (!j.jet.visible) { j.jet.visible = true; b.audio.play('jet', j.pos, 1); }
      const s = -j.dist + j.speed * j.t; // metres along the run, 0 is over the target
      const p = j.pos.clone().addScaledVector(j.dir, s);
      p.y = Math.max(height(p.x, p.z), j.pos.y) + j.alt;
      j.jet.position.copy(p);
      j.jet.rotation.y = Math.atan2(-j.dir.x, -j.dir.z);
      j.jet.rotation.z = 0;
      // a stick of bombs falling either side of the target
      while (j.n < 7 && s > (j.n - 3) * 7 - j.travel) {
        const v = j.dir.clone().multiplyScalar(j.speed * 0.9);
        this.makeShell(p.clone().setY(p.y - 1), v, j.owner, 2.2, 6.5, 210);
        j.n++;
      }
      if (s > j.dist) this.finish(j, true);
      else if (s > 40) j.fade = Math.max(0, 1 - (s - 40) / 40);
    } else if (j.kind === 'barrage') {
      // sixteen shells over about nine seconds, scattered over the ring
      while (j.n < 16 && j.t > j.n * 0.55) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 14;
        const at = new THREE.Vector3(j.pos.x + Math.cos(a) * r, 0, j.pos.z + Math.sin(a) * r);
        const gy = height(at.x, at.z);
        const from = new THREE.Vector3(at.x + (Math.random() - 0.5) * 14, gy + 85, at.z + (Math.random() - 0.5) * 14);
        // aim so a shell with gravity 22 lands on the point after its fall time
        const T = 1.6;
        const vel = new THREE.Vector3((at.x - from.x) / T, (gy - from.y) / T + 11 * T, (at.z - from.z) / T);
        this.makeShell(from, vel, j.owner, 1.5, 5, 150);
        j.n++;
      }
      if (j.n >= 16 && j.t > 9 + 1.7) this.finish(j, true);
      else if (j.t > 6) j.fade = Math.max(0, 1 - (j.t - 6) / 4);
    } else if (j.kind === 'supply') this.supply(j, dt);
  }

  supply(j, dt) {
    const b = this.b;
    if (j.state === 'wait') {
      // the crate comes down under a canopy
      j.state = 'fall';
      j.h = 52;
      j.crate = new THREE.Group();
      const box = new THREE.Mesh(crateGeo, crateMat);
      const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({ color: TEAMS[j.team].body, roughness: 0.9, side: THREE.DoubleSide }));
      canopy.position.y = 3.6;
      j.crate.add(box, canopy);
      // shroud lines from the canopy rim to the crate
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const rim = new THREE.Vector3(Math.cos(a) * 1.9, 3.6, Math.sin(a) * 1.9), top = new THREE.Vector3(Math.cos(a) * 0.45, 0.4, Math.sin(a) * 0.45);
        const l = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: '#cfc8b6' }));
        l.position.copy(rim).add(top).multiplyScalar(0.5);
        l.scale.y = rim.distanceTo(top);
        l.quaternion.setFromUnitVectors(UP, rim.clone().sub(top).normalize());
        j.crate.add(l);
      }
      this.group.add(j.crate);
      j.canopy = canopy;
      b.audio.play('jet', j.pos, 0.4);
    }
    if (j.state === 'fall') {
      j.h -= 9 * dt;
      const sway = Math.sin(j.t * 1.6) * 0.5;
      j.crate.position.set(j.pos.x + sway, j.pos.y + Math.max(0.4, j.h), j.pos.z);
      if (j.h <= 0.4) {
        j.state = 'open'; j.open = 0;
        j.crate.remove(j.canopy);
        j.crate.children = j.crate.children.filter((c) => c.geometry !== lineGeo);
        b.fx.dust(j.crate.position, 10, 1.2);
      }
    } else if (j.state === 'open') {
      j.open += dt;
      j.fade = Math.max(0, Math.min(1, (22 - j.open) / 4));
      // anyone on the crate's side nearby is patched up and refilled, once each
      for (const u of b.unitGrid.near(j.pos.x, j.pos.z, 6, b.tmpA)) {
        if (!u.alive || u.team !== j.team || u.vehicle) continue;
        if (Math.hypot(u.pos.x - j.pos.x, u.pos.z - j.pos.z) > 5.5) continue;
        u.hp = Math.min(u.maxHp, u.hp + 45 * dt);
        if (!j.seen.has(u)) {
          j.seen.add(u);
          for (const w of u.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve ?? Infinity; w.heat = 0; }
          if (u.isPlayer) { b.events.push({ type: 'resupply' }); b.audio.play('reload', null, 0.8); }
        }
      }
      if (j.open > 22) this.finish(j, true);
    }
  }

  finish(j, done) {
    void done;
    this.jobs = this.jobs.filter((q) => q !== j);
    this.fx = this.fx.filter((q) => q !== j);
    for (const k of ['jet', 'beam', 'ring', 'crate']) {
      if (j[k]) { this.group.remove(j[k]); if (k !== 'jet' && k !== 'crate') j[k].material.dispose(); }
    }
    j.crate?.traverse((o) => { if (o.material && o.material !== crateMat) o.material.dispose(); });
  }

  clear() {
    for (const j of [...this.jobs]) this.finish(j);
    for (const s of this.shells) this.group.remove(s.m);
    this.shells.length = 0;
  }

  dispose() {
    this.clear();
    this.b.scene.remove(this.group);
  }

  // ---------- AI armies ----------
  // Every few seconds each AI army looks for the thickest knot of enemies (with none of its own
  // close by) and drops a barrage or strike on it; a crate goes down where its wounded gather.
  ai(dt) {
    const b = this.b;
    if (b.settings.mode !== 'battle' || b.aiFrozen || !b.player) return;
    for (let t = 0; t < this.think.length; t++) {
      if (t === b.settings.playerTeam || b.teams[t]?.lost) continue;
      this.think[t] -= dt;
      if (this.think[t] > 0) continue;
      this.think[t] = 5 + Math.random() * 4;
      this.aiPick(t);
    }
  }

  aiPick(team) {
    const b = this.b;
    const foes = [], mine = [];
    for (const u of b.units) {
      if (!u.alive || u.vehicle) continue;
      (u.team === team ? mine : (b.teams[u.team] ? foes : [])).push(u);
    }
    const attack = this.ready(team, 'strike') || this.ready(team, 'barrage');
    if (attack && foes.length >= 4) {
      let best = null, bs = 0;
      const step = Math.max(1, Math.floor(foes.length / 40));
      for (let i = 0; i < foes.length; i += step) {
        const c = foes[i];
        let n = 0, vehicles = 0;
        for (const f of foes) if (Math.hypot(f.pos.x - c.pos.x, f.pos.z - c.pos.z) < 11) n++;
        for (const v of b.vehicles) if (v.alive && v.team !== team && Math.hypot(v.pos.x - c.pos.x, v.pos.z - c.pos.z) < 12) vehicles++;
        let friends = 0;
        for (const m of mine) if (Math.hypot(m.pos.x - c.pos.x, m.pos.z - c.pos.z) < 14) friends++;
        const score = n + vehicles * 4 - friends * 2;
        // never on top of its own people, and only worth it when it catches several
        if (friends === 0 && n + vehicles * 3 >= 5 && score > bs) { bs = score; best = { c, vehicles }; }
      }
      if (best) {
        const base = b.teams[team].base;
        const dir = new THREE.Vector3(best.c.pos.x - base.x, 0, best.c.pos.z - base.z);
        if (best.vehicles && this.ready(team, 'strike')) { this.call(team, 'strike', best.c.pos, dir); return; }
        if (this.ready(team, 'barrage')) { this.call(team, 'barrage', best.c.pos, dir); return; }
        if (this.ready(team, 'strike')) { this.call(team, 'strike', best.c.pos, dir); return; }
      }
    }
    if (this.ready(team, 'supply')) {
      for (const u of mine) {
        if (u.hp > 60) continue;
        let hurt = 0;
        for (const m of mine) if (m.hp < 65 && Math.hypot(m.pos.x - u.pos.x, m.pos.z - u.pos.z) < 6) hurt++;
        if (hurt >= 4) { this.call(team, 'supply', u.pos, null); return; }
      }
    }
  }
}

// ---------- targeting ground marker ----------
// Shows where the call-in will land: a ring for blasts and drops, a long lane for the strike run.
export class Reticle {
  constructor(scene) {
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.9, depthTest: false, fog: false }));
    const lane = new THREE.PlaneGeometry(1, 1);
    lane.rotateX(-Math.PI / 2);
    this.lane = new THREE.Mesh(lane, new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.22, depthTest: false, fog: false, side: THREE.DoubleSide }));
    this.ring.renderOrder = this.lane.renderOrder = 6;
    this.ring.visible = this.lane.visible = false;
    this.ring.frustumCulled = this.lane.frustumCulled = false;
    scene.add(this.ring, this.lane);
  }

  show(kind, at, yaw, ok) {
    const y = height(at.x, at.z) + 0.3;
    const r = kind === 'barrage' ? 16 : kind === 'strike' ? 11 : 5.5;
    this.ring.position.set(at.x, y, at.z);
    this.ring.scale.set(r, 1, r);
    this.ring.visible = true;
    const col = ok ? '#ff7a1a' : '#e2513b';
    this.ring.material.color.set(col);
    this.lane.material.color.set(col);
    this.lane.visible = kind === 'strike';
    if (kind === 'strike') {
      this.lane.position.set(at.x, y, at.z);
      this.lane.rotation.y = yaw;
      this.lane.scale.set(r * 2, 1, 120);
    }
  }

  hide() { this.ring.visible = this.lane.visible = false; }
}

// ---------- the three call-in buttons ----------
const ICON = {
  strike: 'M12 2l2.6 7.5L22 13l-7.4 1.2L13.5 21h-3l-1.1-6.8L2 13l7.4-3.5z',
  barrage: 'M6 3v8M12 6v8M18 3v8M4 17l2 3 2-3M10 20l2 3 2-3M16 17l2 3 2-3',
  supply: 'M4 9a8 6 0 0116 0M4 9l8 7 8-7M12 16v1M9 21h6v-4H9z',
};
export class CallinBar {
  constructor(el, onPick) {
    this.el = el;
    this.btns = ORDER.map((k, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ci';
      b.setAttribute('aria-label', `${CALLINS[k].name} (T cycles call-ins)`);
      b.title = `${CALLINS[k].name}: ${CALLINS[k].hint}`;
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}" /></svg><i></i><b></b>`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onPick(i); });
      b.addEventListener('click', (e) => e.preventDefault());
      el.appendChild(b);
      return { b, fill: b.querySelector('i'), txt: b.querySelector('b'), last: '' };
    });
  }

  update(battle, team, sel) {
    ORDER.forEach((k, i) => {
      const o = this.btns[i];
      const left = battle.callins.left(team, k);
      const key = `${Math.ceil(left)}|${i === sel}`;
      if (key === o.last) return;
      o.last = key;
      o.b.classList.toggle('ready', left <= 0);
      o.b.classList.toggle('sel', i === sel);
      o.b.setAttribute('aria-pressed', i === sel);
      o.txt.textContent = left > 0 ? Math.ceil(left) : '';
      o.fill.style.transform = `scaleY(${left > 0 ? left / CALLINS[k].cd : 0})`;
    });
  }
}
