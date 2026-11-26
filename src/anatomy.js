import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U, SEG_LEN } from './rig.js';
import { mergeByPosition } from './geo.js';
import { loftY, loftZ, lathe, plate, rod, patch, done, sstep, tubePath, ribbon, LOD } from './shapes.js';

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
  if (LOD.q < 1) { w = Math.max(5, Math.round(w * LOD.q)); h = Math.max(3, Math.round(h * LOD.q)); }
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
  if (LOD.q < 1) { radial = Math.max(3, Math.round(radial * 0.6)); seg = Math.max(2, Math.round(seg * LOD.q)); }
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
const WIDTH = [[0, 0.78], [0.12, 0.85], [0.3, 0.77], [0.46, 0.8], [0.64, 0.97], [0.8, 1.04], [0.94, 0.96], [1, 0.8]];
const DEPTH = [[0, 0.86], [0.15, 0.92], [0.4, 0.82], [0.62, 0.95], [0.82, 1], [1, 0.84]];
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
  return done(loftZ(all, { n, p, sub: 1 }, { crease: 0 }), shade);
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
// where a limb's section is at z: [half width x, half depth y, centre shift y]
function limbAt(st, z) { let i = 1; while (i < st.length - 1 && z > st[i][0]) i++; const a = st[i - 1], b = st[i], k = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0]))); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, (a[3] || 0) + ((b[3] || 0) - (a[3] || 0)) * k]; }
// raised piping down the side of a limb (a seam), sunk into the cloth so it can't float
function seam(st, z0, z1, side, shade = 0.62, w = 0.0065) {
  const pts = [], ups = [];
  for (let i = 0; i <= 6; i++) { const z = z0 + (z1 - z0) * i / 6, [rx, , cy] = limbAt(st, z); pts.push([side * (rx - 0.0004), cy, z]); ups.push([side, 0, 0]); }
  return done(ribbon(pts, w, 0.0045, ups, { seg: 10, edge: 0.7 }), shade);
}
// a stitched hem: a thin raised ring round the limb at z
function hem(st, z, shade = 0.5) {
  const [rx, ry, cy] = limbAt(st, z);
  return done(loftZ([{ t: z - 0.0035, rx: rx + 0.0003, ry: ry + 0.0003, cy }, { t: z - 0.002, rx: rx + 0.0018, ry: ry + 0.0018, cy }, { t: z + 0.002, rx: rx + 0.0018, ry: ry + 0.0018, cy }, { t: z + 0.0035, rx: rx + 0.0003, ry: ry + 0.0003, cy }], { n: 12 }, { crease: 30 }), shade);
}
const TH = [[-0.1, 0.058, 0.061, 0.0], [-0.07, 0.061, 0.067, 0.004], [-0.02, 0.058, 0.064, 0.004], [0.04, 0.05, 0.054, 0.002], [0.08, 0.043, 0.046, 0.0], [0.1, 0.042, 0.044, 0.0]];
const SH = [[-0.1, 0.043, 0.045, 0.0], [-0.07, 0.044, 0.047, 0.0], [-0.03, 0.042, 0.049, -0.004], [0.03, 0.038, 0.042, -0.002], [0.075, 0.0365, 0.038, 0.0], [0.1, 0.0365, 0.038, 0.0]];
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
    for (const sd of [-1, 1]) l.push(seam(TH, -0.075, 0.062, sd));
    l.push(hem(TH, -0.052, 0.55)); // the ring of stitching where the trouser leg is gathered into the hip
  } else if (kind === 'shin') {
    // knee to ankle: kneecap guard over the joint, calf behind, a greave down the front, trouser bottom at the boot
    l.push(limbSolid(SH, { shade: (x, y, z) => 0.82 + 0.18 * sstep(-0.1, -0.06, z) }));
    l.push(cupY([[0, 0.0], [0.033, 0.0], [0.038, 0.006], [0.034, 0.014], [0.021, 0.021], [0, 0.023]], { n: 10, sx: 1, sz: 1.15, shade: 0.4, pos: [0, 0.03, -0.098] }));
    l.push(wrapLimb(SH, -0.04, 0.078, taper(-0.04, 0.078, 1.0, 0.62), { thick: 0.008, shade: 0.52, rows: 6 }));
    l.push(wrapLimb(SH, 0.066, 0.092, () => [-2.6, 2.6], { thick: 0.0045, bevel: 0.002, shade: 0.34, cols: 12, rows: 2, bulge: 0 })); // ankle strap
    for (const sd of [-1, 1]) l.push(seam(SH, -0.03, 0.062, sd));
    l.push(hem(SH, 0.097, 0.4)); // trouser hem blousing over the boot
  } else if (kind === 'upperArm') {
    // shoulder to elbow: deltoid and biceps, a guard plate on top and a cuff just above the elbow
    l.push(limbSolid(UA, { n: 9, shade: (x, y, z) => (z > 0.05 && z < 0.068 ? 0.6 : 1) }));
    l.push(wrapLimb(UA, -0.058, 0.034, taper(-0.058, 0.034, 0.8, 0.5), { thick: 0.007, shade: 0.55, bevel: 0.004 }));
    for (const sd of [-1, 1]) l.push(seam(UA, -0.05, 0.085, sd, 0.64, 0.005));
    l.push(hem(UA, 0.07, 0.5)); // elbow-pad stitching
  } else {
    // elbow to wrist: forearm swell with a bracer on the top, a strap and a glove cuff; the elbow guard sits on the outer elbow
    l.push(limbSolid(FA, { n: 9, shade: (x, y, z) => (z > 0.07 ? 0.4 : 1) }));
    l.push(wrapLimb(FA, -0.03, 0.062, taper(-0.03, 0.062, 0.85, 0.6), { thick: 0.0065, shade: 0.5, bevel: 0.0035 }));
    l.push(cupY([[0, 0.0], [0.026, 0.0], [0.031, 0.006], [0.027, 0.013], [0.017, 0.018], [0, 0.02]], { n: 10, sx: 1, sz: 1.2, shade: 0.4, pos: [0, -0.029, -0.096], flipY: true }));
    for (const sd of [-1, 1]) l.push(seam(FA, -0.05, 0.08, sd, 0.64, 0.0045));
    l.push(hem(FA, 0.088, 0.45)); // sleeve cuff
  }
  return merge(l);
}
export const LIMB = {};
for (const k of ['thigh', 'shin', 'upperArm', 'foreArm']) LIMB[k] = limb(k);
// ---- exoskeleton leg frames: armour shells and actuator hubs that ride on a thigh and a shin (same frame as the limbs).
// Drawn only on exo operators, over the trouser leg: a front plate and two side plates wrapped on the limb, a hub at each joint on
// both sides (where the actuators sit) with a glowing core, and a piston rod down each side between the hubs.
const EXO_GLOW = [3.0, 1.3, 0.3];
function hub(z, x, r = 0.03) {
  const sx = Math.sign(x);
  const l = [done(lathe([[0, 0], [r, 0], [r + 0.004, 0.003], [r + 0.004, 0.012], [r - 0.004, 0.016], [0, 0.017]], { n: 12, crease: 40 }), 0.5, { pos: [x - sx * 0.004, 0, z], rot: [0, 0, -sx * Math.PI / 2] })];
  l.push(done(lathe([[0, 0], [r * 0.5, 0], [r * 0.5, 0.0025], [0, 0.0025]], { n: 10 }), EXO_GLOW, { pos: [x + sx * 0.0125, 0, z], rot: [0, 0, -sx * Math.PI / 2] }));
  return l;
}
function exoLimb(kind) {
  const l = [], th = kind === 'thigh', st = th ? TH : SH;
  const a = th ? -0.06 : -0.04, b = th ? 0.052 : 0.076;
  // front plate and the two side plates
  l.push(wrapLimb(st, a, b, taper(a, b, 1.05, 0.7), { thick: 0.012, bevel: 0.006, shade: 0.72, rows: 5, cols: 10, bulge: 0.003, off: 0.012, crease: 80 }));
  for (const sd of [-1, 1]) l.push(wrapLimb(st, a + 0.012, b - 0.01, () => (sd < 0 ? [-2.0, -1.2] : [1.2, 2.0]), { thick: 0.012, bevel: 0.006, shade: 0.4, rows: 5, cols: 6, bulge: 0.002, crease: 80 }));
  if (!th) l.push(wrapLimb(st, -0.04, 0.05, () => [Math.PI - 0.8, Math.PI + 0.8], { thick: 0.012, bevel: 0.006, shade: 0.45, rows: 5, cols: 8, bulge: 0.004, crease: 80 })); // calf guard
  // hubs: hip and knee on the thigh, knee and ankle on the shin; pistons run between them down the outside
  const z0 = -0.095, z1 = th ? 0.095 : 0.092, rr = th ? 0.062 : 0.05;
  for (const sx of [-1, 1]) {
    const x = sx * (rr + 0.005);
    l.push(...hub(z0, x, th ? 0.033 : 0.03), ...hub(z1, x, th ? 0.03 : 0.026));
    l.push(done(rod([x, 0, z0 + 0.01], [x, 0, z1 - 0.01], 0.0075, 0.0075, { n: 6 }), 0.7));
    l.push(done(rod([x, 0, z0 + 0.03], [x, 0, z0 + 0.12], 0.0105, 0.0105, { n: 8 }), 0.42)); // the cylinder body around the piston
  }
  return merge(l);
}
export const EXO_LIMB = { thigh: exoLimb('thigh'), shin: exoLimb('shin') };

