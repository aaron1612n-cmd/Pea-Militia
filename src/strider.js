import * as THREE from 'three';
import { profile, turned, turnedY, rod, ring, pipe } from './models.js';
import { TEAMS } from './factions.js';
import { height } from './terrain.js';
import { VEHICLES, CKit, C, P, BODY, clamp, bakeKits, buildLods, makeSkeleton, skinnedBody, slab, blk, cyl, cone, arch, hoseCurve } from './vkit.js';

// The strider: a two-legged steam walker, built the way it would have to be to stand. A pelvis cradle on a hip
// axle that runs out through both leg hubs, an armoured tub on the cradle with the boilers on a shelf behind,
// and a rotating head on a ring on the roof. The head is the cockpit (canopy glass in front, the pilot's eye
// behind it) and carries the weapons on bolted-on hardpoints, one at each cheek: an autocannon in a ball mount
// on the right, a steam mortar on a trunnion yoke on the left. Each leg is a clevis frame: two plates on the hip
// hub, the shin between them on a knee pin, a ram behind the knee, and an ankle pin through the foot's cheek
// plates. Every part sits on, or pins into, the part that carries it. Round 3 adds appliqué armour with bolt
// rows and weld seams, shoulder guards over the hips, accumulators and feed lines, hoses that bend over the
// hip and knee (skinned between the two joints), mud and chipped paint, and damage overlays (peeled plates,
// scorching, a torn engine cover) that show up as it is hurt.
VEHICLES.walker = {
  name: 'Strider', drive: 'legged', seats: 1,
  hx: 1.5, hz: 1.5, h: 2.9, lift: 2.7, eyeH: 5.15, // hit box starts above the legs
  hp: 700, armor: { bullet: 0.07, blast: 0.55, plasma: 0.6, flame: 0.15 },
  maxSpeed: 6.2, maxRev: 2.6, accel: 2.8, brake: 7, turn: 1.0, maxSlope: 0.95, tilt: 0.3,
  mass: 40, camDist: 12, camHeight: 5.2, camUp: 7.8, camSide: 1.6, cockpit: [0, 5.15, 0.35], cockpitKind: 'walker', steamAt: [-0.6, 5.7, -1.1], step: 1.3, crush: true, crushH: 2.2, runover: 0,
  engine: 'steam', leaks: [[0.55, 4.8, -1.1], [-0.3, 5.9, 0.2]],
  hint: 'WASD walk · click shoots · right-click mortar · X leaves',
  turret: { rate: 1.5, pitchRate: 1.2, pitchMin: -0.45, pitchMax: 0.5, pivot: [0, 4.55, 0] },
  weapons: [
    { id: 'autocannon', name: 'Autocannon', ai: 'light', kind: 'hitscan', damage: 30, interval: 0.12, spread: 0.022, sound: 'mg', mag: Infinity, reserve: Infinity, range: 110, tracer: '#ffc070', burst: [8, 14], vehicleGun: true },
    { id: 'mortar', name: 'Steam mortar', ai: 'heavy', kind: 'projectile', proj: 'shell', lob: 1.05, damage: 170, radius: 5.2, speed: 40, gravity: 16, interval: 3.4, spread: 0.02, sound: 'cannon', mag: Infinity, reserve: Infinity, range: 150, minRange: 22, burst: [1, 1], vehicleGun: true },
  ],
};

const WL = { hip: 3.15, x: 1.2, L1: 1.75, L2: 1.85, ankle: 0.36 };
export const STRIDER = WL;
// the thigh's edges in (z, y) at depth d below the hip (the frame tapers toward the knee)
const thighFront = (d) => 0.4 - 0.1 * (d / WL.L1), thighRear = (d) => -0.36 + 0.12 * (d / WL.L1);
const shinRear = (d) => -0.24 + 0.08 * (d / WL.L2), shinFront = (d) => 0.26 - 0.1 * (d / WL.L2);
const THIGH_LUG = [0, -0.55, thighRear(0.55) - 0.09 - 0.004], SHIN_LUG = [0, -0.95, shinRear(0.95) - 0.12];
const GUN_AT = [0.92, 0.45, 0.84], MORTAR_AT = [-0.92, 0.8, -0.15], MORTAR_TILT = -1.05;
const HEAD_Y = 4.55;

