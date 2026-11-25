import * as THREE from 'three';
import { LOD } from './shapes.js';
import { MAT, Kit, instance, profile, roundRect, turned, rod, ring, bolt, pipe, ellipsoidGeo, block } from './models.js';

// Weapons: WW2 service arms, a little steam, a little future. Models are in hold units
// (scaled by U.WEAPON_SCALE when drawn), grip at the origin, barrel along +z.
// kind: hitscan | projectile | throw
export const WEAPONS = {
  rifle: {
    name: 'Rifle', kind: 'hitscan', auto: false, interval: 0.42, damage: 90, spread: 0.004, mag: 8, reserve: 48,
    reload: 1.7, range: 70, pierce: 0.15, tracer: '#ffdca8', sound: 'rifle', ideal: [14, 34], burst: [1, 1],
  },
  smg: {
    name: 'SMG', kind: 'hitscan', auto: true, interval: 0.075, damage: 30, spread: 0.035, mag: 30, reserve: 150,
    reload: 1.9, range: 32, pierce: 0.05, tracer: '#ffd08a', sound: 'smg', ideal: [4, 14], burst: [4, 9],
  },
  mg: {
    name: 'MG', kind: 'hitscan', auto: true, interval: 0.1, damage: 40, spread: 0.022, mag: 75, reserve: 225,
    reload: 3.2, range: 55, pierce: 0.12, tracer: '#ffc070', sound: 'mg', ideal: [10, 30], burst: [6, 12], move: 0.8,
  },
  plasma: {
    name: 'Coil gun', kind: 'projectile', auto: true, interval: 0.24, damage: 30, splash: 14, radius: 1.3, speed: 32,
    gravity: 0, heat: 0.13, mag: Infinity, range: 40, pierce: 0.7, sound: 'plasma', ideal: [7, 22], burst: [3, 6], proj: 'plasma',
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
// Handling per weapon. rc: recoil kick per shot in radians (up, side), how fast it builds into
// a climbing pattern (build per shot, capped at 1), and how fast the view settles (rec/s).
// sway: breathing and fatigue multiplier. chamber: a tactical reload keeps one round in the breech.
// tac / empty: reload time multipliers for topping up a part-used magazine vs. an empty gun.
const HANDLING = {
  rifle: { rc: { up: 0.024, side: 0.006, build: 0.2, rec: 0.9 }, sway: 1, chamber: true, tac: 0.72, empty: 1.0, rack: 0.4, pattern: [0.4, -0.2, 0.5, -0.3] },
  smg: { rc: { up: 0.0075, side: 0.004, build: 0.07, rec: 1.3 }, sway: 0.75, chamber: true, tac: 0.75, empty: 1.0, rack: 0.3, pattern: [0.5, 1, 0.6, -0.4, -1, -0.5, 0.3, 0.9] },
  mg: { rc: { up: 0.009, side: 0.0055, build: 0.045, rec: 0.7 }, sway: 1.5, chamber: false, tac: 0.9, empty: 1.0, rack: 0.6, pattern: [0.3, 0.8, 1, 0.5, -0.2, -0.7, -1, -0.5] },
  plasma: { rc: { up: 0.007, side: 0.003, build: 0.05, rec: 1.2 }, sway: 0.8, chamber: false, tac: 1, empty: 1, rack: 0, pattern: [0, 0.5, -0.5] },
  launcher: { rc: { up: 0.034, side: 0.008, build: 0.5, rec: 0.7 }, sway: 1.5, chamber: false, tac: 1, empty: 1, rack: 0, pattern: [0.5] },
  grenade: { rc: { up: 0, side: 0, build: 0, rec: 1 }, sway: 1, chamber: false, tac: 1, empty: 1, rack: 0, pattern: [0] },
};
// Ballistics per weapon. mv: muzzle velocity in field units/s, drag: speed lost per second,
// pow: penetration power, fall: [range where damage starts to fade, fraction left at max range],
// tracerEvery: every Nth round glows, hb: barrel heat per shot, zero: sight zeroing range,
// casing/eject/cdelay: spent brass kind, how far back the port sits, bolt-cycle delay.
const BALLISTICS = {
  rifle: { mv: 230, drag: 0.25, pow: 1.0, fall: [30, 0.55], tracerEvery: 3, hb: 0.05, zero: 35, casing: 'rifle', eject: 0.34, cdelay: 0.28, flash: 1.1 },
  smg: { mv: 140, drag: 0.7, pow: 0.35, fall: [8, 0.35], tracerEvery: 4, hb: 0.022, zero: 15, casing: 'pistol', eject: 0.24, cdelay: 0, flash: 0.75 },
  mg: { mv: 215, drag: 0.3, pow: 0.9, fall: [25, 0.5], tracerEvery: 2, hb: 0.013, zero: 30, casing: 'rifle', eject: 0.4, cdelay: 0, flash: 1.3 },
};
for (const [id, b] of Object.entries(BALLISTICS)) Object.assign(WEAPONS[id], b);
for (const [id, h] of Object.entries(HANDLING)) Object.assign(WEAPONS[id], h);

export const SLOTS = ['rifle', 'smg', 'mg', 'plasma', 'launcher', 'grenade'];

// ---------------- moving parts ----------------
// Magazines, bolts and shells are baked as their own meshes (Kit.slot) so they can move with the
// reload and the shot. weaponSlotMatrix writes the offset of one slot in hold units; `reload` is
// the progress of the reload (-1 when not reloading), `rack` how far the charging handle is pulled
// (an empty gun) and `recoil` the kick of the last shot.
const MAG_DIR = { rifle: [0.0, -1, 0.12, 0.13], smg: [0.0, -1, 0.1, 0.17], mg: [0.1, -1, 0.0, 0.15], plasma: [0, -1, 0.1, 0.11] };
const BOLT_BACK = { rifle: 0.075, smg: 0.055, mg: 0.05 };
const smoothS = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _hid = new THREE.Matrix4().makeScale(0, 0, 0);
export function weaponSlotMatrix(id, slot, reload, rack, recoil, out) {
  if (slot === 'mag' && id === 'launcher') {
    // shell: appears above the muzzle and slides in
    if (reload < 0.3 || reload > 0.8) return out.copy(_hid);
    const q = smoothS(0.3, 0.7, reload);
    return out.makeTranslation(0, 0.15 * (1 - q), -0.1 * (1 - q));
  }
  if (slot === 'mag') {
    const d = MAG_DIR[id];
    if (!d || reload < 0) return out.identity();
    if (reload > 0.3 && reload < 0.52) return out.copy(_hid); // in the hand / swapped
    const pull = reload <= 0.3 ? smoothS(0.08, 0.3, reload) : 1 - smoothS(0.52, 0.8, reload);
    return out.makeTranslation(d[0] * d[3] * pull, d[1] * d[3] * pull, d[2] * d[3] * pull);
  }
  if (slot === 'bolt') {
    const b = BOLT_BACK[id] || 0;
    return out.makeTranslation(0, 0, -b * Math.min(1, Math.max(rack, recoil * 0.9)));
  }
  return out.identity();
}

// ---------------- models ----------------
// Iron sights on top of every long gun: a notched rear block and a hooded front post, both on
// one line at height y so aiming down the sights lines that line up with the eye.
function sights(k, y, zr, zf, base = 0, fbase = base) {
  k.add(profile(roundRect(zr - 0.018, base, zr + 0.018, y - 0.006, 0.004), 0.026, 0.003), MAT.darkSteel); // rear block (narrower than any cover under it)
  for (const s of [-1, 1]) k.add(profile(roundRect(zr - 0.01, y - 0.008, zr + 0.01, y + 0.006, 0.002), 0.006, 0.001), MAT.darkSteel, { pos: [s * 0.008, 0, 0] });
  k.add(profile(roundRect(zf - 0.012, fbase, zf + 0.012, y - 0.012, 0.004), 0.02, 0.003), MAT.darkSteel); // front base
  k.add(profile(roundRect(zf - 0.004, fbase + 0.004, zf + 0.004, y + 0.004, 0.0015), 0.004, 0.001), MAT.steel); // post
  for (const s of [-1, 1]) k.add(profile(roundRect(zf - 0.008, y - 0.014, zf + 0.008, y + 0.01, 0.003), 0.004, 0.001), MAT.darkSteel, { pos: [s * 0.012, 0, 0] }); // hood ears
  return y;
}
function swivel(k, z, y) { k.add(ring(0.011, 0.0025, 10), MAT.darkSteel, { pos: [0, y, z], rot: [0, Math.PI / 2, 0] }); }

// small helpers: a turned collar and a slotted muzzle device
function collar(k, r, z0, z1, y, mat = MAT.brass, x = 0) {
  k.add(turned([[r * 0.8, z0], [r, z0 + 0.004], [r, z1 - 0.004], [r * 0.8, z1]], 14), mat, { pos: [x, y, 0] });
}
function slotted(k, r, z0, z1, y, mat = MAT.darkSteel) {
  k.add(turned([[0, z0], [r, z0], [r, z1], [r * 0.7, z1], [0, z1]], 12), mat, { pos: [0, y, 0] });
  for (let i = 0; i < 3; i++) k.add(profile(roundRect(z0 + 0.012 + i * 0.012, -r * 1.1, z0 + 0.018 + i * 0.012, r * 1.1, 0.001), r * 2.1, 0.0005), MAT.rubber, { pos: [0, y, 0] });
}
// a curved box magazine (profile in z,y; thin across x)
function curvedMag(k, z, y, len, w, curve, mat = MAT.darkSteel) {
  k.add(profile([[z, y], [z + w, y], [z + w + curve * 0.6, y - len * 0.5], [z + w + curve, y - len], [z + curve, y - len - 0.004], [z + curve * 0.3, y - len * 0.5]], 0.032, 0.004), mat);
  k.add(profile(roundRect(z + curve - 0.004, y - len - 0.012, z + w + curve + 0.004, y - len + 0.004, 0.003), 0.036, 0.003), MAT.brass); // floor plate
}

function rifle(k) {
  // walnut stock: long cheek rise, pistol-grip wrist, brass butt plate
  k.add(profile([[-0.42, -0.075], [-0.42, 0.045], [-0.385, 0.058], [-0.24, 0.056], [-0.12, 0.04], [-0.04, 0.032], [0.0, 0.012], [0.014, -0.022],
    [0.002, -0.058], [-0.032, -0.062], [-0.048, -0.022], [-0.13, -0.03], [-0.25, -0.036], [-0.38, -0.086]], 0.046, 0.01), MAT.wood);
  k.add(profile([[-0.426, -0.082], [-0.426, 0.046], [-0.412, 0.05], [-0.412, -0.086]], 0.052, 0.004), MAT.brass, { pos: [0, 0, -0.004] }); // butt plate, a hair wider and further back than the wood
  for (const z of [-0.3, -0.2]) k.add(ring(0.004, 0.0015, 6), MAT.darkSteel, { pos: [0.024, 0.02, z] }); // stock screws
  // receiver: steel with a brass band at the breech and a stepped top cover
  k.add(profile(roundRect(-0.04, -0.006, 0.2, 0.06, 0.014), 0.052, 0.006), MAT.steel);
  k.add(profile(roundRect(-0.01, 0.056, 0.16, 0.068, 0.005), 0.032, 0.003), MAT.darkSteel);
  k.add(turned([[0.026, 0.18], [0.03, 0.185], [0.03, 0.205], [0.026, 0.21]], 12), MAT.brass, { pos: [0, 0.03, 0] });
  // five-round clip magazine, curved, with a brass floor plate
  k.slot('mag', () => curvedMag(k, 0.05, -0.004, 0.085, 0.06, 0.012));
  // handguard in two wooden halves with a brass nose cap; gas tube riding on top
  k.add(profile(roundRect(0.2, -0.014, 0.42, 0.04, 0.016), 0.046, 0.008), MAT.wood);
  k.add(profile(roundRect(0.2, 0.034, 0.42, 0.05, 0.006), 0.03, 0.003), MAT.darkWood);
  k.add(turned([[0.019, 0.415], [0.024, 0.42], [0.024, 0.45], [0.012, 0.455]], 12), MAT.brass, { pos: [0, 0.027, 0] }); // nose cap
  k.add(turned([[0, 0.2], [0.014, 0.2], [0.011, 0.58], [0, 0.58]], 12), MAT.darkSteel, { pos: [0, 0.03, 0] }); // barrel, tapered
  k.add(rod(0.0095, 0.22, 0.46, 8), MAT.steel, { pos: [0, 0.056, 0] }); // gas cylinder
  collar(k, 0.014, 0.4, 0.43, 0.056);
  slotted(k, 0.02, 0.58, 0.64, 0.03); // flash hider
  k.add(rod(0.004, 0.2, 0.52, 6), MAT.steel, { pos: [0, -0.014, 0] }); // cleaning rod
  k.add(profile([[0.55, 0.0], [0.575, 0.0], [0.58, -0.02], [0.552, -0.02]], 0.01, 0.002), MAT.darkSteel, { pos: [0, 0.015, 0] }); // bayonet lug
  // bolt handle (right side) with a brass knob, and a safety lever
  k.slot('bolt', () => {
    k.add(rod(0.004, 0.0, 0.066, 6), MAT.steel, { pos: [-0.02, 0.045, 0.07], rot: [0, -Math.PI / 2, 0] });
    k.add(ellipsoidGeo(0.014, 0.014, 0.014, 8, 6), MAT.brass, { pos: [-0.086, 0.045, 0.07] });
  });
  k.add(profile([[0.02, -0.004], [0.052, -0.004], [0.042, -0.036], [0.032, -0.04]], 0.006, 0.001), MAT.brass); // trigger
  k.add(pipe([[0, -0.004, -0.01], [0, -0.048, 0.0], [0, -0.048, 0.055], [0, -0.004, 0.066]], 0.0032, 10, 5), MAT.brass); // guard
  swivel(k, -0.32, -0.082); swivel(k, 0.42, -0.014);
  const y = sights(k, 0.098, 0.03, 0.58, 0.056);
  return { muzzle: [0, 0.03, 0.64], sight: y };
}

function smg(k) {
  // short wooden stock, tubular receiver with a perforated shroud, brass drum magazine
  k.add(profile([[-0.27, -0.065], [-0.27, 0.036], [-0.24, 0.048], [-0.04, 0.04], [0.0, 0.012], [0.012, -0.03], [-0.02, -0.058], [-0.05, -0.02], [-0.24, -0.075]], 0.04, 0.009), MAT.wood);
  k.add(profile([[-0.276, -0.067], [-0.276, 0.038], [-0.264, 0.038], [-0.264, -0.069]], 0.046, 0.003), MAT.brass, { pos: [0, 0, -0.005] });
  k.add(profile(roundRect(-0.04, -0.004, 0.19, 0.066, 0.016), 0.046, 0.007), MAT.steel);
  k.add(profile(roundRect(0.0, 0.062, 0.17, 0.072, 0.004), 0.034, 0.003), MAT.darkSteel); // dust cover
  k.slot('bolt', () => {
    k.add(rod(0.006, 0.0, 0.034, 6), MAT.brass, { pos: [0.018, 0.045, 0.12], rot: [0, Math.PI / 2, 0] }); // cocking knob
  });
  // perforated barrel shroud: a tube with a row of dark vent slots and brass end rings
  k.add(turned([[0, 0.19], [0.027, 0.19], [0.027, 0.42], [0.021, 0.43], [0, 0.43]], 14), MAT.steel, { pos: [0, 0.034, 0] });
  for (let z = 0.21; z < 0.4; z += 0.03) for (const a of [-0.9, -0.3, 0.3, 0.9]) k.add(ellipsoidGeo(0.008, 0.004, 0.006, 6, 4), MAT.rubber, { pos: [Math.sin(a) * 0.027, 0.034 + Math.cos(a) * 0.027, z] });
  collar(k, 0.03, 0.185, 0.2, 0.034); collar(k, 0.03, 0.41, 0.425, 0.034);
  slotted(k, 0.014, 0.43, 0.49, 0.034);
  // 50-round drum under the receiver
  k.slot('mag', () => {
    k.add(turned([[0, -0.03], [0.07, -0.03], [0.075, -0.024], [0.075, 0.024], [0.07, 0.03], [0, 0.03]], 20), MAT.brass, { pos: [0, -0.095, 0.1], rot: [0, 0, Math.PI / 2] });
    k.add(turned([[0, 0.03], [0.045, 0.03], [0.045, 0.034], [0, 0.034]], 16), MAT.darkSteel, { pos: [0, -0.095, 0.1], rot: [0, 0, Math.PI / 2] });
    k.add(profile(roundRect(0.075, -0.026, 0.125, -0.004, 0.004), 0.034, 0.003), MAT.darkSteel); // drum neck
  });
  // wooden fore grip and a trigger
  k.add(profile([[0.255, 0.0], [0.292, 0.0], [0.306, -0.082], [0.265, -0.088]], 0.034, 0.008), MAT.wood);
  k.add(profile([[0.02, -0.004], [0.05, -0.004], [0.04, -0.03], [0.03, -0.034]], 0.006, 0.001), MAT.brass);
  k.add(pipe([[0, -0.004, -0.01], [0, -0.042, 0.0], [0, -0.042, 0.05], [0, -0.004, 0.06]], 0.003, 10, 5), MAT.darkSteel);
  swivel(k, -0.2, -0.07);
  const y = sights(k, 0.094, 0.0, 0.4, 0.07, 0.05);
  return { muzzle: [0, 0.034, 0.49], sight: y };
}

function mg(k) {
  // heavy walnut stock, boxy receiver with a belt feed tray, fat finned jacket, deployed bipod
  k.add(profile([[-0.38, -0.062], [-0.38, 0.044], [-0.35, 0.054], [-0.04, 0.048], [0.0, 0.015], [0.012, -0.025], [-0.02, -0.058], [-0.05, -0.02], [-0.34, -0.082]], 0.05, 0.01), MAT.darkWood);
  k.add(profile([[-0.386, -0.064], [-0.386, 0.046], [-0.374, 0.046], [-0.374, -0.066]], 0.056, 0.003), MAT.brass, { pos: [0, 0, -0.005] });
  k.add(profile(roundRect(-0.05, -0.016, 0.27, 0.088, 0.018), 0.064, 0.008), MAT.steel);
  k.add(profile(roundRect(-0.02, 0.082, 0.22, 0.096, 0.006), 0.05, 0.004), MAT.darkSteel); // hinged feed cover
  for (const z of [0.0, 0.1, 0.2]) k.add(ring(0.006, 0.0025, 8), MAT.brass, { pos: [0, 0.098, z], rot: [Math.PI / 2, 0, 0] });
  for (let z = -0.02; z < 0.26; z += 0.045) for (const y of [-0.002, 0.07]) k.add(bolt(0.006), MAT.brass, { pos: [0.033, y, z], rot: [0, 0, -Math.PI / 2] });
  // feed tray on the left, ammo box and a visible brass belt
  k.add(profile(roundRect(0.02, 0.05, 0.2, 0.06, 0.004), 0.05, 0.003), MAT.darkSteel, { pos: [0.05, 0, 0] });
  k.slot('mag', () => {
    k.add(block(0.075, 0.12, 0.13, 0.008, 0.004), MAT.iron, { pos: [0.085, -0.07, 0.12] });
    k.add(pipe([[0.085, -0.01, 0.12], [0.075, 0.03, 0.12], [0.04, 0.058, 0.12]], 0.013, 10, 6), MAT.brass); // ammo belt into the feed tray
  });
  k.slot('bolt', () => k.add(rod(0.007, 0.0, 0.05, 6), MAT.brass, { pos: [-0.034, 0.05, 0.14], rot: [0, -Math.PI / 2, 0] })); // charging handle
  // finned cooling jacket with steam vents and a brass front collar
  k.add(turned([[0, 0.25], [0.04, 0.25], [0.04, 0.58], [0.032, 0.6], [0, 0.6]], 18), MAT.darkSteel, { pos: [0, 0.035, 0] });
  for (let z = 0.28; z < 0.57; z += 0.032) k.add(ring(0.042, 0.006, 18), MAT.steel, { pos: [0, 0.035, z] });
  for (let i = 0; i < 5; i++) k.add(ellipsoidGeo(0.01, 0.006, 0.014, 6, 4), MAT.rubber, { pos: [0, 0.035 + 0.039, 0.3 + i * 0.055] });
  collar(k, 0.044, 0.245, 0.27, 0.035);
  k.add(rod(0.013, 0.58, 0.68, 8), MAT.darkSteel, { pos: [0, 0.035, 0] });
  slotted(k, 0.026, 0.66, 0.72, 0.035);
  // low carry handle under the jacket (never crosses the sights) and the bipod
  k.add(pipe([[0, 0.0, 0.34], [0, -0.075, 0.38], [0, -0.075, 0.5], [0, 0.0, 0.54]], 0.009, 16, 6), MAT.leather);
  k.add(block(0.08, 0.026, 0.04, 0.008, 0.004), MAT.darkSteel, { pos: [0, 0.0, 0.56] }); // bipod yoke clamped under the jacket
  for (const s of [-1, 1]) {
    k.add(rod(0.006, 0, 0.2, 6), MAT.steel, { pos: [s * 0.03, -0.01, 0.56], rot: [1.1, s * 0.2, 0] });
    k.add(ellipsoidGeo(0.014, 0.006, 0.02, 6, 4), MAT.darkSteel, { pos: [s * 0.07, -0.186, 0.65] });
  }
  collar(k, 0.045, 0.55, 0.57, 0.035, MAT.brass);
  k.add(profile([[0.0, -0.004], [0.032, -0.004], [0.022, -0.036], [0.012, -0.04]], 0.006, 0.001), MAT.brass);
  const y = sights(k, 0.118, 0.02, 0.62, 0.09, 0.044);
  return { muzzle: [0, 0.035, 0.72], sight: y };
}

function plasma(k) {
  // moulded dark stock, steel receiver with glowing capacitor windows, a long copper coil barrel
  k.add(profile([[-0.32, -0.058], [-0.32, 0.04], [-0.28, 0.054], [-0.18, 0.026], [-0.06, 0.038], [0, 0.012], [0.012, -0.03], [-0.02, -0.058],
    [-0.05, -0.02], [-0.15, 0.0], [-0.28, -0.07]], 0.044, 0.01), MAT.darkSteel);
  k.add(profile(roundRect(-0.3, -0.04, -0.24, 0.0, 0.006), 0.048, 0.004), MAT.glow, { pos: [0, 0, 0.0] }); // stock charge indicator
  k.add(profile(roundRect(-0.045, -0.008, 0.21, 0.07, 0.024), 0.058, 0.009), MAT.steel);
  for (const s of [-1, 1]) {
    k.add(profile(roundRect(-0.0, 0.01, 0.12, 0.05, 0.012), 0.004, 0.001), MAT.glow, { pos: [s * 0.031, 0, 0] }); // capacitor windows
    k.add(turned([[0.012, 0.0], [0.016, 0.004], [0.016, 0.07], [0.012, 0.074]], 10), MAT.brass, { pos: [s * 0.045, 0.062, 0.02] }); // brass capacitors
  }
  k.add(turned([[0, 0.12], [0.02, 0.12], [0.02, 0.5], [0, 0.5]], 14), MAT.copper, { pos: [0, 0.03, 0] });
  for (let i = 0; i < 5; i++) {
    const z = 0.22 + i * 0.065, r = 0.036 - i * 0.002;
    k.add(ring(r, 0.009, 18), MAT.glow, { pos: [0, 0.03, z] });
    k.add(turned([[0.018, -0.004], [r + 0.01, -0.004], [r + 0.01, 0.004], [0.018, 0.004]], 18), MAT.brass, { pos: [0, 0.03, z - 0.022] }); // brass spacer disc on the barrel
  }
  for (const s of [-1, 1]) k.add(profile(roundRect(0.2, 0.0, 0.5, 0.014, 0.005), 0.007, 0.001), MAT.darkSteel, { pos: [s * 0.05, 0.026, 0] }); // coil rails
  k.add(turned([[0.02, 0.49], [0.034, 0.52], [0.044, 0.56], [0.048, 0.585], [0.03, 0.585], [0, 0.585]], 16), MAT.brass, { pos: [0, 0.03, 0] }); // flared emitter
  k.add(ring(0.032, 0.004, 14), MAT.glow, { pos: [0, 0.03, 0.57] });
  // power cell slung under the receiver, with a pressure gauge
  k.slot('mag', () => {
    k.add(turned([[0, -0.02], [0.024, -0.02], [0.024, 0.0], [0, 0.0]], 14), MAT.brass, { pos: [0, -0.034, 0.06] });
    k.add(turned([[0, 0.0], [0.02, 0.0], [0.02, 0.12], [0, 0.12]], 14), MAT.glow, { pos: [0, -0.034, 0.06] });
    k.add(turned([[0, 0.12], [0.024, 0.12], [0.024, 0.14], [0, 0.14]], 14), MAT.brass, { pos: [0, -0.034, 0.06] });
  }, MAT.glow);
  k.add(turned([[0, 0], [0.016, 0], [0.016, 0.004], [0, 0.004]], 14), MAT.gauge, { pos: [-0.03, 0.03, 0.17], rot: [0, -Math.PI / 2, 0] });
  const y = sights(k, 0.092, 0.03, 0.5, 0.07, 0.044);
  return { muzzle: [0, 0.03, 0.585], sight: y };
}

function launcher(k) {
  // squat bell-mouth mortar tube, big copper boiler with gauge and relief valve, shoulder pad, folded legs
  k.add(profile([[-0.05, -0.068], [-0.045, 0.02], [0.03, 0.03], [0.045, 0.0], [0.02, -0.072]], 0.04, 0.009), MAT.wood); // grip
  k.add(turned([[0, -0.22], [0.034, -0.22], [0.054, -0.19], [0.054, 0.34], [0.062, 0.4], [0.078, 0.46], [0.082, 0.5], [0.066, 0.505], [0.052, 0.47], [0, 0.45]], 22), MAT.steel, { pos: [0, 0.075, 0] });
  for (const z of [-0.14, 0.05, 0.22, 0.34]) collar(k, 0.058, z, z + 0.02, 0.075, MAT.darkSteel);
  collar(k, 0.088, 0.462, 0.482, 0.075, MAT.brass);
  for (let a = 0; a < 8; a++) k.add(bolt(0.006), MAT.brass, { pos: [Math.cos(a * 0.785) * 0.056, 0.075 + Math.sin(a * 0.785) * 0.056, 0.3], rot: [0, 0, 0] });
  k.add(block(0.06, 0.05, 0.16, 0.012, 0.006), MAT.rubber, { pos: [0, 0.055, -0.27] }); // shoulder pad
  // boiler: copper drum, brass bands, gauge, relief valve and steam pipe up to the breech
  k.add(turned([[0, -0.17], [0.03, -0.165], [0.046, -0.14], [0.046, 0.12], [0.034, 0.145], [0, 0.15]], 18), MAT.copper, { pos: [0, -0.04, 0.0] });
  for (const z of [-0.1, 0.0, 0.08]) k.add(ring(0.048, 0.005, 18), MAT.brass, { pos: [0, -0.04, z] });
  k.add(turned([[0, 0], [0.03, 0], [0.03, 0.012], [0, 0.012]], 18), MAT.brass, { pos: [-0.046, -0.04, 0.02], rot: [0, -Math.PI / 2, 0] });
  k.add(turned([[0, 0], [0.023, 0], [0.023, 0.004], [0, 0.004]], 18), MAT.gauge, { pos: [-0.059, -0.04, 0.02], rot: [0, -Math.PI / 2, 0] });
  k.add(rod(0.012, 0, 0.05, 8), MAT.brass, { pos: [0.0, 0.006, 0.06], rot: [-Math.PI / 2, 0, 0] }); // relief valve
  k.add(pipe([[0.02, -0.01, -0.14], [0.03, 0.03, -0.18], [0.02, 0.07, -0.19], [0.0, 0.085, -0.15]], 0.008, 12, 6), MAT.brass);
  k.add(pipe([[0.03, 0.0, 0.12], [0.056, 0.03, 0.14], [0.056, 0.07, 0.15]], 0.007, 10, 6), MAT.brass);
  // folded legs along the sides of the tube
  for (const s of [-1, 1]) k.add(rod(0.006, 0.12, 0.5, 6), MAT.darkSteel, { pos: [s * 0.062, 0.03, 0] });
  // the shell: a brass round that drops into the muzzle during a reload (only drawn then)
  k.slot('mag', () => {
    k.add(turned([[0, 0.43], [0.04, 0.43], [0.046, 0.45], [0.046, 0.54], [0.03, 0.6], [0, 0.63]], 14), MAT.brass, { pos: [0, 0.075, 0] });
    k.add(ring(0.047, 0.004, 14), MAT.darkSteel, { pos: [0, 0.075, 0.5] });
  });
  // leaf sight for lobbing
  const y = 0.162;
  k.add(profile(roundRect(0.0, 0.126, 0.03, y - 0.004, 0.004), 0.03, 0.003), MAT.darkSteel);
  for (const s of [-1, 1]) k.add(profile(roundRect(0.005, y - 0.012, 0.025, y + 0.006, 0.002), 0.006, 0.001), MAT.darkSteel, { pos: [s * 0.008, 0, 0] });
  k.add(profile(roundRect(0.4, 0.126, 0.415, y + 0.004, 0.002), 0.005, 0.001), MAT.steel);
  return { muzzle: [0, 0.075, 0.5], sight: y };
}

function grenade(k) {
  // segmented iron body, brass cap with a spring lever and a pull ring
  k.add(rod(0.011, -0.07, 0.05, 8), MAT.wood);
  k.add(turned([[0, 0.035], [0.026, 0.04], [0.033, 0.06], [0.033, 0.115], [0.026, 0.13], [0, 0.135]], 14), MAT.darkSteel);
  for (let i = 0; i < 3; i++) k.add(ring(0.034, 0.003, 14), MAT.iron, { pos: [0, 0, 0.068 + i * 0.022] });
  k.add(ring(0.034, 0.003, 14), MAT.iron, { pos: [0, 0, 0.072], rot: [0, Math.PI / 2, 0] });
  k.add(turned([[0.014, 0.13], [0.02, 0.133], [0.02, 0.15], [0, 0.152]], 10), MAT.brass); // fuze cap
  k.add(profile(roundRect(0.0, 0.026, 0.13, 0.034, 0.003), 0.012, 0.001), MAT.steel, { pos: [0, 0, 0] }); // spoon lever
  k.add(ring(0.012, 0.0022, 8), MAT.brass, { pos: [0.02, 0.03, 0.14], rot: [0, Math.PI / 2, 0] }); // pull ring
  return { muzzle: [0, 0, 0.15], sight: 0 };
}

const BUILD = { rifle, smg, mg, plasma, launcher, grenade };
const baked = new Map();

// lite: a thinned copy for distant soldiers (same builders at lower quality; see lod.js)
export function weaponParts(id, lite = false) {
  const key = lite ? id + ':lite' : id;
  if (!baked.has(key)) {
    const k = new Kit();
    LOD.q = lite ? 0.3 : 1;
    let r;
    try { r = BUILD[id](k); } finally { LOD.q = 1; }
    const { muzzle, sight } = r;
    // a distant gun does not work its magazine or bolt: the moving parts fold back into the one mesh
    const parts = k.bake().map((q) => (lite ? { ...q, slot: undefined } : q));
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    baked.set(key, { parts, muzzle, sight, box });
  }
  return baked.get(key);
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

// A weapon in a soldier's hands: the loaded magazine plus spare magazines in the pouch.
// `reserve` is the total rounds in the pouch; setting it (resupply, respawn) refills whole magazines.
export function makeWeapon(id) {
  const def = WEAPONS[id];
  const finite = Number.isFinite(def.reserve ?? Infinity) && def.reserve !== undefined;
  const w = {
    id, def, mag: def.mag, heat: 0, locked: 0, spare: [], inf: !finite,
    get reserve() { return this.inf ? Infinity : this.spare.reduce((a, b) => a + b, 0); },
    set reserve(n) {
      this.spare.length = 0;
      if (!Number.isFinite(n)) { this.inf = true; return; }
      this.inf = false;
      let left = n;
      while (left > 0) { const m = Math.min(def.mag, left); this.spare.push(m); left -= m; }
    },
  };
  if (finite) w.reserve = def.reserve;
  return w;
}
