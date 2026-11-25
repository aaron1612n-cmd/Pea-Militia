import * as THREE from 'three';
import { loftY, loft, ringY, ringZ, lathe, patch, plate, pad, rod, tubePath, ribbon, aim, xf, done, merge, paint, sstep } from './shapes.js';

// Full-face headgear, one per class, in the head's frame (origin at the base of the neck, +z
// forward, y up, the skull centred 0.098 up). Every face is covered: a visor, goggles or a mask,
// so there is no modelled face to get wrong, and the class reads from the helmet's silhouette:
//   rifleman  combat helmet, drop-down visor, night-vision mount, mandible guard
//   assault   high-cut helmet, wrap goggles, angular ballistic mask, trailing scarf
//   gunner    tall riot helmet, slit visor, grille chin guard, neck shield, crest
//   mortar    wide-brim steel pot, round goggles, respirator with canister and hoses
//   coil      sealed pressure helmet, domed glowing visor, side emitters, antenna
//   medic     white helmet with red crosses, clear goggles, twin-canister respirator
// Pieces are sunk a few millimetres into what they sit on so nothing floats. Vertex colour is a
// brightness (or tint) that the instance colour (the army's helmet colour) multiplies.
const V = THREE.Vector3;
const HC = 0.098; // head centre height
const RAD = Math.PI / 180;

// envelope of a stack of stations: radii and centre at height y
function envelope(st) {
  return (y) => {
    if (y <= st[0].t) return st[0];
    for (let i = 1; i < st.length; i++) if (y <= st[i].t) {
      const a = st[i - 1], b = st[i], k = (y - a.t) / (b.t - a.t || 1);
      return { rx: a.rx + (b.rx - a.rx) * k, rz: (a.rz ?? a.rx) + ((b.rz ?? b.rx) - (a.rz ?? a.rx)) * k, cz: (a.cz ?? 0) + ((b.cz ?? 0) - (a.cz ?? 0)) * k };
    }
    return st[st.length - 1];
  };
}
// a patch hugging a stack of stations: rows run up the y axis, columns around by angle (radians,
// 0 straight ahead, positive toward +x). range(y) gives the angle span at that height.
function onShell(E, { y0, y1, range, off = 0, thick = 0.006, bevel = 0.004, bulge = 0, rows = 6, cols = 8, sink = 0.004, edge = 0.4, crease = 45, walls = true, k = 1 }) {
  return patch({
    surf: (u, v) => { const e = E(v); return new V(e.rx * k * Math.sin(u), v, e.cz + e.rz * k * Math.cos(u)); },
    v0: y0, v1: y1, range, rows: Math.ceil(rows * 1.4), cols: Math.ceil(cols * 1.5), off, thick, bevel, bulge, sink, edge, crease: crease + 14, uScale: 0.08, walls,
  });
}
// mirror a geometry across x (flips winding so faces stay outward)
function mirror(g) {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const p = m.attributes.position, nrm = m.attributes.normal;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, nrm, m.attributes.color]) if (a) for (let c = 0; c < a.itemSize; c++) { const t = a.array[(i + 1) * a.itemSize + c]; a.array[(i + 1) * a.itemSize + c] = a.array[(i + 2) * a.itemSize + c]; a.array[(i + 2) * a.itemSize + c] = t; }
  }
  return m;
}
const both = (l, g, shade) => { const a = done(g, shade); l.push(a); l.push(mirror(a)); };
const bit = (l, g, shade, at) => l.push(done(g, shade, at));

const SHELL_COL = 0.86;
const LENS = 0.05;

// ---------- shared pieces ----------
// a dome shell from stations; the lower rim gets a rolled lip
function shell(st, { n = 16, p = 2.3, crease = 0 } = {}) {
  return loftY(st, { n: Math.max(n, 24), p, sub: 3 }, { crease, cap0: false, cap1: true });
}
// a stud/boss: short turned cylinder along z at (x, y, z) pointing forward
function boss(r, len, x, y, z, { n = 8, shade = 0.5, dir = [0, 0, 1] } = {}) {
  const g = lathe([[r * 0.0, 0], [r, 0], [r, len * 0.8], [r * 0.7, len]], { n });
  return done(aim(g, [x, y, z], dir), shade);
}

// ======================================================================================
export const HELMET = {};

