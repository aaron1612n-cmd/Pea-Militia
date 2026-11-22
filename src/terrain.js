import * as THREE from 'three';
import { HALF } from './world.js';

// The battlefield's ground: a shallow valley with a dry creek running corner to corner, a hill
// on each flank, rolling fields, roads, craters, and higher ground beyond the boundary fence.
// Everything is baked into a 1 m height grid once per layout; height() interpolates the grid
// exactly the way the mesh's triangles do, so feet, bullets, sight lines and the picture agree.

// ---- layout ----
// Control points: C sits in a village on the valley floor, A and D on the two hills, B and E
// in the farmland down in the valley.
const RING = 68;
export const POINTS = [
  { name: 'C', x: 0, z: 0, theme: 'village' },
  ...[0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    return { name: ['A', 'B', 'D', 'E'][i], x: Math.cos(a) * RING, z: Math.sin(a) * RING, theme: i % 2 ? 'farm' : 'hill' };
  }),
  // two depots out on the long lane, far enough from the middle that vehicles have somewhere to go
  { name: 'F', x: -106, z: 19, theme: 'depot' },
  { name: 'G', x: 106, z: -19, theme: 'depot' },
];
export const POINT_R = 9;
// everything was first laid out for a 180 m field; this stretches the shapes to the current one
const K = HALF / 90;
// the across-the-field lane, which the depots sit on
const LANE = [[-HALF + 3, 24], [-68, 15], [-24, 5], [0, 0], [24, -5], [68, -15], [HALF - 3, -24]];

let N = HALF * 2; // grid cells per side (1 m)
let grid = null; // Float32Array (N+1)^2
let maxH = 0;
let layoutKey = '';
export const layout = { flats: [], roads: [], craters: [], bases: [] };

// ---- noise ----
function hash(i, j) {
  let h = (i * 374761393 + j * 668265263 + 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const gauss = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

// Big shapes only: valley, hills and the long swells. Roads follow this.
function macro(x, z) {
  const s = (x + z) / Math.SQRT2; // across the valley; A's hill is on the + side
  let h = 5.4 * (1 - Math.exp(-(s * s) / (24 * K * 24 * K)));
  const A = POINTS[1], D = POINTS[3];
  h += 4 * gauss(x, z, A.x, A.z, 17 * K) + 4 * gauss(x, z, D.x, D.z, 17 * K);
  h += (noise(x / (31 * K) + 7, z / (31 * K) + 2) - 0.5) * 4.6;
  return h;
}
// The creek: a meandering bed along the valley floor.
export function creekDist(x, z) {
  const s = (x + z) / Math.SQRT2, along = (x - z) / Math.SQRT2;
  return Math.abs(s - Math.sin(along / (13 * K)) * 3.2 * K - Math.sin(along / (5.3 * K)) * 0.8);
}
function raw(x, z) {
  let h = macro(x, z);
  h += (noise(x / 14 + 4, z / 14 + 9) - 0.5) * 1.5;
  h += (noise(x / 4.3 + 21, z / 4.3 + 5) - 0.5) * 0.35;
  h -= 1.1 * (1 - smooth(1.2, 4.5, creekDist(x, z)));
  return h;
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function roadDist(x, z, r) {
  let d = Infinity;
  const p = r.pts;
  for (let i = 1; i < p.length; i++) d = Math.min(d, segDist(x, z, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]));
  return d;
}
// distance to the nearest road edge (negative on the road)
export function nearRoad(x, z) {
  let best = Infinity;
  for (const r of layout.roads) best = Math.min(best, roadDist(x, z, r) - r.w);
  return best;
}

// The full height function (slow; used to bake the grid and the far hills).
function bake(x, z) {
  let h = raw(x, z);
  for (const r of layout.roads) {
    const d = roadDist(x, z, r);
    if (d < r.w + 4) h += (macro(x, z) - 0.1 - h) * (1 - smooth(r.w, r.w + 4, d)) * 0.92;
  }
  for (const c of layout.craters) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d < 1) h -= c.depth * (1 - d * d);
    else if (d < 1.5) h += c.depth * 0.3 * Math.sin(((d - 1) / 0.5) * Math.PI);
  }
  for (const f of layout.flats) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r + f.blend) h += (f.h - h) * (1 - smooth(f.r, f.r + f.blend, d));
  }
  // past the fence the ground climbs into hills that close in the view
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > HALF - 6) h += smooth(HALF - 6, HALF + 70, e) ** 1.4 * (16 + 14 * noise(x / 37 + 3, z / 37 + 8));
  return h;
}

