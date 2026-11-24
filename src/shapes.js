import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shape toolkit for the soldier's body and kit. Nothing here is a box: everything is a lofted
// solid (rings swept along an axis), a patch grown on a surface (plates, pouches and straps that
// follow the shell they sit on), or a tube along a path. Every builder returns a plain geometry
// (position + normal + colour, not indexed) ready for mergeGeometries.
const V = THREE.Vector3;
const _a = new V(), _b = new V(), _c = new V(), _n = new V();
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-9)); return t * t * (3 - 2 * t); };
const sgnpow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// ---- colour and finishing -----------------------------------------------------------------
// shade: a number, [r, g, b] or a function of position returning either
export function paint(g, shade = 1) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  const f = typeof shade === 'function' ? shade : null;
  const col = Array.isArray(shade) ? shade : [shade, shade, shade];
  for (let i = 0; i < p.count; i++) {
    let s = f ? f(p.getX(i), p.getY(i), p.getZ(i)) : col;
    if (!Array.isArray(s)) s = [s, s, s];
    c[i * 3] = s[0]; c[i * 3 + 1] = s[1]; c[i * 3 + 2] = s[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// signed volume of an indexed or plain triangle soup; negative means the faces point inward
function volume(g) {
  const p = g.attributes.position, idx = g.index ? g.index.array : null;
  const n = idx ? idx.length : p.count;
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx[i] : i, ib = idx ? idx[i + 1] : i + 1, ic = idx ? idx[i + 2] : i + 2;
    _a.fromBufferAttribute(p, ia); _b.fromBufferAttribute(p, ib); _c.fromBufferAttribute(p, ic);
    v += _a.dot(_b.cross(_c)) / 6;
  }
  return v;
}
function flip(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  return g;
}
// closed indexed geometry from raw arrays: faces outward, normals smooth (or creased)
function solid(pos, idx, { crease = 0, smooth = true } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (volume(g) < 0) flip(g);
  return shadeGeo(g, { crease, smooth });
}
function shadeGeo(g, { crease = 0, smooth = true }) {
  if (crease > 0) return toCreasedNormals(g, crease * Math.PI / 180);
  if (smooth) { g.computeVertexNormals(); return g.toNonIndexed(); }
  const f = g.toNonIndexed(); f.computeVertexNormals(); return f;
}
// final bake: strip to position + normal + colour, optionally move it
export function done(g, shade, at) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (at) xf(g, at);
  if (shade !== undefined && shade !== null) paint(g, shade);
  return g;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V(), _p = new V();
// move/rotate/scale in place; rotation is an Euler triple (XYZ) or a quaternion
export function xf(g, { pos = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
  if (rot.isQuaternion) _q.copy(rot); else _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
  if (Array.isArray(scale)) _s.set(...scale); else _s.set(scale, scale, scale);
  _m.compose(_p.set(...pos), _q, _s);
  g.applyMatrix4(_m);
  return g;
}
// orient a piece built along +y so that its axis points along dir, then put it at pos
export function aim(g, pos, dir, roll = 0) {
  _q.setFromUnitVectors(new V(0, 1, 0), new V(...dir).normalize());
  if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new V(0, 1, 0), roll));
  return xf(g, { pos, rot: _q.clone() });
}
export const merge = (list) => mergeGeometries(list, false);

// ---- rings and lofts ----------------------------------------------------------------------
// A superellipse ring (p = 2 ellipse, larger p squarer) perpendicular to an axis. Point j sits at
// angle rot + j/n of a turn; `bump(a)` scales the radius at that angle for ridges and notches.
function ring(n, p, rot, bump, f) {
  const out = [], e = 2 / p;
  for (let j = 0; j < n; j++) {
    const a = rot + (j / n) * Math.PI * 2;
    const k = bump ? bump(a) : 1;
    out.push(f(sgnpow(Math.sin(a), e) * k, sgnpow(Math.cos(a), e) * k));
  }
  return out;
}
// ring around the y axis: x from sin, z from cos
export const ringY = (y, rx, rz, { cx = 0, cz = 0, n = 12, p = 2, rot = 0, bump } = {}) => ring(n, p, rot, bump, (s, c) => new V(cx + rx * s, y, cz + rz * c));
// ring around the z axis: x from sin, y from cos
export const ringZ = (z, rx, ry, { cx = 0, cy = 0, n = 12, p = 2, rot = 0, bump } = {}) => ring(n, p, rot, bump, (s, c) => new V(cx + rx * s, cy + ry * c, z));
// ring around the x axis: z from sin, y from cos
export const ringX = (x, rz, ry, { cz = 0, cy = 0, n = 12, p = 2, rot = 0, bump } = {}) => ring(n, p, rot, bump, (s, c) => new V(x, cy + ry * c, cz + rz * s));

