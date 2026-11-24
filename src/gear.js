import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U } from './rig.js';
import { torsoFront, torsoSide } from './anatomy.js';

// Worn kit for every class, built once in the body's frame (origin at the body's centre).
// Each class is one merged geometry with a brightness per piece baked into vertex colour; the
// instance colour is the army's accent, so one mesh per class serves all three armies and the
// same helmet reads differently on each. Marks (medic cross, coil emitters) are separate
// fixed-colour meshes. Keep it low-poly: this is drawn for every soldier on screen.
//
// Nothing here is placed by eye. Every piece is mounted ON a surface (the torso shell, the pack
// face, the belt) with a few millimetres sunk into it, using the helpers below, so a piece can
// never hover off the body. tests/gear-attach.mjs walks every class and fails on any piece that
// is not joined to the body through a chain of touching pieces.
const HY = U.H / 2, HZ = U.D / 2, HX = U.W / 2;
const SINK = 0.004; // how far a mounted piece is pressed into what it sits on
// the pack: a box behind the shoulders (same frame as the body)
export const PK = { x: 0, y: U.PACK_Y - U.BODY_Y, z: -U.D / 2 - U.PACK[2] / 2 + 0.03, hx: U.PACK[0] / 2, hy: U.PACK[1] / 2, hz: U.PACK[2] / 2 };
PK.back = PK.z - PK.hz; PK.top = PK.y + PK.hy; PK.bottom = PK.y - PK.hy;
const BELT_Y = -HY + 0.095;

function make(w, h, d, r, rot, seg, x, y, z, shade, name) {
  if (Math.min(w, h, d) < 0.05) seg = 1; // small fittings need no extra rounding
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002)).toNonIndexed();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(shade), 3));
  g.userData.name = name;
  return g;
}
const merge = (list) => mergeGeometries(list, false);

class Kit {
  constructor(kind) { this.kind = kind; this.l = []; this.marks = []; this.n = 0; }
  add(g) { this.l.push(g); return g; }
  name(n) { return `${this.kind}:${n || this.n++}`; }
  // a block at an exact spot (for pieces that wrap a surface, like the belt)
  box(w, h, d, r, x, y, z, shade, rot = [0, 0, 0], name, seg = 2) { return this.add(make(w, h, d, r, rot, seg, x, y, z, shade, this.name(name))); }
  // front of the torso: centre (x, y), size w x h, d thick, resting on the shell
  front(x, y, w, h, d, r, shade, rot = [0, 0, 0], name, seg = 2) {
    // mount on the highest point the shell reaches under the piece, so its corners touch too
    let z = Infinity;
    for (const [sx, sy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) z = Math.min(z, torsoFront(x + sx * w * 0.4, y + sy * h * 0.4));
    return this.add(make(w, h, d, r, rot, seg, x, y, z + d / 2 - SINK - 0.0015, shade, this.name(name)));
  }
  // the hip: centre height y and fore-aft z on the torso's side; sx +1 is the left (+x)
  side(sx, y, z, w, h, d, r, shade, name) {
    let x = Infinity;
    for (const [dy, dz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) x = Math.min(x, Math.abs(torsoSide(y + dy * h * 0.4, z + dz * d * 0.4)));
    return this.add(make(w, h, d, r, [0, 0, 0], 2, sx * (x + w / 2 - SINK - 0.0015), y, z, shade, this.name(name)));
  }
  // the pack's back face, top and sides
  back(x, y, w, h, d, r, shade, rot = [0, 0, 0], name, seg = 2) { return this.add(make(w, h, d, r, rot, seg, x, y, PK.back - d / 2 + SINK, shade, this.name(name))); }
  top(x, z, w, h, d, r, shade, rot = [0, 0, 0], name, seg = 2) { return this.add(make(w, h, d, r, rot, seg, x, PK.top + h / 2 - SINK, z, shade, this.name(name))); }
  packSide(sx, y, z, w, h, d, r, shade, name) { return this.add(make(w, h, d, r, [0, 0, 0], 2, sx * (PK.hx + w / 2 - SINK), y, z, shade, this.name(name))); }
  // round pieces: a rod or tube along an axis ('x', 'y' or 'z') through (x, y, z)
  rod(axis, r, len, x, y, z, shade, name, seg = 10, cap = true) {
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, !cap).toNonIndexed();
    g.deleteAttribute('uv');
    const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(shade), 3));
    g.userData.name = this.name(name);
    return this.add(g);
  }
  // fixed-colour mark (decal block) at an exact spot
  mark(w, h, d, x, y, z, c) {
    const g = new RoundedBoxGeometry(w, h, d, 1, 0.005).toNonIndexed();
    g.deleteAttribute('uv'); g.translate(x, y, z);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.marks.push(g);
  }
}

