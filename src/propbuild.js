import * as THREE from 'three';
import { Kit, ring, turnedY, pipe, profile, block as roundBlock } from './models.js';
import { uberMaterial, UBER_KIND as K } from './grime.js';
import { ellipsoid } from './geo.js';

// The models for cover and obstacles. Every piece goes into the one uber material (grime.js) with its own
// paint and wear, so a whole prop is a single draw call; the wear is worked out in the shader.
// Hard-edged things are built from jittered boxes (bricks, planks, slabs): each corner nudged a little so no two
// are alike, 12 triangles apiece, no bevel to pay for. Props are built in a "near" and a "far" detail level
// (`far` drops the small stuff), and in a few variants of the same footprint so a field of cover is not a field of clones.
let far = false;
const U = uberMaterial();

const rngOf = (seed) => { let s = (seed * 9973 + 17) % 2147483647; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
// jitter a hex colour: dl lighter/darker, ds more or less saturated
const tone = (hex, rnd, dl = 0.06, ds = 0.04) => new THREE.Color(hex).offsetHSL((rnd() - 0.5) * 0.02, (rnd() - 0.5) * ds, (rnd() - 0.5) * dl);

const put = (k, geo, kind, color, wear, o = {}) => k.add(geo, U, { pos: o.pos, rot: o.rot, scale: o.scale, color, p: [K[kind], wear, o.ax ?? 0] });
const plain = (k, geo, color, rough, metal, o = {}) => k.add(geo, U, { pos: o.pos, rot: o.rot, scale: o.scale, color, p: [K.plain, rough, metal] });

// A box with every corner pushed about by up to j of its size: a chipped brick, a split plank, a poured slab.
export function jbox(w, h, d, rnd, j = 0.05) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const D = Array.from({ length: 8 }, () => [(rnd() - 0.5) * j * w, (rnd() - 0.5) * j * h, (rnd() - 0.5) * j * d]);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const c = (p.getX(i) > 0 ? 4 : 0) + (p.getY(i) > 0 ? 2 : 0) + (p.getZ(i) > 0 ? 1 : 0);
    p.setXYZ(i, p.getX(i) + D[c][0], p.getY(i) + D[c][1], p.getZ(i) + D[c][2]);
  }
  g.computeVertexNormals();
  return g;
}
// a lumpy stone: a low-poly sphere pushed about by a seeded wobble, flat underside
export function lump(rx, ry, rz, seed, flat = true) {
  const g = new THREE.IcosahedronGeometry(1, far ? 0 : 1);
  const p = g.attributes.position;
  const rnd = rngOf(seed);
  const bumps = Array.from({ length: 4 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 0.12 + rnd() * 0.14]);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i), kk = 1;
    for (const [bx, by, bz, a] of bumps) kk += a * (x * bx + y * by + z * bz);
    kk = Math.max(0.7, kk);
    if (flat && y < -0.3) y = -0.3 - (y + 0.3) * 0.25;
    p.setXYZ(i, x * kk * rx, y * kk * ry, z * kk * rz);
  }
  g.computeVertexNormals();
  return g;
}

// Bent reinforcing bar sticking out of broken concrete.
function rebar(k, x, y, z, len, lean, yaw = 0, wear = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, lean * 0.6));
  const rod = new THREE.CylinderGeometry(0.011, 0.011, len, 5);
  rod.translate(0, len / 2 - 0.02, 0);
  const col = '#58392a';
  put(k, rod, 'metal', col, wear, { pos: [x, y, z], rot: new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3) });
  if (far) return;
  const tip = new THREE.CylinderGeometry(0.011, 0.011, len * 0.35, 5);
  tip.translate(0, len * 0.175, 0);
  const end = new THREE.Vector3(0, len * 0.975 - 0.02, 0).applyQuaternion(q).add(new THREE.Vector3(x, y, z));
  const qt = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0, 0.4)));
  put(k, tip, 'metal', col, wear, { pos: end.toArray(), rot: new THREE.Euler().setFromQuaternion(qt).toArray().slice(0, 3) });
}
// a boulder: a fine sphere pushed about by ridged noise, with a few flat strata cut into it and a flat bottom
function boulder(rx, ry, rz, seed) {
  const g = new THREE.IcosahedronGeometry(1, far ? 1 : 2);
  const rnd = rngOf(seed);
  const waves = Array.from({ length: 6 }, (_, i) => { const f = 1.3 + i * 0.9; return [(rnd() - 0.5) * f * 2, (rnd() - 0.5) * f * 2, (rnd() - 0.5) * f * 2, rnd() * 6.28, 0.2 / (1 + i * 0.7)]; });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 0;
    for (const [a, b2, c, ph, am] of waves) n += am * (1 - Math.abs(Math.sin(a * x + b2 * y + c * z + ph)));
    const kk = 0.78 + n;
    y = y * kk; if (y < -0.35) y = -0.35 - (y + 0.35) * 0.2;
    y = Math.round(y * 5) / 5 * 0.5 + y * 0.5;        // a hint of terracing
    p.setXYZ(i, x * kk * rx, y * ry, z * kk * rz);
  }
  g.computeVertexNormals();
  return g;
}
// shift a piece so its lowest point is `sink` below the ground plane (rest it exactly, whatever its shape)
function grounded(g, sink = 0.004) {
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y - sink, 0);
  return g;
}
// a brick or block that has fallen and come to rest, whichever way it landed (onTop: the height of what it landed on)
function fallen(k, kind, color, rnd, x, z, w, h, d, wear = 0.6, onTop = 0) {
  const g = jbox(w, h, d, rnd, 0.12);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((rnd() - 0.5) * 0.7, rnd() * 6.28, (rnd() - 0.5) * 0.7)));
  grounded(g);
  put(k, g, kind, color, wear, { pos: [x, onTop, z] });
}