// Smooth curve through control points, sampled every ~3 m.
function curve(pts) {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.max(2, Math.ceil(c.getLength() / 3));
  return c.getSpacedPoints(n).map((v) => [v.x, v.z]);
}

// Lays out roads, plateaus and craters for this many armies, then bakes the height grid.
// Returns true when the ground changed (the mesh needs rebuilding).
export function setupTerrain(bases) {
  const key = bases.map((b) => `${b.x.toFixed(1)},${b.z.toFixed(1)}`).join('|');
  if (key === layoutKey && grid) return false;
  layoutKey = key;
  layout.bases = bases.map((b) => ({ x: b.x, z: b.z }));
  layout.flats = [];
  layout.roads = [];
  layout.craters = [];
  // roads: every base to the village, every outer point to the village, and a lane across
  for (const b of bases) {
    const mx = b.x * 0.5, mz = b.z * 0.5, l = Math.hypot(b.x, b.z) || 1;
    const px = -b.z / l, pz = b.x / l;
    const out = Math.min(HALF - 3, l + 12) / l;
    layout.roads.push({ w: 2.8, kind: 'road', pts: curve([[b.x * out, b.z * out], [b.x, b.z], [mx + px * 10, mz + pz * 10], [b.x * 0.15 - px * 3, b.z * 0.15 - pz * 3], [0, 0]]) });
  }
  for (const p of POINTS.slice(1)) {
    const l = Math.hypot(p.x, p.z);
    const px = -p.z / l, pz = p.x / l;
    if (p.theme === 'depot') continue;
    layout.roads.push({ w: 2.0, kind: 'track', pts: curve([[p.x, p.z], [p.x * 0.55 + px * 12, p.z * 0.55 + pz * 12], [0, 0]]) });
  }
  layout.roads.push({ w: 2.4, kind: 'lane', pts: curve(LANE) });
  // plateaus under the points and the bases (heights from the land they sit on)
  for (const p of POINTS) layout.flats.push({ x: p.x, z: p.z, r: POINT_R + 4.5, blend: 14, h: p.theme === 'farm' ? Math.max(0.2, macro(p.x, p.z)) : macro(p.x, p.z) });
  for (const b of bases) layout.flats.push({ x: b.x, z: b.z, r: 20, blend: 16, h: macro(b.x, b.z) });
  // shell craters, thicker toward the middle
  let s = 4242;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0, tries = 0; i < 90 && tries < 1500; tries++) {
    const r = Math.sqrt(rnd()) * (HALF - 10), a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (layout.flats.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + 2)) continue;
    if (nearRoad(x, z) < 2) continue;
    layout.craters.push({ x, z, r: 1.8 + rnd() * 2.2, depth: 0.45 + rnd() * 0.5 });
    i++;
  }
  // bake
  N = HALF * 2;
  grid = new Float32Array((N + 1) * (N + 1));
  maxH = -Infinity;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const h = bake(i - HALF, j - HALF);
    grid[j * (N + 1) + i] = h;
    if (Math.abs(i - HALF) < HALF - 1 && Math.abs(j - HALF) < HALF - 1) maxH = Math.max(maxH, h);
  }
  return true;
}

