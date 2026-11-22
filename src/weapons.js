import * as THREE from 'three';
import { MAT, Kit, instance, profile, roundRect, turned, rod, ring, bolt, pipe, ellipsoidGeo, block } from './models.js';

// Weapons: WW2 service arms, a little steam, a little future. Models are in hold units
// (scaled by U.WEAPON_SCALE when drawn), grip at the origin, barrel along +z.
// kind: hitscan | projectile | flame | throw
export const WEAPONS = {
  rifle: {
    name: 'Rifle', kind: 'hitscan', auto: false, interval: 0.42, damage: 48, spread: 0.004, mag: 8, reserve: 64,
    reload: 1.7, range: 70, pierce: 0.15, tracer: '#ffdca8', sound: 'rifle', ideal: [14, 34], burst: [1, 1],
  },
  smg: {
    name: 'SMG', kind: 'hitscan', auto: true, interval: 0.075, damage: 13, spread: 0.035, mag: 40, reserve: 240,
    reload: 1.9, range: 32, pierce: 0.05, tracer: '#ffd08a', sound: 'smg', ideal: [4, 14], burst: [4, 9],
  },
  mg: {
    name: 'MG', kind: 'hitscan', auto: true, interval: 0.1, damage: 19, spread: 0.022, mag: 90, reserve: 270,
    reload: 3.2, range: 55, pierce: 0.12, tracer: '#ffc070', sound: 'mg', ideal: [10, 30], burst: [6, 12], move: 0.8,
  },
  plasma: {
    name: 'Coil gun', kind: 'projectile', auto: true, interval: 0.24, damage: 30, splash: 14, radius: 1.3, speed: 32,
    gravity: 0, heat: 0.13, mag: Infinity, range: 40, pierce: 0.7, sound: 'plasma', ideal: [7, 22], burst: [3, 6], proj: 'plasma',
  },
  flame: {
    name: 'Flamer', kind: 'flame', auto: true, interval: 0.05, dps: 75, mag: 100, reserve: 300, reload: 2.4,
    range: 7.5, pierce: 0.25, sound: 'flame', ideal: [1.5, 6], burst: [12, 30], move: 0.9,
  },
  launcher: {
    name: 'Steam mortar', kind: 'projectile', auto: false, interval: 1.1, damage: 130, radius: 3.3, speed: 19, gravity: 9.8,
    mag: 1, reserve: 14, reload: 1.6, range: 40, pierce: 1, sound: 'steam', ideal: [9, 30], burst: [1, 1], proj: 'shell', speed2: 0.85,
  },
  grenade: {
    name: 'Grenade', kind: 'throw', auto: false, interval: 1.0, damage: 120, radius: 3.4, speed: 11, gravity: 9.8, fuse: 2.4,
    mag: 1, reserve: 5, reload: 0.7, range: 22, pierce: 0.9, sound: 'throw', ideal: [6, 18], burst: [1, 1], proj: 'grenade',
  },
};
export const SLOTS = ['rifle', 'smg', 'mg', 'plasma', 'flame', 'launcher', 'grenade'];

// ---------------- models ----------------
// Iron sights on top of every long gun: a notched rear block and a hooded front post, both on
// one line at height y so aiming down the sights lines that line up with the eye.
function sights(k, y, zr, zf, base = 0) {
  k.add(profile(roundRect(zr - 0.018, base, zr + 0.018, y - 0.006, 0.004), 0.03, 0.003), MAT.darkSteel); // rear block
  for (const s of [-1, 1]) k.add(profile(roundRect(zr - 0.01, y - 0.008, zr + 0.01, y + 0.006, 0.002), 0.008, 0.001), MAT.darkSteel, { pos: [s * 0.009, 0, 0] });
  k.add(profile(roundRect(zf - 0.012, base, zf + 0.012, y - 0.012, 0.004), 0.02, 0.003), MAT.darkSteel); // front base
  k.add(profile(roundRect(zf - 0.004, y - 0.014, zf + 0.004, y + 0.004, 0.0015), 0.004, 0.001), MAT.steel); // post
  for (const s of [-1, 1]) k.add(profile(roundRect(zf - 0.008, y - 0.014, zf + 0.008, y + 0.01, 0.003), 0.004, 0.001), MAT.darkSteel, { pos: [s * 0.012, 0, 0] }); // hood ears
  return y;
}
function swivel(k, z, y) { k.add(ring(0.011, 0.0025, 10), MAT.darkSteel, { pos: [0, y, z], rot: [0, Math.PI / 2, 0] }); }