// ---- rifleman: combat helmet with a full visor and night-vision mount ------------------
HELMET.rifleman = () => {
  const st = [
    { t: 0.056, rx: 0.081, rz: 0.089, cz: -0.008 }, { t: 0.078, rx: 0.086, rz: 0.095, cz: -0.008 }, { t: 0.108, rx: 0.089, rz: 0.099, cz: -0.008 },
    { t: 0.137, rx: 0.087, rz: 0.097, cz: -0.008 }, { t: 0.163, rx: 0.075, rz: 0.085, cz: -0.008 }, { t: 0.184, rx: 0.053, rz: 0.062, cz: -0.008 }, { t: 0.198, rx: 0.024, rz: 0.03, cz: -0.008 }, { t: 0.2, rx: 0.003, rz: 0.003, cz: -0.008 },
  ];
  const E = envelope(st), l = [];
  l.push(done(shell(st, { crease: 62 }), SHELL_COL));
  // rolled rim: a ring around the lower edge of the shell
  l.push(done(loftY([{ t: 0.05, rx: 0.081, rz: 0.09, cz: -0.008 }, { t: 0.06, rx: 0.088, rz: 0.097, cz: -0.008 }, { t: 0.068, rx: 0.0875, rz: 0.0965, cz: -0.008 }, { t: 0.074, rx: 0.082, rz: 0.091, cz: -0.008 }], { n: 16, p: 2.3 }, { crease: 40 }), 0.62));
  // heavy brow bar and cheek bars framing the visor
  l.push(done(onShell(E, { y0: 0.128, y1: 0.152, range: () => [-1.15, 1.15], off: 0.004, thick: 0.016, bevel: 0.008, bulge: 0.003, cols: 14, rows: 4 }), 0.58));
  // the visor lens: curved ballistic glass from the brow bar to the cheek
  l.push(done(onShell(E, { y0: 0.066, y1: 0.13, range: (y) => { const w = 1.0 + 0.1 * sstep(0.066, 0.1, y); return [-w, w]; }, off: 0.006, thick: 0.007, bevel: 0.003, bulge: 0.004, cols: 14, rows: 6, k: 1.01 }), LENS));
  // visor frame sides and hinge pivots
  for (const s of [-1, 1]) {
    l.push(done(onShell(E, { y0: 0.064, y1: 0.134, range: () => (s < 0 ? [-1.32, -1.04] : [1.04, 1.32]), off: 0.003, thick: 0.014, bevel: 0.006, cols: 3, rows: 6, k: 1.0 }), 0.6));
    l.push(boss(0.0085, 0.01, s * 0.087, 0.118, 0.012, { dir: [s, 0, 0], shade: 0.9 }));
  }
  // mandible guard: a faceted chin cup that reaches down toward the neck
  l.push(done(onShell((y) => ({ rx: 0.062 - 0.02 * sstep(0.07, 0.0, y), rz: 0.074 - 0.014 * sstep(0.07, 0.0, y), cz: 0.012 }), { y0: 0.004, y1: 0.07, range: (y) => { const w = 1.12 * (0.45 + 0.55 * sstep(0.004, 0.06, y)); return [-w, w]; }, off: 0.0, thick: 0.016, bevel: 0.008, bulge: 0.008, cols: 12, rows: 6, sink: 0.006, crease: 38 }), 0.5));
  // breathing vents on the guard
  for (let i = -1; i <= 1; i++) l.push(done(plate([[-0.006, -0.002], [0.006, -0.002], [0.006, 0.002], [-0.006, 0.002]], 0.004, { bevel: 0.001 }), LENS, { pos: [i * 0.016, 0.046, 0.085] }));
  // night-vision mount: a bracket plate on the brow, an arm, and a stowed tube
  l.push(done(plate([[-0.022, 0], [0.022, 0], [0.018, 0.026], [-0.018, 0.026]], 0.012, { bevel: 0.003 }), 0.4, { pos: [0, 0.148, E(0.15).rz * 0.99 + E(0.15).cz - 0.004], rot: [-0.25, 0, 0] }));
  l.push(done(lathe([[0.0, 0], [0.011, 0], [0.012, 0.03], [0.009, 0.036], [0.0, 0.036]], { n: 8 }), 0.28, { pos: [0, 0.176, 0.098], rot: [Math.PI / 2 + 0.25, 0, 0] }));
  // side rails with accessory slots, ear cups
  for (const s of [-1, 1]) {
    const r = tubePath([[s * 0.0915, 0.07, 0.03], [s * 0.093, 0.09, 0.0], [s * 0.092, 0.11, -0.03]], 0.0045, { n: 5, seg: 4 });
    l.push(done(r, 0.35));
    l.push(done(pad(0.014, 0.026, 0.034, { n: 8, rows: 4 }), 0.42, { pos: [s * 0.088, 0.083, 0.0], rot: [0, 0, s * Math.PI / 2], scale: 1 }));
  }
  // rear counterweight pouch and top strap
  l.push(done(onShell(E, { y0: 0.095, y1: 0.145, range: (y) => [Math.PI - 0.5, Math.PI + 0.5], off: 0.002, thick: 0.014, bevel: 0.006, bulge: 0.004, cols: 8, rows: 4 }), 0.45));
  return merge(l);
};

