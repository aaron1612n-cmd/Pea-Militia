import * as THREE from 'three';
import { MAT, Kit, instance, profile, roundRect, turnedY, ring, bolt, block as roundBlock, pipe } from './models.js';
import { toWorld } from './physics.js';
import { ellipsoid } from './geo.js';
import { weather } from './grime.js';

// Cover and obstacles. World units (metres). Each prop is an oriented box for physics and
// line of sight, plus cover spots around it for the AI.
export const PROPS = {
  sandbags: { name: 'Sandbags', hx: 1.25, hz: 0.3, h: 0.42, hp: 700, debris: '#8c7f5f' },
  crate: { name: 'Crate', hx: 0.4, hz: 0.3, h: 0.5, hp: 160, debris: '#6a4a2f' },
  barrier: { name: 'Barrier', hx: 1.0, hz: 0.3, h: 0.48, hp: 1400, debris: '#9b9b94' },
  drum: { name: 'Fuel drum', hx: 0.27, hz: 0.27, h: 0.62, hp: 50, debris: '#4a4a45', explodes: true },
  wall: { name: 'Steel wall', hx: 1.25, hz: 0.16, h: 1.45, hp: 1800, debris: '#4a4a45' },
  trap: { name: 'Tank trap', hx: 0.55, hz: 0.55, h: 0.85, hp: Infinity, debris: '#3b3e3d', nocover: true },
  slab: { name: 'Concrete wall', hx: 2.2, hz: 0.22, h: 2.3, hp: 1800, debris: '#9b9b94', raw: true },
  bunker: { name: 'Bunker', hx: 1.7, hz: 1.7, h: 2.0, hp: 4000, debris: '#9b9b94', raw: true },
  ruin: { name: 'Ruined wall', hx: 2.0, hz: 0.22, h: 2.0, hp: 700, debris: '#8d877a', raw: true },
  ruinLow: { name: 'Broken wall', hx: 1.5, hz: 0.22, h: 0.74, hp: 450, debris: '#8d877a', raw: true },
  stonewall: { name: 'Field wall', hx: 1.6, hz: 0.27, h: 0.62, hp: 2600, debris: '#7f7a6e', raw: true },
  rock: { name: 'Boulder', hx: 0.85, hz: 0.7, h: 0.95, hp: Infinity, debris: '#77766c', raw: true },
  // tree trunks: colliders only, the trees themselves are drawn in bulk by the map
  rubble: { name: 'Rubble', hx: 1.1, hz: 0.55, h: 0.26, hp: Infinity, debris: '#8d877a', raw: true, nocover: true, hidden: true },
  tree: { name: 'Tree', hx: 0.2, hz: 0.2, h: 3.2, hp: Infinity, debris: '#4a3b2c', raw: true, noModel: true, fixed: true },
};
// The small props were modelled for a shorter soldier; scale them to the current one.
export const PROP_SCALE = 1.6;
for (const d of Object.values(PROPS)) if (!d.raw) { d.hx *= PROP_SCALE; d.hz *= PROP_SCALE; d.h *= PROP_SCALE; }

// Two detail levels of the same props: the near one has bevelled blocks and fine lumps, the far one
// (used past FAR_PROPS metres, where a bevel is under a pixel) swaps them for plain boxes and coarse
// lumps, which cuts the triangle count of a masonry wall to a tenth. Built by the same code with this flag.
export const FAR_PROPS = 48;
let far = false;
const block = (w, h, d, r, bevel) => (far ? new THREE.BoxGeometry(w, h, d) : roundBlock(w, h, d, r, bevel));
const bagGeos = [null, null];
function bag() {
  // a stuffed sack: flattened, squared-off pillow with tucked ends
  const f = far ? 1 : 0;
  if (!bagGeos[f]) bagGeos[f] = ellipsoid(0.27, 0.072, 0.15, f ? 7 : 12, f ? 4 : 8, (v) => {
    v.x = Math.sign(v.x) * Math.abs(v.x) ** 0.55;
    v.z = Math.sign(v.z) * Math.abs(v.z) ** 0.7;
    v.y *= 1 - 0.25 * v.x * v.x;
  });
  return bagGeos[f];
}

