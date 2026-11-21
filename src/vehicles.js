import * as THREE from 'three';
import { MAT, Kit, instance, profile, roundRect, turned, turnedY, rod, ring, bolt, pipe, block, paintMat, ellipsoidGeo } from './models.js';
import { TEAMS, hostile } from './factions.js';
import { PLATE } from './world.js';
import { pushCircle, wrap, toLocal } from './physics.js';
import { projectileModel } from './weapons.js';

const HALF = PLATE.size / 2;
const V = () => new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

// Vehicle weapons (world units).
const VW = {
  cannon: { name: 'Cannon', kind: 'shell', interval: 2.6, damage: 170, radius: 3.6, speed: 55, gravity: 3, pierce: 1, sound: 'cannon', proj: 'cannon' },
  coax: { name: 'MG', kind: 'hitscan', interval: 0.11, damage: 16, spread: 0.02, range: 55, pierce: 0.12, sound: 'mg' },
  hoodgun: { name: 'Twin MG', kind: 'hitscan', interval: 0.08, damage: 14, spread: 0.03, range: 45, pierce: 0.12, sound: 'smg' },
  plasma2: { name: 'Coil cannons', kind: 'plasma', interval: 0.32, damage: 42, splash: 20, radius: 1.7, speed: 34, pierce: 0.8, sound: 'plasma' },
  repeater: { name: 'Coil repeater', kind: 'plasma', interval: 0.18, damage: 24, splash: 10, radius: 1.2, speed: 38, pierce: 0.7, sound: 'plasma' },
};

export const VEHICLES = {
  tank: { name: 'Boiler tank', hp: 900, size: 1.7, hx: 1.0, hz: 1.75, h: 1.5, aimY: 0.9, speed: 4.2, rev: 2, turn: 1.0, accel: 3, weapons: ['cannon', 'coax'], cam: { dist: 7.5, height: 1.6 }, range: 17, heavy: true },
  jeep: { name: 'Steam runabout', hp: 320, size: 1.3, hx: 0.68, hz: 1.35, h: 1.1, aimY: 0.6, speed: 7.5, rev: 3, turn: 0.55, accel: 5, weapons: ['hoodgun'], cam: { dist: 5.5, height: 1.3 }, range: 10 },
  walker: { name: 'Strider', hp: 600, size: 1.2, hx: 0.75, hz: 0.65, h: 2.7, aimY: 1.9, speed: 2.4, rev: 1.6, turn: 1.3, accel: 3, weapons: ['plasma2'], cam: { dist: 6.5, height: 2.3 }, range: 13, heavy: true },
  hover: { name: 'Skiff', hp: 300, size: 1.2, hx: 0.75, hz: 1.25, h: 1.0, aimY: 0.7, speed: 8.5, rev: 4, turn: 1.8, accel: 6, weapons: ['repeater'], cam: { dist: 5.5, height: 1.3 }, range: 11 },
};

// ---------------- models ----------------
function rivetRow(k, mat, from, to, n, r, rot) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    k.add(bolt(r), mat, { pos: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t], rot });
  }
}

