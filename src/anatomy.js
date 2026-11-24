import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U, SEG_LEN } from './rig.js';
import { mergeByPosition } from './geo.js';

// The soldier's body, built once and drawn instanced. Every part is a shaped, welded mesh: a
// torso that narrows at the waist and slopes into the neck, a head with a face under a steel
// helmet, tapered limbs with rounded joints, a laced boot and a gloved hand with real fingers.
// Limbs are drawn as two stretched segments joined at the elbow or knee, so nothing hangs loose.
// Everything that is worn (straps, helmet band, kit) is built ON the surface it sits on, using
// the surface functions below, so no piece can hover off the body.
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
// a smooth tube along a path of points with a radius per point, closed with rounded ends
function tubeAlong(points, radii, radial = 6, seg = 10, shade = 1) {
  const pts = points.map((p) => new THREE.Vector3(...p));
  const path = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
  const tube = new THREE.TubeGeometry(path, seg, 1, radial, false);
  const p = tube.attributes.position, per = radial + 1;
  // TubeGeometry builds unit rings; rescale each ring about its centre to the wanted radius
  const c = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    path.getPointAt(i / seg, c);
    const k = lerpRadius(radii, i / seg);
    for (let j = 0; j < per; j++) {
      const n = i * per + j;
      p.setXYZ(n, c.x + (p.getX(n) - c.x) * k, c.y + (p.getY(n) - c.y) * k, c.z + (p.getZ(n) - c.z) * k);
    }
  }
  const out = [bake(tube, shade)];
  // close both ends with a flat cap so every tube is a sealed solid
  const ring = (i) => { const o = []; for (let j = 0; j < radial; j++) o.push(new THREE.Vector3().fromBufferAttribute(p, i * per + j)); return o; };
  for (const [i, sgn] of [[0, -1], [seg, 1]]) {
    const r = ring(i), c = new THREE.Vector3();
    for (const v of r) c.add(v);
    c.multiplyScalar(1 / r.length);
    const tan = path.getTangentAt(i / seg).multiplyScalar(sgn);
    const pos = [], nor = [];
    for (let j = 0; j < radial; j++) {
      let a = c, b = r[j], d = r[(j + 1) % radial];
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
      if (n.dot(tan) < 0) [b, d] = [d, b];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
      for (let k = 0; k < 3; k++) nor.push(tan.x, tan.y, tan.z);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.push(bake(cg, shade));
  }
  return out;
}
function lerpRadius(radii, t) {
  const x = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(x));
  return lerp(radii[i], radii[i + 1], x - i);
}

// ---- torso: pelvis, belly and chest in one welded shell. The wound decals and dents wrap this
// block's rounded-box shell (see wounds.js), so it stays within a couple of centimetres of it.
const WIDTH = [[0, 0.9], [0.14, 0.95], [0.3, 0.91], [0.45, 0.87], [0.62, 0.95], [0.8, 1], [0.94, 0.95], [1, 0.88]];
const DEPTH = [[0, 0.96], [0.15, 1], [0.4, 0.9], [0.62, 0.96], [0.82, 1], [1, 0.9]];
const widthAt = (t) => curve(t, WIDTH), depthAt = (t) => curve(t, DEPTH);
export function torsoGeo(seg = 6) {
  const g = new RoundedBoxGeometry(U.W, U.H, U.D, seg, U.R);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (y + U.H / 2) / U.H;
    const side = Math.abs(x) / (U.W / 2);
    // shoulders slope down toward the neck
    p.setXYZ(i, x * widthAt(t), y - 0.035 * ss(t, 0.78, 1) * side * side, z * depthAt(t));
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const out = mergeByPosition(g);
  out.computeVertexNormals();
  return out;
}

// Where the torso shell is, so worn kit can be mounted flush on it. Body frame (origin at the
// torso centre, +z forward, +x the soldier's left). Each returns the coordinate of the surface
// along its own axis at the given position, or 0 where the shell has rounded away.
const HX = U.W / 2, HY = U.H / 2, HZ = U.D / 2;
function shellAt(a, b, ha, hb, hc) {
  // rounded-box surface along the third axis (half extent hc) at offsets a, b on the other two
  const ea = Math.max(0, Math.abs(a) - (ha - U.R)), eb = Math.max(0, Math.abs(b) - (hb - U.R));
  const rem = U.R * U.R - ea * ea - eb * eb;
  return rem <= 0 ? 0 : hc - U.R + Math.sqrt(rem);
}
export function torsoFront(x, y, back = false) {
  const t = Math.min(1, Math.max(0, (y + HY) / U.H));
  return shellAt(x / widthAt(t), y, HX, HY, HZ) * depthAt(t) * (back ? -1 : 1);
}
export function torsoSide(y, z, right = false) {
  const t = Math.min(1, Math.max(0, (y + HY) / U.H));
  return shellAt(y, z / depthAt(t), HY, HZ, HX) * widthAt(t) * (right ? -1 : 1);
}

