import * as THREE from 'three';
import { MAT, Kit, instance, profile, roundRect, turnedY, ring, bolt, block, pipe } from './models.js';
import { toWorld } from './physics.js';
import { ellipsoid } from './geo.js';

// Cover and obstacles. World units (metres). Each prop is an oriented box for physics and
// line of sight, plus cover spots around it for the AI.
export const PROPS = {
  sandbags: { name: 'Sandbags', hx: 1.25, hz: 0.3, h: 0.42, hp: 700, debris: '#8c7f5f' },
  crate: { name: 'Crate', hx: 0.4, hz: 0.3, h: 0.5, hp: 160, debris: '#6a4a2f' },
  barrier: { name: 'Barrier', hx: 1.0, hz: 0.3, h: 0.48, hp: 1400, debris: '#9b9b94' },
  drum: { name: 'Fuel drum', hx: 0.27, hz: 0.27, h: 0.62, hp: 50, debris: '#4a4a45', explodes: true },
  wall: { name: 'Steel wall', hx: 1.25, hz: 0.16, h: 1.45, hp: 1800, debris: '#4a4a45' },
  trap: { name: 'Tank trap', hx: 0.55, hz: 0.55, h: 0.85, hp: Infinity, debris: '#3b3e3d', nocover: true },
  slab: { name: 'Concrete wall', hx: 2.2, hz: 0.22, h: 2.3, hp: Infinity, debris: '#9b9b94', raw: true },
  bunker: { name: 'Bunker', hx: 1.7, hz: 1.7, h: 2.0, hp: Infinity, debris: '#9b9b94', raw: true },
  ruin: { name: 'Ruined wall', hx: 2.0, hz: 0.22, h: 2.0, hp: Infinity, debris: '#8d877a', raw: true },
  ruinLow: { name: 'Broken wall', hx: 1.5, hz: 0.22, h: 0.74, hp: Infinity, debris: '#8d877a', raw: true },
  stonewall: { name: 'Field wall', hx: 1.6, hz: 0.27, h: 0.62, hp: 2600, debris: '#7f7a6e', raw: true },
  rock: { name: 'Boulder', hx: 0.85, hz: 0.7, h: 0.95, hp: Infinity, debris: '#77766c', raw: true },
  // tree trunks: colliders only, the trees themselves are drawn in bulk by the map
  tree: { name: 'Tree', hx: 0.2, hz: 0.2, h: 3.2, hp: Infinity, debris: '#4a3b2c', raw: true, nocover: true, noModel: true, fixed: true },
};
// The small props were modelled for a shorter soldier; scale them to the current one.
export const PROP_SCALE = 1.6;
for (const d of Object.values(PROPS)) if (!d.raw) { d.hx *= PROP_SCALE; d.hz *= PROP_SCALE; d.h *= PROP_SCALE; }

let bagGeo = null;
function bag() {
  // a stuffed sack: flattened, squared-off pillow with tucked ends
  if (!bagGeo) bagGeo = ellipsoid(0.27, 0.072, 0.15, 20, 12, (v) => {
    v.x = Math.sign(v.x) * Math.abs(v.x) ** 0.55;
    v.z = Math.sign(v.z) * Math.abs(v.z) ** 0.7;
    v.y *= 1 - 0.25 * v.x * v.x;
  });
  return bagGeo;
}

const stone = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, flatShading: true });
const STONE = [stone('#8d877a'), stone('#7c766a'), stone('#9a9384')];
const PLASTER = new THREE.MeshStandardMaterial({ color: '#b3aa95', roughness: 0.95 });
const CHAR = new THREE.MeshStandardMaterial({ color: '#2e2a26', roughness: 0.9 });
const ROCK = new THREE.MeshStandardMaterial({ color: '#7a786f', roughness: 0.95, flatShading: true });

// A lumpy stone: a low-poly sphere pushed about by a seeded wobble.
function lump(rx, ry, rz, seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bumps = Array.from({ length: 4 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 0.12 + rnd() * 0.12]);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 1;
    for (const [bx, by, bz, a] of bumps) k += a * (x * bx + y * by + z * bz);
    k = Math.max(0.7, k);
    if (y < -0.3) y = -0.3 - (y + 0.3) * 0.3; // flatter underside
    p.setXYZ(i, x * k * rx, y * k * ry, z * k * rz);
  }
  g.computeVertexNormals();
  return g;
}