// ---- assault: high-cut helmet, wrap goggles, ballistic mask, scarf ---------------------------
HELMET.assault = () => {
  const st = [
    { t: 0.082, rx: 0.077, rz: 0.086, cz: -0.01 }, { t: 0.1, rx: 0.083, rz: 0.093, cz: -0.01 }, { t: 0.13, rx: 0.084, rz: 0.095, cz: -0.01 },
    { t: 0.158, rx: 0.074, rz: 0.086, cz: -0.01 }, { t: 0.18, rx: 0.052, rz: 0.062, cz: -0.01 }, { t: 0.193, rx: 0.024, rz: 0.03, cz: -0.01 }, { t: 0.195, rx: 0.003, rz: 0.003, cz: -0.01 },
  ];
  const E = envelope(st), l = [];
  l.push(done(shell(st, { p: 2.6, crease: 62 }), SHELL_COL));
  // the face: goggles in front of the eyes, mask below
  const ES = envelope([{ t: 0.0, rx: 0.052, rz: 0.066, cz: 0.012 }, { t: 0.05, rx: 0.066, rz: 0.078, cz: 0.006 }, { t: 0.1, rx: 0.077, rz: 0.088, cz: -0.004 }, { t: 0.13, rx: 0.08, rz: 0.09, cz: -0.006 }]);
  l.push(done(onShell(E, { y0: 0.082, y1: 0.124, range: () => [-1.38, 1.38], off: 0.005, thick: 0.012, bevel: 0.005, bulge: 0.006, cols: 16, rows: 4, k: 1.02 }), 0.3)); // goggle frame
  l.push(done(onShell(E, { y0: 0.089, y1: 0.119, range: (y) => { const w = 1.26 - 0.1 * Math.abs(y - 0.104) / 0.015; return [-w, w]; }, off: 0.011, thick: 0.007, bevel: 0.003, bulge: 0.004, cols: 16, rows: 4, k: 1.025 }), LENS)); // wrap lens
  // goggle strap around the back of the head
  l.push(done(loftY([{ t: 0.1, rx: 0.0865, rz: 0.0965, cz: -0.01 }, { t: 0.112, rx: 0.0865, rz: 0.0965, cz: -0.01 }], { n: 16, p: 2.3 }, { cap0: false, cap1: false, crease: 40 }), 0.25));
  // angular mask: nose bridge ridge, cheeks, chin; faceted so it reads as armour
  const MASK = (y) => ({ rx: 0.051 + 0.026 * sstep(0.0, 0.08, y), rz: 0.066 + 0.016 * sstep(0.0, 0.08, y), cz: 0.012 - 0.008 * sstep(0.04, 0.09, y) });
  l.push(done(onShell(MASK, { y0: 0.0, y1: 0.084, range: (y) => { const w = 1.22 * (0.5 + 0.5 * sstep(0.0, 0.06, y)); return [-w, w]; }, off: 0.002, thick: 0.018, bevel: 0.01, bulge: 0.01, cols: 10, rows: 6, sink: 0.008, crease: 32 }), 0.4));
  // ridge down the middle of the mask, and two vent grilles
  l.push(done(onShell(MASK, { y0: 0.008, y1: 0.084, range: (y) => [-0.12, 0.12], off: 0.014, thick: 0.01, bevel: 0.005, cols: 2, rows: 6, sink: 0.01, crease: 40 }), 0.62));
  for (const s of [-1, 1]) {
    l.push(done(lathe([[0.0, 0], [0.014, 0], [0.014, 0.012], [0.011, 0.016], [0.0, 0.016]], { n: 8 }), 0.3, { pos: [s * 0.036, 0.04, 0.074], rot: [Math.PI / 2 - 0.2, 0, s * 0.3] }));
    for (let i = -1; i <= 1; i++) l.push(done(plate([[-0.011, -0.0012], [0.011, -0.0012], [0.011, 0.0012], [-0.011, 0.0012]], 0.003, { bevel: 0.0005 }), 0.12, { pos: [s * 0.036, 0.04 + i * 0.0075, 0.0905], rot: [0, 0, 0] }));
  }
  // helmet rails, headlamp, and a rear battery pouch
  for (const s of [-1, 1]) l.push(done(tubePath([[s * 0.0865, 0.092, 0.04], [s * 0.089, 0.12, 0.0], [s * 0.086, 0.14, -0.04]], 0.0042, { n: 5, seg: 4 }), 0.35));
  l.push(done(lathe([[0.0, 0], [0.012, 0], [0.013, 0.014], [0.008, 0.02], [0.0, 0.02]], { n: 8 }), 0.9, { pos: [0.05, 0.16, 0.058], rot: [Math.PI / 2 - 0.5, 0, 0.5] }));
  l.push(done(onShell(E, { y0: 0.1, y1: 0.152, range: () => [Math.PI - 0.45, Math.PI + 0.45], off: 0.002, thick: 0.016, bevel: 0.007, bulge: 0.005, cols: 8, rows: 4 }), 0.42));
  // scarf: a knotted band at the neck and a trailing tail over the shoulder
  l.push(done(loftY([{ t: 0.002, rx: 0.044, rz: 0.044, cz: -0.004 }, { t: 0.03, rx: 0.052, rz: 0.054, cz: -0.002 }, { t: 0.056, rx: 0.056, rz: 0.058, cz: -0.002 }], { n: 12 }, { crease: 0 }), 0.7));
  l.push(done(ribbon([[-0.03, 0.04, -0.05], [-0.05, 0.0, -0.075], [-0.07, -0.05, -0.085], [-0.075, -0.1, -0.08]], 0.036, 0.005, [0, 0, -1], { seg: 8 }), 0.62));
  return merge(l);
};

