import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U, SEG_LEN } from './rig.js';
import { mergeByPosition } from './geo.js';
import { loftY, loftZ, lathe, plate, rod, patch, done, sstep } from './shapes.js';

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
const WIDTH = [[0, 0.78], [0.12, 0.88], [0.3, 0.84], [0.46, 0.86], [0.64, 0.97], [0.8, 1], [0.94, 0.94], [1, 0.84]];
const DEPTH = [[0, 0.86], [0.15, 0.95], [0.4, 0.88], [0.62, 0.95], [0.82, 1], [1, 0.88]];
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

// ---- torso surface for worn kit: a point on the shell at angle theta (0 ahead, + toward +x) and
// height y, found by walking out from the axis until the shell is left. gear.js builds belts,
// bands and straps from these so they wrap the body exactly.
function torsoInside(x, y, z) {
  const t = Math.min(1, Math.max(0, (y + HY) / U.H)), w = widthAt(t), d = depthAt(t);
  const qx = Math.abs(x) / w - (HX - U.R), qy = Math.abs(y) - (HY - U.R), qz = Math.abs(z) / d - (HZ - U.R);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
  return out <= U.R;
}
export function torsoRadial(theta, y, out = new THREE.Vector3()) {
  const yy = Math.min(HY - 0.015, Math.max(-HY + 0.015, y));
  const sx = Math.sin(theta), cz = Math.cos(theta);
  let lo = 0, hi = 0.3;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (torsoInside(sx * mid, yy, cz * mid)) lo = mid; else hi = mid; }
  return out.set(sx * lo, y, cz * lo);
}

// a point on the shell in the vertical section at lateral x: phi from straight up (0), toward the
// front (+), found from a centre line at height cy. Returns the point and its outward direction.
export function torsoSection(x, phi, cy = 0.1, out = new THREE.Vector3()) {
  const sy = Math.cos(phi), sz = Math.sin(phi);
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (torsoInside(x, cy + sy * mid, sz * mid)) lo = mid; else hi = mid; }
  return out.set(x, cy + sy * lo, sz * lo);
}

// ---- head: the skull and neck under the headgear. Origin at the base of the neck, +z forward.
// Every class wears a full-face helmet, so only a plain skull, jaw and a gaiter-covered neck are
// modelled here; what you see is the helmet (helmets.js).
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
  const skin = [0.2, 0.19, 0.18]; // a dark balaclava under the headgear
  l.push(bake(blob(...SKULL.r, 10, 7), skin, SKULL.c)); // skull
  l.push(bake(blob(...JAW.r, 9, 6), skin, JAW.c)); // jaw and cheeks
  // neck gaiter: a padded collar from the shoulders up under the helmet, in dark fabric
  l.push(done(loftY([
    { t: -0.012, rx: 0.052, rz: 0.054, cz: -0.004 }, { t: 0.012, rx: 0.044, rz: 0.046, cz: -0.004 }, { t: 0.04, rx: 0.04, rz: 0.043, cz: -0.002 }, { t: 0.062, rx: 0.044, rz: 0.048, cz: 0.0 },
  ], { n: 12 }, { crease: 0 }), 0.1));
  return merge(l);
}
export { helmetGeo, HELMET_KINDS } from './helmets.js';