const stone = (c) => weather(new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, flatShading: true }), 'stone');
const STONE = [stone('#8d877a'), stone('#7c766a'), stone('#9a9384')];
const PLASTER = weather(new THREE.MeshStandardMaterial({ color: '#b3aa95', roughness: 0.95 }), 'concrete');
const CHAR = new THREE.MeshStandardMaterial({ color: '#2e2a26', roughness: 0.9 });
const ROCK = weather(new THREE.MeshStandardMaterial({ color: '#7a786f', roughness: 0.95, flatShading: true }), 'stone');
// weathered copies of the shared materials, so the soldiers' gear keeps its own clean look
const KIND = { concrete: 'concrete', iron: 'metal', steel: 'metal', darkSteel: 'metal', wood: 'wood', darkWood: 'wood' };
const PM = new Proxy({}, { get: (c, k) => (c[k] ??= KIND[k] ? weather(MAT[k], KIND[k]) : MAT[k]) });

// A lumpy stone: a low-poly sphere pushed about by a seeded wobble.
function lump(rx, ry, rz, seed) {
  const g = new THREE.IcosahedronGeometry(1, far ? 0 : 1);
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

// Bent reinforcing bar sticking out of broken concrete: a thin rod with a kink near the tip.
function rebar(k, x, y, z, len, lean, yaw = 0) {
  // the bent tip starts exactly where the rod ends, whichever way the rod leans
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, lean * 0.6));
  const rod = new THREE.CylinderGeometry(0.011, 0.011, len, 5);
  rod.translate(0, len / 2, 0);
  k.add(rod, PM.iron, { pos: [x, y, z], rot: new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3) });
  const tip = new THREE.CylinderGeometry(0.011, 0.011, len * 0.35, 5);
  tip.translate(0, len * 0.175, 0);
  const end = new THREE.Vector3(0, len * 0.985, 0).applyQuaternion(q).add(new THREE.Vector3(x, y, z));
  const qt = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0, 0.4)));
  k.add(tip, PM.iron, { pos: end.toArray(), rot: new THREE.Euler().setFromQuaternion(qt).toArray().slice(0, 3) });
}
// broken concrete chunk: a flat shard
function chunk(k, x, y, z, s, seed) {
  k.add(lump(0.2 * s, 0.07 * s, 0.15 * s, seed), PM.concrete, { pos: [x, y, z], rot: [0, seed, 0] });
}

