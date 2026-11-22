import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U, SEG_LEN } from './rig.js';

// Worn kit for every class, built once in the body's frame (origin at the body's centre).
// Each class is one merged geometry with a brightness per piece baked into vertex colour; the
// instance colour is the army's accent, so one mesh per class serves all three armies and the
// same helmet reads differently on each. Marks (medic cross, coil emitters) are separate
// fixed-colour meshes. Keep it low-poly: this is drawn for every soldier on screen.
const HY = U.H / 2, HZ = U.D / 2, HX = U.W / 2;

function piece(list, w, h, d, r, x, y, z, shade, rot = [0, 0, 0], seg = 2) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002)).toNonIndexed();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
  const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(shade);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  list.push(g);
}
const merge = (list) => mergeGeometries(list, false);

// pieces every soldier wears
function base(l, k) {
  // helmet: shell over the top of the block with a brim above the visor
  piece(l, U.W + 0.045, 0.19, U.D + 0.05, 0.07, 0, HY - 0.06, 0.005, 0.78, [0, 0, 0], 3);
  piece(l, U.W + 0.02, 0.035, 0.07, 0.015, 0, HY - 0.135, HZ + 0.045, 0.5); // brim
  // chest plate and belt with two pouches
  if (k !== 'assault' && k !== 'medic') piece(l, 0.32, 0.26, 0.05, 0.03, 0, 0.0, HZ + 0.015, 0.52);
  piece(l, U.W + 0.03, 0.055, U.D + 0.03, 0.02, 0, -HY + 0.2, 0, 0.2);
  for (const sx of [-1, 1]) piece(l, 0.08, 0.09, 0.06, 0.02, sx * 0.13, -HY + 0.2, HZ + 0.03, 0.34);
  // shoulder pads
  if (k !== 'assault') for (const sx of [-1, 1]) piece(l, 0.1, 0.07, U.D * 0.82, 0.03, sx * (HX - 0.01), HY - 0.2, 0, 1);
  // knee-high boots read as a darker band over the leg top
}

const KIND = {
  rifleman: (l) => {},
  assault: (l) => {
    piece(l, 0.12, 0.07, 0.04, 0.02, 0.1, 0.0, HZ + 0.03, 0.4); // mag rig
    piece(l, 0.12, 0.07, 0.04, 0.02, -0.1, 0.0, HZ + 0.03, 0.4);
    piece(l, U.W + 0.02, 0.03, 0.04, 0.012, 0, 0.17, HZ + 0.03, 0.9, [0, 0, 0]); // goggle strap
    piece(l, 0.1, 0.07, U.D * 0.82, 0.03, HX - 0.01, HY - 0.2, 0, 1); // single shoulder pad
  },
  gunner: (l) => {
    for (let i = 0; i < 5; i++) piece(l, 0.05, 0.075, 0.045, 0.012, -0.15 + i * 0.075, 0.12 - i * 0.055, HZ + 0.045, 0.85, [0, 0, -0.55]); // belt of rounds
    for (const sx of [-1, 1]) piece(l, 0.15, 0.1, U.D * 0.95, 0.04, sx * (HX + 0.0), HY - 0.17, 0, 1); // big pads
  },
  flamer: (l) => {
    piece(l, U.W + 0.06, 0.32, U.D + 0.1, 0.1, 0, HY - 0.1, 0.0, 0.55, [0, 0, 0], 3); // hood
    for (const sx of [-1, 1]) piece(l, 0.13, 0.42, 0.13, 0.055, sx * 0.1, 0.02, -HZ - 0.19, 0.7, [0, 0, 0], 3); // twin tanks
    piece(l, 0.14, 0.05, 0.1, 0.02, 0, 0.2, -HZ - 0.15, 0.3); // tank yoke
    piece(l, 0.07, 0.07, 0.07, 0.03, 0, -0.05, HZ + 0.03, 0.9); // chest valve
  },
  mortar: (l) => {
    piece(l, 0.11, 0.11, 0.62, 0.045, 0.02, 0.1, -HZ - 0.12, 0.45, [0.5, 0, 0], 3); // tube slung on the back
    piece(l, 0.26, 0.05, 0.2, 0.02, 0, -0.1, -HZ - 0.15, 0.7, [0, 0, 0]); // baseplate
    piece(l, 0.14, 0.1, 0.06, 0.02, 0, 0.0, HZ + 0.04, 0.35); // shell pouch
  },
  coil: (l) => {
    piece(l, 0.05, 0.28, 0.05, 0.02, 0.17, HY + 0.05, -0.06, 0.35); // antenna
    piece(l, 0.2, 0.08, 0.08, 0.03, 0, HY - 0.02, HZ + 0.05, 0.9); // wide crest
    piece(l, 0.2, 0.2, 0.09, 0.04, 0, 0.0, -HZ - 0.16, 0.6); // capacitor pack
  },
  medic: (l) => {
    piece(l, U.W + 0.06, 0.2, U.D + 0.06, 0.07, 0, HY - 0.06, 0.005, 1, [0, 0, 0], 3); // pale helmet
    piece(l, 0.3, 0.2, 0.06, 0.035, 0, -0.02, HZ + 0.02, 0.8); // chest satchel strap
    piece(l, 0.17, 0.2, 0.08, 0.04, 0.15, -HY + 0.2, -HZ - 0.02, 0.5); // field kit on the hip
  },
};