// Solid from rings that all have the same point count. Ends are closed with flat caps.
export function loft(rings, { cap0 = true, cap1 = true, crease = 0, smooth = true } = {}) {
  const n = rings[0].length, pos = [], idx = [];
  for (const r of rings) for (const q of r) pos.push(q.x, q.y, q.z);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + (j + 1) % n, c = a + n, d = b + n;
      idx.push(a, b, c, b, d, c);
    }
  }
  const capAt = (r, rev) => {
    const base = pos.length / 3, c = new V();
    for (const q of r) c.add(q);
    c.multiplyScalar(1 / r.length);
    for (const q of r) pos.push(q.x, q.y, q.z);
    pos.push(c.x, c.y, c.z);
    for (let j = 0; j < n; j++) { const a = base + j, b = base + (j + 1) % n; if (rev) idx.push(base + n, b, a); else idx.push(base + n, a, b); }
  };
  if (cap0) capAt(rings[0], false);
  if (cap1) capAt(rings[rings.length - 1], true);
  return solid(pos, idx, { crease, smooth });
}

// Stations along an axis → rings. kind 'y' (ringY), 'z' (ringZ) or 'x' (ringX). Each station:
// { t (position on the axis), rx, rz|ry, cx, cz|cy, p }. `opts` fills in the ring options.
export function loftAxis(kind, stations, opts = {}, lo = {}) {
  const rings = stations.map((s) => {
    const o = { ...opts, cx: s.cx ?? 0, p: s.p ?? opts.p ?? 2, bump: s.bump ?? opts.bump, rot: s.rot ?? opts.rot ?? 0 };
    if (kind === 'y') return ringY(s.t, s.rx, s.rz ?? s.rx, { ...o, cz: s.cz ?? 0 });
    if (kind === 'z') return ringZ(s.t, s.rx, s.ry ?? s.rx, { ...o, cy: s.cy ?? 0 });
    return ringX(s.t, s.rz ?? s.rx, s.ry ?? s.rx, { ...o, cz: s.cx ?? 0, cy: s.cy ?? 0 });
  });
  return loft(rings, lo);
}
export const loftY = (st, opts, lo) => loftAxis('y', st, opts, lo);
export const loftZ = (st, opts, lo) => loftAxis('z', st, opts, lo);

// rounded end for a limb or tube: a few shrinking stations, dir +1 grows toward +t, -1 toward -t
export function dome(t, r, dir, steps = 3, scaleAxis = 1) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI / 2 * 0.94;
    out.push({ t: t + dir * r * Math.sin(a) * scaleAxis, k: Math.cos(a) });
  }
  return out;
}

// turned part around y from [radius, y] points (a lathe, with flat caps where radius > 0 at the ends)
export function lathe(pts, { n = 12, crease = 0, smooth = true, p = 2, sx = 1, sz = 1 } = {}) {
  const rings = pts.map(([r, y]) => ringY(y, Math.max(r, 0.00005) * sx, Math.max(r, 0.00005) * sz, { n, p }));
  return loft(rings, { crease, smooth, cap0: pts[0][0] > 0.0002, cap1: pts[pts.length - 1][0] > 0.0002 });
}
// straight rod from a to b with its own taper
export function rod(a, b, r0, r1 = r0, { n = 8, crease = 0 } = {}) {
  const len = new V(...b).distanceTo(new V(...a));
  const g = lathe([[r0, 0], [r1, len]], { n, crease });
  return aim(g, a, new V(...b).sub(new V(...a)));
}

// ---- tube along a path ----------------------------------------------------------------------
export function tubePath(points, radius, { n = 6, seg = 10, crease = 0, p = 2 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new V(...q)), false, 'centripetal');
  const frames = curve.computeFrenetFrames(seg, false);
  const rings = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, c = curve.getPointAt(t);
    const r = typeof radius === 'function' ? radius(t) : Array.isArray(radius) ? lerpList(radius, t) : radius;
    const N = frames.normals[i], B = frames.binormals[i];
    const ringPts = [];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2, s = sgnpow(Math.sin(a), 2 / p), co = sgnpow(Math.cos(a), 2 / p);
      ringPts.push(new V().copy(c).addScaledVector(N, co * r).addScaledVector(B, s * r));
    }
    rings.push(ringPts);
  }
  return loft(rings, { crease });
}
function lerpList(l, t) { const x = t * (l.length - 1), i = Math.min(l.length - 2, Math.floor(x)); return l[i] + (l[i + 1] - l[i]) * (x - i); }

