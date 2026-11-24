import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { height, normalAt } from './terrain.js';
import { canvasTex, decalMesh, stamp } from './effects.js';
import { TEAMS } from './factions.js';
import { U } from './rig.js';
import { onShell, HALF } from './wounds.js';
import { rayBox } from './physics.js';

// Stylised gore, three levels (0 off, 1 low, 2 full), remembered in localStorage.
//  - spray: streaks of blood that arc, fall and splat where they land, plus a red mist
//  - entry and exit wounds stay on the soldier's body (drawn by the crowd, with a drip)
//  - splatter and wet pools on the ground; they hold, then shrink away
//  - gibs (full only): blasts and heavy hits tear off hands and feet, shell fragments and red
//    chunks. They tumble, bounce, trail blood and come to rest.
//  - tuned per weapon: rifle and cannon hits blow out through the back, light guns mist,
//    blasts burst, plasma burns (little blood, more chunks), fire draws none
// All pooled: four decal meshes, one droplet mesh, one gib mesh and the crowd's wound mesh.
const KEY = 'sm.gore';
const BLOOD = [new THREE.Color('#9a1a1a'), new THREE.Color('#5c0e0e')];
const GIB_MAX = 220, DROP_MAX = 520, HOLD = 50, FADE = 20;
const UP = new THREE.Vector3(0, 1, 0);
const TRIM = TEAMS.map((t) => new THREE.Color(t.trim));
const SHELL = TEAMS.map((t) => new THREE.Color(t.body));
const FOOTC = new THREE.Color('#1d2126');
const CHUNK = [new THREE.Color('#7a1212'), new THREE.Color('#5a0d0d'), new THREE.Color('#9b2323')];
const DROPC = [new THREE.Color('#8a1616'), new THREE.Color('#6e1010'), new THREE.Color('#701212')];
const TAU = Math.PI * 2;

function splatTexture(kind) {
  return canvasTex(128, (g, S) => {
    const h = S / 2;
    g.fillStyle = 'rgba(105,14,14,0.92)';
    if (kind === 'pool') {
      // wet pool: lobed body, dark rim, bright glossy streak
      g.beginPath();
      const n = 22;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU, r = h * (0.62 + 0.25 * Math.sin(a * 3 + 1) * Math.cos(a * 2) + Math.random() * 0.08);
        g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
      }
      g.closePath(); g.fill();
      const gr = g.createRadialGradient(h, h, 2, h, h, h * 0.8);
      gr.addColorStop(0, 'rgba(60,4,4,0.75)'); gr.addColorStop(1, 'rgba(60,4,4,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      g.fillStyle = 'rgba(255,150,140,0.22)';
      g.beginPath(); g.ellipse(h - 14, h - 18, 18, 8, -0.5, 0, TAU); g.fill();
      return;
    }
    if (kind === 'streak') {
      // thrown streak: tapering smear with a tail of drops
      g.beginPath(); g.moveTo(h, h * 0.2);
      g.bezierCurveTo(h * 1.5, h * 0.7, h * 1.3, h * 1.3, h, h * 1.75);
      g.bezierCurveTo(h * 0.7, h * 1.3, h * 0.5, h * 0.7, h, h * 0.2);
      g.fill();
      for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(h + (Math.random() - 0.5) * h * 0.7, h * (0.1 + Math.random() * 0.5), 2 + Math.random() * 4, 0, TAU); g.fill(); }
      return;
    }
    // splat: irregular core ringed by satellite drops
    g.beginPath();
    const n = 16, r0 = h * 0.42;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, r = r0 * (0.5 + Math.random() * 0.6);
      g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, d = h * (0.4 + Math.random() * 0.5), r = 1.5 + Math.random() * 6;
      g.beginPath(); g.arc(h + Math.cos(a) * d, h + Math.sin(a) * d, r, 0, TAU); g.fill();
      if (Math.random() < 0.5) { g.lineWidth = r * 0.8; g.strokeStyle = 'rgba(105,14,14,0.85)'; g.beginPath(); g.moveTo(h + Math.cos(a) * r0, h + Math.sin(a) * r0); g.lineTo(h + Math.cos(a) * d, h + Math.sin(a) * d); g.stroke(); }
    }
  });
}

