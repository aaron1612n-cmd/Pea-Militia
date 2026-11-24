import * as THREE from 'three';
import { height, normalAt } from './terrain.js';
import { canvasTex, decalMesh, stamp } from './effects.js';
import { TEAMS } from './factions.js';
import { U } from './rig.js';
import { headGeo, helmetGeo } from './anatomy.js';
import { LOST, lumpGeo, stripGeo, shardGeo, plateGeo, pieceGeo, woundMaterial } from './wreck.js';
import { onShell, HALF } from './wounds.js';
import { rayBox } from './physics.js';

// Gore, three levels (0 off, 1 low, 2 full), remembered in localStorage. Built from how wounds really
// look (wound ballistics and bloodstain pattern references), then scaled to a game:
//  - entry wounds are small, neat holes with next to no spray; a few coarse drops back toward the shooter
//  - exit wounds are larger and ragged, and throw a fan of fine mist and spots out ALONG the bullet's line:
//    stains land on cover, walls and ground behind the target (forward spatter), thinning with distance
//  - stains are shaped by how they land: round on a square hit, long and tailed when glancing
//  - blood comes from where the body is hurt: pulsing arterial spurts (heartbeat, fading pressure) from a
//    severed limb, neck or ruined head; wounded soldiers drip; the dead leave a pool that slowly spreads
//  - full gore only: blasts and heavy rounds tear soldiers apart at the joints. Limbs come off at the
//    shoulder, elbow, hip or knee leaving a ragged stump (muscle, bone, marrow); heads are destroyed, chests
//    torn open. Loose tissue is irregular lumps, strips and bone splinters that tumble, flatten and smear
//  - restrained for bullets, severe for blasts and cannon; plasma burns (little blood); fire draws none
// All pooled: decal meshes, one droplet mesh, one mesh per kind of gib, the crowd's wound meshes.
const KEY = 'sm.gore';
const BLOOD = [new THREE.Color('#4a0a0a'), new THREE.Color('#2a0606')]; // mist: dark, never bright
const DROP_MAX = 420, HOLD = 50, FADE = 20;
const UP = new THREE.Vector3(0, 1, 0);
const SLEEVE = TEAMS.map((t) => new THREE.Color(t.body));
const TROUSER = TEAMS.map((t) => new THREE.Color(t.trim).multiplyScalar(1.15));
const HELM = TEAMS.map((t) => new THREE.Color(t.ui).multiplyScalar(0.72));
const HEADC = TEAMS.map((t) => new THREE.Color(t.trim).multiplyScalar(1.6)); // the balaclava the crowd draws
const SHELL = ['#6b6f6c', '#7a7a72', '#5a5e5c'].map((c) => new THREE.Color(c)); // torn armour plate: dull steel, never a team colour
// raw tissue: muscle, darker clot, pale fat, and the pink-grey of brain
const MEAT = ['#9a2424', '#7a1414', '#b13a34', '#5a0d0d', '#c98d7a', '#8a1c1c'].map((c) => new THREE.Color(c));
const BRAINC = ['#b58f8c', '#a07a78', '#c4a09a'].map((c) => new THREE.Color(c));
const BONEC = new THREE.Color('#ffe6dc');
const DROPC = [new THREE.Color('#5c0c0c'), new THREE.Color('#450909'), new THREE.Color('#6b1010'), new THREE.Color('#380707')];
const TAU = Math.PI * 2;

