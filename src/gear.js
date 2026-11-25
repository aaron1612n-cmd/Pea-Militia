import * as THREE from 'three';
import { U } from './rig.js';
import { torsoFront, torsoSide, torsoRadial, torsoSection } from './anatomy.js';
import { patch, loft, ringY, lathe, rod, tubePath, ribbon, plate, pad, done, merge, sstep, aim, xf } from './shapes.js';

// Worn kit for every class, built once in the body's frame (origin at the body's centre, +z
// forward, -x the right side). Each class is one merged geometry with a brightness per piece baked
// into vertex colour; the instance colour is the army's accent, so one mesh per class serves all
// three armies. Marks (crosses, coil glows) are separate fixed-colour meshes.
//
// Nothing is a box. Plates, pouches, flaps, belts and straps are PATCHES grown on the torso shell
// or the pack face (shapes.patch): they follow the surface, sit a few millimetres into it and have
// chamfered edges, so they can never hover or cut across the body. Round things are lathes (canteens,
// grenades, cartridges, canisters), cords and antennas are tubes along a path, and webbing is a
// ribbon. Every piece records its name; tests/gear-attach.mjs walks each class and fails on any
// piece not joined to the body through a chain of touching pieces.
const HY = U.H / 2, HX = U.W / 2;
const V = THREE.Vector3;
// the pack: a frame behind the shoulders (same frame as the body)
export const PK = { x: 0, y: U.PACK_Y - U.BODY_Y, z: -U.D / 2 - U.PACK[2] / 2 + 0.03, hx: U.PACK[0] / 2, hy: U.PACK[1] / 2, hz: U.PACK[2] / 2 };
PK.back = PK.z - PK.hz; PK.top = PK.y + PK.hy; PK.bottom = PK.y - PK.hy;
const BELT_Y = -HY + 0.095;
// brightness/colour of each material (multiplied by a softened army tint on the instance)
const C = {
  plate: [0.3, 0.32, 0.35], plate2: [0.46, 0.49, 0.53], web: [0.11, 0.115, 0.11], strap: [0.17, 0.17, 0.15],
  pouch: [0.52, 0.47, 0.32], flap: [0.6, 0.55, 0.38], khaki: [0.5, 0.46, 0.34], leather: [0.34, 0.22, 0.12], brass: [1.0, 0.78, 0.36], steel: [0.62, 0.64, 0.66],
  dark: [0.07, 0.07, 0.07], olive: [0.3, 0.33, 0.2], white: [0.92, 0.92, 0.88], cloth: [0.38, 0.4, 0.34], canvas: [0.45, 0.42, 0.3],
};

// surfaces to grow pieces on
const F = (x, y) => new V(x, y, torsoFront(x, y)); // front of the torso, u = x, v = y
const Bk = (x, y) => new V(x, y, torsoFront(x, y, true)); // back of the torso
const Rg = (th, y) => torsoRadial(th, y); // all the way round, u = angle (0 ahead, + toward +x)
const Sd = (sx) => (z, y) => new V(sx * Math.abs(torsoSide(y, z)), y, z); // the hip, u = z
const PBack = (x, y) => new V(x, y, PK.back); // pack back face
const PTop = (x, z) => new V(x, PK.top, z); // pack top face
const PSide = (sx) => (z, y) => new V(sx * PK.hx, y, z);
const hw = (c, w) => () => [c - w / 2, c + w / 2];