// fixed-colour marks: [geometry list with vertex colours]
function marks(kind) {
  const l = [];
  const col = (g, r, gg, b) => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const add = (w, h, d, x, y, z, c) => {
    const g = new RoundedBoxGeometry(w, h, d, 1, 0.008).toNonIndexed(); g.deleteAttribute('uv'); g.translate(x, y, z);
    l.push(col(g, ...c));
  };
  if (kind === 'medic') {
    for (const [z, y, s] of [[HZ + 0.052, 0.0, 1], [HZ + 0.075, HY - 0.095, 0.0]]) {
      if (!s) continue;
      add(0.2, 0.2, 0.01, 0.0, y + 0.02, z + 0.012 - 0.04, [0.92, 0.92, 0.88]);
      add(0.13, 0.04, 0.012, 0, y + 0.02, z - 0.03, [0.78, 0.1, 0.1]);
      add(0.04, 0.13, 0.012, 0, y + 0.02, z - 0.03, [0.78, 0.1, 0.1]);
    }
    // helmet cross
    add(0.1, 0.1, 0.01, 0, HY - 0.07, HZ + 0.034, [0.92, 0.92, 0.88]);
    add(0.07, 0.022, 0.012, 0, HY - 0.07, HZ + 0.039, [0.78, 0.1, 0.1]);
    add(0.022, 0.07, 0.012, 0, HY - 0.07, HZ + 0.039, [0.78, 0.1, 0.1]);
  }
  if (kind === 'coil') {
    add(0.04, 0.04, 0.04, 0.17, HY + 0.2, -0.06, [0.4, 1, 0.9]); // antenna tip
    for (const sx of [-1, 1]) add(0.05, 0.05, 0.12, sx * (HX + 0.045), HY - 0.2, 0, [0.4, 1, 0.9]);
    add(0.14, 0.03, 0.01, 0, HY - 0.02, HZ + 0.095, [0.4, 1, 0.9]); // crest light
  }
  return l.length ? merge(l) : null;
}

export const KIND_IDS = Object.keys(KIND);
export const GEAR = {}, MARKS = {};
for (const k of KIND_IDS) {
  const l = [];
  base(l, k);
  KIND[k](l);
  GEAR[k] = merge(l);
  MARKS[k] = marks(k);
}
export const kindKey = (kind) => (KIND[kind] ? kind : 'rifleman');

// Limb segment: rounded block along z at its nominal length (scaled to fit per instance).
export const LIMB_GEO = {
  leg: new RoundedBoxGeometry(U.LEG_T, U.LEG_T, SEG_LEN, 2, 0.045),
};