// ---- the skeleton. The bind pose hangs the legs straight down from the hips (so the hoses that cross a joint
// are authored in one consistent space); the walk poses override every bone every frame.
const BONES = [{ name: 'hull', parent: -1, anchor: [0, WL.hip, 0] }, { name: 'turret', parent: -1, anchor: [0, HEAD_Y, 0] }];
const LEG0 = [2, 8]; // first bone of the left (side -1) and right legs: thigh, shin, foot, toe, ram tube, ram rod
for (const side of [-1, 1]) {
  const x = side * WL.x, b = BONES.length;
  BONES.push({ name: 'thigh', parent: -1, anchor: [x, WL.hip, 0] });
  BONES.push({ name: 'shin', parent: -1, anchor: [x, WL.hip - WL.L1, 0] });
  BONES.push({ name: 'foot', parent: -1, anchor: [x, WL.hip - WL.L1 - WL.L2 - WL.ankle, 0] });
  BONES.push({ name: 'toe', parent: b + 2, anchor: [x, WL.hip - WL.L1 - WL.L2 - WL.ankle, 0.58] });
  BONES.push({ name: 'ramTube', parent: -1, anchor: [x, WL.hip + THIGH_LUG[1], THIGH_LUG[2]] });
  BONES.push({ name: 'ramRod', parent: -1, anchor: [x, WL.hip - WL.L1 + SHIN_LUG[1], SHIN_LUG[2]] });
}
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function striderParts(team) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = P(T.body), trim = P(T.trim);
  const hull = new CKit('hull', 0, BONES[0].anchor), turret = new CKit('head', 1, BONES[1].anchor), gunK = new CKit('gun'), glow = [];
  const dome = (kit, r, pos, rot, col = C.steel) => kit.add(new THREE.SphereGeometry(r, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2), col, { pos, rot, minor: true });
  const row = (kit, a, b, n, rot, r = 0.028, col = C.steel) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); dome(kit, r, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], rot, col); } };
  // ---- pelvis: a cradle on the hip axle, a flange round the axle on each side
  hull.add(blk(2.0, 0.6, 1.3, 0.1, 0.04), C.steel);
  hull.add(cyl(0.22, 2.3, 16), C.iron, { rot: [0, 0, Math.PI / 2] }); // the hip axle: out through both leg hubs
  for (const s of [-1, 1]) {
    hull.add(cyl(0.4, 0.2, 18), C.iron, { pos: [s * 0.88, 0, 0], rot: [0, 0, Math.PI / 2] });
    hull.add(ring(0.36, 0.03, 18), C.brass, { pos: [s * 0.98, 0, 0], rot: [0, Math.PI / 2, 0], minor: true });
  }
  // ---- the tub: the armoured body on the cradle
  hull.add(profile([[-1.05, 0.22], [1.0, 0.22], [1.2, 0.55], [1.1, 1.0], [0.6, 1.35], [-0.9, 1.4], [-1.15, 1.0], [-1.15, 0.5]], 1.9, 0.07, 2), paint);
  hull.add(profile([[-1.05, 0.62], [1.18, 0.66], [1.1, 0.76], [-1.1, 0.74]], 1.96, 0.02, 1), trim); // belt
  hull.add(cyl(0.78, 0.14, 24), C.steel, { pos: [0, 1.4, 0] }); // the roof ring the head turns on
  hull.add(ring(0.74, 0.03, 24), C.brass, { pos: [0, 1.47, 0], rot: [Math.PI / 2, 0, 0], minor: true });
  // glacis: a bolted plate on the sloped front of the roof, with weld beads along its edges
  hull.add(slab(1.7, 0.04, 0.6), paint, { pos: [0, 1.19, 0.862], rot: [0.61, 0, 0], wear: 0.45 });
  for (const s of [-1, 1]) hull.add(slab(0.03, 0.05, 0.6), C.dark, { pos: [s * 0.86, 1.2, 0.862], rot: [0.61, 0, 0], minor: true });
  hull.add(slab(1.7, 0.05, 0.03), C.dark, { pos: [0, 1.0, 1.1 - 0.06], rot: [0.61, 0, 0], minor: true });
  // side details: layered appliqué plates a hair proud of the flanks, panel seams, vent slats, a tool box, bolts
  for (const s of [-1, 1]) {
    hull.add(blk(0.05, 0.5, 0.62, 0.03, 0.012), paint, { pos: [s * 0.972, 0.66, 0.78], wear: 0.5 });
    hull.add(blk(0.05, 0.42, 0.7, 0.03, 0.012), trim, { pos: [s * 0.972, 0.62, -0.84], wear: 0.55 });
    hull.add(slab(0.05, 0.1, 0.56), C.dark, { pos: [s * 0.968, 1.16, 0.12], minor: true }); // upper skirt strip
    for (const z of [-0.5, 0.45]) hull.add(slab(0.03, 0.8, 0.03), C.dark, { pos: [s * 0.955, 0.85, z], minor: true });
    for (let i = 0; i < 4; i++) hull.add(slab(0.03, 0.04, 0.34), C.dark, { pos: [s * 0.955, 1.0 + i * 0.07, 0.0], minor: true });
    hull.add(blk(0.14, 0.34, 0.6, 0.03, 0.012), C.canvas, { pos: [s * 1.0, 0.45, -0.6], wear: 0.6 });
    hull.add(slab(0.15, 0.04, 0.62), C.dark, { pos: [s * 1.0, 0.64, -0.6], minor: true }); // the lid's edge
    row(hull, [s * 0.975, 0.45, 0.58], [s * 0.975, 0.45, 1.0], 4, [0, 0, -s * Math.PI / 2]);
    row(hull, [s * 0.995, 0.4, -1.08], [s * 0.995, 0.4, -0.6], 4, [0, 0, -s * Math.PI / 2]);
    // shoulder guard: an armoured hood over the hip hub, clear of the thigh's swing
    hull.add(arch(0.52, 0.6, 0.54, -1.3, 1.3), paint, { pos: [s * 1.2, 0, 0], wear: 0.55 });
    hull.add(arch(0.6, 0.64, 0.46, -1.3, 1.3, 6), trim, { pos: [s * 1.2, 0, 0], minor: true });
    for (const a of [-1.1, -0.4, 0.4, 1.1]) dome(hull, 0.03, [s * 1.2, Math.cos(a) * 0.64, Math.sin(a) * 0.64], [Math.PI / 2 - a, 0, 0]);
    // hydraulic accumulator under the front of the pelvis, with its feed line up into the tub
    hull.add(cyl(0.13, 0.7, 12), C.iron, { pos: [s * 0.5, -0.34, 0.32], rot: [Math.PI / 2, 0, 0], minor: true });
    for (const z of [0.1, 0.52]) hull.add(ring(0.135, 0.02, 12), C.brass, { pos: [s * 0.5, -0.34, z], minor: true });
    hull.add(pipe([[s * 0.5, -0.3, 0.66], [s * 0.5, -0.18, 0.86], [s * 0.5, 0.2, 1.0]], 0.035, 8, 5), C.copper, { minor: true });
    // lifting eyes on the roof
    hull.add(ring(0.07, 0.016, 8), C.steel, { pos: [s * 0.5, 1.4, 0.58], rot: [Math.PI / 2, 0, 0], minor: true });
  }
  // roof seams: the engine hatch and the access panels
  for (const x of [-0.55, 0.55]) hull.add(slab(0.02, 0.012, 1.3), C.dark, { pos: [x, 1.41, -0.2], minor: true });
  hull.add(slab(1.14, 0.012, 0.02), C.dark, { pos: [0, 1.41, -0.85], minor: true });
  // ---- engine: twin boilers on a shelf off the back of the tub, a manifold across them and the stacks
  hull.add(blk(1.7, 0.12, 0.8, 0.03, 0.015), C.iron, { pos: [0, 0.34, -1.2] });
  for (const s of [-1, 1]) {
    hull.add(cyl(0.34, 1.3, 16), C.brass, { pos: [s * 0.55, 1.05, -1.05] });
    for (const y of [0.55, 1.05, 1.5]) hull.add(ring(0.345, 0.025, 16), C.copper, { pos: [s * 0.55, y, -1.05], rot: [Math.PI / 2, 0, 0], minor: true });
    hull.add(turnedY([[0.0, 0], [0.34, 0], [0.2, 0.18], [0.0, 0.2]], 12), C.brass, { pos: [s * 0.55, 1.7, -1.05] });
    hull.add(pipe([[s * 0.55, 1.85, -1.05], [s * 0.55, 2.2, -1.05], [s * 0.6, 2.5, -1.1]], 0.08, 8, 7), C.iron); // stack
    hull.add(cyl(0.1, 0.1, 10), C.dark, { pos: [s * 0.6, 2.5, -1.1], minor: true }); // stack mouth
    hull.add(cyl(0.12, 0.05, 10), C.iron, { pos: [s * 0.55, 1.92, -1.05], minor: true }); // stack collar
    // a pressure gauge and a safety valve on each boiler
    hull.add(cyl(0.07, 0.05, 10), C.brass, { pos: [s * 0.55, 1.28, -0.7], rot: [Math.PI / 2, 0, 0], minor: true });
    hull.add(cyl(0.05, 0.05, 8), C.canvas, { pos: [s * 0.55, 1.28, -0.67], rot: [Math.PI / 2, 0, 0], minor: true });
    hull.add(cyl(0.035, 0.18, 8), C.copper, { pos: [s * 0.3, 1.78, -1.05], minor: true });
    hull.add(turnedY([[0, 0], [0.07, 0], [0.04, 0.1], [0.0, 0.12]], 8), C.brass, { pos: [s * 0.3, 1.87, -1.05], minor: true });
  }
  hull.add(pipe([[-0.55, 1.0, -0.76], [0, 1.1, -0.72], [0.55, 1.0, -0.76]], 0.05, 10, 6), C.copper); // manifold across the boilers
  hull.add(pipe([[0, 1.1, -0.72], [0, 1.2, -0.3], [0, 1.4, 0]], 0.04, 10, 6), C.copper); // steam line up to the head's ring
  hull.add(pipe([[-0.55, 0.8, -0.72], [-0.2, 0.6, -0.72], [0.2, 0.62, -0.72], [0.55, 0.8, -0.72]], 0.03, 10, 5), C.iron, { minor: true }); // return line
  // ladder on the back of the tub between the boilers
  for (const s of [-1, 1]) hull.add(slab(0.05, 0.9, 0.04), C.steel, { pos: [s * 0.18, 0.88, -1.17], minor: true });
  for (let i = 0; i < 6; i++) hull.add(slab(0.36, 0.03, 0.03), C.steel, { pos: [0, 0.5 + i * 0.15, -1.17], minor: true });
  // jerry cans lashed to the shelf rail
  for (const s of [-1, 1]) {
    hull.add(blk(0.22, 0.34, 0.12, 0.02, 0.01), P('#5d6240'), { pos: [s * 0.92, 0.55, -1.45], wear: 0.6, minor: true });
    hull.add(slab(0.2, 0.025, 0.14), C.dark, { pos: [s * 0.92, 0.55, -1.45], minor: true });
  }
  // ---- the head: base drum, a shell with a raked canopy, a back bin, a sensor mast
  turret.add(cyl(0.72, 0.2, 24), C.steel, { pos: [0, 0.08, 0] });
  turret.add(profile([[-0.7, 0.1], [0.75, 0.1], [0.95, 0.4], [0.8, 0.82], [0.3, 1.02], [-0.5, 0.95], [-0.75, 0.55]], 1.3, 0.05, 2), paint);
  turret.add(profile([[-0.7, 0.34], [0.9, 0.34], [0.92, 0.42], [-0.72, 0.42]], 1.36, 0.015, 1), trim); // stripe round the head
  // cheek armour: a bolted plate each side, clear of the hardpoints
  for (const s of [-1, 1]) {
    turret.add(blk(0.05, 0.4, 0.56, 0.03, 0.01), paint, { pos: [s * 0.665, 0.58, -0.32], wear: 0.5, minor: true });
    row(turret, [s * 0.69, 0.4, -0.55], [s * 0.69, 0.4, -0.1], 3, [0, 0, -s * Math.PI / 2]);
  }
  // canopy: two raked panes, a centre post, a brow and a sill, all on the sloped front
  const lean = -Math.atan2(0.15, 0.42), nrm = [0, Math.sin(-lean), Math.cos(lean)];
  const onFront = (y, off = 0.0) => [0.875 + (y - 0.61) * (-0.15 / 0.42) + nrm[2] * off, y, 0];
  for (const x of [-0.31, 0.31]) {
    const c = onFront(0.61, 0.02);
    turret.add(blk(0.52, 0.36, 0.05, 0.01, 0.006), C.glass, { pos: [x, c[1] + nrm[1] * 0.02, c[0] + 0.0], rot: [lean, 0, 0] });
  }
  turret.add(blk(0.06, 0.44, 0.07, 0.01, 0.005), C.dark, { pos: [0, 0.61 + nrm[1] * 0.02, 0.875 + 0.02], rot: [lean, 0, 0] });
  turret.add(blk(1.24, 0.08, 0.09, 0.015, 0.008), C.dark, { pos: [0, 0.83, 0.79], rot: [lean, 0, 0] }); // brow
  turret.add(blk(1.24, 0.07, 0.09, 0.015, 0.008), C.dark, { pos: [0, 0.4, 0.93], rot: [lean, 0, 0] }); // sill
  turret.add(slab(1.3, 0.05, 0.1), paint, { pos: [0, 0.9, 0.7], rot: [lean + 0.25, 0, 0], minor: true }); // visor hood over the brow
  turret.add(blk(0.5, 0.04, 0.5, 0.03, 0.01), C.dark, { pos: [-0.2, 1.0, -0.12] }); // roof hatch
  turret.add(slab(0.4, 0.02, 0.4), C.steel, { pos: [-0.2, 1.03, -0.12], minor: true }); // the hatch lid
  turret.add(cyl(0.025, 0.14, 6), C.steel, { pos: [-0.2, 1.1, -0.12], minor: true }); // lid handle post
  turret.add(blk(1.1, 0.5, 0.3, 0.05, 0.02), C.iron, { pos: [0, 0.5, -0.8] }); // ammunition bin on the back
  for (const x of [-0.3, 0.3]) turret.add(slab(0.05, 0.52, 0.32), C.dark, { pos: [x, 0.5, -0.8], minor: true }); // bin straps
  turret.add(cyl(0.07, 0.34, 8), C.canvas, { pos: [0.35, 0.82, -0.8], rot: [0, 0, Math.PI / 2], minor: true }); // a bedroll on the bin
  // headlamps in pods under the canopy, a sensor head on a mast, a whip antenna, a searchlight on the roof
  for (const s of [-1, 1]) {
    turret.add(cyl(0.1, 0.18, 12), C.dark, { pos: [s * 0.45, 0.24, 0.9], rot: [Math.PI / 2, 0, 0] });
    glow.push([cyl(0.075, 0.03, 10), [s * 0.45, 0.24, 1.0], [Math.PI / 2, 0, 0]]);
  }
  turret.add(cyl(0.045, 0.4, 8), C.dark, { pos: [0.42, 1.15, -0.2] });
  turret.add(cyl(0.1, 0.24, 12), C.iron, { pos: [0.42, 1.36, -0.2], rot: [Math.PI / 2, 0, 0] });
  glow.push([cyl(0.07, 0.03, 10), [0.42, 1.36, -0.07], [Math.PI / 2, 0, 0]]);
  turret.add(rod(0.012, 0, 1.2, 5), C.dark, { pos: [-0.45, 0.95, -0.5], rot: [-Math.PI / 2 - 0.18, 0, 0.1], minor: true });
  turret.add(cyl(0.12, 0.2, 10), C.dark, { pos: [0.1, 1.04, 0.25], minor: true });
  turret.add(cyl(0.1, 0.12, 10), C.iron, { pos: [0.1, 1.17, 0.3], rot: [Math.PI / 2 - 0.3, 0, 0], minor: true });
  glow.push([cyl(0.075, 0.02, 10), [0.1, 1.2, 0.38], [Math.PI / 2 - 0.3, 0, 0]]);
  // ---- right hardpoint: a housing bolted to the cheek, the autocannon's ball mount on its face
  turret.add(blk(0.56, 0.5, 0.7, 0.05, 0.02), C.iron, { pos: [GUN_AT[0], GUN_AT[1], GUN_AT[2] - 0.4] });
  turret.add(ring(0.25, 0.04, 14), C.brass, { pos: [GUN_AT[0], GUN_AT[1], GUN_AT[2] - 0.1], minor: true });
  turret.add(cone(0.31, 0.2, 0.22, 14), C.canvas, { pos: [GUN_AT[0], GUN_AT[1], GUN_AT[2] - 0.2], rot: [Math.PI / 2, 0, 0], wear: 0.5 }); // the dust cover round the ball
  row(turret, [GUN_AT[0] - 0.2, GUN_AT[1] + 0.27, GUN_AT[2] - 0.45], [GUN_AT[0] + 0.2, GUN_AT[1] + 0.27, GUN_AT[2] - 0.45], 4, [0, 0, 0]);
  // ---- left hardpoint: a base on the cheek, two yoke plates, the mortar tube pinned between them
  turret.add(blk(0.56, 0.36, 0.7, 0.05, 0.02), C.iron, { pos: [MORTAR_AT[0], 0.35, MORTAR_AT[2]] });
  for (const s of [-1, 1]) turret.add(blk(0.06, 0.5, 0.5, 0.03, 0.012), paint, { pos: [MORTAR_AT[0] + s * 0.25, 0.7, MORTAR_AT[2]] });
  turret.add(cyl(0.07, 0.66, 10), C.steel, { pos: [...MORTAR_AT], rot: [0, 0, Math.PI / 2] }); // trunnion pin
  const tubeAt = { pos: [...MORTAR_AT], rot: [MORTAR_TILT, 0, 0] };
  turret.add(rod(0.19, -0.35, 1.1, 14), C.dark, tubeAt);
  turret.add(turned([[0.19, 1.0], [0.25, 1.0], [0.25, 1.1], [0.19, 1.1]], 14), C.iron, { ...tubeAt, minor: true }); // muzzle collar
  for (const z of [0.3, 0.6]) turret.add(ring(0.195, 0.025, 14), C.brass, { pos: [MORTAR_AT[0], MORTAR_AT[1] + z * Math.sin(-MORTAR_TILT), MORTAR_AT[2] + z * Math.cos(MORTAR_TILT)], rot: [MORTAR_TILT, 0, 0], minor: true });
  turret.add(slab(0.3, 0.06, 0.34), C.iron, { pos: [MORTAR_AT[0], MORTAR_AT[1] - 0.3, MORTAR_AT[2] - 0.35], rot: [MORTAR_TILT, 0, 0], minor: true }); // breech block
  // ---- the autocannon (origin: the ball): shroud, barrel, brake, ammunition drum on the outboard side, a feed chute
  gunK.add(new THREE.SphereGeometry(0.21, 12, 8), C.steel);
  gunK.add(turned([[0.12, 0.1], [0.15, 0.15], [0.15, 1.5], [0.12, 1.55]], 12), C.steel);
  for (let i = 0; i < 4; i++) gunK.add(slab(0.1, 0.012, 0.05), C.dark, { pos: [0, 0.15, 0.35 + i * 0.22], minor: true }); // jacket slots
  gunK.add(rod(0.07, 0.1, 2.3, 10), C.dark);
  gunK.add(turned([[0.0001, 2.2], [0.1, 2.2], [0.1, 2.42], [0.06, 2.42]], 10), C.iron);
  for (const z of [2.28, 2.36]) gunK.add(slab(0.04, 0.012, 0.03), C.dark, { pos: [0.1, 0, z], minor: true }); // brake ports
  gunK.add(cyl(0.2, 0.3, 12), C.iron, { pos: [0.3, -0.02, -0.02], rot: [0, 0, Math.PI / 2] });
  gunK.add(ring(0.205, 0.02, 12), C.brass, { pos: [0.3, -0.02, -0.02], rot: [0, Math.PI / 2, 0], minor: true });
  gunK.add(slab(0.18, 0.1, 0.22), C.dark, { pos: [0.16, 0.0, 0.1], minor: true }); // the feed throat between drum and breech
  // ---- damage overlays: drawn only when the strider is hurt
  for (const s of [-1, 1]) {
    // hurt: scorching on the flanks, a plate peeled off its top edge, a dented shoulder guard
    hull.add(slab(0.012, 0.46, 0.5), C.scorch, { pos: [s * 0.999, 0.58, 0.06], tier: 1 });
    hull.add(slab(0.012, 0.3, 0.3), C.scorch, { pos: [s * 0.999, 0.98, -0.45], tier: 1 });
  }
  hull.add(slab(0.04, 0.46, 0.58), paint, { pos: [0.96 + 0.1, 0.68 + 0.04, 0.78], rot: [0, 0, -0.45], tier: 1 }); // the right applique, peeled outward
  hull.add(slab(0.06, 0.2, 0.42), C.dark, { pos: [0.93, 0.5, 0.78], tier: 1 }); // the bare tub under it
  turret.add(new THREE.SphereGeometry(0.26, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), C.scorch, { pos: [-0.66, 0.62, 0.25], rot: [0, 0, Math.PI / 2], scale: [0.5, 1, 1], tier: 1 }); // a scorched dent on the left cheek
  turret.add(slab(0.5, 0.012, 0.4), C.scorch, { pos: [0.1, 1.03, -0.35], tier: 1 });
  turret.add(rod(0.012, 0, 0.6, 5), C.dark, { pos: [-0.45, 0.95, -0.5], rot: [-0.3, 0, 0.5], tier: 1 }); // a bent second antenna stub
  // badly hurt: the engine cover torn back to show the boiler frame, a stack bent over, the canopy cracked
  hull.add(slab(0.9, 0.04, 0.5), C.dark, { pos: [0.0, 1.02, -0.5], rot: [-0.5, 0, 0.1], tier: 2 }); // the cover, hanging off its hinge
  for (const x of [-0.3, 0, 0.3]) hull.add(cyl(0.03, 0.6, 6), C.iron, { pos: [x, 1.06, -0.9], rot: [0.3, 0, 0], tier: 2 }); // ribs showing
  hull.add(cone(0.1, 0.16, 0.28, 8), C.dark, { pos: [-0.62, 2.62, -1.12], rot: [0.5, 0, 0.7], tier: 2 }); // the left stack torn over
  hull.add(slab(0.05, 0.34, 0.5), C.dark, { pos: [-0.93, 0.7, -0.84], rot: [0, 0, 0.5], tier: 2 }); // a trim plate hanging
  hull.add(slab(0.012, 0.8, 0.9), C.scorch, { pos: [0.999, 0.9, -0.55], tier: 2 });
  turret.add(slab(0.52, 0.012, 0.37), C.scorch, { pos: [-0.31, 0.62 + 0.03, 0.9], rot: [lean, 0, 0], tier: 2 }); // soot on the left canopy pane
  for (let i = 0; i < 3; i++) turret.add(slab(0.26 + i * 0.1, 0.012, 0.012), P('#bdbab0', 'bare'), { pos: [0.31, 0.5 + i * 0.1, 0.98 - i * 0.02], rot: [lean, 0, 0.5 - i * 0.6], tier: 2 }); // cracks across the right pane
  turret.add(slab(0.4, 0.04, 0.3), C.dark, { pos: [0, 0.78, -0.8], rot: [0.5, 0, 0], tier: 2 }); // the bin's lid knocked up
  return { hull, turret, gunK, glow };
}

