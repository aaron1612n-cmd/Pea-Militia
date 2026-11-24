import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HEAD_Y } from './anatomy.js';

// Torn flesh, bone and ruined parts: the shapes gore.js throws around and crowd.js draws on the
// soldiers. Nothing here is a box or a capsule. Every piece is an irregular, welded mesh with its
// own colours baked in:
//   lump / strip / shard  loose tissue, sinew and bone splinters (flying gibs)
//   plate                 a torn scrap of armour
//   piece(...)            a severed arm or leg: a tube with a ragged wound face (muscle, bone, marrow)
//   stumpGeo()            the wound face left on the body where a limb or head was torn off
//   wreckHead(kind)       a skull with its face or its top blown away
// Meshes that mix a tint (cloth, skin) with fixed wound colours use woundMaterial: the instance
// colour is the tint, and each vertex carries a fixed colour (aWC) and how much of it to show (aWm).

// u.lost bits: 1,2 arms off at the shoulder; 4,8 legs off at the hip; 16 head gone; 32,64 forearm
// and hand gone at the elbow; 128,256 shin and foot gone at the knee; 512 face destroyed; 1024 top of the skull blown out
export const LOST = { ARM: 1, LEG: 4, HEAD: 16, FORE: 32, SHIN: 128, FACE: 512, CROWN: 1024 };
const TAU = Math.PI * 2;
const hash = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
const sm = (t) => t * t * (3 - 2 * t);
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash(xi + i, yi + j, zi + k);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf), l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}
const fbm = (x, y, z) => vnoise(x, y, z) * 0.6 + vnoise(x * 2.3 + 5, y * 2.3 + 1, z * 2.3 + 9) * 0.4;

const C = (h) => new THREE.Color(h);
const MUSCLE = [C('#8e1c1c'), C('#7a1414'), C('#a32b27'), C('#681010')];
const FAT = C('#c9a07c'), BONE = C('#dcd2ba'), MARROW = C('#5a0e0e'), CLOT = C('#3a0707');
const BRAIN = [C('#a07a78'), C('#8a5c5c'), C('#b08a86')];
const lerpC = (a, b, t, out = new THREE.Color()) => out.copy(a).lerp(b, t);

// a clean, welded, indexed geometry with positions only
function clean(g) {
  const k = g.clone();
  for (const n of Object.keys(k.attributes)) if (n !== 'position') k.deleteAttribute(n);
  const m = mergeVertices(k, 1e-4);
  return m;
}
function setAttr(g, color, mixv) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3), w = new Float32Array(n);
  for (let i = 0; i < n; i++) { const col = color(i); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; w[i] = mixv ? mixv(i) : 1; }
  g.setAttribute('aWC', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aWm', new THREE.BufferAttribute(w, 1));
  return g;
}
function finish(parts) {
  for (const g of parts) { g.deleteAttribute('uv'); if (!g.attributes.normal) g.computeVertexNormals(); }
  const out = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  out.computeBoundingSphere();
  return out;
}

// instance colour = tint; aWC/aWm = fixed wound colour and its strength
export function woundMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWC; attribute float aWm; varying vec3 vWC; varying float vWm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWC = aWC; vWm = aWm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWC; varying float vWm;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vWC, vWm);');
  };
  return m;
}

// ---- loose tissue -----------------------------------------------------------------------------
function blobby(detail, amp, seed, scale, bend = 0) {
  const g = clean(new THREE.IcosahedronGeometry(0.5, detail));
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 3.1 + seed, v.y * 3.1 + seed * 0.7, v.z * 3.1 + seed * 1.3);
    v.multiplyScalar(1 + (n - 0.5) * 2 * amp).multiply(scale);
    v.y += v.x * v.x * bend;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