// Pieces that hang loose swing about a pivot in the vertex shader (fabric.js): each is tagged with a
// swing group and its pivot (aSw = pivot xyz + group). Groups: 1 right hip kit, 2 left hip kit,
// 3 antennas and cords, 4 loose strap tails, 5 chain and tags. Everything else has group 0.
export const SWAY_GROUPS = { hipR: 1, hipL: 2, whip: 3, tail: 4, tags: 5 };
function tagSway(g, grp, pivot) {
  const n = g.attributes.position.count, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { a[i * 4] = pivot[0]; a[i * 4 + 1] = pivot[1]; a[i * 4 + 2] = pivot[2]; a[i * 4 + 3] = grp; }
  g.setAttribute('aSw', new THREE.BufferAttribute(a, 4));
  return g;
}
class Kit {
  constructor(kind) { this.kind = kind; this.l = []; this.marks = []; this.n = 0; this.grp = 0; this.pivot = [0, 0, 0]; }
  name(n) { return `${this.kind}:${n || this.n++}`; }
  add(g, shade, name, at) { g = done(g, shade, at); g.userData.name = this.name(name); tagSway(g, this.grp, this.pivot); this.l.push(g); return g; }
  mark(g, color, at) { done(g, color, at); tagSway(g, this.grp, this.pivot); this.marks.push(g); return g; }
  // pieces added inside fn hang from `pivot` and swing as group `grp` (a key of SWAY_GROUPS)
  swing(grp, pivot, fn) { const g0 = this.grp, p0 = this.pivot; this.grp = SWAY_GROUPS[grp]; this.pivot = pivot; fn(); this.grp = g0; this.pivot = p0; }
  // flat-ish things grown on a surface
  plate(surf, o, shade, name) { return this.add(patch({ surf, ...o }), shade, name); }
  // a pouch: a puffed body with a flap that comes down over its top and a button. surf/axis as for patch.
  // front pouch at (cx, cy): w wide, h tall, T thick
  pouch(cx, cy, w, h, T, shade, name, { flap = 0.45, flapShade, taper = 0.9, surf = F, flip = false, button = true, cols = 4 } = {}) {
    const v0 = cy - h / 2, v1 = cy + h / 2;
    this.plate(surf, { v0, v1, range: (v) => { const t = sstep(v0, v1, v); const ww = w * (taper + (1 - taper) * t); return [cx - ww / 2, cx + ww / 2]; }, rows: 4, cols, off: 0, thick: T, bevel: 0.007, bulge: 0.35, flip }, shade, name);
    const fv0 = v1 - h * flap;
    this.plate(surf, { v0: fv0, v1: v1 + 0.002, range: (v) => { const t = sstep(fv0, fv0 + h * flap * 0.7, v); const ww = w * 0.98 * (0.45 + 0.55 * t); return [cx - ww / 2, cx + ww / 2]; }, rows: 3, cols, off: T * 0.5, thick: T * 0.9 + 0.003, bevel: 0.004, bulge: 0.1, flip }, flapShade ?? C.flap, `${name}-flap`);
    if (button) {
      const p = surf(cx, fv0 + 0.004);
      const n = surfNormal(surf, cx, fv0 + 0.004, flip);
      this.add(aim(lathe([[0, 0], [0.0065, 0], [0.0065, 0.003], [0.004, 0.0045], [0, 0.0045]], { n: 6 }), p.clone().addScaledVector(n, T * 0.5 + T * 0.9 * 0.8), n), C.brass, `${name}-btn`);
    }
  }
  // a horizontal band of webbing round the body
  ring(y0, y1, off, thick, shade, name, { bulge = 0, cols = 48 } = {}) {
    return this.plate(Rg, { v0: y0, v1: y1, range: () => [0, Math.PI * 2], rows: 3, cols, off, thick, bevel: 0.003, bulge, closedU: true, uScale: 0.12, crease: 55, edge: 0.6 }, shade, name);
  }
}
function surfNormal(surf, u, v, flip = false) {
  const e = 0.002;
  const a = surf(u + e, v).sub(surf(u - e, v)), b = surf(u, v + e).sub(surf(u, v - e));
  const n = new V().crossVectors(a, b).normalize();
  return flip ? n.negate() : n;
}
const BAND = { rifleman: [0.88, 0.88, 0.8], assault: [0.8, 0.18, 0.1], gunner: [0.9, 0.7, 0.1], mortar: [0.92, 0.46, 0.1], coil: [0.3, 0.9, 0.85], medic: [0.75, 0.05, 0.05] };
// a shoulder cap: a faceted dome with two lamellae below it, tilted down and out
function pauldron(k, sx, { r = 1, shade = C.plate, big = false } = {}) {
  const s = r * (big ? 1.15 : 1);
  const at = [sx * 0.157, 0.162, 0.0], rot = [0, 0, -sx * 0.4];
  // the cap: a deep faceted dome that sits over the shoulder joint
  k.add(lathe([[0.056 * s, -0.016], [0.06 * s, -0.004], [0.056 * s, 0.014], [0.042 * s, 0.032], [0.022 * s, 0.045], [0, 0.05]], { n: 12, p: 2.2, sz: 1.1, crease: 40 }), shade, `pauldron${sx}`, { pos: at, rot });
  // a painted unit band round the cap, in the class colour
  { const w = s * 0.0595; k.mark(lathe([[w - 0.0012, 0.0], [w + 0.0016, 0.0], [w + 0.0016, 0.0075], [w - 0.0012, 0.0075]], { n: 14, p: 2.2, sz: 1.1 }), BAND[k.kind] || [0.9, 0.9, 0.85], { pos: [at[0], at[1] + 0.001, at[2]], rot }); }
  // two lamellae stepping down the arm, each a shallow shell slightly wider than the last
  for (let i = 1; i <= 2; i++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
    const d = new V(0, -1, 0).applyQuaternion(q).multiplyScalar(0.018 * i).add(new V(...at));
    const w = (0.052 + i * 0.004) * s;
    k.add(lathe([[w + 0.006, -0.01], [w + 0.01, -0.002], [w + 0.005, 0.01], [w - 0.006, 0.02], [w - 0.02, 0.026], [0, 0.028]], { n: 12, p: 2.2, sz: 1.1, crease: 40 }), C.plate2, `lamella${sx}${i}`, { pos: [d.x, d.y + 0.004, d.z], rot });
  }
}
// a frag grenade standing on the chest: ridged body, fuze, spoon and a pin ring
function grenade(k, x, y, zFace, tag = 'grenade') {
  const bump = (a) => 1;
  const body = lathe([[0.0, 0], [0.012, 0.0], [0.0185, 0.008], [0.02, 0.02], [0.0185, 0.034], [0.012, 0.043], [0.008, 0.046], [0.0, 0.046]], { n: 10, crease: 45 });
  k.add(body, 0.5, tag, { pos: [x, y - 0.023, zFace + 0.0195 - 0.004] });
  k.add(lathe([[0.0, 0], [0.007, 0], [0.007, 0.012], [0.0045, 0.015], [0, 0.015]], { n: 6 }), C.steel, `${tag}-fuze`, { pos: [x, y + 0.021, zFace + 0.0195 - 0.004] });
  k.add(ribbon([[x + 0.0, y + 0.032, zFace + 0.0195 + 0.004], [x + 0.0, y + 0.014, zFace + 0.0195 + 0.019], [x, y - 0.008, zFace + 0.0195 + 0.0205], [x, y - 0.02, zFace + 0.0195 + 0.018]], 0.007, 0.0022, [0, 0, 1], { seg: 6 }), C.steel, `${tag}-spoon`);
  k.add(tubePath(ring3(x + 0.011, y + 0.034, zFace + 0.0195 + 0.002, 0.008), 0.0017, { n: 4, seg: 10 }), C.brass, `${tag}-pin`);
}
function ring3(cx, cy, cz, r, n = 10) { const out = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r, cz + Math.cos(a) * r]); } return out; }
// a cartridge: brass case, bullet tip
const cartridge = (len = 0.034, r = 0.0058) => lathe([[0, 0], [r, 0], [r, len * 0.62], [r * 0.7, len * 0.7], [r * 0.58, len * 0.9], [0, len]], { n: 6 });