export const limbGeo = limb;

// ---- boot: origin on the sole under the middle of the foot, toe toward +z, shaft up to the ankle.
// A laced combat boot built from a lofted upper (heel, arch, vamp, toe), a tread sole with a heel
// block, a padded shaft and cuff, a toe cap and laces. It comes in two pieces that hinge at the
// ball of the foot (U.BALL): the heel-and-shaft, and the toe box, which stays flat on the ground
// while the heel rises at push-off.
export const BOOT_TOP = 0.15;
const BOOT = { leather: [0.095, 0.075, 0.058], cap: [0.125, 0.098, 0.075], cuff: [0.06, 0.05, 0.04], sole: [0.025, 0.024, 0.023], heel: [0.02, 0.019, 0.018], tongue: [0.16, 0.13, 0.1], lace: [0.5, 0.46, 0.38], stitch: [0.26, 0.22, 0.15] };
// stations cut at z0..z1 (keeps the shape exactly: a station is added where the cut falls)
function cutStations(tab, z0, z1) {
  const at = (z) => { let i = 1; while (i < tab.length - 1 && z > tab[i][0]) i++; const a = tab[i - 1], b = tab[i], k = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0]))); return [z, ...a.slice(1).map((v, j) => v + (b[j + 1] - v) * k)]; };
  return [at(z0), ...tab.filter(([z]) => z > z0 + 1e-5 && z < z1 - 1e-5), at(z1)];
}
const UPPER = [[-0.086, 0.03, 0.026, 0.044], [-0.07, 0.036, 0.03, 0.047], [-0.03, 0.039, 0.03, 0.047], [0.02, 0.043, 0.027, 0.043], [0.07, 0.043, 0.023, 0.037], [0.108, 0.038, 0.02, 0.032], [0.128, 0.028, 0.017, 0.029], [0.139, 0.014, 0.012, 0.027], [0.145, 0.004, 0.004, 0.026]];
const SOLE = [[-0.092, 0.032, 0.012, 0.014], [-0.07, 0.04, 0.013, 0.014], [0.02, 0.048, 0.013, 0.014], [0.09, 0.047, 0.013, 0.014], [0.124, 0.036, 0.013, 0.015], [0.146, 0.018, 0.011, 0.016], [0.152, 0.006, 0.006, 0.016]];
const stationsZ = (tab, p) => tab.map(([t, rx, ry, cy]) => ({ t, rx, ry, cy, p }));
export function bootGeo(part = 'foot') {
  const l = [], ZB = U.BALL, toe = part === 'toe';
  const z0 = toe ? ZB : -1, z1 = toe ? 1 : ZB;
  const cut = (tab) => cutStations(tab, Math.max(z0, tab[0][0]), Math.min(z1, tab[tab.length - 1][0]));
  l.push(done(loftZ(stationsZ(cut(UPPER), 3.2), { n: 12 }, { crease: 0 }), BOOT.leather));
  // sole: a slightly wider slab that follows the same plan, with a cleat ridge
  l.push(done(loftZ(stationsZ(cut(SOLE), 3.4), { n: 12 }, { crease: 30 }), BOOT.sole));
  if (!toe) {
    l.push(done(loftZ([{ t: -0.088, rx: 0.031, ry: 0.016, cy: 0.032, p: 3 }, { t: -0.066, rx: 0.037, ry: 0.016, cy: 0.032, p: 3 }, { t: -0.032, rx: 0.036, ry: 0.016, cy: 0.032, p: 3 }, { t: -0.024, rx: 0.03, ry: 0.012, cy: 0.032, p: 3 }], { n: 10 }, { crease: 30 }), BOOT.heel)); // heel block
    // shaft: tapers from the ankle up to a padded cuff, a little long at the back
    const shaft = [[0.045, 0.039, 0.043, -0.012], [0.08, 0.037, 0.04, -0.014], [0.118, 0.036, 0.039, -0.014], [0.14, 0.039, 0.042, -0.012], [0.15, 0.04, 0.043, -0.012], [0.153, 0.036, 0.039, -0.012]];
    l.push(done(loftY(shaft.map(([t, rx, rz, cz]) => ({ t, rx, rz, cz, p: 2.2 })), { n: 12 }, { crease: 0 }), (x, y) => (y > 0.136 ? BOOT.cuff : BOOT.leather)));
    // tongue and laces up the front, then straps round the ankle
    l.push(done(plate([[-0.012, 0], [0.012, 0], [0.01, 0.07], [-0.01, 0.07]], 0.006, { bevel: 0.0015 }), BOOT.tongue, { pos: [0, 0.052, 0.02], rot: [-0.82, 0, 0] }));
    for (let i = 0; i < 4; i++) l.push(done(rod([-0.017, 0.058 + i * 0.0155, 0.035 - i * 0.012], [0.017, 0.058 + i * 0.0155, 0.035 - i * 0.012], 0.0028, 0.0028, { n: 5 }), BOOT.lace, { pos: [0, 0.0, 0.0] }));
    // pull loop on the heel
    l.push(done(tubePath([[-0.007, 0.15, -0.05], [-0.007, 0.162, -0.052], [0.007, 0.162, -0.052], [0.007, 0.15, -0.05]], 0.0025, { n: 4, seg: 8 }), BOOT.stitch));
    // welt stitching along the upper edge of the sole
    for (const sx of [-1, 1]) l.push(done(tubePath(welt(-0.07, 0.065, sx), 0.0014, { n: 3, seg: 10 }), BOOT.stitch));
  } else {
    // toe cap: a lighter domed patch over the toe, a toe bumper on the sole, and the stitched seam behind it
    l.push(done(loftZ([{ t: 0.085, rx: 0.039, ry: 0.0205, cy: 0.0365, p: 3 }, { t: 0.108, rx: 0.0385, ry: 0.0215, cy: 0.0335, p: 3 }, { t: 0.13, rx: 0.029, ry: 0.0185, cy: 0.03, p: 3 }, { t: 0.142, rx: 0.012, ry: 0.013, cy: 0.028, p: 3 }, { t: 0.147, rx: 0.003, ry: 0.004, cy: 0.027, p: 3 }], { n: 10 }, { crease: 0 }), BOOT.cap));
    for (const sx of [-1, 1]) l.push(done(tubePath(welt(0.075, 0.138, sx), 0.0014, { n: 3, seg: 8 }), BOOT.stitch));
    for (let i = 0; i < 3; i++) l.push(done(loftZ([{ t: 0.082 + i * 0.019, rx: 0.045, ry: 0.0035, cy: 0.0125, p: 3 }, { t: 0.087 + i * 0.019, rx: 0.0455, ry: 0.0045, cy: 0.0125, p: 3 }, { t: 0.091 + i * 0.019, rx: 0.045, ry: 0.0035, cy: 0.0125, p: 3 }], { n: 8 }, { crease: 30 }), BOOT.sole)); // tread blocks
  }
  return merge(l);
}
const C_BRASS = [0.62, 0.5, 0.2];
// a path round the foot just above the sole, on the right side and over the toe, between two z positions
function welt(z0, z1, sx = 1, y = 0.026) {
  const out = [], n = 14;
  const at = (z) => { let i = 1; while (i < UPPER.length - 1 && z > UPPER[i][0]) i++; const a = UPPER[i - 1], b = UPPER[i], k = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0]))); return [a[1] + (b[1] - a[1]) * k, a[3] + (b[3] - a[3]) * k]; };
  for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n, [rx] = at(z); out.push([sx * rx * 0.995, y * 0.9, z]); }
  return out;
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
// ---- hands: gloved, with a shaped palm, knuckled fingers and a thumb. Two builds:
//  left 'cup' (the support hand): origin on the bar it holds (a fore-end, handle or tube along z); the
//   palm cradles under it, the fingers wrap up and over the near side, the thumb lies along the top.
//  right 'grip' (the trigger hand): origin on a pistol grip (along y); the palm presses on the grip's
//   right side, three fingers wrap its front, the index finger lies along the receiver by the trigger,
//   and the thumb folds around the back.
// A vertical foregrip turns the left hand a quarter about x (see GRIPS in rig.js).
const GLOVE = [0.085, 0.075, 0.062], GLOVE_DK = [0.05, 0.045, 0.04], CUFF = [0.15, 0.13, 0.1], PAD = [0.035, 0.03, 0.027];
const finger = (path, r, dk = GLOVE_DK) => tubeAlong(path, [r, r * 0.98, r * 0.94, r * 0.88, r * 0.8], 6, 8, dk);
function cupHand() {
  const l = [];
  l.push(bake(blob(0.026, 0.011, 0.03, 12, 8), GLOVE, [0, -0.022, -0.002])); // palm cradling the bar
  l.push(bake(blob(0.012, 0.019, 0.029, 10, 8), GLOVE, [0.026, -0.011, -0.002])); // heel of the hand rising on the outside
  l.push(bake(blob(0.01, 0.013, 0.026, 10, 8), GLOVE, [0.026, 0.004, 0.0])); // back of the hand, knuckles forward
  for (let i = 0; i < 4; i++) {
    const z = -0.0195 + i * 0.013, r = 0.0066 - (i === 3 ? 0.0008 : 0);
    const path = [[0.031, -0.006, z + 0.002], [0.034, 0.008, z + 0.002], [0.024, 0.0205, z + 0.0015], [0.008, 0.0235, z + 0.001], [-0.008, 0.017, z]];
    l.push(...finger(path, r));
    l.push(bake(blob(r * 1.05, r * 1.05, r * 1.05, 6, 5), GLOVE_DK, [0.033, 0.0, z + 0.002])); // knuckle
  }
  // thumb along the near side, tip curling over the top
  l.push(...tubeAlong([[0.004, -0.02, 0.022], [-0.012, -0.012, 0.03], [-0.016, 0.004, 0.03], [-0.008, 0.018, 0.022]], [0.0092, 0.0086, 0.0078, 0.0068], 6, 8, GLOVE_DK));
  l.push(bake(blob(0.0125, 0.0125, 0.012, 8, 6), GLOVE, [0.004, -0.02, 0.018])); // thumb base muscle
  l.push(bake(new THREE.CylinderGeometry(0.0265, 0.0285, 0.026, 14), CUFF, [0.004, -0.014, -0.044], [Math.PI / 2, 0, 0])); // gauntlet cuff
  l.push(bake(new THREE.CylinderGeometry(0.0272, 0.0272, 0.006, 14), PAD, [0.004, -0.014, -0.0315], [Math.PI / 2, 0, 0])); // cuff strap
  return merge(l);
}
// sd: -1 right hand (palm on the grip's right side), +1 left. wrapIndex: the index finger wraps too (foregrip)
function gripHand(sd = -1, wrapIndex = false) {
  const l = [];
  const X = (x) => x * -sd;
  const P = (pts) => pts.map(([x, y, z]) => [X(x), y, z]);
  l.push(bake(blob(0.011, 0.031, 0.024, 10, 8), GLOVE, [X(-0.027), -0.006, -0.006])); // palm flat on the grip's side
  l.push(bake(blob(0.011, 0.02, 0.014, 8, 6), GLOVE, [X(-0.029), -0.012, -0.02])); // heel behind
  // fingers wrap the front of the grip, one above the other, tips ending on its far side
  const ys = [0.0185, 0.006, -0.0065, -0.019];
  for (let i = wrapIndex ? 0 : 1; i < 4; i++) {
    const y = ys[i], r = 0.0066 - (i === 3 ? 0.0008 : 0);
    l.push(...finger(P([[-0.024, y, 0.004], [-0.025, y, 0.016], [-0.014, y, 0.0225], [0.004, y, 0.0225], [0.016, y, 0.014]]), r));
    l.push(bake(blob(r * 1.05, r * 1.05, r * 1.05, 6, 5), GLOVE_DK, [X(-0.026), y, 0.012])); // knuckle
  }
  if (!wrapIndex) {
    // index finger off the grip and along the receiver beside the trigger
    l.push(...finger(P([[-0.024, ys[0], 0.004], [-0.024, ys[0], 0.02], [-0.02, ys[0], 0.036], [-0.016, ys[0] - 0.001, 0.05]]), 0.0066));
    l.push(bake(blob(0.0072, 0.0072, 0.0072, 6, 5), GLOVE_DK, [X(-0.026), ys[0], 0.012]));
  }
  // thumb folds around the back of the grip
  l.push(...tubeAlong(P([[-0.026, 0.01, -0.014], [-0.018, 0.016, -0.026], [0.0, 0.016, -0.026], [0.014, 0.011, -0.012]]), [0.0092, 0.0086, 0.0078, 0.0068], 6, 8, GLOVE_DK));
  l.push(bake(blob(0.0125, 0.012, 0.0125, 8, 6), GLOVE, [X(-0.028), 0.008, -0.016])); // thumb base muscle
  l.push(bake(new THREE.CylinderGeometry(0.0265, 0.0285, 0.026, 14), CUFF, [X(-0.034), -0.03, -0.04], [Math.PI / 2 - 0.5, 0, X(0.1)])); // gauntlet cuff
  return merge(l);
}
// ---- the loose hand: fingers hanging open or half curled, three knuckled segments each, for a hand off the gun
// (a dead soldier's). Same origin as the gun grips; the wrist ball sits where the forearm ends.
const KNUCKLE = [0.1, 0.09, 0.075], STITCH = [0.2, 0.18, 0.14];
// finger heading (rad, in the xy plane, from straight up round toward the palm) for each segment
const OPEN_H = [2.9, 2.75, 2.6, 2.5], GRIP_H = [0.0, 0.8, 1.5, 2.6], STRAIGHT_H = [0.0, 0.03, 0.06, 0.06];
const SEG_LEN_F = [0.018, 0.016, 0.016, 0.018];
function looseHand(side, curl, trigger = false) {
  const l = [];
  const X = (x) => x * side;
  l.push(bake(new RoundedBoxGeometry(0.052, 0.02, 0.058, 1, 0.008), GLOVE, [0, -0.024, 0.0])); // palm cradling the gun
  l.push(bake(new RoundedBoxGeometry(0.02, 0.034, 0.058, 1, 0.008), GLOVE, [X(0.024), -0.012, 0])); // heel of the hand rising on the outside
  // four fingers: knuckle on the outside, over the top of the grip and back to the palm
  for (let i = 0; i < 4; i++) {
    const z = -0.0195 + i * 0.013, rr = 0.0068 - (i === 3 ? 0.0006 : 0);
    const straight = trigger && i === 3;
    let x = 0.03, y = -0.012;
    const path = [[X(x), y, z]], rad = [rr * 1.05];
    for (let j = 0; j < 4; j++) {
      const a = straight ? STRAIGHT_H[j] : OPEN_H[j] + (GRIP_H[j] - OPEN_H[j]) * curl;
      const len = SEG_LEN_F[j] * (straight ? 1.15 : 1);
      x -= Math.sin(a) * len; y += Math.cos(a) * len;
      path.push([X(x), y, z + (j === 0 ? 0 : 0.001)]); rad.push(rr * (1 - 0.06 * (j + 1)));
    }
    l.push(...tubeAlong(path, rad, 5, 4, GLOVE_DK));
    for (let j = 0; j < 3; j++) l.push(bake(blob(rad[j] * 1.22, rad[j] * 1.22, rad[j] * 1.22, 5, 3), KNUCKLE, path[j])); // knuckles
  }
  // thumb: from the palm across to lie along the top of the gun (grip), or out and forward (open)
  const T0 = [[-0.012, -0.02, 0.018], [-0.016, -0.004, 0.03], [-0.008, 0.014, 0.028], [0.002, 0.02, 0.014]];
  const T1 = [[-0.012, -0.02, 0.018], [-0.02, -0.014, 0.036], [-0.026, -0.006, 0.05], [-0.028, 0.0, 0.062]];
  const tp = T0.map((p, k) => p.map((v, a) => T1[k][a] + (v - T1[k][a]) * curl));
  l.push(...tubeAlong(tp.map((p) => [X(p[0]), p[1], p[2]]), [0.0088, 0.008, 0.0075, 0.0068], 5, 5, GLOVE_DK));
  for (let k = 1; k < 3; k++) l.push(bake(blob(0.0088, 0.0088, 0.0088, 5, 3), KNUCKLE, [X(tp[k][0]), tp[k][1], tp[k][2]]));
  // the wrist: a ball joint under the glove cuff, a strap and a stitched hem, so the forearm turns on the hand
  const wz = U.WRIST[2], wy = U.WRIST[1];
  l.push(bake(blob(0.0265, 0.0265, 0.0265, 8, 5), CUFF, [0, wy, wz + 0.002]));
  l.push(bake(new THREE.CylinderGeometry(0.0285, 0.03, 0.034, 10), CUFF, [0, wy, wz + 0.016], [Math.PI / 2, 0, 0]));
  l.push(bake(new THREE.CylinderGeometry(0.0305, 0.0305, 0.007, 10), GLOVE_DK, [0, wy, wz + 0.016], [Math.PI / 2, 0, 0])); // wrist strap
  l.push(bake(new THREE.CylinderGeometry(0.0293, 0.0293, 0.0025, 10), STITCH, [0, wy, wz + 0.001], [Math.PI / 2, 0, 0])); // cuff hem
  l.push(bake(new RoundedBoxGeometry(0.014, 0.0035, 0.01, 1, 0.0015), KNUCKLE, [X(0.0), wy + 0.0307, wz + 0.016])); // strap buckle
  return merge(l);
}
export function handGeos() {
  return { left: cupHand(), right: gripHand(-1), leftGrip: gripHand(1, true), openL: looseHand(1, 0.15), openR: looseHand(-1, 0.15) };
}
export const fistGeo = () => handGeos().left;

