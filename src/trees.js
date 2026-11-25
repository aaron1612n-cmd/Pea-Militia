import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { height, noise } from './terrain.js';
import { InstCull } from './instcull.js';

// Trees, drawn in bulk: tall firs in the woods, rounder broadleaf trees along roads and in the
// orchards. Each kind is one instanced trunk mesh and one instanced crown mesh.

function wobble(g, amp, f, seed) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise(x * f + seed, z * f + y * 0.7 + seed * 2) - 0.5;
    const m = noise(z * f + seed * 3, x * f - y * 0.7) - 0.5;
    p.setXYZ(i, x + n * amp, y + (n + m) * amp * 0.4, z + m * amp);
  }
  return g;
}
const strip = (g) => {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position') out.deleteAttribute(k);
  out.computeVertexNormals();
  return out;
};

function firCrown() {
  // drooping tiers: each a cone with a ragged hem, narrowing toward the top
  const tiers = [[1.35, 1.9, 1.5], [1.08, 1.7, 2.45], [0.8, 1.5, 3.3], [0.5, 1.3, 4.1]];
  return mergeGeometries(tiers.map(([r, h, y], i) => {
    const g = new THREE.ConeGeometry(r, h, 9, 2, true);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getY(k) < -h / 2 + 0.01) p.setY(k, p.getY(k) - 0.18 * (Math.sin(k * 2.3 + i) + 1));
    g.translate(0, y + h / 2, 0);
    return strip(wobble(g, 0.22, 1.3, i * 5));
  }));
}
function firTrunk() {
  const g = new THREE.CylinderGeometry(0.09, 0.19, 2.2, 7);
  g.translate(0, 1.0, 0);
  return strip(g);
}
function leafCrown() {
  // a few lumpy clumps around a central mass
  const clumps = [[0, 3.1, 0, 1.45], [0.85, 2.7, 0.3, 1.0], [-0.7, 2.8, -0.5, 1.05], [0.2, 3.8, -0.35, 0.95], [-0.3, 2.5, 0.8, 0.9]];
  return mergeGeometries(clumps.map(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1, 0.82, 1);
    g.translate(x, y, z);
    return strip(wobble(g, 0.35, 1.1, 11 + i * 3));
  }));
}
function leafTrunk() {
  const main = new THREE.CylinderGeometry(0.11, 0.2, 2.6, 7);
  main.translate(0, 1.3, 0);
  const b1 = new THREE.CylinderGeometry(0.05, 0.08, 1.2, 5);
  b1.translate(0, 0.6, 0); b1.rotateZ(-0.7); b1.translate(0.05, 1.9, 0);
  const b2 = new THREE.CylinderGeometry(0.05, 0.08, 1.1, 5);
  b2.translate(0, 0.55, 0); b2.rotateX(0.75); b2.translate(0, 1.7, 0.05);
  return mergeGeometries([main, b1, b2].map(strip));
}

let GEO = null;
const BARK = new THREE.MeshStandardMaterial({ color: '#4c3e31', roughness: 0.95 });
const FIR = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
const LEAF = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, flatShading: true });

// spots: [{ x, z, kind: 'fir' | 'leaf', s, yaw }]. Returns a group to add to the scene.
export function buildTrees(spots) {
  if (!GEO) GEO = { fir: [firTrunk(), firCrown()], leaf: [leafTrunk(), leafCrown()] };
  const g = new THREE.Group();
  g.name = 'trees';
  g.userData.culls = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
  const tint = { fir: ['#3c4a33', '#46553a', '#344230'], leaf: ['#57633d', '#66703f', '#4d5a37', '#6f6b40'] };
  for (const kind of ['fir', 'leaf']) {
    const list = spots.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const [tg, cg] = GEO[kind];
    const trunk = new THREE.InstancedMesh(tg, BARK, list.length);
    const crown = new THREE.InstancedMesh(cg, kind === 'fir' ? FIR : LEAF, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), t.yaw);
      sc.set(t.s, t.s * (0.9 + 0.2 * ((i * 0.618) % 1)), t.s);
      m.compose(v.set(t.x, height(t.x, t.z) - 0.15, t.z), q, sc);
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
      const pal = tint[kind];
      crown.setColorAt(i, c.set(pal[i % pal.length]).multiplyScalar(0.92 + 0.16 * ((i * 0.37) % 1)));
    });
    for (const im of [trunk, crown]) { im.castShadow = true; im.receiveShadow = true; g.add(im); }
    // one sphere per tree (a fir is about 5.5 m tall, a broadleaf crown about 4.6 m across), so only the trees in view are drawn
    const sp = new Float32Array(list.length * 4);
    list.forEach((t, i) => {
      const sy = t.s * (0.9 + 0.2 * ((i * 0.618) % 1)), y = height(t.x, t.z) - 0.15;
      sp[i * 4] = t.x; sp[i * 4 + 1] = y + 2.5 * sy; sp[i * 4 + 2] = t.z; sp[i * 4 + 3] = Math.max(3.2 * sy, 3.2 * t.s);
    });
    g.userData.culls.push(new InstCull([trunk, crown], sp, { shared: true }));
  }
  return g;
}