// ---- limbs: lofted solids along z from -0.1 (the joint nearer the body) to +0.1, with a rounded
// ball at each joint so a bent limb stays continuous. Sections are ellipses (wider one way than
// the other), the swell of muscle sits on the right side of the bone, and the joints carry armour.
// Local +y is the front of a leg and the top of an arm; the outer elbow is -y. The segment is
// stretched along z by its true length when drawn, so keep the details soft.
// station: [z, half-width (x), half-depth (y), centre shift in y]
function limbSolid(st, { n = 10, p = 2.2, shade = 1 } = {}) {
  const stations = st.map(([t, rx, ry, cy = 0, sp]) => ({ t, rx, ry, cy, p: sp }));
  const first = stations[0], last = stations[stations.length - 1];
  const cap = (s, dir) => {
    const r = (s.rx + s.ry) / 2, out = [];
    for (let i = 1; i <= 3; i++) { const a = (i / 3) * Math.PI / 2 * 0.95; out.push({ ...s, t: s.t + dir * r * Math.sin(a), rx: s.rx * Math.cos(a), ry: s.ry * Math.cos(a) }); }
    return out;
  };
  const all = [...cap(first, -1).reverse(), ...stations, ...cap(last, 1)];
  return done(loftZ(all, { n, p }, { crease: 0 }), shade);
}
// small faceted armour cup standing on a limb, axis along +y at pos
function cupY(pts, { n = 8, sx = 1, sz = 1, shade = 0.45, pos, flipY = false }) {
  const g = lathe(pts, { n, crease: 45, sx, sz });
  return done(g, shade, { pos, rot: flipY ? [Math.PI, 0, 0] : [0, 0, 0] });
}
// an armour plate wrapped round a limb: u runs round the limb from the front (+y) toward +x,
// v along z; st is the same station list the limb was lofted from
function wrapLimb(st, z0, z1, range, o = {}) {
  const at = (z) => { let i = 1; while (i < st.length - 1 && z > st[i][0]) i++; const a = st[i - 1], b = st[i], k = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0]))); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, (a[3] || 0) + ((b[3] || 0) - (a[3] || 0)) * k]; };
  const g = patch({
    surf: (u, v) => { const [rx, ry, cy] = at(v); return new THREE.Vector3(rx * Math.sin(u), cy + ry * Math.cos(u), v); },
    v0: z0, v1: z1, range, rows: o.rows || 5, cols: o.cols || 6, off: o.off || 0, thick: o.thick || 0.008, bevel: o.bevel || 0.005, bulge: o.bulge || 0.002, sink: 0.004, uScale: 0.04, edge: 0.4, crease: o.crease || 42, solid: true,
  });
  return done(g, o.shade ?? 0.5);
}
const band = (z, w, k) => 1 - k * (1 - sstep(w, 0, Math.abs(z)));
const TH = [[-0.1, 0.058, 0.061, 0.0], [-0.07, 0.061, 0.067, 0.004], [-0.02, 0.058, 0.064, 0.004], [0.04, 0.05, 0.054, 0.002], [0.08, 0.043, 0.046, 0.0], [0.1, 0.042, 0.044, 0.0]];
const SH = [[-0.1, 0.043, 0.045, 0.0], [-0.07, 0.044, 0.047, 0.0], [-0.03, 0.042, 0.049, -0.004], [0.03, 0.036, 0.04, -0.002], [0.075, 0.033, 0.034, 0.0], [0.1, 0.031, 0.032, 0.0]];
const UA = [[-0.1, 0.04, 0.042, 0.0], [-0.065, 0.043, 0.045, 0.002], [-0.02, 0.038, 0.04, 0.002], [0.04, 0.032, 0.033, 0.0], [0.09, 0.03, 0.031, 0.0], [0.1, 0.03, 0.031, 0.0]];
const FA = [[-0.1, 0.031, 0.032, 0.0], [-0.066, 0.034, 0.035, 0.0], [-0.02, 0.029, 0.03, 0.0], [0.04, 0.0245, 0.0255, 0.0], [0.085, 0.0225, 0.023, 0.0], [0.1, 0.0235, 0.024, 0.0]];
const taper = (z0, z1, wTop, wBot) => (z) => { const w = wBot + (wTop - wBot) * sstep(z1, z0, z); return [-w, w]; };
function limb(kind) {
  const l = [];
  if (kind === 'thigh') {
    // hip to knee: quadriceps in front, hamstring behind, a strap above the knee and a guard plate down the front
    l.push(limbSolid(TH, { shade: (x, y, z) => (z > 0.066 && z < 0.082 ? 0.6 : 1) }));
    l.push(wrapLimb(TH, -0.062, 0.05, taper(-0.062, 0.05, 0.85, 0.55), { thick: 0.009, shade: 0.55, rows: 6 }));
    l.push(wrapLimb(TH, 0.066, 0.082, () => [-2.6, 2.6], { thick: 0.004, bevel: 0.002, shade: 0.5, cols: 12, rows: 2, bulge: 0 })); // knee strap
  } else if (kind === 'shin') {
    // knee to ankle: kneecap guard over the joint, calf behind, a greave down the front, trouser bottom at the boot
    l.push(limbSolid(SH, { shade: (x, y, z) => 0.82 + 0.18 * sstep(-0.1, -0.06, z) }));
    l.push(cupY([[0, 0.0], [0.033, 0.0], [0.038, 0.006], [0.034, 0.014], [0.021, 0.021], [0, 0.023]], { n: 10, sx: 1, sz: 1.15, shade: 0.4, pos: [0, 0.03, -0.098] }));
    l.push(wrapLimb(SH, -0.04, 0.078, taper(-0.04, 0.078, 1.0, 0.62), { thick: 0.008, shade: 0.52, rows: 6 }));
    l.push(wrapLimb(SH, 0.066, 0.092, () => [-2.6, 2.6], { thick: 0.0045, bevel: 0.002, shade: 0.34, cols: 12, rows: 2, bulge: 0 })); // ankle strap
  } else if (kind === 'upperArm') {
    // shoulder to elbow: deltoid and biceps, a guard plate on top and a cuff just above the elbow
    l.push(limbSolid(UA, { n: 9, shade: (x, y, z) => (z > 0.05 && z < 0.068 ? 0.6 : 1) }));
    l.push(wrapLimb(UA, -0.058, 0.034, taper(-0.058, 0.034, 0.8, 0.5), { thick: 0.007, shade: 0.55, bevel: 0.004 }));
  } else {
    // elbow to wrist: forearm swell with a bracer on the top, a strap and a glove cuff; the elbow guard sits on the outer elbow
    l.push(limbSolid(FA, { n: 9, shade: (x, y, z) => (z > 0.07 ? 0.4 : 1) }));
    l.push(wrapLimb(FA, -0.03, 0.062, taper(-0.03, 0.062, 0.85, 0.6), { thick: 0.0065, shade: 0.5, bevel: 0.0035 }));
    l.push(cupY([[0, 0.0], [0.026, 0.0], [0.031, 0.006], [0.027, 0.013], [0.017, 0.018], [0, 0.02]], { n: 10, sx: 1, sz: 1.2, shade: 0.4, pos: [0, -0.029, -0.096], flipY: true }));
  }
  return merge(l);
}
export const LIMB = {};
for (const k of ['thigh', 'shin', 'upperArm', 'foreArm']) LIMB[k] = limb(k);

