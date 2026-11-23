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
// plain box for tiny fittings (buckles, studs, stitching): 12 triangles instead of a rounded block
function flat(list, w, h, d, x, y, z, shade, rot = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(shade), 3));
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
  // helmet detail: rim band, ear flaps, chin strap, top stud, front badge and a spotting net knot
  piece(l, U.W + 0.055, 0.026, U.D + 0.06, 0.012, 0, HY - 0.135, 0.005, 0.4);
  for (const sx of [-1, 1]) {
    piece(l, 0.03, 0.12, 0.14, 0.012, sx * (HX + 0.026), HY - 0.17, 0.02, 0.62);
    flat(l, 0.012, 0.15, 0.03, sx * (HX + 0.045), HY - 0.2, HZ * 0.55, 0.3, [0.35, 0, 0]);
  }
  flat(l, 0.05, 0.02, 0.05, 0, HY + 0.037, 0.01, 0.35);
  flat(l, 0.06, 0.05, 0.012, 0, HY - 0.075, HZ + 0.032, 1);
  flat(l, U.W * 0.7, 0.014, 0.014, 0, HY + 0.02, HZ + 0.03, 0.3);
  // collar and neck seam under the helmet
  piece(l, U.W - 0.04, 0.03, U.D + 0.012, 0.01, 0, HY - 0.215, 0, 0.45);
  // harness: two braces from the shoulders down to the belt, buckle, chest pouches and a grenade
  for (const sx of [-1, 1]) {
    flat(l, 0.04, 0.5, 0.012, sx * 0.1, 0.02, HZ + 0.006, 0.3, [0, 0, sx * 0.05]);
    for (let i = 0; i < 3; i++) piece(l, 0.05, 0.06, 0.04, 0.012, sx * 0.065 + (sx * i * 0.0), -0.06 - i * 0.0 + 0.1, HZ + 0.035, 0.38 + (i === 1 ? 0.02 : 0));
  }
  flat(l, 0.06, 0.05, 0.016, 0, -HY + 0.2, HZ + 0.02, 0.9); // belt buckle
  piece(l, 0.05, 0.075, 0.05, 0.022, -0.13, 0.12, HZ + 0.04, 0.55, [0, 0, 0], 2); // hand grenade
  flat(l, 0.02, 0.02, 0.02, -0.13, 0.17, HZ + 0.04, 0.9);
  // rank chevrons high on the right chest and an armband on the left shoulder
  for (let i = 0; i < 2; i++) flat(l, 0.07, 0.014, 0.01, 0.1, 0.18 + i * 0.03, HZ + 0.008, 1, [0, 0, 0.22]);
  piece(l, 0.014, 0.05, U.D * 0.7, 0.005, -(HX + 0.012), HY - 0.3, 0, 0.95);
  // belt kit: canteen and holster at the hips, entrenching tool and bedroll on the back
  piece(l, 0.06, 0.15, 0.11, 0.03, HX * 0.75, -HY + 0.12, -0.04, 0.45, [0, 0, 0], 2); // canteen
  flat(l, 0.07, 0.022, 0.12, HX * 0.75, -HY + 0.2, -0.04, 0.3);
  piece(l, 0.055, 0.12, 0.08, 0.02, -HX * 0.78, -HY + 0.1, 0.06, 0.28); // holster
  piece(l, 0.015, 0.2, 0.05, 0.006, -0.04, -HY + 0.15, -HZ - 0.035, 0.5, [0.06, 0, 0]); // spade handle
  piece(l, 0.08, 0.09, 0.012, 0.01, -0.04, -HY + 0.03, -HZ - 0.035, 0.6); // spade blade
  // pack detail: top flap, side pockets, buckled straps, bedroll across the top
  const pkY = U.PACK_Y - U.BODY_Y, pkZ = -HZ - U.PACK[2] / 2 + 0.02;
  piece(l, U.PACK[0] + 0.03, 0.08, U.PACK[2] + 0.03, 0.025, 0, pkY + 0.14, pkZ - 0.005, 0.6);
  for (const sx of [-1, 1]) piece(l, 0.07, 0.15, 0.09, 0.025, sx * (U.PACK[0] / 2 + 0.03), pkY - 0.04, pkZ, 0.55);
  for (const sx of [-1, 1]) {
    flat(l, 0.03, U.PACK[1] * 0.9, 0.012, sx * 0.08, pkY, pkZ - U.PACK[2] / 2 - 0.008, 0.3);
    flat(l, 0.034, 0.025, 0.016, sx * 0.08, pkY - 0.06, pkZ - U.PACK[2] / 2 - 0.012, 0.9);
  }
  piece(l, U.PACK[0] + 0.1, 0.07, 0.09, 0.034, 0, pkY + 0.21, pkZ - 0.005, 0.42, [0, 0, 0], 3);
  for (const sx of [-1, 1]) flat(l, 0.012, 0.075, 0.095, sx * 0.1, pkY + 0.21, pkZ - 0.005, 0.25);
  // shoulder epaulettes and trouser pockets
  for (const sx of [-1, 1]) {
    flat(l, 0.05, 0.012, 0.09, sx * (HX - 0.08), HY - 0.11, HZ * 0.4, 0.3);
    piece(l, 0.016, 0.08, 0.09, 0.008, sx * (HX + 0.006), -HY + 0.05, 0.02, 0.4); // thigh pockets
  }
}

