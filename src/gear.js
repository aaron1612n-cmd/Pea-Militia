import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U } from './rig.js';

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
// plain box for tiny fittings (buckles, studs, stitching): 12 triangles instead of a rounded block
function flat(list, w, h, d, x, y, z, shade, rot = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(shade), 3));
  list.push(g);
}
const merge = (list) => mergeGeometries(list, false);

// pieces every soldier wears (body frame: origin at the torso centre, +z forward, -x is the right side)
function base(l, k) {
  const pkY = U.PACK_Y - U.BODY_Y, pkZ = -HZ - U.PACK[2] / 2 + 0.03;
  // collar and shoulder epaulettes over the arm joints
  piece(l, 0.17, 0.034, 0.13, 0.014, 0, HY - 0.012, -0.004, 0.45);
  if (k !== 'assault') for (const sx of [-1, 1]) piece(l, 0.085, 0.05, 0.13, 0.022, sx * (HX + 0.006), HY - 0.045, 0, 1);
  // chest plate and harness braces down to the belt
  if (k !== 'assault' && k !== 'medic') piece(l, 0.2, 0.15, 0.04, 0.02, 0, 0.06, HZ + 0.008, 0.52);
  for (const sx of [-1, 1]) flat(l, 0.032, 0.34, 0.012, sx * 0.072, 0.03, HZ + 0.004, 0.3, [0, 0, sx * 0.05]);
  // belt with pouches, buckle, canteen, holster and a grenade
  piece(l, 0.292, 0.044, 0.2, 0.016, 0, -HY + 0.095, 0.0, 0.22);
  for (const sx of [-1, 1]) piece(l, 0.06, 0.065, 0.045, 0.014, sx * 0.075, -HY + 0.1, HZ + 0.012, 0.36);
  flat(l, 0.04, 0.034, 0.014, 0, -HY + 0.095, HZ + 0.012, 0.9);
  piece(l, 0.05, 0.1, 0.07, 0.022, -0.15, -HY + 0.07, -0.04, 0.45, [0, 0, 0], 2); // canteen
  piece(l, 0.04, 0.09, 0.065, 0.015, 0.152, -HY + 0.06, 0.03, 0.28); // holster
  piece(l, 0.04, 0.055, 0.04, 0.018, -0.07, 0.115, HZ + 0.018, 0.55); // hand grenade
  flat(l, 0.014, 0.014, 0.014, -0.07, 0.15, HZ + 0.018, 0.9);
  for (let i = 0; i < 2; i++) flat(l, 0.05, 0.01, 0.008, 0.07, 0.15 + i * 0.022, HZ + 0.004, 1, [0, 0, 0.22]); // rank chevrons
  // pack detail: top flap, side pockets, straps, bedroll, entrenching tool
  piece(l, U.PACK[0] + 0.02, 0.05, U.PACK[2] + 0.02, 0.02, 0, pkY + 0.115, pkZ, 0.6);
  for (const sx of [-1, 1]) {
    piece(l, 0.05, 0.12, 0.07, 0.02, sx * (U.PACK[0] / 2 + 0.012), pkY - 0.02, pkZ, 0.55);
    flat(l, 0.024, U.PACK[1] * 0.9, 0.01, sx * 0.065, pkY, pkZ - U.PACK[2] / 2 - 0.006, 0.3);
    flat(l, 0.028, 0.02, 0.012, sx * 0.065, pkY - 0.05, pkZ - U.PACK[2] / 2 - 0.01, 0.9);
  }
  piece(l, U.PACK[0] + 0.07, 0.055, 0.075, 0.026, 0, pkY + 0.18, pkZ, 0.42, [0, 0, 0], 3);
  piece(l, 0.012, 0.17, 0.04, 0.005, 0.045, pkY - 0.16, pkZ - U.PACK[2] / 2 - 0.02, 0.5);
  piece(l, 0.07, 0.07, 0.01, 0.008, 0.045, pkY - 0.26, pkZ - U.PACK[2] / 2 - 0.02, 0.6);
}