// flat strap along a path: width across, thick out of the surface; `up(t)` is the outward normal
export function ribbon(points, width, thick, up, { seg = 12, crease = 55, edge = 0.5 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new V(...q)), false, 'centripetal');
  const ups = Array.isArray(up) && Array.isArray(up[0]) ? up.map((u) => new V(...u).normalize()) : null;
  const upAt = (t, c) => {
    if (typeof up === 'function') return up(t, c);
    if (!ups) return new V(...up);
    const x = t * (ups.length - 1), i = Math.min(ups.length - 2, Math.floor(x));
    return new V().lerpVectors(ups[i], ups[i + 1], x - i);
  };
  const rings = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, c = curve.getPointAt(t), T = curve.getTangentAt(t);
    const u0 = upAt(t, c).clone();
    const U = u0.addScaledVector(T, -T.dot(u0)).normalize();
    const S = new V().crossVectors(U, T).normalize();
    const w = width / 2, h = thick / 2;
    // a shallow lens: thinner at the edges so it reads as webbing, not a plank
    rings.push([
      new V().copy(c).addScaledVector(S, w).addScaledVector(U, -h * 0.3),
      new V().copy(c).addScaledVector(S, w * 0.96).addScaledVector(U, h * edge),
      new V().copy(c).addScaledVector(S, w * 0.5).addScaledVector(U, h),
      new V().copy(c).addScaledVector(S, -w * 0.5).addScaledVector(U, h),
      new V().copy(c).addScaledVector(S, -w * 0.96).addScaledVector(U, h * edge),
      new V().copy(c).addScaledVector(S, -w).addScaledVector(U, -h * 0.3),
    ]);
  }
  return loft(rings, { crease });
}