// ---- gunner: tall riot helmet with a slit visor, grille chin guard and neck shield ---------
HELMET.gunner = () => {
  const st = [
    { t: 0.04, rx: 0.088, rz: 0.098, cz: -0.01 }, { t: 0.07, rx: 0.092, rz: 0.102, cz: -0.01 }, { t: 0.12, rx: 0.093, rz: 0.104, cz: -0.01 },
    { t: 0.16, rx: 0.088, rz: 0.1, cz: -0.01 }, { t: 0.186, rx: 0.068, rz: 0.078, cz: -0.01 }, { t: 0.198, rx: 0.036, rz: 0.044, cz: -0.01 }, { t: 0.2, rx: 0.004, rz: 0.004, cz: -0.01 },
  ];
  const E = envelope(st), l = [];
  l.push(done(shell(st, { p: 3.2, crease: 62 }), SHELL_COL));
  // visor frame: a thick brow and cheek plates with a narrow slit between them
  l.push(done(onShell(E, { y0: 0.1, y1: 0.156, range: () => [-1.3, 1.3], off: 0.005, thick: 0.02, bevel: 0.01, bulge: 0.004, cols: 14, rows: 5, k: 1.0 }), 0.6));
  l.push(done(onShell(E, { y0: 0.098, y1: 0.114, range: () => [-1.1, 1.1], off: 0.022, thick: 0.004, bevel: 0.002, cols: 14, rows: 2, k: 1.0, edge: 0.9 }), LENS)); // the slit
  l.push(done(onShell(E, { y0: 0.05, y1: 0.101, range: () => [-1.25, 1.25], off: 0.004, thick: 0.02, bevel: 0.01, bulge: 0.006, cols: 14, rows: 5, k: 1.0, crease: 38 }), 0.5));
  // chin guard: a deep angular jaw plate with grille bars and breather pipes
  const JAW = (y) => ({ rx: 0.052 + 0.03 * sstep(0.0, 0.06, y), rz: 0.066 + 0.024 * sstep(0.0, 0.06, y), cz: 0.012 });
  l.push(done(onShell(JAW, { y0: -0.004, y1: 0.056, range: (y) => { const w = 1.25 * (0.55 + 0.45 * sstep(-0.004, 0.05, y)); return [-w, w]; }, off: 0.004, thick: 0.022, bevel: 0.011, bulge: 0.008, cols: 10, rows: 6, sink: 0.009, crease: 34 }), 0.46));
  for (let i = -2; i <= 2; i++) l.push(done(plate([[-0.004, 0], [0.004, 0], [0.003, 0.05], [-0.003, 0.05]], 0.005, { bevel: 0.001 }), 0.22, { pos: [i * 0.013, 0.004, 0.094 - 0.0016 * Math.abs(i)] }));
  for (const s of [-1, 1]) {
    l.push(done(tubePath([[s * 0.04, 0.02, 0.09], [s * 0.065, 0.015, 0.07], [s * 0.09, 0.03, 0.03], [s * 0.1, 0.06, 0.0]], 0.008, { n: 6, seg: 8 }), 0.28));
    l.push(done(pad(0.017, 0.033, 0.04, { n: 8, rows: 4 }), 0.5, { pos: [s * 0.094, 0.1, -0.006], rot: [0, 0, s * Math.PI / 2] })); // ear guards
  }
  // neck shield and back plate
  l.push(done(onShell(E, { y0: 0.0, y1: 0.082, range: (y) => { const w = 0.8 + 0.5 * sstep(0.0, 0.08, y); return [Math.PI - w, Math.PI + w]; }, off: 0.006, thick: 0.014, bevel: 0.007, bulge: 0.006, cols: 12, rows: 5, sink: 0.012, k: 0.93, crease: 38 }), 0.48));
  // crest: a fin along the top
  l.push(done(plate([[-0.092, 0], [-0.07, 0.022], [-0.02, 0.03], [0.04, 0.026], [0.082, 0.008], [0.09, 0]], 0.012, { bevel: 0.003 }), 0.6, { pos: [0, 0.18, 0], rot: [0, Math.PI / 2, 0], scale: [1, 1, 1] }));
  return merge(l);
};