const CHARWOOD = weather(new THREE.MeshStandardMaterial({ color: '#2b2118', roughness: 0.85 }), 'wood');
const BUILD = {
  ruin(k) {
    // a house wall: stepped break along the top, a patch of old plaster and a scorched lintel
    const top = (x) => (x < -1.2 ? 2.0 : x < -0.2 ? 1.75 : x < 0.9 ? 1.5 - (x - -0.2) * 0.2 : x < 1.5 ? 1.15 : 0.9);
    masonry(k, -2.0, 2.0, 0.44, top, 101);
    k.add(block(1.6, 0.9, 0.02, 0.01, 0.004), PLASTER, { pos: [-1.1, 1.05, 0.235] });
    k.add(block(1.1, 0.5, 0.02, 0.01, 0.004), PLASTER, { pos: [0.6, 0.55, -0.235] });
    k.add(block(0.7, 0.12, 0.5, 0.02, 0.01), CHAR, { pos: [-1.6, 2.04, 0] }); // the scorched lintel rests on the tall end of the wall
    k.add(block(4.1, 0.14, 0.52, 0.03, 0.012), STONE[1], { pos: [0, 0.03, 0] }); // footing
    // the roof is gone: charred rafters stick out of the wall, one has fallen across the rubble
    for (const [x, len, tilt] of [[-1.55, 0.9, -0.5], [-0.8, 1.1, -0.4], [0.25, 0.7, 0.35]]) {
      const base = Math.floor((top(x) + 0.02) / 0.25) * 0.25; // the top of the last whole course under this spot
      k.add(block(0.09, len, 0.12, 0.01, 0.005), CHARWOOD, { pos: [x, base - 0.04 + (len / 2) * Math.cos(tilt * 0.5), 0.1], rot: [0, 0, tilt * 0.5] });
    }
    k.add(block(0.1, 1.9, 0.14, 0.01, 0.005), CHARWOOD, { pos: [0.9, 0.3, 0.75], rot: [1.25, 0.2, 0] });
    // floor slab and tile where the room used to be, a window hole's worth of broken lintel stones
    k.add(block(2.6, 0.05, 1.3, 0.01, 0.004), PM.concrete, { pos: [-0.4, 0.03, 0.9] });
    for (let i = 0; i < 7; i++) k.add(lump(0.3 - (i % 3) * 0.05, 0.14, 0.24, 700 + i), STONE[i % 3], { pos: [-1.9 + i * 0.62, 0.08, -0.4 - (i % 2) * 0.2], rot: [0, i, 0] });
    for (let i = 0; i < 5; i++) k.add(lump(0.22, 0.1, 0.18, 760 + i), STONE[(i + 1) % 3], { pos: [-1.4 + i * 0.7, 0.07, 0.55 + (i % 2) * 0.25], rot: [0, i * 2, 0] });
    rebar(k, -1.9, 1.95, 0.05, 0.5, 0.35, 0.3); rebar(k, -1.75, 1.95, -0.08, 0.38, -0.3, 1.2);
  },
  ruinLow(k) {
    const top = (x) => 0.74 - Math.max(0, x - 0.6) * 0.25;
    masonry(k, -1.5, 1.5, 0.44, top, 202);
    k.add(block(3.1, 0.14, 0.52, 0.03, 0.012), STONE[1], { pos: [0, 0.03, 0] });
    for (let i = 0; i < 4; i++) k.add(lump(0.16, 0.1, 0.13, 300 + i), STONE[i % 3], { pos: [-1.2 + i * 0.85, 0.06, 0.36 * (i % 2 ? 1 : -1)] });
    for (let i = 0; i < 9; i++) k.add(block(0.2, 0.08, 0.1, 0.01, 0.006), STONE[i % 3], { pos: [-1.5 + i * 0.37, 0.05 + (i % 3) * 0.02, 0.5 * (i % 2 ? 1 : -1) + (i % 4) * 0.05], rot: [0.1 * i, i * 1.7, 0] });
  },
  rubble(k) {
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      k.add(lump(0.26 - (i % 3) * 0.04, 0.12, 0.2, 500 + i), STONE[i % 3], { pos: [Math.cos(a) * 0.75 * (i / 9 + 0.2), 0.07 + (i % 2) * 0.05, Math.sin(a) * 0.32 * (i / 9 + 0.2)], rot: [0, a, 0] });
    }
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
          k.add(bag(), PM.sand, { pos: [x + r() * 0.03, 0.068 + row * 0.136, z + r() * 0.02], rot: [r() * 0.06, r() * 0.2, r() * 0.05] });
        }
      }
    });
  },
  crate(k) {
    const w = 0.8, h = 0.5, d = 0.6, ph = h / 3 - 0.012;
    // boarded faces with a heavier frame and corner irons
    for (let i = 0; i < 3; i++) {
      const y = (h / 3) * (i + 0.5);
      k.add(block(w - 0.04, ph, 0.03, 0.01, 0.005), PM.wood, { pos: [0, y, d / 2 - 0.02] });
      k.add(block(w - 0.04, ph, 0.03, 0.01, 0.005), PM.wood, { pos: [0, y, -d / 2 + 0.02] });
      k.add(block(0.03, ph, d - 0.04, 0.01, 0.005), PM.wood, { pos: [w / 2 - 0.02, y, 0] });
      k.add(block(0.03, ph, d - 0.04, 0.01, 0.005), PM.wood, { pos: [-w / 2 + 0.02, y, 0] });
    }
    k.add(block(w - 0.02, 0.03, d - 0.02, 0.01, 0.005), PM.wood, { pos: [0, h - 0.015, 0] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(block(0.06, h, 0.06, 0.012, 0.006), PM.darkWood, { pos: [sx * (w / 2 - 0.025), h / 2, sz * (d / 2 - 0.025)] });
    for (const sz of [-1, 1]) k.add(block(w - 0.1, 0.06, 0.035, 0.01, 0.005), PM.darkWood, { pos: [0, h / 2, sz * (d / 2 + 0.005)] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.05, h - 0.05]) k.add(block(0.075, 0.075, 0.075, 0.01, 0.004), PM.iron, { pos: [sx * (w / 2 - 0.02), y, sz * (d / 2 - 0.02)] });
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
    k.add(g, PM.concrete);
    for (const x of [-0.6, 0.6]) k.add(block(0.18, 0.06, 0.66, 0.02, 0.005), PM.darkSteel, { pos: [x, 0.005, 0], scale: [1, 0.3, 1] });
  },
  drum(k) {
    k.add(turnedY([[0, 0], [0.245, 0], [0.26, 0.02], [0.26, 0.56], [0.245, 0.58], [0, 0.58]], far ? 10 : 24), PM.iron);
    for (const y of far ? [] : [0.03, 0.2, 0.38, 0.55]) k.add(ring(0.263, 0.012, 24), PM.darkSteel, { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0] });
    k.add(turnedY([[0, 0.58], [0.045, 0.58], [0.045, 0.62], [0, 0.62]], 12), PM.brass, { pos: [0.11, 0, 0] });
    k.add(ring(0.035, 0.007, 12), PM.brass, { pos: [0.11, 0.635, 0], rot: [Math.PI / 2, 0, 0] });
    k.add(pipe([[-0.1, 0.58, 0], [-0.1, 0.66, 0], [-0.18, 0.68, 0]], 0.014, 10, 6), PM.brass);
  },
  wall(k) {
    // riveted steel plate on two buttress feet
    k.add(block(2.5, 1.45, 0.12, 0.03, 0.015), PM.iron, { pos: [0, 0.725, 0] });
    for (const x of [-0.85, 0, 0.85]) k.add(block(0.08, 1.45, 0.2, 0.02, 0.01), PM.darkSteel, { pos: [x, 0.725, 0] });
    for (const x of [-1.15, 1.15]) {
      k.add(profile([[-0.42, 0], [0.42, 0], [0.06, 0.9], [-0.06, 0.9]], 0.07, 0.008), PM.darkSteel, { pos: [x, 0, 0] });
    }
    if (!far) for (let x = -1.15; x <= 1.16; x += 0.23) for (const y of [0.08, 1.37]) for (const z of [-0.06, 0.06]) k.add(bolt(0.016), PM.darkSteel, { pos: [x, y, z], rot: [z > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0] });
    k.add(block(0.5, 0.12, 0.13, 0.02, 0.01), PM.brass, { pos: [0.42, 1.1, 0] }); // brass vision slot frame
  },
  slab(k) {
    // cast concrete wall panel on a footing, with a chipped top course
    k.add(block(4.4, 2.1, 0.4, 0.05, 0.025), PM.concrete, { pos: [0, 1.05, 0] });
    k.add(block(4.5, 0.16, 0.5, 0.04, 0.02), PM.iron, { pos: [0, 0.08, 0] });
    for (const x of [-1.6, -0.5, 0.6, 1.7]) k.add(block(0.9 + (x > 0 ? 0.15 : 0), 0.2 + Math.abs(x) * 0.03, 0.36, 0.04, 0.02), PM.concrete, { pos: [x, 2.2, 0] });
    for (const x of [-1.1, 1.1]) k.add(block(0.08, 1.9, 0.44, 0.02, 0.01), PM.darkSteel, { pos: [x, 1.05, 0] });
    // broken top edge: reinforcing bar and chunks that have fallen off
    for (let i = 0; i < 6; i++) rebar(k, -1.9 + i * 0.7, 2.28, (i % 2 ? 1 : -1) * 0.06, 0.32 + (i % 3) * 0.12, ((i % 3) - 1) * 0.3, i);
    for (let i = 0; i < 4; i++) chunk(k, -1.7 + i * 1.1, 0.07, 0.42 * (i % 2 ? -1 : 1), 1 + (i % 2) * 0.5, 800 + i);
  },
  bunker(k) {
    // squat pillbox: thick walls, a firing slit on each face, a lid that overhangs
    k.add(block(3.3, 1.3, 3.3, 0.18, 0.06), PM.concrete, { pos: [0, 0.65, 0] });
    k.add(block(3.3, 0.35, 3.3, 0.18, 0.06), PM.concrete, { pos: [0, 1.6, 0] });
    for (let a = 0; a < 4; a++) {
      const r = (a * Math.PI) / 2;
      for (const sx of [-1, 1]) k.add(block(0.7, 0.32, 0.3, 0.05, 0.02), PM.concrete, { pos: [Math.sin(r) * 1.5 + Math.cos(r) * sx * 1.25, 1.42, Math.cos(r) * 1.5 - Math.sin(r) * sx * 1.25], rot: [0, r, 0] });
    }
    k.add(block(3.5, 0.22, 3.5, 0.12, 0.05), PM.iron, { pos: [0, 1.89, 0] });
    k.add(block(3.0, 0.12, 0.08, 0.03, 0.01), PM.darkSteel, { pos: [0, 1.42, 0] });
    // shell-bitten corner, bar showing through, spalled lumps around the base
    for (let i = 0; i < 5; i++) rebar(k, 1.3 + (i % 3) * 0.12, 1.55, 1.6 - i * 0.1, 0.4 + (i % 2) * 0.15, 0.4 - i * 0.12, i * 1.3);
    for (let i = 0; i < 6; i++) chunk(k, Math.cos(i * 1.1) * 2.15, 0.07, Math.sin(i * 1.1) * 2.15, 1.2, 900 + i);
  },
  trap(k) {
    // Czech hedgehog: three angle-iron beams crossing at the middle
    const beam = profile([[-0.6, -0.05], [0.6, -0.05], [0.6, 0.05], [-0.6, 0.05]], 0.1, 0.01);
    const dirs = [[0.62, 0, 0], [0, 0, 0.62], [0, 0.62, 0]];
    const rots = [[0, 0.785, 0.62], [0.62, 0.785 + Math.PI / 2, 0], [Math.PI / 2 - 0.2, 0, 0.3]];
    for (let i = 0; i < 3; i++) k.add(beam, PM.steel, { pos: [0, 0.42, 0], rot: rots[i] });
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

// Draws every prop of a type with one instanced mesh per part, so a big field of cover costs a
// few draw calls instead of one per sandbag. Each prop keeps a plain Group as its transform;
// call sync(prop) after moving it and drop(prop) when it is gone.
// Every slot's matrix lives in a master list; cull() packs just the props the camera or the
// sun's shadow can see (and that are inside the fog) into the front of the instance buffers,
// which the parts of a type share, so the GPU only draws what reaches the picture. Props past
// FAR_PROPS metres use the coarse model (see above), in their own set of instanced meshes.
const bakedFar = new Map();
function bakeFar(type) {
  if (!bakedFar.has(type)) {
    far = true;
    try { const k = new Kit(); BUILD[type](k); bakedFar.set(type, k.bake()); } finally { far = false; }
  }
  return bakedFar.get(type);
}
export class PropBatch {
  constructor(scene) {
    this.scene = scene;
    this.types = new Map();
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.one = new THREE.Vector3();
    this.all = false; // true draws everything in full detail (menu shots, tests)
  }
  _type(type) {
    let t = this.types.get(type);
    if (t) return t;
    if (!baked.has(type)) { const k = new Kit(); BUILD[type](k); baked.set(type, k.bake()); }
    t = { levels: [{ baked: baked.get(type) }, { baked: bakeFar(type) }], free: [], used: 0, cap: 0, mat: null, col: null, bs: null, live: null, dirty: true };
    this._grow(t, 64);
    this.types.set(type, t);
    return t;
  }
  // (re)allocate the master lists and the instance buffers for `cap` slots
  _grow(t, cap) {
    const mat = new Float32Array(cap * 16), col = new Float32Array(cap * 3).fill(1), bs = new Float32Array(cap * 4), live = new Uint8Array(cap);
    if (t.mat) { mat.set(t.mat); col.set(t.col); bs.set(t.bs); live.set(t.live); }
    t.mat = mat; t.col = col; t.bs = bs; t.live = live; t.cap = cap; t.dirty = true;
    for (const L of t.levels) {
      if (L.parts) for (const m of L.parts) { this.scene.remove(m); m.dispose?.(); }
      L.im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); L.im.setUsage(THREE.DynamicDrawUsage);
      L.ic = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); L.ic.setUsage(THREE.DynamicDrawUsage);
      L.vis = new Int32Array(cap); L.tmp = new Int32Array(cap); L.n = -1; L.k = 0; L.kk = -1;
      L.parts = L.baked.map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, cap);
        mesh.instanceMatrix = L.im; mesh.instanceColor = L.ic;
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'props'; mesh.visible = false;
        // the shadow pass draws only the front part of the list: the props the shadow box holds
        mesh.onBeforeShadow = () => { mesh._full = mesh.count; mesh.count = Math.min(mesh.count, L.k); };
        mesh.onAfterShadow = () => { mesh.count = mesh._full; };
        this.scene.add(mesh);
        return mesh;
      });
    }
  }
  add(p) {
    const t = this._type(p.type);
    p.slot = t.free.length ? t.free.pop() : t.used++;
    if (p.slot >= t.cap) this._grow(t, t.cap * 2);
    t.live[p.slot] = 1; t.dirty = true;
  }
  sync(p) {
    const t = this.types.get(p.type);
    if (!t) return;
    const s = PROPS[p.type].raw ? 1 : PROP_SCALE;
    const sy = s * (p.sy ?? 1);
    this.q.setFromAxisAngle(this.up, p.group.rotation.y);
    this.m.compose(p.group.position, this.q, this.one.set(s, sy, s));
    this.m.toArray(t.mat, p.slot * 16);
    // a sphere around the whole prop (it can stand taller than it is wide)
    const b = p.box, i = p.slot * 4, g = p.group.position;
    t.bs[i] = g.x; t.bs[i + 1] = g.y + b.h * 0.5; t.bs[i + 2] = g.z; t.bs[i + 3] = Math.hypot(b.hx, b.hz, b.h * 0.5) + 0.6;
    t.dirty = true;
  }
  // darken a prop as it takes damage (1 = pristine)
  shade(p, v) {
    const t = this.types.get(p.type);
    if (!t || p.slot == null) return;
    t.col[p.slot * 3] = t.col[p.slot * 3 + 1] = t.col[p.slot * 3 + 2] = v;
    t.dirty = true;
  }
  drop(p) {
    const t = this.types.get(p.type);
    if (!t || p.slot == null) return;
    t.live[p.slot] = 0;
    t.col[p.slot * 3] = t.col[p.slot * 3 + 1] = t.col[p.slot * 3 + 2] = 1;
    t.free.push(p.slot);
    t.dirty = true;
    p.slot = null;
  }
  // pack what is in view (or throws a shadow into view) into the instance buffers; cheap when nothing changed.
  // Props the sun's shadow box holds come first, so the shadow pass can draw just that front part.
  cull(view) {
    const e = view.eye, lim2 = FAR_PROPS * FAR_PROPS;
    for (const t of this.types.values()) {
      const bs = t.bs, N = t.levels[0], F = t.levels[1];
      N.k = F.k = 0; // how many are in the shadow box
      let n = 0, f = 0;
      for (let pass = 2; pass >= 1; pass--) {
        for (let s = 0; s < t.used; s++) {
          if (!t.live[s]) continue;
          const i = s * 4;
          const c = this.all ? 2 : view.test(bs[i], bs[i + 1], bs[i + 2], bs[i + 3]);
          if (c !== pass) continue;
          const dx = bs[i] - e.x, dy = bs[i + 1] - e.y, dz = bs[i + 2] - e.z, r = bs[i + 3];
          // a big prop is judged by its nearest edge, so a wall you stand beside keeps its detail along its whole length
          const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - r * 0.6);
          if (!this.all && d * d > lim2) { F.tmp[f++] = s; } else { N.tmp[n++] = s; }
        }
        if (pass === 2) { N.k = n; F.k = f; }
      }
      this._pack(t, N, n);
      this._pack(t, F, f);
      t.dirty = false;
    }
  }
  // write the list into the buffers if it differs from what is already there
  _pack(t, L, n) {
    const vis = L.vis, tmp = L.tmp;
    let same = !t.dirty && n === L.n && L.k === L.kk;
    if (same) for (let k = 0; k < n; k++) if (vis[k] !== tmp[k]) { same = false; break; }
    if (same) return;
    L.n = n; L.kk = L.k;
    const ma = L.im.array, ca = L.ic.array;
    for (let k = 0; k < n; k++) {
      const s = tmp[k];
      vis[k] = s;
      for (let j = 0; j < 16; j++) ma[k * 16 + j] = t.mat[s * 16 + j];
      ca[k * 3] = t.col[s * 3]; ca[k * 3 + 1] = t.col[s * 3 + 1]; ca[k * 3 + 2] = t.col[s * 3 + 2];
    }
    L.im.clearUpdateRanges(); L.im.addUpdateRange(0, Math.max(16, n * 16)); L.im.needsUpdate = true;
    L.ic.clearUpdateRanges(); L.ic.addUpdateRange(0, Math.max(3, n * 3)); L.ic.needsUpdate = true;
    for (const m of L.parts) { m.count = n; m.visible = n > 0; m.castShadow = L.k > 0; } // no prop in the shadow box: leave the shadow pass a draw call lighter
  }
  clear() {
    for (const t of this.types.values()) for (const L of t.levels) for (const im of L.parts) { this.scene.remove(im); im.dispose(); }
    this.types.clear();
  }
}