// ---- boot: origin on the sole under the middle of the foot, toe toward +z, shaft up to the ankle.
// A laced combat boot built from a lofted upper (heel, arch, vamp, toe), a tread sole with a heel
// block, a padded shaft and cuff, a toe cap and laces.
export const BOOT_TOP = 0.15;
const BOOT = { leather: [0.17, 0.135, 0.1], cap: [0.2, 0.158, 0.115], cuff: [0.09, 0.075, 0.06], sole: [0.045, 0.042, 0.04], heel: [0.035, 0.033, 0.03], tongue: [0.24, 0.2, 0.15], lace: [0.5, 0.46, 0.38] };
export function bootGeo() {
  const l = [];
  const upper = [[-0.086, 0.03, 0.026, 0.044], [-0.07, 0.036, 0.03, 0.047], [-0.03, 0.039, 0.03, 0.047], [0.02, 0.043, 0.027, 0.043], [0.07, 0.043, 0.023, 0.037], [0.108, 0.038, 0.02, 0.032], [0.128, 0.028, 0.017, 0.029], [0.139, 0.014, 0.012, 0.027], [0.145, 0.004, 0.004, 0.026]];
  l.push(done(loftZ(upper.map(([t, rx, ry, cy]) => ({ t, rx, ry, cy, p: 3.2 })), { n: 12 }, { crease: 0 }), BOOT.leather));
  // sole: a slightly wider slab that follows the same plan, with a cleat ridge
  const sole = [[-0.092, 0.032, 0.012, 0.014], [-0.07, 0.04, 0.013, 0.014], [0.02, 0.048, 0.013, 0.014], [0.09, 0.047, 0.013, 0.014], [0.124, 0.036, 0.013, 0.015], [0.146, 0.018, 0.011, 0.016], [0.152, 0.006, 0.006, 0.016]];
  l.push(done(loftZ(sole.map(([t, rx, ry, cy]) => ({ t, rx, ry, cy, p: 3.4 })), { n: 12 }, { crease: 30 }), BOOT.sole));
  l.push(done(loftZ([{ t: -0.088, rx: 0.031, ry: 0.016, cy: 0.032, p: 3 }, { t: -0.066, rx: 0.037, ry: 0.016, cy: 0.032, p: 3 }, { t: -0.032, rx: 0.036, ry: 0.016, cy: 0.032, p: 3 }, { t: -0.024, rx: 0.03, ry: 0.012, cy: 0.032, p: 3 }], { n: 10 }, { crease: 30 }), BOOT.heel)); // heel block
  // toe cap: a lighter domed patch over the toe
  l.push(done(loftZ([{ t: 0.085, rx: 0.039, ry: 0.0205, cy: 0.0365, p: 3 }, { t: 0.108, rx: 0.0385, ry: 0.0215, cy: 0.0335, p: 3 }, { t: 0.13, rx: 0.029, ry: 0.0185, cy: 0.03, p: 3 }, { t: 0.142, rx: 0.012, ry: 0.013, cy: 0.028, p: 3 }, { t: 0.147, rx: 0.003, ry: 0.004, cy: 0.027, p: 3 }], { n: 10 }, { crease: 0 }), BOOT.cap));
  // shaft: tapers from the ankle up to a padded cuff, a little long at the back
  const shaft = [[0.045, 0.039, 0.043, -0.012], [0.08, 0.037, 0.04, -0.014], [0.118, 0.036, 0.039, -0.014], [0.14, 0.039, 0.042, -0.012], [0.15, 0.04, 0.043, -0.012], [0.153, 0.036, 0.039, -0.012]];
  l.push(done(loftY(shaft.map(([t, rx, rz, cz]) => ({ t, rx, rz, cz, p: 2.2 })), { n: 12 }, { crease: 0 }), (x, y) => (y > 0.136 ? BOOT.cuff : BOOT.leather)));
  // tongue and laces up the front, then straps round the ankle
  l.push(done(plate([[-0.012, 0], [0.012, 0], [0.01, 0.07], [-0.01, 0.07]], 0.006, { bevel: 0.0015 }), BOOT.tongue, { pos: [0, 0.052, 0.02], rot: [-0.82, 0, 0] }));
  for (let i = 0; i < 4; i++) l.push(done(rod([-0.017, 0.058 + i * 0.0155, 0.035 - i * 0.012], [0.017, 0.058 + i * 0.0155, 0.035 - i * 0.012], 0.0028, 0.0028, { n: 5 }), BOOT.lace, { pos: [0, 0.0, 0.0] }));
  return merge(l);
}
function stripAttrs(g) {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
  return n;
}

// ---- pack: a rucksack body with a curved back panel, tapered base and a domed lid. Origin at its centre; it fits the PACK box
// the kit mounts onto (flat back, top and sides over most of each face).
export function packGeo() {
  const [w, h, d] = U.PACK;
  const hw = w / 2, hd = d / 2, hh = h / 2;
  const st = [
    { t: -hh, rx: hw - 0.022, rz: hd - 0.012, cz: 0.0 }, { t: -hh + 0.012, rx: hw - 0.004, rz: hd - 0.002, cz: 0.0 }, { t: -hh + 0.05, rx: hw, rz: hd, cz: 0.0 }, { t: hh - 0.05, rx: hw, rz: hd, cz: 0.0 },
    { t: hh - 0.012, rx: hw - 0.006, rz: hd - 0.004, cz: 0.0 }, { t: hh, rx: hw - 0.022, rz: hd - 0.014, cz: 0.0 },
  ];
  return done(loftY(st, { n: 20, p: 5 }, { crease: 38 }), 1);
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