// pieces every soldier wears (body frame: origin at the torso centre, +z forward, -x is the right side)
function base(k, kind) {
  // collar and shoulder epaulettes over the arm joints
  k.box(0.17, 0.034, 0.13, 0.014, 0, HY - 0.012, -0.004, 0.45, [0, 0, 0], 'collar');
  if (kind !== 'assault') for (const sx of [-1, 1]) k.box(0.085, 0.05, 0.13, 0.022, sx * (HX + 0.006), HY - 0.045, 0, 1, [0, 0, 0], `epaulette${sx}`);
  // chest plate and harness braces from the shoulders down to the belt, each on the shell
  if (kind !== 'assault' && kind !== 'medic') k.front(0, 0.06, 0.2, 0.15, 0.03, 0.02, 0.52, [0, 0, 0], 'plate');
  for (const sx of [-1, 1]) for (const [y, h] of [[0.15, 0.11], [0.045, 0.11], [-0.05, 0.1]]) k.front(sx * 0.072, y, 0.032, h, 0.012, 0.004, 0.3, [0, 0, 0], `brace${sx}${y}`, 1);
  // belt with pouches, buckle, canteen, holster and a grenade
  k.box(0.292, 0.044, 0.2, 0.016, 0, BELT_Y, 0.0, 0.22, [0, 0, 0], 'belt');
  for (const sx of [-1, 1]) k.front(sx * 0.075, BELT_Y + 0.005, 0.06, 0.065, 0.04, 0.014, 0.36, [0, 0, 0], `pouch${sx}`);
  k.front(0, BELT_Y, 0.04, 0.034, 0.014, 0.004, 0.9, [0, 0, 0], 'buckle', 1);
  k.side(-1, BELT_Y - 0.03, -0.035, 0.05, 0.1, 0.07, 0.022, 0.45, 'canteen');
  k.side(1, BELT_Y - 0.03, 0.03, 0.04, 0.09, 0.065, 0.015, 0.28, 'holster');
  k.front(-0.07, 0.115, 0.04, 0.055, 0.04, 0.018, 0.55, [0, 0, 0], 'grenade');
  k.front(-0.07, 0.15, 0.016, 0.016, 0.018, 0.004, 0.9, [0, 0, 0], 'pin', 1);
  for (let i = 0; i < 2; i++) k.front(0.07, 0.15 + i * 0.022, 0.05, 0.01, 0.008, 0.003, 1, [0, 0, 0.22], `chevron${i}`, 1);
  // the pack: top flap, side pockets, straps down the back, bedroll, entrenching tool
  k.box(U.PACK[0] + 0.02, 0.05, U.PACK[2] + 0.02, 0.02, 0, PK.top - 0.02, PK.z, 0.6, [0, 0, 0], 'flap');
  for (const sx of [-1, 1]) {
    k.packSide(sx, PK.y - 0.02, PK.z, 0.05, 0.12, 0.07, 0.02, 0.55, `pocket${sx}`);
    k.back(sx * 0.065, PK.y, 0.024, U.PACK[1] * 0.9, 0.01, 0.003, 0.3, [0, 0, 0], `pstrap${sx}`, 1);
    k.back(sx * 0.065, PK.y - 0.05, 0.028, 0.02, 0.014, 0.003, 0.9, [0, 0, 0], `pbuckle${sx}`, 1);
  }
  k.box(U.PACK[0] + 0.07, 0.055, 0.075, 0.026, 0, PK.top + 0.0075, PK.z, 0.42, [0, 0, 0], 'bedroll', 3);
  k.back(0.075, PK.y - 0.03, 0.014, 0.16, 0.03, 0.005, 0.5, [0, 0, 0], 'tool-haft', 1);
  k.back(0.075, PK.y - 0.105, 0.07, 0.05, 0.014, 0.008, 0.6, [0, 0, 0], 'tool-head', 1);
}

