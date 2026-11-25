import * as THREE from 'three';
import { instance } from './models.js';
import { toWorld } from './physics.js';
import { buildProp, VARIANTS } from './propbuild.js';

// Cover and obstacles. World units (metres). Each prop is an oriented box for physics and
// line of sight, plus cover spots around it for the AI.
export const PROPS = {
  sandbags: { name: 'Sandbags', hx: 1.25, hz: 0.3, h: 0.42, hp: 700, debris: '#8c7f5f' },
  crate: { name: 'Crate', hx: 0.4, hz: 0.3, h: 0.5, hp: 160, debris: '#6a4a2f' },
  barrier: { name: 'Barrier', hx: 1.0, hz: 0.3, h: 0.48, hp: 1400, debris: '#9b9b94' },
  drum: { name: 'Fuel drum', hx: 0.27, hz: 0.27, h: 0.62, hp: 50, debris: '#4a4a45', explodes: true, tints: ['#7d8458', '#9a5340', '#566f86', '#a89a6c', '#5f6460', '#8d8f86'] },
  wall: { name: 'Steel wall', hx: 1.25, hz: 0.16, h: 1.45, hp: 1800, debris: '#4a4a45' },
  trap: { name: 'Tank trap', hx: 0.55, hz: 0.55, h: 0.85, hp: Infinity, debris: '#3b3e3d', nocover: true },
  slab: { name: 'Concrete wall', hx: 2.2, hz: 0.22, h: 2.3, hp: 1800, debris: '#9b9b94', raw: true },
  bunker: { name: 'Bunker', hx: 1.7, hz: 1.7, h: 2.0, hp: 4000, debris: '#9b9b94', raw: true },
  ruin: { name: 'Ruined wall', hx: 2.0, hz: 0.22, h: 2.0, hp: 700, debris: '#8d877a', raw: true },
  ruinLow: { name: 'Broken wall', hx: 1.5, hz: 0.22, h: 0.74, hp: 450, debris: '#8d877a', raw: true },
  stonewall: { name: 'Field wall', hx: 1.6, hz: 0.27, h: 0.62, hp: 2600, debris: '#7f7a6e', raw: true },
  rock: { name: 'Boulder', hx: 0.85, hz: 0.7, h: 0.95, hp: Infinity, debris: '#77766c', raw: true },
  // tree trunks: colliders only, the trees themselves are drawn in bulk by the map
  rubble: { name: 'Rubble', hx: 1.1, hz: 0.55, h: 0.26, hp: Infinity, debris: '#8d877a', raw: true, nocover: true, hidden: true },
  tree: { name: 'Tree', hx: 0.2, hz: 0.2, h: 3.2, hp: Infinity, debris: '#4a3b2c', raw: true, noModel: true, fixed: true },
};
// The small props were modelled for a shorter soldier; scale them to the current one.
export const PROP_SCALE = 1.6;
for (const d of Object.values(PROPS)) if (!d.raw) { d.hx *= PROP_SCALE; d.hz *= PROP_SCALE; d.h *= PROP_SCALE; }

// Props are built once per type and variant, in a near and a far detail level (the far copy, used past FAR_PROPS
// metres, drops the small stuff). Each is one mesh: the uber material carries every paint and wear (see grime.js).
export const FAR_PROPS = 48;
// only the big, busy props get a far copy; the small ones are cheap enough that a second set of draw calls would cost more than it saves
const LOD_TYPES = new Set(['sandbags', 'stonewall', 'ruin', 'ruinLow', 'bunker', 'slab']);
const baked = new Map(), bakedFar = new Map();
const bakeNear = (type, v) => { const key = `${type}.${v}`; if (!baked.has(key)) baked.set(key, buildProp(type, v, false).bake()); return baked.get(key); };
const bakeFar = (type, v) => { const key = `${type}.${v}`; if (!bakedFar.has(key)) bakedFar.set(key, buildProp(type, v, true).bake()); return bakedFar.get(key); };
// which of a type's variants a prop at (x, z) is, the same every battle
const variantAt = (type, x, z) => { const n = VARIANTS[type] || 1; const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return Math.floor((h - Math.floor(h)) * n) % n; };
export function propModel(type, v = 0, lite = false) {
  if (PROPS[type].noModel) return new THREE.Group();
  const g = instance(lite ? bakeFar(type, v) : bakeNear(type, v), `prop-${type}`);
  if (!PROPS[type].raw) for (const m of g.children) m.scale.setScalar(PROP_SCALE);
  return g;
}