// ---------------------------------------------------------------------------------------------------------------
// masonry: courses of jittered bricks over a mortar core. top(x) is the broken skyline, `holes` are openings
// ({ x0, x1, y0, y1 }); a brick that meets an opening is cut back to it.
const BRICK = ['#7a4a3c', '#6e4136', '#835244', '#64453b', '#8c5c48', '#774f45'];
const BLOCK = ['#8d877a', '#7c766a', '#9a9384', '#85807a'];
function masonry(k, { x0, x1, thick, top, holes = [], seed, palette = BRICK, ch = 0.1, bl = 0.34, wear = 0.6, ymax = 2.2 }) {
  const rnd = rngOf(seed);
  const cut = far ? 3 : 1; // the far copy lays bigger bricks
  const H = ch * cut, L = bl * cut;
  // mortar core, in columns so the broken skyline is stepped like real fracture; columns break at every opening's edge
  const xs = [x0];
  for (let x = x0 + 0.3; x < x1 - 0.05; x += 0.3) xs.push(x);
  for (const h of holes) for (const e of [h.x0, h.x1]) if (e > x0 + 0.02 && e < x1 - 0.02) xs.push(e);
  xs.push(x1);
  xs.sort((p, q) => p - q);
  for (let i = 0; i < xs.length - 1; i++) {
    const x = xs[i], xe = xs[i + 1];
    if (xe - x < 0.02) continue;
    const mid = (x + xe) / 2, t = Math.min(top(mid), ymax) - 0.02;
    if (t < 0.05) continue;
    let y = 0;
    for (const hole of holes.filter((h) => h.x0 < mid && h.x1 > mid)) { if (hole.y0 > y) put(k, new THREE.BoxGeometry(xe - x, hole.y0 - y, thick - 0.06), 'stone', '#5f5a52', 0.7, { pos: [mid, y + (hole.y0 - y) / 2, 0] }); y = Math.max(y, hole.y1); }
    if (t > y) put(k, new THREE.BoxGeometry(xe - x, t - y, thick - 0.06), 'stone', '#5f5a52', 0.7, { pos: [mid, y + (t - y) / 2, 0] });
  }
  for (let row = 0, y = 0; y < ymax; row++, y += H) {
    let x = x0 - (row % 2 ? L * 0.5 : 0) - rnd() * 0.05;
    while (x < x1) {
      const w = L * (0.78 + rnd() * 0.4);
      let a = Math.max(x, x0), b = Math.min(x + w, x1);
      x += w;
      if (b - a < 0.06) continue;
      const mid = (a + b) / 2, tp = top(mid);
      // clip against openings
      const segs = [[a, b]];
      for (const hole of holes) {
        if (y + H <= hole.y0 || y >= hole.y1) continue;
        for (let i = segs.length - 1; i >= 0; i--) {
          const [sa, sb] = segs[i];
          if (sb <= hole.x0 || sa >= hole.x1) continue;
          segs.splice(i, 1);
          if (sa < hole.x0 - 0.05) segs.push([sa, hole.x0]);
          if (sb > hole.x1 + 0.05) segs.push([hole.x1, sb]);
        }
      }
      for (const [sa, sb] of segs) {
        const m2 = (sa + sb) / 2;
        if (sb - sa < 0.07) continue;
        if (y + H <= top(m2) + 0.03) {
          const c = tone(palette[Math.floor(rnd() * palette.length)], rnd, 0.1, 0.1);
          put(k, jbox(sb - sa - 0.014, H - 0.014, thick + (rnd() - 0.5) * 0.03, rnd, 0.07), 'stone', c, wear, { pos: [m2, y + H / 2, (rnd() - 0.5) * 0.02] });
        } else if (!far && y < tp && sb - sa > 0.14 && rnd() < 0.5) {
          // a loose brick lying on the break
          const c = tone(palette[Math.floor(rnd() * palette.length)], rnd, 0.1, 0.1);
          const t = top(m2);
          put(k, jbox((sb - sa) * 0.8, H - 0.02, thick * 0.6, rnd, 0.1), 'stone', c, wear, { pos: [m2, Math.max(0, t) + (H - 0.02) / 2 - 0.01, (rnd() - 0.5) * 0.1], rot: [0, (rnd() - 0.5) * 0.5, 0] });
        }
      }
      void mid; void tp;
    }
  }
}
// a patch of old plaster clinging to one face, ragged round the edge
function plaster(k, cx, cy, w, h, zf, seed, col = '#b3aa95') {
  const rnd = rngOf(seed);
  const s = new THREE.Shape(), pts = [];
  const step = far ? 0.4 : 0.14;
  const edge = (x0, y0, x1, y1) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step)); for (let i = 0; i < n; i++) { const t = i / n, inset = rnd() * 0.09; pts.push([x0 + (x1 - x0) * t - Math.sign(x1 - x0) * 0 + (y1 === y0 ? 0 : (x0 < 0 ? inset : -inset)), y0 + (y1 - y0) * t + (x1 === x0 ? 0 : (y0 < 0 ? inset : -inset))]); } };
  edge(-w / 2, h / 2, -w / 2, -h / 2); edge(-w / 2, -h / 2, w / 2, -h / 2); edge(w / 2, -h / 2, w / 2, h / 2); edge(w / 2, h / 2, -w / 2, h / 2);
  pts.forEach(([px, py], i) => (i ? s.lineTo(px, py) : s.moveTo(px, py)));
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false });
  put(k, g, 'concrete', tone(col, rnd, 0.05), 0.6, { pos: [cx, cy, zf > 0 ? zf - 0.002 : zf - 0.012] });
}
// charred rafter or beam
const beam = (k, x, y, z, len, tilt, rot = [0, 0, 0], seed = 1, w = 0.09, d = 0.12, wear = 1) => {
  const rnd = rngOf(seed);
  put(k, jbox(w, len, d, rnd, 0.08), 'wood', tone('#2b2118', rnd, 0.1), wear, { pos: [x, y, z], rot: [rot[0], rot[1], rot[2] + tilt], ax: 1 });
};

// ---------------------------------------------------------------------------------------------------------------
const bagCache = {};
function bag(i) {
  const key = `${far ? 'f' : 'n'}${i}`;
  if (bagCache[key]) return bagCache[key];
  const a = [0.55, 0.7, 0.45][i % 3], b = [0.7, 0.5, 0.9][i % 3], lop = [0.12, -0.1, 0.2][i % 3];
  if (far) return (bagCache[key] = jbox(0.5, 0.13, 0.28, rngOf(i + 5), 0.1));
  return (bagCache[key] = ellipsoid(0.27, 0.072, 0.15, far ? 7 : 10, far ? 4 : 6, (v) => {
    v.x = Math.sign(v.x) * Math.abs(v.x) ** a;                  // squared-off pillow with tucked ends
    v.z = Math.sign(v.z) * Math.abs(v.z) ** b;
    v.y *= 1 - 0.28 * v.x * v.x;
    v.z *= 1 + lop * v.x;                                       // one end fatter than the other
    if (v.y > 0.3) v.y *= 1 - 0.18 * Math.abs(Math.sin(v.x * 4.0 + i));  // a slump across the top
  }));
}
const SAND = ['#a89a72', '#9a8d6b', '#8e8764', '#b3a67f', '#958a66'];

function mkWood(k, rnd, w, h, d, x, y, z, ax, base = '#6a4a2f', wear = 0.55, rot) {
  put(k, jbox(w, h, d, rnd, 0.03), 'wood', tone(base, rnd, 0.14), wear, { pos: [x, y, z], ax, rot });
}