function rifle(k) {
  // walnut stock with a pistol-grip wrist and a cheek rise
  k.add(profile([[-0.4, -0.07], [-0.4, 0.04], [-0.37, 0.05], [-0.22, 0.05], [-0.1, 0.036], [-0.035, 0.03], [0.0, 0.012], [0.012, -0.02],
    [0.0, -0.055], [-0.03, -0.058], [-0.045, -0.02], [-0.12, -0.028], [-0.37, -0.08]], 0.044, 0.009), MAT.wood);
  k.add(profile([[-0.404, -0.072], [-0.404, 0.042], [-0.393, 0.042], [-0.393, -0.074]], 0.05, 0.004), MAT.rubber); // butt pad
  k.add(profile(roundRect(-0.03, -0.004, 0.19, 0.058, 0.012), 0.042, 0.006), MAT.steel); // receiver
  k.add(profile(roundRect(0.0, 0.052, 0.15, 0.062, 0.004), 0.03, 0.003), MAT.darkSteel); // top cover
  k.add(profile(roundRect(0.06, -0.075, 0.13, -0.004, 0.01), 0.036, 0.005), MAT.darkSteel); // box magazine
  k.add(profile(roundRect(0.18, -0.008, 0.44, 0.036, 0.014), 0.044, 0.008), MAT.wood); // handguard
  k.add(rod(0.012, 0.16, 0.6), MAT.darkSteel, { pos: [0, 0.03, 0] });
  k.add(turned([[0, 0.58], [0.017, 0.58], [0.019, 0.6], [0.019, 0.625], [0.012, 0.63], [0, 0.63]], 12), MAT.darkSteel, { pos: [0, 0.03, 0] }); // muzzle brake
  for (const z of [0.24, 0.42]) k.add(ring(0.026, 0.0055, 16), MAT.darkSteel, { pos: [0, 0.015, z] });
  k.add(ellipsoidGeo(0.013, 0.013, 0.013, 8, 6), MAT.steel, { pos: [0.04, 0.045, 0.05] }); // charging handle
  k.add(rod(0.004, 0, 0.035, 6), MAT.steel, { pos: [0.005, 0.045, 0.05], rot: [0, Math.PI / 2, 0] });
  k.add(profile([[0.02, -0.004], [0.05, -0.004], [0.04, -0.035], [0.03, -0.04]], 0.006, 0.001), MAT.steel); // trigger
  k.add(pipe([[0, -0.004, 0.0], [0, -0.045, 0.01], [0, -0.045, 0.05], [0, -0.004, 0.06]], 0.003, 10, 5), MAT.darkSteel); // guard
  swivel(k, -0.3, -0.075); swivel(k, 0.4, -0.012);
  const y = sights(k, 0.095, 0.03, 0.56, 0.05);
  return { muzzle: [0, 0.03, 0.63], sight: y };
}

function smg(k) {
  k.add(profile([[-0.27, -0.06], [-0.27, 0.035], [-0.24, 0.045], [-0.04, 0.038], [0.0, 0.01], [0.01, -0.03], [-0.02, -0.058], [-0.05, -0.02], [-0.24, -0.072]], 0.04, 0.009), MAT.wood);
  k.add(profile([[-0.274, -0.062], [-0.274, 0.037], [-0.265, 0.037], [-0.265, -0.064]], 0.044, 0.003), MAT.rubber);
  k.add(profile(roundRect(-0.04, -0.002, 0.21, 0.064, 0.016), 0.046, 0.007), MAT.steel);
  k.add(rod(0.006, 0.0, 0.03, 6), MAT.steel, { pos: [0.028, 0.04, 0.1], rot: [0, Math.PI / 2, 0] }); // cocking knob
  // ventilated barrel jacket
  k.add(turned([[0, 0.19], [0.025, 0.19], [0.025, 0.4], [0.02, 0.41], [0, 0.41]], 14), MAT.darkSteel, { pos: [0, 0.032, 0] });
  for (let z = 0.22; z < 0.39; z += 0.035) k.add(ring(0.026, 0.004, 14), MAT.steel, { pos: [0, 0.032, z] });
  k.add(rod(0.01, 0.4, 0.45, 8), MAT.darkSteel, { pos: [0, 0.032, 0] });
  // stick magazine and a wooden fore grip
  k.add(profile([[0.08, -0.002], [0.13, -0.002], [0.14, -0.16], [0.095, -0.165]], 0.03, 0.005), MAT.darkSteel);
  k.add(profile([[0.25, 0.0], [0.28, 0.0], [0.295, -0.075], [0.262, -0.08]], 0.032, 0.007), MAT.wood);
  k.add(pipe([[0, -0.002, 0.0], [0, -0.04, 0.01], [0, -0.04, 0.05], [0, -0.002, 0.06]], 0.003, 10, 5), MAT.darkSteel);
  swivel(k, -0.2, -0.07);
  const y = sights(k, 0.088, 0.0, 0.39, 0.06);
  return { muzzle: [0, 0.032, 0.45], sight: y };
}