// Cover spots: where a pea can crouch with this prop between it and a threat.
export function coverSpots(prop) {
  const b = prop.box, def = PROPS[prop.type];
  if (def.nocover) return [];
  const out = [];
  const off = 0.5;
  const high = b.h > 1.5;
  if (b.hx >= b.hz * 1.6) {
    for (const side of [-1, 1]) {
      const n = Math.max(1, Math.round((b.hx * 2) / 0.95));
      for (let i = 0; i < n; i++) {
        const lx = -b.hx + (b.hx * 2 * (i + 0.5)) / n;
        if (high && Math.abs(lx) < b.hx - 0.5) continue;
        const [x, z] = toWorld(b, lx, side * (b.hz + off));
        const [px, pz] = high ? toWorld(b, Math.sign(lx) * (b.hx + 0.5), side * (b.hz + off)) : [x, z];
        const [nx, nz] = toWorld({ ...b, x: 0, z: 0 }, 0, side);
        out.push({ x, z, nx, nz, high, px, pz, prop });
      }
    }
  } else {
    for (let a = 0; a < 4; a++) {
      const lx = Math.round(Math.cos((a * Math.PI) / 2)), lz = Math.round(Math.sin((a * Math.PI) / 2));
      const [x, z] = toWorld(b, lx * (b.hx + off), lz * (b.hz + off));
      const [nx, nz] = toWorld({ ...b, x: 0, z: 0 }, lx, lz);
      // tall square cover: peek out past the corner to shoot
      const [px, pz] = high ? toWorld(b, lx * (b.hx + off) + lz * (b.hx + 0.5), lz * (b.hz + off) + lx * (b.hz + 0.5)) : [x, z];
      out.push({ x, z, nx, nz, high, px, pz, prop });
    }
  }
  return out;
}