// Ground height. Inside the field it follows the mesh's triangles exactly.
export function height(x, z) {
  if (!grid) return 0;
  const gx = x + HALF, gz = z + HALF;
  if (gx < 0 || gz < 0 || gx >= N || gz >= N) return bake(x, z);
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const W = N + 1, k = j * W + i;
  const a = grid[k], d = grid[k + 1], b = grid[k + W], c = grid[k + W + 1];
  // PlaneGeometry splits each cell along the (x0,z1)-(x1,z0) diagonal
  if (fx + fz <= 1) return a + (d - a) * fx + (b - a) * fz;
  return c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
}
export const maxHeight = () => maxH;

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.5;
  return out.set(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)).normalize();
}
// steepest rise over a metre, as a ratio (0 = flat, 1 = 45°)
export function slopeAt(x, z) {
  const e = 0.5;
  return Math.hypot(height(x + e, z) - height(x - e, z), height(x, z + e) - height(x, z - e)) / (2 * e);
}

// Ray (origin o, unit d) against the ground: march, then bisect. Returns t or -1.
export function rayTerrain(o, d, maxT) {
  if (!grid) return -1;
  const top = maxH + 30;
  if (o.y > top && d.y >= 0) return -1;
  // skip straight down to where the ray could first reach the ground
  let t0 = 0;
  if (o.y > top && d.y < 0) t0 = (o.y - top) / -d.y;
  if (t0 > maxT) return -1;
  const step = 0.5;
  let prev = t0;
  if (o.y + d.y * t0 - height(o.x + d.x * t0, o.z + d.z * t0) < 0) return t0;
  for (let t = t0 + step; ; t += step) {
    const tt = Math.min(t, maxT);
    const x = o.x + d.x * tt, z = o.z + d.z * tt, y = o.y + d.y * tt;
    if (Math.abs(x) > HALF + 40 || Math.abs(z) > HALF + 40) return -1;
    if (y - height(x, z) < 0) {
      let a = prev, b = tt;
      for (let k = 0; k < 7; k++) {
        const m = (a + b) / 2;
        if (o.y + d.y * m - height(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m;
      }
      return (a + b) / 2;
    }
    if (y > top && d.y >= 0) return -1;
    prev = tt;
    if (tt >= maxT) return -1;
  }
}

// Is the straight line a->b clear of the ground?
export function terrainClear(a, b) {
  if (!grid) return true;
  if (a.y > maxH + 0.1 && b.y > maxH + 0.1) return true;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const n = Math.ceil(len / 1.2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (a.y + dy * t < height(a.x + dx * t, a.z + dz * t) + 0.02) return false;
  }
  return true;
}

// ---------------- drawing ----------------
const COL = {
  grass: [104, 112, 80], grass2: [86, 96, 64], dry: [128, 124, 92], dirt: [118, 104, 82], rock: [118, 116, 108],
  mud: [84, 76, 62], road: [142, 132, 112], rut: [104, 94, 78], scorch: [62, 58, 52],
};
const TEX = 1536;
const lerp3 = (o, a, k) => { o[0] += (a[0] - o[0]) * k; o[1] += (a[1] - o[1]) * k; o[2] += (a[2] - o[2]) * k; };

// Colour map for the field: grass and dry patches by noise, rock on slopes, mud in the creek,
// then roads, ruts and craters painted on top.
function paintField() {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d');
  const img = g.createImageData(TEX, TEX);
  const px = (HALF * 2) / TEX;
  const col = [0, 0, 0];
  for (let y = 0; y < TEX; y++) {
    const z = -HALF + (y + 0.5) * px;
    for (let x = 0; x < TEX; x++) {
      const wx = -HALF + (x + 0.5) * px;
      const h = height(wx, z);
      const sl = Math.min(1, slopeAt(wx, z) * 1.5);
      col[0] = COL.grass[0]; col[1] = COL.grass[1]; col[2] = COL.grass[2];
      lerp3(col, COL.grass2, noise(wx / 12 + 31, z / 12 + 17));
      lerp3(col, COL.dry, Math.max(0, noise(wx / 32, z / 32) - 0.45) * 1.7 + Math.max(0, h - 6) * 0.05);
      lerp3(col, COL.dirt, Math.max(0, noise(wx / 6 + 50, z / 6) - 0.68) * 2.2);
      lerp3(col, COL.rock, smooth(0.25, 0.7, sl));
      lerp3(col, COL.mud, (1 - smooth(1.2, 3.6, creekDist(wx, z))) * 0.85);
      const n = (noise(wx * 1.7, z * 1.7) - 0.5) * 16;
      const k = (y * TEX + x) * 4;
      img.data[k] = col[0] + n; img.data[k + 1] = col[1] + n; img.data[k + 2] = col[2] + n * 0.8; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const P = (x) => (x + HALF) / px;
  g.lineCap = g.lineJoin = 'round';
  const stroke = (pts, w, style, alpha = 1, off = 0) => {
    g.globalAlpha = alpha;
    g.strokeStyle = style;
    g.lineWidth = w / px;
    g.beginPath();
    pts.forEach(([x, z], i) => {
      // offset sideways for ruts
      let ox = 0, oz = 0;
      if (off) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        ox = (-dz / l) * off; oz = (dx / l) * off;
      }
      if (i) g.lineTo(P(x + ox), P(z + oz)); else g.moveTo(P(x + ox), P(z + oz));
    });
    g.stroke();
    g.globalAlpha = 1;
  };
  const rgb = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
  for (const r of layout.roads) {
    stroke(r.pts, r.w * 2 + 1.6, rgb(COL.dirt), 0.45);
    stroke(r.pts, r.w * 2, rgb(COL.road), r.kind === 'road' ? 0.95 : 0.8);
    for (const s of [-1, 1]) stroke(r.pts, 0.35, rgb(COL.rut), 0.5, s * r.w * 0.45);
  }
  for (const cr of layout.craters) {
    const gr = g.createRadialGradient(P(cr.x), P(cr.z), 0, P(cr.x), P(cr.z), (cr.r * 1.7) / px);
    gr.addColorStop(0, 'rgba(58,54,48,0.85)');
    gr.addColorStop(0.55, 'rgba(92,82,66,0.6)');
    gr.addColorStop(1, 'rgba(92,82,66,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(P(cr.x), P(cr.z), (cr.r * 1.7) / px, 0, Math.PI * 2); g.fill();
  }
  // a faint worn band just inside the fence
  g.strokeStyle = 'rgba(80,72,58,0.35)';
  g.lineWidth = 1.2 / px;
  g.strokeRect(P(-HALF + 1.2), P(-HALF + 1.2), (HALF * 2 - 2.4) / px, (HALF * 2 - 2.4) / px);
  return c;
}

// Tileable detail noise, one channel per scale: R grit, G lumps, B broad mottling, A blade streaks.
function detailTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const tile = (x, y, f, seed) => { // value noise that wraps at the texture edge
    const P = S / f, xi = Math.floor(x / f), yi = Math.floor(y / f);
    const fx = x / f - xi, fy = y / f - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const h = (i, j) => hash(((i % P) + P) % P + seed * 131, ((j % P) + P) % P + seed * 71);
    const a0 = h(xi, yi), b0 = h(xi + 1, yi), c0 = h(xi, yi + 1), d0 = h(xi + 1, yi + 1);
    return a0 + (b0 - a0) * u + (c0 - a0) * v + (a0 - b0 - c0 + d0) * u * v;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = (y * S + x) * 4;
    img.data[k] = (tile(x, y, 2, 1) * 0.6 + tile(x, y, 4, 2) * 0.4) * 255;
    img.data[k + 1] = (tile(x, y, 8, 3) * 0.55 + tile(x, y, 16, 4) * 0.45) * 255;
    img.data[k + 2] = (tile(x, y, 64, 5) * 0.65 + tile(x, y, 32, 6) * 0.35) * 255;
    img.data[k + 3] = Math.min(255, tile(x * 0.25, y * 2.5, 1, 7) * 255 * 1.2); // stretched: grain of blades
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  return t;
}

// Ground shading: the painted colour map is broken up by detail sampled at three scales (two
// of them turned against each other so the pattern never visibly repeats), cliff faces turn to
// banded rock by slope, and lumps become real normal variation that fades out with distance.
// Decals (blood, scorch) can simply sit above this as meshes with polygonOffset.
function groundMaterial(opts, detail) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWN = objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nuniform sampler2D detailMap;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      float gDist = length(vViewPosition);
      float gNear = 1.0 - smoothstep(18.0, 70.0, gDist);
      vec2 gw = vWP.xz;
      vec4 gA = texture2D(detailMap, gw * 0.21);
      vec4 gB = texture2D(detailMap, mat2(0.8, 0.6, -0.6, 0.8) * gw * 0.067 + 3.1);
      vec4 gC = texture2D(detailMap, mat2(0.6, -0.8, 0.8, 0.6) * gw * 1.7 + 7.3);
      float gMottle = gB.b * 0.6 + gA.b * 0.4;
      diffuseColor.rgb *= 0.78 + gMottle * 0.5;
      diffuseColor.rgb *= 1.0 + (gA.g - 0.5) * 0.5 + (gC.r - 0.5) * 0.7 * gNear + (gC.a - 0.5) * 0.35 * gNear;
      // tint toward warm dry earth in the low-frequency lumps, so grass is never one flat green
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.0, 0.8), smoothstep(0.55, 0.85, gB.g) * 0.6);
      float gRock = 1.0 - smoothstep(0.7, 0.88, normalize(vWN).y);
      float gStrata = sin(vWP.y * 7.0 + gB.b * 6.0) * 0.5 + 0.5;
      vec3 gRockCol = vec3(0.46, 0.44, 0.4) * (0.7 + gA.r * 0.5 + gStrata * 0.18);
      diffuseColor.rgb = mix(diffuseColor.rgb, gRockCol, gRock * 0.85);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float gK = (0.55 * gNear + 0.12) * (1.0 + gRock * 1.5);
        float e = 0.012;
        vec2 q = mat2(0.6, -0.8, 0.8, 0.6) * gw * 1.7 + 7.3;
        float gh = gC.g + gA.g * 0.6;
        float gx = texture2D(detailMap, q + vec2(e, 0.0)).g + texture2D(detailMap, gw * 0.21 + vec2(e * 0.12, 0.0)).g * 0.6 - gh;
        float gz = texture2D(detailMap, q + vec2(0.0, e)).g + texture2D(detailMap, gw * 0.21 + vec2(0.0, e * 0.12)).g * 0.6 - gh;
        normal = normalize(normal + mat3(viewMatrix) * vec3(-gx, 0.0, -gz) * (gK / e) * 0.08);
      }`);
  };
  return m;
}

// ---- grass and ground clutter: instanced tufts in a ring round the camera ----
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const GR = { cell: 1.5, radius: coarse ? 20 : 30, max: coarse ? 2200 : 4800 };
let grass = null;
let grassCenter = { x: 1e9, z: 1e9 };
let grassOK = null; // per 1.5 m cell: 0 unknown, 1 grass, 2 no
const GN = Math.ceil((HALF * 2) / GR.cell);

function tuftGeometry() {
  const pos = [], col = [];
  const base = new THREE.Color('#3f4a2c'), tip = new THREE.Color('#9aa464');
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + hash(i, 3) * 0.8;
    const r = 0.05 + hash(i, 9) * 0.1, hh = 0.22 + hash(i, 5) * 0.2, w = 0.028;
    const lean = 0.07 + hash(i, 7) * 0.14;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz * w, pz = dx * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + dx * lean, hh, cz + dz * lean);
    pos.push(cx + px, 0, cz + pz, cx - px, 0, cz - pz, cx + dx * lean, hh, cz + dz * lean); // back face
    for (let k = 0; k < 2; k++) for (const c of [base, base, tip]) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); // light like the ground
  return g;
}

function makeGrass() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const cam = { value: new THREE.Vector3(1e9, 0, 1e9) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.camPos = cam;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 camPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 gWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float gFade = 1.0 - smoothstep(${(GR.radius * 0.6).toFixed(1)}, ${GR.radius.toFixed(1)}, distance(gWorld, camPos));
      transformed.y *= gFade;
      transformed.xz *= 0.4 + 0.6 * gFade;`);
  };
  const im = new THREE.InstancedMesh(tuftGeometry(), mat, GR.max);
  im.count = 0;
  im.frustumCulled = false;
  im.name = 'grass';
  im.userData.cam = cam;
  return im;
}