function striderLeg(team, side) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = P(T.body), trim = P(T.trim);
  const { L1, L2 } = WL, b = LEG0[side < 0 ? 0 : 1];
  const A = (i) => BONES[b + i].anchor;
  const thigh = new CKit('thigh', b, A(0)), shin = new CKit('shin', b + 1, A(1), 1), foot = new CKit('foot', b + 2, A(2), 1.4), toes = new CKit('toes', b + 3, A(3), 1.4), ramTube = new CKit('ram tube', b + 4, A(4)), ramRod = new CKit('ram rod', b + 5, A(5));
  // the legs are built straight down in the bind pose: set where each stands so mud and grime go where they would
  thigh.standY = 3.15; shin.standY = 1.8; foot.standY = 0; toes.standY = 0;
  const dome = (kit, r, pos, rot, col = C.steel) => kit.add(new THREE.SphereGeometry(r, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2), col, { pos, rot, minor: true });
  // ---- thigh: a hub on the hip axle, two frame plates, spacers between them, a front shield, the ram lug behind
  thigh.add(cyl(0.3, 0.6, 16), C.iron, { rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    thigh.add(cyl(0.34, 0.05, 16), C.brass, { pos: [s * 0.3, 0, 0], rot: [0, 0, Math.PI / 2], minor: true });
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; dome(thigh, 0.025, [s * 0.325, Math.cos(a) * 0.27, Math.sin(a) * 0.27], [0, 0, -s * Math.PI / 2]); }
    thigh.add(profile([[thighRear(0), 0.0], [thighFront(0), 0.0], [thighFront(L1), -L1], [thighRear(L1), -L1]], 0.08, 0.02, 1), paint, { pos: [s * 0.19, 0, 0], wear: 0.5 });
  }
  for (const d of [0.5, 1.0, 1.45]) thigh.add(blk(0.36, 0.14, 0.1, 0.02, 0.01), C.steel, { pos: [0, -d, thighFront(d) - 0.03] }); // spacers on the front edge
  thigh.add(blk(0.5, L1 * 0.62, 0.06, 0.02, 0.01), C.iron, { pos: [0, -L1 * 0.52, thighFront(L1 * 0.52) + 0.01], rot: [0.057, 0, 0], wear: 0.55 }); // front shield
  for (const y of [-0.6, -0.95, -1.3]) thigh.add(slab(0.52, 0.03, 0.065), C.dark, { pos: [0, y, thighFront(-y) + 0.01], rot: [0.057, 0, 0], minor: true });
  thigh.add(blk(0.4, 0.24, 0.14, 0.02, 0.01), C.iron, { pos: [0, THIGH_LUG[1], thighRear(0.55) - 0.02] }); // rear cross-spacer with the ram lug on it
  thigh.add(blk(0.4, 0.3, 0.06, 0.02, 0.01), trim, { pos: [0, -0.2, thighRear(0.2) - 0.02], wear: 0.5 }); // rear marking plate
  // knee: the pin and its caps, through the plates, and a guard over the front of the knee
  thigh.add(cyl(0.2, 0.56, 14), C.iron, { pos: [0, -L1, 0], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) { thigh.add(cyl(0.24, 0.04, 14), C.brass, { pos: [s * 0.28, -L1, 0], rot: [0, 0, Math.PI / 2], minor: true }); dome(thigh, 0.05, [s * 0.31, -L1, 0], [0, 0, -s * Math.PI / 2]); }
  thigh.add(profile([[thighFront(L1 - 0.5) + 0.02, -L1 + 0.5], [thighFront(L1) + 0.06, -L1 + 0.12], [thighFront(L1) + 0.1, -L1 - 0.05], [thighFront(L1) - 0.04, -L1 - 0.05]], 0.34, 0.02, 1), paint, { wear: 0.6 });
  // a cable loom clipped down the outside of each plate, tied in at three points
  for (const s of [-1, 1]) {
    thigh.add(pipe([[s * 0.255, -0.12, thighFront(0.12) - 0.07], [s * 0.255, -0.9, thighFront(0.9) - 0.07], [s * 0.255, -1.5, thighFront(1.5) - 0.07]], 0.028, 6, 5), C.rubber, { minor: true });
    for (const d of [0.35, 0.85, 1.3]) thigh.add(slab(0.07, 0.05, 0.1), C.dark, { pos: [s * 0.25, -d, thighFront(d) - 0.065], minor: true });
  }
  // ---- shin: one box-section member between the thigh plates, boss at the knee, boss at the ankle
  shin.add(cyl(0.17, 0.3, 14), C.iron, { rot: [0, 0, Math.PI / 2] });
  shin.add(profile([[shinRear(0), 0.0], [shinFront(0), 0.0], [shinFront(L2), -L2], [shinRear(L2), -L2]], 0.3, 0.03, 2), paint, { wear: 0.6 });
  shin.add(blk(0.4, L2 * 0.6, 0.05, 0.02, 0.01), C.iron, { pos: [0, -L2 * 0.5, shinFront(L2 * 0.5) + 0.0], rot: [0.054, 0, 0], wear: 0.6 }); // greave
  for (const y of [-0.5, -0.85, -1.2]) shin.add(slab(0.42, 0.025, 0.06), C.dark, { pos: [0, y, shinFront(-y) + 0.0], rot: [0.054, 0, 0], minor: true });
  shin.add(blk(0.2, 0.34, 0.14, 0.02, 0.01), C.iron, { pos: [0, SHIN_LUG[1], shinRear(0.95) - 0.05] }); // ram lug on the back
  shin.add(cyl(0.2, 0.4, 14), C.iron, { pos: [0, -L2, 0], rot: [0, 0, Math.PI / 2] });
  shin.add(profile([[shinFront(0.1) + 0.03, -0.1], [shinFront(0.5) + 0.07, -0.5], [shinFront(0.5) + 0.07, -0.95], [shinFront(0.1) + 0.03, -0.9]], 0.32, 0.02, 1), trim, { wear: 0.6, minor: true }); // a shin guard
  for (const d of [0.4, 0.8, 1.25, 1.6]) shin.add(slab(0.34, 0.02, 0.012), C.dark, { pos: [0, -d, shinRear(d) - 0.005], minor: true }); // panel seams
  // ---- hydraulic ram: a sleeve from the thigh lug and a polished rod from the shin lug, aimed at each other (unit length along +z)
  ramTube.add(turned([[0.0001, 0], [0.11, 0], [0.11, 0.92], [0.09, 0.96], [0.0001, 0.96]], 10), C.dark);
  for (const z of [0.15, 0.75]) ramTube.add(ring(0.113, 0.018, 10), C.brass, { pos: [0, 0, z], minor: true });
  ramTube.add(turned([[0.055, 0.9], [0.13, 0.9], [0.13, 1.0], [0.055, 1.0]], 10), C.iron);
  ramRod.add(turned([[0.0001, 0], [0.055, 0], [0.055, 0.98], [0.0001, 0.98]], 8), P('#b9bcbc', 'bare'));
  ramRod.add(turned([[0.0001, 0], [0.1, 0], [0.1, 0.1], [0.0001, 0.1]], 8), C.iron);
  // ---- foot: a broad pad with a tread, two cheek plates holding the ankle pin, a heel guard
  foot.add(profile([[-0.55, 0.0], [0.58, 0.0], [0.6, 0.1], [0.5, 0.22], [-0.5, 0.22]], 0.76, 0.04, 2), C.iron, { wear: 0.7 });
  for (let i = 0; i < 5; i++) foot.add(slab(0.76, 0.03, 0.05), C.rubber, { pos: [0, 0.015, -0.4 + i * 0.2], minor: true });
  for (const s of [-1, 1]) foot.add(profile([[-0.32, 0.2], [0.32, 0.2], [0.22, 0.58], [-0.22, 0.58]], 0.06, 0.015, 1), paint, { pos: [s * 0.23, 0, 0], wear: 0.65 });
  foot.add(cyl(0.07, 0.62, 8), C.steel, { pos: [0, WL.ankle, 0], rot: [0, 0, Math.PI / 2] }); // ankle pin
  for (const s of [-1, 1]) dome(foot, 0.07, [s * 0.31, WL.ankle, 0], [0, 0, -s * Math.PI / 2], C.brass);
  foot.add(blk(0.5, 0.1, 0.3, 0.02, 0.01), C.dark, { pos: [0, 0.14, -0.5] }); // heel guard
  foot.add(blk(0.5, 0.04, 0.34, 0.02, 0.01), paint, { pos: [0, 0.23, 0.3], wear: 0.7 }); // top plate
  for (const x of [-0.25, 0.25]) foot.add(slab(0.05, 0.04, 0.3), C.dark, { pos: [x, 0.265, 0.3], minor: true }); // grip ribs on the top plate
  foot.add(pipe([[0.0, 0.5, -0.2], [0.0, 0.33, -0.4], [0.0, 0.2, -0.5]], 0.03, 6, 5), C.copper, { minor: true }); // damper feed
  // ---- toes: three claws on a hinge bar; origin at the hinge (0, 0, 0), toes reach +z
  toes.add(cyl(0.09, 0.78, 8), C.steel, { pos: [0, 0.1, 0], rot: [0, 0, Math.PI / 2] });
  for (const x of [-0.26, 0, 0.26]) {
    toes.add(profile([[0.0, 0.0], [0.54, 0.0], [0.64, 0.07], [0.1, 0.17]], 0.2, 0.02, 1), C.dark, { pos: [x, 0, 0], wear: 0.7 });
    toes.add(slab(0.06, 0.05, 0.38), C.iron, { pos: [x, 0.17, 0.28], rot: [-0.18, 0, 0], minor: true });
    toes.add(profile([[0.52, 0.0], [0.7, 0.02], [0.66, 0.09], [0.54, 0.09]], 0.14, 0.01, 1), C.steel, { pos: [x, 0, 0], wear: 0.8 }); // claw tip
  }
  // ---- hoses: skinned, so they bend with the joint they cross. Authored in the bind pose (legs hanging straight down).
  const hose = new CKit('hoses', 0, [0, 0, 0]);
  const x0 = side * WL.x, hy = WL.hip, ky = WL.hip - L1;
  const hip = (o) => ({ a: 0, b: b, t: (x, y) => smoothstep(hy - 0.28, hy - 0.62, y) });
  const knee = (o) => ({ a: b, b: b + 1, t: (x, y) => smoothstep(ky + 0.3, ky - 0.3, y) });
  // the hip: from the underside of the pelvis, out and round, into the front shield of the thigh
  hose.add(hoseCurve([[side * 0.9, hy - 0.3, 0.52], [side * 1.0, hy - 0.5, 0.7], [side * 1.18, hy - 0.62, 0.68], [x0 + side * 0.1, hy - 0.5, 0.44]], 0.04, 14, 6), C.rubber, { blend: hip(), minor: true });
  hose.add(hoseCurve([[side * 0.78, hy - 0.3, 0.4], [side * 0.84, hy - 0.45, 0.6], [side * 1.0, hy - 0.58, 0.64], [x0 - side * 0.02, hy - 0.42, 0.44]], 0.028, 12, 5), C.copper, { blend: hip(), minor: true });
  // the knee: two lines behind the ram, from the thigh's rear frame to the shin's, looping out to the back
  for (const dx of [-0.13, 0.13]) {
    hose.add(hoseCurve([[x0 + dx, ky + 0.8, thighRear(1.0) - 0.04], [x0 + dx, ky + 0.3, -0.5], [x0 + dx, ky - 0.15, -0.5], [x0 + dx, ky - 0.4, shinRear(0.4) - 0.04]], 0.032, 14, 6), dx < 0 ? C.rubber : C.copper, { blend: knee(), minor: true });
  }
  return { thigh, shin, foot, toes, ramTube, ramRod, hose };
}

