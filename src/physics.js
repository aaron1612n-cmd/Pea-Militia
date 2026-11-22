import * as THREE from 'three';

// Oriented boxes standing on the plate: { x, z, yaw, hx, hz, h, y0 }.
// Local frame matches three.js rotation.y = yaw.
export function toLocal(b, px, pz) {
  const dx = px - b.x, dz = pz - b.z, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}
export function toWorld(b, lx, lz) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
}

// Ray (origin o, unit dir d) against box; returns { t, n } or null.
export function rayBox(o, d, maxT, b) {
  const [ox, oz] = toLocal(b, o.x, o.z);
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const dx = d.x * c - d.z * s, dz = d.x * s + d.z * c;
  const oy = o.y, dy = d.y;
  const y0 = b.y0 || 0;
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  const slab = (oo, dd, lo, hi, ax) => {
    if (Math.abs(dd) < 1e-9) return oo >= lo && oo <= hi;
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd, sg = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; sg = 1; }
    if (t1 > tmin) { tmin = t1; axis = ax; sign = sg; }
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };
  if (!slab(ox, dx, -b.hx, b.hx, 0)) return null;
  if (!slab(oy, dy, y0, y0 + b.h, 1)) return null;
  if (!slab(oz, dz, -b.hz, b.hz, 2)) return null;
  if (axis < 0) return { t: 0, n: new THREE.Vector3(-d.x, -d.y, -d.z) }; // started inside
  let n;
  if (axis === 1) n = new THREE.Vector3(0, sign, 0);
  else {
    const lx = axis === 0 ? sign : 0, lz = axis === 2 ? sign : 0;
    n = new THREE.Vector3(lx * c + lz * s, 0, -lx * s + lz * c);
  }
  return { t: tmin, n };
}

// Push a circle (on the ground plane, with body height range) out of a box. Returns true if moved.
export function pushCircle(p, r, b, out) {
  const [lx, lz] = toLocal(b, p.x, p.z);
  const cx = Math.max(-b.hx, Math.min(b.hx, lx)), cz = Math.max(-b.hz, Math.min(b.hz, lz));
  let dx = lx - cx, dz = lz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  let nx, nz;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    nx = lx - (dx / d) * 0; // keep
    const k = r / d;
    nx = cx + dx * k; nz = cz + dz * k;
  } else {
    // centre inside: leave by the nearest face
    const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
    if (px < pz) { nx = Math.sign(lx || 1) * (b.hx + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (b.hz + r); }
  }
  const [wx, wz] = toWorld(b, nx, nz);
  if (out) out.set(wx - p.x, 0, wz - p.z);
  p.x = wx; p.z = wz;
  return true;
}

// Does the segment a->b (2D, with heights) pass through the box footprint grown by r?
export function segmentHitsBox(ax, az, bx, bz, b, r) {
  const [x0, z0] = toLocal(b, ax, az), [x1, z1] = toLocal(b, bx, bz);
  const hx = b.hx + r, hz = b.hz + r;
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [o, d, h] of [[x0, dx, hx], [z0, dz, hz]]) {
    if (Math.abs(d) < 1e-9) { if (o < -h || o > h) return false; continue; }
    let a = (-h - o) / d, c = (h - o) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

// Corners of the box grown by r, in world space.
export function corners(b, r) {
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz]) => toWorld(b, sx * (b.hx + r), sz * (b.hz + r)));
}

// Ray against a sphere; returns t or -1.
export function raySphere(o, d, c, r, maxT) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return cc < 0 ? 0 : -1;
  return t;
}

// Closest distance from point p to segment a-b.
export function segDist(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + abx * t - p.x, y = a.y + aby * t - p.y, z = a.z + abz * t - p.z;
  return Math.sqrt(x * x + y * y + z * z);
}

export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