const KIND = {
  rifleman: (k) => {
    k.front(-0.03, -0.045, 0.08, 0.055, 0.035, 0.012, 0.38, [0, 0, 0], 'mapcase');
    k.front(-0.03, -0.03, 0.09, 0.012, 0.012, 0.004, 0.9, [0, 0, 0], 'mapcase-strap', 1);
    for (const sx of [-1, 1]) k.front(sx * 0.055, 0.0, 0.05, 0.065, 0.032, 0.012, 0.4, [0, 0, 0], `magpouch${sx}`); // rifle clip pouches
  },
  assault: (k) => {
    for (const sx of [-1, 1]) k.front(sx * 0.07, 0.04, 0.09, 0.06, 0.04, 0.016, 0.4, [0, 0, 0], `magrig${sx}`);
    k.box(0.085, 0.05, 0.13, 0.022, -(HX + 0.006), HY - 0.045, 0, 1, [0, 0, 0], 'single-pad'); // one pad, on the right
    // bandolier: a strap and its rounds running from the right shoulder to the left hip
    for (let i = 0; i < 6; i++) {
      const x = -0.095 + i * 0.038, y = 0.15 - i * 0.045;
      k.front(x, y, 0.03, 0.06, 0.012, 0.004, 0.34, [0, 0, -0.55], `bandolier-strap${i}`, 1);
      k.front(x, y, 0.018, 0.04, 0.02, 0.006, 0.85, [0, 0, -0.55], `round${i}`, 1);
    }
    k.box(0.15, 0.05, 0.12, 0.024, 0, HY, 0.0, 0.55, [0, 0, 0], 'scarf');
    for (const sx of [-1, 1]) k.front(sx * 0.12, -0.075, 0.05, 0.07, 0.034, 0.014, 0.42, [0, 0, 0], `hip-pouch${sx}`);
  },
  gunner: (k) => {
    // ammunition belt looped over the chest, fed from the box on the back
    for (let i = 0; i < 6; i++) {
      const x = -0.1 + i * 0.04, y = 0.14 - i * 0.04;
      k.front(x, y, 0.038, 0.05, 0.026, 0.01, 0.82, [0, 0, -0.55], `belt-round${i}`, 1);
    }
    for (const sx of [-1, 1]) k.box(0.11, 0.07, 0.15, 0.03, sx * (HX + 0.01), HY - 0.04, 0, 1, [0, 0, 0], `big-pad${sx}`);
    k.back(0, PK.y, 0.18, 0.14, 0.1, 0.025, 0.5, [0, 0, 0], 'ammo-box');
    k.add(make(0.19, 0.014, 0.11, 0.004, [0, 0, 0], 1, 0, PK.y + 0.07 + 0.007 - SINK, PK.back - 0.05 + SINK, 0.3, k.name('ammo-lid')));
    k.front(0, -0.075, 0.16, 0.04, 0.03, 0.014, 0.38, [0, 0, 0], 'belt-feed');
  },
  mortar: (k) => {
    // the tube rides upright on the pack, strapped on, with the baseplate flat beside it
    const tx = -0.055, tz = PK.back - 0.04 + 0.006;
    k.rod('y', 0.04, 0.4, tx, PK.y + 0.07, tz, 0.45, 'tube', 14);
    k.rod('y', 0.046, 0.03, tx, PK.y + 0.27, tz, 0.6, 'muzzle-ring', 14);
    k.rod('y', 0.044, 0.03, tx, PK.y - 0.12, tz, 0.6, 'breech-ring', 14);
    for (const y of [PK.y + 0.1, PK.y - 0.06]) k.box(0.11, 0.022, 0.095, 0.01, tx, y, tz + 0.012, 0.32, [0, 0, 0], `tube-strap${y.toFixed(2)}`, 1);
    for (const sx of [-1, 1]) k.rod('y', 0.008, 0.3, tx + sx * 0.04, PK.y + 0.07, tz + 0.005, 0.7, `bipod${sx}`, 6); // folded legs, flush on the tube
    k.back(0.065, PK.y - 0.01, 0.1, 0.17, 0.03, 0.008, 0.7, [0, 0, 0], 'baseplate');
    k.back(0.065, PK.y - 0.01, 0.04, 0.04, 0.045, 0.01, 0.55, [0, 0, 0], 'baseplate-socket', 1);
    k.front(0, 0.0, 0.1, 0.07, 0.04, 0.014, 0.35, [0, 0, 0], 'shell-pouch');
    for (let i = 0; i < 3; i++) k.front(-0.05 + i * 0.05, -0.05, 0.035, 0.07, 0.035, 0.014, 0.55, [0, 0, 0], `shell${i}`);
  },
  coil: (k) => {
    // antenna from a clamp on the pack top, capacitor on the pack back, cables over the shoulders
    k.top(0.07, PK.z, 0.05, 0.03, 0.05, 0.01, 0.4, [0, 0, 0], 'antenna-clamp');
    k.rod('y', 0.011, 0.3, 0.07, PK.top + 0.14, PK.z, 0.35, 'antenna', 8);
    k.back(0, PK.y, 0.15, 0.15, 0.07, 0.03, 0.6, [0, 0, 0], 'capacitor');
    for (let i = 0; i < 3; i++) k.back(0, PK.y - 0.05 + i * 0.05, 0.13, 0.01, 0.092, 0.003, 0.35, [0, 0, 0], `fin${i}`, 1);
    for (const sx of [-1, 1]) k.rod('y', 0.015, 0.15, sx * 0.095, PK.y - 0.02, PK.back - 0.005, 0.5, `coil-bar${sx}`, 8);
    k.front(0, 0.1, 0.09, 0.04, 0.045, 0.014, 0.5, [0, 0, 0], 'gauge-box');
    // power leads: from the capacitor, over each shoulder and down to the gauge box
    for (const sx of [-1, 1]) {
      const p = [[sx * 0.04, PK.y + 0.07, PK.back - 0.01], [sx * 0.05, PK.top - 0.01, PK.z], [sx * 0.065, HY - 0.012, -0.05], [sx * 0.065, HY - 0.006, 0.02]];
      for (let i = 1; i < p.length; i++) {
        const a = new THREE.Vector3(...p[i - 1]), b = new THREE.Vector3(...p[i]), m = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        const g = new THREE.CylinderGeometry(0.0095, 0.0095, len + 0.014, 6).toNonIndexed();
        g.deleteAttribute('uv'); g.applyMatrix4(new THREE.Matrix4().compose(m, q, new THREE.Vector3(1, 1, 1)));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.42), 3));
        g.userData.name = k.name(`lead${sx}${i}`);
        k.add(g);
      }
      k.front(sx * 0.065, 0.14, 0.02, 0.08, 0.016, 0.006, 0.42, [0, 0, 0], `lead-front${sx}`, 1);
    }
    k.mark(0.03, 0.03, 0.03, 0.07, PK.top + 0.28 - 0.002, PK.z, [0.4, 1, 0.9]); // antenna tip
    for (const sx of [-1, 1]) k.mark(0.04, 0.02, 0.07, sx * (HX + 0.006), HY - 0.045 + 0.025 + 0.008, 0, [0.4, 1, 0.9]); // emitters on the pads
  },
  medic: (k) => {
    k.front(0, 0.0, 0.2, 0.15, 0.045, 0.026, 0.8, [0, 0, 0], 'satchel');
    k.side(1, BELT_Y - 0.03, -0.045, 0.07, 0.14, 0.1, 0.028, 0.5, 'field-kit');
    k.side(-1, BELT_Y - 0.03, 0.05, 0.05, 0.07, 0.06, 0.022, 0.8, 'pouch-hip');
    // rolled stretcher poles lashed across the top of the pack
    for (const z of [PK.z + 0.02, PK.z - 0.02]) k.rod('x', 0.011, 0.24, 0, PK.top + 0.0075, z, 0.9, `pole${z.toFixed(2)}`, 8);
    k.front(-0.08, -0.07, 0.07, 0.035, 0.035, 0.014, 0.9, [0, 0, 0], 'bandage-roll');
    // red cross on the satchel front and on the back of the pack
    let z = Infinity;
    for (const [sx, sy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) z = Math.min(z, torsoFront(sx * 0.08, sy * 0.06));
    const face = z + 0.045 - SINK - 0.0015;
    k.mark(0.15, 0.15, 0.004, 0, 0.0, face + 0.0015, [0.92, 0.92, 0.88]);
    k.mark(0.1, 0.03, 0.006, 0, 0.0, face + 0.0045, [0.78, 0.1, 0.1]);
    k.mark(0.03, 0.1, 0.006, 0, 0.0, face + 0.0045, [0.78, 0.1, 0.1]);
    const bz = PK.back + 0.002 - 0.003;
    k.mark(0.12, 0.12, 0.004, 0, PK.y + 0.04, bz, [0.92, 0.92, 0.88]);
    k.mark(0.08, 0.024, 0.006, 0, PK.y + 0.04, bz - 0.003, [0.78, 0.1, 0.1]);
    k.mark(0.024, 0.08, 0.006, 0, PK.y + 0.04, bz - 0.003, [0.78, 0.1, 0.1]);
  },
};

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
  const k = new Kit(kind);
  base(k, kind);
  KIND[kind](k);
  GEAR[kind] = merge(k.l);
  MARKS[kind] = k.marks.length ? merge(k.marks) : null;
}
export const kindKey = (kind) => (KIND[kind] ? kind : 'rifleman');