const _ik = { A0: new THREE.Vector3(), R1: new THREE.Vector3(), R2: new THREE.Vector3(), Z: new THREE.Vector3(0, 0, 1), Q: new THREE.Quaternion(), H: new THREE.Vector3(), A: new THREE.Vector3(), K: new THREE.Vector3(), d: new THREE.Vector3(), pole: new THREE.Vector3(), inv: new THREE.Matrix4(), dn: new THREE.Vector3(0, -1, 0), tmp: new THREE.Vector3() };
const smooth = (u) => u * u * (3 - 2 * u);
const modelCache = new Map();

function buildStriderModel(team) {
  const key = `walker${team}`;
  if (!modelCache.has(key)) {
    const make = () => {
      const p = striderParts(team), kits = [p.hull, p.turret], legs = [striderLeg(team, -1), striderLeg(team, 1)];
      for (const l of legs) kits.push(l.thigh, l.shin, l.foot, l.toes, l.ramTube, l.ramRod, l.hose);
      return { kits, p };
    };
    const { near, far } = buildLods(make);
    const gk = new CKit(); for (const [g, pos, rot] of near.p.glow) gk.add(g, P('#ffe9a8', 'rubber'), { pos, rot });
    modelCache.set(key, { body: bakeKits(near.kits, far.kits), gun: bakeKits([near.p.gunK], [far.p.gunK]), glow: bakeKits([gk]).near });
  }
  const m = modelCache.get(key), def = VEHICLES.walker;
  const root = new THREE.Group();
  root.name = 'vehicle-walker';
  const skeleton = makeSkeleton(root, BONES);
  const sk = skinnedBody(root, skeleton, m.body, { radius: 7.5, centre: [0, 3, 0] });
  const B = skeleton.bones;
  const bodyG = B[0], turretPivot = B[1];
  const lamps = new THREE.Mesh(m.glow, new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#ffd27a', emissiveIntensity: 1.3 }));
  turretPivot.add(lamps);
  const gMesh = new THREE.Mesh(m.gun.near, BODY);
  gMesh.castShadow = true; gMesh.receiveShadow = true;
  const gun = new THREE.Group(); gun.position.set(...GUN_AT);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 2.45);
  const mortarMuzzle = new THREE.Object3D(); mortarMuzzle.position.set(MORTAR_AT[0], MORTAR_AT[1] + 1.12 * Math.sin(-MORTAR_TILT), MORTAR_AT[2] + 1.12 * Math.cos(MORTAR_TILT));
  gun.add(gMesh, muzzle);
  turretPivot.add(gun, mortarMuzzle);
  const legs = [0, 1].map((i) => {
    const o = LEG0[i];
    return { side: i ? 1 : -1, th: B[o], sh: B[o + 1], ft: B[o + 2], toe: B[o + 3], rt: B[o + 4], rr: B[o + 5], fp: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), stepping: false, u: 0, dur: 0.45, init: false };
  });
  for (const l of legs) l.toe.position.set(0, 0, 0.58);
  // the same single draw call stands for the whole body; the lamps and the gun are separate (emissive, and the gun stays in the cockpit view)
  const parts = {
    root, turretPivot, gun, gunZ: GUN_AT[2], recoilK: 0.12, muzzles: [muzzle, mortarMuzzle], legs, lastT: -1, hy: WL.hip, skeleton, sk,
    meshes: [sk.body, gMesh, ...(sk.dmg ? [sk.dmg] : [])], hitMeshes: [sk.hit, gMesh], gunMesh: gMesh,
    bones: B, bodyBone: bodyG, lamps, kitObjects: { gun: gMesh, kit: lamps },
  };
  parts.animate = (v) => striderAnimate(v, parts, bodyG);
  const lampsOn = () => { lamps.visible = sk.state.shown && sk.state.lod < 2 && !parts.dead; };
  parts.setLod = (l) => { sk.setLod(l); const g = l > 0 ? m.gun.far : m.gun.near; if (gMesh.geometry !== g) gMesh.geometry = g; lampsOn(); };
  parts.setDamage = (t) => sk.setDamage(t);
  parts.setCockpit = (on) => { sk.show(!on); lampsOn(); };
  parts.refresh = lampsOn;
  return parts;
}
VEHICLES.walker.build = buildStriderModel;