// ---- patches grown on a surface ---------------------------------------------------------------
// A plate, pouch, strap or band lying on a surface. surf(u, v) gives the surface point; the patch
// covers rows v0..v1 and in each row u from range(v)[0] to range(v)[1], any outline that is one
// span per row. It rises `off` above the surface (sunk `sink` into it, so it can never float),
// swells to `thick` inside a `bevel`-wide chamfer along its edge, and puffs by `bulge`.
// uScale converts u units to metres (1 for metres, the radius for angles).
// closedU joins the last column to the first (a belt all the way round).
export function patch({ surf, v0, v1, range, rows = 8, cols = 6, off = 0, thick = 0.01, bevel = 0.006, bulge = 0, sink = 0.004, uScale = 1, flip: fl = false, closedU = false, edge = 0.35, crease = 40, hem = 0, walls = true, solid = false }) {
  const pos = [], idx = [];
  const grid = [];
  const eps = 0.002;
  const normalAt = (u, v) => {
    const pu = surf(u + eps / uScale, v), mu = surf(u - eps / uScale, v), pv = surf(u, v + eps), mv = surf(u, v - eps);
    _n.crossVectors(pu.sub(mu), pv.sub(mv)).normalize();
    if (fl) _n.negate();
    return _n.clone();
  };
  for (let i = 0; i <= rows; i++) {
    const v = v0 + (v1 - v0) * (i / rows);
    const [ua, ub] = range(v);
    const row = [];
    for (let j = 0; j <= cols; j++) {
      const u = ua + (ub - ua) * (j / cols);
      const du = Math.min(u - ua, ub - u) * uScale, dv = Math.min(v - v0, v1 - v);
      const e = closedU ? dv : Math.min(du, dv);
      const prof = edge + (1 - edge) * sstep(0, bevel, e);
      const wid = Math.max(1e-4, ((ub - ua) * uScale) / 2), hgt = Math.max(1e-4, (v1 - v0) / 2);
      const uc = (ua + ub) / 2, vc = (v0 + v1) / 2;
      const bl = bulge * (1 - ((u - uc) * uScale / wid) ** 2) * (1 - ((v - vc) / hgt) ** 2);
      const top = off + thick * (prof + (closedU ? 0 : bl));
      const n = normalAt(u, v), P = surf(u, v);
      row.push({ top: P.clone().addScaledVector(n, top), base: P.clone().addScaledVector(n, off - sink), n });
    }
    grid.push(row);
  }
  const at = (i, j) => grid[i][closedU ? j % (cols + 1) : j];
  const vi = new Map();
  const add = (pt) => { const k = pos.length / 3; pos.push(pt.x, pt.y, pt.z); return k; };
  const tops = grid.map((r) => r.map((c) => add(c.top)));
  const baseStart = pos.length / 3; // (the underside, when asked for, is added right after the top grid)
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = tops[i][j], b = tops[i][j + 1], c = tops[i + 1][j], d = tops[i + 1][j + 1];
    idx.push(a, c, b, b, c, d);
  }
  if (solid) {
    // underside, so the patch is a closed solid (limb armour is checked for closed meshes)
    const bases = grid.map((r) => r.map((c) => add(c.base)));
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = bases[i][j], b = bases[i][j + 1], c = bases[i + 1][j], d = bases[i + 1][j + 1];
      idx.push(a, b, c, b, d, c);
    }
  }
  if (closedU) {
    // seam between the last and first column
    for (let i = 0; i < rows; i++) { const a = tops[i][cols], b = tops[i][0], c = tops[i + 1][cols], d = tops[i + 1][0]; idx.push(a, c, b, b, c, d); }
  }
  const wall = (pa, pb, ga, gb) => {
    const w0 = add(ga.top), w1 = add(gb.top), w2 = add(ga.base), w3 = add(gb.base);
    idx.push(w0, w2, w1, w1, w2, w3);
  };
  if (walls) {
    for (let i = 0; i < rows; i++) {
      if (!closedU) { wall(0, 0, grid[i][0], grid[i + 1][0]); wall(0, 0, grid[i + 1][cols], grid[i][cols]); }
    }
    for (let j = 0; j < cols; j++) { wall(0, 0, grid[rows][j], grid[rows][j + 1]); wall(0, 0, grid[0][j + 1], grid[0][j]); }
  }
  // orient every triangle so it faces away from the surface (top) or away from the patch (walls)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ctr = new V();
  for (const row of grid) for (const c of row) ctr.add(c.base);
  ctr.multiplyScalar(1 / (grid.length * grid[0].length));
  const ix = g.index.array, pp = g.attributes.position;
  const topCount = tops.length * tops[0].length;
  for (let t = 0; t < ix.length; t += 3) {
    _a.fromBufferAttribute(pp, ix[t]); _b.fromBufferAttribute(pp, ix[t + 1]); _c.fromBufferAttribute(pp, ix[t + 2]);
    const nrm = new V().subVectors(_b, _a).cross(new V().subVectors(_c, _a));
    const isTop = ix[t] < topCount && ix[t + 1] < topCount && ix[t + 2] < topCount;
    const lo = Math.min(ix[t], ix[t + 1], ix[t + 2]);
    const isBase = solid && !isTop && lo >= baseStart && lo < baseStart + topCount && Math.max(ix[t], ix[t + 1], ix[t + 2]) < baseStart + topCount;
    let ref;
    if (isTop) { const gi = Math.min(Math.floor(ix[t] / (cols + 1)), rows), gj = ix[t] % (cols + 1); ref = grid[gi][gj].n; }
    else if (isBase) { const bi = Math.floor((ix[t] - baseStart) / (cols + 1)), bj = (ix[t] - baseStart) % (cols + 1); ref = grid[bi][bj].n.clone().negate(); }
    else ref = new V().copy(_a).add(_b).add(_c).multiplyScalar(1 / 3).sub(ctr);
    if (nrm.dot(ref) < 0) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; }
  }
  return toCreasedNormals(g, crease * Math.PI / 180);
}

// ---- plates from an outline (for flat parts mounted by hand: lenses, labels, fins) -----------------
// outline: [[x, y]...] in the xy plane, extruded along +z by depth with a chamfered rim.
export function plate(outline, depth, { bevel = 0.003, crease = 40 } = {}) {
  const s = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const d = Math.max(0.0005, depth - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, bevel);
  return toCreasedNormals(g.index ? g.toNonIndexed() : g, crease * Math.PI / 180);
}
// a rounded lobe/pillow: a flattened ellipsoid-like solid, for knobs, lenses and pads
export function pad(rx, ry, rz, { n = 10, rows = 5, p = 2, crease = 0, flat = 0 } = {}) {
  const rings = [];
  for (let i = 0; i <= rows; i++) {
    const a = (i / rows) * Math.PI;
    const y = -Math.cos(a) * ry, k = Math.max(0.0001, Math.sin(a));
    rings.push(ringY(y, rx * k, rz * k, { n, p }));
  }
  return loft(rings, { crease, cap0: false, cap1: false });
}