const KIND = {
  rifleman: (l) => {
    piece(l, 0.015, 0.4, 0.015, 0.005, 0.18, 0.15, -HZ - 0.09, 0.4, [0.3, 0, 0]); // bayonet in its scabbard
    piece(l, 0.1, 0.07, 0.04, 0.015, 0, -0.1, HZ + 0.035, 0.38); // map case
    flat(l, 0.12, 0.02, 0.02, 0, -0.06, HZ + 0.037, 0.9);
  },
  assault: (l) => {
    piece(l, 0.12, 0.07, 0.04, 0.02, 0.1, 0.0, HZ + 0.03, 0.4); // mag rig
    piece(l, 0.12, 0.07, 0.04, 0.02, -0.1, 0.0, HZ + 0.03, 0.4);
    piece(l, U.W + 0.02, 0.03, 0.04, 0.012, 0, 0.17, HZ + 0.03, 0.9, [0, 0, 0]); // goggle strap
    piece(l, 0.1, 0.07, U.D * 0.82, 0.03, HX - 0.01, HY - 0.2, 0, 1); // single shoulder pad
    piece(l, 0.2, 0.06, 0.05, 0.02, 0, -0.18, HZ + 0.03, 0.5); // bandolier bottom pouch row
    for (let i = 0; i < 6; i++) flat(l, 0.022, 0.05, 0.02, -0.15 + i * 0.06, 0.1 - i * 0.04, HZ + 0.07, 0.85, [0, 0, -0.55]); // bandolier rounds
    piece(l, 0.2, 0.06, 0.1, 0.03, 0, HY - 0.22, HZ * 0.3, 0.55); // scarf at the neck
    for (const sx of [-1, 1]) piece(l, 0.06, 0.1, 0.05, 0.02, sx * 0.17, -0.3, HZ + 0.03, 0.42); // pockets
  },
  gunner: (l) => {
    for (let i = 0; i < 5; i++) piece(l, 0.05, 0.075, 0.045, 0.012, -0.15 + i * 0.075, 0.12 - i * 0.055, HZ + 0.045, 0.85, [0, 0, -0.55]); // belt of rounds
    for (const sx of [-1, 1]) piece(l, 0.15, 0.1, U.D * 0.95, 0.04, sx * (HX + 0.0), HY - 0.17, 0, 1); // big pads
    piece(l, 0.24, 0.2, 0.14, 0.03, 0, 0.0, -HZ - 0.15, 0.5); // ammo box on the back
    flat(l, 0.26, 0.02, 0.15, 0, 0.11, -HZ - 0.15, 0.3);
    for (let i = 0; i < 4; i++) flat(l, 0.018, 0.04, 0.02, -0.12 + i * 0.08, 0.1, HZ + 0.08, 0.85, [0, 0, -0.55]);
    piece(l, 0.22, 0.05, 0.05, 0.02, 0, -0.2, HZ + 0.03, 0.38); // wide belt pouch
  },
  flamer: (l) => {
    piece(l, U.W + 0.06, 0.32, U.D + 0.1, 0.1, 0, HY - 0.1, 0.0, 0.55, [0, 0, 0], 3); // hood
    for (const sx of [-1, 1]) piece(l, 0.13, 0.42, 0.13, 0.055, sx * 0.1, 0.02, -HZ - 0.19, 0.7, [0, 0, 0], 3); // twin tanks
    piece(l, 0.14, 0.05, 0.1, 0.02, 0, 0.2, -HZ - 0.15, 0.3); // tank yoke
    piece(l, 0.07, 0.07, 0.07, 0.03, 0, -0.05, HZ + 0.03, 0.9); // chest valve
    for (const sx of [-1, 1]) {
      flat(l, 0.014, 0.3, 0.014, sx * 0.1, 0.18, -HZ - 0.1, 0.3, [0, 0, 0]); // tank straps
      flat(l, 0.1, 0.02, 0.014, sx * 0.1, 0.06, -HZ - 0.19, 0.9);
      flat(l, 0.1, 0.02, 0.014, sx * 0.1, 0.24, -HZ - 0.19, 0.9);
      flat(l, 0.03, 0.04, 0.03, sx * 0.1, 0.25, -HZ - 0.19, 0.4); // cap valve
    }
    piece(l, 0.34, 0.26, 0.03, 0.02, 0, -0.05, HZ + 0.03, 0.4); // asbestos apron
    for (let i = 0; i < 3; i++) flat(l, 0.3, 0.012, 0.01, 0, -0.14 + i * 0.07, HZ + 0.048, 0.25);
    piece(l, 0.03, 0.03, 0.26, 0.012, 0.0, 0.12, -HZ + 0.12, 0.3, [0, 0, 0]); // hose along the shoulder
  },
  mortar: (l) => {
    piece(l, 0.11, 0.11, 0.62, 0.045, 0.02, 0.1, -HZ - 0.12, 0.45, [0.5, 0, 0], 3); // tube slung on the back
    piece(l, 0.26, 0.05, 0.2, 0.02, 0, -0.1, -HZ - 0.15, 0.7, [0, 0, 0]); // baseplate
    piece(l, 0.14, 0.1, 0.06, 0.02, 0, 0.0, HZ + 0.04, 0.35); // shell pouch
    for (let i = 0; i < 3; i++) piece(l, 0.05, 0.1, 0.05, 0.02, -0.07 + i * 0.07, -0.18, HZ + 0.03, 0.55); // shell rounds
    flat(l, 0.08, 0.02, 0.2, 0.0, 0.1, -HZ - 0.34, 0.7, [0.5, 0, 0]); // tube bipod
    piece(l, 0.04, 0.05, 0.05, 0.015, 0, 0.14, HZ * 0.3, 0.7); // range-finder on the helmet
  },
  coil: (l) => {
    piece(l, 0.05, 0.28, 0.05, 0.02, 0.17, HY + 0.05, -0.06, 0.35); // antenna
    piece(l, 0.2, 0.08, 0.08, 0.03, 0, HY - 0.02, HZ + 0.05, 0.9); // wide crest
    piece(l, 0.2, 0.2, 0.09, 0.04, 0, 0.0, -HZ - 0.16, 0.6); // capacitor pack
    for (const sx of [-1, 1]) {
      piece(l, 0.03, 0.03, 0.22, 0.012, sx * 0.06, 0.12, -0.05, 0.45); // cables over the shoulders
      piece(l, 0.04, 0.2, 0.04, 0.014, sx * 0.22, -0.02, -HZ - 0.04, 0.5);
    }
    for (let i = 0; i < 3; i++) flat(l, 0.18, 0.012, 0.01, 0, -0.07 + i * 0.07, -HZ - 0.21, 0.35);
    piece(l, 0.12, 0.05, 0.06, 0.02, 0, 0.14, HZ + 0.03, 0.5); // power gauge box
  },
  medic: (l) => {
    piece(l, U.W + 0.06, 0.2, U.D + 0.06, 0.07, 0, HY - 0.06, 0.005, 1, [0, 0, 0], 3); // pale helmet
    piece(l, 0.3, 0.2, 0.06, 0.035, 0, -0.02, HZ + 0.02, 0.8); // chest satchel strap
    piece(l, 0.17, 0.2, 0.08, 0.04, 0.15, -HY + 0.2, -HZ - 0.02, 0.5); // field kit on the hip
    piece(l, 0.1, 0.1, 0.08, 0.03, -0.15, -HY + 0.18, -HZ - 0.02, 0.8); // second pouch
    flat(l, 0.14, 0.02, 0.02, 0.0, 0.12, HZ + 0.03, 0.6, [0, 0, 0.5]); // sash
    for (const sx of [-1, 1]) piece(l, 0.14, 0.03, 0.03, 0.012, sx * 0.1, 0.18, -HZ - 0.07, 0.9, [0, 0, 1.5]); // rolled stretcher poles
    piece(l, 0.1, 0.05, 0.05, 0.02, -0.12, -0.12, HZ + 0.035, 0.9); // bandage roll
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
  if (kind === 'medic') {
    add(0.016, 0.07, 0.07, -(HX + 0.026), HY - 0.3, 0, [0.92, 0.92, 0.88]); // armband cross
    add(0.018, 0.012, 0.05, -(HX + 0.03), HY - 0.3, 0, [0.78, 0.1, 0.1]);
    add(0.018, 0.05, 0.012, -(HX + 0.03), HY - 0.3, 0, [0.78, 0.1, 0.1]);
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

// Fixed-colour fittings that ride on the instanced feet and hands: boot soles, toe caps, laces and
// a cuff band on the glove. Same matrices as the plain parts, so they can never come loose.
function shaded(list, c) {
  for (const g of list) {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = g.attributes.color.array[i * 3]; a[i * 3] = c[0] * v; a[i * 3 + 1] = c[1] * v; a[i * 3 + 2] = c[2] * v; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
}
const [FW, FH, FD] = U.FOOT, [HW, HH, HD] = U.HAND;
export const FOOT_DETAIL = (() => {
  const a = [], b = [], c = [];
  piece(a, FW + 0.012, 0.022, FD + 0.012, 0.01, 0, -FH / 2 + 0.011, 0, 1); // sole
  piece(a, FW * 0.9, 0.05, 0.06, 0.02, 0, -FH / 2 + 0.035, -FD / 2 + 0.03, 0.8); // heel block
  piece(b, FW * 0.92, FH * 0.55, 0.07, 0.025, 0, 0.0, FD / 2 - 0.02, 1); // toe cap
  piece(b, FW + 0.008, 0.03, 0.055, 0.012, 0, FH / 2 - 0.005, -FD / 2 + 0.03, 1); // ankle cuff
  for (let i = 0; i < 3; i++) flat(c, FW * 0.6, 0.006, 0.012, 0, FH / 2 + 0.002, -0.015 + i * 0.045, 1); // laces
  shaded(a, [0.07, 0.065, 0.06]); shaded(b, [0.2, 0.17, 0.14]); shaded(c, [0.7, 0.68, 0.6]);
  return merge([...a, ...b, ...c]);
})();
export const HAND_DETAIL = (() => {
  const a = [], b = [];
  piece(a, HW + 0.014, 0.03, 0.03, 0.012, 0, 0.0, -HD / 2 + 0.01, 1); // glove cuff
  for (let i = 0; i < 3; i++) flat(b, 0.022, 0.012, 0.02, -0.03 + i * 0.03, HH / 2 - 0.002, HD / 2 - 0.012, 1); // knuckle plates
  shaded(a, [0.12, 0.11, 0.1]); shaded(b, [0.32, 0.3, 0.26]);
  return merge([...a, ...b]);
})();
