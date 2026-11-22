import * as THREE from 'three';
import { MAT, Kit, instance, profile, roundRect, turned, rod, ring, bolt, pipe, ellipsoidGeo } from './models.js';

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
    reload: 3.2, range: 55, pierce: 0.12, tracer: '#ffc070', sound: 'mg', ideal: [10, 30], burst: [6, 12], speed: 0.8,
  },
  plasma: {
    name: 'Coil gun', kind: 'projectile', auto: true, interval: 0.24, damage: 30, splash: 14, radius: 1.3, speed: 32,
    gravity: 0, heat: 0.13, mag: Infinity, range: 40, pierce: 0.7, sound: 'plasma', ideal: [7, 22], burst: [3, 6], proj: 'plasma',
  },
  flame: {
    name: 'Flamer', kind: 'flame', auto: true, interval: 0.05, dps: 75, mag: 100, reserve: 300, reload: 2.4,
    range: 7.5, pierce: 0.25, sound: 'flame', ideal: [1.5, 6], burst: [12, 30], speed: 0.9,
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
function rifle(k) {
  // stock with a pistol-grip wrist, in walnut
  k.add(profile([[-0.4, -0.065], [-0.4, 0.035], [-0.37, 0.045], [-0.1, 0.034], [-0.035, 0.03], [0.0, 0.012], [0.012, -0.02],
    [0.0, -0.05], [-0.03, -0.052], [-0.045, -0.02], [-0.12, -0.025], [-0.37, -0.075]], 0.044, 0.008), MAT.wood);
  k.add(profile([[-0.402, -0.068], [-0.402, 0.038], [-0.392, 0.038], [-0.392, -0.07]], 0.05, 0.004), MAT.darkSteel); // butt plate
  k.add(profile(roundRect(-0.03, 0.0, 0.17, 0.056, 0.012), 0.04, 0.006), MAT.steel); // receiver
  k.add(profile(roundRect(0.15, -0.002, 0.4, 0.038, 0.012), 0.042, 0.007), MAT.wood); // handguard
  k.add(rod(0.011, 0.12, 0.56), MAT.darkSteel, { pos: [0, 0.03, 0] });
  k.add(turned([[0, 0.54], [0.016, 0.54], [0.016, 0.575], [0, 0.575]], 12), MAT.darkSteel, { pos: [0, 0.03, 0] });
  for (const z of [0.22, 0.37]) k.add(ring(0.024, 0.006, 16), MAT.brass, { pos: [0, 0.02, z] });
  // brass scope on two mounts
  k.add(turned([[0, -0.03], [0.021, -0.03], [0.021, -0.005], [0.015, 0.01], [0.015, 0.11], [0.022, 0.13], [0.022, 0.16], [0, 0.16]], 16), MAT.brass, { pos: [0, 0.093, 0] });
  for (const z of [0.0, 0.11]) k.add(profile(roundRect(z - 0.01, 0.05, z + 0.01, 0.085, 0.004), 0.016, 0.002), MAT.darkSteel);
  k.add(ellipsoidGeo(0.012, 0.012, 0.012, 8, 6), MAT.steel, { pos: [0.03, 0.05, 0.04] }); // bolt knob
  k.add(rod(0.004, 0, 0.03, 6), MAT.steel, { pos: [0.0, 0.05, 0.04], rot: [0, Math.PI / 2, 0] });
  return [0, 0.03, 0.58];
}

function smg(k) {
  k.add(profile([[-0.27, -0.06], [-0.27, 0.03], [-0.24, 0.04], [-0.04, 0.035], [0.0, 0.01], [0.01, -0.03], [-0.02, -0.055], [-0.05, -0.02], [-0.24, -0.07]], 0.04, 0.008), MAT.wood);
  k.add(profile(roundRect(-0.04, 0.0, 0.2, 0.062, 0.016), 0.046, 0.007), MAT.steel);
  // ventilated barrel jacket
  k.add(turned([[0, 0.18], [0.024, 0.18], [0.024, 0.39], [0, 0.39]], 14), MAT.darkSteel, { pos: [0, 0.032, 0] });
  for (let z = 0.21; z < 0.38; z += 0.035) k.add(ring(0.025, 0.004, 14), MAT.steel, { pos: [0, 0.032, z] });
  k.add(rod(0.009, 0.38, 0.43, 8), MAT.darkSteel, { pos: [0, 0.032, 0] });
  // drum magazine under the receiver
  k.add(turned([[0, -0.024], [0.058, -0.024], [0.064, -0.016], [0.064, 0.016], [0.058, 0.024], [0, 0.024]], 22), MAT.steel, { pos: [0, -0.045, 0.12], rot: [0, Math.PI / 2, 0] });
  k.add(turned([[0, -0.028], [0.018, -0.028], [0.018, 0.028], [0, 0.028]], 12), MAT.brass, { pos: [0, -0.045, 0.12], rot: [0, Math.PI / 2, 0] });
  k.add(profile([[0.25, 0.0], [0.27, 0.0], [0.285, -0.06], [0.265, -0.065]], 0.03, 0.006), MAT.wood); // front grip
  return [0, 0.032, 0.44];
}

function mg(k) {
  k.add(profile([[-0.36, -0.06], [-0.36, 0.04], [-0.33, 0.05], [-0.04, 0.045], [0.0, 0.015], [0.012, -0.025], [-0.02, -0.055], [-0.05, -0.02], [-0.32, -0.075]], 0.046, 0.008), MAT.darkWood);
  k.add(profile(roundRect(-0.045, -0.012, 0.25, 0.085, 0.016), 0.06, 0.008), MAT.steel);
  for (let z = -0.02; z < 0.24; z += 0.045) for (const y of [0.0, 0.072]) k.add(bolt(0.006), MAT.brass, { pos: [0.031, y, z], rot: [0, 0, -Math.PI / 2] });
  // finned cooling jacket
  k.add(turned([[0, 0.23], [0.036, 0.23], [0.036, 0.56], [0.03, 0.58], [0, 0.58]], 16), MAT.darkSteel, { pos: [0, 0.035, 0] });
  for (let z = 0.26; z < 0.55; z += 0.04) k.add(ring(0.039, 0.007, 16), MAT.steel, { pos: [0, 0.035, z] });
  k.add(rod(0.012, 0.56, 0.64, 8), MAT.darkSteel, { pos: [0, 0.035, 0] });
  k.add(turned([[0.012, 0.62], [0.022, 0.66], [0.02, 0.67], [0.01, 0.67]], 10), MAT.darkSteel, { pos: [0, 0.035, 0] });
  // pan magazine on top, brass carry handle
  k.add(turned([[0, -0.012], [0.07, -0.012], [0.075, 0], [0.07, 0.012], [0, 0.012]], 24), MAT.steel, { pos: [0, 0.1, 0.09], rot: [-Math.PI / 2, 0, 0] });
  k.add(turnedYLid(), MAT.brass, { pos: [0, 0.112, 0.09] });
  k.add(pipe([[0, 0.085, 0.2], [0, 0.14, 0.24], [0, 0.14, 0.33], [0, 0.07, 0.37]], 0.008, 16, 6), MAT.brass);
  // folded bipod
  for (const s of [-1, 1]) k.add(rod(0.006, 0.36, 0.6, 6), MAT.darkSteel, { pos: [s * 0.02, -0.005, 0] });
  return [0, 0.035, 0.67];
}
function turnedYLid() {
  const g = new THREE.CylinderGeometry(0.022, 0.026, 0.01, 14);
  return g;
}

function plasma(k) {
  k.add(profile([[-0.3, -0.055], [-0.3, 0.035], [-0.27, 0.045], [-0.18, 0.02], [-0.06, 0.035], [0, 0.012], [0.012, -0.03], [-0.02, -0.055],
    [-0.05, -0.02], [-0.15, 0.0], [-0.27, -0.065]], 0.038, 0.008), MAT.darkSteel);
  k.add(profile(roundRect(-0.04, -0.005, 0.2, 0.065, 0.022), 0.052, 0.008), MAT.steel);
  k.add(turned([[0, 0.12], [0.017, 0.12], [0.017, 0.47], [0, 0.47]], 14), MAT.copper, { pos: [0, 0.03, 0] });
  for (const z of [0.22, 0.285, 0.35, 0.415]) {
    k.add(ring(0.034, 0.009, 18), MAT.glow, { pos: [0, 0.03, z] });
    k.add(ring(0.04, 0.004, 18), MAT.brass, { pos: [0, 0.03, z - 0.018] });
  }
  k.add(turned([[0.017, 0.46], [0.03, 0.49], [0.034, 0.52], [0.022, 0.53], [0, 0.53]], 14), MAT.brass, { pos: [0, 0.03, 0] });
  // power cell on top: glass tube in brass caps
  k.add(turned([[0, -0.02], [0.022, -0.02], [0.022, 0.0], [0, 0.0]], 14), MAT.brass, { pos: [0, 0.092, 0.01] });
  k.add(turned([[0, 0.0], [0.018, 0.0], [0.018, 0.12], [0, 0.12]], 14), MAT.glow, { pos: [0, 0.092, 0.01] });
  k.add(turned([[0, 0.12], [0.022, 0.12], [0.022, 0.14], [0, 0.14]], 14), MAT.brass, { pos: [0, 0.092, 0.01] });
  return [0, 0.03, 0.54];
}

function flame(k) {
  k.add(profile([[-0.05, -0.06], [-0.04, 0.02], [0.03, 0.03], [0.04, 0.0], [0.02, -0.065]], 0.036, 0.008), MAT.wood); // grip
  k.add(turned([[0, -0.08], [0.02, -0.08], [0.02, 0.44], [0, 0.44]], 12), MAT.darkSteel, { pos: [0, 0.035, 0] });
  k.add(turned([[0.02, 0.43], [0.03, 0.47], [0.034, 0.53], [0.022, 0.535], [0, 0.535]], 14), MAT.steel, { pos: [0, 0.035, 0] });
  for (const z of [0.1, 0.3]) k.add(ring(0.024, 0.005, 14), MAT.brass, { pos: [0, 0.035, z] });
  // fuel tank slung under the tube, domed ends and two straps
  k.add(turned([[0, -0.2], [0.03, -0.195], [0.05, -0.17], [0.054, -0.13], [0.054, 0.12], [0.05, 0.16], [0.03, 0.185], [0, 0.19]], 18), MAT.brass, { pos: [0, -0.075, 0.08] });
  for (const z of [-0.05, 0.13]) k.add(ring(0.056, 0.006, 18), MAT.darkSteel, { pos: [0, -0.075, z] });
  k.add(pipe([[0, -0.03, 0.22], [0, 0.0, 0.27], [0, 0.03, 0.3]], 0.01, 10, 6), MAT.darkSteel);
  // valve wheel and pilot light
  k.add(ring(0.028, 0.005, 14), MAT.iron, { pos: [-0.04, 0.035, 0.15], rot: [0, Math.PI / 2, 0] });
  k.add(ellipsoidGeo(0.012, 0.012, 0.016, 8, 6), MAT.ember, { pos: [0, 0.0, 0.5] });
  return [0, 0.035, 0.54];
}

function launcher(k) {
  k.add(profile([[-0.05, -0.065], [-0.045, 0.02], [0.03, 0.03], [0.045, 0.0], [0.02, -0.07]], 0.04, 0.008), MAT.wood); // grip
  k.add(turned([[0, -0.2], [0.03, -0.2], [0.048, -0.17], [0.048, 0.38], [0.058, 0.42], [0.062, 0.47], [0.05, 0.475], [0.04, 0.44], [0, 0.44]], 20), MAT.steel, { pos: [0, 0.07, 0] });
  for (const z of [-0.12, 0.05, 0.25]) k.add(ring(0.05, 0.008, 20), MAT.brass, { pos: [0, 0.07, z] });
  for (let a = 0; a < 6; a++) k.add(bolt(0.006), MAT.brass, { pos: [Math.cos(a) * 0.05, 0.07 + Math.sin(a) * 0.05, 0.36], rot: [0, 0, 0] });
  // boiler with a pressure gauge
  k.add(turned([[0, -0.16], [0.03, -0.155], [0.04, -0.13], [0.04, 0.1], [0.03, 0.125], [0, 0.13]], 16), MAT.copper, { pos: [0, -0.03, 0.0] });
  k.add(turned([[0, 0], [0.026, 0], [0.026, 0.012], [0, 0.012]], 16), MAT.brass, { pos: [-0.04, -0.03, 0.02], rot: [0, -Math.PI / 2, 0] });
  k.add(turned([[0, 0], [0.02, 0], [0.02, 0.004], [0, 0.004]], 16), MAT.gauge, { pos: [-0.052, -0.03, 0.02], rot: [0, -Math.PI / 2, 0] });
  k.add(pipe([[0.02, -0.01, -0.14], [0.03, 0.03, -0.18], [0.02, 0.06, -0.19]], 0.008, 12, 6), MAT.brass);
  return [0, 0.07, 0.48];
}

function grenade(k) {
  k.add(rod(0.011, -0.07, 0.05, 8), MAT.wood);
  k.add(turned([[0, 0.04], [0.026, 0.045], [0.031, 0.06], [0.031, 0.11], [0.026, 0.125], [0, 0.13]], 14), MAT.darkSteel);
  k.add(ring(0.032, 0.005, 14), MAT.brass, { pos: [0, 0, 0.085] });
  return [0, 0, 0.13];
}

const BUILD = { rifle, smg, mg, plasma, flame, launcher, grenade };
const baked = new Map();

export function weaponParts(id) {
  if (!baked.has(id)) {
    const k = new Kit();
    const muzzle = BUILD[id](k);
    const parts = k.bake();
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    baked.set(id, { parts, muzzle, box });
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