// pieces every soldier wears
function base(k, kind) {
  // collar yoke and shoulder straps over the shoulders, front to back
  k.ring(HY - 0.034, HY - 0.004, 0.0035, 0.008, C.web, 'yoke', { cols: 28 });
  for (const sx of [-1, 1]) {
    const pts = [], ups = [];
    for (const phi of [1.15, 0.7, 0.2, -0.3, -0.85]) { const p = torsoSection(sx * 0.082, phi, 0.09); pts.push([p.x, p.y, p.z]); ups.push([sx * 0.2, Math.cos(phi), Math.sin(phi)]); }
    k.add(ribbon(pts, 0.036, 0.012, ups, { seg: 14 }), C.strap, `shoulder-strap${sx}`);
  }
  // belt, buckle and the sagging utility rig
  k.ring(BELT_Y - 0.02, BELT_Y + 0.022, 0.003, 0.012, C.web, 'belt', { cols: 40 });
  k.plate(F, { v0: BELT_Y - 0.016, v1: BELT_Y + 0.016, range: hw(0, 0.04), rows: 3, cols: 3, thick: 0.01, off: 0.012, bevel: 0.004 }, C.steel, 'buckle');
  // canteen on the right hip: a felt-covered flask with a cap, cord and a cup beneath
  k.swing('hipR', [-(Math.abs(torsoSide(BELT_Y, -0.03)) + 0.006), BELT_Y + 0.02, -0.03], () => {
    const y = BELT_Y - 0.052, z = -0.03, x = -(Math.abs(torsoSide(y, z)) + 0.014);
    k.add(lathe([[0, -0.016], [0.034, -0.016], [0.0385, -0.011], [0.0395, 0.0], [0.0385, 0.011], [0.034, 0.016], [0, 0.016]], { n: 14, sx: 1, sz: 1.22, crease: 45 }), C.olive, 'canteen', { pos: [x, y, z], rot: [0, 0, Math.PI / 2] });
    k.add(lathe([[0, 0], [0.012, 0], [0.013, 0.012], [0.0105, 0.015], [0, 0.015]], { n: 8 }), C.steel, 'canteen-cap', { pos: [x - 0.013, y + 0.04, z], rot: [0, 0, 0.0] });
    k.add(lathe([[0, 0], [0.0095, 0], [0.0095, 0.006], [0, 0.006]], { n: 8 }), C.steel, 'canteen-neck', { pos: [x - 0.003, y + 0.036, z] });
    k.add(tubePath([[x - 0.002, y + 0.044, z], [x + 0.0, y + 0.05, z + 0.03], [x + 0.004, y + 0.04, z + 0.04]], 0.0022, { n: 4, seg: 5 }), C.dark, 'canteen-cord');
    k.add(ribbon([[x - 0.012, y + 0.044, z - 0.012], [x - 0.04, y + 0.0, z - 0.005], [x - 0.012, y - 0.044, z - 0.012]], 0.012, 0.004, [[-1, 0.6, 0], [-1, 0, 0], [-1, -0.6, 0]], { seg: 6 }), C.strap, 'canteen-strap');
  });
  // holster on the left hip: tapered, with a retention strap and a pistol grip showing
  k.swing('hipL', [Math.abs(torsoSide(BELT_Y, 0.03)) + 0.004, BELT_Y + 0.016, 0.03], () => {
  k.plate(Sd(1), { v0: BELT_Y - 0.102, v1: BELT_Y + 0.016, range: (v) => { const t = sstep(BELT_Y - 0.102, BELT_Y + 0.016, v); const w = 0.032 + 0.04 * t; return [0.03 - w / 2, 0.03 + w / 2]; }, rows: 5, cols: 4, thick: 0.03, bevel: 0.009, bulge: 0.3, flip: true, uScale: 1 }, C.leather, 'holster');
  k.plate(Sd(1), { v0: BELT_Y - 0.01, v1: BELT_Y + 0.008, range: hw(0.03, 0.058), rows: 2, cols: 4, off: 0.022, thick: 0.014, bevel: 0.004, flip: true }, C.strap, 'holster-strap');
  {
    const x = Math.abs(torsoSide(BELT_Y + 0.03, 0.03)) + 0.014;
    k.add(loft([ringY(0, 0.01, 0.014, { n: 6, cx: 0, cz: 0 }), ringY(0.03, 0.0095, 0.0135, { n: 6, cz: 0.004 }), ringY(0.05, 0.009, 0.015, { n: 6, cz: 0.012 })], { crease: 40 }), C.dark, 'pistol-grip', { pos: [x, BELT_Y + 0.0, 0.03], rot: [0, 0, 0] });
  }
  });
  // a pack: frame straps on the back face, lid across the top, side pockets
  k.plate(PTop, { v0: -PK.hz + 0.006, v1: PK.hz - 0.006, range: hw(0, 0.2), rows: 4, cols: 6, off: 0.0, thick: 0.018, bevel: 0.008, bulge: 0.4, flip: true, crease: 45 }, C.canvas, 'lid');
  k.plate(PBack, { v0: PK.top - 0.095, v1: PK.top - 0.012, range: (v) => { const t = sstep(PK.top - 0.095, PK.top - 0.012, v); const w = 0.17 * (0.5 + 0.5 * t); return [-w / 2, w / 2]; }, rows: 4, cols: 5, off: 0.0, thick: 0.014, bevel: 0.006, bulge: 0.3, flip: true }, C.flap, 'lid-flap');
  for (const sx of [-1, 1]) {
    k.plate(PSide(sx), { v0: PK.y - 0.095, v1: PK.y + 0.025, range: (v) => { const t = sstep(PK.y - 0.095, PK.y + 0.025, v); const w = 0.07 * (0.8 + 0.2 * t); return [PK.z - w / 2, PK.z + w / 2]; }, rows: 5, cols: 4, thick: 0.034, bevel: 0.01, bulge: 0.35, flip: sx < 0 }, C.pouch, `pocket${sx}`);
    k.plate(PBack, { v0: PK.bottom + 0.02, v1: PK.top - 0.015, range: hw(sx * 0.06, 0.022), rows: 8, cols: 2, thick: 0.007, bevel: 0.003, flip: true, off: 0.008 }, C.strap, `pstrap${sx}`);
    k.plate(PBack, { v0: PK.y - 0.07, v1: PK.y - 0.044, range: hw(sx * 0.06, 0.03), rows: 2, cols: 3, thick: 0.007, bevel: 0.003, flip: true, off: 0.014 }, C.steel, `pbuckle${sx}`);
  }
  // bedroll across the top and an entrenching tool lashed to the back
  k.add(lathe([[0, -0.132], [0.027, -0.132], [0.0305, -0.124], [0.0305, 0.124], [0.027, 0.132], [0, 0.132]], { n: 12, crease: 40 }), C.olive, 'bedroll', { pos: [0, PK.top + 0.014, PK.z], rot: [0, 0, Math.PI / 2] });
  for (const x of [-0.07, 0.07]) k.add(lathe([[0.0305, -0.007], [0.0335, -0.007], [0.0335, 0.007], [0.0305, 0.007]], { n: 12 }), C.strap, `bedroll-strap${x}`, { pos: [x, PK.top + 0.014, PK.z], rot: [0, 0, Math.PI / 2] });
  k.add(rod([0.075, PK.y - 0.06, PK.back - 0.006], [0.075, PK.y + 0.07, PK.back - 0.006], 0.0075, 0.0065, { n: 6 }), C.leather, 'tool-haft');
  k.plate(PBack, { v0: PK.y - 0.11, v1: PK.y - 0.058, range: (v) => { const t = sstep(PK.y - 0.11, PK.y - 0.058, v); const w = 0.012 + 0.052 * t; return [0.075 - w / 2, 0.075 + w / 2]; }, rows: 4, cols: 3, off: 0.004, thick: 0.012, bevel: 0.004, flip: true }, C.steel, 'tool-blade');
  // the loose end of a pack strap, hanging from its buckle, and a webbing keeper
  k.swing('tail', [-0.06, PK.bottom + 0.03, PK.back], () => {
    k.add(ribbon([[-0.06, PK.bottom + 0.03, PK.back - 0.004], [-0.0605, PK.bottom - 0.02, PK.back - 0.0058], [-0.059, PK.bottom - 0.075, PK.back - 0.0062]], 0.02, 0.005, [0, 0, -1], { seg: 6 }), C.strap, 'strap-tail');
    k.add(plate([[-0.011, 0], [0.011, 0], [0.011, 0.006], [0, 0.011], [-0.011, 0.006]], 0.004, { bevel: 0.001 }), C.strap, 'strap-tip', { pos: [-0.06, PK.bottom - 0.086, PK.back - 0.0085], rot: [0, Math.PI, 0] });
  });
  // dog tags on a chain over the collar: the chain hangs from the yoke and the tags swing on it
  k.swing('tags', [0, HY - 0.012, torsoFront(0, HY - 0.012) + 0.009], () => {
    const zc = (y) => torsoFront(0, y) + 0.036;
    k.add(tubePath([[0, HY - 0.012, torsoFront(0, HY - 0.012) + 0.009], [0, 0.17, torsoFront(0, 0.17) + 0.028], [0, 0.125, zc(0.125)]], 0.0013, { n: 4, seg: 8 }), C.steel, 'tag-chain');
    for (const [i, dx] of [[0, -0.004], [1, 0.004]]) k.add(plate([[-0.0125, -0.008], [0.0125, -0.008], [0.0125, 0.0045], [0.0055, 0.0085], [-0.0055, 0.0085], [-0.0125, 0.0045]], 0.002, { bevel: 0.0006 }), C.steel, `tag${i}`, { pos: [dx, 0.1165, zc(0.1165) - 0.001 + i * 0.0022], rot: [0.0, 0, 0] });
  });
  // rivets along the belt and brass keepers on the shoulder straps
  for (const th of [-1.1, -0.85, -0.6, -0.36, 0.36, 0.6, 0.85, 1.1]) {
    const q = torsoRadial(th, BELT_Y), n = new V(q.x, 0, q.z).normalize();
    k.add(aim(lathe([[0, 0], [0.0036, 0], [0.0036, 0.0012], [0.002, 0.0023], [0, 0.0026]], { n: 5 }), q.clone().addScaledVector(n, 0.0118), n), C.brass, `belt-rivet${th}`);
  }
}