// ---- pelvis: origin at the hip line (the hip joints sit at x = +-U.HIP_X), +y up, +z forward.
// Hips, seat and crotch in trouser cloth with a waistband, belt loops and a fly seam; the legs hang
// from it and it turns against the chest. The upper edge hides inside the torso's rounded bottom.
const PELVIS_SLIM = new THREE.Matrix4().makeScale(0.9, 1, 0.94);
export function pelvisGeo() {
  const l = [];
  const st = [
    { t: -0.118, rx: 0.052, rz: 0.05, cz: 0.0 }, { t: -0.1, rx: 0.088, rz: 0.07, cz: -0.004 }, { t: -0.06, rx: 0.12, rz: 0.083, cz: -0.008 }, { t: -0.015, rx: 0.132, rz: 0.088, cz: -0.008 },
    { t: 0.02, rx: 0.12, rz: 0.086, cz: -0.004 }, { t: 0.05, rx: 0.106, rz: 0.08, cz: -0.002 },
  ];
  l.push(done(loftY(st.map((q) => ({ ...q, p: 2.4 })), { n: 20 }, { crease: 0 }), 1));
  // waistband and belt loops
  l.push(done(loftY([{ t: 0.004, rx: 0.123, rz: 0.0885, cz: -0.005, p: 2.4 }, { t: 0.007, rx: 0.1255, rz: 0.0905, cz: -0.005, p: 2.4 }, { t: 0.034, rx: 0.1255, rz: 0.0905, cz: -0.004, p: 2.4 }, { t: 0.037, rx: 0.123, rz: 0.0885, cz: -0.004, p: 2.4 }], { n: 20 }, { crease: 35 }), 0.62));
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.2; l.push(done(plate([[-0.006, 0], [0.006, 0], [0.006, 0.04], [-0.006, 0.04]], 0.004, { bevel: 0.001 }), 0.5, { pos: [Math.sin(a) * 0.1262, 0.0, Math.cos(a) * 0.0912 - 0.005], rot: [0, a, 0] })); }
  // fly and side seams as raised piping
  l.push(done(tubePath([[0, 0.004, 0.0905], [0.0, -0.04, 0.0845], [0.002, -0.085, 0.072]], 0.0017, { n: 4, seg: 10 }), 0.62));
  for (const sx of [-1, 1]) l.push(done(tubePath([[sx * 0.1262, 0.004, -0.004], [sx * 0.1338, -0.04, -0.005], [sx * 0.1208, -0.08, -0.008]], 0.0018, { n: 4, seg: 10 }), 0.62));
  // the trouser block is slimmer through the hips than the first build; the hip joints stay where they are
  for (const g of l) g.applyMatrix4(PELVIS_SLIM);
  // hip joint covers: a rounded cap where each thigh swings in
  for (const sx of [-1, 1]) l.push(bake(blob(0.062, 0.062, 0.064, 12, 8), 1, [sx * U.HIP_X, -0.004, 0]));
  return merge(l);
}