function mg(k) {
  k.add(profile([[-0.36, -0.06], [-0.36, 0.04], [-0.33, 0.05], [-0.04, 0.045], [0.0, 0.015], [0.012, -0.025], [-0.02, -0.058], [-0.05, -0.02], [-0.32, -0.078]], 0.048, 0.009), MAT.darkWood);
  k.add(profile([[-0.364, -0.062], [-0.364, 0.042], [-0.354, 0.042], [-0.354, -0.064]], 0.052, 0.003), MAT.rubber);
  k.add(profile(roundRect(-0.045, -0.014, 0.26, 0.085, 0.016), 0.062, 0.008), MAT.steel);
  for (let z = -0.02; z < 0.25; z += 0.045) for (const y of [-0.002, 0.072]) k.add(bolt(0.006), MAT.darkSteel, { pos: [0.032, y, z], rot: [0, 0, -Math.PI / 2] });
  // finned cooling jacket
  k.add(turned([[0, 0.24], [0.038, 0.24], [0.038, 0.57], [0.03, 0.59], [0, 0.59]], 16), MAT.darkSteel, { pos: [0, 0.035, 0] });
  for (let z = 0.27; z < 0.56; z += 0.035) k.add(ring(0.04, 0.006, 16), MAT.steel, { pos: [0, 0.035, z] });
  k.add(rod(0.013, 0.57, 0.66, 8), MAT.darkSteel, { pos: [0, 0.035, 0] });
  k.add(turned([[0.013, 0.64], [0.024, 0.68], [0.022, 0.69], [0.011, 0.69]], 10), MAT.darkSteel, { pos: [0, 0.035, 0] });
  // ammo box hanging on the left, belt into the feed
  k.add(block(0.07, 0.11, 0.12, 0.008, 0.004), MAT.iron, { pos: [-0.06, -0.06, 0.12] });
  k.add(pipe([[-0.03, -0.01, 0.12], [-0.025, 0.02, 0.12], [-0.03, 0.04, 0.12]], 0.012, 8, 6), MAT.brass);
  k.add(pipe([[0, 0.085, 0.2], [0, 0.14, 0.24], [0, 0.14, 0.33], [0, 0.07, 0.37]], 0.008, 16, 6), MAT.darkSteel); // carry handle
  for (const s of [-1, 1]) k.add(rod(0.006, 0.37, 0.6, 6), MAT.darkSteel, { pos: [s * 0.022, -0.008, 0] }); // folded bipod
  const y = sights(k, 0.118, 0.02, 0.56, 0.08);
  return { muzzle: [0, 0.035, 0.69], sight: y };
}

