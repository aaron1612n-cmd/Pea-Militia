import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U, SEG_LEN } from './rig.js';
import { mergeByPosition } from './geo.js';

// The soldier's body, built once and drawn instanced. Every part is a shaped, welded mesh: a
// torso that narrows at the waist and slopes into the neck, a head with a face under a steel
// helmet, tapered limbs with rounded joints, a laced boot and a gloved fist. Limbs are drawn as
// two stretched segments joined at the elbow or knee, so nothing hangs loose.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// merge-ready copy: position + normal + colour, no index
function bake(geo, shade = 1, at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  _m.compose(_v.set(...at), _q.setFromEuler(_e.set(...rot)), _s.set(...scale));
  g.applyMatrix4(_m);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  const col = Array.isArray(shade) ? shade : [shade, shade, shade];
  for (let i = 0; i < n; i++) c.set(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const merge = (list) => mergeGeometries(list, false);
// smooth ellipsoid, welded so shading has no seam
function blob(rx, ry, rz, w = 14, h = 10) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const out = mergeByPosition(g);
  out.computeVertexNormals();
  return out;
}
const ss = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
// piecewise-smooth curve through [t, value] keys
function curve(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], ss(t, keys[i - 1][0], keys[i][0]));
  return keys[keys.length - 1][1];
}

// ---- torso: pelvis, belly and chest in one welded shell. The wound decals and dents wrap this
// block's rounded-box shell (see wounds.js), so it stays within a couple of centimetres of it.
const WIDTH = [[0, 0.9], [0.22, 0.92], [0.42, 0.86], [0.72, 0.98], [0.86, 1], [1, 0.9]];
const DEPTH = [[0, 0.95], [0.4, 0.9], [0.78, 1], [1, 0.92]];
export function torsoGeo(seg = 6) {
  const g = new RoundedBoxGeometry(U.W, U.H, U.D, seg, U.R);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (y + U.H / 2) / U.H;
    const side = Math.abs(x) / (U.W / 2);
    // shoulders slope down toward the neck
    p.setXYZ(i, x * curve(t, WIDTH), y - 0.035 * ss(t, 0.78, 1) * side * side, z * curve(t, DEPTH));
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const out = mergeByPosition(g);
  out.computeVertexNormals();
  return out;
}

// ---- head: skull, jaw, face features and neck. Origin at the base of the neck, +z forward.
export const HEAD_Y = 0.098; // head centre above the neck base
export const HEAD_COLORS = ['#e2b793', '#c99066', '#9c6a48', '#6e4630', '#d9a77f', '#b57d56'].map((c) => new THREE.Color(c));
export function headGeo() {
  const l = [];
  const skin = [1, 1, 1];
  l.push(bake(new THREE.CylinderGeometry(0.031, 0.037, 0.075, 12, 1, true), 0.92, [0, 0.02, -0.004])); // neck
  l.push(bake(blob(0.066, 0.083, 0.076, 16, 12), skin, [0, HEAD_Y, -0.004])); // skull
  l.push(bake(blob(0.056, 0.05, 0.06, 14, 10), skin, [0, HEAD_Y - 0.04, 0.012])); // jaw and cheeks
  l.push(bake(blob(0.026, 0.02, 0.026, 8, 6), skin, [0, HEAD_Y - 0.075, 0.046])); // chin
  l.push(bake(blob(0.013, 0.02, 0.017, 8, 6), skin, [0, HEAD_Y - 0.012, 0.075], [0.35, 0, 0])); // nose
  l.push(bake(blob(0.058, 0.014, 0.022, 10, 6), skin, [0, HEAD_Y + 0.022, 0.056], [0.2, 0, 0])); // brow ridge
  for (const sx of [-1, 1]) {
    l.push(bake(blob(0.007, 0.02, 0.015, 6, 6), 0.96, [sx * 0.068, HEAD_Y - 0.004, -0.004])); // ears
    l.push(bake(blob(0.011, 0.007, 0.006, 8, 6), 0.1, [sx * 0.03, HEAD_Y + 0.006, 0.068])); // eyes
    l.push(bake(blob(0.016, 0.003, 0.006, 8, 4), 0.34, [sx * 0.03, HEAD_Y + 0.02, 0.07], [0.1, 0, sx * -0.12])); // brows
  }
  l.push(bake(blob(0.02, 0.006, 0.008, 8, 4), [0.6, 0.28, 0.26], [0, HEAD_Y - 0.045, 0.066])); // mouth
  return merge(l);
}

// steel helmet over the head, with a brim, a band and a chin strap. Same frame as the head.
export function helmetGeo() {
  const l = [];
  const prof = [[0.0001, 0.2], [0.035, 0.197], [0.065, 0.186], [0.086, 0.166], [0.096, 0.14], [0.1, 0.112], [0.1, 0.092], [0.108, 0.082], [0.118, 0.074], [0.12, 0.068], [0.112, 0.066], [0.098, 0.074]].map(([r, y]) => new THREE.Vector2(r, y));
  const shell = new THREE.LatheGeometry(prof, 20);
  l.push(bake(shell, 0.82, [0, 0, -0.008], [0, 0, 0], [1, 1, 1.1]));
  l.push(bake(new THREE.TorusGeometry(0.1, 0.007, 6, 20), 0.45, [0, 0.106, -0.008], [Math.PI / 2, 0, 0], [1, 1.1, 1])); // band
  l.push(bake(blob(0.02, 0.008, 0.02, 8, 4), 0.55, [0, 0.2, -0.008])); // top stud
  for (const sx of [-1, 1]) {
    l.push(bake(new THREE.BoxGeometry(0.008, 0.075, 0.016), 0.28, [sx * 0.068, 0.036, 0.04], [0, 0, sx * -0.12])); // strap
    l.push(bake(new THREE.BoxGeometry(0.008, 0.05, 0.016), 0.28, [sx * 0.052, 0.012, 0.062], [0, 0, sx * 0.9])); // strap to the chin
  }
  l.push(bake(blob(0.032, 0.008, 0.026, 8, 4), 0.28, [0, HEAD_Y - 0.092, 0.05])); // chin cup
  return merge(l);
}

