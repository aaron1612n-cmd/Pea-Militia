import * as THREE from 'three';

// Closed ellipsoid. Optional `shape(v)` lets callers sculpt vertices in unit space.
export function ellipsoid(rx, ry, rz, w = 48, h = 32, shape) {
  const g = new THREE.SphereGeometry(1, w, h);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (shape) shape(v);
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const merged = mergeByPosition(g);
  merged.computeVertexNormals();
  return merged;
}

// Merge coincident vertices so the sphere seam/poles share normals (watertight, no seam shading).
export function mergeByPosition(g, tol = 1e-5) {
  const p = g.attributes.position;
  const idx = g.index ? g.index.array : [...Array(p.count).keys()];
  const map = new Map();
  const remap = new Uint32Array(p.count);
  const out = [];
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) / tol)},${Math.round(p.getY(i) / tol)},${Math.round(p.getZ(i) / tol)}`;
    let n = map.get(k);
    if (n === undefined) {
      n = out.length / 3;
      map.set(k, n);
      out.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    remap[i] = n;
  }
  const tri = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = remap[idx[i]], b = remap[idx[i + 1]], c = remap[idx[i + 2]];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  ng.setIndex(tri);
  return ng;
}

// Tapered, capped tube along a curve. Returns geometry plus each vertex's curve parameter t
// (used for skin weights). Closed: ring vertices wrap without a seam, ends are fanned shut.
export function taperedTube(curve, radiusAt, tSegs = 40, rSegs = 18) {
  const frames = curve.computeFrenetFrames(tSegs, false);
  const pos = [];
  const ts = [];
  const idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= tSegs; i++) {
    const t = i / tSegs;
    curve.getPointAt(t, P);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = radiusAt(t);
    for (let j = 0; j < rSegs; j++) {
      const a = (j / rSegs) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(P.x + (N.x * c + B.x * s) * r, P.y + (N.y * c + B.y * s) * r, P.z + (N.z * c + B.z * s) * r);
      ts.push(t);
    }
  }
  for (let i = 0; i < tSegs; i++) {
    for (let j = 0; j < rSegs; j++) {
      const a = i * rSegs + j, b = i * rSegs + ((j + 1) % rSegs);
      const c = a + rSegs, d = b + rSegs;
      idx.push(a, c, b, b, c, d);
    }
  }
  // rounded end caps: a few shrinking rings then a pole, so ends read as soft, not cut
  const capRings = 5;
  const addCap = (end) => {
    const t = end ? 1 : 0;
    const fi = end ? tSegs : 0;
    curve.getPointAt(t, P);
    const T = curve.getTangentAt(t).multiplyScalar(end ? 1 : -1);
    const N = frames.normals[fi], B = frames.binormals[fi];
    const r0 = radiusAt(t);
    let prevStart = fi * rSegs;
    for (let k = 1; k <= capRings; k++) {
      const ang = (k / (capRings + 1)) * Math.PI / 2;
      const r = r0 * Math.cos(ang), off = r0 * Math.sin(ang);
      const start = pos.length / 3;
      for (let j = 0; j < rSegs; j++) {
        const a = (j / rSegs) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        pos.push(P.x + (N.x * c + B.x * s) * r + T.x * off, P.y + (N.y * c + B.y * s) * r + T.y * off, P.z + (N.z * c + B.z * s) * r + T.z * off);
        ts.push(t);
      }
      for (let j = 0; j < rSegs; j++) {
        const a = prevStart + j, b = prevStart + ((j + 1) % rSegs);
        const c = start + j, d = start + ((j + 1) % rSegs);
        if (end) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
      prevStart = start;
    }
    const pole = pos.length / 3;
    pos.push(P.x + T.x * r0, P.y + T.y * r0, P.z + T.z * r0);
    ts.push(t);
    for (let j = 0; j < rSegs; j++) {
      const a = prevStart + j, b = prevStart + ((j + 1) % rSegs);
      if (end) idx.push(a, pole, b); else idx.push(a, b, pole);
    }
  };
  addCap(false);
  addCap(true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  ensureOutward(g);
  g.computeVertexNormals();
  return { geometry: g, ts };
}

export function signedVolume(g) {
  const p = g.attributes.position;
  const idx = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]);
    b.fromBufferAttribute(p, idx[i + 1]);
    c.fromBufferAttribute(p, idx[i + 2]);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return vol;
}

// Flip winding if the closed mesh is inside-out, so FrontSide culling never shows the inside.
export function ensureOutward(g) {
  if (signedVolume(g) < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
    if (g.attributes.normal) {
      const n = g.attributes.normal;
      for (let i = 0; i < n.array.length; i++) n.array[i] *= -1;
      n.needsUpdate = true;
    }
  }
  return g;
}

export function paint(g, fn) {
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    fn(v, c);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