const KIND = {
  rifleman: (l) => {
    piece(l, 0.012, 0.3, 0.012, 0.005, 0.152, -0.13, 0.0, 0.4, [0.12, 0, 0]); // bayonet in its scabbard
    piece(l, 0.08, 0.055, 0.035, 0.012, -0.03, -0.045, HZ + 0.014, 0.38); // map case
    flat(l, 0.09, 0.012, 0.012, -0.03, -0.02, HZ + 0.03, 0.9);
  },
  assault: (l) => {
    for (const sx of [-1, 1]) piece(l, 0.09, 0.06, 0.04, 0.016, sx * 0.07, 0.04, HZ + 0.008, 0.4); // mag rigs
    piece(l, 0.085, 0.05, 0.13, 0.022, -(HX + 0.006), HY - 0.045, 0, 1); // single shoulder pad
    for (let i = 0; i < 6; i++) flat(l, 0.018, 0.04, 0.016, -0.1 + i * 0.04, 0.17 - i * 0.045, HZ + 0.03, 0.85, [0, 0, -0.55]); // bandolier rounds
    piece(l, 0.15, 0.05, 0.12, 0.024, 0, HY + 0.0, 0.0, 0.55); // scarf at the neck
    for (const sx of [-1, 1]) piece(l, 0.05, 0.07, 0.04, 0.014, sx * 0.12, -0.08, HZ + 0.008, 0.42);
  },
  gunner: (l) => {
    for (let i = 0; i < 5; i++) piece(l, 0.04, 0.055, 0.035, 0.01, -0.1 + i * 0.05, 0.14 - i * 0.04, HZ + 0.03, 0.85, [0, 0, -0.55]); // belt of rounds
    for (const sx of [-1, 1]) piece(l, 0.11, 0.07, 0.15, 0.03, sx * (HX + 0.01), HY - 0.04, 0, 1); // big pads
    piece(l, 0.18, 0.14, 0.1, 0.025, 0, 0.0, -HZ - 0.16, 0.5); // ammo box on the back
    flat(l, 0.19, 0.014, 0.11, 0, 0.075, -HZ - 0.16, 0.3);
    piece(l, 0.16, 0.04, 0.04, 0.014, 0, -0.08, HZ + 0.012, 0.38);
  },
  flamer: (l) => {
    for (const sx of [-1, 1]) piece(l, 0.09, 0.3, 0.09, 0.04, sx * 0.07, 0.05, -HZ - 0.16, 0.7, [0, 0, 0], 3); // twin tanks
    piece(l, 0.15, 0.04, 0.08, 0.016, 0, 0.18, -HZ - 0.12, 0.3); // tank yoke
    piece(l, 0.05, 0.05, 0.05, 0.02, 0, 0.0, HZ + 0.02, 0.9); // chest valve
    for (const sx of [-1, 1]) {
      flat(l, 0.012, 0.22, 0.012, sx * 0.07, 0.12, -HZ - 0.07, 0.3);
      flat(l, 0.08, 0.014, 0.012, sx * 0.07, 0.0, -HZ - 0.205, 0.9);
      flat(l, 0.08, 0.014, 0.012, sx * 0.07, 0.17, -HZ - 0.205, 0.9);
    }
    piece(l, 0.24, 0.17, 0.02, 0.012, 0, -0.03, HZ + 0.012, 0.4); // apron
    piece(l, 0.022, 0.022, 0.2, 0.009, 0.0, 0.14, -HZ + 0.02, 0.3); // hose along the shoulder
  },
  mortar: (l) => {
    piece(l, 0.08, 0.08, 0.44, 0.032, 0.03, 0.08, -HZ - 0.12, 0.45, [0.45, 0, 0], 3); // tube slung on the back
    piece(l, 0.19, 0.035, 0.14, 0.014, 0, -0.06, -HZ - 0.15, 0.7); // baseplate
    piece(l, 0.1, 0.07, 0.04, 0.014, 0, 0.0, HZ + 0.012, 0.35); // shell pouch
    for (let i = 0; i < 3; i++) piece(l, 0.035, 0.07, 0.035, 0.014, -0.05 + i * 0.05, -0.1, HZ + 0.014, 0.55); // shell rounds
    flat(l, 0.06, 0.014, 0.14, 0.0, 0.1, -HZ - 0.3, 0.7, [0.45, 0, 0]); // tube bipod
  },
  coil: (l) => {
    piece(l, 0.035, 0.22, 0.035, 0.014, 0.15, HY + 0.02, -0.07, 0.35); // antenna
    piece(l, 0.15, 0.15, 0.07, 0.03, 0, 0.02, -HZ - 0.12, 0.6); // capacitor pack
    for (const sx of [-1, 1]) {
      piece(l, 0.022, 0.022, 0.18, 0.009, sx * 0.06, HY - 0.02, -0.04, 0.45); // cables over the shoulders
      piece(l, 0.03, 0.15, 0.03, 0.01, sx * 0.13, -0.02, -HZ - 0.03, 0.5);
    }
    for (let i = 0; i < 3; i++) flat(l, 0.13, 0.01, 0.008, 0, -0.04 + i * 0.05, -HZ - 0.16, 0.35);
    piece(l, 0.09, 0.04, 0.045, 0.014, 0, 0.1, HZ + 0.018, 0.5); // power gauge box
  },
  medic: (l) => {
    piece(l, 0.2, 0.15, 0.045, 0.026, 0, 0.0, HZ + 0.01, 0.8); // chest satchel
    piece(l, 0.12, 0.14, 0.06, 0.028, 0.115, -HY + 0.1, -HZ - 0.02, 0.5); // field kit on the hip
    piece(l, 0.07, 0.07, 0.06, 0.022, -0.1, -HY + 0.1, -HZ - 0.02, 0.8); // second pouch
    for (const sx of [-1, 1]) piece(l, 0.1, 0.022, 0.022, 0.009, sx * 0.07, 0.1, -HZ - 0.19, 0.9, [0, 0, 1.5]); // rolled stretcher poles
    piece(l, 0.07, 0.035, 0.035, 0.014, -0.08, -0.07, HZ + 0.02, 0.9); // bandage roll
  },
};