function plasma(k) {
  k.add(profile([[-0.3, -0.055], [-0.3, 0.035], [-0.27, 0.045], [-0.18, 0.022], [-0.06, 0.035], [0, 0.012], [0.012, -0.03], [-0.02, -0.058],
    [-0.05, -0.02], [-0.15, 0.0], [-0.27, -0.065]], 0.04, 0.009), MAT.darkSteel);
  k.add(profile(roundRect(-0.04, -0.006, 0.21, 0.066, 0.022), 0.054, 0.008), MAT.steel);
  k.add(turned([[0, 0.12], [0.018, 0.12], [0.018, 0.48], [0, 0.48]], 14), MAT.copper, { pos: [0, 0.03, 0] });
  for (const z of [0.23, 0.29, 0.35, 0.41]) {
    k.add(ring(0.035, 0.009, 18), MAT.glow, { pos: [0, 0.03, z] });
    k.add(ring(0.042, 0.004, 18), MAT.brass, { pos: [0, 0.03, z - 0.02] });
  }
  for (const s of [-1, 1]) k.add(profile(roundRect(0.2, 0.0, 0.45, 0.012, 0.004), 0.006, 0.001), MAT.darkSteel, { pos: [s * 0.045, 0.024, 0] }); // coil rails
  k.add(turned([[0.018, 0.47], [0.032, 0.5], [0.036, 0.53], [0.024, 0.54], [0, 0.54]], 14), MAT.brass, { pos: [0, 0.03, 0] });
  // power cell slung under the receiver
  k.add(turned([[0, -0.02], [0.022, -0.02], [0.022, 0.0], [0, 0.0]], 14), MAT.brass, { pos: [0, -0.04, 0.06] });
  k.add(turned([[0, 0.0], [0.019, 0.0], [0.019, 0.11], [0, 0.11]], 14), MAT.glow, { pos: [0, -0.04, 0.06] });
  k.add(turned([[0, 0.11], [0.022, 0.11], [0.022, 0.13], [0, 0.13]], 14), MAT.brass, { pos: [0, -0.04, 0.06] });
  const y = sights(k, 0.09, 0.03, 0.46, 0.06);
  return { muzzle: [0, 0.03, 0.55], sight: y };
}

function flame(k) {
  k.add(profile([[-0.05, -0.065], [-0.04, 0.02], [0.03, 0.03], [0.04, 0.0], [0.02, -0.07]], 0.038, 0.009), MAT.wood); // grip
  k.add(turned([[0, -0.1], [0.022, -0.1], [0.022, 0.45], [0, 0.45]], 12), MAT.darkSteel, { pos: [0, 0.035, 0] });
  k.add(turned([[0.022, 0.44], [0.032, 0.48], [0.036, 0.54], [0.024, 0.545], [0, 0.545]], 14), MAT.steel, { pos: [0, 0.035, 0] });
  for (const z of [0.1, 0.3]) k.add(ring(0.026, 0.005, 14), MAT.darkSteel, { pos: [0, 0.035, z] });
  // fuel tank slung under the tube, domed ends and two straps
  k.add(turned([[0, -0.2], [0.03, -0.195], [0.05, -0.17], [0.056, -0.13], [0.056, 0.12], [0.05, 0.16], [0.03, 0.185], [0, 0.19]], 18), MAT.brass, { pos: [0, -0.08, 0.08] });
  for (const z of [-0.05, 0.13]) k.add(ring(0.058, 0.006, 18), MAT.darkSteel, { pos: [0, -0.08, z] });
  k.add(pipe([[0, -0.03, 0.22], [0, 0.0, 0.27], [0, 0.03, 0.3]], 0.01, 10, 6), MAT.darkSteel);
  k.add(profile([[0.27, 0.01], [0.3, 0.01], [0.31, -0.065], [0.28, -0.07]], 0.032, 0.006), MAT.wood); // fore grip
  k.add(ring(0.03, 0.005, 14), MAT.iron, { pos: [-0.04, 0.035, 0.15], rot: [0, Math.PI / 2, 0] }); // valve wheel
  k.add(ellipsoidGeo(0.012, 0.012, 0.016, 8, 6), MAT.ember, { pos: [0, 0.0, 0.52] }); // pilot light
  const y = sights(k, 0.08, 0.06, 0.42, 0.055);
  return { muzzle: [0, 0.035, 0.55], sight: y };
}