function tankModel(team) {
  const paint = paintMat(TEAMS[team].hull, 0.75, 0.3), dark = paintMat(TEAMS[team].hullDark, 0.8, 0.3);
  const hull = new Kit(), turretK = new Kit(), gunK = new Kit();
  // hull: sloped glacis, flat deck, sloped rear
  hull.add(profile([[-1.6, 0.35], [1.35, 0.35], [1.72, 0.62], [1.45, 0.98], [-1.35, 0.98], [-1.62, 0.7]], 1.5, 0.04, 3), paint);
  // track runs: stadium silhouettes either side with road-wheel hubs and fenders
  for (const s of [-1, 1]) {
    const loop = [];
    for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 + (i / 12) * Math.PI; loop.push([-1.4 + 0.33 * Math.cos(a), 0.36 + 0.33 * Math.sin(a)]); }
    for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; loop.push([1.45 + 0.33 * Math.cos(a), 0.36 + 0.33 * Math.sin(a)]); }
    hull.add(profile(loop, 0.36, 0.03), MAT.rubber, { pos: [s * 0.86, 0, 0] });
    for (let i = 0; i < 6; i++) {
      const z = -1.3 + i * 0.54;
      hull.add(turned([[0, 0], [0.2, 0], [0.22, 0.02], [0.22, 0.05], [0.1, 0.07], [0, 0.07]], 18), MAT.iron, { pos: [s * 1.04, 0.3, z], rot: [0, s * Math.PI / 2, 0] });
      hull.add(turned([[0, 0.06], [0.05, 0.06], [0.05, 0.1], [0, 0.1]], 10), MAT.brass, { pos: [s * 1.04, 0.3, z], rot: [0, s * Math.PI / 2, 0] });
    }
    hull.add(profile([[-1.75, 0.98], [1.7, 0.98], [1.82, 0.9], [1.7, 0.92], [-1.7, 0.92]], 0.42, 0.01), dark, { pos: [s * 0.86, 0.0, 0] });
    rivetRow(hull, MAT.darkSteel, [s * 0.755, 0.9, -1.3], [s * 0.755, 0.9, 1.3], 11, 0.022, [0, 0, -s * Math.PI / 2]);
    rivetRow(hull, MAT.darkSteel, [s * 0.755, 0.45, -1.4], [s * 0.755, 0.45, 1.25], 11, 0.022, [0, 0, -s * Math.PI / 2]);
  }
  // exhaust stacks at the rear with brass caps; tool box on the deck
  for (const s of [-1, 1]) {
    hull.add(turnedY([[0, 0], [0.08, 0], [0.08, 0.55], [0.11, 0.58], [0.11, 0.66], [0.07, 0.68], [0, 0.68]], 14), MAT.copper, { pos: [s * 0.5, 0.95, -1.38] });
    hull.add(ring(0.085, 0.016, 14), MAT.brass, { pos: [s * 0.5, 1.25, -1.38], rot: [Math.PI / 2, 0, 0] });
  }
  hull.add(block(0.9, 0.18, 0.35, 0.04, 0.015), dark, { pos: [0, 1.07, -1.05] });
  hull.add(ellipsoidGeo(0.09, 0.09, 0.05, 12, 8), MAT.glass, { pos: [0.45, 0.88, 1.55], rot: [-0.9, 0, 0] });
  // turret: a low riveted dome on a ring
  turretK.add(turnedY([[0, 0], [0.72, 0], [0.75, 0.05], [0.72, 0.25], [0.62, 0.42], [0.4, 0.52], [0.3, 0.53], [0.3, 0.6], [0, 0.6]], 28), paint);
  turretK.add(ring(0.31, 0.03, 20), MAT.brass, { pos: [0, 0.58, 0], rot: [Math.PI / 2, 0, 0] });
  turretK.add(ring(0.74, 0.025, 28), dark, { pos: [0, 0.04, 0], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; turretK.add(bolt(0.022), MAT.darkSteel, { pos: [Math.sin(a) * 0.69, 0.27, Math.cos(a) * 0.69], rot: [Math.cos(a) * Math.PI / 2 * 0.9, 0, -Math.sin(a) * Math.PI / 2 * 0.9] }); }
  turretK.add(block(0.5, 0.36, 0.3, 0.06, 0.02), dark, { pos: [0, 0.24, 0.66] });
  // gun: barrel with bands and a slotted muzzle brake
  gunK.add(turned([[0, 0], [0.085, 0], [0.085, 0.3], [0.065, 0.34], [0.065, 1.9], [0, 1.9]], 16), MAT.darkSteel);
  for (const z of [0.5, 1.1]) gunK.add(ring(0.07, 0.016, 16), MAT.brass, { pos: [0, 0, z] });
  gunK.add(turned([[0, 1.85], [0.1, 1.85], [0.1, 2.1], [0.075, 2.12], [0, 2.12]], 16), MAT.steel);
  gunK.add(rod(0.025, 0, 0.35, 8), MAT.darkSteel, { pos: [0.2, 0.05, 0] });
  const g = new THREE.Group();
  const hullM = hull.build('hull');
  const turret = turretK.build('turret');
  turret.position.set(0, 0.98, -0.1);
  const gun = gunK.build('gun');
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 0.26, 0.72);
  gunPivot.add(gun);
  turret.add(gunPivot);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 2.15); gun.add(muzzle);
  const coax = new THREE.Object3D(); coax.position.set(0.2, 0.05, 0.4); gun.add(coax);
  const seat = new THREE.Object3D(); seat.position.set(0, 0.14, -0.05); turret.add(seat);
  const stacks = [new THREE.Vector3(-0.5, 1.68, -1.38), new THREE.Vector3(0.5, 1.68, -1.38)];
  g.add(hullM, turret);
  return { group: g, turret, gunPivot, gun, muzzles: [muzzle, coax], seat, stacks, seatPose: 'hatch' };
}

function wheel() {
  return turned([[0, -0.11], [0.2, -0.11], [0.27, -0.1], [0.31, -0.06], [0.32, 0], [0.31, 0.06], [0.27, 0.1], [0.2, 0.11], [0, 0.11]], 22);
}

function jeepModel(team) {
  const paint = paintMat(TEAMS[team].hull, 0.7, 0.3), dark = paintMat(TEAMS[team].hullDark, 0.8, 0.3);
  const k = new Kit();
  // tub with a long hood
  k.add(profile([[-1.3, 0.38], [1.35, 0.38], [1.42, 0.55], [1.35, 0.78], [0.35, 0.8], [0.25, 0.68], [-1.2, 0.72], [-1.32, 0.6]], 1.24, 0.04, 3), paint);
  k.add(profile([[0.35, 0.8], [0.42, 0.8], [0.35, 1.2], [0.3, 1.2]], 1.15, 0.01), MAT.darkSteel); // windscreen frame
  k.add(profile([[0.36, 0.84], [0.4, 0.84], [0.335, 1.15], [0.31, 1.15]], 1.0, 0.004), MAT.glass);
  for (const s of [-1, 1]) k.add(profile([[-1.0, 0.8], [-0.4, 0.8], [-0.45, 0.9], [-0.95, 0.9]], 0.06, 0.01), dark, { pos: [s * 0.64, 0, 0] });
  // seats
  for (const s of [-1, 1]) {
    k.add(block(0.4, 0.12, 0.42, 0.05, 0.02), MAT.leather, { pos: [s * 0.3, 0.68, -0.25] });
    k.add(block(0.4, 0.42, 0.1, 0.05, 0.02), MAT.leather, { pos: [s * 0.3, 0.9, -0.5], rot: [-0.15, 0, 0] });
  }
  // rear boiler with stack, brass bands
  k.add(turnedY([[0, 0], [0.26, 0], [0.28, 0.04], [0.28, 0.62], [0.22, 0.7], [0, 0.72]], 20), MAT.copper, { pos: [0, 0.68, -0.95] });
  for (const y of [0.85, 1.1]) k.add(ring(0.285, 0.02, 20), MAT.brass, { pos: [0, y, -0.95], rot: [Math.PI / 2, 0, 0] });
  k.add(turnedY([[0, 0], [0.06, 0], [0.06, 0.5], [0.09, 0.55], [0.09, 0.62], [0, 0.62]], 12), MAT.darkSteel, { pos: [0.12, 1.35, -1.0] });
  k.add(pipe([[-0.2, 1.0, -0.75], [-0.3, 0.9, -0.4], [-0.3, 0.6, 0.1]], 0.025, 16, 6), MAT.brass);
  // headlamps and the hood gun
  for (const s of [-1, 1]) k.add(turned([[0, 0], [0.08, 0], [0.09, 0.08], [0, 0.09]], 12), MAT.brass, { pos: [s * 0.45, 0.82, 1.2] });
  for (const s of [-1, 1]) k.add(rod(0.022, 0, 0.75, 8), MAT.darkSteel, { pos: [s * 0.05, 0, 0] });
  // gun body sits on the hood (placed below)
  const gunK = new Kit();
  gunK.add(block(0.2, 0.14, 0.35, 0.03, 0.01), MAT.steel, { pos: [0, 0, 0] });
  for (const s of [-1, 1]) gunK.add(rod(0.018, 0.1, 0.65, 8), MAT.darkSteel, { pos: [s * 0.05, 0.02, 0] });
  gunK.add(turnedY([[0, -0.15], [0.035, -0.15], [0.035, 0], [0, 0]], 10), MAT.darkSteel);
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.add(k.build('jeep'));
  g.add(body);
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0.32, 0.96, 0.75);
  gunPivot.add(gunK.build('hoodgun'));
  body.add(gunPivot);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, 0.68); gunPivot.add(muzzle);
  const wheels = [];
  for (const [x, z] of [[-0.7, 0.85], [0.7, 0.85], [-0.7, -0.75], [0.7, -0.75]]) {
    const w = new THREE.Group();
    w.position.set(x, 0.32, z);
    const wk = new Kit();
    wk.add(wheel(), MAT.rubber, { rot: [0, Math.PI / 2, 0] });
    wk.add(turned([[0, -0.12], [0.14, -0.12], [0.14, 0.12], [0, 0.12]], 14), MAT.brass, { rot: [0, Math.PI / 2, 0] });
    for (let i = 0; i < 6; i++) wk.add(block(0.03, 0.2, 0.03, 0.008, 0.004), MAT.darkSteel, { pos: [Math.sign(x) * 0.12, 0, 0], rot: [(i / 6) * Math.PI, 0, 0] });
    const spin = wk.build('wheel');
    w.add(spin);
    w.userData.spin = spin;
    g.add(w);
    wheels.push(w);
  }
  const seat = new THREE.Object3D(); seat.position.set(-0.3, 0.8, -0.2); body.add(seat);
  return { group: g, body, gunPivot, muzzles: [muzzle], seat, wheels, stacks: [new THREE.Vector3(0.12, 1.98, -1.0)], seatPose: 'seat' };
}