function grassCell(i, j) {
  const k = j * GN + i;
  if (grassOK[k]) return grassOK[k] === 1;
  const x = -HALF + (i + 0.5) * GR.cell, z = -HALF + (j + 0.5) * GR.cell;
  let ok = Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2 && slopeAt(x, z) < 0.55 && creekDist(x, z) > 2.4 && nearRoad(x, z) > 0.9;
  if (ok) for (const c of layout.craters) if (Math.hypot(x - c.x, z - c.z) < c.r * 1.3) { ok = false; break; }
  grassOK[k] = ok ? 1 : 2;
  return ok;
}

// Call every frame with the camera; rebuilds the tuft ring when the camera has moved a few metres.
export function updateGround(camera) {
  if (!grass || !grassOK) return;
  grass.userData.cam.value.copy(camera.position);
  if (Math.hypot(camera.position.x - grassCenter.x, camera.position.z - grassCenter.z) < 4) return;
  grassCenter = { x: camera.position.x, z: camera.position.z };
  const R = GR.radius, c = GR.cell;
  const i0 = Math.max(0, Math.floor((camera.position.x - R + HALF) / c)), i1 = Math.min(GN - 1, Math.ceil((camera.position.x + R + HALF) / c));
  const j0 = Math.max(0, Math.floor((camera.position.z - R + HALF) / c)), j1 = Math.min(GN - 1, Math.ceil((camera.position.z + R + HALF) / c));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  let n = 0;
  for (let j = j0; j <= j1 && n < GR.max; j++) for (let i = i0; i <= i1 && n < GR.max; i++) {
    if (!grassCell(i, j)) continue;
    const count = 1 + Math.floor(hash(i * 3, j * 5) * 3);
    for (let t = 0; t < count && n < GR.max; t++) {
      const x = -HALF + (i + hash(i + t * 17, j)) * c, z = -HALF + (j + hash(i, j + t * 29)) * c;
      if (Math.hypot(x - camera.position.x, z - camera.position.z) > R) continue;
      // fewer tufts on the dry, dirty patches
      if (noise(x / 23, z / 23) > 0.62 && hash(i + t, j) < 0.6) continue;
      const s = 0.8 + hash(i * 7 + t, j * 11) * 0.9;
      e.set((hash(i, j + t) - 0.5) * 0.3, hash(i + t, j * 2) * 6.28, 0);
      q.setFromEuler(e);
      m.compose(p.set(x, height(x, z) - 0.02, z), q, sc.set(s, s * (0.8 + hash(j, i + t) * 0.6), s));
      grass.setMatrixAt(n, m);
      col.setHSL(0.2 + (noise(x / 15, z / 15) - 0.5) * 0.06, 0.28, 0.5 + (hash(i * t, j) - 0.5) * 0.25);
      grass.setColorAt(n, col);
      n++;
    }
  }
  grass.count = n;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
}