// ---- mortar: wide-brim steel pot, round goggles, respirator ------------------------------
HELMET.mortar = () => {
  const st = [
    { t: 0.098, rx: 0.086, rz: 0.095, cz: -0.008 }, { t: 0.118, rx: 0.088, rz: 0.098, cz: -0.008 }, { t: 0.14, rx: 0.084, rz: 0.094, cz: -0.008 },
    { t: 0.165, rx: 0.07, rz: 0.08, cz: -0.008 }, { t: 0.187, rx: 0.042, rz: 0.05, cz: -0.008 }, { t: 0.2, rx: 0.016, rz: 0.02, cz: -0.008 }, { t: 0.2015, rx: 0.003, rz: 0.003, cz: -0.008 },
  ];
  const E = envelope(st), l = [];
  l.push(done(shell(st, { p: 2.1, crease: 62 }), SHELL_COL));
  // the brim: a flared skirt all the way round, sloping down, with a rolled edge
  l.push(done(loftY([
    { t: 0.108, rx: 0.086, rz: 0.095, cz: -0.008 }, { t: 0.104, rx: 0.112, rz: 0.122, cz: -0.006 }, { t: 0.09, rx: 0.14, rz: 0.15, cz: -0.004 }, { t: 0.084, rx: 0.143, rz: 0.153, cz: -0.004 }, { t: 0.086, rx: 0.14, rz: 0.15, cz: -0.004 }, { t: 0.1, rx: 0.1, rz: 0.11, cz: -0.006 }, { t: 0.108, rx: 0.084, rz: 0.093, cz: -0.008 },
  ], { n: 18, p: 2 }, { cap0: false, cap1: false, crease: 38 }), 0.78));
  // chin strap loops and a net over the crown
  for (const s of [-1, 1]) l.push(done(tubePath([[s * 0.092, 0.09, -0.01], [s * 0.088, 0.04, 0.02], [s * 0.05, 0.0, 0.06], [0, -0.005, 0.07]], 0.0045, { n: 5, seg: 8 }), 0.25));
  // round goggles: two lenses in thick rings, a bridge, a strap
  for (const s of [-1, 1]) {
    l.push(done(lathe([[0.0, 0], [0.027, 0], [0.03, 0.004], [0.03, 0.02], [0.024, 0.028], [0.0, 0.03]], { n: 12 }), 0.32, { pos: [s * 0.036, 0.1, 0.066], rot: [Math.PI / 2 - 0.12, 0, 0] }));
    l.push(done(lathe([[0.0, 0.0], [0.021, 0.0], [0.022, 0.006], [0.018, 0.012], [0.0, 0.014]], { n: 12 }), LENS, { pos: [s * 0.036, 0.1 + 0.0033, 0.0945], rot: [Math.PI / 2 - 0.12, 0, 0] }));
  }
  l.push(done(rod([-0.012, 0.102, 0.088], [0.012, 0.102, 0.088], 0.0075), 0.3));
  l.push(done(loftY([{ t: 0.093, rx: 0.0875, rz: 0.097, cz: -0.008 }, { t: 0.109, rx: 0.0875, rz: 0.097, cz: -0.008 }], { n: 16 }, { cap0: false, cap1: false, crease: 40 }), 0.22));
  // respirator: mask body over the nose and mouth, a canister on the front, hoses to the cheeks
  const MK = (y) => ({ rx: 0.05 + 0.024 * sstep(0.0, 0.08, y), rz: 0.066 + 0.02 * sstep(0.0, 0.08, y), cz: 0.012 });
  l.push(done(onShell(MK, { y0: 0.0, y1: 0.082, range: (y) => { const w = 1.2 * (0.55 + 0.45 * sstep(0.0, 0.06, y)); return [-w, w]; }, off: 0.002, thick: 0.016, bevel: 0.008, bulge: 0.008, cols: 10, rows: 6, sink: 0.008, crease: 34 }), 0.28));
  l.push(done(lathe([[0.0, 0], [0.02, 0], [0.024, 0.003], [0.024, 0.036], [0.021, 0.04], [0.021, 0.046], [0.0, 0.046]], { n: 12 }), 0.45, { pos: [0, 0.036, 0.084], rot: [Math.PI / 2, 0, 0] }));
  for (let i = 0; i < 3; i++) l.push(done(lathe([[0.0, 0], [0.026, 0], [0.026, 0.003], [0.0, 0.003]], { n: 12 }), 0.22, { pos: [0, 0.036, 0.084 + 0.012 + i * 0.012], rot: [Math.PI / 2, 0, 0] }));
  for (const s of [-1, 1]) l.push(done(tubePath([[s * 0.022, 0.03, 0.082], [s * 0.052, 0.012, 0.07], [s * 0.074, 0.03, 0.04], [s * 0.084, 0.06, 0.016]], 0.0075, { n: 6, seg: 8 }), 0.2));
  return merge(l);
};