function walkerModel(team) {
  const paint = paintMat(TEAMS[team].hull, 0.65, 0.35), dark = paintMat(TEAMS[team].hullDark, 0.75, 0.3);
  const cab = new Kit();
  // cockpit: a riveted egg, open at the top for the driver, brass collar
  cab.add(turnedY([[0, -0.5], [0.35, -0.48], [0.6, -0.3], [0.7, 0.0], [0.68, 0.2], [0.6, 0.32], [0.5, 0.36], [0.48, 0.3], [0.55, 0.15], [0.56, -0.05], [0.4, -0.3], [0, -0.32]], 28), paint);
  cab.add(ring(0.55, 0.035, 28), MAT.brass, { pos: [0, 0.34, 0], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; cab.add(bolt(0.022), MAT.darkSteel, { pos: [Math.sin(a) * 0.7, 0.02, Math.cos(a) * 0.7], rot: [Math.cos(a) * 1.4, 0, -Math.sin(a) * 1.4] }); }
  cab.add(ellipsoidGeo(0.32, 0.12, 0.08, 18, 10), MAT.glow, { pos: [0, 0.05, 0.64] }); // visor slit
  cab.add(turnedY([[0, 0], [0.09, 0], [0.09, 0.42], [0.12, 0.46], [0, 0.48]], 12), MAT.copper, { pos: [-0.35, 0.2, -0.45] });
  // hip housing
  cab.add(block(1.2, 0.3, 0.6, 0.1, 0.03), dark, { pos: [0, -0.5, -0.02] });
  // side cannons
  const guns = [];
  const gk = new Kit();
  gk.add(turned([[0, -0.25], [0.12, -0.25], [0.13, 0.0], [0.09, 0.05], [0.07, 0.75], [0.1, 0.8], [0.1, 0.9], [0, 0.9]], 16), MAT.steel);
  for (const z of [0.25, 0.42, 0.59]) gk.add(ring(0.095, 0.022, 16), MAT.glow, { pos: [0, 0, z] });
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.85;
  body.add(cab.build('cabin'));
  g.add(body);
  const aim = new THREE.Group();
  body.add(aim);
  const muzzles = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 0.86, -0.05, 0.1);
    piv.add(gk.build('cannon'));
    const m = new THREE.Object3D(); m.position.set(0, 0, 0.95); piv.add(m);
    aim.add(piv);
    guns.push(piv);
    muzzles.push(m);
    const arm = new Kit();
    arm.add(block(0.22, 0.16, 0.3, 0.04, 0.01), dark, { pos: [s * 0.72, -0.05, 0.05] });
    body.add(arm.build('mount'));
  }
  // legs: thigh plate, knee bending backward, piston shin, three-toed foot
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.5, 1.33, 0);
    g.add(hip);
    const tk = new Kit();
    tk.add(profile([[0.08, 0.05], [-0.08, 0.05], [-0.06, -0.78], [0.05, -0.78]], 0.2, 0.025), paint);
    tk.add(turned([[0, -0.13], [0.12, -0.13], [0.12, 0.13], [0, 0.13]], 18), MAT.brass, { rot: [0, Math.PI / 2, 0] });
    const thigh = tk.build('thigh');
    hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.8; thigh.add(knee);
    const sk = new Kit();
    sk.add(turned([[0, -0.1], [0.1, -0.1], [0.1, 0.1], [0, 0.1]], 16), MAT.darkSteel, { rot: [0, Math.PI / 2, 0] });
    sk.add(rod(0.045, 0, 0.85, 10), MAT.steel, { rot: [Math.PI / 2, 0, 0] });
    sk.add(turned([[0, 0.05], [0.075, 0.05], [0.075, 0.45], [0, 0.45]], 14), MAT.brass, { rot: [Math.PI / 2, 0, 0] });
    const shin = sk.build('shin');
    knee.add(shin);
    const ankle = new THREE.Group(); ankle.position.y = -0.85; shin.add(ankle);
    const fk = new Kit();
    fk.add(profile([[-0.22, -0.06], [0.3, -0.06], [0.34, -0.02], [0.1, 0.06], [-0.18, 0.05]], 0.3, 0.025), dark);
    for (const t of [-1, 1]) fk.add(profile([[0.15, -0.06], [0.42, -0.06], [0.4, -0.01], [0.15, 0.02]], 0.07, 0.015), dark, { pos: [t * 0.15, 0, 0], rot: [0, t * 0.35, 0] });
    fk.add(turned([[0, -0.08], [0.06, -0.08], [0.06, 0.08], [0, 0.08]], 12), MAT.brass, { rot: [0, Math.PI / 2, 0] });
    const foot = fk.build('foot');
    ankle.add(foot);
    legs.push({ hip, thigh, knee, shin, ankle, s, l1: 0.8, l2: 0.85 });
  }
  const seat = new THREE.Object3D(); seat.position.set(0, -0.12, -0.05); body.add(seat);
  return { group: g, body, aim, guns, muzzles, legs, seat, stacks: [], seatPose: 'hatch' };
}