export const groundMeshes = () => (group ? group.children.filter((o) => o.name === 'terrain' || o.name === 'hills') : []);

let group = null;
let fieldTex = null;
let minimap = null;

function fieldMesh(detail) {
  const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2, N, N);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, grid[Math.round(p.getZ(i) + HALF) * (N + 1) + Math.round(p.getX(i) + HALF)]);
  g.computeVertexNormals();
  fieldTex = new THREE.CanvasTexture(paintField());
  fieldTex.colorSpace = THREE.SRGBColorSpace;
  fieldTex.anisotropy = 8;
  const m = new THREE.Mesh(g, groundMaterial({ map: fieldTex }, detail));
  m.receiveShadow = true;
  m.name = 'terrain';
  return m;
}

// The hills beyond the fence: a coarse grid whose inner part tucks under the field.
function farMesh(detail) {
  const S = 10, E = HALF + 320;
  const n = Math.round((E * 2) / S);
  const g = new THREE.PlaneGeometry(E * 2, E * 2, n, n);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color(), grass = new THREE.Color('#5f6a49'), dry = new THREE.Color('#7b7859'), rock = new THREE.Color('#77766c');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const inside = Math.abs(x) < HALF - 0.5 && Math.abs(z) < HALF - 0.5;
    p.setY(i, inside ? bake(x, z) - 4 : bake(x, z));
    c.copy(grass).lerp(dry, noise(x / 60, z / 60) * 0.8).lerp(rock, Math.min(1, slopeAt(x, z) * 0.9) * 0.6);
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, groundMaterial({ vertexColors: true }, detail));
  m.receiveShadow = true;
  m.name = 'hills';
  return m;
}