// ---- coil: sealed pressure helmet with a domed glowing visor ------------------------------------
HELMET.coil = () => {
  const st = [
    { t: 0.012, rx: 0.058, rz: 0.062, cz: -0.004 }, { t: 0.04, rx: 0.084, rz: 0.092, cz: -0.006 }, { t: 0.08, rx: 0.095, rz: 0.104, cz: -0.008 }, { t: 0.12, rx: 0.098, rz: 0.108, cz: -0.008 },
    { t: 0.156, rx: 0.088, rz: 0.098, cz: -0.008 }, { t: 0.18, rx: 0.062, rz: 0.07, cz: -0.008 }, { t: 0.196, rx: 0.028, rz: 0.034, cz: -0.008 }, { t: 0.1985, rx: 0.003, rz: 0.003, cz: -0.008 },
  ];
  const E = envelope(st), l = [];
  l.push(done(loftY(st, { n: 24, p: 2, sub: 3 }, { crease: 62, cap0: false }), SHELL_COL));
  // neck seal: a ribbed ring at the base
  for (const [y, r] of [[0.008, 0.052], [0.02, 0.058]]) l.push(done(loftY([{ t: y - 0.006, rx: r - 0.006, rz: r - 0.004 }, { t: y, rx: r + 0.004, rz: r + 0.006 }, { t: y + 0.006, rx: r - 0.006, rz: r - 0.004 }], { n: 14 }, { crease: 40 }), 0.42, { pos: [0, 0, -0.004] }));
  // the visor: a big dome of glass that wraps the face, with a bright rim and a glowing core
  const VE = (y) => { const e = E(y); return { rx: e.rx, rz: e.rz, cz: e.cz }; };
  l.push(done(onShell(VE, { y0: 0.032, y1: 0.142, range: (y) => { const w = 1.12 * Math.sqrt(1 - ((y - 0.087) / 0.062) ** 2 * 0.9); return [-w, w]; }, off: 0.007, thick: 0.012, bevel: 0.006, bulge: 0.008, cols: 16, rows: 8, k: 1.0, crease: 50 }), [0.02, 0.07, 0.07]));
  l.push(done(onShell(VE, { y0: 0.046, y1: 0.128, range: (y) => { const w = 0.98 * Math.sqrt(Math.max(0, 1 - ((y - 0.087) / 0.054) ** 2)); return [-w, w]; }, off: 0.018, thick: 0.004, bevel: 0.002, bulge: 0.003, cols: 16, rows: 8, k: 1.0, edge: 0.9 }), [0.9, 3.2, 2.8]));
  // visor frame: a rim of bright metal following the glass
  l.push(done(onShell(VE, { y0: 0.024, y1: 0.036, range: () => [-0.95, 0.95], off: 0.008, thick: 0.01, bevel: 0.004, cols: 12, rows: 2 }), 0.7));
  l.push(done(onShell(VE, { y0: 0.14, y1: 0.152, range: () => [-0.95, 0.95], off: 0.006, thick: 0.01, bevel: 0.004, cols: 12, rows: 2 }), 0.7));
  // side emitters: finned pods on each cheek
  for (const s of [-1, 1]) {
    l.push(done(lathe([[0.0, 0], [0.02, 0], [0.024, 0.006], [0.024, 0.026], [0.016, 0.034], [0.0, 0.036]], { n: 10 }), 0.45, { pos: [s * 0.093, 0.09, -0.004], rot: [0, 0, -s * Math.PI / 2] }));
    for (let i = 0; i < 3; i++) l.push(done(lathe([[0.0, 0], [0.027, 0], [0.027, 0.0035], [0.0, 0.0035]], { n: 10 }), 0.65, { pos: [s * (0.096 + i * 0.01), 0.09, -0.004], rot: [0, 0, -s * Math.PI / 2] }));
    l.push(done(lathe([[0.0, 0], [0.009, 0], [0.009, 0.008], [0.0, 0.008]], { n: 8 }), [0.8, 3.0, 2.6], { pos: [s * 0.126, 0.09, -0.004], rot: [0, 0, -s * Math.PI / 2] }));
  }
  // top coil rings and an antenna whip with a glowing bead
  l.push(done(lathe([[0.0, 0], [0.018, 0], [0.02, 0.004], [0.02, 0.014], [0.012, 0.018], [0.0, 0.018]], { n: 10 }), 0.6, { pos: [0, 0.194, -0.008] }));
  l.push(done(rod([0.0, 0.208, -0.008], [0.014, 0.27, -0.028], 0.0045, 0.0025, { n: 5 }), 0.35));
  l.push(done(lathe([[0.0, -0.005], [0.006, 0.0], [0.0, 0.005]], { n: 6 }), [0.9, 3.4, 3.0], { pos: [0.014, 0.272, -0.028] }));
  // back pack plate with a vent
  l.push(done(onShell(E, { y0: 0.05, y1: 0.12, range: () => [Math.PI - 0.55, Math.PI + 0.55], off: 0.003, thick: 0.016, bevel: 0.007, bulge: 0.005, cols: 8, rows: 4 }), 0.5));
  return merge(l);
};