function hoverModel(team) {
  const paint = paintMat(TEAMS[team].hull, 0.55, 0.4), dark = paintMat(TEAMS[team].hullDark, 0.7, 0.3);
  const k = new Kit();
  // boat-shaped hull: a flattened, pointed teardrop
  const hullGeo = new THREE.SphereGeometry(1, 28, 14);
  const p = hullGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nose = z > 0 ? 1 - 0.45 * z * z : 1;
    x *= 0.72 * nose;
    y = y > 0 ? y * 0.22 : y * 0.3;
    z *= 1.3;
    p.setXYZ(i, x, y, z);
  }
  hullGeo.computeVertexNormals();
  k.add(hullGeo, paint, { pos: [0, 0.35, 0] });
  k.add(ring(1.0, 0.035, 32), MAT.brass, { pos: [0, 0.35, -0.05], rot: [Math.PI / 2, 0, 0], scale: [0.7, 1.25, 1] });
  for (const s of [-1, 1]) {
    k.add(profile([[-1.2, 0.35], [-0.7, 0.35], [-1.05, 0.95], [-1.25, 0.95]], 0.06, 0.012), dark, { pos: [s * 0.45, 0, 0] }); // tail fins
    k.add(ring(0.24, 0.05, 20), MAT.glow, { pos: [s * 0.4, 0.06, -0.35], rot: [Math.PI / 2, 0, 0] }); // lift rings
    k.add(ring(0.24, 0.05, 20), MAT.glow, { pos: [s * 0.35, 0.06, 0.55], rot: [Math.PI / 2, 0, 0] });
  }
  k.add(profile([[0.3, 0.5], [0.42, 0.5], [0.3, 0.85], [0.22, 0.85]], 0.8, 0.004), MAT.glass); // screen
  k.add(block(0.5, 0.12, 0.5, 0.05, 0.02), MAT.leather, { pos: [0, 0.5, -0.25] });
  k.add(block(0.5, 0.35, 0.1, 0.05, 0.02), MAT.leather, { pos: [0, 0.7, -0.52], rot: [-0.2, 0, 0] });
  const gk = new Kit();
  gk.add(turned([[0, -0.2], [0.07, -0.2], [0.06, 0.6], [0.08, 0.65], [0, 0.7]], 14), MAT.steel);
  for (const z of [0.15, 0.3, 0.45]) gk.add(ring(0.065, 0.016, 14), MAT.glow, { pos: [0, 0, z] });
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.add(k.build('skiff'));
  g.add(body);
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 0.45, 0.95);
  gunPivot.add(gk.build('repeater'));
  body.add(gunPivot);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 0.72); gunPivot.add(muzzle);
  const seat = new THREE.Object3D(); seat.position.set(0, 0.62, -0.22); body.add(seat);
  const thrusters = [new THREE.Vector3(-0.4, 0.02, -0.35), new THREE.Vector3(0.4, 0.02, -0.35), new THREE.Vector3(-0.35, 0.02, 0.55), new THREE.Vector3(0.35, 0.02, 0.55)];
  return { group: g, body, gunPivot, muzzles: [muzzle], seat, thrusters, stacks: [], seatPose: 'seat' };
}

const BUILD = { tank: tankModel, jeep: jeepModel, walker: walkerModel, hover: hoverModel };

// ---------------- vehicle ----------------
export class Vehicle {
  constructor(world, type, team, pos, yaw = 0) {
    this.world = world;
    this.type = type;
    this.def = VEHICLES[type];
    this.isVehicle = true;
    this.paint = team;
    this.team = -1;
    this.m = BUILD[type](Math.max(0, team));
    this.group = this.m.group;
    this.group.userData.vehicle = this;
    this.group.traverse((o) => { o.userData.vehicle = this; });
    this.pos = pos.clone().setY(0);
    this.yaw = yaw;
    this.speed = 0;
    this.vel = V();
    this.vy = 0;
    this.yawRate = 0;
    this.hp = this.maxHp = this.def.hp;
    this.alive = true;
    this.dead = false;
    this.deadT = 0;
    this.driver = null;
    this.weapons = this.def.weapons.map((id) => ({ ...VW[id], id, cool: 0 }));
    this.wi = 0;
    this.turretYaw = 0;
    this.gunPitch = 0;
    this.aimYaw = yaw;
    this.aimPitch = 0;
    this.ctrl = { throttle: 0, steer: 0, fire: false, aimAt: null, strafe: 0 };
    this.t = Math.random() * 10;
    this.dist = 0;
    this.barrel = 0;
    this.alt = 0;
    this.engine = null;
    this.side = 0;
    this.update(0, world);
  }