// fixed-colour marks
function marks(kind) {
  const l = [];
  const col = (g, r, gg, b) => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const add = (w, h, d, x, y, z, c) => {
    const g = new RoundedBoxGeometry(w, h, d, 1, 0.006).toNonIndexed(); g.deleteAttribute('uv'); g.translate(x, y, z);
    l.push(col(g, ...c));
  };
  if (kind === 'medic') {
    const z = HZ + 0.034;
    add(0.15, 0.15, 0.004, 0, 0.0, z, [0.92, 0.92, 0.88]);
    add(0.1, 0.03, 0.006, 0, 0.0, z + 0.003, [0.78, 0.1, 0.1]);
    add(0.03, 0.1, 0.006, 0, 0.0, z + 0.003, [0.78, 0.1, 0.1]);
    add(0.004, 0.05, 0.05, -(HX + 0.036), HY - 0.06, 0, [0.92, 0.92, 0.88]); // armband cross
    add(0.006, 0.01, 0.036, -(HX + 0.039), HY - 0.06, 0, [0.78, 0.1, 0.1]);
    add(0.006, 0.036, 0.01, -(HX + 0.039), HY - 0.06, 0, [0.78, 0.1, 0.1]);
  }
  if (kind === 'coil') {
    add(0.03, 0.03, 0.03, 0.15, HY + 0.145, -0.07, [0.4, 1, 0.9]); // antenna tip
    for (const sx of [-1, 1]) add(0.04, 0.04, 0.09, sx * (HX + 0.052), HY - 0.045, 0, [0.4, 1, 0.9]);
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
