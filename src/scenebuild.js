import * as THREE from 'three';
import { Kit } from './models.js';
import { jbox, lump, rngOf, tone, put, plain, grounded, rebar, setFar } from './propbuild.js';
import { ensureOutward } from './geo.js';

// The loose scenery that is drawn in bulk: trees, bushes, felled logs, wire, tyres and burnt-out hulks.
// Each model is built from the same pieces as the props (Kit) and comes out as one mesh with its own vertex colours,
// so a kind of tree costs a single draw call. Foliage uses its own flat-shaded material; hard things use the uber material.
export const FOLIAGE = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, vertexColors: true, flatShading: true });
FOLIAGE.name = 'foliage';

// cheap smooth noise from sines: enough to break up a colour, needs no tables
const n3 = (x, y, z, s = 0) => 0.5 + 0.25 * Math.sin(x * 1.7 + y * 2.3 + s) * Math.cos(z * 1.9 - y * 1.1 + s * 2.1) + 0.25 * Math.sin(x * 4.1 - z * 3.3 + y * 1.7 + s * 3.7);
// give a geometry per-vertex colour from fn(x, y, z) -> hex / Color
function colored(g, fn) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const p = g.attributes.position, a = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); c.set(v); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t)));

// A tapered limb along a polyline: `rings` rounded-square cross-sections, closed at the tip, `radial` sides.
function limb(points, r0, r1, radial = 6, rings = 4) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(rings, false);
  const pos = [], idx = [], P = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    curve.getPointAt(t, P);
    const N = frames.normals[i], B = frames.binormals[i], r = r0 + (r1 - r0) * t;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(P.x + (N.x * c + B.x * s) * r, P.y + (N.y * c + B.y * s) * r, P.z + (N.z * c + B.z * s) * r);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + ((j + 1) % radial); idx.push(a, a + radial, b, b, a + radial, b + radial); }
  const tip = pos.length / 3, end = curve.getPointAt(1);
  pos.push(end.x, end.y, end.z);
  for (let j = 0; j < radial; j++) idx.push(rings * radial + j, tip, rings * radial + ((j + 1) % radial));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  ensureOutward(g);
  return g;
}
const eulerOf = (q) => new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
const BARK = ['#4a3c30', '#54443a', '#3f3329'];
const barkColor = (seed = 0) => (x, y, z) => mix(BARK[0], BARK[1], n3(Math.atan2(x, z) * 3, y * 0.6, 0, seed)).multiplyScalar(0.8 + 0.3 * n3(x * 6, y * 2, z * 6, seed));