  get weapon() { return this.weapons[this.wi]; }
  get seats() { return [{ unit: this.driver }]; }

  boxes() {
    const d = this.def, b = { x: this.pos.x, z: this.pos.z, yaw: this.yaw, hx: d.hx, hz: d.hz, h: d.h, y0: this.pos.y };
    if (this.type === 'walker') return [{ ...b, y0: this.pos.y + 1.2, h: 1.25 }, { ...b, hx: 0.75, hz: 0.35, y0: this.pos.y, h: 1.2 }];
    if (this.type === 'hover') return [{ ...b, y0: this.pos.y + this.alt, h: 0.75 }];
    return [b];
  }

  camFocus() { return this.pos.clone().add(new THREE.Vector3(0, this.def.cam.height - 0.62, 0)); }
  center() { return this.pos.clone().setY(this.pos.y + this.def.aimY); }

  enter(u, world) {
    if (this.driver || this.dead) return false;
    this.driver = u;
    u.vehicle = this;
    this.team = u.team;
    world.scene.remove(u.pea);
    u.pea.position.set(0, 0, 0);
    u.pea.rotation.set(0, 0, 0);
    this.m.seat.add(u.pea);
    if (u.model) u.model.visible = false;
    u.brain?.releaseCover();
    if (u.isPlayer && world.audio.ctx) { this.engine = world.audio.engine(this.type); }
    else if (world.audio.ctx && !this.engine) this.engine = world.audio.engine(this.type);
    return true;
  }

  eject(u, world) {
    if (this.driver !== u) return;
    this.driver = null;
    this.team = -1;
    this.m.seat.remove(u.pea);
    world.scene.add(u.pea);
    u.vehicle = null;
    // step out on the left, clear of the hull
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(-(this.def.hx + 0.7));
    u.pos.copy(this.pos).add(side).setY(0);
    u.pos.x = THREE.MathUtils.clamp(u.pos.x, -HALF + 0.5, HALF - 0.5);
    u.pos.z = THREE.MathUtils.clamp(u.pos.z, -HALF + 0.5, HALF - 0.5);
    u.vel.set(0, 0, 0);
    u.grounded = false;
    u.facing = this.yaw;
    if (u.model) u.model.visible = u.alive;
    if (this.engine) { this.engine.stop(); this.engine = null; }
  }

  dispose() { if (this.engine) { this.engine.stop(); this.engine = null; } }

  hurt(dmg, from, world) {
    if (this.dead || dmg <= 0) return;
    if (this.driver?.isPlayer && world.god) return;
    this.hp -= dmg;
    if (from && this.driver?.brain && from.team !== undefined && hostile(from.team, this.team)) this.lastAttacker = from.vehicle || from;
    if (from && (from === world.player || from === world.player?.vehicle)) world.onHitMarker?.(false);
    if (this.hp <= 0) this.destroy(from, world);
  }