function splatTexture(kind) {
  return canvasTex(128, (g, S) => {
    const h = S / 2;
    g.fillStyle = 'rgba(86,9,9,0.94)';
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
      if (Math.random() < 0.5) { g.lineWidth = r * 0.8; g.strokeStyle = 'rgba(86,9,9,0.85)'; g.beginPath(); g.moveTo(h + Math.cos(a) * r0, h + Math.sin(a) * r0); g.lineTo(h + Math.cos(a) * d, h + Math.sin(a) * d); g.stroke(); }
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
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
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
      if (this.grow[i] > sz) { sz = this.size[i] = Math.min(this.grow[i], sz + dt * 0.05); touch = true; }
      if (slow) {
        this.age[i] += 0.25;
        // wet blood is dark and glossy; it browns and dulls as it dries
        const dry = Math.min(1, this.age[i] / 60);
        this.mesh.instanceColor.setXYZ(i, 1 - 0.25 * dry, 1 - 0.55 * dry, 1 - 0.6 * dry); dirty = true; this.mesh.instanceColor.needsUpdate = true;
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
const clamp = THREE.MathUtils.clamp;
const rndPick = (a) => a[(Math.random() * a.length) | 0];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

// one instanced mesh per kind of gib, written as a ring
class GibSet {
  constructor(scene, geo, mat, cap, shadow = true) {
    this.cap = cap; this.n = 0; this.items = new Array(cap).fill(null);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = shadow;
    scene.add(this.mesh);
  }
  take() { const slot = this.n++ % this.cap; const old = this.items[slot]; if (old) old.dead = true; this.mesh.count = Math.min(this.cap, this.n); return slot; }
  clear() { for (const g of this.items) if (g) g.dead = true; this.items.fill(null); this.n = 0; this.mesh.count = 0; }
}
const wet = (o) => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.32, metalness: 0.02, vertexColors: true, ...o });

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
    this.hitV = new THREE.Vector3(); this.hitN = new THREE.Vector3(); this.hitD = new THREE.Vector3(); this.hitO = new THREE.Vector3(); this.nbuf = []; this.cbuf = [];
    this.si = 0; this.budget = 0;
    // droplets: small beads, stretched a little along their flight
    const dg = new THREE.IcosahedronGeometry(1, 0);
    this.dropMesh = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, metalness: 0.05 }), DROP_MAX); // wet and glossy
    this.dropMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DROP_MAX * 3), 3);
    this.dropMesh.count = 0; this.dropMesh.frustumCulled = false;
    scene.add(this.dropMesh);
    this.drops = [];
    // gibs: irregular tissue, bone and ruined parts (see wreck.js)
    const cloth = () => woundMaterial({ roughness: 0.7 });
    this.gs = {
      lumpA: new GibSet(scene, lumpGeo(1), wet(), 70), lumpB: new GibSet(scene, lumpGeo(5), wet(), 70),
      strip: new GibSet(scene, stripGeo(2), wet(), 50), shard: new GibSet(scene, shardGeo(3), wet({ roughness: 0.5 }), 60),
      plate: new GibSet(scene, plateGeo(4), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }), 24),
      arm: new GibSet(scene, pieceGeo({ len: 0.42, r0: 0.037, r1: 0.027, end: 'hand', seed: 11 }), cloth(), 16),
      fore: new GibSet(scene, pieceGeo({ len: 0.21, r0: 0.03, r1: 0.025, end: 'hand', seed: 12 }), cloth(), 16),
      leg: new GibSet(scene, pieceGeo({ len: 0.44, r0: 0.054, r1: 0.036, end: 'foot', seed: 13 }), cloth(), 16),
      shin: new GibSet(scene, pieceGeo({ len: 0.22, r0: 0.042, r1: 0.032, end: 'foot', seed: 14 }), cloth(), 16),
      helmet: new GibSet(scene, helmetGeo('rifleman'), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.1, vertexColors: true, side: THREE.DoubleSide }), 16),
      head: new GibSet(scene, headGeo(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, vertexColors: true }), 12),
    };
    this.active = []; // gibs still moving
    this.bleeders = [];
    this.spurts = []; // pulsing arterial jets from severed limbs, necks and ruined heads
    this.live = []; // wounded soldiers still on their feet: they drip as they go
    this.runs = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.v = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.z = new THREE.Vector3(0, 0, 1);
  }

  get decalCount() { return this.sets.reduce((a, d) => a + d.mesh.count, 0); }
  get gibCount() { return Object.values(this.gs).reduce((a, g) => a + g.mesh.count, 0); }

  setLevel(l) {
    this.level = l;
    try { localStorage.setItem(KEY, String(l)); } catch {}
  }

  clear() {
    for (const d of this.sets) d.clear();
    this.drops.length = 0; this.dropMesh.count = 0;
    for (const g of Object.values(this.gs)) g.clear();
    this.active.length = 0;
    this.bleeders.length = 0; this.live.length = 0; this.spurts.length = 0;
    this.runs.length = 0;
  }

  // drop any bleeding or wound runs tied to a unit that is back on its feet
  forget(u) {
    this.bleeders = this.bleeders.filter((b) => b.u !== u);
    this.live = this.live.filter((x) => x !== u);
    this.spurts = this.spurts.filter((s) => s.u !== u);
    this.runs = this.runs.filter((r) => !(u.wounds || []).includes(r));
  }

  // a drag trail: wavy, broken, never a ruler line, with spatter and flicked drops either side
  smear(x, z, dx, dz, dd) {
    if (!dd) return;
    const nx = -dz / dd, nz = dx / dd, a = Math.atan2(dx, dz) + Math.PI;
    if (Math.random() > 0.35) this.streaks.add(x + nx * this.rnd(0.14), z + nz * this.rnd(0.14), (0.25 + dd * (0.5 + Math.random() * 0.7)) * (0.6 + Math.random() * 0.7), 0, a + this.rnd(0.4));
    for (let k = (Math.random() * 3) | 0; k > 0; k--) this.splat(x + nx * this.rnd(0.4) + dx * this.rnd(0.5), z + nz * this.rnd(0.4) + dz * this.rnd(0.5), 0.07 + Math.random() * 0.17);
    if (Math.random() < 0.6) this.drop(this.p.set(x, height(x, z) + 0.12, z), this.v.set(nx * this.rnd(2.2) + dx / dd * 0.6, 0.6 + Math.random() * 1.4, nz * this.rnd(2.2) + dz / dd * 0.6), 0.012 + Math.random() * 0.02, Math.random() < 0.3);
  }

  rnd(s = 1) { return (Math.random() * 2 - 1) * s; }
  splat(x, z, size) { if (this.level) this.splats[this.si++ % 3].add(x, z, size); }

  // ---- droplets ----
  drop(pos, vel, size = 0.03, big = false) {
    if (this.drops.length >= DROP_MAX) this.drops.shift();
    this.drops.push({ p: pos.clone(), v: vel.clone(), size, big, c: (Math.random() * 4) | 0, k: 0.04 / Math.max(size, 0.012) * (0.7 + Math.random() * 0.6) });
  }

  // a spray of droplets from pos along dir: speed range, spread, count
  spray(pos, dir, n, v0, v1, spread, size = 0.03) {
    if (!this.level) return;
    n = Math.ceil(n * (this.level === 2 ? 1 : 0.5));
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(v0 + Math.random() * (v1 - v0)).add(this.v.set(this.rnd(spread), this.rnd(spread), this.rnd(spread)).multiplyScalar(v1 * 0.5));
      this.drop(pos, v, size * (0.25 + Math.random() * Math.random() * 1.7), Math.random() < 0.3); // many fine drops, a few fat ones
    }
  }

  mist(pos, vel, size, n = 1, alpha = 0.5) {
    if (!this.level) return;
    for (let i = 0; i < n; i++) this.fx.norm.emit({ pos, vel: vel.clone().add(this.fx.dir(0.8)), life: 0.4 + Math.random() * 0.4, size: [size * 0.2, size * (0.45 + Math.random() * 0.35)], color: BLOOD, alpha: [alpha * 0.4, 0], drag: 3, grav: 2.2 });
  }

  // ---- stains on whatever is behind ----
  // Cast a thrown drop's path (a shallow arc) from `o` along `dir` and report the first prop face or
  // patch of ground it meets: { p, n, t } or null. Props are tested once per call through `cands`.
  cast(o, dir, reach, cands, out) {
    const step = 0.35, v0 = 12, g = 0.5 * 11;
    let ax = o.x, ay = o.y, az = o.z;
    for (let s = step; s <= reach + 1e-4; s += step) {
      const t = s / v0, bx = o.x + dir.x * s, bz = o.z + dir.z * s, by = o.y + dir.y * s - g * t * t;
      _a.set(ax, ay, az); _b.set(bx - ax, by - ay, bz - az);
      const seg = _b.length();
      if (seg > 1e-5) {
        _b.divideScalar(seg);
        let best = null;
        for (const pr of cands) { const h = rayBox(_a, _b, seg, pr.box); if (h && h.t > 0 && (!best || h.t < best.t)) best = h; }
        if (best) { out.p.copy(_a).addScaledVector(_b, best.t); out.n.copy(best.n); out.t = s; return true; }
      }
      const gy = height(bx, bz);
      if (by <= gy) {
        const k = clamp((ay - height(ax, az)) / Math.max(1e-4, (ay - height(ax, az)) - (by - gy)), 0, 1);
        const x = ax + (bx - ax) * k, z = az + (bz - az) * k;
        out.p.set(x, height(x, z), z); out.n.copy(normalAt(x, z)); out.t = s;
        return out.n.y > 0.5 || true;
      }
      ax = bx; ay = by; az = bz;
    }
    return false;
  }

  stain(p, n, dir, size) {
    const wall = n.y < 0.6, shallow = 1 - Math.abs(dir.dot(n));
    if (shallow > 0.5 && size > 0.05) (wall ? this.wallRuns : this.streaks).addOn(p, n, size * (1.2 + shallow), dir);
    else (wall ? this.walls : this.splats[this.si++ % 3]).addOn(p, n, size, dir);
  }

  // Forward spatter: fine spots flung out along the bullet's line from an exit wound. A fan about
  // 20 degrees wide, so stains scatter further apart the further they travel, and the biggest
  // ones land nearest. `count` rays; each leaves a stain, and some a few satellite spots.
  spatter(pos, dir, count, reach, cone = 0.34, size = 0.1) {
    if (!this.level || this.budget <= 0) return;
    count = Math.ceil(count * (this.level === 2 ? 1 : 0.5));
    this.budget -= count;
    const w = this.world, cands = w?.propGrid ? w.propGrid.near(pos.x + dir.x * reach * 0.5, pos.z + dir.z * reach * 0.5, reach * 0.5 + 1.2, this.cbuf) : [];
    const hit = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: 0 }, d = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      d.copy(dir).add(this.hitV.set(this.rnd(cone), this.rnd(cone * 0.8) - 0.1 - Math.random() * 0.25, this.rnd(cone))).normalize();
      if (!this.cast(pos, d, reach * (0.55 + Math.random() * 0.45), cands, hit)) continue;
      const near = 1 - hit.t / (reach + 0.5);
      const sz = size * (0.35 + Math.random() * 0.9) * (0.5 + near * 0.8);
      this.stain(hit.p, hit.n, d, sz);
      if (Math.random() < 0.55) { // satellites: tiny spots beside it, thrown off the main drop's tail
        const m = 1 + ((Math.random() * 3) | 0);
        for (let k = 0; k < m; k++) {
          const off = this.hitV.set(this.rnd(), this.rnd(), this.rnd()).multiplyScalar(sz * 1.6);
          off.addScaledVector(hit.n, -off.dot(hit.n));
          this.stain(_c.copy(hit.p).add(off), hit.n, d, sz * (0.25 + Math.random() * 0.25));
        }
      }
    }
  }

  // ---- wounds on the body (drawn by crowd.js, wrapped onto the shell by wounds.js) ----
  // kind: 'splash' (blood soaked in), 'hole' (small neat entry hole), 'exit' (ragged blow-out),
  // 'open' (chest torn open: ribs and viscera), 'shred' (ragged raw flesh).
  // Entry sits on the side the shot came from, exit on the far side. Depth dents the shell.
  wound(u, d, s, exit, kind = 'splash', depth = 0) {
    const w = u.wounds || (u.wounds = []);
    const sx = (exit ? 1 : -1) * d.x, sz = (exit ? 1 : -1) * d.z;
    const c = Math.cos(u.facing), sn = Math.sin(u.facing);
    const lx = sx * c - sz * sn, lz = sx * sn + sz * c; // into the unit's local frame
    const xFace = Math.abs(lx) / (U.W / 2) > Math.abs(lz) / (U.D / 2);
    const y = (kind === 'open' ? U.H * 0.08 : 0) + this.rnd(U.H * (kind === 'open' ? 0.12 : 0.34)), side = Math.random() * 2 - 1;
    const nx = xFace ? Math.sign(lx || 1) : 0, nz = xFace ? 0 : Math.sign(lz || 1);
    const q = onShell(xFace ? nx * U.W / 2 : side * HALF[0] * 1.1, y, xFace ? side * HALF[2] * 1.2 : nz * U.D / 2, {});
    const rec = (sa, sb, tile, dent, dd, extra) => { const r = { x: q.x, y: q.y, z: q.z, nx, nz, sa, sb, tile, sh: Math.random(), dent, dd }; if (extra) Object.assign(r, extra); w.push(r); return r; };
    const big = s * (exit ? 1.4 : 1);
    if (kind === 'hole') rec(0.1, 0.1, 1, depth, depth);
    else if (kind === 'exit') rec(big * 2.4 + 0.08, big * 2.4 + 0.08, 3, -depth, -depth);
    else if (kind === 'open') rec(s * 2 + 0.1, s * 2 + 0.1, 4, -depth, -depth);
    else if (kind === 'shred') rec(s * 2 + 0.06, s * 2 + 0.06, 5, -depth * 0.6, -depth * 0.6);
    else {
      rec(big * 2 + 0.05, big * 2 + 0.05, 0, 0, depth);
      // the wound keeps bleeding: a thin run that creeps down the shell, following its curves
      if (this.level === 2 && this.runs.length < 160) { const r = rec(0.05, big * 0.4, 2, 0, 0); r.top = r.y - 0.02; r.len = big * 0.4; r.max = 0.3 + Math.random() * 0.5; r.v = 0.03 + Math.random() * 0.04; r.y = r.top - r.len / 2; this.runs.push(r); }
    }
    while (w.length > (this.level === 2 ? 24 : 8)) { const o = w.shift(); if (o.max) { const k = this.runs.indexOf(o); if (k >= 0) this.runs.splice(k, 1); } }
  }

  // ---- hits ----
  // A bullet makes a small neat entry hole with almost no blood outside. If it passes through it leaves a
  // larger, ragged exit wound and throws a fan of fine mist and spots out along its line.
  hit(pos, dir, dmg, kind, u, zone = 'torso') {
    const L = this.level;
    if (!L || kind === 'fire') return;
    const dead = !u.alive;
    u.wound = Math.min(1, (u.wound || 0) + dmg / 80);
    if (u.alive && !this.live.includes(u) && this.live.length < 60) this.live.push(u);
    const d = dir ? dir.clone().normalize() : UP;
    const back = d.clone().negate();
    const blast = kind === 'blast', plasma = kind === 'plasma';
    if (blast) {
      // shrapnel: a scatter of small holes and torn patches, a short upward puff of blood. The real damage comes at death.
      this.spray(pos, UP, 3 + dmg / 22, 1.5, 5, 1.4, 0.03);
      this.mist(pos, UP.clone().multiplyScalar(1.2), 0.9, 2, 0.45);
      const n = clamp(Math.round(dmg / 25), 2, 5);
      for (let i = 0; i < n; i++) this.wound(u, this.v.set(this.rnd(), 0, this.rnd()), 0.03 + Math.random() * 0.05, i & 1, i % 3 === 0 && dmg > 55 ? 'shred' : i & 1 ? 'exit' : 'hole', 0.03 + Math.random() * 0.03);
      this.splat(pos.x + this.rnd(1.2), pos.z + this.rnd(1.2), 0.3 + Math.random() * 0.3);
      return;
    }
    if (plasma) {
      // cauterised: a little blood, a puff of smoke
      this.spray(pos, back, 2, 1, 3, 0.8, 0.02);
      this.fx.smoke(pos, UP.clone().multiplyScalar(0.6), 0.25, 0.4);
      this.wound(u, d, 0.08, false, 'hole', 0.03);
      return;
    }
    // bullets
    const heavy = clamp(dmg / 48, 0.3, 2.4) * (dead ? 0.5 : 1);
    const head = zone === 'head', limb = zone === 'arm' || zone === 'leg';
    // entry: tiny. A faint puff and a couple of coarse drops straight back toward the shooter (back spatter)
    this.spray(pos, back, 1 + (heavy > 0.8 ? 1 : 0), 0.6, 2.2, 0.45, 0.016);
    if (!dead && Math.random() < 0.5) this.mist(pos, back.clone().multiplyScalar(0.5), 0.12, 1, 0.22);
    if (!dead) this.spatter(pos, back, 1 + (heavy > 1 ? 1 : 0), 1.3, 0.5, 0.06);
    const depth = 0.018 + heavy * 0.01;
    if (!head) {
      this.wound(u, d, 0.018 + heavy * 0.008, false, 'splash', depth);
      this.wound(u, d, 0, false, 'hole', depth + 0.004);
    }
    // through and through? a rifle round usually is; a limb round less so
    const through = dmg >= 18 && Math.random() < (limb ? 0.35 : head ? 0.8 : 0.5 + heavy * 0.22);
    if (through) {
      if (!head) this.wound(u, d, 0.03 + heavy * 0.022, true, 'exit', depth * 1.8);
      // forward spatter: mist and fine droplets along the line, stains on what is behind
      const n = 3 + heavy * 4 + (head ? 3 : 0);
      this.spray(pos, d, n, 2.5, 7 + heavy * 2, 0.3, 0.016);
      this.mist(pos, d.clone().multiplyScalar(2.2), 0.25 + heavy * 0.2, 1 + (heavy > 1 ? 1 : 0), 0.32);
      this.spatter(pos, d, 5 + heavy * 5 + (head ? 4 : 0), 2.8 + heavy * 2.4, 0.3, 0.13 + heavy * 0.05);
      if (L === 2 && !dead) this.tissue(pos, d, { lumps: heavy > 0.9 ? 1 : 0, strips: Math.random() < 0.4 ? 1 : 0, shards: head ? 2 : 0 }, 3 + heavy);
    }
  }

  // ---- tissue ------------------------------------------------------------------------------------
  // Loose pieces thrown from a wound: irregular lumps, sinew strips, bone splinters, scraps of armour.
  tissue(pos, dir, { lumps = 0, strips = 0, shards = 0, plates = 0, brain = false }, speed = 3, base = null) {
    if (this.level < 2) return;
    for (let i = 0; i < lumps; i++) {
      const sz = 0.025 + Math.random() * 0.03, set = Math.random() < 0.5 ? this.gs.lumpA : this.gs.lumpB;
      this.addGib(set, pos, [sz * (0.8 + Math.random() * 0.6), sz * (0.6 + Math.random() * 0.5), sz * (0.8 + Math.random() * 0.5)], brain && i % 2 ? rndPick(BRAINC) : rndPick(MEAT), speed, dir, base, { r: sz * 0.35, squash: true, trail: 0.7 });
    }
    for (let i = 0; i < strips; i++) {
      const sz = 0.05 + Math.random() * 0.05;
      this.addGib(this.gs.strip, pos, [sz * 0.8, sz * (1.1 + Math.random() * 0.5), sz * 1.2], rndPick(MEAT), speed * 0.9, dir, base, { r: sz * 0.12, squash: true, trail: 0.5 });
    }
    for (let i = 0; i < shards; i++) {
      const sz = 0.03 + Math.random() * 0.045;
      this.addGib(this.gs.shard, pos, [sz, sz, sz], BONEC, speed * 1.1, dir, base, { r: sz * 0.12, trail: 0.2 });
    }
    for (let i = 0; i < plates; i++) {
      const sz = 0.07 + Math.random() * 0.06;
      this.addGib(this.gs.plate, pos, [sz, sz, sz], rndPick(SHELL), speed, dir, base, { r: sz * 0.05 });
    }
  }

  // ---- deaths ------------------------------------------------------------------------------------
  death(u, kind, world) {
    const L = this.level;
    if (!L) return;
    const h = u.lastHit, dmg = h ? h.dmg : 0, rag = u.rag, c = u.center(), zone = h?.zone || 'torso';
    const blast = kind === 'blast', plasma = kind === 'plasma';
    const severe = blast || dmg >= 95; // blasts and cannon rounds tear bodies; bullets do not
    const d = h?.dir ? h.dir.clone().normalize() : UP;
    if (this.bleeders.length < 80) this.bleeders.push({ u, t: 0, drip: 0, kind, pooled: false, size: severe ? 1.35 + Math.random() * 0.3 : plasma ? 0.55 : 0.75 + Math.min(0.3, dmg / 260), severe });
    if (severe) {
      // the body bursts: a cloud and a radial throw of blood and mist, stains on the ground around it
      this.spray(c, UP, 14, 2, 7, 1.4, 0.03);
      this.mist(c, UP.clone().multiplyScalar(1.4), 1.2, 3, 0.5);
      for (let i = 0; i < 6; i++) { const a = Math.random() * TAU, r = 0.4 + Math.random() * 1.5; this.splat(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0.25 + Math.random() * 0.35); }
    } else if (!plasma) {
      this.spray(c, d, 2, 1, 3, 0.5, 0.018); // a bullet death is quiet: the body slumps, the wounds leak
    }
    // blood lands on the soldiers standing close by
    if (world && (blast || dmg >= 60)) {
      const near = world.nearUnits(u.pos.x, u.pos.z, blast ? 2.6 : 1.4).slice();
      for (const o of near) if (o !== u && o.alive) { const dx = o.pos.x - u.pos.x, dz = o.pos.z - u.pos.z; o.wound = Math.min(1, (o.wound || 0) + 0.08); this.wound(o, this.v.set(-dx, 0, -dz), 0.04 + Math.random() * 0.03, false, 'splash', 0); }
    }
    if (L < 2 || !rag) return;
    u.lost = u.lost || 0;
    // ---- head ----
    if (zone === 'head' && kind === 'bullet' && dmg >= 38) {
      // from behind the round leaves through the face; from the front, through the back and crown of the skull
      const fwd = _a.set(Math.sin(u.facing), 0, Math.cos(u.facing));
      const fromBehind = d.dot(fwd) > 0;
      this.ruinHead(u, dmg >= 150 ? 'off' : fromBehind ? 'face' : 'crown', d);
    } else if (blast && !(u.lost & (LOST.HEAD | LOST.FACE | LOST.CROWN)) && Math.random() < 0.3) {
      this.ruinHead(u, Math.random() < 0.5 ? 'off' : Math.random() < 0.5 ? 'face' : 'crown', UP);
    }
    // ---- limbs: torn at the joints ----
    const nl = blast ? 1 + ((Math.random() * 3) | 0) : severe ? 1 : plasma && Math.random() < 0.3 ? 1 : 0;
    if (nl) this.tear(u, nl, blast ? 6 : 4, d);
    // ---- torso opened up ----
    if (severe || (kind === 'bullet' && dmg >= 80 && zone === 'torso')) {
      this.wound(u, d, 0.07 + Math.random() * 0.04, true, 'open', 0.05);
      if (severe) this.wound(u, this.v.set(this.rnd(), 0, this.rnd()), 0.05 + Math.random() * 0.03, false, 'open', 0.04);
      this.tissue(c, d, { lumps: severe ? 5 + ((Math.random() * 4) | 0) : 2, strips: severe ? 3 : 1, shards: severe ? 3 : 1, plates: blast ? 2 : 0 }, severe ? 6 : 3.5, rag.body.v);
      this.addSpurt(u, 'chest', 0.5);
    }
  }

  // destroy a head. 'off': torn clean away (a flying head and helmet, a neck stump that spurts).
  // 'face': the face blown out (exit through the front). 'crown': the back and top of the skull opened (exit through the back).
  ruinHead(u, how, dir) {
    const rag = u.rag;
    if (!rag) return;
    const bit = how === 'off' ? LOST.HEAD : how === 'face' ? LOST.FACE : LOST.CROWN;
    if (u.lost & (LOST.HEAD | LOST.FACE | LOST.CROWN)) return;
    u.lost |= bit;
    const neck = this.bodyPoint(rag, 0, 0.215, 0.0, _c).clone();
    const out = dir === UP ? UP : dir;
    this.addGib(this.gs.helmet, neck, [1, 1, 1], HELM[u.team], 4.2, UP, rag.body.v, { r: 0.09, trail: 0 }); // the helmet is knocked off
    const sk = HEADC[u.team];
    if (how === 'off') {
      this.addGib(this.gs.head, neck, [1, 1, 1], sk, 4.5, UP, rag.body.v, { r: 0.07, trail: 1.6 });
      this.spray(neck, UP, 12, 2, 6, 0.5, 0.02);
    } else {
      // forward spatter and debris along the line of the shot
      const exit = out; // the way the round carried the debris
      this.spray(neck, exit, 14, 3, 9, 0.35, 0.018);
      this.mist(neck, exit.clone().multiplyScalar(2.5), 0.55, 3, 0.4);
      this.spatter(neck, exit, 16, 4.6, 0.36, 0.17);
      this.tissue(neck, exit, { lumps: 3, strips: 1, shards: 4, brain: how === 'crown' }, 5, rag.body.v);
    }
    this.addSpurt(u, 'neck', how === 'off' ? 1 : 0.55);
  }

  // world position of a point given in the body block's frame
  bodyPoint(rag, x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyQuaternion(rag.body.q).add(rag.body.pos);
  }

  // Tear limbs off a body already down, at the joints: through the upper arm or thigh near the
  // shoulder or hip, or at the elbow or knee. The torn piece flies off as a real arm or leg
  // section with a ragged wound face; the body keeps a stump that bleeds.
  tear(u, n, speed, dir) {
    const rag = u.rag;
    if (this.level < 2 || !rag) return 0;
    u.lost = u.lost || 0;
    // legs go first in blasts (the ground-level effect), then arms
    const order = [2, 3, 0, 1].sort(() => Math.random() - 0.5 + 0.35 * (Math.random() < 0.5 ? 1 : 0));
    let done = 0;
    for (const li of order) {
      if (done >= n) break;
      const arm = li < 2, k = arm ? li : li - 2, whole = Math.random() < 0.45;
      const bitW = arm ? LOST.ARM << k : LOST.LEG << k, bitP = arm ? LOST.FORE << k : LOST.SHIN << k;
      if (u.lost & (bitW | bitP)) continue;
      u.lost |= whole ? bitW : bitP; done++;
      const l = rag.limbs[li];
      const set = arm ? (whole ? this.gs.arm : this.gs.fore) : (whole ? this.gs.leg : this.gs.shin);
      const tint = arm ? SLEEVE[u.team] : TROUSER[u.team];
      const at = this.bodyPoint(rag, arm ? (k ? -1 : 1) * U.SH_X : (k ? 1 : -1) * U.HIP_X, arm ? U.SH_Y : -U.H / 2 + 0.035, 0, _c).clone();
      const mid = l.p.clone().lerp(at, whole ? 0.55 : 0.35);
      this.addGib(set, mid, [1, 1, 1], tint, speed, dir, rag.body.v, { r: arm ? 0.03 : 0.045, long: true, trail: 2.2, tumble: 7 });
      this.spray(at, UP, 5, 1, 4, 0.8, 0.02);
      this.tissue(at, dir, { lumps: 1, strips: 1, shards: 1 }, speed * 0.7, rag.body.v);
      this.addSpurt(u, (arm ? 'arm' : 'leg') + k + (whole ? 'w' : 'p'), 0.8);
    }
    return done;
  }

  // a living-looking pulse of blood from a wound on a body: anchored to the body block, so it follows the
  // body as it falls or slides. Pressure fades as the heart empties.
  addSpurt(u, where, pressure) {
    if (this.level < 2 || !u.rag || this.spurts.length >= 28) return;
    const loc = { chest: [0, 0.05, 0.1, 0, 0.2, 1], neck: [0, 0.21, 0, 0, 1, 0],
      arm0w: [0.168, 0.15, 0, 1, 0.2, 0], arm1w: [-0.168, 0.15, 0, -1, 0.2, 0], arm0p: [0.19, -0.05, 0, 1, -0.3, 0.3], arm1p: [-0.19, -0.05, 0, -1, -0.3, 0.3],
      leg0w: [-0.085, -0.175, 0, -0.3, -1, 0.2], leg1w: [0.085, -0.175, 0, 0.3, -1, 0.2], leg0p: [-0.09, -0.3, 0.05, -0.2, -1, 0.5], leg1p: [0.09, -0.3, 0.05, 0.2, -1, 0.5] }[where] || null;
    const e = loc || [0, 0.1, 0, 0, 1, 0];
    if (where === 'chest') pressure *= 0.7;
    this.spurts.push({ u, at: new THREE.Vector3(e[0], e[1], e[2]), dir: new THREE.Vector3(e[3], e[4], e[5]).normalize(), t: 0, tau: 2.2 + pressure * 3.2, p0: pressure, phase: Math.random(), acc: 0, jet: 0 });
  }

  // tear pieces off a body that is already down: more limbs, tissue, a little blood
  dismember(u, n, speed = 4) {
    const rag = u.rag;
    if (this.level < 2 || !rag) return;
    const d = this.hitD.set(this.rnd(), 0.3, this.rnd()).normalize().clone();
    const k = this.tear(u, n, speed, d);
    const c = rag.body.pos;
    this.tissue(c, d, { lumps: 3 + n, strips: 1 + (n > 1 ? 1 : 0), shards: k ? 1 : 0 }, speed, rag.body.v);
    if (!(u.lost & (LOST.HEAD | LOST.FACE | LOST.CROWN)) && Math.random() < 0.25) this.ruinHead(u, 'crown', d);
    this.wound(u, d, 0.06 + Math.random() * 0.04, true, Math.random() < 0.6 ? 'open' : 'shred', 0.05);
    this.spray(c, UP, 5, 1.5, 4, 1, 0.025);
    this.splat(c.x + this.rnd(0.8), c.z + this.rnd(0.8), 0.35 + Math.random() * 0.3);
    this.pools.add(c.x, c.z, 0.9 + Math.random() * 0.4, 1);
  }

  // ---- gibs -------------------------------------------------------------------------------------
  // opts: r = rest radius, squash = flattens and smears when it lands, long = settles lying flat,
  // trail = seconds it drips blood in flight, tumble = spin rate
  addGib(set, p, size, color, speed, dir, base, opts = {}) {
    const slot = set.take();
    const g = {
      set, slot, p: p.clone(), q: new THREE.Quaternion().random(), size: size.slice(), asleep: false, dead: false,
      v: new THREE.Vector3(this.rnd(), 0.7 + Math.random() * 0.9, this.rnd()).multiplyScalar(speed * (0.5 + Math.random() * 0.7)),
      w: new THREE.Vector3(this.rnd(1), this.rnd(1), this.rnd(1)).multiplyScalar(opts.tumble ?? 11),
      r: opts.r ?? 0.03, squash: !!opts.squash, long: !!opts.long, sq: 0, trail: opts.trail ?? 0.9, drip: 0, hits: 0,
    };
    if (base) g.v.addScaledVector(base, 0.5);
    if (dir) g.v.multiplyScalar(0.45).addScaledVector(dir, speed * (0.6 + Math.random() * 0.6));
    if (g.long) g.q.setFromUnitVectors(this.z, this.hitV.set(this.rnd(), this.rnd(0.4), this.rnd()).normalize());
    set.items[slot] = g;
    set.mesh.instanceColor.setXYZ(slot, color.r, color.g, color.b);
    set.mesh.instanceColor.needsUpdate = true;
    this.active.push(g);
    this.writeGib(g);
    set.mesh.instanceMatrix.needsUpdate = true;
    return g;
  }

  writeGib(g) {
    const k = g.sq;
    this.s.set(g.size[0] * (1 + 0.28 * k), g.size[1] * (1 - 0.5 * k), g.size[2] * (1 + 0.28 * k));
    g.set.mesh.setMatrixAt(g.slot, this.m.compose(g.p, g.q, this.s));
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
          if (Math.random() < 0.3 && this.level) { u.wound = Math.min(1, (u.wound || 0) + 0.01); this.wound(u, this.v.copy(dir).negate().setY(0), 0.03 + Math.random() * 0.03, false, 'splash', 0); }
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
    const size = Math.min(0.6, d.size * (2.6 + sp * 0.45) + Math.random() * 0.04);
    if (!big && Math.random() < 0.55) return;
    const set = wall ? this.walls : this.splats[this.si++ % 3];
    if (shallow > 0.55 && sp > 4 && size > 0.12) {
      // a glancing hit smears along its travel
      (wall ? this.wallRuns : this.streaks).addOn(p, nrm, size * (1.1 + shallow * 0.8), dir);
    } else set.addOn(p, nrm, size, dir);
    if (wall && big && size > 0.1) this.wallRuns.addOn(p, nrm, 0.2 + size * 0.7, this.hitV.set(0, -1, 0)); // runs down
    // fast impacts throw satellite droplets back out
    if (sp > 5 && d.big && this.drops.length < DROP_MAX * 0.7) {
      const m = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < m; i++) {
        const out = this.hitV.set(this.rnd(), Math.random(), this.rnd()).normalize().addScaledVector(nrm, 0.9).addScaledVector(dir, 0.35 * shallow).multiplyScalar(sp * (0.12 + Math.random() * 0.22));
        this.drop(p.clone().addScaledVector(nrm, 0.03), out, d.size * (0.4 + Math.random() * 0.3), false);
      }
    }
  }

  update(dt) {
    this.budget = 48;
    if (!this.level && !this.active.length && !this.bleeders.length && !this.drops.length && !this.spurts.length) return;
    // gibs: tumble, bounce, trail blood, flatten and smear where they land, settle
    for (let i = this.active.length - 1; i >= 0; i--) {
      const g = this.active[i];
      if (g.dead || g.asleep) { this.active.splice(i, 1); continue; }
      g.v.y -= 15 * dt;
      g.p.addScaledVector(g.v, dt);
      this.q.set(g.w.x * dt * 0.5, g.w.y * dt * 0.5, g.w.z * dt * 0.5, 0).multiply(g.q);
      g.q.x += this.q.x; g.q.y += this.q.y; g.q.z += this.q.z; g.q.w += this.q.w; g.q.normalize();
      const gy = height(g.p.x, g.p.z) + g.r;
      if (g.trail > 0 && this.level) {
        g.trail -= dt; g.drip -= dt;
        if (g.drip <= 0) { g.drip = 0.05; this.drop(g.p, this.v.set(this.rnd(0.5), this.rnd(0.3), this.rnd(0.5)), 0.016 + Math.random() * 0.01, false); }
      }
      if (g.p.y < gy) {
        g.p.y = gy;
        const hs = Math.hypot(g.v.x, g.v.z), vy = -g.v.y;
        if (vy > 1.4 && this.level) {
          g.hits++;
          if (g.squash) g.sq = Math.min(1, g.sq + 0.45); // lumps flatten as they land
          // a wet slap: a stain along the way it was travelling, shorter each bounce, and a few flicked drops
          const sz = (0.12 + Math.random() * 0.1) * (g.squash ? 1 : 0.6) / g.hits;
          if (hs > 3.5) this.streaks.add(g.p.x, g.p.z, sz * (0.9 + hs * 0.12), 0, Math.atan2(g.v.x, g.v.z) + Math.PI);
          else this.splat(g.p.x, g.p.z, sz);
          if (g.squash) this.spray(g.p, UP, 2, 0.8, 2.6, 1, 0.016);
        }
        g.v.y *= -0.3; g.v.x *= 0.65; g.v.z *= 0.65; g.w.multiplyScalar(0.55);
        if (Math.abs(g.v.y) < 0.6 && hs < 0.4) {
          g.asleep = true; g.p.y = gy - g.r * 0.3;
          if (g.long) { // lie flat on the ground, along whatever way it ended up pointing
            const ax = this.hitV.set(0, 0, 1).applyQuaternion(g.q); ax.y = 0;
            if (ax.lengthSq() > 1e-4) { this.q.setFromUnitVectors(this.hitD.set(0, 0, 1).applyQuaternion(g.q), ax.normalize()); g.q.premultiply(this.q); }
          }
          // settle: a small pool under a piece that bled
          if (this.level) { if (g.long || g.set === this.gs.head) this.pools.add(g.p.x, g.p.z, 0.35, 0.9); else if (g.squash) this.splat(g.p.x, g.p.z, 0.1 + Math.random() * 0.06); }
        }
      }
      this.writeGib(g);
      g.set.mesh.instanceMatrix.needsUpdate = true;
    }
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
    // arterial spurts: the heart pushes a jet out on every beat while pressure lasts
    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i], u = s.u, rag = u.rag;
      s.t += dt;
      const press = s.p0 * Math.exp(-s.t / s.tau);
      if (u.removed || u.alive || !rag || press < 0.06 || s.t > 14) { this.spurts.splice(i, 1); continue; }
      const rate = 0.9 + 1.5 * press; // beats per second slow as the heart fails
      s.phase += dt * rate;
      if (s.phase >= 1) { s.phase -= 1; s.jet = 0.17; }
      const o = this.bodyPoint(rag, s.at.x, s.at.y, s.at.z, this.p), dir = this.hitD.copy(s.dir).applyQuaternion(rag.body.q);
      if (s.jet > 0) {
        s.jet -= dt;
        s.acc += dt * (60 + 90 * press);
        while (s.acc >= 1) {
          s.acc -= 1;
          const sp = (1.2 + 2.6 * press) * (0.85 + Math.random() * 0.3);
          this.v.copy(dir).multiplyScalar(sp).add(_d.set(this.rnd(0.18), this.rnd(0.18), this.rnd(0.18)));
          this.drop(o, this.v, 0.011 + Math.random() * 0.01, Math.random() < 0.4);
        }
      } else if (Math.random() < dt * 5) {
        // between beats it wells and runs
        this.drop(o, this.v.copy(dir).multiplyScalar(0.3).add(_d.set(this.rnd(0.2), 0, this.rnd(0.2))), 0.014, false);
      }
    }
    // bodies bleed while they slump, then leave a wide wet pool that keeps spreading
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i], u = b.u;
      b.t += dt;
      if (u.removed || u.alive || !u.rag) { this.bleeders.splice(i, 1); continue; }
      const bp = u.rag.body.pos;
      // a body flying through the air (a blast) throws blood off along its path
      const bv = u.rag.body.v, fly = bv.length();
      if (b.severe && !u.rag.asleep && fly > 2.5 && L2(this) && b.t < 4) {
        const nd = 1 + ((Math.random() * 2) | 0);
        for (let k = 0; k < nd; k++) this.drop(this.p.copy(bp).add(this.v.set(this.rnd(0.2), this.rnd(0.2), this.rnd(0.2))), this.hitV.copy(bv).multiplyScalar(0.25 + Math.random() * 0.5).add(this.hitD.set(this.rnd(1.2), Math.random() * 0.8, this.rnd(1.2))), 0.012 + Math.random() * Math.random() * 0.03, Math.random() < 0.35);
      }
      // smears where the body slides
      if (!u.rag.asleep && b.last) {
        const dx = bp.x - b.last.x, dz = bp.z - b.last.z, dd = Math.hypot(dx, dz);
        if (dd > 0.35) { this.smear(bp.x - dx * 0.5, bp.z - dz * 0.5, dx, dz, dd); b.last.set(bp.x, 0, bp.z); }
      } else if (!b.last) b.last = new THREE.Vector3(bp.x, 0, bp.z);
      // the wounds leak: a drop now and then, a small stain beneath
      b.drip -= dt;
      if (b.drip <= 0 && b.t < 4) { b.drip = 0.35 + Math.random() * 0.3; this.spray(bp, UP, 1, 0.3, 1.2, 0.8, 0.018); this.splat(bp.x + this.rnd(0.3), bp.z + this.rnd(0.3), 0.1 + Math.random() * 0.12); }
      if (!b.pooled && (u.rag.asleep || b.t > 5)) { b.pooled = true; this.pools.add(bp.x, bp.z, b.size * (0.9 + Math.random() * 0.3), 1); this.bleeders.splice(i, 1); }
    }
    // wounded soldiers drip as they move: worse wounds drip faster, leaving a trail of spots
    for (let i = this.live.length - 1; i >= 0; i--) {
      const u = this.live[i];
      if (!u.alive || u.removed || !(u.wound > 0.05 || u.bleed > 0.05)) { this.live.splice(i, 1); continue; }
      if (u.bleed > 0.05) u.wound = Math.max(u.wound || 0, Math.min(1, u.bleed / 2.5));
      u.dripT = (u.dripT ?? 0) - dt;
      if (u.dripT <= 0) {
        u.dripT = 0.7 / (0.3 + u.wound * 2.2) * (0.6 + Math.random() * 0.8);
        const c = u.center(), sp = Math.hypot(u.vel.x, u.vel.z);
        this.v.set(u.vel.x * 0.5 + this.rnd(0.3), 0.2 + Math.random() * 0.4, u.vel.z * 0.5 + this.rnd(0.3));
        this.drop(this.p.set(c.x + this.rnd(0.12), c.y - 0.2 + this.rnd(0.3), c.z + this.rnd(0.12)), this.v, 0.02 + Math.random() * 0.012, true);
        if (u.wound > 0.5 && sp > 0.5 && L2(this)) this.splat(u.pos.x, u.pos.z, 0.1 + Math.random() * 0.1);
      }
      // a crawling man drags a long smear behind him
      if (u.down && L2(this)) {
        const l = u.smear || (u.smear = new THREE.Vector3(u.pos.x, 0, u.pos.z));
        const dx = u.pos.x - l.x, dz = u.pos.z - l.z, dd = Math.hypot(dx, dz);
        if (dd > 0.4) { this.smear(u.pos.x - dx * 0.5, u.pos.z - dz * 0.5, dx, dz, dd); l.set(u.pos.x, 0, u.pos.z); }
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
