import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { height, normalAt } from './terrain.js';
import { canvasTex, decalMesh, stamp } from './effects.js';
import { TEAMS } from './factions.js';

// Stylised gore, three levels (0 off, 1 low, 2 full), remembered in localStorage.
//  - spray: dark red droplets from every hit (fewer on low)
//  - splatter: ground decals behind a hit and a pool under each body; they hold, then shrink away
//  - wounds: a soldier's shell darkens red as it takes damage (via crowd colour)
//  - gibs (full only): blasts and heavy hits tear hands and feet off. The part is skipped when the
//    soldier is drawn and flies off as its own instanced piece with chunks of red
// Everything is pooled: one decal mesh and one gib mesh, so two draw calls however many soldiers.
const KEY = 'sm.gore';
const BLOOD = [new THREE.Color('#8a1717'), new THREE.Color('#5c0e0e')];
const GIB_MAX = 200, DECAL_MAX = 360, HOLD = 45, FADE = 20;
const UP = new THREE.Vector3(0, 1, 0);
const TRIM = TEAMS.map((t) => new THREE.Color(t.trim));
const FOOTC = new THREE.Color('#1d2126');
const CHUNK = new THREE.Color('#6d1010');

function bloodTexture() {
  return canvasTex(128, (g, S) => {
    const h = S / 2;
    g.fillStyle = 'rgba(96,12,12,0.9)';
    g.beginPath();
    const n = 14, r0 = h * 0.62;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, r = r0 * (0.55 + Math.random() * 0.45);
      g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, d = h * (0.45 + Math.random() * 0.35), r = 2 + Math.random() * 5;
      g.beginPath(); g.arc(h + Math.cos(a) * d, h + Math.sin(a) * d, r, 0, 7); g.fill();
    }
  });
}