// Draws every prop of a type with one instanced mesh per part, so a big field of cover costs a
// few draw calls instead of one per sandbag. Each prop keeps a plain Group as its transform;
// call sync(prop) after moving it and drop(prop) when it is gone.
// Every slot's matrix lives in a master list; cull() packs just the props the camera or the
// sun's shadow can see (and that are inside the fog) into the front of the instance buffers,
// which the parts of a type share, so the GPU only draws what reaches the picture. Props past
// FAR_PROPS metres use the coarse model (see above), in their own set of instanced meshes.
export class PropBatch {
  constructor(scene) {
    this.scene = scene;
    this.types = new Map();
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.one = new THREE.Vector3();
    this.all = false; // true draws everything in full detail (menu shots, tests)
  }
  _type(vk, type, v) {
    let t = this.types.get(vk);
    if (t) return t;
    t = { levels: LOD_TYPES.has(type) ? [{ baked: bakeNear(type, v) }, { baked: bakeFar(type, v) }] : [{ baked: bakeNear(type, v) }], free: [], used: 0, cap: 0, mat: null, col: null, bs: null, live: null, dirty: true };
    t.vk = vk;
    this._grow(t, 32);
    this.types.set(vk, t);
    return t;
  }
  // (re)allocate the master lists and the instance buffers for `cap` slots
  _grow(t, cap) {
    const mat = new Float32Array(cap * 16), col = new Float32Array(cap * 3).fill(1), bs = new Float32Array(cap * 4), live = new Uint8Array(cap);
    if (t.mat) { mat.set(t.mat); col.set(t.col); bs.set(t.bs); live.set(t.live); }
    t.mat = mat; t.col = col; t.bs = bs; t.live = live; t.cap = cap; t.dirty = true;
    for (const [li, L] of t.levels.entries()) {
      if (L.parts) for (const m of L.parts) { this.scene.remove(m); m.dispose?.(); }
      L.im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); L.im.setUsage(THREE.DynamicDrawUsage);
      L.ic = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); L.ic.setUsage(THREE.DynamicDrawUsage);
      L.vis = new Int32Array(cap); L.tmp = new Int32Array(cap); L.n = -1; L.k = 0; L.kk = -1;
      L.parts = L.baked.map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, cap);
        mesh.instanceMatrix = L.im; mesh.instanceColor = L.ic;
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = `props:${t.vk}:${li ? 'far' : 'near'}`; mesh.visible = false;
        // the shadow pass draws only the front part of the list: the props the shadow box holds
        mesh.onBeforeShadow = () => { mesh._full = mesh.count; mesh.count = Math.min(mesh.count, L.k); };
        mesh.onAfterShadow = () => { mesh.count = mesh._full; };
        this.scene.add(mesh);
        return mesh;
      });
    }
  }
  add(p) {
    p.v ??= variantAt(p.type, p.box.x, p.box.z);
    p.vk = `${p.type}.${p.v}`;
    const t = this._type(p.vk, p.type, p.v);
    p.slot = t.free.length ? t.free.pop() : t.used++;
    if (p.slot >= t.cap) this._grow(t, t.cap * 2);
    // each prop leans a little off the type's paint: the tints multiply the uber material's colours
    const tints = PROPS[p.type].tints, h = Math.sin(p.box.x * 3.7 + p.box.z * 9.1) * 1e4, r = h - Math.floor(h);
    const c = tints ? new THREE.Color(tints[Math.floor(r * tints.length) % tints.length]) : new THREE.Color().setScalar(0.88 + 0.12 * (((r * 7) % 1)));
    p.tint = [c.r, c.g, c.b];
    t.col[p.slot * 3] = c.r; t.col[p.slot * 3 + 1] = c.g; t.col[p.slot * 3 + 2] = c.b;
    t.live[p.slot] = 1; t.dirty = true;
  }
  sync(p) {
    const t = this.types.get(p.vk);
    if (!t) return;
    const s = PROPS[p.type].raw ? 1 : PROP_SCALE;
    const sy = s * (p.sy ?? 1);
    this.q.setFromAxisAngle(this.up, p.group.rotation.y);
    this.m.compose(p.group.position, this.q, this.one.set(s, sy, s));
    this.m.toArray(t.mat, p.slot * 16);
    // a sphere around the whole prop (it can stand taller than it is wide)
    const b = p.box, i = p.slot * 4, g = p.group.position;
    t.bs[i] = g.x; t.bs[i + 1] = g.y + b.h * 0.5; t.bs[i + 2] = g.z; t.bs[i + 3] = Math.hypot(b.hx, b.hz, b.h * 0.5) + 0.6;
    t.dirty = true;
  }
  // darken a prop as it takes damage (1 = pristine)
  shade(p, v) {
    const t = this.types.get(p.vk);
    if (!t || p.slot == null) return;
    const c = p.tint || [1, 1, 1];
    t.col[p.slot * 3] = c[0] * v; t.col[p.slot * 3 + 1] = c[1] * v; t.col[p.slot * 3 + 2] = c[2] * v;
    t.dirty = true;
  }
  drop(p) {
    const t = this.types.get(p.vk);
    if (!t || p.slot == null) return;
    t.live[p.slot] = 0;
    t.col[p.slot * 3] = t.col[p.slot * 3 + 1] = t.col[p.slot * 3 + 2] = 1;
    t.free.push(p.slot);
    t.dirty = true;
    p.slot = null;
  }
  // pack what is in view (or throws a shadow into view) into the instance buffers; cheap when nothing changed.
  // Props the sun's shadow box holds come first, so the shadow pass can draw just that front part.
  cull(view) {
    const e = view.eye, lim2 = FAR_PROPS * FAR_PROPS;
    for (const t of this.types.values()) {
      const bs = t.bs, N = t.levels[0], F = t.levels[1] || null;
      N.k = 0; if (F) F.k = 0; // how many are in the shadow box
      let n = 0, f = 0;
      for (let pass = 2; pass >= 1; pass--) {
        for (let s = 0; s < t.used; s++) {
          if (!t.live[s]) continue;
          const i = s * 4;
          const c = this.all ? 2 : view.test(bs[i], bs[i + 1], bs[i + 2], bs[i + 3]);
          if (c !== pass) continue;
          const dx = bs[i] - e.x, dy = bs[i + 1] - e.y, dz = bs[i + 2] - e.z, r = bs[i + 3];
          // a big prop is judged by its nearest edge, so a wall you stand beside keeps its detail along its whole length
          const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - r * 0.6);
          if (F && !this.all && d * d > lim2) { F.tmp[f++] = s; } else { N.tmp[n++] = s; }
        }
        if (pass === 2) { N.k = n; if (F) F.k = f; }
      }
      this._pack(t, N, n);
      if (F) this._pack(t, F, f);
      t.dirty = false;
    }
  }
  // write the list into the buffers if it differs from what is already there
  _pack(t, L, n) {
    const vis = L.vis, tmp = L.tmp;
    let same = !t.dirty && n === L.n && L.k === L.kk;
    if (same) for (let k = 0; k < n; k++) if (vis[k] !== tmp[k]) { same = false; break; }
    if (same) return;
    L.n = n; L.kk = L.k;
    const ma = L.im.array, ca = L.ic.array;
    for (let k = 0; k < n; k++) {
      const s = tmp[k];
      vis[k] = s;
      for (let j = 0; j < 16; j++) ma[k * 16 + j] = t.mat[s * 16 + j];
      ca[k * 3] = t.col[s * 3]; ca[k * 3 + 1] = t.col[s * 3 + 1]; ca[k * 3 + 2] = t.col[s * 3 + 2];
    }
    L.im.clearUpdateRanges(); L.im.addUpdateRange(0, Math.max(16, n * 16)); L.im.needsUpdate = true;
    L.ic.clearUpdateRanges(); L.ic.addUpdateRange(0, Math.max(3, n * 3)); L.ic.needsUpdate = true;
    for (const m of L.parts) { m.count = n; m.visible = n > 0; m.castShadow = L.k > 0; } // no prop in the shadow box: leave the shadow pass a draw call lighter
  }
  clear() {
    for (const t of this.types.values()) for (const L of t.levels) for (const im of L.parts) { this.scene.remove(im); im.dispose(); }
    this.types.clear();
  }
}
