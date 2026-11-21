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
};

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

const BUILD = {
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
  if (!baked.has(type)) {
    const k = new Kit();
    BUILD[type](k);
    baked.set(type, k.bake());
  }
  return instance(baked.get(type), `prop-${type}`);
}

// Cover spots: where a pea can crouch with this prop between it and a threat.
export function coverSpots(prop) {
  const b = prop.box, def = PROPS[prop.type];
  if (def.nocover) return [];
  const out = [];
  const off = 0.42;
  const high = b.h > 1.1;
  if (b.hx >= b.hz * 1.6) {
    for (const side of [-1, 1]) {
      const n = Math.max(1, Math.round((b.hx * 2) / 0.85));
      for (let i = 0; i < n; i++) {
        const lx = -b.hx + (b.hx * 2 * (i + 0.5)) / n;
        if (high && Math.abs(lx) < b.hx - 0.5) continue;
        const [x, z] = toWorld(b, lx, side * (b.hz + off));
        const [px, pz] = high ? toWorld(b, Math.sign(lx) * (b.hx + 0.45), side * (b.hz + off)) : [x, z];
        const [nx, nz] = toWorld({ ...b, x: 0, z: 0 }, 0, side);
        out.push({ x, z, nx, nz, high, px, pz, prop });
      }
    }
  } else {
    for (let a = 0; a < 4; a++) {
      const lx = Math.round(Math.cos((a * Math.PI) / 2)), lz = Math.round(Math.sin((a * Math.PI) / 2));
      const [x, z] = toWorld(b, lx * (b.hx + off), lz * (b.hz + off));
      const [nx, nz] = toWorld({ ...b, x: 0, z: 0 }, lx, lz);
      out.push({ x, z, nx, nz, high: false, px: x, pz: z, prop });
    }
  }
  return out;
}
