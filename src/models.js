import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared kit for weapons, props and vehicles: worn WW2 steel and wood, brass fittings,
// one cold teal glow for the "future" parts.
const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
export const MAT = {
  steel: std('#3b3e3d', 0.5, 0.6),
  darkSteel: std('#26292a', 0.55, 0.55),
  iron: std('#4a4a45', 0.75, 0.35),
  brass: std('#9c7a3c', 0.38, 0.8),
  copper: std('#8a5236', 0.4, 0.75),
  wood: std('#6a4a2f', 0.72),
  darkWood: std('#4a3322', 0.75),
  leather: std('#3a2c22', 0.85),
  rubber: std('#1d1d1c', 0.9),
  canvas: std('#7d7559', 0.95),
  sand: std('#9a8d6b', 0.97),
  concrete: std('#9b9b94', 0.93),
  glow: new THREE.MeshStandardMaterial({ color: '#2a6a66', emissive: '#6ff2e2', emissiveIntensity: 1.6, roughness: 0.3 }),
  glass: std('#a9c7c4', 0.08, 0.1, { emissive: '#245a56', emissiveIntensity: 0.25, transparent: true, opacity: 0.35, depthWrite: false }),
  gauge: std('#e6e0cc', 0.5),
  ember: new THREE.MeshStandardMaterial({ color: '#3a1a0a', emissive: '#ff8a2a', emissiveIntensity: 1.4, roughness: 0.6 }),
};

const paintCache = new Map();
export function paintMat(color, roughness = 0.7, metalness = 0.25) {
  const k = `${color}|${roughness}|${metalness}`;
  if (!paintCache.has(k)) paintCache.set(k, std(color, roughness, metalness));
  return paintCache.get(k);
}

// Strip to position+normal and drop indices so any geometries can be merged.
function clean(g) {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

// Collects (geometry, material, transform) pieces and bakes them into one mesh per material.
export class Kit {
  constructor() { this.parts = new Map(); this.slots = {}; }
  // pieces added inside fn are a moving part (a magazine, a bolt): baked as their own meshes, tagged with the slot name
  // (mat: draw the whole slot in one material, so a moving part costs one draw call, not one per finish)
  slot(name, fn, mat = null) {
    const main = this.parts;
    this.parts = this.slots[name] ||= new Map();
    this.force = mat;
    try { fn(); } finally { this.parts = main; this.force = null; }
    return this;
  }
  add(geo, mat, { pos, rot, scale } = {}) {
    if (this.force) mat = this.force;
    const g = clean(geo);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(pos || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))),
      new THREE.Vector3(...(Array.isArray(scale) ? scale : [scale ?? 1, scale ?? 1, scale ?? 1])),
    );
    g.applyMatrix4(m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  build(name = 'kit', shadows = true) {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, list] of [...this.parts, ...Object.values(this.slots).flatMap((m) => [...m])]) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
  // geometry-only bake (for caching): [{ geometry, material }]
  bake() {
    const out = [...this.parts].map(([material, list]) => ({ geometry: mergeGeometries(list, false), material }));
    for (const [slot, m] of Object.entries(this.slots)) for (const [material, list] of m) out.push({ geometry: mergeGeometries(list, false), material, slot });
    return out;
  }
}

export function instance(baked, name = 'model', shadows = true) {
  const g = new THREE.Group();
  g.name = name;
  for (const { geometry, material, slot } of baked) {
    const m = new THREE.Mesh(geometry, material);
    if (slot) m.userData.slot = slot;
    m.castShadow = shadows;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

// Side silhouette in (z, y), extruded across x and centred. Bevelled so edges catch light.
export function profile(pts, thick, bevel = 0.006, segs = 2) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const depth = Math.max(0.0005, thick - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

// Rounded rectangle silhouette (z0..z1, y0..y1) with corner radius r.
export function roundRect(z0, y0, z1, y1, r) {
  const pts = [];
  const corner = (cx, cy, a0) => { for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(z1 - r, y0 + r, -Math.PI / 2);
  corner(z1 - r, y1 - r, 0);
  corner(z0 + r, y1 - r, Math.PI / 2);
  corner(z0 + r, y0 + r, Math.PI);
  return pts;
}

// Turned part along +z from a list of [radius, z] points (closed at both ends if r=0 there).
export function turned(pts, segs = 16) {
  const v = pts.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.0001), z));
  const g = new THREE.LatheGeometry(v, segs);
  g.rotateX(Math.PI / 2);
  return g;
}

// Turned part standing along +y.
export function turnedY(pts, segs = 16) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), segs);
}

// Solid rod along +z with slightly domed ends.
export function rod(r, z0, z1, segs = 10) {
  const d = Math.min(r * 0.6, (z1 - z0) / 3);
  return turned([[0, z0], [r * 0.7, z0], [r, z0 + d], [r, z1 - d], [r * 0.7, z1], [0, z1]], segs);
}

export function ring(r, tube, segs = 20) {
  return new THREE.TorusGeometry(r, tube, 6, segs);
}

export function bolt(r = 0.008) {
  const g = new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  return g;
}

export function pipe(points, r, segs = 24, radial = 8) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(c, segs, r, radial, false);
}

// Rounded block: a rounded-rect silhouette extruded with a soft bevel. For crates, hulls, plates.
export function block(w, h, d, r = 0.02, bevel = 0.01) {
  const g = profile(roundRect(-d / 2, -h / 2, d / 2, h / 2, Math.min(r, h / 2 - 0.001, d / 2 - 0.001)), w, bevel, 2);
  return g;
}

export function ellipsoidGeo(rx, ry, rz, w = 16, h = 10) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}