  destroy(from, world) {
    this.dead = true;
    this.alive = false;
    this.hp = 0;
    const c = this.center();
    world.explode(c, 3.2, 90, from, 1);
    world.fx.debris(c, TEAMS[Math.max(0, this.paint)].hullDark, 20);
    const d = this.driver;
    if (d) {
      this.eject(d, world);
      if (!(d.isPlayer && world.god)) d.die(from, world);
    }
    this.team = -1;
    // char the paint
    const burnt = new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.95 });
    this.group.traverse((o) => { if (o.isMesh && o.material !== MAT.glass) o.material = burnt; });
    if (this.engine) { this.engine.stop(); this.engine = null; }
  }

  // ---- control ----
  // player: camera-relative aim; W/S throttle, A/D steer (the skiff strafes)
  drive(inp, aimPoint) {
    const c = this.ctrl;
    c.throttle = inp.move.y;
    c.steer = -inp.move.x;
    c.fire = inp.fire;
    c.aimAt = aimPoint;
  }

  update(dt, world) {
    this.t += dt;
    const d = this.def;
    if (this.dead) {
      this.deadT += dt;
      if (Math.random() < dt * 8) world.fx.smoke(this.center().add(new THREE.Vector3(rand(-0.4, 0.4), 0.4, rand(-0.4, 0.4))), new THREE.Vector3(0, 1.2, 0), 1.4, 1);
      if (this.deadT < 6 && Math.random() < dt * 10) world.fx.burn(this.center());
      this.physics(dt, world, 0, 0);
      this.pose(dt);
      return;
    }
    if (this.driver && !this.driver.alive) this.eject(this.driver, world);
    if (this.driver?.brain && !world.aiFrozen) this.think(dt, world);
    if (!this.driver) { this.ctrl.throttle = 0; this.ctrl.steer = 0; this.ctrl.fire = false; }
    const c = this.ctrl;
    if (world.aiFrozen && this.driver?.brain) { c.throttle = c.steer = 0; c.fire = false; }
    this.physics(dt, world, c.throttle, c.steer);
    this.aim(dt, c.aimAt);
    for (const w of this.weapons) w.cool -= dt;
    if (c.fire) this.fire(world);
    this.barrel = Math.max(0, this.barrel - dt * 3);
    if (this.engine) this.engine.set(Math.min(1, Math.abs(this.speed) / d.speed), this.pos);
    // steam from the stacks
    for (const s of this.m.stacks) if (Math.random() < dt * (3 + Math.abs(this.speed) * 3)) world.fx.steam(this.local(s), new THREE.Vector3(0, 1.1, 0), 1, 0.45);
    if (this.m.thrusters) for (const s of this.m.thrusters) if (Math.random() < dt * 6) world.fx.plasmaTrail(this.local(s));
    if (this.hp < this.maxHp * 0.35 && Math.random() < dt * 4) world.fx.smoke(this.center().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(0, 1, 0), 0.9, 1);
    this.pose(dt);
  }

  local(v) { return v.clone().applyMatrix4(this.group.matrixWorld); }

  physics(dt, world, throttle, steer) {
    const d = this.def;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const target = throttle >= 0 ? throttle * d.speed : throttle * d.rev;
    const acc = Math.abs(target) > Math.abs(this.speed) ? d.accel : d.accel * 1.6;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -acc * dt, acc * dt);
    if (this.dead) this.speed *= Math.exp(-3 * dt);
    let yawRate;
    if (this.type === 'jeep') yawRate = (this.speed / 1.6) * Math.tan(steer * d.turn) * (this.speed < 0 ? 1 : 1);
    else yawRate = steer * d.turn * (this.type === 'hover' ? 1 : 1);
    this.yawRate += (yawRate - this.yawRate) * (1 - Math.exp(-8 * dt));
    this.yaw = wrap(this.yaw + this.yawRate * dt);
    const prev = this.pos.clone();
    if (this.type === 'hover') {
      // drifts: velocity eases toward heading, so it slides through turns
      const want = fwd.clone().multiplyScalar(this.speed);
      this.vel.x += (want.x - this.vel.x) * (1 - Math.exp(-2.2 * dt));
      this.vel.z += (want.z - this.vel.z) * (1 - Math.exp(-2.2 * dt));
      this.pos.addScaledVector(this.vel, dt);
    } else this.pos.addScaledVector(fwd, this.speed * dt);
    // ground and the edge of the plate
    const onPlate = Math.abs(this.pos.x) < HALF && Math.abs(this.pos.z) < HALF;
    if (onPlate && this.pos.y >= -0.05) { this.pos.y = 0; this.vy = 0; } else {
      this.vy -= 17 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y < -14 && !this.dead) this.destroy(null, world);
    }
    if (this.pos.y < -0.05) return;
    // obstacles: props (heavy vehicles crush crates and drums), other vehicles
    const r = d.hx;
    const along = Math.max(0, d.hz - d.hx);
    let hit = false;
    for (const off of along > 0.1 ? [-along, 0, along] : [0]) {
      const p = this.pos.clone().addScaledVector(fwd, off);
      for (const pr of [...world.props]) {
        if (!pr.alive) continue;
        const before = p.clone();
        if (pushCircle(p, r, pr.box)) {
          if (d.heavy && (pr.type === 'crate' || pr.type === 'drum') && Math.abs(this.speed) > 0.8) { world.damageProp(pr, 400, this.driver); continue; }
          this.pos.add(p.clone().sub(before));
          hit = true;
        }
      }
    }
    for (const o of world.vehicles) {
      if (o === this) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, dd = Math.hypot(dx, dz), min = d.size + o.def.size - 0.3;
      if (dd < min && dd > 1e-4) { this.pos.x += (dx / dd) * (min - dd) * 0.5; this.pos.z += (dz / dd) * (min - dd) * 0.5; hit = true; }
    }
    if (hit) { this.speed *= Math.exp(-6 * dt); if (this.type === 'hover') this.vel.multiplyScalar(Math.exp(-6 * dt)); }
    const moved = this.pos.distanceTo(prev);
    this.dist += moved * Math.sign(this.speed || 1);
    // peas in the way: pushed aside, hurt if it's going fast
    const v = moved / Math.max(dt, 1e-4);
    for (const u of world.units) {
      if (!u.alive || u.vehicle || u.pos.y > this.pos.y + d.h) continue;
      const [lx, lz] = toLocal(this.boxes()[0], u.pos.x, u.pos.z);
      if (Math.abs(lx) < d.hx + 0.3 && Math.abs(lz) < d.hz + 0.3) {
        if (v > 2.5 && hostile(u.team, this.team) && this.type !== 'hover') world.damageUnit(u, v * 9 * dt * 10, this.driver, 'crush');
        const push = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(Math.sign(lx || 1));
        u.pos.addScaledVector(push, Math.min(0.2, (d.hx + 0.3 - Math.abs(lx))));
        if (v > 2.5) u.impulse(push.multiplyScalar(2).add(new THREE.Vector3(0, 1.5, 0)));
      }
    }
  }

  aim(dt, at) {
    if (!at) return;
    const m = this.m;
    const pivot = this.type === 'walker' ? this.pos.clone().setY(this.pos.y + 1.8) : this.pos.clone().setY(this.pos.y + this.def.aimY);
    const yaw = Math.atan2(at.x - pivot.x, at.z - pivot.z);
    const pitch = Math.atan2(at.y - pivot.y, Math.hypot(at.x - pivot.x, at.z - pivot.z));
    const rate = this.type === 'tank' ? 1.4 : 3;
    const rel = wrap(yaw - this.yaw);
    const lim = this.type === 'tank' ? Math.PI : this.type === 'walker' ? 0.9 : 0.5;
    const goal = THREE.MathUtils.clamp(rel, -lim, lim);
    const dy = wrap(goal - this.turretYaw);
    this.turretYaw += Math.sign(dy) * Math.min(Math.abs(dy), rate * dt);
    this.gunPitch += THREE.MathUtils.clamp(THREE.MathUtils.clamp(pitch, -0.25, 0.45) - this.gunPitch, -rate * dt, rate * dt);
    this.aimYaw = this.yaw + this.turretYaw;
    this.aimPitch = this.gunPitch;
  }

  aimError(at) {
    const pivot = this.pos.clone().setY(this.pos.y + this.def.aimY);
    return Math.abs(wrap(Math.atan2(at.x - pivot.x, at.z - pivot.z) - this.aimYaw));
  }

  fire(world) {
    const w = this.weapon;
    if (w.cool > 0) return;
    w.cool = w.interval;
    this.group.updateMatrixWorld(true);
    let mz = this.m.muzzles[this.type === 'tank' ? this.wi : 0];
    if (this.type === 'walker') { this.side = 1 - this.side; mz = this.m.muzzles[this.side]; }
    const from = mz.getWorldPosition(V());
    const dir = new THREE.Vector3(0, 0, 1).transformDirection(mz.matrixWorld).normalize();
    const fake = { team: this.team, vehicle: this, pos: this.pos, kills: 0 };
    const shooter = this.driver || fake;
    if (w.kind === 'hitscan') {
      const d = world.spread(dir, w.spread);
      world.hitscan(shooter, from, d, { ...w, id: 'mg' });
      world.fx.muzzle(from, d, 1);
    } else if (w.kind === 'shell') {
      world.launch(w.proj, from, dir.clone().multiplyScalar(w.speed), shooter, { ...w, gravity: w.gravity });
      world.fx.muzzle(from, dir, 3);
      for (let i = 0; i < 5; i++) world.fx.smoke(from.clone().addScaledVector(dir, i * 0.2), dir.clone().multiplyScalar(1.5).add(new THREE.Vector3(0, 0.3, 0)), 1.2, 1);
      this.barrel = 1;
      world.events.push({ type: 'boom', pos: from, r: 0.8 });
    } else if (w.kind === 'plasma') {
      world.launch('plasma', from, dir.clone().multiplyScalar(w.speed), shooter, { ...w, gravity: 0 });
      world.fx.plasmaBurst(from, 0.5);
    }
    world.audio.play(w.sound, from, this.driver?.isPlayer ? 0.8 : 1);
    world.heard(this.driver || fake, from);
  }

  cycleWeapon() { this.wi = (this.wi + 1) % this.weapons.length; }

  // ---- AI driver ----
  think(dt, world) {
    const c = this.ctrl;
    this.thinkT = (this.thinkT || 0) - dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.4;
      let best = null, bd = Infinity;
      const eye = this.center().setY(this.pos.y + this.def.aimY + 0.3);
      for (const e of world.targets(this.team)) {
        const p = e.isVehicle ? e.center() : e.center();
        const dd = p.distanceTo(eye);
        if (dd > 50) continue;
        if (!world.los(eye, p, e)) continue;
        const s = dd - (e.isVehicle ? 8 : 0) - (e === this.target ? 5 : 0);
        if (s < bd) { bd = s; best = e; }
      }
      if (!best && this.lastAttacker && !this.lastAttacker.dead && this.lastAttacker.alive !== false) best = this.lastAttacker;
      this.target = best;
      const order = this.team === 0 ? world.order : 'attack';
      const ref = best || world.nearestHostile(this.team, this.pos);
      let goal;
      if (order === 'follow' && this.team === 0 && world.player?.alive && !best) {
        const p = world.player.pos;
        goal = p.distanceTo(this.pos) > 7 ? p.clone() : this.pos.clone();
      } else if (order === 'hold' && this.team === 0) goal = this.holdPos || this.pos.clone();
      else if (ref) {
        const to = V().subVectors(this.pos, ref.pos).setY(0);
        const dist = to.length();
        to.normalize();
        const R = this.def.range;
        if (this.type === 'jeep' || this.type === 'hover') {
          // circle the target at range
          this.orbit = this.orbit ?? (Math.random() < 0.5 ? 1 : -1);
          const tang = new THREE.Vector3(to.z, 0, -to.x).multiplyScalar(this.orbit);
          goal = ref.pos.clone().addScaledVector(to, R).addScaledVector(tang, 6);
        } else goal = dist > R + 3 ? ref.pos.clone().addScaledVector(to, R) : dist < R - 5 ? this.pos.clone().addScaledVector(to, 4) : this.pos.clone();
      } else goal = this.pos.clone();
      goal.x = THREE.MathUtils.clamp(goal.x, -HALF + 3, HALF - 3);
      goal.z = THREE.MathUtils.clamp(goal.z, -HALF + 3, HALF - 3);
      this.goal = world.ai.pathAround(this.pos, goal) ?? goal;
      this.finalGoal = goal;
    }
    const goal = this.goal || this.pos;
    const to = V().subVectors(goal, this.pos).setY(0);
    const dist = to.length();
    const rel = wrap(Math.atan2(to.x, to.z) - this.yaw);
    if (dist > 1.5) {
      const backward = Math.abs(rel) > 2.3 && dist < 6 && this.type !== 'hover';
      c.throttle = backward ? -0.7 : Math.abs(rel) > 1.2 && this.type !== 'jeep' ? 0.15 : Math.min(1, dist / 4);
      const r2 = backward ? wrap(rel + Math.PI) : rel;
      c.steer = THREE.MathUtils.clamp(r2 * 1.6, -1, 1) * (backward ? -1 : 1);
    } else { c.throttle = 0; c.steer = 0; }
    // weapons
    const T = this.target;
    c.fire = false;
    if (T && (T.alive !== false) && !T.dead) {
      const tp = T.isVehicle ? T.center() : T.center();
      const dd = tp.distanceTo(this.pos);
      if (T.vel && !T.isVehicle) tp.addScaledVector(T.vel, dd / 40);
      if (T.isVehicle && T.vel) tp.addScaledVector(T.vel, dd / 50);
      c.aimAt = tp;
      // tanks use the cannon on vehicles and groups, the MG on lone peas
      if (this.type === 'tank') this.wi = T.isVehicle || dd > 12 ? 0 : 1;
      if (this.aimError(tp) < (this.type === 'tank' ? 0.05 : 0.12) && !world.friendlyInLine(this.driver, this.center(), tp)) c.fire = true;
    } else c.aimAt = this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 10, this.def.aimY, Math.cos(this.yaw) * 10));
  }

  // ---- animation ----
  pose(dt) {
    const m = this.m, g = this.group;
    g.position.copy(this.pos);
    g.rotation.set(0, this.yaw, 0);
    if (this.type === 'tank') {
      m.turret.rotation.y = this.turretYaw;
      m.gunPivot.rotation.x = -this.gunPitch;
      m.gun.position.z = -0.25 * this.barrel;
      g.rotation.x = -0.03 * THREE.MathUtils.clamp(this.speed / this.def.speed, -1, 1) + 0.04 * this.barrel * Math.cos(this.turretYaw);
    } else if (this.type === 'jeep') {
      m.gunPivot.rotation.set(-this.gunPitch, this.turretYaw, 0);
      const spin = this.dist / 0.32;
      m.wheels.forEach((w, i) => { w.userData.spin.rotation.x = spin; if (i < 2) w.rotation.y = this.ctrl.steer * this.def.turn; });
      m.body.rotation.z = -THREE.MathUtils.clamp(this.yawRate * this.speed * 0.02, -0.08, 0.08);
      m.body.position.y = 0.02 * Math.sin(this.t * 30) * Math.min(1, Math.abs(this.speed) / 3);
    } else if (this.type === 'hover') {
      this.alt = 0.45 + 0.05 * Math.sin(this.t * 2.2);
      m.body.position.y = this.dead ? 0.05 : this.alt;
      m.body.rotation.z = this.dead ? 0.1 : -THREE.MathUtils.clamp(this.yawRate * 0.15, -0.3, 0.3);
      m.body.rotation.x = this.dead ? 0 : -THREE.MathUtils.clamp(this.speed * 0.012, -0.08, 0.1);
      m.gunPivot.rotation.set(-this.gunPitch, this.turretYaw, 0);
    } else if (this.type === 'walker') this.walk(dt);
    if (this.driver) {
      const st = this.m.seatPose === 'seat' ? { seat: 1, t: this.t } : { t: this.t, kneel: 0.3 };
      this.driver.pea.userData.pose(st);
    }
  }

  walk(dt) {
    const m = this.m;
    const stride = 0.9;
    const turnStep = Math.abs(this.yawRate) * 0.5 * dt;
    this.phase = ((this.phase || 0) + (this.dist - (this.lastDist || 0)) / (stride * 2) + turnStep / stride) % 1;
    this.lastDist = this.dist;
    const moving = Math.min(1, (Math.abs(this.speed) + Math.abs(this.yawRate)) / 1.2);
    this.moveK = (this.moveK || 0) + (moving - (this.moveK || 0)) * (1 - Math.exp(-6 * dt));
    const k = this.dead ? 0 : this.moveK;
    let bob = 0;
    m.legs.forEach((L, i) => {
      const q = (this.phase + (i ? 0.5 : 0) + 1) % 1;
      let z, lift;
      if (q < 0.5) { const s = q / 0.5; z = stride / 2 - stride * s; lift = 0; } else { const s = (q - 0.5) / 0.5; z = -stride / 2 + stride * (0.5 - 0.5 * Math.cos(Math.PI * s)); lift = 0.28 * Math.sin(Math.PI * s); }
      z *= k * Math.sign(this.speed || 1); lift *= k;
      bob += lift;
      // two-bone IK in the leg's side plane, knee pointing back
      const hipY = 1.33 - 0.06 * k;
      const ty = -(hipY - 0.1 - lift), tz = z;
      const dd = Math.min(L.l1 + L.l2 - 0.001, Math.hypot(ty, tz));
      const base = Math.atan2(tz, -ty);
      const a = Math.acos(THREE.MathUtils.clamp((L.l1 ** 2 + dd * dd - L.l2 ** 2) / (2 * L.l1 * dd), -1, 1));
      const th1 = base - a; // knee goes backward
      const ky = -L.l1 * Math.cos(th1), kz = L.l1 * Math.sin(th1);
      const th2 = Math.atan2(tz - kz, -(ty - ky));
      L.hip.position.y = hipY;
      L.thigh.rotation.x = -th1;
      L.knee.rotation.x = -(th2 - th1);
      L.ankle.rotation.x = th2;
    });
    m.body.position.y = 1.85 - 0.06 * k + 0.04 * Math.sin(this.phase * Math.PI * 4) * k - (this.dead ? 0.5 : 0);
    m.body.rotation.z = 0.04 * Math.sin(this.phase * Math.PI * 2) * k + (this.dead ? 0.2 : 0);
    m.aim.rotation.set(-this.gunPitch, this.turretYaw, 0);
    m.guns.forEach((gp, i) => { gp.position.z = 0.1 - (this.side === i ? 0.12 * Math.max(0, this.weapon.cool / this.weapon.interval) : 0); });
    if (Math.random() < dt * 2 && k > 0.3) this.world.fx.dust(this.pos.clone().setY(0.05), 1, 0.6);
  }
}

// AI infantry hop into empty vehicles nearby; the player uses E / the use button.
export function nearestEnterable(world, u, r = 2.6) {
  let best = null, bd = Infinity;
  for (const v of world.vehicles) {
    if (v.dead || v.driver || v.pos.y < -0.5) continue;
    const d = v.pos.distanceTo(u.pos) - v.def.size;
    if (d < r && d < bd) { bd = d; best = v; }
  }
  return best;
}

export function spawnVehicle(world, type, team, pos, yaw = 0, crewed = false) {
  const v = world.addVehicle(new Vehicle(world, type, team, pos, yaw));
  if (crewed && team >= 0) {
    const u = world.spawnUnit(team, 'rifleman', pos.clone(), {});
    v.enter(u, world);
  }
  return v;
}

export { projectileModel };