// ---- medic: white helmet with crosses, clear goggles and a twin-canister respirator ------------------------
HELMET.medic = () => {
  const st = [
    { t: 0.055, rx: 0.081, rz: 0.089, cz: -0.008 }, { t: 0.08, rx: 0.087, rz: 0.096, cz: -0.008 }, { t: 0.11, rx: 0.09, rz: 0.1, cz: -0.008 },
    { t: 0.14, rx: 0.088, rz: 0.098, cz: -0.008 }, { t: 0.167, rx: 0.074, rz: 0.084, cz: -0.008 }, { t: 0.187, rx: 0.05, rz: 0.058, cz: -0.008 }, { t: 0.198, rx: 0.022, rz: 0.028, cz: -0.008 }, { t: 0.2, rx: 0.003, rz: 0.003, cz: -0.008 },
  ];
  const E = envelope(st), l = [];
  l.push(done(shell(st, { p: 2.2, crease: 62 }), 0.96));
  l.push(done(loftY([{ t: 0.05, rx: 0.081, rz: 0.09, cz: -0.008 }, { t: 0.06, rx: 0.088, rz: 0.097, cz: -0.008 }, { t: 0.068, rx: 0.0875, rz: 0.0965, cz: -0.008 }, { t: 0.074, rx: 0.082, rz: 0.091, cz: -0.008 }], { n: 16, p: 2.2 }, { crease: 40 }), 0.7));
  // a wide dark visor in a soft frame, with a strap behind
  l.push(done(onShell(E, { y0: 0.07, y1: 0.132, range: () => [-1.3, 1.3], off: 0.004, thick: 0.014, bevel: 0.006, bulge: 0.006, cols: 16, rows: 5, k: 1.015, crease: 45 }), 0.55));
  l.push(done(onShell(E, { y0: 0.079, y1: 0.123, range: (y) => { const w = 1.16 - 0.1 * Math.abs(y - 0.1) / 0.02; return [-w, w]; }, off: 0.012, thick: 0.007, bevel: 0.003, bulge: 0.004, cols: 16, rows: 4, k: 1.02, edge: 0.8 }), [0.05, 0.1, 0.12]));
  // respirator: a pale mask over the nose and mouth, two big canisters on the cheeks, a valve at the chin
  const MK = (y) => ({ rx: 0.05 + 0.026 * sstep(0.0, 0.08, y), rz: 0.066 + 0.02 * sstep(0.0, 0.08, y), cz: 0.012 });
  l.push(done(onShell(MK, { y0: 0.0, y1: 0.082, range: (y) => { const w = 1.22 * (0.55 + 0.45 * sstep(0.0, 0.06, y)); return [-w, w]; }, off: 0.002, thick: 0.017, bevel: 0.009, bulge: 0.009, cols: 10, rows: 6, sink: 0.008, crease: 34 }), 0.62));
  for (const s of [-1, 1]) {
    const ax = [s * 0.25, -0.1, 1];
    l.push(done(aim(lathe([[0, 0], [0.0215, 0], [0.0235, 0.004], [0.0235, 0.046], [0.02, 0.052], [0.0, 0.054]], { n: 12, crease: 40 }), [s * 0.046, 0.036, 0.062], ax), 0.3));
    for (const d of [0.014, 0.028, 0.04]) l.push(done(aim(lathe([[0.0, 0], [0.0255, 0], [0.0255, 0.004], [0.0, 0.004]], { n: 12 }), [s * (0.046 + d * 0.25), 0.036 - d * 0.1, 0.062 + d], ax), 0.14));
  }
  l.push(done(aim(lathe([[0, 0], [0.011, 0], [0.011, 0.012], [0, 0.012]], { n: 8 }), [0, 0.014, 0.088], [0, -0.2, 1]), 0.9));
  // red crosses on both sides and the front brow
  const cross = (w, c) => { const a = plate([[-w / 2, -w / 6], [w / 2, -w / 6], [w / 2, w / 6], [-w / 2, w / 6]], 0.012, { bevel: 0.001 }); const b = plate([[-w / 6, -w / 2], [w / 6, -w / 2], [w / 6, w / 2], [-w / 6, w / 2]], 0.012, { bevel: 0.001 }); return merge([done(a, c), done(b, c)]); };
  for (const s of [-1, 1]) {
    const g = cross(0.045, [0.9, 0.08, 0.08]);
    xf(g, { pos: [s * (E(0.125).rx - 0.008), 0.125, -0.008], rot: [0, s * Math.PI / 2, 0] });
    l.push(g);
  }
  const fg = cross(0.034, [0.9, 0.08, 0.08]); xf(fg, { pos: [0, 0.158, E(0.158).rz + E(0.158).cz - 0.012], rot: [-0.45, 0, 0] }); l.push(fg);
  return merge(l);
};