// Coursed stone wall from x0..x1, with a broken top given by top(x). Plaster clings to one face.
function masonry(k, x0, x1, thick, top, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ch = 0.25;
  for (let row = 0, y = 0; y < 2.2; row++, y += ch) {
    let x = x0 - (row % 2 ? 0.27 : 0);
    while (x < x1) {
      const w = 0.42 + rnd() * 0.3;
      const a = Math.max(x, x0), b = Math.min(x + w, x1);
      const mid = (a + b) / 2;
      if (b - a > 0.08 && y + ch <= top(mid) + 0.02) {
        const hh = ch - 0.025;
        k.add(block(b - a - 0.03, hh, thick - rnd() * 0.04, 0.03, 0.012), STONE[Math.floor(rnd() * 3)], { pos: [mid, y + ch / 2, (rnd() - 0.5) * 0.03] });
      } else if (b - a > 0.15 && y < top(mid) && rnd() < 0.6) {
        // a loose stone sitting on the break
        k.add(lump(0.14, 0.08, 0.12, Math.floor(rnd() * 1e6)), STONE[Math.floor(rnd() * 3)], { pos: [mid, y + 0.06, (rnd() - 0.5) * 0.15] });
      }
      x += w;
    }
  }
}

const BUILD = {
  ruin(k) {
    // a house wall: stepped break along the top, a patch of old plaster and a scorched lintel
    const top = (x) => (x < -1.2 ? 2.0 : x < -0.2 ? 1.75 : x < 0.9 ? 1.5 - (x - -0.2) * 0.2 : x < 1.5 ? 1.15 : 0.9);
    masonry(k, -2.0, 2.0, 0.44, top, 101);
    k.add(block(1.6, 0.9, 0.02, 0.01, 0.004), PLASTER, { pos: [-1.1, 1.05, 0.235] });
    k.add(block(1.1, 0.5, 0.02, 0.01, 0.004), PLASTER, { pos: [0.6, 0.55, -0.235] });
    k.add(block(1.5, 0.12, 0.5, 0.02, 0.01), CHAR, { pos: [-1.0, 1.92, 0] });
    k.add(block(4.1, 0.14, 0.52, 0.03, 0.012), STONE[1], { pos: [0, 0.03, 0] }); // footing
  },
  ruinLow(k) {
    const top = (x) => 0.74 - Math.max(0, x - 0.6) * 0.25;
    masonry(k, -1.5, 1.5, 0.44, top, 202);
    k.add(block(3.1, 0.14, 0.52, 0.03, 0.012), STONE[1], { pos: [0, 0.03, 0] });
    for (let i = 0; i < 4; i++) k.add(lump(0.16, 0.1, 0.13, 300 + i), STONE[i % 3], { pos: [-1.2 + i * 0.85, 0.06, 0.36 * (i % 2 ? 1 : -1)] });
  },
  stonewall(k) {
    // dry-stone field wall: two faces of rough stones, capped with a row on edge
    let s = 55;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (const [y, n, sy] of [[0.12, 9, 0.12], [0.33, 9, 0.11], [0.5, 8, 0.1]]) {
      for (let i = 0; i < n; i++) {
        const x = -1.5 + (3.0 * (i + 0.5)) / n + (rnd() - 0.5) * 0.08;
        for (const z of y < 0.45 ? [-0.13, 0.13] : [0]) k.add(lump(0.19, sy, y < 0.45 ? 0.15 : 0.2, Math.floor(rnd() * 1e6)), STONE[Math.floor(rnd() * 3)], { pos: [x, y, z * (1 - y * 0.6)] });
      }
    }
  },
  rock(k) {
    k.add(lump(0.95, 0.75, 0.8, 9), ROCK, { pos: [0, 0.45, 0] });
    k.add(lump(0.4, 0.3, 0.35, 21), ROCK, { pos: [0.75, 0.15, 0.45] });
  },
  sandbags(k) {
    const rows = [[5, 0], [5, 0.27], [4, 0.0]];
    let rnd = 3;
    const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647 - 0.5);
    rows.forEach(([n, off], row) => {
      for (let i = 0; i < n; i++) {
        const x = -1.0 + off + i * 0.5 + (row === 2 ? 0.25 : 0);
        for (const z of [-0.14, 0.14]) {
          if (row === 2 && z < 0 && i % 2) continue;
          k.add(bag(), MAT.sand, { pos: [x + r() * 0.03, 0.068 + row * 0.136, z + r() * 0.02], rot: [r() * 0.06, r() * 0.2, r() * 0.05] });
        }
      }
    });
  },
  crate(k) {
    const w = 0.8, h = 0.5, d = 0.6, ph = h / 3 - 0.012;
    // boarded faces with a heavier frame and corner irons
    for (let i = 0; i < 3; i++) {
      const y = (h / 3) * (i + 0.5);
      k.add(block(w - 0.04, ph, 0.03, 0.01, 0.005), MAT.wood, { pos: [0, y, d / 2 - 0.02] });
      k.add(block(w - 0.04, ph, 0.03, 0.01, 0.005), MAT.wood, { pos: [0, y, -d / 2 + 0.02] });
      k.add(block(0.03, ph, d - 0.04, 0.01, 0.005), MAT.wood, { pos: [w / 2 - 0.02, y, 0] });
      k.add(block(0.03, ph, d - 0.04, 0.01, 0.005), MAT.wood, { pos: [-w / 2 + 0.02, y, 0] });
    }
    k.add(block(w - 0.02, 0.03, d - 0.02, 0.01, 0.005), MAT.wood, { pos: [0, h - 0.015, 0] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(block(0.06, h, 0.06, 0.012, 0.006), MAT.darkWood, { pos: [sx * (w / 2 - 0.025), h / 2, sz * (d / 2 - 0.025)] });
    for (const sz of [-1, 1]) k.add(block(w - 0.1, 0.06, 0.035, 0.01, 0.005), MAT.darkWood, { pos: [0, h / 2, sz * (d / 2 + 0.005)] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.05, h - 0.05]) k.add(block(0.075, 0.075, 0.075, 0.01, 0.004), MAT.iron, { pos: [sx * (w / 2 - 0.02), y, sz * (d / 2 - 0.02)] });
  },
  barrier(k) {
    // jersey barrier profile: wide foot, slanted lower face, narrow top
    const pts = [[-0.3, 0], [0.3, 0], [0.3, 0.06], [0.16, 0.17], [0.1, 0.46], [-0.1, 0.46], [-0.16, 0.17], [-0.3, 0.06]];
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.96, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 });
    g.translate(0, 0, -0.98);
    g.rotateY(Math.PI / 2);
    k.add(g, MAT.concrete);
    for (const x of [-0.6, 0.6]) k.add(block(0.18, 0.06, 0.66, 0.02, 0.005), MAT.darkSteel, { pos: [x, 0.005, 0], scale: [1, 0.3, 1] });
  },
  drum(k) {
    k.add(turnedY([[0, 0], [0.245, 0], [0.26, 0.02], [0.26, 0.56], [0.245, 0.58], [0, 0.58]], 24), MAT.iron);
    for (const y of [0.03, 0.2, 0.38, 0.55]) k.add(ring(0.263, 0.012, 24), MAT.darkSteel, { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0] });
    k.add(turnedY([[0, 0.58], [0.045, 0.58], [0.045, 0.62], [0, 0.62]], 12), MAT.brass, { pos: [0.11, 0, 0] });
    k.add(ring(0.035, 0.007, 12), MAT.brass, { pos: [0.11, 0.635, 0], rot: [Math.PI / 2, 0, 0] });
    k.add(pipe([[-0.1, 0.58, 0], [-0.1, 0.66, 0], [-0.18, 0.68, 0]], 0.014, 10, 6), MAT.brass);
  },
  wall(k) {
    // riveted steel plate on two buttress feet
    k.add(block(2.5, 1.45, 0.12, 0.03, 0.015), MAT.iron, { pos: [0, 0.725, 0] });
    for (const x of [-0.85, 0, 0.85]) k.add(block(0.08, 1.45, 0.2, 0.02, 0.01), MAT.darkSteel, { pos: [x, 0.725, 0] });
    for (const x of [-1.15, 1.15]) {
      k.add(profile([[-0.42, 0], [0.42, 0], [0.06, 0.9], [-0.06, 0.9]], 0.07, 0.008), MAT.darkSteel, { pos: [x, 0, 0] });
    }
    for (let x = -1.15; x <= 1.16; x += 0.23) for (const y of [0.08, 1.37]) for (const z of [-0.06, 0.06]) k.add(bolt(0.016), MAT.darkSteel, { pos: [x, y, z], rot: [z > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0] });
    k.add(block(0.5, 0.12, 0.13, 0.02, 0.01), MAT.brass, { pos: [0.42, 1.1, 0] }); // brass vision slot frame
  },
  slab(k) {
    // cast concrete wall panel on a footing, with a chipped top course
    k.add(block(4.4, 2.1, 0.4, 0.05, 0.025), MAT.concrete, { pos: [0, 1.05, 0] });
    k.add(block(4.5, 0.16, 0.5, 0.04, 0.02), MAT.iron, { pos: [0, 0.08, 0] });
    for (const x of [-1.6, -0.5, 0.6, 1.7]) k.add(block(0.9 + (x > 0 ? 0.15 : 0), 0.2 + Math.abs(x) * 0.03, 0.36, 0.04, 0.02), MAT.concrete, { pos: [x, 2.2, 0] });
    for (const x of [-1.1, 1.1]) k.add(block(0.08, 1.9, 0.44, 0.02, 0.01), MAT.darkSteel, { pos: [x, 1.05, 0] });
  },
  bunker(k) {
    // squat pillbox: thick walls, a firing slit on each face, a lid that overhangs
    k.add(block(3.3, 1.3, 3.3, 0.18, 0.06), MAT.concrete, { pos: [0, 0.65, 0] });
    k.add(block(3.3, 0.35, 3.3, 0.18, 0.06), MAT.concrete, { pos: [0, 1.6, 0] });
    for (let a = 0; a < 4; a++) {
      const r = (a * Math.PI) / 2;
      for (const sx of [-1, 1]) k.add(block(0.7, 0.32, 0.3, 0.05, 0.02), MAT.concrete, { pos: [Math.sin(r) * 1.5 + Math.cos(r) * sx * 1.25, 1.42, Math.cos(r) * 1.5 - Math.sin(r) * sx * 1.25], rot: [0, r, 0] });
    }
    k.add(block(3.5, 0.22, 3.5, 0.12, 0.05), MAT.iron, { pos: [0, 1.89, 0] });
    k.add(block(3.0, 0.12, 0.08, 0.03, 0.01), MAT.darkSteel, { pos: [0, 1.42, 0] });
  },
  trap(k) {
    // Czech hedgehog: three angle-iron beams crossing at the middle
    const beam = profile([[-0.6, -0.05], [0.6, -0.05], [0.6, 0.05], [-0.6, 0.05]], 0.1, 0.01);
    const dirs = [[0.62, 0, 0], [0, 0, 0.62], [0, 0.62, 0]];
    const rots = [[0, 0.785, 0.62], [0.62, 0.785 + Math.PI / 2, 0], [Math.PI / 2 - 0.2, 0, 0.3]];
    for (let i = 0; i < 3; i++) k.add(beam, MAT.steel, { pos: [0, 0.42, 0], rot: rots[i] });
    void dirs;
  },
};

