import * as THREE from 'three';
import { height, normalAt } from './terrain.js';
import { toLocal, toWorld } from './physics.js';

// Decals that sit ON the surface they were thrown at, not on a flat plane near it.
//  - Ground decals are a small grid whose vertices follow the terrain height, so they bend over
//    bumps, ruts and slopes and can never hang in the air.
//  - Prop decals are a grid clamped to the face of the box that was hit: a stain that reaches the
//    edge of a wall stops at the edge. When the prop is destroyed its decals are removed.
// One dynamic mesh per set, written as a ring, so a set costs one draw call.
//
// Blood sets share one atlas of "fields" (a blurred height map of the stain, in the red channel) and a
// shader thresholds it: the outline is where the field crosses the threshold. A pool spreads by
// lowering the threshold, so its edge creeps out in fingers instead of scaling a fixed shape. The
// edge band is drawn darker and thicker (clotting) and the whole stain browns and dulls as it dries.
const TAU = Math.PI * 2;
const COLS = 4;
const _n = new THREE.Vector3();

// ---- the stain atlas: 4 x 4 tiles. row 0 splats, row 1 spray fans, row 2 streaks (0,1) and drips (2,3), row 3 pools
let _atlas = null;
export function stainAtlas() {
  if (_atlas) return _atlas;
  const T = 128, S = T * COLS;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const rnd = Math.random;
  // a soft blob; overlapping blobs add up, which merges them like liquid
  const blob = (x, y, rx, ry, rot, a = 1) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(rx, ry);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, `rgba(255,0,0,${a})`); gr.addColorStop(0.5, `rgba(255,0,0,${a * 0.78})`); gr.addColorStop(0.8, `rgba(255,0,0,${a * 0.34})`); gr.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
    g.restore();
  };
  g.globalCompositeOperation = 'lighter';
  const tile = (col, row, draw) => {
    g.save(); g.beginPath(); g.rect(col * T, row * T, T, T); g.clip(); g.translate(col * T, row * T);
    draw(); g.restore();
  };
  // row 0: splats, an irregular core, tapering arms, detached droplets
  for (let v = 0; v < 4; v++) tile(v, 0, () => {
    const h = T / 2;
    for (let i = 0; i < 3 + ((rnd() * 3) | 0); i++) { const r = T * (0.07 + rnd() * 0.07); blob(h + (rnd() - 0.5) * T * 0.14, h + (rnd() - 0.5) * T * 0.14, r, r * (0.7 + rnd() * 0.5), rnd() * TAU); }
    const arms = 3 + ((rnd() * 5) | 0);
    for (let i = 0; i < arms; i++) {
      const a = rnd() * TAU, L = T * (0.08 + rnd() * 0.17), r0 = T * (0.04 + rnd() * 0.035), wob = (rnd() - 0.5) * 0.6;
      for (let s = 0; s <= 1; s += 0.14) { const d = T * 0.07 + L * s, aa = a + wob * s, r = r0 * (1 - s * 0.82); blob(h + Math.cos(aa) * d, h + Math.sin(aa) * d, r * 1.5, r, aa); }
      if (rnd() < 0.7) { const d = T * 0.07 + L + T * (0.03 + rnd() * 0.07), r = T * (0.012 + rnd() * 0.02); blob(h + Math.cos(a + wob) * d, h + Math.sin(a + wob) * d, r, r, 0); }
    }
    for (let i = 0; i < 12 + ((rnd() * 14) | 0); i++) { const a = rnd() * TAU, d = T * (0.22 + rnd() * 0.24), r = T * (0.006 + rnd() * rnd() * 0.02); blob(h + Math.cos(a) * d, h + Math.sin(a) * d, r * 1.2, r, a); }
  });
  // row 1: spray fans thrown toward the top of the tile: big drops near the origin, fine long ones far out
  for (let v = 0; v < 4; v++) tile(v, 1, () => {
    const ox = T / 2, oy = T * 0.84, fan = 0.5 + rnd() * 0.3;
    for (let i = 0; i < 3; i++) { const r = T * (0.04 + rnd() * 0.04); blob(ox + (rnd() - 0.5) * T * 0.08, oy - rnd() * T * 0.05, r, r * 1.2, 0); }
    const n = 46 + ((rnd() * 24) | 0);
    for (let i = 0; i < n; i++) {
      const a = (rnd() - 0.5) * 2 * fan, rr = Math.pow(rnd(), 0.8) * T * 0.74, far = rr / (T * 0.74);
      const r = T * (0.034 - 0.022 * far) * (0.5 + rnd());
      blob(ox + Math.sin(a) * rr, oy - Math.cos(a) * rr, r * (1.1 + far * 2.6 + rnd()), r, -a + Math.PI / 2, 1);
    }
    for (let i = 0; i < 5; i++) { // a few long thin trails
      const a = (rnd() - 0.5) * 2 * fan, L = T * (0.3 + rnd() * 0.4);
      for (let s = 0.08; s < 1; s += 0.05) blob(ox + Math.sin(a) * L * s, oy - Math.cos(a) * L * s, T * 0.012 * (1.2 - s * 0.6), T * 0.012, -a + Math.PI / 2);
    }
  });
  // row 2, tiles 0 and 1: streaks. A rounded head at the top, a tail wobbling away below, broken droplets beyond
  for (let v = 0; v < 2; v++) tile(v, 2, () => {
    const hx = T / 2, hy = T * 0.2, ph = rnd() * TAU;
    blob(hx, hy, T * (0.07 + rnd() * 0.03), T * (0.11 + rnd() * 0.04), 0);
    for (let y = hy + T * 0.06; y < T * 0.97; y += T * 0.02) {
      const k = (y - hy) / (T * 0.8), r = T * 0.05 * (1 - k) + T * 0.007;
      if (rnd() < 0.1 + k * 0.4) continue; // breaks up toward the tail
      blob(hx + Math.sin(y * 0.09 + ph) * T * 0.035 * k, y, r, r * 1.5, 0);
    }
    for (let i = 0; i < 4 + ((rnd() * 5) | 0); i++) { const r = T * (0.008 + rnd() * 0.02); blob(hx + (rnd() - 0.5) * T * 0.34, rnd() * T * 0.16 + T * 0.01, r, r * 1.2, 0); }
    for (let i = 0; i < 6; i++) { const r = T * (0.006 + rnd() * 0.012), a = rnd() * TAU; blob(hx + Math.cos(a) * T * 0.14, hy + Math.sin(a) * T * 0.16, r, r, 0); }
  });
  // row 2, tiles 2 and 3: drips. A thin run from the bottom (where it starts) to a rounded bead that leads it downwards
  for (let v = 2; v < 4; v++) tile(v, 2, () => {
    const hx = T / 2, ph = rnd() * TAU;
    blob(hx, T * 0.93, T * 0.05, T * 0.035, 0);
    for (let y = T * 0.9; y > T * 0.16; y -= T * 0.012) { const k = 1 - y / T; blob(hx + Math.sin(y * 0.12 + ph) * T * 0.012 * k, y, T * (0.011 + 0.004 * k), T * 0.02, 0); }
    blob(hx, T * 0.13, T * 0.05, T * 0.085, 0);
  });
  // row 3: pools. A field that falls from 1 in the middle to 0 at an irregular, lobed, noisy edge
  const hash = (x, y, s) => { const k = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return k - Math.floor(k); };
  const vnoise = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return (hash(xi, yi, s) * (1 - u) + hash(xi + 1, yi, s) * u) * (1 - w) + (hash(xi, yi + 1, s) * (1 - u) + hash(xi + 1, yi + 1, s) * u) * w;
  };
  g.globalCompositeOperation = 'source-over';
  for (let v = 0; v < 4; v++) {
    const img = g.createImageData(T, T), s = rnd() * 50;
    const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU], lobes = [];
    for (let i = 0; i < 3 + ((rnd() * 3) | 0); i++) lobes.push({ a: rnd() * TAU, w: 0.18 + rnd() * 0.3, amp: 0.1 + rnd() * 0.13 });
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const nx = ((x + 0.5) / T) * 2 - 1, ny = ((y + 0.5) / T) * 2 - 1, r = Math.hypot(nx, ny), th = Math.atan2(ny, nx);
      let R = 0.5 + 0.06 * Math.sin(2 * th + ph[0]) + 0.05 * Math.sin(3 * th + ph[1]) + 0.035 * Math.sin(5 * th + ph[2]);
      for (const l of lobes) { let d = Math.abs(th - l.a); d = Math.min(d, TAU - d); R += l.amp * Math.exp(-(d * d) / (2 * l.w * l.w)); }
      const warp = (vnoise(nx * 3 + s, ny * 3, s) - 0.5) * 0.3 + (vnoise(nx * 8, ny * 8 + s, s + 3) - 0.5) * 0.12;
      let f = (R - r) / R + warp;
      if (r > 0.97) f = 0;
      f = Math.max(0, Math.min(1, f));
      const k = (y * T + x) * 4;
      img.data[k] = f * 255; img.data[k + 1] = 0; img.data[k + 2] = 0; img.data[k + 3] = 255;
    }
    g.putImageData(img, v * T, 3 * T);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // a field, not a picture
  t.anisotropy = 4;
  return (_atlas = t);
}