export class Gore {
  constructor(scene, fx) {
    this.fx = fx;
    let lv = 2;
    try { const v = localStorage.getItem(KEY); if (v !== null && +v >= 0 && +v <= 2) lv = +v; } catch {}
    this.level = lv;
    // decals
    this.decals = decalMesh(scene, DECAL_MAX, bloodTexture(), 0.35);
    this.decals.receiveShadow = false;
    this.dAge = new Float32Array(DECAL_MAX).fill(1e9);
    this.dSize = new Float32Array(DECAL_MAX);
    this.dPos = Array.from({ length: DECAL_MAX }, () => new THREE.Vector3());
    this.dQuat = Array.from({ length: DECAL_MAX }, () => new THREE.Quaternion());
    this.dTick = 0;
    // gibs
    const geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.05 });
    this.gibMesh = new THREE.InstancedMesh(geo, mat, GIB_MAX);
    this.gibMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GIB_MAX * 3), 3);
    this.gibMesh.count = 0;
    this.gibMesh.frustumCulled = false;
    this.gibMesh.castShadow = true;
    scene.add(this.gibMesh);
    this.gibs = [];
    this.gi = 0;
    this.bleeders = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.v = new THREE.Vector3();
  }

  setLevel(l) {
    this.level = l;
    try { localStorage.setItem(KEY, String(l)); } catch {}
  }

  clear() {
    this.dAge.fill(1e9);
    this.decals.count = 0; this.decals.userData.next = 0;
    this.gibs.length = 0; this.gi = 0; this.gibMesh.count = 0;
    this.bleeders.length = 0;
  }

  // ---- decals ----
  splat(x, z, size) {
    if (!this.level) return;
    const y = height(x, z), n = normalAt(x, z);
    if (n.y < 0.7) return;
    const mesh = this.decals, i = mesh.userData.next % DECAL_MAX;
    stamp(mesh, this.v.set(x, y, z), n, size);
    this.dAge[i] = 0; this.dSize[i] = size;
    mesh.getMatrixAt(i, this.m);
    this.m.decompose(this.dPos[i], this.dQuat[i], this.s);
  }

  // ---- hits ----
  hit(pos, dir, dmg, kind, u) {
    const L = this.level;
    if (!L || kind === 'fire') return;
    u.wound = Math.min(1, (u.wound || 0) + dmg / 90);
    const n = Math.min(L === 2 ? 14 : 6, Math.ceil(dmg / (L === 2 ? 9 : 16)));
    const d = dir || UP;
    const norm = this.fx.norm;
    for (let i = 0; i < n; i++) {
      const v = d.clone().multiplyScalar(2 + Math.random() * 3).add(this.fx.dir(1.6));
      v.y += 1 + Math.random() * 1.5;
      norm.emit({ pos, vel: v, life: 0.45 + Math.random() * 0.4, size: [0.05 + Math.random() * 0.05, 0.03], color: BLOOD, alpha: [0.95, 0.7], grav: 12, drag: 0.8 });
    }
    // a mist of fine droplets
    norm.emit({ pos, vel: d.clone().multiplyScalar(1.5), life: 0.5, size: [0.1, 0.5], color: BLOOD, alpha: [0.45, 0], drag: 3 });
    if (Math.random() < (L === 2 ? 0.6 : 0.3)) {
      const k = 0.8 + Math.random() * 2;
      this.splat(pos.x + d.x * k, pos.z + d.z * k, 0.25 + Math.random() * 0.35 + dmg / 300);
    }
  }

  // ---- deaths ----
  death(u, kind) {
    const L = this.level;
    if (!L) return;
    const h = u.lastHit, dmg = h ? h.dmg : 0, rag = u.rag;
    if (this.bleeders.length < 80) this.bleeders.push({ u, t: 0, drip: 0, pooled: false });
    if (L < 2 || !rag) return;
    const blast = kind === 'blast' || kind === 'plasma';
    const heavy = dmg >= 90;
    // which parts come off: blasts take 1-3, heavy hits sometimes one
    let n = blast ? 1 + Math.floor(Math.random() * 3) : heavy && Math.random() < 0.35 ? 1 : 0;
    if (!blast && !heavy && Math.random() < 0.04) n = 1;
    u.lost = u.lost || 0;
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    for (let k = 0; k < n; k++) {
      const li = order[k];
      const l = rag.limbs[li];
      if (!l) continue;
      const bit = li < 2 ? 1 << li : 4 << (li - 2);
      u.lost |= bit;
      this.addGib(l.p, rag.body.v, li < 2 ? [0.1, 0.1, 0.12] : [0.15, 0.085, 0.25], li < 2 ? TRIM[u.team] : FOOTC, blast ? 5 : 2.5);
      this.stump(l.p);
    }
    if (n) {
      const c = u.center();
      for (let k = 0; k < (blast ? 5 : 2); k++) {
        const s = 0.05 + Math.random() * 0.07;
        this.addGib(c, rag.body.v, [s, s * 0.8, s * 1.1], CHUNK, blast ? 6 : 3);
      }
    }
  }

  stump(p) {
    const norm = this.fx.norm;
    for (let i = 0; i < 6; i++) norm.emit({ pos: p, vel: this.fx.dir(2.5).setY(Math.random() * 3), life: 0.5, size: [0.06, 0.03], color: BLOOD, alpha: [0.95, 0.6], grav: 12, drag: 0.8 });
  }

  addGib(p, base, size, color, speed) {
    const g = {
      p: p.clone(), v: new THREE.Vector3(this.fx.rnd(), 0.6 + Math.random() * 0.8, this.fx.rnd()).multiplyScalar(speed * (0.5 + Math.random() * 0.6)).addScaledVector(base, 0.5),
      q: new THREE.Quaternion().random(), w: new THREE.Vector3(this.fx.rnd(9), this.fx.rnd(9), this.fx.rnd(9)),
      size: size.slice(), slot: this.gi % GIB_MAX, asleep: false, trail: 0.7,
    };
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

  update(dt) {
    if (!this.level && !this.gibs.length && !this.bleeders.length) return;
    // gibs: tumble, bounce, settle
    let dirty = false;
    for (const g of this.gibs) {
      if (!g || g.asleep) continue;
      g.v.y -= 15 * dt;
      g.p.addScaledVector(g.v, dt);
      this.q.set(g.w.x * dt * 0.5, g.w.y * dt * 0.5, g.w.z * dt * 0.5, 0).multiply(g.q);
      g.q.x += this.q.x; g.q.y += this.q.y; g.q.z += this.q.z; g.q.w += this.q.w; g.q.normalize();
      const r = Math.min(g.size[0], g.size[1], g.size[2]) * 0.5, gy = height(g.p.x, g.p.z) + r;
      if (g.trail > 0 && this.level) {
        g.trail -= dt;
        this.fx.norm.emit({ pos: g.p, life: 0.35, size: [0.05, 0.02], color: BLOOD, alpha: [0.8, 0], grav: 6, drag: 1 });
      }
      if (g.p.y < gy) {
        g.p.y = gy;
        if (g.v.y < -1.5 && this.level) this.splat(g.p.x, g.p.z, 0.2 + Math.random() * 0.2);
        g.v.y *= -0.25; g.v.x *= 0.6; g.v.z *= 0.6; g.w.multiplyScalar(0.55);
        if (Math.abs(g.v.y) < 0.6 && Math.hypot(g.v.x, g.v.z) < 0.4) { g.asleep = true; g.p.y = gy - r * 0.3; }
      }
      this.writeGib(g);
      dirty = true;
    }
    if (dirty) this.gibMesh.instanceMatrix.needsUpdate = true;
    // bodies bleed while they slump, then leave a pool
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i], u = b.u;
      b.t += dt;
      if (u.removed || u.alive || !u.rag) { this.bleeders.splice(i, 1); continue; }
      const bp = u.rag.body.pos;
      b.drip -= dt;
      if (b.drip <= 0 && b.t < 4) { b.drip = 0.35; this.splat(bp.x + this.fx.rnd(0.3), bp.z + this.fx.rnd(0.3), 0.18 + Math.random() * 0.15); }
      if (!b.pooled && (u.rag.asleep || b.t > 5)) { b.pooled = true; this.splat(bp.x, bp.z, 0.9 + Math.random() * 0.5); this.bleeders.splice(i, 1); }
    }
    // decals hold, then shrink away
    this.dTick -= dt;
    if (this.dTick <= 0) {
      this.dTick = 0.25;
      const mesh = this.decals, n = mesh.count;
      let any = false;
      for (let i = 0; i < n; i++) {
        if (this.dAge[i] > 1e8) continue;
        this.dAge[i] += 0.25;
        const over = this.dAge[i] - HOLD;
        if (over < 0) continue;
        const k = Math.max(0, 1 - over / FADE);
        if (k === 0) this.dAge[i] = 1e9;
        const sz = this.dSize[i] * k;
        mesh.setMatrixAt(i, this.m.compose(this.dPos[i], this.dQuat[i], this.s.set(sz, 1, sz)));
        any = true;
      }
      if (any) mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