// ---------------------------------------------------------------------------------------------------------------
// A flat fan of needles on a bough: a flattened three-sided cone from the trunk out and down.
function bough(k, y, ang, len, droop, thick, dark, light) {
  const g = new THREE.ConeGeometry(thick, len, 3, 1, true);
  g.translate(0, len / 2, 0);
  const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(droop), -Math.sin(droop), Math.sin(ang) * Math.cos(droop)).normalize();
  const hx = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), vz = new THREE.Vector3().crossVectors(hx, dir);
  g.scale(1, 1, 0.38);                                            // flat: wide across, thin up and down
  const m = new THREE.Matrix4().makeBasis(hx, dir, vz);
  g.applyMatrix4(m);
  const g2 = colored(g, (px, py, pz) => mix(dark, light, Math.hypot(px, py, pz) / len).multiplyScalar(0.9 + 0.2 * n3(px * 3, py * 3, pz * 3, y)));
  k.add(g2, FOLIAGE, { pos: [0, y, 0] });
}
function fir(k, v) {
  const rnd = rngOf(20 + v);
  const h = v === 0 ? 5.7 : 4.7, spread = v === 0 ? 1.45 : 1.85, tiers = v === 0 ? 10 : 8;
  k.add(colored(limb([[0, -0.15, 0], [0.02, h * 0.3, 0.01], [0, h * 0.7, -0.01], [0, h + 0.55, 0]], 0.3, 0.012, 7, 5), barkColor(v)), FOLIAGE);
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1), y = 1.0 + f * (h - 1.5), R = spread * (1 - f * 0.9) + 0.18, n = t < 2 ? 8 : t > tiers - 3 ? 5 : 7;
    const dark = tone('#1d2b20', rnd, 0.04), light = tone(v ? '#3d5636' : '#34502f', rnd, 0.08);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 0.9 + (rnd() - 0.5) * 0.4, len = R * (0.85 + rnd() * 0.3), droop = 0.4 + (1 - f) * 0.3 + rnd() * 0.15;
      bough(k, y + (rnd() - 0.5) * 0.12, a, len, droop, 0.2 + R * 0.09, dark, light);
      bough(k, y - 0.12 + (rnd() - 0.5) * 0.08, a + 0.22 * (i % 2 ? 1 : -1), len * 0.62, droop + 0.25, 0.1 + R * 0.04, dark, light);
    }
  }
  const spike = new THREE.ConeGeometry(0.11, 0.8, 4);
  spike.translate(0, h + 0.2, 0);
  k.add(colored(spike, () => '#34502f'), FOLIAGE);
  // a few dead lower stubs
  for (let i = 0; i < 3; i++) { const a = rnd() * 6.28; k.add(colored(limb([[0, 0.4 + i * 0.28, 0], [Math.cos(a) * 0.3, 0.38 + i * 0.28, Math.sin(a) * 0.3], [Math.cos(a) * 0.55, 0.3 + i * 0.28, Math.sin(a) * 0.55]], 0.03, 0.012, 4, 2), () => '#3a2f26'), FOLIAGE); }
}
function crownClump(k, rnd, x, y, z, r, base, seed, fine = 1) {
  const g = new THREE.IcosahedronGeometry(r, fine);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), n = 0.78 + 0.5 * n3(px * 2.4, py * 2.4, pz * 2.4, seed);
    p.setXYZ(i, px * n, py * n * 0.8, pz * n);
  }
  g.translate(x, y, z);
  const dark = tone('#2a3720', rnd, 0.04);
  const col = colored(g, (px, py, pz) => mix(dark, base, 0.2 + 0.8 * Math.min(1, Math.max(0, (py - (y - r)) / (2 * r))) + 0.2 * (n3(px * 3, py * 3, pz * 3, seed) - 0.5)));
  k.add(col, FOLIAGE);
}
function leafTree(k, v) {
  const rnd = rngOf(50 + v);
  const lean = v ? 0.35 : -0.2;
  k.add(colored(limb([[0, -0.15, 0], [lean * 0.15, 1.2, 0.05], [lean * 0.3, 2.3, 0], [lean * 0.4, 2.8, 0.02]], 0.28, 0.12, 7, 4), barkColor(v + 3)), FOLIAGE);
  const ends = v === 0 ? [[1.4, 3.7, 0.7], [-1.3, 3.6, -0.8], [0.2, 4.5, -0.4], [-0.5, 3.4, 1.4], [0.8, 3.2, -1.3]] : [[1.6, 3.3, -0.7], [-1.4, 3.9, 0.4], [0.2, 4.6, 0.5], [0.6, 3.5, -1.5], [-0.7, 3.2, 1.2]];
  const base = tone(v ? '#6a7140' : '#58673c', rnd, 0.06);
  for (const [ex, ey, ez] of ends) {
    k.add(colored(limb([[lean * 0.4, 2.4, 0], [ex * 0.5, 3.0, ez * 0.5], [ex, ey, ez]], 0.1, 0.035, 5, 3), barkColor(7)), FOLIAGE);
    crownClump(k, rnd, ex * 1.05, ey + 0.25, ez * 1.05, 0.8 + rnd() * 0.2, tone('#58673c', rnd, 0.12), ex * 3 + ez, 1);
    crownClump(k, rnd, ex * 0.75 + (rnd() - 0.5) * 0.7, ey - 0.35 + rnd() * 0.3, ez * 0.75 + (rnd() - 0.5) * 0.7, 0.5 + rnd() * 0.2, tone('#4d5b34', rnd, 0.1), ex + 4 * ez, 0);
  }
  crownClump(k, rnd, 0.0, 3.8, 0.0, 1.0, tone('#5f6e3f', rnd, 0.06), 1, 1);
  for (let i = 0; i < 4; i++) { const a = i * 1.6 + rnd(); crownClump(k, rnd, Math.cos(a) * 1.0, 3.0 + rnd() * 0.6, Math.sin(a) * 1.0, 0.5 + rnd() * 0.2, tone('#445230', rnd, 0.08), i * 3, 0); }
}
function birch(k) {
  const rnd = rngOf(70);
  const trunk = limb([[0, -0.15, 0], [0.08, 1.4, 0.04], [-0.05, 3.0, -0.05], [0.1, 4.8, 0.05]], 0.12, 0.03, 6, 6);
  k.add(colored(trunk, (x, y, z) => { const band = Math.sin(y * 17 + n3(x * 9, y, z * 9) * 4) > 0.55 ? 0.12 : 0.88; return mix('#1f1d1a', '#d9d5c8', band * (0.9 + 0.1 * n3(x * 7, y * 3, z * 7))); }), FOLIAGE);
  const branches = [[0.7, 3.4, 0.3], [-0.6, 3.9, -0.3], [0.3, 4.4, -0.5], [-0.3, 3.0, 0.5]];
  for (const [ex, ey, ez] of branches) {
    k.add(colored(limb([[0.02, ey - 1.0, 0], [ex * 0.6, ey - 0.4, ez * 0.6], [ex, ey, ez]], 0.035, 0.015, 4, 2), () => '#cfcabd'), FOLIAGE);
    crownClump(k, rnd, ex * 1.1, ey + 0.2, ez * 1.1, 0.55 + rnd() * 0.15, tone('#8c9b4c', rnd, 0.08), ex * 5);
  }
  crownClump(k, rnd, 0.05, 4.9, 0.05, 0.7, tone('#98a653', rnd, 0.06), 9);
}
function dead(k) {
  const rnd = rngOf(90);
  k.add(colored(limb([[0, -0.15, 0], [0.1, 1.1, 0.05], [-0.05, 2.4, -0.05], [0.12, 3.7, 0.04]], 0.2, 0.035, 6, 5), (x, y, z) => mix('#2b2622', '#4a4036', n3(x * 8, y * 3, z * 8)).multiplyScalar(0.9)), FOLIAGE);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1 + rnd(), y0 = 1.5 + i * 0.35, L = 0.9 - i * 0.07;
    const mid = [Math.cos(a) * L * 0.55, y0 + L * 0.35, Math.sin(a) * L * 0.55], end = [Math.cos(a + 0.4) * L, y0 + L * 0.55 + rnd() * 0.3, Math.sin(a + 0.4) * L];
    k.add(colored(limb([[0.02, y0, 0], mid, end], 0.06, 0.012, 4, 3), () => '#2f2a25'), FOLIAGE);
    k.add(colored(limb([mid, [mid[0] + Math.cos(a - 1) * 0.3, mid[1] + 0.25, mid[2] + Math.sin(a - 1) * 0.3]], 0.025, 0.008, 4, 1), () => '#2a2622'), FOLIAGE);
  }
  // scorch at the foot and a jagged break at the top
  const brk = new THREE.ConeGeometry(0.05, 0.5, 4); brk.translate(0.12, 3.95, 0.04);
  k.add(colored(brk, () => '#6e6050'), FOLIAGE);
}
function bush(k, v) {
  const rnd = rngOf(110 + v);
  const n = v === 0 ? 9 : 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(), r = (v === 0 ? 0.25 : 0.5) + rnd() * (v === 0 ? 0.35 : 0.5), rad = (v === 0 ? 0.3 : 0.26) + rnd() * 0.14;
    const g = new THREE.IcosahedronGeometry(rad, i < 3 ? 1 : 0);
    const p = g.attributes.position;
    for (let j = 0; j < p.count; j++) { const px = p.getX(j), py = p.getY(j), pz = p.getZ(j), nn = 0.78 + 0.5 * n3(px * 3, py * 3, pz * 3, i + v * 7); p.setXYZ(j, px * nn, py * nn * (v ? 0.55 : 0.85), pz * nn); }
    const dark = tone('#26331f', rnd, 0.04), light = tone(v ? '#5e6c3c' : '#4c5f31', rnd, 0.12);
    g.translate(Math.cos(a) * r * (i ? 1 : 0), 0, Math.sin(a) * r * (i ? 1 : 0));
    grounded(g, 0.05);
    g.translate(0, (i % 3) * 0.12 * (v ? 0.5 : 1), 0);
    k.add(colored(g, (px, py) => mix(dark, light, py / (rad * 1.3) + 0.15)), FOLIAGE);
  }
  // a few bare stems showing through
  for (let i = 0; i < 4; i++) { const a = rnd() * 6.28; k.add(colored(limb([[Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1], [Math.cos(a) * 0.25, 0.3, Math.sin(a) * 0.25], [Math.cos(a) * 0.4, 0.55, Math.sin(a) * 0.4]], 0.02, 0.008, 3, 2), () => '#3b3026'), FOLIAGE); }
}
// a felled tree: the log with a splintered end, a few limb stubs, and the stump it came from
function felled(k) {
  const rnd = rngOf(130);
  const log = limb([[-1.7, 0.2, 0], [-0.4, 0.21, 0.02], [0.9, 0.19, -0.02], [1.7, 0.17, 0]], 0.22, 0.17, 7, 4);
  log.applyMatrix4(new THREE.Matrix4().makeRotationY(0.0));
  k.add(colored(grounded(log, 0.01), barkColor(5)), FOLIAGE, { pos: [0.5, 0, 0.9] });
  for (let i = 0; i < 4; i++) {
    const a = i * 1.9, x = -0.9 + i * 0.7;
    k.add(colored(limb([[x, 0.25, 0.1], [x + 0.1, 0.4, Math.sin(a) * 0.25 + 0.1], [x + 0.15, 0.55, Math.sin(a) * 0.45 + 0.1]], 0.035, 0.014, 4, 2), () => '#3b2f26'), FOLIAGE, { pos: [0.5, 0, 0.9] });
  }
  for (let i = 0; i < 5; i++) { const sp = new THREE.ConeGeometry(0.03, 0.4, 3); sp.rotateZ(Math.PI / 2 + (rnd() - 0.5) * 0.5); sp.translate(-1.85, 0.15 + rnd() * 0.12, (rnd() - 0.5) * 0.2); k.add(colored(sp, () => '#b9a888'), FOLIAGE, { pos: [0.5, 0, 0.9] }); }
  const stump = limb([[0, 0, 0], [0, 0.25, 0], [0.02, 0.55, 0]], 0.3, 0.22, 7, 3);
  k.add(colored(stump, (x, y, z) => (y > 0.5 ? '#b9a07a' : mix(BARK[0], BARK[1], n3(x * 9, y, z * 9)))), FOLIAGE, { pos: [-0.9, -0.02, -0.6] });
  for (let i = 0; i < 5; i++) { const a = i * 1.3; k.add(colored(limb([[Math.cos(a) * 0.18, 0.1, Math.sin(a) * 0.18], [Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5]], 0.07, 0.015, 4, 1), () => '#3f3329'), FOLIAGE, { pos: [-0.9, 0, -0.6] }); }
}