// per class: kit on top of base()
const KIND = {
  rifleman: (k) => {
    for (const sx of [-1, 1]) pauldron(k, sx);
    // plate carrier front with an inset ceramic plate, cummerbund, chest pouches and a radio on the pack
    k.ring(-0.085, -0.025, 0.002, 0.014, C.plate, 'cummerbund');
    k.plate(F, { v0: -0.05, v1: 0.17, range: (v) => { const t = sstep(-0.05, 0.17, v); const w = 0.2 * (0.8 + 0.2 * sstep(0.16, 0.06, v) * 0 + 0.2 * Math.min(1, (v + 0.05) / 0.12)) - 0.03 * sstep(0.12, 0.17, v); return [-w / 2, w / 2]; }, rows: 8, cols: 8, thick: 0.02, bevel: 0.011, bulge: 0.12, off: 0.0 }, C.plate, 'plate');
    k.plate(F, { v0: -0.02, v1: 0.14, range: hw(0, 0.12), rows: 6, cols: 6, thick: 0.01, bevel: 0.007, off: 0.02 }, C.plate2, 'plate-inset');
    for (const [x, v] of [[-0.088, -0.03], [0.088, -0.03], [-0.066, 0.145], [0.066, 0.145]]) { const n = new V(0, 0, 1); k.add(aim(lathe([[0, 0], [0.0045, 0], [0.0045, 0.0014], [0.0026, 0.0027], [0, 0.003]], { n: 6 }), new V(x, v, torsoFront(x, v) + 0.0165), n), C.brass, `plate-rivet${x}${v}`); }
    for (let i = -1; i <= 1; i += 2) k.pouch(i * 0.052, -0.03, 0.04, 0.062, 0.022, C.pouch, `magpouch${i}`, { surf: F });
    k.pouch(0.0, -0.043, 0.036, 0.046, 0.02, C.pouch, 'magpouch-mid', { surf: F });
    grenade(k, -0.064, 0.108, torsoFront(-0.064, 0.108) + 0.02);
    // radio on the right of the pack: body, dials, a spring antenna
    k.plate(PSide(-1), { v0: PK.y - 0.01, v1: PK.y + 0.13, range: hw(PK.z, 0.07), rows: 6, cols: 4, off: 0.016, thick: 0.026, bevel: 0.008, bulge: 0.25, flip: false }, C.dark, 'radio');
    k.swing('whip', [-PK.hx - 0.036, PK.y + 0.126, PK.z], () => {
    k.add(tubePath(coil([-PK.hx - 0.036, PK.y + 0.125, PK.z + 0.0], [-PK.hx - 0.04, PK.y + 0.34, PK.z - 0.014], 0.006, 9), 0.0016, { n: 4, seg: 70 }), C.steel, 'antenna-coil');
    k.add(rod([-PK.hx - 0.036, PK.y + 0.13, PK.z], [-PK.hx - 0.04, PK.y + 0.36, PK.z - 0.014], 0.0045, 0.0018, { n: 6 }), C.steel, 'antenna');
    });
    for (const [i, z] of [[0, -0.016], [1, 0.016]]) k.add(lathe([[0, 0], [0.008, 0], [0.008, 0.007], [0.0055, 0.009], [0, 0.009]], { n: 8 }), C.brass, `dial${i}`, { pos: [-PK.hx - 0.037, PK.y + 0.1, PK.z + z], rot: [0, 0, Math.PI / 2] });
    k.add(lathe([[0, 0], [0.009, 0], [0.009, 0.006], [0, 0.006]], { n: 8 }), C.steel, 'antenna-base', { pos: [-PK.hx - 0.036, PK.y + 0.126, PK.z], rot: [0, 0, 0] });
  },
  assault: (k) => {
    // light rig: a slim chest panel, big single pauldron, bandolier, handset on the strap, knife
    pauldron(k, -1, { big: true });
    k.ring(-0.085, -0.03, 0.002, 0.012, C.plate, 'cummerbund');
    k.plate(F, { v0: -0.04, v1: 0.15, range: (v) => { const w = 0.15 - 0.03 * sstep(0.1, 0.15, v); return [-w / 2, w / 2]; }, rows: 7, cols: 6, thick: 0.014, bevel: 0.008, bulge: 0.1 }, C.plate, 'panel');
    // bandolier: a belt of cartridges on a diagonal strap from the right shoulder to the left hip
    const xc = (v) => -0.085 + (0.16 - v) * 0.62;
    k.plate(F, { v0: -0.1, v1: 0.17, range: (v) => [xc(v) - 0.022, xc(v) + 0.022], rows: 10, cols: 3, off: 0.014, thick: 0.01, bevel: 0.004, crease: 50 }, C.strap, 'bandolier');
    for (let i = 0; i < 7; i++) {
      const v = 0.135 - i * 0.034, x = xc(v);
      const z = torsoFront(x, v) + 0.014 + 0.01 + 0.004;
      const a = Math.atan2(0.62, 1);
      k.add(cartridge(0.034, 0.0075), C.brass, `round${i}`, { pos: [x, v - 0.015, z], rot: [0.0, 0, -a * 0 - 0.0] });
    }
    for (const sx of [-1, 1]) k.pouch(sx * 0.1, -0.08, 0.044, 0.056, 0.022, C.pouch, `hip-pouch${sx}`, { surf: F });
    grenade(k, 0.06, 0.04, torsoFront(0.06, 0.04) + 0.014);
    // handset on the left shoulder strap with a coiled cord
    k.add(loft([ringY(0, 0.012, 0.007, { n: 8 }), ringY(0.045, 0.011, 0.008, { n: 8 }), ringY(0.055, 0.015, 0.011, { n: 8 })], { crease: 40 }), C.dark, 'handset', { pos: [0.06, 0.15, torsoFront(0.06, 0.15) + 0.012], rot: [-0.15, 0, 0.0] });
    k.swing('whip', [0.06, 0.2, 0.045], () => k.add(tubePath(coil([0.06, 0.2, 0.045], [0.07, 0.22, -0.02], 0.007, 7), 0.0018, { n: 4, seg: 60 }), C.dark, 'handset-cord'));
    // combat knife on the chest strap
    k.add(ribbon([[-0.09, 0.0, torsoFront(-0.09, 0.0) + 0.012], [-0.09, 0.06, torsoFront(-0.09, 0.06) + 0.012]], 0.02, 0.012, [0, 0, 1], { seg: 4 }), C.leather, 'knife-sheath');
  },
  gunner: (k) => {
    // heavy armour: slabs on both shoulders, ammunition belt looped over the chest, big box on the back
    for (const sx of [-1, 1]) pauldron(k, sx, { big: true });
    k.ring(-0.085, -0.025, 0.002, 0.016, C.plate, 'cummerbund');
    k.plate(F, { v0: -0.05, v1: 0.17, range: (v) => { const w = 0.22 - 0.05 * sstep(0.11, 0.17, v); return [-w / 2, w / 2]; }, rows: 8, cols: 8, thick: 0.024, bevel: 0.013, bulge: 0.12 }, C.plate, 'plate');
    k.plate(F, { v0: -0.095, v1: -0.05, range: (v) => { const w = 0.18 * (0.55 + 0.45 * sstep(-0.095, -0.05, v)); return [-w / 2, w / 2]; }, rows: 3, cols: 6, thick: 0.02, bevel: 0.01, bulge: 0.15 }, C.plate, 'groin-plate');
    // belt of rounds draped from the box over the right shoulder and down across the chest
    const pts = [], ups = [];
    for (const [x, v] of [[-0.085, 0.16], [-0.05, 0.095], [0.0, 0.04], [0.06, -0.01], [0.1, -0.055]]) { pts.push([x, v, torsoFront(x, v) + 0.036]); ups.push([x * 1.2, 0.2, 1]); }
    k.add(ribbon(pts, 0.026, 0.012, ups, { seg: 14 }), C.strap, 'belt-web');
    for (let i = 0; i < 9; i++) {
      const t = i / 8, x = -0.085 + t * 0.185, v = 0.16 - t * 0.215;
      k.add(cartridge(0.03, 0.0065), C.brass, `belt-round${i}`, { pos: [x, v - 0.014, torsoFront(x, v) + 0.036 + 0.004], rot: [0, 0, 0] });
    }
    // ammo box on the back with a handle and latches
    k.plate(PBack, { v0: PK.y - 0.08, v1: PK.y + 0.07, range: hw(0, 0.18), rows: 6, cols: 6, off: 0.0, thick: 0.05, bevel: 0.014, bulge: 0.0, flip: true, crease: 40 }, C.olive, 'ammo-box');
    k.plate(PBack, { v0: PK.y + 0.02, v1: PK.y + 0.07, range: hw(0, 0.18), rows: 2, cols: 6, off: 0.045, thick: 0.014, bevel: 0.006, flip: true }, C.plate, 'ammo-lid');
    k.add(tubePath([[-0.035, PK.y + 0.064, PK.back - 0.048], [-0.03, PK.y + 0.082, PK.back - 0.052], [0.03, PK.y + 0.082, PK.back - 0.052], [0.035, PK.y + 0.064, PK.back - 0.048]], 0.0048, { n: 5, seg: 10 }), C.steel, 'ammo-handle');
    for (const sx of [-1, 1]) k.plate(PBack, { v0: PK.y - 0.01, v1: PK.y + 0.016, range: hw(sx * 0.07, 0.024), rows: 2, cols: 3, off: 0.044, thick: 0.01, bevel: 0.004, flip: true }, C.steel, `latch${sx}`);
    k.pouch(0.0, -0.06, 0.06, 0.036, 0.018, C.pouch, 'feed-pouch', { surf: F, button: false });
  },
  mortar: (k) => {
    // the tube rides upright on the pack, strapped on, with the baseplate on the back; rounds on the chest
    const tx = -0.052, tz = PK.back - 0.036;
    k.add(lathe([[0, -0.19], [0.036, -0.19], [0.041, -0.18], [0.041, 0.2], [0.046, 0.205], [0.046, 0.225], [0.0415, 0.23], [0.0, 0.23]], { n: 14, crease: 40 }), C.steel, 'tube', { pos: [tx, PK.y + 0.04, tz] });
    k.add(lathe([[0.0, 0], [0.0285, 0], [0.0285, 0.0], [0.0, 0.0]], { n: 6 }) && lathe([[0.014, -0.012], [0.052, -0.012], [0.052, -0.002], [0.014, -0.002]], { n: 14 }), C.plate, 'tube-collar', { pos: [tx, PK.y + 0.04 + 0.075, tz] });
    for (const dy of [0.07, -0.08]) k.add(lathe([[0.0405, -0.011], [0.0455, -0.011], [0.0455, 0.011], [0.0405, 0.011]], { n: 14 }), C.strap, `tube-strap${dy}`, { pos: [tx, PK.y + dy, tz] });
    k.plate(PBack, { v0: PK.y - 0.05, v1: PK.y + 0.04, range: hw(tx, 0.04), rows: 3, cols: 2, off: 0.0, thick: 0.01, bevel: 0.003, flip: true }, C.strap, 'tube-brace');
    for (const sx of [-1, 1]) k.add(rod([tx + sx * 0.032, PK.y + 0.17, tz + 0.009], [tx + sx * 0.032, PK.y - 0.1, tz + 0.009], 0.0055, 0.0045, { n: 6 }), C.steel, `bipod${sx}`);
    k.add(lathe([[0.0, 0], [0.056, 0], [0.056, 0.006], [0.0, 0.006]], { n: 16, crease: 40 }), C.steel, 'baseplate', { pos: [0.06, PK.y - 0.005, PK.back - 0.003], rot: [Math.PI / 2, 0, 0] });
    k.add(lathe([[0, 0], [0.012, 0], [0.012, 0.016], [0, 0.016]], { n: 8 }), C.plate, 'baseplate-socket', { pos: [0.06, PK.y - 0.005, PK.back - 0.008], rot: [-Math.PI / 2, 0, 0] });
    k.ring(-0.085, -0.03, 0.002, 0.012, C.plate, 'cummerbund');
    k.plate(F, { v0: -0.035, v1: 0.16, range: (v) => { const w = 0.17 - 0.04 * sstep(0.1, 0.16, v); return [-w / 2, w / 2]; }, rows: 8, cols: 7, thick: 0.016, bevel: 0.009, bulge: 0.1 }, C.plate, 'vest');
    // finned shells on a chest strap
    for (let i = 0; i < 4; i++) {
      const x = -0.075 + i * 0.05, v = 0.055;
      const z = torsoFront(x, 0.01) + 0.03;
      k.add(lathe([[0, 0], [0.011, 0], [0.0145, 0.014], [0.016, 0.034], [0.0125, 0.058], [0.004, 0.072], [0, 0.074]], { n: 8, crease: 45 }), C.steel, `shell${i}`, { pos: [x, v - 0.052, z - 0.004] });
      for (let f = 0; f < 3; f++) { const a = f * Math.PI * 2 / 3 + 1.0; k.add(plate([[0, 0], [0.012, 0], [0.0085, 0.02], [0.0, 0.02]], 0.0025, { bevel: 0.0005 }), C.steel, `shell${i}fin${f}`, { pos: [x + Math.cos(a) * 0.006, v - 0.055, z - 0.004 + Math.sin(a) * 0.006], rot: [0, a, 0] }); }
    }
    k.add(ribbon([[-0.105, 0.015, torsoFront(-0.105, 0.015) + 0.014], [0, 0.0, torsoFront(0, 0) + 0.016], [0.105, 0.015, torsoFront(0.105, 0.015) + 0.014]], 0.026, 0.008, [[-1, 0, 1], [0, 0, 1], [1, 0, 1]], { seg: 10 }), C.strap, 'shell-strap');
    // gas mask canister bag on the left thigh side
    k.add(lathe([[0, -0.02], [0.034, -0.02], [0.038, -0.014], [0.038, 0.062], [0.034, 0.068], [0, 0.068]], { n: 12, crease: 40 }), C.olive, 'mask-canister', { pos: [Math.abs(torsoSide(-0.13, -0.045)) + 0.02, -0.09, -0.045] });
  },
  coil: (k) => {
    // field generator: capacitor cylinders and an antenna on the pack, cables over the shoulders to a gauge on the chest
    for (const sx of [-1, 1]) pauldron(k, sx, {});
    k.ring(-0.085, -0.03, 0.002, 0.012, C.plate, 'cummerbund');
    k.plate(F, { v0: -0.035, v1: 0.16, range: (v) => { const w = 0.17 - 0.04 * sstep(0.1, 0.16, v); return [-w / 2, w / 2]; }, rows: 8, cols: 7, thick: 0.016, bevel: 0.009, bulge: 0.1 }, C.plate, 'vest');
    for (const sx of [-1, 1]) {
      const x = sx * 0.05;
      k.add(lathe([[0, -0.1], [0.032, -0.1], [0.036, -0.094], [0.036, 0.094], [0.032, 0.1], [0, 0.1]], { n: 12, crease: 40 }), C.plate, `capacitor${sx}`, { pos: [x, PK.y + 0.0, PK.back - 0.032] });
      for (const dy of [-0.062, 0.0, 0.062]) k.add(lathe([[0.034, -0.007], [0.0395, -0.007], [0.0395, 0.007], [0.034, 0.007]], { n: 12 }), C.steel, `capband${sx}${dy}`, { pos: [x, PK.y + dy, PK.back - 0.032] });
      k.add(lathe([[0, 0], [0.012, 0], [0.012, 0.012], [0.0, 0.012]], { n: 8 }), C.steel, `cap-terminal${sx}`, { pos: [x, PK.y + 0.1, PK.back - 0.032] });
    }
    k.plate(PBack, { v0: PK.y - 0.11, v1: PK.y + 0.11, range: hw(0, 0.04), rows: 6, cols: 2, thick: 0.01, bevel: 0.004, flip: true, off: 0.002 }, C.plate, 'cap-spine');
    k.add(lathe([[0, 0], [0.014, 0], [0.014, 0.014], [0.009, 0.019], [0, 0.019]], { n: 8 }), C.plate, 'antenna-clamp', { pos: [0.07, PK.top - 0.012, PK.z] });
    k.swing('whip', [0.07, PK.top + 0.004, PK.z], () => {
      k.add(rod([0.07, PK.top - 0.01, PK.z], [0.07, PK.top + 0.2, PK.z], 0.0085, 0.0035, { n: 6 }), C.steel, 'antenna');
      k.mark(lathe([[0, -0.007], [0.0075, 0], [0, 0.007]], { n: 6 }), [0.4, 1, 0.9], { pos: [0.07, PK.top + 0.206, PK.z] });
    });
    // gauge on the chest and cables over each shoulder from the pack
    k.add(lathe([[0, 0], [0.034, 0], [0.037, 0.004], [0.037, 0.016], [0.03, 0.02], [0.0, 0.02]], { n: 14, crease: 40 }), C.plate, 'gauge', { pos: [0, 0.08, torsoFront(0, 0.08) - 0.003], rot: [Math.PI / 2, 0, 0] });
    k.mark(lathe([[0, 0.0], [0.024, 0.0], [0.024, 0.002], [0, 0.002]], { n: 14 }), [0.4, 1, 0.9], { pos: [0, 0.08, torsoFront(0, 0.08) + 0.0165], rot: [Math.PI / 2, 0, 0] });
    for (const sx of [-1, 1]) {
      const pts = [[sx * 0.05, PK.y + 0.08, PK.back - 0.01]];
      for (const phi of [-0.9, -0.45, 0.15, 0.7, 1.2]) { const p = torsoSection(sx * 0.1, phi, 0.09); pts.push([p.x + (phi < 0 ? 0 : 0), p.y + 0.012 * Math.cos(phi), p.z + 0.012 * Math.sin(phi)]); }
      k.add(tubePath([[sx * 0.05, PK.y + 0.1, PK.back - 0.02], [sx * 0.05, PK.top - 0.01, PK.z], ...pts.slice(1)], 0.0085, { n: 6, seg: 26 }), C.dark, `lead${sx}`);
    }
    for (const sx of [-1, 1]) k.mark(lathe([[0, 0], [0.0125, 0], [0.0125, 0.003], [0, 0.003]], { n: 8 }), [0.4, 1, 0.9], { pos: [sx * 0.162, 0.165 + 0.0395, 0], rot: [0, 0, -sx * 0.5] });
  },
  medic: (k) => {
    // field medic: a pale satchel across the front, canister bag, stretcher poles, crosses
    k.ring(-0.085, -0.03, 0.002, 0.012, C.plate, 'cummerbund');
    pauldron(k, 1, { shade: C.white });
    const sz = (x, v) => torsoFront(x, v);
    k.plate(F, { v0: -0.07, v1: 0.13, range: (v) => { const w = 0.15 - 0.03 * sstep(0.08, 0.13, v); return [-w / 2, w / 2]; }, rows: 8, cols: 6, thick: 0.03, bevel: 0.012, bulge: 0.2 }, C.white, 'satchel');
    k.plate(F, { v0: 0.03, v1: 0.135, range: (v) => { const w = 0.15 * (0.55 + 0.45 * sstep(0.03, 0.08, v)); return [-w / 2, w / 2]; }, rows: 4, cols: 6, off: 0.026, thick: 0.01, bevel: 0.004 }, C.white, 'satchel-flap');
    k.add(ribbon([[-0.09, 0.17, torsoFront(-0.09, 0.17) + 0.003], [-0.05, 0.1, sz(-0.05, 0.1) + 0.03], [0.0, 0.04, sz(0, 0.04) + 0.036], [0.05, -0.02, sz(0.05, -0.02) + 0.03], [0.1, -0.1, torsoFront(0.1, -0.1) + 0.006]], 0.03, 0.007, [[-0.3, 0.5, 1], [0, 0.2, 1], [0, 0, 1], [0.2, 0, 1], [0.3, 0, 1]], { seg: 14 }), C.cloth, 'satchel-strap');
    k.pouch(-0.075, -0.075, 0.046, 0.05, 0.02, C.white, 'pouch-hip', { surf: F });
    k.pouch(0.075, -0.075, 0.046, 0.05, 0.02, C.white, 'pouch-hip2', { surf: F });
    // canister bag on the right thigh side and a rolled bandage
    k.add(lathe([[0, -0.02], [0.03, -0.02], [0.034, -0.014], [0.034, 0.056], [0.03, 0.062], [0, 0.062]], { n: 12, crease: 40 }), C.olive, 'mask-canister', { pos: [-(Math.abs(torsoSide(-0.13, 0.04)) + 0.018), -0.085, 0.04] });
    k.add(lathe([[0.0, -0.022], [0.016, -0.022], [0.018, -0.02], [0.018, 0.02], [0.016, 0.022], [0.0, 0.022]], { n: 10, crease: 40 }), C.white, 'bandage-roll', { pos: [0.07, -0.09, torsoFront(0.07, -0.09) + 0.0], rot: [0, 0, Math.PI / 2] });
    // stretcher poles across the top of the pack and a bag on the back
    for (const z of [PK.z + 0.02, PK.z - 0.02]) k.add(lathe([[0, -0.13], [0.011, -0.13], [0.011, 0.13], [0, 0.13]], { n: 8 }), C.steel, `pole${z.toFixed(2)}`, { pos: [0, PK.top + 0.004, z], rot: [0, 0, Math.PI / 2] });
    k.plate(PBack, { v0: PK.y - 0.07, v1: PK.y + 0.08, range: hw(0, 0.15), rows: 5, cols: 5, off: 0.0, thick: 0.034, bevel: 0.012, bulge: 0.2, flip: true }, C.white, 'med-bag');
    // red crosses: satchel front, back bag, left pauldron
    const cross = (w, depth = 0.003) => merge([done(plate([[-w / 2, -w / 6], [w / 2, -w / 6], [w / 2, w / 6], [-w / 2, w / 6]], depth, { bevel: 0.0008 }), 1), done(plate([[-w / 6, -w / 2], [w / 6, -w / 2], [w / 6, w / 2], [-w / 6, w / 2]], depth, { bevel: 0.0008 }), 1)]);
    const z0 = torsoFront(0, 0.0) + 0.034;
    k.mark(cross(0.07, 0.006), [0.62, 0.02, 0.02], { pos: [0, 0.0, z0] });
    k.mark(cross(0.08, 0.006), [0.62, 0.02, 0.02], { pos: [0, PK.y + 0.005, PK.back - 0.037], rot: [0, Math.PI, 0] });
    k.mark(cross(0.04), [0.62, 0.02, 0.02], { pos: [-0.162 * 0 + 0.162 + 0.014, 0.18 - 0.004, 0.0], rot: [-Math.PI / 2, 0, -0.5] });
  },
};
// a spring: points around the line between a and b
function coil(a, b, r, turns) {
  const A = new V(...a), B = new V(...b), d = B.clone().sub(A), len = d.length(), t = d.clone().normalize();
  const u = new V(1, 0, 0).sub(t.clone().multiplyScalar(t.x)).normalize(), w = new V().crossVectors(t, u);
  const pts = [], n = turns * 7;
  for (let i = 0; i <= n; i++) {
    const s = i / n, ang = s * turns * Math.PI * 2;
    pts.push(A.clone().addScaledVector(t, s * len).addScaledVector(u, Math.cos(ang) * r * (1 - 0.3 * s)).addScaledVector(w, Math.sin(ang) * r * (1 - 0.3 * s)).toArray());
  }
  return pts;
}

export const KIND_IDS = Object.keys(KIND);
// fresh (unmerged) pieces for a class, for the attachment test
export function gearPieces(kind) {
  const k = new Kit(kind);
  base(k, kind);
  KIND[kind](k);
  return { pieces: k.l, marks: k.marks };
}
export const GEAR = {}, MARKS = {};
for (const kind of KIND_IDS) {
  const { pieces, marks } = gearPieces(kind);
  GEAR[kind] = merge(pieces);
  MARKS[kind] = marks.length ? merge(marks) : null;
}
export const kindKey = (kind) => (KIND[kind] ? kind : 'rifleman');