// foot planting: each foot stays where it landed until the body walks it out of range, then swings to a new spot
function striderAnimate(v, P, bodyG) {
  const { L1, L2 } = WL;
  const dt = P.lastT < 0 ? 0 : clamp(v.t - P.lastT, 0, 0.1);
  P.lastT = v.t;
  const alive = v.alive, sp = Math.abs(v.speed);
  const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
  const lead = clamp(v.speed * 0.4, -1.3, 1.6);
  v.footfalls ||= [];
  const [A, B] = P.legs;
  let avg = 0;
  for (const leg of P.legs) {
    const other = leg === A ? B : A;
    const hx = alive ? leg.side * 1.15 : leg.side * 1.9, hz = alive ? lead : (leg.side < 0 ? 0.5 : -0.5);
    const hxw = v.pos.x + c * hx + s * hz, hzw = v.pos.z - s * hx + c * hz;
    const fp = leg.fp;
    if (!leg.init || Math.hypot(fp.x - hxw, fp.z - hzw) > 7) { fp.set(hxw, height(hxw, hzw), hzw); leg.init = true; leg.stepping = false; }
    const dist = Math.hypot(fp.x - hxw, fp.z - hzw);
    const thr = 0.85 + sp * 0.09;
    if (alive && !leg.stepping && dist > thr && (!other.stepping || dist > thr * 2)) {
      leg.stepping = true; leg.u = 0; leg.from.copy(fp);
      const dx = hxw - fp.x, dz = hzw - fp.z, dl = Math.hypot(dx, dz) || 1, over = Math.min(0.7, 0.2 + sp * 0.1);
      leg.to.set(hxw + dx / dl * over, 0, hzw + dz / dl * over); leg.to.y = height(leg.to.x, leg.to.z);
      leg.dur = clamp(0.55 - sp * 0.04, 0.3, 0.55);
    }
    if (leg.stepping) {
      leg.u = Math.min(1, leg.u + dt / leg.dur);
      const e = smooth(leg.u);
      fp.lerpVectors(leg.from, leg.to, e);
      const gy = height(fp.x, fp.z);
      fp.y = Math.max(gy, THREE.MathUtils.lerp(leg.from.y, leg.to.y, e)) + Math.sin(Math.PI * leg.u) * (0.35 + sp * 0.07);
      if (leg.u >= 1) { leg.stepping = false; fp.y = height(fp.x, fp.z); v.footfalls.push([fp.x, fp.z]); }
    } else fp.y = height(fp.x, fp.z);
    avg += fp.y;
  }
  avg /= 2;
  // the hull rides above its feet: lower when a foot is planted deep, sagging when wrecked
  const wantHy = alive ? WL.hip + clamp(avg - v.pos.y, -0.7, 0.7) - (A.stepping || B.stepping ? 0.12 : 0) : WL.hip * 0.62;
  P.hy += (wantHy - P.hy) * (alive ? Math.min(1, dt * 10) : Math.min(1, dt * 1.6));
  if (dt === 0) P.hy = wantHy;
  bodyG.position.y = P.hy;
  bodyG.rotation.z = alive ? (A.stepping ? -0.025 : B.stepping ? 0.025 : 0) : 0.14;
  bodyG.rotation.x = alive ? 0 : 0.08;
  P.dead = !alive;
  P.refresh?.();
  if (P.turretPivot) P.turretPivot.position.y += P.hy - WL.hip;
  // two-bone IK from hip to ankle, knee bent forward
  v.group.updateMatrixWorld(true);
  _ik.inv.copy(v.group.matrixWorld).invert();
  for (const leg of P.legs) {
    _ik.H.set(leg.side * WL.x, P.hy, 0);
    // the foot pitches through the step: toes down as it lifts off (hinging on the ball), toes up as it lands
    // (hinging on the heel); the ankle follows the pitched foot
    const want = leg.stepping ? (leg.u < 0.3 ? 0.5 * (1 - leg.u / 0.3) : leg.u > 0.8 ? -0.32 * ((leg.u - 0.8) / 0.2) : -0.1 * Math.sin((leg.u - 0.3) / 0.5 * Math.PI)) : 0;
    leg.pitch = dt === 0 ? want : (leg.pitch || 0) + (want - (leg.pitch || 0)) * Math.min(1, dt * 16);
    const th0 = leg.pitch, cs = Math.cos(th0), sn = Math.sin(th0), pz = th0 > 0 ? 0.58 : -0.5;
    _ik.A0.copy(leg.fp).applyMatrix4(_ik.inv); // the sole under the ankle, at rest
    // origin of the pitched foot: the pivot stays put (Rx(th) * (0, 0, pz) = (0, -pz sn, pz cs))
    _ik.A.set(_ik.A0.x, _ik.A0.y + pz * sn, _ik.A0.z + pz * (1 - cs));
    leg.ft.position.copy(_ik.A);
    leg.ft.quaternion.setFromAxisAngle(_ik.R1.set(1, 0, 0), th0);
    leg.toe.rotation.x = th0 > 0 ? -th0 * 0.92 : -th0 * 0.5;
    _ik.A.add(_ik.R2.set(0, WL.ankle, 0).applyQuaternion(leg.ft.quaternion));
    _ik.d.subVectors(_ik.A, _ik.H);
    let d = _ik.d.length(); const maxD = L1 + L2 - 0.03;
    _ik.d.multiplyScalar(1 / (d || 1));
    if (d > maxD) { d = maxD; _ik.A.copy(_ik.H).addScaledVector(_ik.d, d); leg.ft.position.copy(_ik.A).sub(_ik.R2.set(0, WL.ankle, 0).applyQuaternion(leg.ft.quaternion)); }
    d = Math.max(d, 0.5);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    _ik.pole.set(0, 0, 1); _ik.pole.addScaledVector(_ik.d, -_ik.d.z).normalize();
    _ik.K.copy(_ik.H).addScaledVector(_ik.d, a).addScaledVector(_ik.pole, h);
    leg.th.position.copy(_ik.H);
    leg.th.quaternion.setFromUnitVectors(_ik.dn, _ik.tmp.subVectors(_ik.K, _ik.H).normalize());
    leg.sh.position.copy(_ik.K);
    leg.sh.quaternion.setFromUnitVectors(_ik.dn, _ik.tmp.subVectors(_ik.A, _ik.K).normalize());
    // the ram runs from the lug on the thigh to the lug on the shin: sleeve and rod aimed at each other, telescoping with the knee
    _ik.R1.set(...THIGH_LUG).applyQuaternion(leg.th.quaternion).add(leg.th.position);
    _ik.R2.set(...SHIN_LUG).applyQuaternion(leg.sh.quaternion).add(leg.sh.position);
    _ik.d.subVectors(_ik.R2, _ik.R1);
    const rd = Math.max(0.2, _ik.d.length()); _ik.d.multiplyScalar(1 / rd);
    leg.rt.position.copy(_ik.R1); leg.rt.quaternion.setFromUnitVectors(_ik.Z, _ik.d); leg.rt.scale.set(1, 1, rd * 0.62);
    leg.rr.position.copy(_ik.R2); leg.rr.quaternion.setFromUnitVectors(_ik.Z, _ik.d.negate()); leg.rr.scale.set(1, 1, rd * 0.5);
  }
}