// ---------------------------------------------------------------------------------------------------------------
// a span of barbed concertina between two pickets
function wire(k) {
  const L = 2.6;
  for (const s of [-1, 1]) {
    k.add(colored(new THREE.BoxGeometry(0.04, 1.2, 0.025), () => '#3a3d38'), FOLIAGE, { pos: [s * L / 2, 0.58, 0] });
    k.add(colored(new THREE.BoxGeometry(0.04, 0.3, 0.025), () => '#3a3d38'), FOLIAGE, { pos: [s * L / 2 + s * 0.05, 1.28, 0], rot: [0, 0, -s * 0.5] });
  }
  const pts = [];
  const loops = 8, per = 12;
  for (let i = 0; i <= loops * per; i++) {
    const t = i / (loops * per), a = t * loops * Math.PI * 2;
    pts.push(new THREE.Vector3(-L / 2 + t * L, 0.31 + Math.sin(a) * 0.3 - Math.sin(t * Math.PI) * 0.03, Math.cos(a) * 0.3));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), loops * per, 0.008, 3, false);
  k.add(colored(g, () => '#2a2d2b'), FOLIAGE);
  for (const y of [0.55, 1.0]) k.add(colored(new THREE.BoxGeometry(L, 0.007, 0.007), () => '#2a2d2b'), FOLIAGE, { pos: [0, y, 0] });
}
function tyres(k) {
  const rnd = rngOf(150);
  for (const [x, y, z] of [[0, 0, 0], [0.62, 0.0, 0.1], [0.3, 0.2, 0.5]]) {
    const g = new THREE.TorusGeometry(0.3, 0.12, 6, 12); g.rotateX(Math.PI / 2);
    plain(k, g, '#232322', 0.95, 0, { pos: [x, 0.12 + y, z], rot: [0, rnd() * 6, 0] });
    plain(k, new THREE.CylinderGeometry(0.2, 0.2, 0.02, 10), '#3b3a37', 0.6, 0.6, { pos: [x, 0.1 + y, z] });   // the dish of the wheel inside
  }
}