// ---- limbs: a tapered tube along z from -len/2 to +len/2 with rounded joints at both ends
function limb(r0, r1, len = SEG_LEN, mid = 1.07) {
  const a = [[0, -len / 2 - r0]];
  for (const th of [0.4, 0.8, 1.2, Math.PI / 2]) a.push([r0 * Math.sin(th), -len / 2 - r0 * Math.cos(th)]);
  a.push([lerp(r0, r1, 0.35) * mid, -len * 0.15], [lerp(r0, r1, 0.7) * mid * 0.98, len * 0.2]);
  for (const th of [Math.PI / 2, 1.2, 0.8, 0.4]) a.push([r1 * Math.sin(th), len / 2 + r1 * Math.cos(th)]);
  a.push([0, len / 2 + r1]);
  const g = new THREE.LatheGeometry(a.map(([r, z]) => new THREE.Vector2(r, z)), 12);
  g.rotateX(Math.PI / 2);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const out = mergeByPosition(g);
  out.computeVertexNormals();
  return out;
}
export const LIMB = {
  thigh: limb(0.054, 0.042),
  shin: limb(0.042, 0.03, SEG_LEN, 1.05),
  upperArm: limb(0.037, 0.03),
  foreArm: limb(0.03, 0.023, SEG_LEN, 1.1),
};

// ---- boot: origin on the sole under the middle of the foot, toe toward +z, shaft up to the ankle
function profileSolid(pts, depth, bevel) {
  const s = new THREE.Shape();
  s.moveTo(...pts[0]);
  for (let i = 1; i < pts.length; i++) s.lineTo(...pts[i]);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}
export const BOOT_TOP = 0.15;
export function bootGeo() {
  const l = [];
  // upper: heel, arch, vamp, toe cap and shaft in one side silhouette, tapered across the width
  const up = profileSolid([[-0.074, 0.02], [0.112, 0.02], [0.128, 0.03], [0.122, 0.052], [0.085, 0.066], [0.045, 0.078], [0.036, BOOT_TOP], [-0.046, BOOT_TOP], [-0.056, 0.1], [-0.076, 0.052]], 0.05, 0.012);
  const p = up.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i);
    const w = curve(z, [[-0.08, 0.84], [-0.02, 0.92], [0.07, 1.04], [0.13, 0.78]]) * (y > 0.09 ? 0.92 : 1);
    p.setX(i, p.getX(i) * w);
  }
  l.push(bake(mergeByPosition(stripAttrs(up)), [0.085, 0.07, 0.055]));
  // sole and heel block
  const sole = profileSolid([[-0.08, 0.004], [0.13, 0.004], [0.136, 0.016], [0.13, 0.028], [-0.08, 0.028]], 0.056, 0.004);
  const sp = sole.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setX(i, sp.getX(i) * curve(sp.getZ(i), [[-0.08, 0.86], [-0.02, 0.94], [0.07, 1.06], [0.13, 0.8]]));
  l.push(bake(mergeByPosition(stripAttrs(sole)), 0.025));
  l.push(bake(new THREE.BoxGeometry(0.07, 0.03, 0.04), 0.035, [0, 0.02, -0.06])); // heel
  // laces and a turned-down cuff
  for (let i = 0; i < 4; i++) l.push(bake(new THREE.BoxGeometry(0.044, 0.005, 0.01), 0.45, [0, 0.082 + i * 0.016, 0.03 + i * 0.001 - i * 0.002], [-0.5, 0, 0]));
  l.push(bake(blob(0.04, 0.012, 0.05, 10, 6), 0.12, [0, BOOT_TOP - 0.004, -0.004]));
  const out = merge(l);
  out.computeVertexNormals();
  return out;
}
function stripAttrs(g) {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
  return n;
}

// ---- fist: palm and curled fingers with a thumb along the top and a cuff. Origin at the palm.
export function fistGeo() {
  const l = [];
  const glove = [0.07, 0.06, 0.05];
  l.push(bake(new RoundedBoxGeometry(0.052, 0.046, 0.062, 3, 0.02), glove));
  for (let i = 0; i < 4; i++) l.push(bake(blob(0.0125, 0.012, 0.03, 8, 6), 0.07, [-0.0195 + i * 0.013, -0.01, 0.005], [0.9, 0, 0])); // curled fingers
  l.push(bake(blob(0.012, 0.012, 0.03, 8, 6), 0.09, [0.0, 0.026, 0.01], [-0.3, 0.2, 0])); // thumb
  l.push(bake(new THREE.CylinderGeometry(0.03, 0.032, 0.026, 10), [0.14, 0.12, 0.1], [0, 0, -0.04], [Math.PI / 2, 0, 0])); // cuff
  const out = merge(l);
  out.computeVertexNormals();
  return out;
}

export { merge as mergeParts, bake as bakePart, blob };