// ---- head: skull, jaw, face features and neck. Origin at the base of the neck, +z forward.
export const HEAD_Y = 0.098; // head centre above the neck base
export const HEAD_COLORS = ['#e2b793', '#c99066', '#9c6a48', '#6e4630', '#d9a77f', '#b57d56'].map((c) => new THREE.Color(c));
const SKULL = { c: [0, HEAD_Y, -0.004], r: [0.066, 0.083, 0.076] };
const JAW = { c: [0, HEAD_Y - 0.04, 0.012], r: [0.056, 0.05, 0.06] };
const inside = (E, p) => { let s = 0; for (let k = 0; k < 3; k++) s += ((p[k] - E.c[k]) / E.r[k]) ** 2; return s; };
// the point where a ray from inside the head leaves the union of skull and jaw
export function headSurface(dir, from = [0, HEAD_Y - 0.02, 0.0], push = 0) {
  const d = new THREE.Vector3(...dir).normalize();
  const p = new THREE.Vector3();
  let lo = 0, hi = 0.2;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    p.set(from[0] + d.x * mid, from[1] + d.y * mid, from[2] + d.z * mid);
    if (inside(SKULL, p.toArray()) <= 1 || inside(JAW, p.toArray()) <= 1) lo = mid; else hi = mid;
  }
  return p.set(from[0] + d.x * (lo + push), from[1] + d.y * (lo + push), from[2] + d.z * (lo + push)).toArray();
}
export function headGeo() {
  const l = [];
  const skin = [1, 1, 1];
  l.push(bake(new THREE.CylinderGeometry(0.031, 0.04, 0.085, 12, 1, true), 0.92, [0, 0.015, -0.004])); // neck (its foot is inside the collar)
  l.push(bake(blob(...SKULL.r, 14, 10), skin, SKULL.c)); // skull
  l.push(bake(blob(...JAW.r, 12, 8), skin, JAW.c)); // jaw and cheeks
  l.push(bake(blob(0.026, 0.02, 0.026, 8, 6), skin, [0, HEAD_Y - 0.075, 0.046])); // chin
  l.push(bake(blob(0.013, 0.02, 0.017, 8, 6), skin, [0, HEAD_Y - 0.012, 0.075], [0.35, 0, 0])); // nose
  l.push(bake(blob(0.058, 0.014, 0.022, 10, 6), skin, [0, HEAD_Y + 0.022, 0.056], [0.2, 0, 0])); // brow ridge
  for (const sx of [-1, 1]) {
    l.push(bake(blob(0.008, 0.021, 0.015, 6, 6), 0.96, [sx * 0.067, HEAD_Y - 0.004, -0.004])); // ears
    l.push(bake(blob(0.0125, 0.0085, 0.006, 8, 6), 0.92, [sx * 0.03, HEAD_Y + 0.006, 0.0685])); // eye whites
    l.push(bake(blob(0.0062, 0.0062, 0.0035, 6, 6), 0.07, [sx * 0.03, HEAD_Y + 0.006, 0.0728])); // pupils
    l.push(bake(blob(0.016, 0.003, 0.006, 8, 4), 0.3, [sx * 0.03, HEAD_Y + 0.02, 0.07], [0.1, 0, sx * -0.12])); // brows
  }
  l.push(bake(blob(0.02, 0.0045, 0.008, 8, 4), [0.62, 0.3, 0.27], [0, HEAD_Y - 0.047, 0.067])); // lips
  l.push(bake(blob(0.015, 0.004, 0.006, 8, 4), [0.5, 0.25, 0.22], [0, HEAD_Y - 0.054, 0.066]));
  return merge(l);
}