// Boundary: wooden posts with two strands of wire, just inside the edge.
function fence() {
  const post = new THREE.CylinderGeometry(0.05, 0.065, 1.1, 6);
  post.translate(0, 0.45, 0);
  const spots = [];
  const E = HALF - 0.6;
  for (let t = -E; t < E; t += 4) spots.push([t, -E], [E, t], [-t, E], [-E, -t]);
  const im = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ color: '#4d4236', roughness: 0.95 }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => { m.makeRotationZ((noise(x, z) - 0.5) * 0.12).setPosition(x, height(x, z), z); im.setMatrixAt(i, m); });
  im.castShadow = true;
  const wire = [];
  const order = [];
  for (let t = -E; t <= E; t += 2) order.push([t, -E]);
  for (let t = -E; t <= E; t += 2) order.push([E, t]);
  for (let t = E; t >= -E; t -= 2) order.push([t, E]);
  for (let t = E; t >= -E; t -= 2) order.push([-E, t]);
  for (const y of [0.45, 0.8]) for (let i = 1; i < order.length; i++) {
    const [ax, az] = order[i - 1], [bx, bz] = order[i];
    wire.push(ax, height(ax, az) + y, az, bx, height(bx, bz) + y, bz);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#3a3631', transparent: true, opacity: 0.7 }));
  const g = new THREE.Group();
  g.add(im, lines);
  g.name = 'fence';
  return g;
}