function launcher(k) {
  k.add(profile([[-0.05, -0.068], [-0.045, 0.02], [0.03, 0.03], [0.045, 0.0], [0.02, -0.072]], 0.04, 0.009), MAT.wood); // grip
  k.add(turned([[0, -0.22], [0.03, -0.22], [0.05, -0.19], [0.05, 0.38], [0.06, 0.42], [0.064, 0.48], [0.052, 0.485], [0.042, 0.45], [0, 0.45]], 20), MAT.steel, { pos: [0, 0.07, 0] });
  for (const z of [-0.14, 0.05, 0.25]) k.add(ring(0.052, 0.008, 20), MAT.darkSteel, { pos: [0, 0.07, z] });
  for (let a = 0; a < 6; a++) k.add(bolt(0.006), MAT.brass, { pos: [Math.cos(a) * 0.052, 0.07 + Math.sin(a) * 0.052, 0.36], rot: [0, 0, 0] });
  k.add(block(0.05, 0.04, 0.16, 0.012, 0.006), MAT.rubber, { pos: [0, 0.05, -0.27] }); // shoulder pad
  // boiler with a pressure gauge
  k.add(turned([[0, -0.16], [0.03, -0.155], [0.042, -0.13], [0.042, 0.1], [0.03, 0.125], [0, 0.13]], 16), MAT.copper, { pos: [0, -0.035, 0.0] });
  k.add(turned([[0, 0], [0.026, 0], [0.026, 0.012], [0, 0.012]], 16), MAT.brass, { pos: [-0.042, -0.035, 0.02], rot: [0, -Math.PI / 2, 0] });
  k.add(turned([[0, 0], [0.02, 0], [0.02, 0.004], [0, 0.004]], 16), MAT.gauge, { pos: [-0.054, -0.035, 0.02], rot: [0, -Math.PI / 2, 0] });
  k.add(pipe([[0.02, -0.01, -0.14], [0.03, 0.03, -0.18], [0.02, 0.06, -0.19]], 0.008, 12, 6), MAT.brass);
  // leaf sight for lobbing
  const y = 0.155;
  k.add(profile(roundRect(0.0, 0.118, 0.03, y - 0.004, 0.004), 0.03, 0.003), MAT.darkSteel);
  for (const s of [-1, 1]) k.add(profile(roundRect(0.005, y - 0.012, 0.025, y + 0.006, 0.002), 0.008, 0.001), MAT.darkSteel, { pos: [s * 0.01, 0, 0] });
  k.add(profile(roundRect(0.4, 0.118, 0.415, y + 0.004, 0.002), 0.005, 0.001), MAT.steel);
  return { muzzle: [0, 0.07, 0.49], sight: y };
}

function grenade(k) {
  k.add(rod(0.011, -0.07, 0.05, 8), MAT.wood);
  k.add(turned([[0, 0.04], [0.026, 0.045], [0.031, 0.06], [0.031, 0.11], [0.026, 0.125], [0, 0.13]], 14), MAT.darkSteel);
  k.add(ring(0.032, 0.005, 14), MAT.brass, { pos: [0, 0, 0.085] });
  return { muzzle: [0, 0, 0.13], sight: 0 };
}

const BUILD = { rifle, smg, mg, plasma, flame, launcher, grenade };
const baked = new Map();

export function weaponParts(id) {
  if (!baked.has(id)) {
    const k = new Kit();
    const { muzzle, sight } = BUILD[id](k);
    const parts = k.bake();
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    baked.set(id, { parts, muzzle, sight, box });
  }
  return baked.get(id);
}

export function weaponModel(id) {
  const b = weaponParts(id);
  const g = instance(b.parts, `weapon-${id}`);
  const m = new THREE.Object3D();
  m.name = 'muzzle';
  m.position.set(...b.muzzle);
  g.add(m);
  g.userData.muzzle = m;
  return g;
}

// Flying shells and bombs (world scale).
const projBaked = new Map();
export function projectileModel(type) {
  if (!projBaked.has(type)) {
    const k = new Kit();
    if (type === 'grenade') grenade(k);
    else if (type === 'shell') {
      k.add(turned([[0, -0.1], [0.04, -0.1], [0.045, -0.06], [0.045, 0.04], [0.03, 0.1], [0, 0.13]], 14), MAT.brass);
      for (let i = 0; i < 4; i++) k.add(profile([[-0.12, 0], [-0.06, 0], [-0.08, 0.06], [-0.12, 0.06]], 0.006, 0.001), MAT.darkSteel, { rot: [0, 0, (i * Math.PI) / 2] });
    } else if (type === 'plasma') {
      k.add(ellipsoidGeo(0.06, 0.06, 0.2, 12, 8), MAT.glow);
    } else if (type === 'cannon') {
      k.add(turned([[0, -0.14], [0.05, -0.14], [0.05, 0.05], [0.03, 0.13], [0, 0.16]], 12), MAT.brass);
    }
    projBaked.set(type, k.bake());
  }
  const g = instance(projBaked.get(type), `proj-${type}`, false);
  if (type === 'grenade') g.scale.setScalar(0.78);
  return g;
}

for (const [id, w] of Object.entries(WEAPONS)) w.id = id;