// steel helmet over the head, with a rolled rim that dips at the back, a painted band and a chin
// strap that runs from the rim down the cheek to a cup under the chin. Same frame as the head.
// The shell sits one centimetre off the skull; the strap is built on the face itself.
export function helmetGeo() {
  const l = [];
  const a = 0.087, b = 0.104, yc = HEAD_Y - 0.002;
  const prof = [];
  for (let th = Math.PI / 2; th > -0.16; th -= 0.2) prof.push(new THREE.Vector2(Math.max(0.0001, a * Math.cos(th)), yc + b * Math.sin(th)));
  const rimY = prof[prof.length - 1].y, rimR = prof[prof.length - 1].x;
  prof.push(new THREE.Vector2(rimR + 0.013, rimY - 0.004)); // the brim flares out a little
  prof.push(new THREE.Vector2(rimR + 0.014, rimY - 0.009));
  prof.push(new THREE.Vector2(rimR + 0.002, rimY - 0.007)); // rolled edge back in
  prof.reverse(); // a lathe faces outward when its profile runs from the bottom up
  const shell = new THREE.LatheGeometry(prof, 20);
  const merged = mergeByPosition(stripToPos(shell));
  const mp = merged.attributes.position, cols = new Float32Array(mp.count * 3);
  for (let i = 0; i < mp.count; i++) {
    let x = mp.getX(i), y = mp.getY(i), z = mp.getZ(i) * 1.1;
    // a darker painted band just above the rim, lighter crown
    const band = ss(y, rimY - 0.002, rimY + 0.006) * (1 - ss(y, rimY + 0.02, rimY + 0.03));
    cols.fill(0.86 - 0.42 * band, i * 3, i * 3 + 3);
    // the rim sits higher over the brow and lower over the nape
    const w = 1 - ss(y, rimY + 0.012, rimY + 0.07);
    const r = Math.hypot(x, z);
    if (r > 1e-4) y += w * (0.036 * (z / r) - 0.004 * (1 - Math.abs(z) / r));
    mp.setXYZ(i, x, y, z - 0.008);
  }
  merged.computeVertexNormals();
  merged.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  l.push(merged.toNonIndexed());
  l.push(bake(blob(0.016, 0.006, 0.016, 8, 4), 0.55, [0, yc + b * 0.995, -0.008])); // top stud
  // chin strap: from the rim beside the ear, across the cheek to the chin cup, hugging the face
  for (const sx of [-1, 1]) {
    const path = [[sx * 0.085, rimY + 0.004, 0.012]];
    for (const [dx, dy, dz] of [[0.9, -0.38, 0.28], [0.62, -0.62, 0.55], [0.3, -0.75, 0.75]]) path.push(headSurface([sx * dx, dy, dz], [0, HEAD_Y - 0.02, 0.0], 0.0018));
    path.push(headSurface([sx * 0.06, -0.8, 0.95], [0, HEAD_Y - 0.02, 0.0], 0.0018));
    l.push(...tubeAlong(path, [0.0034, 0.0032, 0.0032, 0.0032, 0.0032], 6, 12, 0.26));
  }
  const cup = headSurface([0, -0.7, 0.8], [0, HEAD_Y - 0.02, 0.0], 0.001);
  l.push(bake(blob(0.026, 0.0085, 0.02, 10, 6), 0.26, cup, [0.5, 0, 0])); // chin cup
  return merge(l);
}
function stripToPos(g) {
  const n = g.index ? g : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
  return n;
}