const BUILD = {
  sandbags(k, v) {
    const rnd = rngOf(3 + v * 11);
    const rows = v === 1 ? [[5, 0], [5, 0.25], [4, 0.0], [3, 0.25]] : [[5, 0], [5, 0.27], [4, 0.0]];
    rows.forEach(([n, off], row) => {
      for (let i = 0; i < n; i++) {
        const x = -1.0 + off + i * 0.5 + (row === 2 ? 0.25 : 0);
        for (const z of [-0.14, 0.14]) {
          if (row === 2 && z < 0 && i % 2) continue;
          if (row >= 2 && v === 1 && rnd() < 0.18) continue;            // a gap where one has been blown off
          const c = tone(SAND[Math.floor(rnd() * SAND.length)], rnd, 0.06, 0.08);
          put(k, bag(Math.floor(rnd() * 3)), 'cloth', c, 0.3 + row * 0.2, { pos: [x + (rnd() - 0.5) * 0.04, 0.068 + row * 0.13, z + (rnd() - 0.5) * 0.03], rot: [(rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.06] });
        }
      }
    });
    // one that has slid off the pile and lies where it landed, and a spill of sand
    put(k, bag(1), 'cloth', tone(SAND[2], rnd), 0.9, { pos: [v ? 1.3 : -1.25, 0.062, v ? 0.42 : -0.4], rot: [0, v ? 0.5 : 2.4, 0.05] });
    if (v === 1) {
      put(k, grounded(lump(0.3, 0.07, 0.2, 77)), 'cloth', '#a39469', 0.9, { pos: [-0.9, 0, 0.38] });
      if (!far) for (const sx of [-1, 1]) mkWood(k, rnd, 0.07, 0.5, 0.07, sx * 1.33, 0.25, 0.02, 1, '#5a4129', 0.7);
    }
  },
  crate(k, v) {
    const rnd = rngOf(40 + v);
    const w = 0.8, h = 0.5, d = 0.6;
    if (v === 0) {
      // a slatted ammunition crate: boards with gaps, corner posts, a battened lid, steel straps
      put(k, new THREE.BoxGeometry(w - 0.06, h - 0.06, d - 0.06), 'wood', '#241a10', 0.2, { pos: [0, h / 2 - 0.005, 0] });
      const sl = (h - 0.05) / 4;
      for (let i = 0; i < 4; i++) {
        const y = 0.02 + sl * (i + 0.5);
        for (const s of [-1, 1]) {
          mkWood(k, rnd, w - 0.05, sl - 0.014, 0.024, 0, y, s * (d / 2 - 0.013), 0, '#6a4a2f');
          mkWood(k, rnd, 0.024, sl - 0.014, d - 0.05, s * (w / 2 - 0.013), y, 0, 2, '#664629');
        }
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mkWood(k, rnd, 0.055, h - 0.03, 0.055, sx * (w / 2 - 0.03), (h - 0.03) / 2 + 0.005, sz * (d / 2 - 0.03), 1, '#4a3322', 0.7);
      for (let i = 0; i < 3; i++) mkWood(k, rnd, w - 0.02, 0.016, d / 3 - 0.01, 0, h - 0.04, (i - 1) * (d / 3), 0, '#6e4e32');
      for (const sx of [-1, 1]) mkWood(k, rnd, 0.06, 0.024, d - 0.01, sx * (w / 2 - 0.12), h - 0.022, 0, 2, '#4a3322', 0.7);
      if (!far) {
        for (const x of [-0.2, 0.22]) {            // steel straps
          const sc = '#363d38';
          put(k, new THREE.BoxGeometry(0.035, 0.012, d + 0.012), 'metal', sc, 0.6, { pos: [x, h - 0.03, 0] });
          for (const s of [-1, 1]) put(k, new THREE.BoxGeometry(0.035, h - 0.03, 0.012), 'metal', sc, 0.6, { pos: [x, (h - 0.03) / 2 + 0.005, s * (d / 2 + 0.003)] });
        }
        plain(k, new THREE.BoxGeometry(0.2, 0.055, 0.004), '#c8b46a', 0.9, 0, { pos: [-0.02, 0.27, d / 2 + 0.0005] });   // stencilled marking
        plain(k, new THREE.BoxGeometry(0.06, 0.012, 0.004), '#9c2a24', 0.9, 0, { pos: [0.18, 0.205, d / 2 + 0.0005] });
      }
    } else {
      // a steel ammunition case: olive paint, ribs, latches and a handle at each end
      put(k, jbox(w, h - 0.07, d, rnd, 0.015), 'metal', '#4f5738', 0.55, { pos: [0, (h - 0.07) / 2, 0] });
      put(k, jbox(w + 0.016, 0.075, d + 0.016, rnd, 0.015), 'metal', '#565f3d', 0.6, { pos: [0, h - 0.0375, 0] });
      for (const sx of [-0.27, 0, 0.27]) for (const s of [-1, 1]) put(k, new THREE.BoxGeometry(0.035, h - 0.17, 0.014), 'metal', '#4a5133', 0.6, { pos: [sx, (h - 0.07) / 2 - 0.01, s * (d / 2 + 0.002)] });
      for (const s of [-1, 1]) {
        put(k, new THREE.BoxGeometry(0.014, 0.1, d - 0.2), 'metal', '#4a5133', 0.6, { pos: [s * (w / 2 + 0.002), 0.2, 0] });
        if (!far) put(k, pipe([[s * w / 2, 0.3, -0.1], [s * (w / 2 + 0.06), 0.3, -0.1], [s * (w / 2 + 0.06), 0.3, 0.1], [s * w / 2, 0.3, 0.1]], 0.012, 10, 5), 'metal', '#25271f', 0.5);
      }
      for (const sx of [-0.2, 0.2]) put(k, new THREE.BoxGeometry(0.07, 0.07, 0.025), 'metal', '#2c2e28', 0.4, { pos: [sx, h - 0.08, d / 2 + 0.012] });
      if (!far) {
        plain(k, new THREE.BoxGeometry(0.28, 0.05, 0.004), '#d8d0a8', 0.9, 0, { pos: [0.02, 0.2, d / 2 + 0.0005] });
        plain(k, new THREE.BoxGeometry(0.22, 0.03, 0.004), '#c8b04a', 0.9, 0, { pos: [0.02, 0.14, d / 2 + 0.0005] });
      }
    }
  },
  barrier(k, v) {
    const rnd = rngOf(60 + v);
    if (v === 0) {
      // jersey barrier profile: wide foot, slanted lower face, narrow top; chipped, with bar showing at a broken end
      const pts = [[-0.3, 0], [0.3, 0], [0.3, 0.06], [0.16, 0.17], [0.1, 0.46], [-0.1, 0.46], [-0.16, 0.17], [-0.3, 0.06]];
      const s = new THREE.Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
      const g = new THREE.ExtrudeGeometry(s, { depth: 1.96, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: far ? 1 : 2 });
      g.translate(0, 0, -0.98);
      g.rotateY(Math.PI / 2);
      put(k, g, 'concrete', '#a5a39b', 0.7);
      if (!far) {
        for (const s2 of [-1, 1]) for (const x of [-0.6, 0.6]) plain(k, new THREE.BoxGeometry(0.2, 0.035, 0.02), '#1f1f1d', 0.9, 0, { pos: [x, 0.03, s2 * 0.295] });   // fork pockets
        for (let i = 0; i < 4; i++) plain(k, new THREE.BoxGeometry(0.075, 0.012, 0.19), i % 2 ? '#a82d26' : '#d8d6cc', 0.55, 0, { pos: [-0.45 + i * 0.3, 0.466, 0], rot: [0, 0, 0] });   // painted top stripes
        rebar(k, 1.0, 0.32, 0.03, 0.3, -1.3, 0.0, 0.9); rebar(k, 1.0, 0.24, -0.05, 0.22, -1.2, 0.4, 0.9);
        for (let i = 0; i < 2; i++) { const x = rnd() * 0.5 - 0.7; put(k, jbox(0.12, 0.05, 0.1, rnd, 0.3), 'concrete', '#9b9b94', 0.8, { pos: [x + i * 1.1, 0.03, (i ? 1 : -1) * 0.42], rot: [0, rnd() * 3, 0] }); }
      }
    } else {
      // a wire-mesh bastion cell: liner, soil and the welded cage
      for (let c = 0; c < 2; c++) {
        const cx = (c - 0.5) * 1.0, L = 0.97;
        put(k, jbox(L - 0.02, 0.47, 0.56, rnd, 0.025), 'cloth', tone('#b4a98a', rnd, 0.08), 0.7, { pos: [cx, 0.235, 0] });
        put(k, jbox(L - 0.08, 0.03, 0.5, rnd, 0.1), 'cloth', tone('#6b5d46', rnd, 0.1), 0.9, { pos: [cx, 0.465, 0] });
        for (let i = 0; i < (far ? 2 : 4); i++) put(k, lump(0.17 + rnd() * 0.08, 0.05, 0.14 + rnd() * 0.06, 90 + c * 7 + i), 'cloth', tone('#6b5d46', rnd, 0.1), 0.9, { pos: [cx + (i - 1.5) * 0.22, 0.455, (rnd() - 0.5) * 0.25] });
        if (far) continue;
        const wc = '#2c302d';
        for (let i = 0; i <= 6; i++) for (const s of [-1, 1]) put(k, new THREE.BoxGeometry(0.009, 0.5, 0.009), 'metal', wc, 0.4, { pos: [cx - L / 2 + 0.01 + (i / 6) * (L - 0.02), 0.25, s * 0.285] });
        for (let i = 0; i <= 3; i++) for (const s of [-1, 1]) put(k, new THREE.BoxGeometry(0.009, 0.5, 0.009), 'metal', wc, 0.4, { pos: [cx + s * (L / 2 - 0.005), 0.25, -0.28 + (i / 3) * 0.56] });
        for (const y of [0.16, 0.32, 0.49]) for (const s of [-1, 1]) {
          put(k, new THREE.BoxGeometry(L, 0.009, 0.009), 'metal', wc, 0.4, { pos: [cx, y, s * 0.285] });
          put(k, new THREE.BoxGeometry(0.009, 0.009, 0.57), 'metal', wc, 0.4, { pos: [cx + s * (L / 2 - 0.005), y, 0] });
        }
      }
    }
  },
  drum(k, v) {
    const rnd = rngOf(80 + v);
    const seg = far ? 9 : 22;
    // a 200 litre drum: chimed ends, two rolling hoops, a flat top with a big and a small bung
    put(k, turnedY([[0, 0], [0.238, 0], [0.248, 0.012], [0.248, 0.07], [0.258, 0.085], [0.248, 0.1], [0.248, 0.26], [0.258, 0.275], [0.248, 0.29], [0.248, 0.45], [0.258, 0.465], [0.248, 0.48], [0.248, 0.555], [0.26, 0.572], [0.236, 0.58], [0.2, 0.572], [0.2, 0.566], [0, 0.566]], seg), 'metal', '#aaa796', 0.75);
    if (far) return;
    put(k, turnedY([[0, 0], [0.05, 0], [0.05, 0.02], [0.042, 0.026], [0, 0.026]], 10), 'metal', '#8a8e90', 0.7, { pos: [0.11, 0.56, 0.02] });
    put(k, ring(0.058, 0.008, 12), 'metal', '#74777a', 0.7, { pos: [0.11, 0.568, 0.02], rot: [Math.PI / 2, 0, 0] });
    put(k, turnedY([[0, 0], [0.028, 0], [0.028, 0.016], [0, 0.016]], 8), 'metal', '#8a8e90', 0.7, { pos: [-0.1, 0.56, -0.07] });
    put(k, ring(0.034, 0.005, 10), 'metal', '#74777a', 0.7, { pos: [-0.1, 0.564, -0.07], rot: [Math.PI / 2, 0, 0] });
    // a dented patch of lighter paint and a hazard band
    plain(k, new THREE.CylinderGeometry(0.2495, 0.2495, 0.03, 20, 1, true), v === 2 ? '#d8c43a' : '#c8c2b0', 0.55, 0.2, { pos: [0, 0.34, 0] });
  },
  wall(k, v) {
    const rnd = rngOf(100 + v);
    if (v === 0) {
      // welded armour plate on skid feet: plates, flat-bar frame, diagonal braces and bullet strikes
      const pc = '#5a6159';
      for (let i = 0; i < 3; i++) put(k, jbox(0.82, 1.28, 0.04, rnd, 0.012), 'metal', tone(pc, rnd, 0.05), 0.55, { pos: [-0.84 + i * 0.84, 0.82, 0] });
      for (const y of [0.18, 0.5, 1.4]) put(k, new THREE.BoxGeometry(2.56, 0.07, 0.07), 'metal', '#3d433c', 0.6, { pos: [0, y, 0] });
      for (const x of [-1.27, -0.42, 0.42, 1.27]) put(k, new THREE.BoxGeometry(0.07, 1.4, 0.07), 'metal', '#3d433c', 0.6, { pos: [x, 0.76, 0] });
      for (const x of [-1.15, 1.15]) put(k, profile([[-0.42, 0], [0.42, 0], [0.06, 0.9], [-0.06, 0.9]], 0.07, 0.006), 'metal', '#34382f', 0.65, { pos: [x, 0, 0.0] });
      for (const x of [-0.42, 0.42]) put(k, profile([[-0.4, 0], [0.4, 0], [0.04, 0.7], [-0.04, 0.7]], 0.06, 0.006), 'metal', '#34382f', 0.65, { pos: [x, 0, 0.0] });
      if (!far) {
        for (let i = 0; i < 14; i++) {   // strikes: shallow dark domes with a bright scar
          const x = (rnd() - 0.5) * 2.3, y = 0.3 + rnd() * 1.0, r = 0.018 + rnd() * 0.02, sd = rnd() < 0.5 ? 1 : -1;
          put(k, new THREE.SphereGeometry(r, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), 'metal', '#1c1d1b', 1, { pos: [x, y, sd * 0.02], rot: [sd * Math.PI / 2, 0, 0], scale: [1, 0.35, 1] });
        }
        for (const x of [-0.42, 0.42]) for (let y = 0.2; y < 1.4; y += 0.17) for (const sd of [-1, 1]) put(k, new THREE.SphereGeometry(0.014, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2), 'metal', '#2d322b', 0.5, { pos: [x, y, sd * 0.035], rot: [sd * Math.PI / 2, 0, 0] });   // rivets down the seams
        put(k, new THREE.BoxGeometry(0.5, 0.1, 0.05), 'metal', '#25271f', 0.5, { pos: [0.55, 1.12, 0.0] });   // slot frame over the plate
        plain(k, new THREE.BoxGeometry(0.42, 0.045, 0.06), '#0c0d0c', 0.9, 0, { pos: [0.55, 1.12, 0.0] });
        plain(k, new THREE.BoxGeometry(0.22, 0.05, 0.003), '#c7bf8a', 0.9, 0, { pos: [-0.9, 1.15, 0.0225] });
      }
    } else {
      // corrugated sheet on two posts, rusted through, one sheet bent away
      const sheet = (w, h, t = 0.012) => {
        const pitch = 0.13, nx = Math.max(6, Math.round((w / pitch) * 4));
        const pos = [], idx = [];
        for (let r = 0; r < 2; r++) for (let i = 0; i <= nx; i++) { const x = -w / 2 + (i / nx) * w; pos.push(x, (r ? 1 : 0) * h, Math.sin((x / pitch) * Math.PI * 2) * 0.022); }
        for (let i = 0; i < nx; i++) idx.push(i, i + 1, nx + 1 + i, i + 1, nx + 2 + i, nx + 1 + i);
        const f = new THREE.BufferGeometry(); f.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); f.setIndex(idx);
        const b = f.clone(); b.translate(0, 0, -t); const bi = b.index.array; for (let i = 0; i < bi.length; i += 3) { const a = bi[i + 1]; bi[i + 1] = bi[i + 2]; bi[i + 2] = a; }
        const m = new THREE.BufferGeometry(); const mp = [...f.attributes.position.array, ...b.attributes.position.array]; m.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
        m.setIndex([...f.index.array, ...[...b.index.array].map((v) => v + pos.length / 3)]);
        return m.toNonIndexed();
      };
      const cols = ['#6b7068', '#5f675d', '#767a6e', '#6a6f78', '#585f55'];
      for (let i = 0; i < 5; i++) {
        const h = i === 3 ? 0.95 : 1.28 + (rnd() - 0.5) * 0.08;
        const g = sheet(0.52, h);
        g.computeVertexNormals();
        put(k, g, 'metal', tone(cols[i], rnd, 0.1), 1, { pos: [-1.04 + i * 0.52, 0.05, 0.0], rot: [i === 3 ? 0.0 : 0, 0, i === 4 ? -0.03 : 0] });
      }
      for (const x of [-1.2, 0, 1.2]) put(k, new THREE.BoxGeometry(0.075, 1.5, 0.075), 'metal', '#4a3a2c', 0.9, { pos: [x, 0.75, -0.06] });
      for (const y of [0.35, 1.2]) put(k, new THREE.BoxGeometry(2.5, 0.06, 0.05), 'wood', '#5a4129', 0.8, { pos: [0, y, -0.015], ax: 0 });
      for (const x of [-0.6, 0.6]) put(k, profile([[-0.5, 0], [0.5, 0], [0.04, 1.0], [-0.04, 1.0]], 0.05, 0.005), 'metal', '#3a3228', 0.9, { pos: [x, 0, -0.1], scale: [1, 1, 0.6] });
    }
  },
  trap(k) {
    // a Czech hedgehog: three angle-iron beams crossed at the middle, stood on three of their ends
    const rnd = rngOf(120);
    const L = 1.2, w = 0.11, t = 0.014;
    const ang = new THREE.Shape();
    ang.moveTo(-w / 2, -w / 2); ang.lineTo(w / 2, -w / 2); ang.lineTo(w / 2, -w / 2 + t); ang.lineTo(-w / 2 + t, -w / 2 + t); ang.lineTo(-w / 2 + t, w / 2); ang.lineTo(-w / 2, w / 2);
    const beamG = new THREE.ExtrudeGeometry(ang, { depth: L, bevelEnabled: false });
    beamG.translate(0, 0, -L / 2);
    // rotate the cluster so one body diagonal stands upright
    const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0));
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const qs = axes.map((a, i) => tilt.clone().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), a)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), i * 1.9)));
    // stand it on its three lowest ends: find the lowest vertex of the posed beams and drop the whole cluster onto the ground
    let low = 1e9;
    const posed = qs.map((q) => { const g = beamG.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)); g.computeBoundingBox(); low = Math.min(low, g.boundingBox.min.y); return g; });
    const cy = -low - 0.004;
    posed.forEach((g, i) => {
      put(k, g, 'metal', tone('#4a4d49', rnd, 0.08), 0.85, { pos: [0, cy, 0] });
      const a = axes[i], q = qs[i];
      if (!far) for (const s of [-1, 1]) {
        const e = a.clone().multiplyScalar(s * (L / 2 - 0.05)).applyQuaternion(tilt).add(new THREE.Vector3(0, -w / 2 + t / 2, 0).applyQuaternion(q));
        put(k, new THREE.CylinderGeometry(0.014, 0.014, 0.024, 6), 'metal', '#2a2c2a', 1, { pos: [e.x, cy + e.y, e.z], rot: new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3) });
      }
    });
    put(k, new THREE.OctahedronGeometry(0.12, 0), 'metal', '#3c3f3b', 0.9, { pos: [0, cy, 0] });   // the gusset where they cross
  },
  slab(k, v) {
    const rnd = rngOf(140 + v);
    // cast panel: a silhouette with a broken top, joints, form-tie holes, a shell hole in the second
    const s = new THREE.Shape(), holeRim = [];
    const top = (x) => (v === 0 ? (x < -1.2 ? 2.28 - Math.max(0, (-x - 1.2)) * 0.1 : x < 0.2 ? 2.28 : x < 1.5 ? 2.28 - (x - 0.2) * 0.9 : 1.1 + (x - 1.5) * 1.0) : (x < -0.6 ? 2.28 : 2.28 - (x + 0.6) * 0.2 * (x > 1.4 ? 3 : 1)));
    s.moveTo(-2.2, 0.15);
    s.lineTo(2.2, 0.15);
    const nx = far ? 6 : 16;
    for (let i = nx; i >= 0; i--) { const x = -2.2 + (4.4 * i) / nx; s.lineTo(x, Math.max(0.5, top(x) + (i % 2 ? -0.04 : 0.03) * (rnd() + 0.3))); }
    if (v === 1) { const h = new THREE.Path(), hx = -0.25, hy = 1.25, n = far ? 6 : 12; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = 0.5 * (0.8 + rnd() * 0.45); const px = hx + Math.cos(a) * r, py = hy + Math.sin(a) * r * 0.9; holeRim.push([px, py]); i ? h.lineTo(px, py) : h.moveTo(px, py); } s.holes.push(h); }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.36, bevelEnabled: false });
    g.translate(0, 0, -0.18);
    put(k, g, 'concrete', '#a09d94', 0.75);
    put(k, jbox(4.5, 0.17, 0.5, rnd, 0.02), 'concrete', '#8f8c84', 0.8, { pos: [0, 0.085, 0] });
    for (const x of [-1.1, 1.1]) { const hh = Math.min(1.8, top(x) - 0.2); put(k, new THREE.BoxGeometry(0.06, hh - 0.15, 0.4), 'metal', '#232422', 0.5, { pos: [x, 0.15 + (hh - 0.15) / 2, 0] }); }   // joint seals, flush with each face
    if (!far) {
      for (const sd of [-1, 1]) for (let i = 0; i < 8; i++) for (const y of [0.5, 1.05, 1.6]) {
        const x = -1.9 + i * 0.55 + (i > 3 ? 0.1 : 0);
        if (Math.abs(x - 1.1) < 0.1 || Math.abs(x + 1.1) < 0.1) continue;
        if (y > top(x) - 0.15) continue;
        if (v === 1 && Math.hypot(x + 0.25, (y - 1.25) / 0.9) < 0.75) continue;
        plain(k, new THREE.CylinderGeometry(0.02, 0.02, 0.008, 6), '#3a3935', 0.95, 0, { pos: [x, y, sd * 0.1795 + sd * 0.0025], rot: [Math.PI / 2, 0, 0] });
      }
      if (v === 0) { for (let i = 0; i < 7; i++) rebar(k, 0.3 + i * 0.17, top(0.3 + i * 0.17) - 0.04, (i % 2 ? 1 : -1) * 0.05, 0.3 + (i % 3) * 0.12, ((i % 3) - 1) * 0.35, i); }
      else for (let i = 0; i < holeRim.length; i += 2) { const [px, py] = holeRim[i], dx = -0.25 - px, dy = 1.25 - py, th = Math.atan2(-dx, dy); put(k, new THREE.CylinderGeometry(0.011, 0.011, 0.3 + (i % 3) * 0.1, 5).translate(0, 0.15, 0), 'metal', '#58392a', 1, { pos: [px - dx * 0.03, py - dy * 0.03, (i % 4) * 0.02 - 0.03], rot: [0, 0, th] }); }
      for (let i = 0; i < 5; i++) fallen(k, 'concrete', '#9a978e', rnd, -1.9 + i * 0.95 + rnd() * 0.3, (i % 2 ? -1 : 1) * 0.48, 0.3 + rnd() * 0.25, 0.14, 0.2 + rnd() * 0.1, 0.8);
    }
  },
  bunker(k, v) {
    const rnd = rngOf(160 + v);
    // a squat pillbox: thick walls with a firing slit on every face, an overhanging roof under a skin of earth
    const T = 0.62, W = 3.3, H = 1.7;
    plain(k, new THREE.BoxGeometry(W - 2 * T + 0.1, H - 0.1, W - 2 * T + 0.1), '#0b0b0a', 0.95, 0, { pos: [0, H / 2, 0] });   // the dark inside, seen through the slits
    for (let a = 0; a < 4; a++) {
      const r = (a * Math.PI) / 2, len = a % 2 ? W - 2 * T + 0.04 : W;
      const wall = [[0, 0.95, 0], [1.25, H, 0]];  // below the sill and above the lintel
      const g = (w, y0, y1, x) => put(k, jbox(w, y1 - y0, T, rnd, 0.025), 'concrete', tone('#9b9b94', rnd, 0.05), 0.7, { pos: [x, (y0 + y1) / 2, W / 2 - T / 2], rot: [0, r, 0] });
      void len; void wall;
      const rot = (x, y, z) => { const c = Math.cos(r), s = Math.sin(r); return [x * c + z * s, y, -x * s + z * c]; };
      const seg = (w, y0, y1, x, zc = W / 2 - T / 2) => put(k, jbox(w, y1 - y0, T, rnd, 0.025), 'concrete', tone('#9b9b94', rnd, 0.05), 0.7, { pos: rot(x, (y0 + y1) / 2, zc), rot: [0, r, 0] });
      void g;
      const inner = a % 2 ? W - 2 * T : W;
      seg(inner, 0, 0.95, 0); seg(inner, 1.25, H, 0);
      seg((inner - 1.1) / 2, 0.95, 1.25, -(inner + 1.1) / 4); seg((inner - 1.1) / 2, 0.95, 1.25, (inner + 1.1) / 4);
    }
    put(k, jbox(W + 0.4, 0.3, W + 0.4, rnd, 0.015), 'concrete', '#8f8c84', 0.8, { pos: [0, H + 0.15, 0] });
    // an earth cover on the roof, tufted, and a berm banked round the foot
    for (let i = 0; i < (far ? 5 : 11); i++) { const a = rnd() * 6.28, r = rnd() * 1.1; plain(k, lump(0.7 + rnd() * 0.5, 0.1, 0.6 + rnd() * 0.4, 170 + i, false), tone(i % 3 ? '#5e5440' : '#565a3a', rnd, 0.1, 0.1), 0.95, 0, { pos: [Math.cos(a) * r, H + 0.31, Math.sin(a) * r] }); }
    for (let i = 0; i < (far ? 6 : 12); i++) { const a = (i / (far ? 6 : 12)) * Math.PI * 2 + rnd() * 0.3, r = 2.05 + rnd() * 0.15; plain(k, lump(1.0 + rnd() * 0.3, 0.2 + rnd() * 0.06, 0.7, 180 + i), tone('#554c39', rnd, 0.1, 0.1), 0.96, 0, { pos: [Math.cos(a) * r, 0.0, Math.sin(a) * r], rot: [0, a + 1.57, 0] }); }
    if (!far) {
      put(k, new THREE.BoxGeometry(0.9, 1.3, 0.06), 'metal', '#3a3f38', 0.6, { pos: [0.6, 0.75, -(W / 2 + 0.03)] });
      put(k, new THREE.BoxGeometry(1.05, 0.08, 0.1), 'metal', '#2c2f2a', 0.6, { pos: [0.6, 1.43, -(W / 2 + 0.05)] });
      for (let i = 0; i < 5; i++) rebar(k, 1.3 + (i % 3) * 0.12, H + 0.25, 1.4 - i * 0.1, 0.4 + (i % 2) * 0.15, 0.4 - i * 0.12, i * 1.3);
      for (let i = 0; i < 7; i++) fallen(k, 'concrete', '#9a978e', rnd, Math.cos(i * 0.9) * 2.3, Math.sin(i * 0.9) * 2.3, 0.3 + rnd() * 0.2, 0.15, 0.25, 0.85);
    }
  },
  ruin(k, v) {
    const rnd = rngOf(200 + v);
    // a house wall: a broken skyline, window and door openings with their lintels, patches of plaster, charred rafters
    const top = v === 0
      ? (x) => (x < -1.2 ? 2.0 : x < -0.2 ? 1.75 : x < 0.9 ? 1.5 - (x - -0.2) * 0.2 : x < 1.5 ? 1.15 : 0.9)
      : (x) => (x < -1.4 ? 1.1 : x < -0.4 ? 1.9 : x < 0.6 ? 2.05 : x < 1.3 ? 1.6 : 1.25);
    const holes = v === 0 ? [{ x0: -1.0, x1: -0.35, y0: 0.9, y1: 1.5 }] : [{ x0: -0.95, x1: -0.4, y0: 0.85, y1: 1.45 }, { x0: 0.35, x1: 1.0, y0: 0.0, y1: 1.4 }];
    masonry(k, { x0: -2.0, x1: 2.0, thick: 0.44, top, holes, seed: 101 + v * 50, ymax: 2.2 });
    for (const h of holes) {
      const lw = h.x1 - h.x0, mid = (h.x0 + h.x1) / 2;
      put(k, jbox(lw + 0.5, 0.15, 0.5, rnd, 0.03), 'concrete', '#a09d94', 0.7, { pos: [mid, h.y1 + 0.075, 0] });                      // the lintel
      if (h.y0 > 0.1) put(k, jbox(lw + 0.3, 0.07, 0.56, rnd, 0.03), 'concrete', '#a09d94', 0.8, { pos: [mid, h.y0 - 0.02, 0] });  // sill
      else for (const sd of [-1, 1]) put(k, jbox(0.1, h.y1, 0.1, rnd, 0.05), 'wood', '#2e2218', 1, { pos: [h.x0 + sd * 0.0 + (sd > 0 ? lw : 0) + (sd > 0 ? -0.04 : 0.04), h.y1 / 2, 0.0], ax: 1 });   // charred door posts
      if (h.y0 > 0.1 && !far) { put(k, jbox(0.06, 0.62, 0.08, rnd, 0.06), 'wood', '#2e2218', 1, { pos: [h.x0 + 0.06, h.y0 + 0.31, 0.04], ax: 1 }); put(k, jbox(lw * 0.55, 0.05, 0.07, rnd, 0.06), 'wood', '#2e2218', 1, { pos: [h.x0 + 0.06 + lw * 0.275, h.y0 + 0.28, 0.04], ax: 0 }); }   // what is left of the sash
    }
    if (!far) {
      plaster(k, v ? -1.4 : -1.5, 1.1, 1.2, 0.9, 0.23, 1 + v); plaster(k, 0.5, 0.55, 1.1, 0.55, -0.23, 3 + v); plaster(k, v ? 0.8 : -1.0, 1.7, 0.9, 0.6, -0.23, 5);
    }
    put(k, jbox(4.1, 0.14, 0.52, rnd, 0.015), 'stone', '#7c766a', 0.7, { pos: [0, 0.07, 0] });    // footing
    // the roof is gone: charred rafters stick out of the wall, one has fallen across the rubble
    const base = (x) => Math.floor((top(x) + 0.02) / 0.1) * 0.1;
    for (const [x, len, tilt] of [[-1.55, 0.9, -0.5], [-0.8, 1.1, -0.4], [0.25, 0.7, 0.35]]) {
      const bx = v ? x + 0.9 : x;
      beam(k, bx, base(bx) - 0.04 + (len / 2) * Math.cos(tilt * 0.5), 0.1, len, tilt * 0.5, [0, 0, 0], 20 + v);
    }
    beam(k, 0.9, 0.3, 0.75, 1.9, 0, [1.25, 0.2, 0], 30);
    // floor slab and tile where the room was, spilled masonry
    put(k, jbox(2.6, 0.06, 1.3, rnd, 0.01), 'concrete', '#8f8c84', 0.8, { pos: [-0.4, 0.03, 0.9] });
    const n = far ? 5 : 12;
    for (let i = 0; i < n; i++) fallen(k, 'stone', BRICK[i % BRICK.length], rnd, -1.9 + (i / n) * 3.9 + rnd() * 0.2, (i % 2 ? 0.45 : -0.42) + (rnd() - 0.5) * 0.3, 0.3, 0.1, 0.15, 0.7);
    for (let i = 0; i < (far ? 3 : 6); i++) put(k, grounded(lump(0.28, 0.11, 0.22, 700 + i)), 'stone', tone(BLOCK[i % 4], rnd), 0.7, { pos: [-1.8 + i * 0.7, 0, 0.7 + (i % 2) * 0.25], rot: [0, i, 0] });
    if (!far) { rebar(k, -1.9, top(-1.9) - 0.02, 0.05, 0.5, 0.35, 0.3); rebar(k, -1.75, top(-1.75) - 0.02, -0.08, 0.38, -0.3, 1.2); }
  },
  ruinLow(k, v) {
    const rnd = rngOf(240 + v);
    const top = v === 0 ? (x) => 0.74 - Math.max(0, x - 0.6) * 0.25 : (x) => (x < -0.9 ? 0.6 : x < -0.1 ? 0.78 - (x + 0.9) * 0.1 : x < 0.9 ? 0.0 : 0.7);
    const holes = v === 1 ? [{ x0: -0.1, x1: 0.9, y0: 0.0, y1: 0.8 }] : [];
    masonry(k, { x0: -1.5, x1: 1.5, thick: 0.44, top, holes, seed: 202 + v * 30, ymax: 0.85, palette: v ? BLOCK : BRICK });
    put(k, jbox(3.1, 0.12, 0.52, rnd, 0.015), 'stone', '#7c766a', 0.7, { pos: [0, 0.06, 0] });
    const n = far ? 4 : 11;
    for (let i = 0; i < n; i++) fallen(k, 'stone', (v ? BLOCK : BRICK)[i % 4], rnd, -1.5 + (i / n) * 3.0 + rnd() * 0.2, (i % 2 ? 1 : -1) * (0.34 + rnd() * 0.2), 0.3, 0.1, 0.15, 0.7);
    if (v === 1) put(k, jbox(1.3, 0.14, 0.34, rnd, 0.04), 'concrete', '#a09d94', 0.8, { pos: [0.4, 0.07, 0.5], rot: [0, 0.2, 0] });   // the fallen lintel
  },
  rubble(k) {
    const rnd = rngOf(280);
    for (let i = 0; i < (far ? 5 : 10); i++) {
      const a = i * 2.4, r = (i / 10 + 0.2);
      if (i % 3 === 0) fallen(k, 'stone', BRICK[i % 6], rnd, Math.cos(a) * 0.7 * r, Math.sin(a) * 0.3 * r, 0.32, 0.1, 0.16, 0.7);
      else put(k, grounded(lump(0.26 - (i % 3) * 0.04, 0.12, 0.2, 500 + i)), 'stone', tone(BLOCK[i % 4], rnd), 0.8, { pos: [Math.cos(a) * 0.75 * r, 0, Math.sin(a) * 0.32 * r], rot: [0, a, 0] });
    }
    if (!far) { fallen(k, 'wood', '#3a2a1c', rnd, 0.2, 0.1, 0.7, 0.05, 0.1, 0.9, 0.1); rebar(k, -0.3, 0.1, 0.0, 0.3, 1.2, 0.5); }
  },
  stonewall(k, v) {
    const rnd = rngOf(300 + v);
    // dry-stone field wall: two faces of coursed stones with through-stones, capped with flat slabs; the second has slumped
    const rowsY = [0.0, 0.14, 0.28, 0.42];
    const gap = v === 1 ? [-0.2, 0.55] : [9, 9];
    rowsY.forEach((y, ri) => {
      let x = -1.6 + (ri % 2) * 0.12;
      while (x < 1.55 - ri * 0.04) {
        const w = 0.28 + rnd() * 0.3, hh = 0.13 + rnd() * 0.03, xm = x + w / 2;
        x += w + 0.01;
        if (xm > gap[0] && xm < gap[1] && ri > 0) continue;
        if (far) { put(k, jbox(w, hh, 0.5 - ri * 0.06, rnd, 0.14), 'stone', tone(BLOCK[Math.floor(rnd() * 4)], rnd, 0.1), 0.6, { pos: [xm, y + hh / 2, 0] }); continue; }
        for (const z of [-0.12, 0.12]) put(k, jbox(w, hh, 0.17 + rnd() * 0.05, rnd, 0.14), 'stone', tone(BLOCK[Math.floor(rnd() * 4)], rnd, 0.1), 0.6, { pos: [xm, y + hh / 2, z * (1 - ri * 0.12)], rot: [0, (rnd() - 0.5) * 0.14, 0] });
        if (ri < 3) put(k, jbox(w * 0.8, hh * 0.9, 0.2, rnd, 0.1), 'stone', tone(BLOCK[2], rnd), 0.6, { pos: [xm, y + hh * 0.45, 0] });
      }
    });
    let x = -1.55;
    while (x < 1.5) { const w = 0.34 + rnd() * 0.2; x += w; if (x > gap[0] && x < gap[1]) continue; put(k, jbox(w, 0.08, 0.34, rnd, 0.12), 'stone', tone(BLOCK[1], rnd, 0.1), 0.7, { pos: [x - w / 2, 0.56 + 0.04 - 0.01, 0], rot: [0, (rnd() - 0.5) * 0.15, 0] }); }
    if (v === 1) for (let i = 0; i < (far ? 3 : 7); i++) fallen(k, 'stone', BLOCK[i % 4], rnd, 0.1 + i * 0.12, (i % 2 ? 1 : -1) * (0.32 + rnd() * 0.12), 0.28, 0.13, 0.2, 0.6);
  },
  rock(k, v) {
    const rnd = rngOf(330 + v);
    if (v === 0) {
      put(k, grounded(boulder(0.95, 0.75, 0.8, 9)), 'stone', '#7a786f', 0.8, { pos: [0, 0, 0] });
      put(k, grounded(boulder(0.4, 0.3, 0.35, 21)), 'stone', '#6f6d64', 0.8, { pos: [0.75, 0, 0.45] });
      put(k, grounded(boulder(0.3, 0.22, 0.28, 33)), 'stone', '#85827a', 0.7, { pos: [-0.8, 0, -0.35] });
    } else {
      // an outcrop of tilted strata
      for (let i = 0; i < 5; i++) put(k, jbox(1.3 - i * 0.18, 0.2 + rnd() * 0.06, 0.9 - i * 0.1, rnd, 0.18), 'stone', tone(['#7a786f', '#838077', '#6d6b62'][i % 3], rnd, 0.08), 0.8, { pos: [(rnd() - 0.5) * 0.2, 0.09 + i * 0.19, (rnd() - 0.5) * 0.1], rot: [0.04 * (i % 2 ? 1 : -1), i * 0.7, 0.05] });
      for (let i = 0; i < (far ? 2 : 4); i++) put(k, grounded(lump(0.25, 0.14, 0.2, 40 + i)), 'stone', '#6f6d64', 0.8, { pos: [-0.9 + i * 0.55, 0, 0.55 * (i % 2 ? -1 : 1)] });
    }
  },
};

export const VARIANTS = { sandbags: 2, crate: 2, barrier: 2, drum: 3, wall: 2, slab: 2, bunker: 1, ruin: 2, ruinLow: 2, stonewall: 2, rock: 2, trap: 1, rubble: 1 };

// `lite` builds the far copy
export function buildProp(type, v = 0, lite = false) {
  const was = far;
  far = lite;
  try { const k = new Kit(); BUILD[type](k, v); return k; } finally { far = was; }
}
export const PROP_TYPES = Object.keys(BUILD);
export { turnedY, roundBlock, rngOf, tone, put, plain, grounded, rebar, fallen, boulder, U as UBER };
export const setFar = (v) => { far = v; };
export const isFar = () => far;