const baked = new Map();
export function propModel(type) {
  if (PROPS[type].noModel) return new THREE.Group();
  if (!baked.has(type)) {
    const k = new Kit();
    BUILD[type](k);
    baked.set(type, k.bake());
  }
  const g = instance(baked.get(type), `prop-${type}`);
  if (!PROPS[type].raw) for (const m of g.children) m.scale.setScalar(PROP_SCALE);
  return g;
}

// Cover spots: where a pea can crouch with this prop between it and a threat.
export function coverSpots(prop) {
  const b = prop.box, def = PROPS[prop.type];
  if (def.nocover) return [];
  const out = [];
  const off = 0.5;
  const high = b.h > 1.5;
  if (b.hx >= b.hz * 1.6) {
    for (const side of [-1, 1]) {
      const n = Math.max(1, Math.round((b.hx * 2) / 0.95));
      for (let i = 0; i < n; i++) {
        const lx = -b.hx + (b.hx * 2 * (i + 0.5)) / n;
        if (high && Math.abs(lx) < b.hx - 0.5) continue;
        const [x, z] = toWorld(b, lx, side * (b.hz + off));
        const [px, pz] = high ? toWorld(b, Math.sign(lx) * (b.hx + 0.5), side * (b.hz + off)) : [x, z];
        const [nx, nz] = toWorld({ ...b, x: 0, z: 0 }, 0, side);
        out.push({ x, z, nx, nz, high, px, pz, prop });
      }
    }
  } else {
    for (let a = 0; a < 4; a++) {
      const lx = Math.round(Math.cos((a * Math.PI) / 2)), lz = Math.round(Math.sin((a * Math.PI) / 2));
      const [x, z] = toWorld(b, lx * (b.hx + off), lz * (b.hz + off));
      const [nx, nz] = toWorld({ ...b, x: 0, z: 0 }, lx, lz);
      // tall square cover: peek out past the corner to shoot
      const [px, pz] = high ? toWorld(b, lx * (b.hx + off) + lz * (b.hx + 0.5), lz * (b.hz + off) + lx * (b.hz + 0.5)) : [x, z];
      out.push({ x, z, nx, nz, high, px, pz, prop });
    }
  }
  return out;
}