// ---- limbs: a tapered tube along z from -len/2 to +len/2 with rounded joints at both ends.
// profile: [t along the limb 0..1, radius, shade]; the first and last radii close as domes.
function limb(keys, len = SEG_LEN, seg = 10) {
  const r0 = keys[0][1], r1 = keys[keys.length - 1][1];
  const rad = (t) => curve(t, keys.map(([k, r]) => [k, r]));
  const shade = (t) => curve(t, keys.map(([k, , c = 1]) => [k, c]));
  const pts = []; // [radius, z, shade]
  for (const th of [0.5, 1.0, Math.PI / 2]) pts.push([r0 * Math.sin(th), -len / 2 - r0 * Math.cos(th), shade(0)]);
  const n = 7;
  for (let i = 1; i < n; i++) { const t = i / n; pts.push([rad(t), -len / 2 + len * t, shade(t)]); }
  for (const th of [Math.PI / 2, 1.0, 0.5]) pts.push([r1 * Math.sin(th), len / 2 + r1 * Math.cos(th), shade(1)]);
  const g = new THREE.LatheGeometry([[0, -len / 2 - r0], ...pts, [0, len / 2 + r1]].map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2);
  const out = mergeByPosition(stripToPos(g));
  out.computeVertexNormals();
  // per-vertex shade by position along the limb
  const p = out.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const t = Math.min(1, Math.max(0, (p.getZ(i) + len / 2) / len)); c.fill(shade(t), i * 3, i * 3 + 3); }
  out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return out;
}
export const LIMB = {
  // thigh: wide at the hip, tapering to the knee
  thigh: limb([[0, 0.057, 1], [0.2, 0.06, 1], [0.7, 0.05, 1], [1, 0.043, 0.88]]),
  // shin: knee pad, calf swell, narrow at the ankle where the boot shaft takes over
  shin: limb([[0, 0.043, 0.8], [0.18, 0.046, 0.8], [0.3, 0.045, 1], [0.6, 0.038, 1], [1, 0.031, 1]]),
  // upper arm: rounded shoulder, sleeve, tapering to the elbow
  upperArm: limb([[0, 0.041, 1], [0.25, 0.04, 1], [0.7, 0.032, 1], [1, 0.029, 0.9]]),
  // forearm: swell below the elbow, down to the wrist, with a darker cuff at the end
  foreArm: limb([[0, 0.029, 0.9], [0.22, 0.032, 1], [0.65, 0.025, 1], [0.8, 0.0225, 1], [0.86, 0.0255, 0.5], [1, 0.0245, 0.45]]),
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
  l.push(bake(mergeByPosition(stripAttrs(up)), [0.105, 0.088, 0.07]));
  // sole and heel block
  const sole = profileSolid([[-0.08, 0.004], [0.13, 0.004], [0.136, 0.016], [0.13, 0.028], [-0.08, 0.028]], 0.056, 0.004);
  const sp = sole.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setX(i, sp.getX(i) * curve(sp.getZ(i), [[-0.08, 0.86], [-0.02, 0.94], [0.07, 1.06], [0.13, 0.8]]));
  l.push(bake(mergeByPosition(stripAttrs(sole)), 0.03));
  l.push(bake(new THREE.BoxGeometry(0.07, 0.03, 0.04), 0.04, [0, 0.02, -0.06])); // heel
  // laces up the tongue and a padded cuff round the ankle
  for (let i = 0; i < 4; i++) l.push(bake(new THREE.BoxGeometry(0.044, 0.005, 0.01), 0.5, [0, 0.082 + i * 0.016, 0.03 + i * 0.001 - i * 0.002], [-0.5, 0, 0]));
  l.push(bake(blob(0.04, 0.012, 0.05, 10, 6), 0.14, [0, BOOT_TOP - 0.004, -0.004]));
  const out = merge(l);
  out.computeVertexNormals();
  return out;
}
function stripAttrs(g) {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
  return n;
}

// ---- hand: a gloved fist with a palm, four fingers in two knuckled segments and a thumb. Origin
// where the gun is held; the palm cradles under it and the fingers wrap up and over the near side.
// side +1 is the left hand (+x, the support hand), -1 the right.
const GLOVE = [0.085, 0.075, 0.062], GLOVE_DK = [0.05, 0.045, 0.04], CUFF = [0.15, 0.13, 0.1];
function handBuild(side) {
  const l = [];
  const X = (x) => x * side;
  l.push(bake(new RoundedBoxGeometry(0.052, 0.02, 0.058, 1, 0.008), GLOVE, [0, -0.024, 0.0])); // palm cradling the gun
  l.push(bake(new RoundedBoxGeometry(0.02, 0.034, 0.058, 1, 0.008), GLOVE, [X(0.024), -0.012, 0])); // heel of the hand rising on the outside
  // four fingers: knuckle on the outside, over the top of the grip and back to the palm
  for (let i = 0; i < 4; i++) {
    const z = -0.0195 + i * 0.013, rr = 0.0068 - (i === 3 ? 0.0006 : 0);
    const path = [[X(0.03), -0.012, z], [X(0.031), 0.006, z], [X(0.02), 0.019, z + 0.001], [X(0.004), 0.021, z + 0.001], [X(-0.012), 0.012, z]];
    l.push(...tubeAlong(path, [rr, rr, rr * 0.95, rr * 0.9, rr * 0.82], 5, 5, GLOVE_DK));
  }
  // thumb folds across from the palm to lie along the top of the gun
  l.push(...tubeAlong([[X(-0.012), -0.02, 0.018], [X(-0.016), -0.004, 0.03], [X(-0.008), 0.014, 0.028], [X(0.002), 0.02, 0.014]], [0.0088, 0.008, 0.0075, 0.0068], 5, 5, GLOVE_DK));
  // gauntlet cuff where the glove meets the sleeve
  l.push(bake(new THREE.CylinderGeometry(0.0285, 0.03, 0.03, 12), CUFF, [0, -0.012, -0.045], [Math.PI / 2, 0, 0]));
  const out = merge(l);
  return out;
}
export function handGeos() {
  return { left: handBuild(1), right: handBuild(-1) };
}
export const fistGeo = () => handGeos().left;

export { merge as mergeParts, bake as bakePart, blob, tubeAlong };