// ---------------------------------------------------------------------------------------------------------------
// burnt-out hulks: a tank with its turret thrown, and a truck stripped to its frame
const SOOT = ['#2b2926', '#34312d', '#26241f', '#3a3631'];
function tankHulk(k) {
  const rnd = rngOf(170);
  const c = () => tone(SOOT[Math.floor(rnd() * 4)], rnd, 0.06);
  // lower hull and tracks, a sloped glacis, engine deck with grilles
  put(k, jbox(3.3, 0.55, 1.5, rnd, 0.015), 'metal', c(), 1, { pos: [0, 0.62, 0] });
  put(k, jbox(1.1, 0.34, 1.46, rnd, 0.02), 'metal', c(), 1, { pos: [1.55, 0.74, 0], rot: [0, 0, -0.42] });
  put(k, jbox(1.5, 0.3, 1.46, rnd, 0.02), 'metal', c(), 1, { pos: [-0.9, 0.93, 0] });
  for (let i = 0; i < 6; i++) put(k, new THREE.BoxGeometry(0.03, 0.04, 1.0), 'metal', '#1a1917', 1, { pos: [-1.35 + i * 0.12, 1.1, 0] });
  for (const s of [-1, 1]) {
    put(k, jbox(3.5, 0.34, 0.34, rnd, 0.02), 'metal', c(), 1, { pos: [0, 0.4, s * 0.84] });         // track run
    put(k, jbox(3.4, 0.1, 0.5, rnd, 0.03), 'metal', c(), 1, { pos: [0, 0.82, s * 0.86] });          // fender
    for (let i = 0; i < 6; i++) put(k, new THREE.CylinderGeometry(0.26, 0.26, 0.22, 8), 'metal', '#2c2a26', 1, { pos: [-1.35 + i * 0.54, 0.28, s * 0.82], rot: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 17; i++) put(k, new THREE.BoxGeometry(0.1, 0.045, 0.3), 'metal', '#1f1d1a', 1, { pos: [-1.7 + i * 0.21, 0.03 + (i % 3 === 1 ? 0.01 : 0), s * 0.84] });   // link ends on the ground
    put(k, new THREE.CylinderGeometry(0.33, 0.33, 0.2, 9), 'metal', '#2c2a26', 1, { pos: [1.72, 0.34, s * 0.82], rot: [Math.PI / 2, 0, 0] });
  }
  // the turret, blown off its ring and lying canted on the rear deck, gun bent and hatch open
  const tur = new THREE.CylinderGeometry(0.62, 0.72, 0.46, 9);
  tur.scale(1.15, 1, 1);
  put(k, tur, 'metal', c(), 1, { pos: [-0.75, 1.3, 0.12], rot: [0.22, 0.4, 0.28] });
  put(k, jbox(0.4, 0.34, 0.8, rnd, 0.05), 'metal', c(), 1, { pos: [-0.05, 1.28, 0.26], rot: [0.22, 0.4, 0.28] });
  // the gun: a barrel from the mantlet, bent where a shell hit it, the tip drooping
  const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0.4, 0.28)), c0 = new THREE.Vector3(-0.05, 1.28, 0.26);
  const barrel = new THREE.CylinderGeometry(0.06, 0.07, 1.4, 7);
  barrel.rotateZ(Math.PI / 2);
  const bc = c0.clone().add(new THREE.Vector3(0.6, 0, 0).applyQuaternion(qb));
  put(k, barrel, 'metal', '#25231f', 1, { pos: bc.toArray(), rot: eulerOf(qb) });
  const qt = qb.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.5));
  const tipC = c0.clone().add(new THREE.Vector3(1.3, 0, 0).applyQuaternion(qb)).add(new THREE.Vector3(0.36, 0, 0).applyQuaternion(qt));
  put(k, new THREE.CylinderGeometry(0.055, 0.065, 0.8, 7).rotateZ(Math.PI / 2), 'metal', '#25231f', 1, { pos: tipC.toArray(), rot: eulerOf(qt) });
  put(k, new THREE.TorusGeometry(0.2, 0.03, 4, 8), 'metal', '#1a1917', 1, { pos: [-0.72, 1.62, 0.1], rot: [Math.PI / 2 + 0.2, 0, 0.3] });   // hatch ring
  // blackened scars and a bit of loose plate
  put(k, jbox(0.9, 0.04, 0.5, rnd, 0.1), 'metal', '#3a342c', 1, { pos: [1.0, 0.93, -0.4], rot: [0.1, 0.3, 0.2] });
  rebar(k, -1.6, 1.05, 0.4, 0.3, 0.5, 1, 1);
}
function truckHulk(k) {
  const rnd = rngOf(180);
  const c = () => tone(SOOT[Math.floor(rnd() * 4)], rnd, 0.06);
  // chassis rails, the cab shell with every window gone, the bed down to its ribs
  for (const s of [-1, 1]) put(k, jbox(4.0, 0.14, 0.12, rnd, 0.02), 'metal', c(), 1, { pos: [0, 0.55, s * 0.55] });
  for (let i = 0; i < 4; i++) put(k, jbox(0.1, 0.1, 1.2, rnd, 0.02), 'metal', c(), 1, { pos: [-1.5 + i * 1.0, 0.55, 0] });
  put(k, jbox(1.15, 0.12, 1.4, rnd, 0.02), 'metal', c(), 1, { pos: [1.35, 0.95, 0] });           // cab floor
  put(k, jbox(0.08, 1.0, 1.4, rnd, 0.03), 'metal', c(), 1, { pos: [0.8, 1.5, 0] });              // bulkhead
  put(k, jbox(1.0, 0.07, 1.4, rnd, 0.03), 'metal', c(), 1, { pos: [1.3, 2.0, 0.0], rot: [0, 0, 0.05] });   // roof, sagging
  for (const sx of [0.8, 1.85]) for (const sz of [-0.68, 0.68]) put(k, jbox(0.07, 0.95, 0.07, rnd, 0.04), 'metal', c(), 1, { pos: [sx, 1.47, sz] });
  put(k, jbox(0.7, 0.4, 1.3, rnd, 0.03), 'metal', c(), 1, { pos: [2.1, 0.8, 0], rot: [0, 0, 0.18] });   // the bonnet, folded
  for (let i = 0; i < 7; i++) put(k, jbox(0.07, 0.1, 1.4, rnd, 0.05), 'wood', '#2a2118', 1, { pos: [-1.9 + i * 0.42, 0.655, 0], ax: 2 });   // charred bed boards
  put(k, jbox(2.6, 0.1, 0.08, rnd, 0.04), 'wood', '#2a2118', 1, { pos: [-0.9, 0.75, 0.72], rot: [0, 0, 0.0], ax: 0 });
  for (const [x, z] of [[1.6, 0.8], [1.6, -0.8], [-1.3, 0.82]]) {
    put(k, new THREE.TorusGeometry(0.34, 0.14, 6, 12), 'metal', '#1d1c1a', 1, { pos: [x, 0.38, z] });
    plain(k, new THREE.CylinderGeometry(0.17, 0.17, 0.16, 8).rotateX(Math.PI / 2), '#2e2c29', 0.7, 0.5, { pos: [x, 0.38, z] });
  }
  put(k, new THREE.CylinderGeometry(0.4, 0.4, 0.36, 8).rotateX(Math.PI / 2), 'metal', '#2a2825', 1, { pos: [-1.3, 0.09, -0.78], rot: [0, 0, 0] });   // the wheel that came off
}

