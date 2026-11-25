import * as THREE from 'three';
import { height } from './terrain.js';
import { InstCull } from './instcull.js';
import { buildScene, SCENE_VARIANTS } from './scenebuild.js';

// Trees, drawn in bulk: tall firs in the woods, broadleaf trees along roads and in the orchards, birches at the
// edges and a few dead snags where the shelling has been. Each model (see scenebuild.js) is one mesh with its
// own bark and leaf colours, so a kind of tree is a single instanced draw; two shapes of fir and of broadleaf
// keep a wood from being a row of clones.

const GEO = new Map();
const geoFor = (kind, v) => {
  const key = `${kind}.${v}`;
  if (!GEO.has(key)) GEO.set(key, buildScene(kind, v).bake()[0]);
  return GEO.get(key);
};
// each model's reach, for the per-instance culling: [height centre, radius]
const REACH = { fir: [2.8, 3.3], leaf: [3, 3.6], birch: [2.6, 2.8], dead: [2, 2.4] };
// a slight lean of colour per tree, multiplied onto the model's own
const TINT = {
  fir: ['#ffffff', '#f2f6ec', '#e6ecde', '#fbf6ee'],
  leaf: ['#ffffff', '#f6f0d4', '#e9efd9', '#f2e8c8', '#e2e9d0'],
  birch: ['#ffffff', '#f4f2dc', '#eef2dd'],
  dead: ['#ffffff', '#e8e2da'],
};

// spots: [{ x, z, kind: 'fir' | 'leaf' | 'birch' | 'dead', s, yaw }]. Returns a group to add to the scene.
export function buildTrees(spots) {
  const g = new THREE.Group();
  g.name = 'trees';
  g.userData.culls = [];
  g.userData.spots = { tree: spots.filter((t) => t.kind === 'leaf' || t.kind === 'fir').slice(0, 40).map((t) => ({ x: t.x, y: height(t.x, t.z), z: t.z, kind: t.kind })) };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
  const groups = new Map();
  spots.forEach((t, i) => {
    const kind = TINT[t.kind] ? t.kind : 'leaf';
    const variant = Math.floor(((Math.sin(t.x * 12.9 + t.z * 78.2) * 43758.5) % 1 + 1) % 1 * (SCENE_VARIANTS[kind] || 1));
    const key = `${kind}.${variant}`;
    if (!groups.has(key)) groups.set(key, { kind, variant, list: [] });
    groups.get(key).list.push({ ...t, i });
  });
  for (const { kind, variant, list } of groups.values()) {
    const { geometry, material } = geoFor(kind, variant);
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    const pal = TINT[kind], [cy, cr] = REACH[kind];
    const sp = new Float32Array(list.length * 4);
    list.forEach((t, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), t.yaw);
      const sy = t.s * (0.9 + 0.2 * ((i * 0.618) % 1));
      sc.set(t.s, sy, t.s);
      const y = height(t.x, t.z) - 0.15;
      m.compose(v.set(t.x, y, t.z), q, sc);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(pal[i % pal.length]).multiplyScalar(0.92 + 0.16 * ((i * 0.37) % 1)));
      sp[i * 4] = t.x; sp[i * 4 + 1] = y + cy * sy; sp[i * 4 + 2] = t.z; sp[i * 4 + 3] = Math.max(cr * sy, cr * t.s);
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = `tree-${kind}${variant}`;
    g.add(mesh);
    g.userData.culls.push(new InstCull([mesh], sp, {}));
  }
  return g;
}