const TILES = {
  splat: [0, 0, 4], spray: [1, 0, 4], streak: [2, 0, 2], drip: [2, 2, 2], pool: [3, 0, 4], // [row, first tile, tiles]
};
// where the impact point sits inside each kind's tile, as a fraction of the half-height along the travel direction
const SHIFT = { splat: 0, spray: 0.68, streak: -0.6, drip: 0, pool: 0 };

let _blood = null;
function bloodMaterial() {
  if (_blood) return _blood;
  const m = new THREE.MeshStandardMaterial({ map: stainAtlas(), transparent: true, depthWrite: false, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aP;\nvarying vec4 vAP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAP = aP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vAP;')
      .replace('#include <map_fragment>', /* glsl */`
float fld = texture2D( map, vMapUv ).r;
float th = vAP.x;
float body = smoothstep( th - 0.025, th + 0.035, fld );
float core = smoothstep( th + 0.04, th + 0.36, fld );
float dry = vAP.z;
vec3 fresh = vec3( 0.135, 0.006, 0.006 );
vec3 clot = vec3( 0.035, 0.002, 0.002 );
vec3 aged = vec3( 0.05, 0.016, 0.01 );
vec3 bc = mix( clot, fresh, core * ( 1.0 - dry * 0.75 ) );
bc = mix( bc, aged, dry * 0.55 * core );
diffuseColor = vec4( bc, body * vAP.y * mix( 0.86, 0.97, core ) );`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
roughnessFactor = mix( vAP.w, 0.9, dry );
roughnessFactor = mix( 0.85, roughnessFactor, core );`);
  };
  m.customProgramCacheKey = () => 'stain-field-v1';
  return (_blood = m);
}

const _v = new THREE.Vector3(), _u = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);

export class StainSet {
  // opts: kind (default tile kind), G (grid cells per side), plain (a texture: unshaded-field mode for bullet holes, scorch, craters),
  //       rough, hold / fade (seconds a stain stays, then thins away; Infinity = until the ring wraps), order
  constructor(scene, n, { kind = 'splat', G = 4, plain = null, rough = 0.6, hold = 75, fade = 25, order = 1, off = 0.03 } = {}) {
    this.n = n; this.G = G; this.kind = kind; this.plain = plain; this.rough = rough; this.hold = hold; this.fade = fade; this.off = off;
    const NV = this.NV = (G + 1) * (G + 1), NT = this.NT = G * G * 2;
    const geo = this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * NV * 3), 3);
    this.nor = new THREE.BufferAttribute(new Float32Array(n * NV * 3), 3);
    this.uv = new THREE.BufferAttribute(new Float32Array(n * NV * 2), 2);
    for (const a of [this.pos, this.nor, this.uv]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos); geo.setAttribute('normal', this.nor); geo.setAttribute('uv', this.uv);
    if (!plain) { this.ap = new THREE.BufferAttribute(new Float32Array(n * NV * 4), 4); this.ap.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aP', this.ap); }
    const idx = new Uint32Array(n * NT * 3);
    let k = 0;
    for (let s = 0; s < n; s++) {
      const b = s * NV;
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        const a = b + j * (G + 1) + i, c = a + G + 1;
        idx[k++] = a; idx[k++] = a + 1; idx[k++] = c;
        idx[k++] = a + 1; idx[k++] = c + 1; idx[k++] = c;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = plain
      ? new THREE.MeshStandardMaterial({ map: plain, transparent: true, depthWrite: false, roughness: rough, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      : bloodMaterial();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order; this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.slots = new Array(n).fill(null);
    this.next = 0; this.hi = 0; this.tick = 0; this.slow = 0;
    this.d0 = 1e9; this.d1 = -1; this.a0 = 1e9; this.a1 = -1;
  }

  clear() {
    this.slots.fill(null); this.next = 0; this.hi = 0; this.geo.setDrawRange(0, 0); this.d0 = this.a0 = 1e9; this.d1 = this.a1 = -1;
  }

  // ---- placing ----
  _take() { const i = this.next++ % this.n; this.hi = Math.max(this.hi, i + 1); this.geo.setDrawRange(0, this.hi * this.NT * 3); return i; }

  _tile(kind) { const [row, first, count] = TILES[kind] || TILES.splat; return [first + ((Math.random() * count) | 0), row]; }

  // on the ground at x, z. v points the way the stain travelled (its long axis, head first)
  _ground(x, z, size, spread, vx, vz, o) {
    const kind = o.kind || this.kind, i = this._take();
    const L = Math.hypot(vx, vz) || 1, st = o.stretch || 1;
    const nrm = normalAt(x, z);
    const s = {
      mode: 0, kind, px: x, py: height(x, z), pz: z, vx: vx / L, vy: 0, vz: vz / L, ux: -vz / L, uy: 0, uz: vx / L,
      nx: nrm.x, ny: nrm.y, nz: nrm.z, hu: size / 2 / Math.sqrt(st), hv: size / 2 * st, shift: SHIFT[kind] || 0,
      tile: this._tile(kind), age: 0, spread: 1, spv: 0, pool: false, bias: 0, run: false, prop: null, box: null, off: this.off + Math.min(0.04, size * 0.012),
    };
    if (spread) {
      s.pool = true; s.spread = 0; s.spv = spread / 28;
      // blood runs downhill: stretch the pool along the slope, shifting its centre down it
      const sl = Math.hypot(nrm.x, nrm.z);
      if (sl > 0.03) { s.bias = Math.min(1.1, sl * 7); s.vx = nrm.x / sl; s.vz = nrm.z / sl; s.ux = -s.vz; s.uz = s.vx; }
    }
    this.slots[i] = s;
    this._write(i); this._writeAP(i);
    return i;
  }

  // on a prop's face (box = prop.box): n is the face normal, dir the way it was travelling
  _face(p, n, size, spread, dir, prop, o) {
    const kind = o.kind || this.kind, i = this._take(), st = o.stretch || 1;
    const nn = _n.copy(n).normalize();
    const v = dir ? _v.copy(dir) : _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    v.addScaledVector(nn, -v.dot(nn));
    if (v.lengthSq() < 0.01) { v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5); v.addScaledVector(nn, -v.dot(nn)); }
    if (v.lengthSq() < 1e-6) v.set(0, 1, 0).addScaledVector(nn, -nn.y);
    v.normalize();
    const u = _u.crossVectors(v, nn).normalize();
    const s = {
      mode: 1, kind, px: p.x, py: p.y, pz: p.z, vx: v.x, vy: v.y, vz: v.z, ux: u.x, uy: u.y, uz: u.z,
      nx: nn.x, ny: nn.y, nz: nn.z, hu: size / 2 / Math.sqrt(st), hv: size / 2 * st, shift: SHIFT[kind] || 0,
      tile: this._tile(kind), age: 0, spread: 1, spv: 0, pool: false, bias: 0, run: false, prop, box: prop.box, off: 0.011 + Math.random() * 0.004,
    };
    if (spread) { s.pool = true; s.spread = 0; s.spv = spread / 28; }
    this.slots[i] = s;
    this._write(i); this._writeAP(i);
    return i;
  }

  // x, z on the ground. yaw: the stain's travel direction is (-sin yaw, -cos yaw)
  add(x, z, size, spreadTo = 0, yaw, o = {}) {
    if (normalAt(x, z).y < 0.5) return -1;
    const a = yaw ?? Math.random() * TAU;
    return this._ground(x, z, size, spreadTo, -Math.sin(a), -Math.cos(a), o);
  }

  // anywhere a thrown drop or a round lands. With a prop it is wrapped onto that prop's face; without, onto the terrain.
  addOn(p, n, size, dir, spreadTo = 0, prop = null, o = {}) {
    if (prop?.box) return this._face(p, n, size, spreadTo, dir, prop, o);
    let vx = dir ? dir.x : 0, vz = dir ? dir.z : 0;
    if (vx * vx + vz * vz < 0.01) { const a = Math.random() * TAU; vx = Math.sin(a); vz = Math.cos(a); }
    return this._ground(p.x, p.z, size, spreadTo, vx, vz, o);
  }

  // a bleeding run that creeps down a prop's face from p: width, longest length, speed (m/s)
  addRun(p, n, width, max, vel, prop) {
    if (!prop?.box) return -1;
    const top = prop.box.y0 + prop.box.h, bot = prop.box.y0;
    max = Math.min(max, p.y - bot - 0.01);
    if (max < 0.05) return -1;
    const i = this._face(p, n, width, 0, DOWN, prop, { kind: 'drip' });
    const s = this.slots[i];
    s.run = true; s.L = 0.03; s.max = max; s.vel = vel; s.hu = Math.max(0.012, width / 2); s.shift = 0; void top;
    this._write(i);
    return i;
  }

  // ---- writing geometry ----
  _write(i) {
    const s = this.slots[i], G = this.G, NV = this.NV;
    let hu = s.hu, hv = s.hv, sh = s.shift;
    if (s.pool) { const e = 1 - (1 - s.spread) * (1 - s.spread), g = 0.7 + 0.3 * e; hu *= g * (1 - 0.12 * s.bias); hv *= g * (1 + s.bias * e); sh += s.bias * e * 0.38; }
    if (s.run) { hv = s.L / 2; sh = 1; }
    const cx = s.px + s.vx * hv * sh, cy = s.py + s.vy * hv * sh, cz = s.pz + s.vz * hv * sh;
    const P = this.pos.array, N = this.nor.array, UV = this.uv.array;
    let k = i * NV;
    const plain = !!this.plain, [tc, tr] = s.tile, inset = 0.012;
    const box = s.box;
    const hux = Math.max(hu, 1e-4), hvx = Math.max(hv, 1e-4);
    for (let jb = 0; jb <= G; jb++) for (let ia = 0; ia <= G; ia++, k++) {
      const a = (ia / G) * 2 - 1, b = (jb / G) * 2 - 1;
      let x = cx + s.ux * a * hu + s.vx * b * hv, y = cy + s.uy * a * hu + s.vy * b * hv, z = cz + s.uz * a * hu + s.vz * b * hv;
      let ta = (a + 1) / 2, tb = (b + 1) / 2;
      if (s.mode === 0) {
        y = height(x, z) + s.off;
      } else {
        // clamp to the prop's face, then re-derive the texture coordinate so the stain is cut off at the edge, not squashed
        const [lx0, lz0] = toLocal(box, x, z);
        const lx = Math.max(-box.hx, Math.min(box.hx, lx0)), lz = Math.max(-box.hz, Math.min(box.hz, lz0));
        const yy = Math.max(box.y0, Math.min(box.y0 + box.h, y));
        if (lx !== lx0 || lz !== lz0 || yy !== y) {
          const [wx, wz] = toWorld(box, lx, lz);
          x = wx; z = wz; y = yy;
          const dx = x - cx, dy = y - cy, dz = z - cz;
          ta = Math.max(0, Math.min(1, (dx * s.ux + dy * s.uy + dz * s.uz) / (2 * hux) + 0.5));
          tb = Math.max(0, Math.min(1, (dx * s.vx + dy * s.vy + dz * s.vz) / (2 * hvx) + 0.5));
        }
        x += s.nx * s.off; y += s.ny * s.off; z += s.nz * s.off;
      }
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      N[k * 3] = s.nx; N[k * 3 + 1] = s.ny; N[k * 3 + 2] = s.nz;
      if (plain) { UV[k * 2] = ta; UV[k * 2 + 1] = tb; }
      else {
        UV[k * 2] = (tc + inset + ta * (1 - 2 * inset)) / COLS;
        UV[k * 2 + 1] = 1 - (tr + 1 - (inset + tb * (1 - 2 * inset))) / COLS; // canvas top is +v
      }
    }
    this.d0 = Math.min(this.d0, i); this.d1 = Math.max(this.d1, i);
  }

  _writeAP(i) {
    if (this.plain) return;
    const s = this.slots[i];
    const AP = this.ap.array, NV = this.NV;
    const e = 1 - (1 - s.spread) * (1 - s.spread);
    const thr = s.pool ? 0.66 - 0.54 * e : 0.5;
    const dry = Math.min(1, s.age / (s.pool ? 90 : 55));
    const over = s.age - this.hold;
    const alpha = over > 0 ? Math.max(0, 1 - over / this.fade) : 1;
    const r0 = s.pool ? 0.5 : 0.42;
    for (let k = i * NV, e2 = k + NV; k < e2; k++) { AP[k * 4] = thr; AP[k * 4 + 1] = alpha; AP[k * 4 + 2] = dry; AP[k * 4 + 3] = r0; }
    this.a0 = Math.min(this.a0, i); this.a1 = Math.max(this.a1, i);
    return alpha;
  }

  _free(i) {
    const s = this.slots[i];
    if (!s) return;
    s.age = 1e9; s.spread = 1; s.run = false; s.prop = null;
    if (this.plain) { // collapse it to a point
      const P = this.pos.array, k0 = i * this.NV * 3;
      for (let k = 0; k < this.NV * 3; k++) P[k0 + k] = 0;
      this.d0 = Math.min(this.d0, i); this.d1 = Math.max(this.d1, i);
    } else {
      const AP = this.ap.array;
      for (let k = i * this.NV; k < (i + 1) * this.NV; k++) AP[k * 4 + 1] = 0;
      this.a0 = Math.min(this.a0, i); this.a1 = Math.max(this.a1, i);
    }
    this.slots[i] = null;
  }

  update(dt) {
    this.tick += dt;
    if (this.tick >= 0.1) {
      const step = this.tick; this.tick = 0; this.slow += step;
      const slow = this.slow >= 0.5; if (slow) this.slow = 0;
      for (let i = 0; i < this.hi; i++) {
        const s = this.slots[i];
        if (!s) continue;
        if (s.prop && !s.prop.alive) { this._free(i); continue; }
        s.age += step;
        let geo = false;
        if (s.pool && s.spread < 1) { s.spread = Math.min(1, s.spread + step * s.spv); geo = true; }
        if (s.run && s.L < s.max) { s.L = Math.min(s.max, s.L + step * s.vel * (0.25 + 0.75 * (1 - s.L / s.max))); geo = true; }
        if (geo) this._write(i);
        if (!this.plain && (geo || slow)) { if (this._writeAP(i) <= 0) this._free(i); }
        else if (this.plain && this.hold < 1e8 && s.age > this.hold + this.fade) this._free(i);
      }
    }
    this.flush();
  }

  flush() {
    const up = (a, comp, lo, hi) => {
      if (hi < lo) return;
      a.clearUpdateRanges(); a.addUpdateRange(lo * this.NV * comp, (hi - lo + 1) * this.NV * comp); a.needsUpdate = true;
    };
    if (this.d1 >= 0) { up(this.pos, 3, this.d0, this.d1); up(this.nor, 3, this.d0, this.d1); up(this.uv, 2, this.d0, this.d1); this.d0 = 1e9; this.d1 = -1; }
    if (this.ap && this.a1 >= 0) { up(this.ap, 4, this.a0, this.a1); this.a0 = 1e9; this.a1 = -1; }
  }
}