// a handful of broken things thrown out round a crater or a wall: clods, a brick, a concrete shard, a plank
function debris(k, v) {
  const rnd = rngOf(190 + v);
  const earth = ['#4a4034', '#564a3b', '#3e362c'], brick = ['#7a4a3c', '#6e4136'], conc = ['#8d8a82', '#7c7a72'];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + v, r = 0.18 + rnd() * 0.22;
    const g = lump(0.18 + rnd() * 0.1, 0.09 + rnd() * 0.05, 0.15 + rnd() * 0.08, 200 + i + v * 9);
    grounded(g, 0.005);
    k.add(colored(g, () => earth[i % 3]), FOLIAGE, { pos: [Math.cos(a) * r, 0, Math.sin(a) * r], rot: [0, a, 0] });
  }
  const b = jbox(0.2, 0.07, 0.1, rnd, 0.12); b.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, 0.7, 0.2))); grounded(b, 0.003);
  k.add(colored(b, () => brick[v % 2]), FOLIAGE, { pos: [0.28, 0, -0.12] });
  const c = jbox(0.28, 0.06, 0.2, rnd, 0.2); c.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.2, 1.1, 0.35))); grounded(c, 0.003);
  k.add(colored(c, () => conc[v % 2]), FOLIAGE, { pos: [-0.3, 0, 0.18] });
  if (v) { const p = jbox(0.6, 0.03, 0.08, rnd, 0.15); p.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.1, 0.4, 0.15))); grounded(p, 0.003); k.add(colored(p, () => '#5a4531'), FOLIAGE, { pos: [0.05, 0, 0.3] }); }
}
// a tuft of grass: curved blades, dark at the root and pale at the tip
function tuft(k, v) {
  const rnd = rngOf(210 + v);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const h = (0.28 + rnd() * 0.3) * (v ? 1.3 : 1), a = (i / n) * Math.PI * 2 + rnd() * 0.5, lean = 0.2 + rnd() * 0.35;
    const g = new THREE.ConeGeometry(0.022, h, 3, 1, true);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    for (let j = 0; j < p.count; j++) { const y = p.getY(j); p.setX(j, p.getX(j) + y * y * lean * 1.4); }   // bent over toward the tip
    g.rotateY(a);
    k.add(colored(g, (x, y) => mix('#4c5a30', '#b9c07a', y / h)), FOLIAGE);
  }
}
const BUILD = { fir, leaf: leafTree, birch, dead, bush, felled, wire, tyres, tankHulk, truckHulk, debris, tuft };
export const SCENE_VARIANTS = { fir: 2, leaf: 2, birch: 1, dead: 1, bush: 2, felled: 1, wire: 1, tyres: 1, tankHulk: 1, truckHulk: 1, debris: 2, tuft: 2 };
export const SCENE_TYPES = Object.keys(BUILD);
export function buildScene(type, v = 0) {
  setFar(false);
  const k = new Kit();
  BUILD[type](k, v);
  return k;
}
void lump;