// ---- neck: origin at the base of the neck (the head's origin), +y up. A padded collar standing on the
// shoulders and a gaiter-wrapped neck; it turns halfway between the chest and the head.
export function neckGeo() {
  const l = [];
  const dark = 0.1;
  l.push(done(loftY([
    { t: -0.034, rx: 0.088, rz: 0.062, cz: -0.004, p: 2.4 }, { t: -0.022, rx: 0.07, rz: 0.056, cz: -0.004, p: 2.4 }, { t: -0.006, rx: 0.052, rz: 0.052, cz: -0.003 },
    { t: 0.02, rx: 0.042, rz: 0.044, cz: -0.002 }, { t: 0.05, rx: 0.04, rz: 0.043, cz: 0.0 },
  ], { n: 16 }, { crease: 0 }), (x, y) => (y < -0.012 ? 0.72 : dark)));
  // collar band with stitched edge
  l.push(done(loftY([{ t: -0.02, rx: 0.073, rz: 0.058, cz: -0.004, p: 2.4 }, { t: -0.017, rx: 0.0745, rz: 0.0595, cz: -0.004, p: 2.4 }, { t: -0.008, rx: 0.0555, rz: 0.0545, cz: -0.003, p: 2.4 }], { n: 16 }, { crease: 30 }), 0.5));
  // gaiter folds: soft rings stacked up the neck
  for (const y of [0.0, 0.017, 0.034]) l.push(done(loftY([{ t: y - 0.005, rx: 0.0405, rz: 0.0425 }, { t: y, rx: 0.0455, rz: 0.0475 }, { t: y + 0.005, rx: 0.0405, rz: 0.0425 }], { n: 14 }, { crease: 0 }), dark * 1.2));
  return merge(l);
}

// ---- deltoid: origin at the shoulder joint, +z down the upper arm. A rounded sleeve cap with a seam
// ring, so the shoulder stays closed however the arm swings.
export function deltGeo() {
  const l = [];
  l.push(bake(blob(0.047, 0.05, 0.05, 14, 9), 1, [0, 0.002, 0.002]));
  l.push(done(loftZ([{ t: 0.026, rx: 0.0455, ry: 0.0475, cy: 0.002 }, { t: 0.029, rx: 0.0475, ry: 0.049, cy: 0.002 }, { t: 0.036, rx: 0.0475, ry: 0.049, cy: 0.002 }, { t: 0.039, rx: 0.0445, ry: 0.0465, cy: 0.002 }], { n: 14 }, { crease: 30 }), 0.55)); // sleeve seam
  return merge(l);
}


export { merge as mergeParts, bake as bakePart, blob, tubeAlong };
