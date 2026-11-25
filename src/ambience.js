import * as THREE from 'three';
import { height } from './terrain.js';

// Things that burn on the battlefield: wrecked vehicles, a share of the ruined walls, and the
// wrecks lying about the map. Each site feeds the shared particle pools with a flickering flame,
// a tall wind-bent column of smoke, drifting embers and a little ash. Only the nearest few sites
// emit, and phones get fewer particles.
const C = (h) => new THREE.Color(h);
const FIRE0 = C('#ffd27a'), FIRE1 = C('#d2431a'), GLOW = C('#ff7a2a'), GLOW1 = C('#5a1608');
const SMK0 = C('#2b2927'), SMK1 = C('#77736b'), ASH = C('#a9a59c');
const WIND = new THREE.Vector3(0.9, 0, 0.35); // the whole battlefield shares one wind

export class Ambience {
  constructor(fx, { low = false, reduced = false } = {}) {
    this.fx = fx;
    this.low = low;
    this.reduced = reduced;
    this.sites = [];
    this.key = '';
    this.t = 0;
    this.v = new THREE.Vector3();
    this.p = new THREE.Vector3();
  }

  // static sites: scenery wrecks and a share of the ruins
  _scan(battle) {
    const key = `${battle.props.length}|${battle.decor.length}`;
    if (key === this.key) return;
    this.key = key;
    const out = [];
    for (const d of battle.decor) for (const f of d.userData.fires || []) out.push({ x: f.x, y: f.y, z: f.z, s: 1, id: `w${out.length}` });
    battle.props.forEach((p, i) => {
      if (p.type !== 'ruin' || (i * 7 + Math.round(p.group.position.x)) % 4) return;
      const g = p.group.position;
      out.push({ x: g.x, y: g.y + 1.0, z: g.z, s: 0.8, id: `r${i}`, ruin: true });
    });
    this.sites = out;
  }

  update(dt, camera, battle) {
    if (!battle || dt <= 0) return;
    this._scan(battle);
    this.t += dt;
    const cx = camera.position.x, cz = camera.position.z;
    const live = [];
    for (const s of this.sites) {
      const d = Math.hypot(s.x - cx, s.z - cz);
      if (d < 130) live.push({ s: s, d, k: 1 });
    }
    for (const v of battle.vehicles) {
      const dead = !v.alive;
      if (!dead && v.hp01 > 0.3) continue;
      if (dead && v.deadT > 70) continue;
      const c = v.center();
      const d = Math.hypot(c.x - cx, c.z - cz);
      if (d < 130) live.push({ s: { x: c.x, y: v.pos.y + 1.3, z: c.z, s: 1.3, id: `v${v.id ?? ''}` }, d, k: dead ? Math.max(0.25, 1 - v.deadT / 70) : 0.5 });
    }
    live.sort((a, b) => a.d - b.d);
    const n = this.low ? 3 : 7;
    for (let i = 0; i < Math.min(n, live.length); i++) this._burn(live[i].s, live[i].k, live[i].d, dt);
    // the nearest fire lights up its surroundings (borrowing one of the pooled blast lights)
    this.lit = (this.lit || 0) - dt;
    if (live.length && live[0].d < 40 && this.lit <= 0 && !this.reduced) {
      this.lit = 0.12;
      const s0 = live[0].s;
      this.fx.pulse(this.p.set(s0.x, s0.y + 0.6, s0.z), 1.6 + Math.random() * 1.2, 0.16, 10, '#ff8a3a');
    }
  }

  _burn(s, k, d, dt) {
    const fx = this.fx;
    const lod = d < 45 ? 1 : d < 90 ? 0.6 : 0.35;
    const q = (this.low ? 0.55 : 1) * lod * k;
    const emit = (rate, fn) => { s[fn.name] = (s[fn.name] || 0) + dt * rate; while (s[fn.name] >= 1) { s[fn.name]--; fn(); } };
    const at = (r) => this.p.set(s.x + fx.rnd(r), s.y, s.z + fx.rnd(r)).clone();
    const flick = 0.7 + 0.3 * Math.sin(this.t * 17 + s.x) * Math.sin(this.t * 7.3 + s.z);
    const sc = s.s;
    emit(26 * q, function flame() {
      fx.add.emit({ pos: at(0.45 * sc), vel: new THREE.Vector3(fx.rnd(0.3), 1.4 + Math.random() * 1.2, fx.rnd(0.3)), life: 0.45 + Math.random() * 0.4, size: [1.1 * sc, 0.2], color: [FIRE0, FIRE1], alpha: [1, 0], drag: 1.2, floor: false });
    });
    emit(3 * q, function glow() {
      fx.add.emit({ pos: at(0.2), life: 0.5, size: [3.8 * sc, 4.8 * sc], color: [GLOW, GLOW1], alpha: [0.13 * flick, 0], floor: false });
    });
    emit(5 * q, function column() {
      fx.norm.emit({ pos: at(0.4 * sc), vel: new THREE.Vector3(WIND.x * 0.5 + fx.rnd(0.15), 1.7 + Math.random() * 0.8, WIND.z * 0.5 + fx.rnd(0.15)), life: 6 + Math.random() * 3, size: [0.7 * sc, 4.6 * sc], color: [SMK0, SMK1], alpha: [0.5, 0], drag: 0.35, grav: -0.12, floor: false });
    });
    if (!this.reduced) {
      emit(2.4 * q, function ember() {
        fx.add.emit({ pos: at(0.5 * sc), vel: new THREE.Vector3(WIND.x * 1.4 + fx.rnd(0.8), 1.5 + Math.random() * 2.2, WIND.z + fx.rnd(0.8)), life: 2.2 + Math.random() * 1.6, size: [0.035, 0.015], color: [FIRE0, FIRE1], alpha: [1, 0], drag: 0.4, grav: -0.3, floor: false });
      });
      emit(1.2 * q, function ash() {
        fx.norm.emit({ pos: at(0.6 * sc), vel: new THREE.Vector3(WIND.x * 1.6 + fx.rnd(0.5), 1.2 + Math.random() * 1.4, WIND.z + fx.rnd(0.5)), life: 5 + Math.random() * 3, size: [0.05, 0.04], color: [ASH, ASH], alpha: [0.7, 0], drag: 0.5, grav: 0.12, floor: true });
      });
    }
  }
}