// Adds (or rebuilds) the ground in the scene. Trees are added separately by the map.
export function mountTerrain(scene) {
  if (group && group.userData.key === layoutKey) { if (!group.parent) scene.add(group); return group; }
  if (group) {
    scene.remove(group);
    group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    fieldTex?.dispose();
  }
  const detail = detailTexture();
  group = new THREE.Group();
  group.name = 'ground';
  group.userData.key = layoutKey;
  grass = makeGrass();
  grassOK = new Uint8Array(GN * GN);
  grassCenter = { x: 1e9, z: 1e9 };
  group.add(fieldMesh(detail), farMesh(detail), fence(), grass);
  scene.add(group);
  minimap = null;
  return group;
}

// Small top-down picture for the radar: the colour map with hill shading.
export function minimapImage() {
  if (minimap || !fieldTex) return minimap;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.drawImage(fieldTex.image, 0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const m = (HALF * 2) / S;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = -HALF + (x + 0.5) * m, wz = -HALF + (y + 0.5) * m;
    // light from the top left, plus contour lines every 2 m
    const sh = (height(wx - 1, wz - 1) - height(wx + 1, wz + 1)) * 0.6;
    const h = height(wx, wz);
    const contour = Math.abs((h / 2) - Math.round(h / 2)) < 0.06 ? 0.82 : 1;
    const k = (y * S + x) * 4;
    for (let ch = 0; ch < 3; ch++) img.data[k + ch] = Math.max(0, Math.min(255, (img.data[k + ch] * 0.7 + sh * 40) * contour));
  }
  g.putImageData(img, 0, 0);
  minimap = c;
  return c;
}