// baked shading variation so a lump is never one flat colour: darker clots, paler fat, wet sheen is the material's
function mottle(g, base, seed) {
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = fbm(p.getX(i) * 40 + seed, p.getY(i) * 40, p.getZ(i) * 40 + seed);
    const k = 0.62 + t * 0.7;
    col[i * 3] = Math.min(1, base.r * k + (t > 0.72 ? 0.18 : 0)); col[i * 3 + 1] = base.g * k + (t > 0.72 ? 0.07 : 0); col[i * 3 + 2] = base.b * k + (t > 0.72 ? 0.05 : 0);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
export const lumpGeo = (seed = 1) => mottle(blobby(1, 0.42, seed, new THREE.Vector3(1, 0.78, 0.92)), C('#ffffff'), seed);
export const stripGeo = (seed = 2) => mottle(blobby(1, 0.3, seed, new THREE.Vector3(1.5, 0.22, 0.42), 0.9), C('#ffffff'), seed);
export function shardGeo(seed = 3) {
  const g = clean(new THREE.OctahedronGeometry(0.5, 1));
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = hash(Math.round(v.x * 40) + seed, Math.round(v.y * 40), Math.round(v.z * 40));
    v.set(v.x * 0.26, v.y * (1.6 + (v.y > 0 ? n * 0.7 : 0)), v.z * 0.17);
    v.x += v.y * 0.1; v.z += (n - 0.5) * 0.06;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const n = p.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const t = p.getY(i) > 0.25 ? 1 : 0.88, r = hash(i, seed, 1); col[i * 3] = BONE.r * t; col[i * 3 + 1] = (BONE.g - r * 0.1) * t; col[i * 3 + 2] = (BONE.b - r * 0.16) * t; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// a torn scrap of armour: a jagged slab with a bent edge
export function plateGeo(seed = 4) {
  const s = new THREE.Shape(), n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, r = 0.5 * (0.55 + hash(i, seed, 2) * 0.55);
    (i ? s.lineTo : s.moveTo).call(s, Math.cos(a) * r, Math.sin(a) * r * 0.8);
  }
  const g = clean(new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false }));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - 0.05 + Math.max(0, p.getX(i)) * 0.35);
  g.computeVertexNormals();
  return g;
}