// a ring of ground decals that hold, then shrink away (pools can also spread out first)
class DecalSet {
  constructor(scene, n, tex, rough) {
    this.n = n;
    this.mesh = decalMesh(scene, n, tex, rough);
    this.mesh.receiveShadow = false;
    this.age = new Float32Array(n).fill(1e9);
    this.size = new Float32Array(n);
    this.grow = new Float32Array(n); // target size while spreading
    this.pos = Array.from({ length: n }, () => new THREE.Vector3());
    this.quat = Array.from({ length: n }, () => new THREE.Quaternion());
    this.m = new THREE.Matrix4(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.tick = 0;
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  add(x, z, size, spreadTo = 0, yaw) {
    const y = height(x, z), nrm = normalAt(x, z);
    if (nrm.y < 0.7) return -1;
    const i = this.mesh.userData.next % this.n;
    stamp(this.mesh, this.p.set(x, y, z), nrm, spreadTo ? size * 0.35 : size);
    if (yaw !== undefined) {
      const q = new THREE.Quaternion().setFromUnitVectors(UP, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
      this.mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, z).addScaledVector(nrm, 0.012), q, this.s.set(spreadTo ? size * 0.35 : size, 1, spreadTo ? size * 0.35 : size)));
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.age[i] = 0; this.size[i] = spreadTo ? size * 0.35 : size; this.grow[i] = spreadTo ? size : 0;
    this.mesh.getMatrixAt(i, this.m);
    this.m.decompose(this.pos[i], this.quat[i], this.s);
    return i;
  }

  // stamp on any surface: normal n, long axis pointing along `dir` (projected onto the surface)
  addOn(p, n, size, dir, spreadTo = 0) {
    const i = this.mesh.userData.next++ % this.n;
    const y = this._y.copy(n), z = this._z.copy(dir);
    z.addScaledVector(y, -z.dot(y));
    if (z.lengthSq() < 1e-4) z.set(Math.random() - 0.5, 0, Math.random() - 0.5).addScaledVector(y, 0).cross(y);
    if (z.lengthSq() < 1e-4) z.set(1, 0, 0);
    z.normalize();
    const x = this._x.crossVectors(y, z);
    this.m.makeBasis(x, y, z);
    const q = this.quat[i].setFromRotationMatrix(this.m);
    const sz = spreadTo ? size * 0.35 : size;
    this.pos[i].copy(p).addScaledVector(n, 0.012);
    this.mesh.setMatrixAt(i, this.m.compose(this.pos[i], q, this.s.set(sz, 1, sz)));
    this.mesh.count = Math.min(this.n, Math.max(this.mesh.count, i + 1));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.age[i] = 0; this.size[i] = sz; this.grow[i] = spreadTo ? size : 0;
    return i;
  }

  clear() { this.age.fill(1e9); this.grow.fill(0); this.mesh.count = 0; this.mesh.userData.next = 0; }

  update(dt) {
    let dirty = false;
    this.tick -= dt;
    const slow = this.tick <= 0;
    if (slow) this.tick = 0.25;
    for (let i = 0; i < this.mesh.count; i++) {
      if (this.age[i] > 1e8) continue;
      let sz = this.size[i], touch = false;
      if (this.grow[i] > sz) { sz = this.size[i] = Math.min(this.grow[i], sz + dt * 0.12); touch = true; }
      if (slow) {
        this.age[i] += 0.25;
        const over = this.age[i] - HOLD;
        if (over >= 0) { const k = Math.max(0, 1 - over / FADE); if (!k) this.age[i] = 1e9; sz *= k; touch = true; }
      } else if (!touch) continue;
      this.mesh.setMatrixAt(i, this.m.compose(this.pos[i], this.quat[i], this.s.set(sz, 1, sz)));
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const L2 = (g) => g.level === 2;

export class Gore {
  constructor(scene, fx) {
    this.fx = fx;
    let lv = 2;
    try { const v = localStorage.getItem(KEY); if (v !== null && +v >= 0 && +v <= 2) lv = +v; } catch {}
    this.level = lv;
    this.splats = [0, 1, 2].map(() => new DecalSet(scene, 130, splatTexture('splat'), 0.65));
    this.streaks = new DecalSet(scene, 70, splatTexture('streak'), 0.7);
    this.pools = new DecalSet(scene, 90, splatTexture('pool'), 0.3);
    this.walls = new DecalSet(scene, 140, splatTexture('splat'), 0.65);
    this.wallRuns = new DecalSet(scene, 60, splatTexture('streak'), 0.7);
    this.sets = [...this.splats, this.streaks, this.pools, this.walls, this.wallRuns];
    this.world = null; // the battle, set by main: props and soldiers for blood to hit
    this.hitV = new THREE.Vector3(); this.hitN = new THREE.Vector3(); this.hitD = new THREE.Vector3(); this.hitO = new THREE.Vector3(); this.nbuf = [];
    this.si = 0;
    // droplets: small beads, stretched a little along their flight
    const dg = new THREE.IcosahedronGeometry(1, 0);
    this.dropMesh = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: '#ffffff', fog: true }), DROP_MAX);
    this.dropMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DROP_MAX * 3), 3);
    this.dropMesh.count = 0; this.dropMesh.frustumCulled = false;
    scene.add(this.dropMesh);
    this.drops = [];
    // gibs
    const geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.2);
    this.gibMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.05 }), GIB_MAX);
    this.gibMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GIB_MAX * 3), 3);
    this.gibMesh.count = 0; this.gibMesh.frustumCulled = false; this.gibMesh.castShadow = true;
    scene.add(this.gibMesh);
    this.gibs = [];
    this.gi = 0;
    this.bleeders = [];
    this.live = []; // wounded soldiers still on their feet: they drip as they go
    this.runs = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.v = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.z = new THREE.Vector3(0, 0, 1);
  }

  get decalCount() { return this.sets.reduce((a, d) => a + d.mesh.count, 0); }

  setLevel(l) {
    this.level = l;
    try { localStorage.setItem(KEY, String(l)); } catch {}
  }

  clear() {
    for (const d of this.sets) d.clear();
    this.drops.length = 0; this.dropMesh.count = 0;
    this.gibs.length = 0; this.gi = 0; this.gibMesh.count = 0;
    this.bleeders.length = 0; this.live.length = 0;
    this.runs.length = 0;
  }

  // drop any bleeding or wound runs tied to a unit that is back on its feet
  forget(u) {
    this.bleeders = this.bleeders.filter((b) => b.u !== u);
    this.live = this.live.filter((x) => x !== u);
    this.runs = this.runs.filter((r) => !(u.wounds || []).includes(r));
  }

  rnd(s = 1) { return (Math.random() * 2 - 1) * s; }
  splat(x, z, size) { if (this.level) this.splats[this.si++ % 3].add(x, z, size); }

  // ---- droplets ----
  drop(pos, vel, size = 0.03, big = false) {
    if (this.drops.length >= DROP_MAX) this.drops.shift();
    this.drops.push({ p: pos.clone(), v: vel.clone(), size, big, c: (Math.random() * 3) | 0, k: 0.04 / Math.max(size, 0.012) * (0.7 + Math.random() * 0.6) });
  }

  // a spray of droplets from pos along dir: speed range, spread, count
  spray(pos, dir, n, v0, v1, spread, size = 0.03) {
    if (!this.level) return;
    n = Math.ceil(n * (this.level === 2 ? 1 : 0.5));
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(v0 + Math.random() * (v1 - v0)).add(this.v.set(this.rnd(spread), this.rnd(spread), this.rnd(spread)).multiplyScalar(v1 * 0.5));
      this.drop(pos, v, size * (0.6 + Math.random() * 0.9), Math.random() < 0.35);
    }
  }

  mist(pos, vel, size, n = 1, alpha = 0.5) {
    if (!this.level) return;
    for (let i = 0; i < n; i++) this.fx.norm.emit({ pos, vel: vel.clone().add(this.fx.dir(0.8)), life: 0.5 + Math.random() * 0.4, size: [size * 0.4, size * (0.9 + Math.random() * 0.6)], color: BLOOD, alpha: [alpha, 0], drag: 2.5, grav: 1.5 });
  }

  // ---- wounds on the body (drawn by crowd.js, wrapped onto the shell by wounds.js) ----
  // kind: 'splash' (blood soaked in), 'hole' (small bullet hole), 'exit' (ragged blow-out).
  // Entry sits on the side the shot came from, exit on the far side. Depth dents the shell.
  wound(u, d, s, exit, kind = 'splash', depth = 0) {
    const w = u.wounds || (u.wounds = []);
    const sx = (exit ? 1 : -1) * d.x, sz = (exit ? 1 : -1) * d.z;
    const c = Math.cos(u.facing), sn = Math.sin(u.facing);
    const lx = sx * c - sz * sn, lz = sx * sn + sz * c; // into the unit's local frame
    const xFace = Math.abs(lx) / (U.W / 2) > Math.abs(lz) / (U.D / 2);
    const y = this.rnd(U.H * 0.34), side = Math.random() * 2 - 1;
    const nx = xFace ? Math.sign(lx || 1) : 0, nz = xFace ? 0 : Math.sign(lz || 1);
    const q = onShell(xFace ? nx * U.W / 2 : side * HALF[0] * 1.1, y, xFace ? side * HALF[2] * 1.2 : nz * U.D / 2, {});
    const rec = (sa, sb, tile, dent, dd, extra) => { const r = { x: q.x, y: q.y, z: q.z, nx, nz, sa, sb, tile, sh: Math.random(), dent, dd }; if (extra) Object.assign(r, extra); w.push(r); return r; };
    const big = s * (exit ? 1.4 : 1);
    if (kind === 'hole') rec(0.13, 0.13, 1, depth, depth);
    else if (kind === 'exit') rec(big * 2.4 + 0.1, big * 2.4 + 0.1, 3, -depth, -depth);
    else {
      rec(big * 2 + 0.06, big * 2 + 0.06, 0, 0, depth);
      // the wound keeps bleeding: a thin run that creeps down the shell, following its curves
      if (this.level === 2 && this.runs.length < 160) { const r = rec(0.05, big * 0.4, 2, 0, 0); r.top = r.y - 0.02; r.len = big * 0.4; r.max = 0.3 + Math.random() * 0.5; r.v = 0.03 + Math.random() * 0.04; r.y = r.top - r.len / 2; this.runs.push(r); }
    }
    while (w.length > (this.level === 2 ? 20 : 8)) { const o = w.shift(); if (o.max) { const k = this.runs.indexOf(o); if (k >= 0) this.runs.splice(k, 1); } }
  }

  // ---- hits ----
  hit(pos, dir, dmg, kind, u) {
    const L = this.level;
    if (!L || kind === 'fire') return;
    u.wound = Math.min(1, (u.wound || 0) + dmg / 80);
    if (u.alive && !this.live.includes(u) && this.live.length < 60) this.live.push(u);
    const d = dir ? dir.clone().normalize() : UP;
    const back = d.clone().negate();
    const blast = kind === 'blast', plasma = kind === 'plasma';
    if (blast) {
      this.spray(pos, UP, 10 + dmg / 10, 2, 8, 1.6, 0.04);
      this.mist(pos, UP.clone().multiplyScalar(1.5), 1.3, 4, 0.55);
      for (let i = 0; i < (L === 2 ? 6 : 3); i++) this.wound(u, this.v.set(this.rnd(), 0, this.rnd()), 0.1 + Math.random() * 0.1, i & 1, i & 1 ? 'exit' : 'hole', 0.05 + Math.random() * 0.035); // blasted craters
      this.bits(pos, UP, 6, 5);
      this.splat(pos.x + this.rnd(1.4), pos.z + this.rnd(1.4), 0.45 + Math.random() * 0.4);
      return;
    }
    if (plasma) {
      // cauterised: a little blood, a puff of smoke
      this.spray(pos, back, 3, 1, 3, 0.8, 0.025);
      this.fx.smoke(pos, UP.clone().multiplyScalar(0.6), 0.25, 0.4);
      this.wound(u, d, 0.1, false, 'hole', 0.03);
      this.bits(pos, back, 1, 2);
      return;
    }
    // bullets: heavier rounds put more through the unit and out the far side
    const heavy = THREE.MathUtils.clamp(dmg / 48, 0.3, 2.4);
    this.spray(pos, back, 2 + heavy * 2, 1, 3.5, 0.9, 0.025);              // entry: a small puff back at the shooter
    this.spray(pos, d, 3 + heavy * 6, 3, 8 + heavy * 3, 0.45, 0.035);      // exit: a fan thrown out the far side
    this.mist(pos, d.clone().multiplyScalar(2), 0.35 + heavy * 0.4, 1 + (heavy > 0.8 ? 1 : 0), 0.45);
    // the round dents the shell going in, and sometimes tears out the far side
    const depth = 0.022 + heavy * 0.016;
    this.wound(u, d, 0.05 + heavy * 0.03, false, 'splash', depth);
    this.wound(u, d, 0, false, 'hole', depth + 0.006);
    if (dmg >= 18 && Math.random() < 0.65 + heavy * 0.2) {
      this.wound(u, d, 0.1 + heavy * 0.05, true, 'exit', depth * 2);
      this.bits(pos, d, 2 + Math.round(heavy * 2), 4 + heavy * 2); // chips of shell and flesh out the back
    } else this.bits(pos, back, 1, 2.5);
    if (Math.random() < 0.35 + heavy * 0.2) {
      const k = 0.8 + Math.random() * (1 + heavy), x = pos.x + d.x * k, z = pos.z + d.z * k;
      if (heavy > 0.7) this.streaks.add(x, z, 0.5 + heavy * 0.5, 0, Math.atan2(d.x, d.z) + Math.PI);
      else this.splat(x, z, 0.25 + Math.random() * 0.3 + heavy * 0.12);
    }
  }

  // small chips of shell and flesh knocked loose by a hit (full gore only)
  bits(pos, dir, n, speed) {
    if (this.level < 2) return;
    for (let i = 0; i < n; i++) {
      const sz = 0.03 + Math.random() * 0.05;
      this.addGib(pos, this.v.set(0, 0, 0), [sz, sz * 0.7, sz * 1.2], i % 3 === 0 ? SHELL[(Math.random() * SHELL.length) | 0] : CHUNK[i % 3], speed, dir);
    }
  }

  // ---- deaths ----
  death(u, kind, world) {
    const L = this.level;
    if (!L) return;
    const h = u.lastHit, dmg = h ? h.dmg : 0, rag = u.rag, c = u.center();
    if (this.bleeders.length < 80) this.bleeders.push({ u, t: 0, drip: 0, kind, pooled: false, size: kind === 'blast' ? 1.9 : 1.3 + dmg / 150 });
    // a final burst
    const d = h?.dir ? h.dir.clone().normalize() : UP;
    this.spray(c, d, 10, 2, 7, 1.2, 0.035);
    this.mist(c, UP.clone().multiplyScalar(1.2), 0.9, 2, 0.5);
    // blood lands on the soldiers standing close by
    if (world && (kind === 'blast' || dmg >= 30)) {
      const near = world.nearUnits(u.pos.x, u.pos.z, kind === 'blast' ? 3 : 1.6).slice();
      for (const o of near) if (o !== u && o.alive) { const dx = o.pos.x - u.pos.x, dz = o.pos.z - u.pos.z; o.wound = Math.min(1, (o.wound || 0) + 0.12); this.wound(o, this.v.set(-dx, 0, -dz), 0.06 + Math.random() * 0.05, false, 'splash', 0); }
    }
    if (L < 2 || !rag) return;
    const blast = kind === 'blast', plasma = kind === 'plasma';
    const heavy = dmg >= 45;
    let limbs = blast ? 2 + Math.floor(Math.random() * 3) : plasma ? 1 + Math.floor(Math.random() * 2) : heavy ? (Math.random() < 0.45 ? 1 : 0) : Math.random() < 0.04 ? 1 : 0;
    let shells = blast ? 2 + Math.floor(Math.random() * 3) : plasma ? 1 : heavy && Math.random() < 0.4 ? 1 : 0;
    let chunks = blast ? 7 + Math.floor(Math.random() * 5) : plasma ? 4 : 2 + Math.floor(Math.random() * 3) + Math.floor(dmg / 30);
    const sp = blast ? 6 : plasma ? 4 : 3;
    u.lost = u.lost || 0;
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    for (let k = 0; k < limbs; k++) {
      const li = order[k], l = rag.limbs[li];
      if (!l) continue;
      u.lost |= li < 2 ? 1 << li : 4 << (li - 2);
      this.addGib(l.p, rag.body.v, li < 2 ? [0.1, 0.1, 0.12] : [0.15, 0.085, 0.25], li < 2 ? TRIM[u.team] : FOOTC, sp * 1.1);
      this.spray(l.p, UP, 6, 1, 4, 1.4, 0.035);
    }
    for (let k = 0; k < shells; k++) { const s = 0.12 + Math.random() * 0.1; this.addGib(c, rag.body.v, [s * 1.3, s * 0.35, s], SHELL[u.team], sp); }
    for (let k = 0; k < chunks; k++) { const s = 0.05 + Math.random() * 0.08; this.addGib(c, rag.body.v, [s, s * 0.75, s * 1.15], CHUNK[k % 3], sp * 1.2); }
  }

  addGib(p, base, size, color, speed, dir) {
    const g = {
      p: p.clone(), v: new THREE.Vector3(this.rnd(), 0.7 + Math.random() * 0.9, this.rnd()).multiplyScalar(speed * (0.5 + Math.random() * 0.7)).addScaledVector(base, 0.5),
      q: new THREE.Quaternion().random(), w: new THREE.Vector3(this.rnd(11), this.rnd(11), this.rnd(11)),
      size: size.slice(), slot: this.gi % GIB_MAX, asleep: false, trail: 0.9, drip: 0,
    };
    if (dir) { g.v.multiplyScalar(0.45).addScaledVector(dir, speed * (0.6 + Math.random() * 0.6)); }
    this.gibMesh.instanceColor.setXYZ(g.slot, color.r, color.g, color.b);
    this.gibMesh.instanceColor.needsUpdate = true;
    this.gibs[g.slot] = g;
    this.gi++;
    this.gibMesh.count = Math.min(GIB_MAX, this.gi);
    this.writeGib(g);
  }

  writeGib(g) {
    this.gibMesh.setMatrixAt(g.slot, this.m.compose(g.p, g.q, this.s.set(g.size[0], g.size[1], g.size[2])));
  }

  // Did this droplet hit something on its last step? Leaves a splat shaped by speed and angle.
  impact(d, sp) {
    const p = d.p, v = d.v, o = this.hitO, w = this.world;
    const N = this.hitN, dir = this.hitD.copy(v).divideScalar(sp || 1);
    // cover and walls (props are oriented boxes)
    if (w && w.propGrid) {
      const seg = o.distanceTo(p);
      if (seg > 1e-5) {
        const ray = this.v.copy(p).sub(o).divideScalar(seg);
        let best = null;
        for (const pr of w.propGrid.near(p.x, p.z, 0.8, this.nbuf)) {
          const h = rayBox(o, ray, seg, pr.box);
          if (h && h.t > 0 && (!best || h.t < best.t)) best = h;
        }
        if (best) { p.copy(o).addScaledVector(ray, best.t); N.copy(best.n); this.land(d, sp, N, dir); return true; }
      }
    }
    // soldiers: big beads that reach one leave a stain on it
    if (w && d.big && p.y < 2.1 && sp > 1.2) {
      for (const u of w.nearUnits(p.x, p.z, 0.5)) {
        if (!u.alive || u.removed) continue;
        const dx = p.x - u.pos.x, dz = p.z - u.pos.z;
        if (dx * dx + dz * dz < 0.09 && p.y > u.pos.y && p.y < u.pos.y + U.H) {
          if (Math.random() < 0.3 && this.level) { u.wound = Math.min(1, (u.wound || 0) + 0.01); this.wound(u, this.v.copy(dir).negate().setY(0), 0.04 + Math.random() * 0.04, false, 'splash', 0); }
          this.mist(p, this.hitV.set(0, 0.3, 0), 0.2, 1, 0.3);
          return true;
        }
      }
    }
    // ground
    const gy = height(p.x, p.z);
    if (p.y <= gy) { p.y = gy; this.land(d, sp, normalAt(p.x, p.z), dir); return true; }
    return false;
  }

  land(d, sp, nrm, dir) {
    if (!this.level) return;
    const p = d.p, wall = nrm.y < 0.6;
    const cosI = Math.abs(dir.dot(nrm)), shallow = 1 - cosI; // 1 = grazing
    // light beads at slow speed just soak in; big and fast ones spread. Drips that fall a long way splash wider.
    const big = d.big || sp > 6;
    const size = Math.min(0.75, d.size * (2.6 + sp * 0.45) + Math.random() * 0.06);
    if (!big && Math.random() < 0.55) return;
    const set = wall ? this.walls : this.splats[this.si++ % 3];
    if (shallow > 0.55 && sp > 4 && size > 0.18) {
      // a glancing hit smears along its travel
      (wall ? this.wallRuns : this.streaks).addOn(p, nrm, size * (1.1 + shallow * 0.8), dir);
    } else set.addOn(p, nrm, size, dir);
    if (wall && big) this.wallRuns.addOn(p, nrm, 0.25 + size * 0.7, this.hitV.set(0, -1, 0)); // runs down
    // fast impacts throw satellite droplets back out
    if (sp > 5 && d.big && this.drops.length < DROP_MAX * 0.75) {
      const m = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < m; i++) {
        const out = this.hitV.set(this.rnd(), Math.random(), this.rnd()).normalize().addScaledVector(nrm, 0.9).addScaledVector(dir, 0.35 * shallow).multiplyScalar(sp * (0.12 + Math.random() * 0.22));
        this.drop(p.clone().addScaledVector(nrm, 0.03), out, d.size * (0.4 + Math.random() * 0.3), false);
      }
    }
  }

  update(dt) {
    if (!this.level && !this.gibs.length && !this.bleeders.length && !this.drops.length) return;
    // gibs: tumble, bounce, trail blood, settle
    let dirty = false;
    for (const g of this.gibs) {
      if (!g || g.asleep) continue;
      g.v.y -= 15 * dt;
      g.p.addScaledVector(g.v, dt);
      this.q.set(g.w.x * dt * 0.5, g.w.y * dt * 0.5, g.w.z * dt * 0.5, 0).multiply(g.q);
      g.q.x += this.q.x; g.q.y += this.q.y; g.q.z += this.q.z; g.q.w += this.q.w; g.q.normalize();
      const r = Math.min(g.size[0], g.size[1], g.size[2]) * 0.5, gy = height(g.p.x, g.p.z) + r;
      if (g.trail > 0 && this.level) {
        g.trail -= dt; g.drip -= dt;
        if (g.drip <= 0) { g.drip = 0.035; this.drop(g.p, this.v.set(this.rnd(0.6), this.rnd(0.4), this.rnd(0.6)), 0.03, false); }
      }
      if (g.p.y < gy) {
        g.p.y = gy;
        if (g.v.y < -1.5 && this.level) { this.splat(g.p.x, g.p.z, 0.22 + Math.random() * 0.25); this.spray(g.p, UP, 3, 1, 3, 1.2, 0.03); }
        g.v.y *= -0.35; g.v.x *= 0.7; g.v.z *= 0.7; g.w.multiplyScalar(0.6);
        if (Math.abs(g.v.y) < 0.6 && Math.hypot(g.v.x, g.v.z) < 0.4) { g.asleep = true; g.p.y = gy - r * 0.3; }
      }
      this.writeGib(g);
      dirty = true;
    }
    if (dirty) this.gibMesh.instanceMatrix.needsUpdate = true;
    // droplets: real ballistics. Gravity and air drag bend the arc, fast ones fly further, light
    // mist slows and hangs, and each drop splats on whatever it meets: ground, cover or a soldier.
    const dm = this.dropMesh;
    let n = 0;
    const keep = [];
    for (const d of this.drops) {
      const p = d.p, v = d.v;
      this.hitO.copy(p);
      v.y -= 11 * dt;
      const damp = Math.exp(-d.k * dt);
      v.multiplyScalar(damp);
      p.addScaledVector(v, dt);
      const sp = v.length();
      if (this.impact(d, sp)) continue;
      keep.push(d);
      const stretch = Math.min(2.4, 1 + sp * 0.07), r = d.size * 0.85;
      this.q.setFromUnitVectors(this.z, this.v.copy(v).divideScalar(sp || 1));
      dm.setMatrixAt(n, this.m.compose(p, this.q, this.s.set(r, r, r * stretch)));
      const c = DROPC[d.c];
      dm.instanceColor.setXYZ(n, c.r, c.g, c.b);
      n++;
    }
    this.drops = keep;
    dm.count = n;
    dm.instanceMatrix.needsUpdate = true; dm.instanceColor.needsUpdate = true;
    // bodies bleed while they slump, then leave a wide wet pool that keeps spreading
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i], u = b.u;
      b.t += dt;
      if (u.removed || u.alive || !u.rag) { this.bleeders.splice(i, 1); continue; }
      const bp = u.rag.body.pos;
      // arterial pulses for the first couple of seconds
      b.pulse = (b.pulse ?? 0) - dt;
      if (b.pulse <= 0 && b.t < 2.2 && L2(this) && b.kind !== 'plasma') { b.pulse = 0.32; const a = Math.random() * TAU; this.spray(bp, this.v.set(Math.cos(a) * 0.5, 0.9, Math.sin(a) * 0.5), 7, 3, 6.5, 0.25, 0.03); }
      // smears where the body slides
      if (!u.rag.asleep && b.last) {
        const dx = bp.x - b.last.x, dz = bp.z - b.last.z, dd = Math.hypot(dx, dz);
        if (dd > 0.35) { this.streaks.add(bp.x - dx * 0.5, bp.z - dz * 0.5, 0.35 + dd, 0, Math.atan2(dx, dz) + Math.PI); b.last.set(bp.x, 0, bp.z); }
      } else if (!b.last) b.last = new THREE.Vector3(bp.x, 0, bp.z);
      b.drip -= dt;
      if (b.drip <= 0 && b.t < 3) { b.drip = 0.12; this.spray(bp, UP, 2, 0.5, 2.5, 1.2, 0.03); this.splat(bp.x + this.rnd(0.4), bp.z + this.rnd(0.4), 0.2 + Math.random() * 0.2); }
      if (!b.pooled && (u.rag.asleep || b.t > 5)) { b.pooled = true; this.pools.add(bp.x, bp.z, b.size * (1.1 + Math.random() * 0.4), 1); this.bleeders.splice(i, 1); }
    }
    // wounded soldiers drip as they move: worse wounds drip faster, leaving a trail of spots
    for (let i = this.live.length - 1; i >= 0; i--) {
      const u = this.live[i];
      if (!u.alive || u.removed || !(u.wound > 0.05)) { this.live.splice(i, 1); continue; }
      u.dripT = (u.dripT ?? 0) - dt;
      if (u.dripT <= 0) {
        u.dripT = 0.55 / (0.3 + u.wound * 2.5) * (0.6 + Math.random() * 0.8);
        const c = u.center(), sp = Math.hypot(u.vel.x, u.vel.z);
        this.v.set(u.vel.x * 0.5 + this.rnd(0.4), 0.2 + Math.random() * 0.5, u.vel.z * 0.5 + this.rnd(0.4));
        this.drop(this.p.set(c.x + this.rnd(0.12), c.y - 0.2 + this.rnd(0.3), c.z + this.rnd(0.12)), this.v, 0.026 + Math.random() * 0.016, true);
        if (u.wound > 0.5 && sp > 0.5 && L2(this)) this.splat(u.pos.x, u.pos.z, 0.12 + Math.random() * 0.12);
      }
    }
    // bleeding wounds creep down the shell
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i];
      if (r.len >= r.max) { this.runs.splice(i, 1); continue; }
      r.len += r.v * dt;
      r.sb = r.len;
      r.y = r.top - r.len / 2;
    }
    for (const d of this.sets) d.update(dt);
  }
}