export const HELMET_KINDS = Object.keys(HELMET);
// chin strap: webbing from each ear, under the jaw, with a buckle, on every helmet
function strapGeo() {
  const l = [];
  const path = (s) => [[s * 0.0885, 0.085, -0.004], [s * 0.082, 0.045, 0.0], [s * 0.062, 0.012, 0.012], [s * 0.034, -0.002, 0.04], [s * 0.008, -0.004, 0.056]];
  for (const s of [-1, 1]) {
    l.push(done(ribbon(path(s), 0.014, 0.004, [[s, 0, 0], [s, 0.2, 0.2], [s * 0.4, 0.6, 0.4], [0, 1, 0.3], [0, 1, 0.2]], { seg: 12 }), 0.22));
    l.push(done(plate([[-0.006, -0.005], [0.006, -0.005], [0.006, 0.005], [-0.006, 0.005]], 0.004, { bevel: 0.001 }), 0.6, { pos: [s * 0.0885, 0.082, -0.004 - 0.002], rot: [0, s * Math.PI / 2, 0] })); // rivet plate where it joins the shell
  }
  l.push(done(plate([[-0.011, -0.006], [0.011, -0.006], [0.011, 0.006], [-0.011, 0.006]], 0.005, { bevel: 0.0012 }), 0.7, { pos: [0, -0.002, 0.0575], rot: [Math.PI / 2 + 0.2, 0, 0] })); // buckle
  return merge(l);
}
let _strap = null;
export function helmetGeo(kind = 'rifleman') { return merge([(HELMET[kind] || HELMET.rifleman)(), (_strap ||= strapGeo()).clone()]); }