// ---- wound faces: the torn end of a limb or neck --------------------------------------------------
// Built along +z for a unit-radius limb. The cut end (z = 0) is ragged: cloth or skin frays past the
// fat, the muscle sits proud in uneven lobes, and the bone splinters out of the middle.
function tube(len, r0, r1, z0, seed, jag) {
  const rad = 14, seg = 5;
  const g = clean(new THREE.CylinderGeometry(r1, r0, len, rad, seg, true).rotateX(Math.PI / 2).translate(0, 0, z0 + len / 2));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (z - z0) / len; // 0 far end .. 1 cut end
    if (t > 0.9) p.setZ(i, z - jag * (0.2 + hash(Math.round(x * 30), Math.round(y * 30), seed) * 0.8)); // frayed lip
    const w = 1 + (fbm(x * 4 + seed, y * 4, z * 4) - 0.5) * 0.12;
    p.setX(i, x * w); p.setY(i, y * w);
  }
  g.computeVertexNormals();
  return g;
}
function cap(r, z, seed, bulge) {
  const rings = [0, 0.14, 0.3, 0.55, 0.8, 0.96], seg = 14, pos = [], idx = [];
  pos.push(0, 0, z + bulge);
  for (const f of rings.slice(1)) for (let k = 0; k < seg; k++) {
    const a = (k / seg) * TAU, rr = r * f * (f > 0.9 ? 1 : 1 + (hash(k, f * 10, seed) - 0.5) * 0.12);
    const lobe = (fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2, f * 3) - 0.5) * 0.5 * r;
    pos.push(Math.cos(a) * rr, Math.sin(a) * rr, z + (f > 0.9 ? -0.08 * r : bulge * (1 - f) + lobe * (1 - f * 0.4)));
  }
  for (let k = 0; k < seg; k++) idx.push(0, 1 + k, 1 + ((k + 1) % seg));
  for (let j = 0; j < rings.length - 2; j++) for (let k = 0; k < seg; k++) {
    const a = 1 + j * seg + k, b = 1 + j * seg + ((k + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function boneStub(r, z, seed) {
  const g = clean(new THREE.CylinderGeometry(r * 0.78, r, r * 1.5, 7, 2, false).rotateX(Math.PI / 2).translate(0, 0, z + r * 0.35));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > z + r * 0.5) { p.setZ(i, p.getZ(i) + (hash(Math.round(p.getX(i) * 50), Math.round(p.getY(i) * 50), seed) - 0.3) * r * 1.1); p.setX(i, p.getX(i) * 0.82); }
  g.computeVertexNormals();
  return g;
}

// unit-radius wound face; cut face at z = 0 pointing +z, the limb running back along -z
export function stumpGeo(seed = 7) {
  const body = tube(0.7, 1.02, 1.0, -0.7, seed, 0.2);
  setAttr(body, (i) => { const p = body.attributes.position, t = p.getZ(i) / -0.7; return lerpC(C('#ffffff'), MUSCLE[3], Math.min(1, Math.max(0, 1 - t * 1.3)) * 0.7); }, (i) => Math.max(0, 1 - (body.attributes.position.getZ(i) / -0.7) * 1.3) * 0.7);
  const face = cap(0.97, -0.03, seed + 1, 0.13);
  setAttr(face, (i) => {
    const p = face.attributes.position, r = Math.hypot(p.getX(i), p.getY(i)), n = fbm(p.getX(i) * 6 + seed, p.getY(i) * 6, 2);
    if (r > 0.86) return FAT;
    if (r < 0.1) return MARROW;
    return lerpC(MUSCLE[(n * 4) | 0 || 0], MUSCLE[(n * 7) % 4 | 0], 0.5);
  });
  const bone = boneStub(0.3, 0.02, seed + 2);
  setAttr(bone, (i) => (bone.attributes.position.getZ(i) > 0.3 ? BONE : lerpC(BONE, MARROW, 0.5)));
  return finish([body, face, bone]);
}

// a severed arm or leg (or part of one), centred on its length, wound face at +z. Radii are real
// metres. `end`: 'hand' (glove) or 'foot' (boot) closes the far end with a ruined shape.
export function pieceGeo({ len = 0.22, r0 = 0.037, r1 = 0.03, end = 'none', seed = 11 } = {}) {
  const z0 = -len / 2;
  const tb = tube(len, r0, r1, z0, seed, 0.2 * r1 * 3);
  const tp = tb.attributes.position;
  setAttr(tb, (i) => { const t = (tp.getZ(i) - z0) / len; return lerpC(C('#ffffff'), MUSCLE[3], Math.max(0, (t - 0.55) / 0.45)); }, (i) => { const t = (tp.getZ(i) - z0) / len; return Math.max(0, (t - 0.55) / 0.45) * 0.8; });
  const parts = [tb];
  // distal end: rounded cuff, then glove or boot
  const far = clean(new THREE.IcosahedronGeometry(r0, 2));
  const fp = far.attributes.position;
  for (let i = 0; i < fp.count; i++) { fp.setXYZ(i, fp.getX(i), fp.getY(i), fp.getZ(i) * 0.8 + z0); }
  far.computeVertexNormals();
  setAttr(far, () => C('#ffffff'), () => 0);
  parts.push(far);
  const fr = r0 / 0.037; // scale to the limb
  const wc = new THREE.Vector3();
  if (end === 'hand') {
    const h = clean(new THREE.IcosahedronGeometry(0.03 * fr, 2)); const hp = h.attributes.position;
    for (let i = 0; i < hp.count; i++) { wc.fromBufferAttribute(hp, i); hp.setXYZ(i, wc.x * 0.95, wc.y * 0.75, wc.z * 1.35 + z0 - 0.045 * fr); }
    h.computeVertexNormals(); setAttr(h, () => C('#201c19')); parts.push(h);
  } else if (end === 'foot') {
    const h = clean(new THREE.IcosahedronGeometry(0.05 * fr, 2)); const hp = h.attributes.position;
    for (let i = 0; i < hp.count; i++) { wc.fromBufferAttribute(hp, i); hp.setXYZ(i, wc.x * 0.85, wc.y * 0.9, wc.z * 1.7 + z0 - 0.04 * fr); hp.setY(i, hp.getY(i) - 0.02); }
    h.computeVertexNormals(); setAttr(h, () => C('#1a1c20')); parts.push(h);
  }
  const k = r1 * 1.0;
  const face = cap(k, len / 2 - 0.004, seed + 1, 0.13 * k);
  const fpp = face.attributes.position;
  setAttr(face, (i) => { const r = Math.hypot(fpp.getX(i), fpp.getY(i)) / k, n = fbm(fpp.getX(i) * 90 + seed, fpp.getY(i) * 90, 2); if (r > 0.86) return FAT; if (r < 0.1) return MARROW; return lerpC(MUSCLE[(n * 3.99) | 0], MUSCLE[((n * 7) | 0) % 4], 0.5); });
  parts.push(face);
  const bone = boneStub(k * 0.3, len / 2, seed + 2);
  setAttr(bone, (i) => (bone.attributes.position.getZ(i) > len / 2 + k * 0.25 ? BONE : lerpC(BONE, MARROW, 0.5)));
  parts.push(bone);
  return finish(parts);
}

// ---- ruined heads --------------------------------------------------------------------------------
// kind 'face': the face is gone, a raw dark cavity with broken bone and teeth at the rim.
// kind 'top':  an exit wound: the back and crown of the skull torn open, grey-pink inside.
// Same frame as the soldier's head (origin at the neck base, +z forward).
export function wreckHead(kind) {
  const seed = kind === 'face' ? 3 : 9;
  const g = clean(new THREE.IcosahedronGeometry(1, 4));
  const p = g.attributes.position;
  const cen = new THREE.Vector3(0, HEAD_Y - 0.008, -0.004), R = new THREE.Vector3(0.066, 0.088, 0.077);
  const crater = kind === 'face' ? new THREE.Vector3(0, -0.2, 1).normalize() : new THREE.Vector3(0, 0.78, -0.55).normalize();
  const rim0 = kind === 'face' ? 0.92 : 1.0;
  const d = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tx = new THREE.Vector3().crossVectors(crater, up).normalize(), ty = new THREE.Vector3().crossVectors(tx, crater);
  const col = new Float32Array(p.count * 3), wm = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    // jaw taper: narrower and flatter toward the chin
    const low = Math.max(0, -d.y);
    const sx = 1 - low * 0.22, sz = 1 - low * 0.12;
    const ang = Math.atan2(d.dot(ty), d.dot(tx));
    const th = Math.acos(THREE.MathUtils.clamp(d.dot(crater), -1, 1));
    const rim = rim0 * (1 + (fbm(Math.cos(ang) * 2.4 + seed, Math.sin(ang) * 2.4, seed) - 0.5) * 0.6);
    const t = th / rim;
    let k = 1, c = null, m = 0;
    if (t < 1) {
      const depth = (1 - t * t) * (kind === 'face' ? 0.62 : 0.55) + (fbm(d.x * 9, d.y * 9, d.z * 9 + seed) - 0.5) * 0.14 * (1 - t);
      k = 1 - Math.max(0, depth) + (t > 0.86 ? 0.07 * (t - 0.86) / 0.14 : 0); // bowl, with a raised broken lip
      const n = fbm(d.x * 14 + seed, d.y * 14, d.z * 14);
      if (t > 0.9) { c = n > 0.42 ? BONE : lerpC(FAT, MUSCLE[0], 0.5); m = t > 0.97 ? 0.4 : 1; }
      else if (t > 0.8) { c = lerpC(MUSCLE[3], CLOT, 0.5); m = 1; }
      else if (kind === 'face') { c = n > 0.78 && t > 0.35 ? BONE : lerpC(MUSCLE[(n * 3.99) | 0], CLOT, Math.max(0, 0.7 - t)); m = 1; }
      else { c = n > 0.6 ? lerpC(BRAIN[1], BRAIN[0], n) : lerpC(MUSCLE[1], CLOT, 0.35 + (1 - t) * 0.4); m = 1; if (t < 0.3) c = lerpC(CLOT, MUSCLE[3], 0.4 + n * 0.3); }
    } else if (t < 1.18) { c = lerpC(MUSCLE[1], C('#ffffff'), (t - 1) / 0.18); m = 1 - (t - 1) / 0.18; } // blood-soaked edge
    p.setXYZ(i, cen.x + d.x * R.x * sx * k, cen.y + d.y * R.y * k, cen.z + d.z * R.z * sz * k);
    if (c) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; wm[i] = m; }
  }
  g.computeVertexNormals();
  g.setAttribute('aWC', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aWm', new THREE.BufferAttribute(wm, 1));
  const parts = [g];
  // neck
  const neck = clean(new THREE.CylinderGeometry(0.031, 0.037, 0.075, 12, 1, true).translate(0, 0.02, -0.004));
  setAttr(neck, () => C('#ffffff'), () => 0); parts.push(neck);
  return finish(parts);
}
