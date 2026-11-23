import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAT, profile, roundRect, turned, turnedY, rod, ring, bolt, pipe, block } from './models.js';
import { ellipsoid } from './geo.js';
import { TEAMS } from './factions.js';
import { height } from './terrain.js';
import { pushCircle } from './physics.js';
import { HALF } from './world.js';

// Vehicles: heavy, believable machines for the big field. Each is one body on the ground with
// a hull box for hits and collisions, a turret and gun that turn on their own, and seats for
// crew. Drawn with a few merged, vertex-coloured meshes so a tank costs about six draw calls.
// World yaw convention matches soldiers: forward is (sin yaw, cos yaw).

export const VEHICLES = {
  tank: {
    name: 'Iron Wagon', drive: 'tracked', seats: 1,
    hx: 1.3, hz: 2.55, h: 1.75, // hull box half-widths and height
    hp: 560, armor: { bullet: 0.035, blast: 0.5, plasma: 0.6, flame: 0.1 },
    maxSpeed: 7.2, maxRev: 3.2, accel: 3.4, brake: 9, turn: 1.15, maxSlope: 0.62,
    hint: 'WASD drive · click fires the cannon · right-click MG · X leaves',
  mass: 30, camDist: 9.5, camHeight: 2.6, camUp: 4.4, camSide: 1.5, cockpit: [0, 2.0, 0.1], cockpitKind: 'tank', steamAt: [0.5, 2.1, -1.9], step: 0.28, crush: true, runover: 400,
    turret: { rate: 1.25, pitchRate: 0.8, pitchMin: -0.14, pitchMax: 0.42, pivot: [0, 1.08, -0.15] },
    weapons: [
      { id: 'cannon', name: 'Tank gun', ai: 'heavy', kind: 'projectile', proj: 'shell', damage: 230, radius: 3.8, speed: 78, gravity: 3, interval: 2.3, spread: 0.004, sound: 'cannon', mag: 1, reserve: Infinity, range: 220, burst: [1, 1], vehicleGun: true },
      { id: 'coax', name: 'Coaxial MG', ai: 'light', kind: 'hitscan', damage: 17, interval: 0.09, spread: 0.018, sound: 'mg', mag: Infinity, reserve: Infinity, range: 90, tracer: '#ffc070', burst: [6, 12], vehicleGun: true },
    ],
  },
};

VEHICLES.jeep = {
  name: 'Scout Car', drive: 'wheeled', seats: 2,
  hx: 1.0, hz: 1.95, h: 1.45,
  hp: 240, armor: { bullet: 0.45, blast: 1.0, plasma: 1.0, flame: 0.3 },
  maxSpeed: 16, maxRev: 5.5, accel: 7, brake: 12, turn: 1.7, maxSlope: 0.85,
  mass: 4, camDist: 7.2, camHeight: 2.1, camUp: 3.1, camSide: 0.9, cockpit: [-0.4, 1.5, -0.2], cockpitKind: 'jeep', steamAt: [0.55, 1.45, -1.75], step: 0.25, crush: false, runover: 160,
  hint: 'WASD drive · click fires the MG · X leaves',
  turret: { rate: 3.4, pitchRate: 2.4, pitchMin: -0.3, pitchMax: 0.6, pivot: [0, 1.25, -0.75] },
  weapons: [
    { id: 'pintle', name: 'Pintle MG', ai: 'light', kind: 'hitscan', damage: 15, interval: 0.075, spread: 0.028, sound: 'mg', mag: Infinity, reserve: Infinity, range: 75, tracer: '#ffc070', burst: [6, 12], vehicleGun: true },
  ],
};

VEHICLES.hover = {
  name: 'Steam Skiff', drive: 'hover', seats: 1,
  hx: 0.95, hz: 1.9, h: 1.15, hoverH: 1.0,
  hp: 150, armor: { bullet: 0.55, blast: 1.2, plasma: 0.8, flame: 0.4 },
  maxSpeed: 21, maxRev: 6, accel: 9, brake: 8, turn: 2.1, maxSlope: 1.5,
  mass: 1, camDist: 7.4, camHeight: 1.9, camUp: 2.7, camSide: 0.8, cockpit: [0, 1.3, -0.1], cockpitKind: 'hover', steamAt: [0, 1.15, -1.55], step: 1.1, crush: false, runover: 0,
  hint: 'WASD fly low · click fires the coil guns · Space brakes · X leaves',
  turret: { rate: 3.2, pitchRate: 2.2, pitchMin: -0.3, pitchMax: 0.45, yawLimit: 0.55, pivot: [0, 0.42, 1.2] },
  weapons: [
    { id: 'coil', name: 'Coil guns', ai: 'light', kind: 'projectile', proj: 'plasma', alt: true, damage: 26, splash: 10, radius: 1.2, speed: 58, gravity: 0, interval: 0.2, spread: 0.012, sound: 'plasma', mag: Infinity, reserve: Infinity, range: 85, pierce: 0.7, burst: [3, 6], vehicleGun: true },
  ],
};

VEHICLES.walker = {
  name: 'Strider', drive: 'legged', seats: 1,
  hx: 1.5, hz: 1.5, h: 2.3, lift: 2.5, eyeH: 4.6, // hit box starts above the legs
  hp: 700, armor: { bullet: 0.07, blast: 0.55, plasma: 0.6, flame: 0.15 },
  maxSpeed: 6.2, maxRev: 2.6, accel: 2.8, brake: 7, turn: 1.0, maxSlope: 0.95, tilt: 0.3,
  mass: 40, camDist: 12, camHeight: 5.2, camUp: 7.8, camSide: 1.6, cockpit: [0, 4.7, 0.2], cockpitKind: 'walker', steamAt: [-0.5, 4.3, -1.3], step: 1.3, crush: true, crushH: 2.2, runover: 0,
  hint: 'WASD walk · click shoots · right-click mortar · X leaves',
  turret: { rate: 1.5, pitchRate: 1.2, pitchMin: -0.45, pitchMax: 0.5, pivot: [0, 4.35, 0] },
  weapons: [
    { id: 'autocannon', name: 'Autocannon', ai: 'light', kind: 'hitscan', damage: 30, interval: 0.12, spread: 0.022, sound: 'mg', mag: Infinity, reserve: Infinity, range: 110, tracer: '#ffc070', burst: [8, 14], vehicleGun: true },
    { id: 'mortar', name: 'Steam mortar', ai: 'heavy', kind: 'projectile', proj: 'shell', lob: 1.05, damage: 170, radius: 5.2, speed: 40, gravity: 16, interval: 3.4, spread: 0.02, sound: 'cannon', mag: Infinity, reserve: Infinity, range: 150, minRange: 22, burst: [1, 1], vehicleGun: true },
  ],
};

const C = {
  steel: '#3b3e3d', dark: '#26292a', iron: '#4a4a45', brass: '#9c7a3c', copper: '#8a5236', rubber: '#1d1d1c',
  canvas: '#7d7559', wood: '#6a4a2f',
};

// ---- vertex-coloured kit: every part is merged into one geometry
class CKit {
  constructor() { this.list = []; }
  add(geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...(Array.isArray(scale) ? scale : [scale, scale, scale])),
    ));
    const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.list.push(g);
    return this;
  }
  bake() { return this.list.length ? mergeGeometries(this.list, false) : new THREE.BufferGeometry(); }
}

const BODY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.3 });
const WRECK = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#3c3835', roughness: 0.95, metalness: 0.1 });
const cyl = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg);

// ---------------- the tank ----------------
const TRACK = { z0: -2.5, z1: 2.5, h: 0.85, w: 0.5, x: 1.0 };
const WHEELS = (() => {
  const out = [];
  for (let i = 0; i < 6; i++) out.push({ z: -1.9 + i * 0.7, y: 0.34, r: 0.3 });
  out.push({ z: 2.12, y: 0.52, r: 0.36 }, { z: -2.12, y: 0.52, r: 0.36 });
  return out;
})();
// the track belt: a stadium loop in (z, y)
const LOOP_R = TRACK.h / 2;
const LOOP = { straight: TRACK.z1 - TRACK.z0 - 2 * LOOP_R, len: 0 };
LOOP.len = 2 * LOOP.straight + 2 * Math.PI * LOOP_R;
// position on the belt for arc length s; returns [z, y, angle of the surface]
function beltAt(s, out) {
  s = ((s % LOOP.len) + LOOP.len) % LOOP.len;
  const S = LOOP.straight, R = LOOP_R, arc = Math.PI * R;
  const zc0 = TRACK.z0 + R, zc1 = TRACK.z1 - R, yc = R;
  if (s < S) { out[0] = zc0 + s; out[1] = TRACK.h; out[2] = 0; return out; } // top, moving forward
  s -= S;
  if (s < arc) { const a = s / R; out[0] = zc1 + Math.sin(a) * R; out[1] = yc + Math.cos(a) * R; out[2] = -a; return out; }
  s -= arc;
  if (s < S) { out[0] = zc1 - s; out[1] = 0; out[2] = -Math.PI; return out; }
  s -= S;
  const a = s / R;
  out[0] = zc0 - Math.sin(a) * R; out[1] = yc - Math.cos(a) * R; out[2] = -Math.PI - a;
  return out;
}

function tankParts(team) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = T.body, trim = T.trim;
  const hull = new CKit(), turret = new CKit(), barrel = new CKit(), glowH = [], glowB = [];

  // lower hull and sloped nose
  hull.add(profile([[-2.4, 0.3], [2.5, 0.3], [2.62, 0.52], [1.95, 1.0], [1.1, 1.08], [-1.9, 1.08], [-2.45, 0.85]], 1.9, 0.05, 2), paint);
  hull.add(profile([[-2.3, 0.28], [2.4, 0.28], [2.4, 0.4], [-2.3, 0.4]], 1.96, 0.02), C.dark); // belly plate
  // engine deck: grille, louvres and the boiler stack
  hull.add(block(1.5, 0.12, 1.25, 0.03, 0.015), C.dark, { pos: [0, 1.14, -1.55] });
  for (let i = 0; i < 5; i++) hull.add(block(1.4, 0.05, 0.08, 0.01, 0.006), C.iron, { pos: [0, 1.22, -2.05 + i * 0.22] });
  hull.add(turnedY([[0, 0], [0.34, 0], [0.36, 0.04], [0.36, 0.62], [0.3, 0.7], [0, 0.72]], 18), C.brass, { pos: [0.5, 1.2, -1.9] });
  for (const y of [0.18, 0.48]) hull.add(ring(0.362, 0.025, 18), C.copper, { pos: [0.5, 1.2 + y, -1.9], rot: [Math.PI / 2, 0, 0] });
  hull.add(pipe([[0.5, 1.9, -1.9], [0.5, 2.15, -1.9], [0.5, 2.35, -1.92]], 0.085, 8, 8), C.iron);
  hull.add(turnedY([[0.07, 0], [0.13, 0], [0.13, 0.08], [0.07, 0.08]], 12), C.dark, { pos: [0.5, 2.3, -1.92] });
  // exhaust pipes along the fenders
  for (const s of [-1, 1]) hull.add(pipe([[s * 0.98, 1.0, -2.4], [s * 1.06, 1.0, -1.6], [s * 1.06, 1.0, -0.8]], 0.06, 10, 8), C.copper);
  // fenders, mud guards, tow hooks and tools
  for (const s of [-1, 1]) {
    hull.add(block(0.66, 0.06, 4.9, 0.02, 0.012), paint, { pos: [s * 1.0, 0.93, 0] });
    hull.add(block(0.66, 0.06, 0.8, 0.02, 0.012), paint, { pos: [s * 1.0, 0.8, 2.75], rot: [0.5, 0, 0] });
    hull.add(block(0.05, 0.2, 4.9, 0.01, 0.008), C.steel, { pos: [s * 1.31, 0.82, 0] }); // outer rail
  }
  hull.add(block(0.16, 0.3, 0.1, 0.02, 0.01), C.steel, { pos: [-0.5, 0.55, 2.62] });
  hull.add(block(0.16, 0.3, 0.1, 0.02, 0.01), C.steel, { pos: [0.5, 0.55, 2.62] });
  // rolled tarp and a crate strapped on the engine deck, tool bar on the left fender
  hull.add(cyl(0.16, 1.1, 10), C.canvas, { pos: [-0.5, 1.33, -1.55], rot: [0, 0, Math.PI / 2] });
  hull.add(block(0.4, 0.25, 0.5, 0.02, 0.01), C.wood, { pos: [-0.5, 1.32, -2.05] });
  // driver's hatch and vision slit in the glacis
  hull.add(block(0.5, 0.06, 0.38, 0.02, 0.01), C.dark, { pos: [-0.45, 1.1, 1.45], rot: [-0.25, 0, 0] });
  hull.add(block(0.3, 0.05, 0.03, 0.01, 0.006), C.dark, { pos: [-0.45, 0.93, 2.16], rot: [-0.9, 0, 0] });
  // tracks: belt body, rivets
  for (const s of [-1, 1]) {
    hull.add(profile(roundRect(TRACK.z0 + 0.05, 0.02, TRACK.z1 - 0.05, TRACK.h - 0.04, LOOP_R - 0.04), TRACK.w - 0.06, 0.02, 2), C.rubber, { pos: [s * TRACK.x, 0, 0] });
  }
  // glowing engine vents at the back and cold-teal lamps on the nose
  for (const s of [-1, 1]) glowH.push([block(0.42, 0.06, 0.04, 0.01, 0.004), [s * 0.5, 0.7, -2.5]]);
  for (const s of [-1, 1]) glowH.push([bolt(0.07), [s * 0.8, 1.0, 2.08], [-0.7, 0, 0]]);

  // turret
  turret.add(turnedY([[0, 0], [1.0, 0], [1.02, 0.04], [1.02, 0.2], [0, 0.2]], 24), C.dark);
  turret.add(ellipsoid(0.98, 0.4, 1.22, 20, 12, (v) => { if (v.y < 0) v.y *= 0.2; }), paint, { pos: [0, 0.22, 0] });
  turret.add(block(0.9, 0.46, 0.34, 0.06, 0.03), paint, { pos: [0, 0.32, 1.12] }); // gun mantlet
  turret.add(block(1.4, 0.3, 0.55, 0.04, 0.02), trim, { pos: [0, 0.3, -1.22] }); // stowage bin
  turret.add(block(0.08, 0.34, 0.5, 0.01, 0.006), C.steel, { pos: [-0.5, 0.3, -1.22] });
  turret.add(block(0.08, 0.34, 0.5, 0.01, 0.006), C.steel, { pos: [0.5, 0.3, -1.22] });
  // cupola, hatch and the little commander's gun
  turret.add(turnedY([[0.3, 0], [0.32, 0.04], [0.32, 0.2], [0.27, 0.24], [0.27, 0.27], [0, 0.27]], 14), C.dark, { pos: [0.38, 0.5, -0.3] });
  turret.add(block(0.36, 0.05, 0.36, 0.04, 0.01), C.steel, { pos: [0.38, 0.8, -0.3], rot: [0.0, 0.4, 0.0] });
  turret.add(rod(0.025, 0, 0.6, 8), C.dark, { pos: [0.38, 0.86, -0.05] });
  for (const a of [0.8, 2.2, 3.6, 5.0]) turret.add(block(0.14, 0.04, 0.03, 0.005, 0.003), C.dark, { pos: [0.38 + Math.cos(a) * 0.3, 0.64, -0.3 + Math.sin(a) * 0.3], rot: [0, -a, 0] });
  // smoke dischargers, aerial, trim stripe on the roof
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) turret.add(rod(0.04, 0, 0.22, 8), C.iron, { pos: [s * 0.98, 0.46, 0.4 + i * 0.14 - 0.3], rot: [-0.6, s * 0.5, 0] });
  turret.add(pipe([[-0.7, 0.55, -0.7], [-0.72, 1.3, -0.74], [-0.66, 2.0, -0.7]], 0.012, 6, 5), C.dark);
  turret.add(block(0.5, 0.04, 0.25, 0.01, 0.005), trim, { pos: [-0.3, 0.64, 0.45], rot: [-0.07, 0, 0] });
  // rivets round the turret ring
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; turret.add(new THREE.SphereGeometry(0.03, 6, 4), C.steel, { pos: [Math.sin(a) * 1.02, 0.2, Math.cos(a) * 1.02] }); }

  // gun: barrel pivots at the mantlet (z = 0), muzzle at z = 3
  barrel.add(rod(0.075, 0.0, 2.95, 12), C.steel);
  barrel.add(turned([[0.12, 0.06], [0.13, 0.12], [0.13, 0.7], [0.12, 0.76]], 14), C.dark); // recoil sleeve
  barrel.add(turned([[0.095, 1.35], [0.115, 1.4], [0.115, 1.85], [0.095, 1.9]], 14), C.iron); // bore evacuator
  barrel.add(turned([[0.0001, 2.78], [0.115, 2.78], [0.115, 3.05], [0.07, 3.05]], 12), C.dark); // muzzle brake
  for (let i = 0; i < 3; i++) barrel.add(block(0.26, 0.04, 0.03, 0.005, 0.003), C.steel, { pos: [0, 0, 2.84 + i * 0.07] });
  barrel.add(block(0.14, 0.16, 0.5, 0.02, 0.01), C.steel, { pos: [0.28, -0.05, 0.4] }); // coax housing
  barrel.add(rod(0.025, 0.5, 1.0, 8), C.dark, { pos: [0.28, -0.05, 0] });
  for (const z of [0.95, 1.12]) glowB.push([ring(0.1, 0.014, 16), [0, 0, z]]);
  return { hull, turret, barrel, glowH, glowB };
}

const modelCache = new Map();
// wheel and cleat meshes are shared
let wheelGeo = null, cleatGeo = null;
function sharedGeo() {
  if (wheelGeo) return;
  const w = new CKit();
  w.add(cyl(1, 0.1, 18), C.dark, { rot: [0, 0, Math.PI / 2] });
  w.add(cyl(0.45, 0.14, 12), C.brass, { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; w.add(bolt(0.07), C.steel, { pos: [0.075, Math.sin(a) * 0.68, Math.cos(a) * 0.68], rot: [0, 0, -Math.PI / 2] }); }
  wheelGeo = w.bake();
  const c = new CKit();
  c.add(block(TRACK.w + 0.03, 0.08, 0.17, 0.02, 0.01), C.iron);
  cleatGeo = c.bake();
}

export function buildTankModel(team) {
  sharedGeo();
  const key = `tank${team}`;
  if (!modelCache.has(key)) {
    const p = tankParts(team);
    const glow = (list) => { const k = new CKit(); for (const [g, pos, rot] of list) k.add(g, '#6ff2e2', { pos, rot }); return k.bake(); };
    modelCache.set(key, { hull: p.hull.bake(), turret: p.turret.bake(), barrel: p.barrel.bake(), glowH: glow(p.glowH), glowB: glow(p.glowB) });
  }
  const m = modelCache.get(key);
  const def = VEHICLES.tank;
  const root = new THREE.Group();
  root.name = 'vehicle-tank';
  const mesh = (g, mat = BODY, shadow = true) => { const o = new THREE.Mesh(g, mat); o.castShadow = shadow; o.receiveShadow = true; return o; };
  const hull = mesh(m.hull);
  const glowMat = MAT.glow;
  const hullGlow = mesh(m.glowH, glowMat, false);
  const turretPivot = new THREE.Group();
  turretPivot.position.set(...def.turret.pivot);
  const turret = mesh(m.turret);
  const gun = new THREE.Group();
  gun.position.set(0, 0.32, 1.28);
  const barrel = mesh(m.barrel);
  const gunGlow = mesh(m.glowB, glowMat, false);
  gun.add(barrel, gunGlow);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 3.08);
  const coax = new THREE.Object3D(); coax.position.set(0.28, -0.05, 1.05);
  gun.add(muzzle, coax);
  turretPivot.add(turret, gun);
  // wheels and track cleats are instanced and animated from the track phase
  const wheels = new THREE.InstancedMesh(wheelGeo, BODY, WHEELS.length * 2);
  const cleats = new THREE.InstancedMesh(cleatGeo, BODY, 2 * 46);
  wheels.castShadow = cleats.castShadow = true;
  wheels.frustumCulled = cleats.frustumCulled = false;
  root.add(hull, hullGlow, turretPivot, wheels, cleats);
  const parts = { root, turretPivot, gun, gunZ: 1.28, recoilK: 0.4, muzzles: [muzzle, coax], meshes: [hull, turret, barrel, wheels, cleats] };
  parts.animate = (v) => animateTracks({ wheels, cleats }, v.trackL, v.trackR);
  return parts;
}

const _up = new THREE.Vector3(0, 1, 0), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _b = [0, 0, 0];
function animateTracks(parts, phaseL, phaseR) {
  const { wheels, cleats } = parts;
  let wi = 0, ci = 0;
  for (const [side, phase] of [[-1, phaseL], [1, phaseR]]) {
    for (const w of WHEELS) {
      _q.setFromEuler(_e.set((side < 0 ? -phase : phase) / w.r, 0, 0));
      if (side < 0) _q2.setFromAxisAngle(_up, Math.PI), _q.premultiply(_q2);
      _m.compose(_p.set(side * (TRACK.x + TRACK.w / 2 + 0.03), w.y, w.z), _q, _s.set(1, w.r, w.r));
      wheels.setMatrixAt(wi++, _m);
    }
    const n = 46, spacing = LOOP.len / n;
    for (let i = 0; i < n; i++) {
      beltAt(i * spacing + phase, _b);
      _q.setFromEuler(_e.set(_b[2], 0, 0));
      _m.compose(_p.set(side * TRACK.x, _b[1] + 0.0, _b[0]), _q, _s.set(1, 1, 1));
      cleats.setMatrixAt(ci++, _m);
    }
  }
  wheels.instanceMatrix.needsUpdate = true;
  cleats.instanceMatrix.needsUpdate = true;
}

// ---------------- the scout car ----------------
const JW = { x: 0.93, z: 1.22, y: 0.46, r: 0.46 };
let jeepWheelGeo = null;
function jeepWheel() {
  if (jeepWheelGeo) return jeepWheelGeo;
  const w = new CKit();
  w.add(cyl(1, 0.34, 20), C.rubber, { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; w.add(block(0.4, 0.14, 0.16, 0.02, 0.01), C.rubber, { pos: [0, Math.sin(a) * 1.0, Math.cos(a) * 1.0], rot: [-a + Math.PI / 2, 0, 0] }); }
  w.add(cyl(0.62, 0.37, 16), C.steel, { rot: [0, 0, Math.PI / 2] });
  w.add(cyl(0.26, 0.42, 12), C.brass, { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; w.add(bolt(0.07), C.dark, { pos: [0.2, Math.sin(a) * 0.45, Math.cos(a) * 0.45], rot: [0, 0, -Math.PI / 2] }); }
  jeepWheelGeo = w.bake();
  return jeepWheelGeo;
}

function jeepParts(team) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = T.body, trim = T.trim;
  const body = new CKit(), mount = new CKit(), gunK = new CKit(), glow = [];
  // chassis, tub and sloped bonnet
  body.add(block(1.3, 0.18, 3.9, 0.04, 0.02), C.dark, { pos: [0, 0.42, 0] }); // frame
  body.add(profile([[0.35, 0.5], [2.0, 0.5], [2.06, 0.74], [1.78, 1.02], [0.35, 1.06]], 1.5, 0.05, 2), paint); // bonnet
  body.add(block(1.1, 0.06, 0.5, 0.02, 0.01), C.dark, { pos: [0, 1.1, 1.2] }); // bonnet vent plate
  for (let i = 0; i < 4; i++) body.add(block(0.9, 0.025, 0.05, 0.005, 0.003), C.iron, { pos: [0, 1.14, 1.05 + i * 0.12] });
  for (const s of [-1, 1]) {
    body.add(block(0.1, 0.62, 1.95, 0.03, 0.015), paint, { pos: [s * 0.82, 0.8, -0.65] }); // cabin sides
    body.add(block(0.08, 0.5, 1.7, 0.03, 0.015), trim, { pos: [s * 0.88, 0.8, -0.65] }); // armour skin
  }
  body.add(block(1.7, 0.08, 2.0, 0.03, 0.015), C.dark, { pos: [0, 0.52, -0.65] }); // floor
  body.add(block(1.7, 0.62, 0.1, 0.03, 0.015), paint, { pos: [0, 0.82, -1.72] }); // tail panel
  body.add(block(1.62, 0.5, 0.12, 0.03, 0.015), paint, { pos: [0, 0.82, 0.34] }); // dash bulkhead
  body.add(block(1.2, 0.1, 0.34, 0.03, 0.015), C.dark, { pos: [0, 1.1, 0.22], rot: [-0.2, 0, 0] }); // dashboard
  // seats and the steering wheel
  for (const x of [-0.4, 0.4]) {
    body.add(block(0.56, 0.14, 0.56, 0.05, 0.02), C.leather ?? '#3a2c22', { pos: [x, 0.68, -0.3] });
    body.add(block(0.56, 0.5, 0.1, 0.05, 0.02), '#3a2c22', { pos: [x, 0.96, -0.58], rot: [-0.12, 0, 0] });
  }
  body.add(ring(0.17, 0.02, 14), C.dark, { pos: [-0.4, 1.12, 0.05], rot: [1.1, 0, 0] });
  body.add(cyl(0.015, 0.34, 6), C.dark, { pos: [-0.4, 1.02, 0.14], rot: [1.1, 0, 0] });
  // windscreen frame and the roll bar behind the seats
  for (const s of [-1, 1]) body.add(block(0.05, 0.5, 0.05, 0.01, 0.005), C.steel, { pos: [s * 0.8, 1.32, 0.34], rot: [-0.3, 0, 0] });
  body.add(block(1.65, 0.05, 0.05, 0.01, 0.005), C.steel, { pos: [0, 1.56, 0.22] });
  body.add(pipe([[-0.8, 1.1, -1.0], [-0.8, 1.7, -1.0], [0.8, 1.7, -1.0], [0.8, 1.1, -1.0]], 0.04, 16, 6), C.steel);
  // grille, bumper, lamps, winch
  body.add(block(1.2, 0.5, 0.08, 0.03, 0.015), C.brass, { pos: [0, 0.72, 2.05] });
  for (let i = -4; i <= 4; i++) body.add(block(0.03, 0.44, 0.04, 0.005, 0.003), C.dark, { pos: [i * 0.13, 0.72, 2.1] });
  body.add(block(1.9, 0.18, 0.2, 0.05, 0.02), C.steel, { pos: [0, 0.46, 2.08] });
  body.add(cyl(0.09, 0.8, 10), C.dark, { pos: [0, 0.4, 2.2], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) glow.push([cyl(0.1, 0.1, 10), [s * 0.62, 0.92, 2.05], [Math.PI / 2, 0, 0]]);
  // fenders over the wheels
  for (const sx of [-1, 1]) for (const z of [-JW.z, JW.z]) {
    body.add(block(0.44, 0.07, 1.15, 0.03, 0.015), paint, { pos: [sx * JW.x, 0.98, z] });
    body.add(block(0.06, 0.2, 1.15, 0.02, 0.01), paint, { pos: [sx * (JW.x + 0.2), 0.88, z] });
  }
  // rear: boiler drum, stack, spare wheel, jerrycans
  body.add(cyl(0.3, 1.15, 16), C.brass, { pos: [0, 1.07, -1.35], rot: [0, 0, Math.PI / 2] });
  for (const x of [-0.35, 0, 0.35]) body.add(ring(0.31, 0.022, 16), C.copper, { pos: [x, 1.07, -1.35], rot: [0, Math.PI / 2, 0] });
  body.add(pipe([[0.55, 1.3, -1.45], [0.55, 1.6, -1.55], [0.55, 1.75, -1.55]], 0.06, 8, 8), C.iron);
  body.add(cyl(0.38, 0.14, 14), C.rubber, { pos: [0, 1.05, -1.95], rot: [Math.PI / 2, 0, 0] });
  for (const x of [-0.6, 0.6]) body.add(block(0.34, 0.42, 0.18, 0.03, 0.015), C.canvas, { pos: [x, 0.95, -1.88] });
  // exhaust, aerial, mudflaps
  body.add(pipe([[-0.9, 0.55, -1.2], [-1.0, 0.5, -0.2], [-1.0, 0.5, 0.5]], 0.045, 10, 6), C.copper);
  body.add(pipe([[0.85, 1.1, -1.7], [0.85, 2.1, -1.74], [0.8, 2.9, -1.7]], 0.012, 6, 5), C.dark);
  // pintle ring and mount (rotates with the gun)
  mount.add(cyl(0.38, 0.1, 18), C.dark, { pos: [0, 0, 0] });
  mount.add(block(0.5, 0.36, 0.14, 0.03, 0.015), C.steel, { pos: [0, 0.3, 0] });
  mount.add(cyl(0.05, 0.5, 8), C.dark, { pos: [0, 0.22, 0.0] });
  mount.add(block(0.8, 0.6, 0.06, 0.03, 0.015), paint, { pos: [0, 0.65, 0.42] }); // gun shield
  mount.add(block(0.5, 0.1, 0.04, 0.01, 0.006), C.dark, { pos: [0, 0.78, 0.46] });
  mount.add(block(0.45, 0.04, 0.4, 0.01, 0.006), trim, { pos: [0, 0.97, 0.4] });
  // the gun itself: pitches at the shield
  gunK.add(block(0.14, 0.18, 0.5, 0.03, 0.015), C.steel, { pos: [0, 0, -0.1] });
  gunK.add(rod(0.032, 0.1, 1.25, 10), C.dark);
  gunK.add(turned([[0.06, 0.2], [0.065, 0.25], [0.065, 0.75], [0.06, 0.8]], 12), C.steel); // cooling jacket
  gunK.add(turned([[0.0001, 1.18], [0.055, 1.18], [0.055, 1.3], [0.03, 1.3]], 10), C.dark);
  gunK.add(block(0.2, 0.22, 0.3, 0.03, 0.012), C.iron, { pos: [-0.2, -0.1, -0.1] }); // ammo box
  gunK.add(block(0.05, 0.05, 0.18, 0.01, 0.005), C.dark, { pos: [0, 0.13, 0.35] });
  gunK.add(block(0.22, 0.04, 0.04, 0.01, 0.005), C.dark, { pos: [0, -0.02, -0.38] }); // spade grips
  return { body, mount, gunK, glow };
}

function buildJeepModel(team) {
  const key = `jeep${team}`;
  if (!modelCache.has(key)) {
    const p = jeepParts(team);
    const gk = new CKit(); for (const [g, pos, rot] of p.glow) gk.add(g, '#ffe9a8', { pos, rot });
    modelCache.set(key, { body: p.body.bake(), mount: p.mount.bake(), gun: p.gunK.bake(), glow: gk.bake() });
  }
  const m = modelCache.get(key), def = VEHICLES.jeep;
  const root = new THREE.Group();
  root.name = 'vehicle-jeep';
  const mesh = (g, mat = BODY, shadow = true) => { const o = new THREE.Mesh(g, mat); o.castShadow = shadow; o.receiveShadow = true; return o; };
  const body = mesh(m.body);
  const lamps = mesh(m.glow, new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#ffd27a', emissiveIntensity: 1.3, vertexColors: false }), false);
  const turretPivot = new THREE.Group(); turretPivot.position.set(...def.turret.pivot);
  const mount = mesh(m.mount);
  const gun = new THREE.Group(); gun.position.set(0, 0.45, 0.2);
  const gunMesh = mesh(m.gun);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 1.32);
  gun.add(gunMesh, muzzle);
  turretPivot.add(mount, gun);
  const wheels = new THREE.InstancedMesh(jeepWheel(), BODY, 4);
  wheels.castShadow = true; wheels.frustumCulled = false;
  root.add(body, lamps, turretPivot, wheels);
  const parts = { root, turretPivot, gun, gunZ: 0.2, recoilK: 0.08, muzzles: [muzzle], meshes: [body, mount, gunMesh, wheels], steerA: 0, susp: [0, 0, 0, 0] };
  parts.animate = (v) => {
    const target = THREE.MathUtils.clamp(-v.ctrl.steer, -1, 1) * 0.5 * (v.alive ? 1 : 0);
    parts.steerA += (target - parts.steerA) * 0.2;
    let i = 0;
    const yc = Math.cos(v.yaw), ys = Math.sin(v.yaw), tanP = Math.tan(v.pitch), tanR = Math.tan(v.roll);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      // each wheel reaches for the ground under it on its own spring
      const lx = sx * JW.x, lz = sz * JW.z;
      const ground = height(v.pos.x + yc * lx + ys * lz, v.pos.z - ys * lx + yc * lz);
      const now = v.pos.y + lz * tanP - lx * tanR + JW.y;
      const want = THREE.MathUtils.clamp(ground + JW.r - now, -0.26, 0.12);
      const idx = i;
      parts.susp[idx] += (want - parts.susp[idx]) * (v.alive ? 0.35 : 0.1);
      _q.setFromEuler(_e.set(((sx < 0 ? -1 : 1) * v.wheelPhase) / JW.r, 0, 0));
      if (sx < 0) _q.premultiply(_q2.setFromAxisAngle(_up, Math.PI));
      if (sz > 0) _q.premultiply(_q2.setFromAxisAngle(_up, parts.steerA + (sx < 0 ? 0 : 0)));
      _m.compose(_p.set(lx, JW.y + parts.susp[idx], lz), _q, _s.set(1, JW.r, JW.r));
      wheels.setMatrixAt(i++, _m);
    }
    wheels.instanceMatrix.needsUpdate = true;
  };
  return parts;
}
VEHICLES.jeep.build = buildJeepModel;

// ---------------- the steam skiff ----------------
function skiffParts(team) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = T.body, trim = T.trim;
  const body = new CKit(), pod = new CKit(), glow = [], fan = new CKit();
  // central hull: a long lens, flat underneath
  body.add(profile([[-1.85, 0.3], [-1.4, 0.12], [1.3, 0.12], [2.05, 0.32], [1.75, 0.62], [0.4, 0.78], [-1.3, 0.72], [-1.95, 0.56]], 1.0, 0.06, 2), paint);
  body.add(profile([[-1.7, 0.32], [1.2, 0.3], [1.9, 0.38], [1.6, 0.5], [-1.5, 0.52]], 1.04, 0.03, 2), trim); // belt line
  // side nacelles with brass coil rings
  for (const s of [-1, 1]) {
    body.add(ellipsoid(0.34, 0.3, 1.7, 14, 10), C.steel, { pos: [s * 0.88, 0.4, -0.1] });
    body.add(block(0.5, 0.06, 1.2, 0.02, 0.01), paint, { pos: [s * 0.62, 0.62, -0.1] }); // strut
    for (let i = 0; i < 4; i++) body.add(ring(0.33, 0.025, 14), C.brass, { pos: [s * 0.88, 0.4, -0.7 + i * 0.5], rot: [0, Math.PI / 2, 0] });
    glow.push([ellipsoid(0.12, 0.12, 0.18, 8, 6), [s * 0.88, 0.4, -1.78]]);
    body.add(block(0.05, 0.62, 0.8, 0.01, 0.006), paint, { pos: [s * 0.95, 0.88, -1.55], rot: [0.0, 0, s * 0.18] }); // tail fins
  }
  // canopy: a dark glass bubble and the pilot's seat, with a rim
  body.add(ellipsoid(0.5, 0.36, 0.85, 14, 10, (v) => { if (v.y < 0) v.y *= 0.1; }), '#2c4947', { pos: [0, 0.72, 0.2] });
  body.add(profile([[-0.7, 0], [0.7, 0], [0.5, 0.08], [-0.5, 0.08]], 0.96, 0.02), C.dark, { pos: [0, 0.7, 0.2] });
  body.add(block(0.4, 0.4, 0.14, 0.04, 0.02), C.leather ?? '#3a2c22', { pos: [0, 0.95, -0.2] });
  // rear boiler and stack
  body.add(cyl(0.26, 0.9, 16), C.brass, { pos: [0, 0.92, -1.35], rot: [Math.PI / 2, 0, 0] });
  for (const z of [-1.0, -1.35, -1.7]) body.add(ring(0.265, 0.02, 14), C.copper, { pos: [0, 0.92, z] });
  body.add(pipe([[0, 1.1, -1.5], [0, 1.4, -1.55], [0, 1.55, -1.55]], 0.06, 8, 8), C.iron);
  // prow, bumper and the stripe
  body.add(block(0.8, 0.1, 0.5, 0.03, 0.015), C.steel, { pos: [0, 0.2, 1.95] });
  body.add(block(0.2, 0.04, 1.3, 0.01, 0.005), trim, { pos: [0, 0.8, 0.9], rot: [-0.18, 0, 0] });
  // lift fan housings under the hull (the fans spin as their own meshes)
  for (const z of [1.0, -1.0]) { body.add(cyl(0.5, 0.1, 18), C.dark, { pos: [0, 0.1, z] }); glow.push([cyl(0.38, 0.02, 14), [0, 0.04, z]]); }
  for (let b = 0; b < 3; b++) fan.add(block(0.78, 0.015, 0.14, 0.005, 0.003), C.iron, { rot: [0, (b / 3) * Math.PI, 0] });
  // gun pod: twin barrels with coils, on the gimbal
  pod.add(block(0.5, 0.26, 0.7, 0.05, 0.02), C.steel, { pos: [0, 0, 0.2] });
  for (const s of [-1, 1]) {
    pod.add(rod(0.05, 0.3, 1.7, 10), C.dark, { pos: [s * 0.22, 0, 0] });
    for (const z of [0.7, 1.0, 1.3]) pod.add(ring(0.075, 0.014, 12), C.brass, { pos: [s * 0.22, 0, z], rot: [0, 0, 0] });
    pod.add(turned([[0.0001, 1.6], [0.075, 1.6], [0.075, 1.78], [0.04, 1.78]], 10), C.steel, { pos: [s * 0.22, 0, 0] });
  }
  return { body, pod, glow, fan };
}

function buildSkiffModel(team) {
  const key = `hover${team}`;
  if (!modelCache.has(key)) {
    const p = skiffParts(team);
    const gk = new CKit(); for (const [g, pos, rot] of p.glow) gk.add(g, '#6ff2e2', { pos, rot });
    modelCache.set(key, { body: p.body.bake(), pod: p.pod.bake(), glow: gk.bake(), fan: p.fan.bake() });
  }
  const m = modelCache.get(key), def = VEHICLES.hover;
  const root = new THREE.Group();
  root.name = 'vehicle-hover';
  const mesh = (g, mat = BODY, shadow = true) => { const o = new THREE.Mesh(g, mat); o.castShadow = shadow; o.receiveShadow = true; return o; };
  const body = mesh(m.body), glow = mesh(m.glow, MAT.glow, false);
  const fans = [1.0, -1.0].map((z) => { const f = mesh(m.fan, BODY, false); f.position.set(0, 0.06, z); return f; });
  const turretPivot = new THREE.Group(); turretPivot.position.set(...def.turret.pivot);
  const gun = new THREE.Group();
  const podMesh = mesh(m.pod);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.22, 0, 1.8);
  gun.add(podMesh, muzzle);
  turretPivot.add(gun);
  root.add(body, glow, turretPivot, ...fans);
  const parts = { root, turretPivot, gun, gunZ: 0, recoilK: 0.0, muzzles: [muzzle], meshes: [body, podMesh, ...fans], noTurretYawRoot: true };
  parts.animate = (v) => {
    for (const f of fans) f.rotation.y += 0.5 + Math.abs(v.speed) * 0.05;
  };
  return parts;
}
VEHICLES.hover.build = buildSkiffModel;

// ---------------- the strider ----------------
const WL = { hip: 2.95, x: 1.2, L1: 1.75, L2: 1.85, ankle: 0.36 };

function striderParts(team) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = T.body, trim = T.trim;
  const hull = new CKit(), turret = new CKit(), gunK = new CKit(), glow = [];
  // pelvis and hip housings
  hull.add(block(2.1, 0.62, 1.5, 0.12, 0.04), C.steel, { pos: [0, 0, 0] });
  for (const s of [-1, 1]) {
    hull.add(cyl(0.4, 0.5, 18), C.iron, { pos: [s * 1.0, 0, 0], rot: [0, 0, Math.PI / 2] });
    for (const dx of [0.2, 0.3]) hull.add(ring(0.4, 0.03, 18), C.brass, { pos: [s * (1.0 + dx), 0, 0], rot: [0, Math.PI / 2, 0] });
  }
  // torso: a tapering armoured tub
  hull.add(profile([[-1.0, 0.25], [1.0, 0.25], [1.25, 0.75], [1.05, 1.35], [0.55, 1.55], [-0.85, 1.45], [-1.15, 0.9]], 1.9, 0.07, 2), paint, { pos: [0, 0, 0] });
  hull.add(profile([[-1.0, 0.7], [1.15, 0.78], [1.0, 0.9], [-1.0, 0.86]], 1.96, 0.02, 1), trim);
  for (const s of [-1, 1]) hull.add(block(0.08, 0.7, 1.7, 0.03, 0.02), C.steel, { pos: [s * 1.0, 0.7, 0.1], rot: [0, 0, s * 0.12] }); // side plates
  // cockpit glass and its frame, glowing slit lamps
  hull.add(ellipsoid(0.62, 0.42, 0.55, 16, 10, (v) => { if (v.y < -0.1) v.y *= 0.2; }), '#2c4947', { pos: [0, 1.0, 1.0] });
  hull.add(ring(0.55, 0.035, 18), C.dark, { pos: [0, 1.0, 1.28], rot: [-0.55, 0, 0] });
  for (const s of [-1, 1]) glow.push([cyl(0.09, 0.1, 10), [s * 0.8, 0.5, 1.22], [Math.PI / 2, 0, 0]]);
  // back: twin boilers, rings, stacks and a steam manifold
  for (const s of [-1, 1]) {
    hull.add(cyl(0.34, 1.3, 18), C.brass, { pos: [s * 0.55, 1.05, -1.05] });
    for (const y of [0.55, 1.05, 1.5]) hull.add(ring(0.345, 0.025, 18), C.copper, { pos: [s * 0.55, y, -1.05], rot: [Math.PI / 2, 0, 0] });
    hull.add(turnedY([[0.0, 0], [0.34, 0], [0.2, 0.18], [0.0, 0.2]], 14), C.brass, { pos: [s * 0.55, 1.7, -1.05] });
    hull.add(pipe([[s * 0.55, 1.85, -1.05], [s * 0.55, 2.2, -1.05], [s * 0.6, 2.5, -1.1]], 0.08, 8, 8), C.iron);
  }
  hull.add(pipe([[-0.55, 1.0, -0.78], [0, 1.1, -0.74], [0.55, 1.0, -0.78]], 0.05, 10, 6), C.copper);
  hull.add(block(1.3, 0.3, 0.2, 0.03, 0.02), C.dark, { pos: [0, 0.55, -1.3] }); // exhaust shroud
  // belly pipes, tool boxes
  for (const s of [-1, 1]) hull.add(block(0.4, 0.34, 0.6, 0.04, 0.02), C.canvas, { pos: [s * 1.12, 0.2, -0.5] });
  hull.add(pipe([[-0.9, 0.1, 0.5], [-0.3, -0.12, 0.6], [0.3, -0.12, 0.6], [0.9, 0.1, 0.5]], 0.045, 12, 6), C.copper);
  // turret: a squat drum, a cheek for the cannon, the mortar tube racked on the left
  turret.add(cyl(0.62, 0.3, 22), C.steel, { pos: [0, 0.1, 0] });
  turret.add(profile([[-0.7, 0.2], [0.7, 0.2], [0.55, 0.62], [-0.5, 0.7]], 1.3, 0.05, 2), paint, { pos: [0, 0.1, 0] });
  turret.add(block(0.5, 0.5, 0.6, 0.06, 0.03), C.iron, { pos: [0.55, 0.5, 0.45] });  // gun cradle
  turret.add(block(0.5, 0.2, 0.5, 0.03, 0.02), paint, { pos: [-0.5, 0.38, -0.2] }); // mortar seat
  turret.add(rod(0.2, 0.0, 1.35, 14), C.dark, { pos: [-0.5, 0.55, -0.2], rot: [-1.05, 0, 0] });
  turret.add(turned([[0.2, 1.2], [0.26, 1.2], [0.26, 1.35], [0.2, 1.35]], 14), C.iron, { pos: [-0.5, 0.55, -0.2], rot: [-1.05, 0, 0] });
  for (const z of [0.4, 0.8]) turret.add(ring(0.205, 0.03, 14), C.brass, { pos: [-0.5 + 0, 0.55 + z * Math.sin(1.05), -0.2 + z * Math.cos(1.05)], rot: [-1.05, 0, 0] });
  turret.add(block(0.7, 0.04, 0.5, 0.01, 0.006), trim, { pos: [0, 0.78, -0.1] });
  // autocannon on the gun pivot: shrouded barrel, brake, drum
  gunK.add(block(0.34, 0.34, 0.9, 0.05, 0.02), C.steel, { pos: [0, 0, 0.1] });
  gunK.add(rod(0.07, 0.4, 2.3, 12), C.dark);
  gunK.add(turned([[0.13, 0.5], [0.15, 0.55], [0.15, 1.5], [0.13, 1.55]], 14), C.steel);
  gunK.add(turned([[0.0001, 2.2], [0.1, 2.2], [0.1, 2.42], [0.06, 2.42]], 12), C.iron);
  gunK.add(cyl(0.22, 0.3, 14), C.iron, { pos: [0.28, -0.05, 0.0], rot: [0, 0, Math.PI / 2] });
  gunK.add(block(0.2, 0.08, 0.5, 0.02, 0.01), C.brass, { pos: [-0.12, 0.2, 0.2] });
  return { hull, turret, gunK, glow };
}

function striderLeg(team) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = T.body;
  const { L1, L2 } = WL;
  const thigh = new CKit(), shin = new CKit(), foot = new CKit();
  // thigh: a tapered armoured slab with a piston alongside; hung down from the hip
  thigh.add(cyl(0.3, 0.62, 16), C.brass, { rot: [0, 0, Math.PI / 2] });
  thigh.add(profile([[-0.34, -0.1], [0.34, -0.1], [0.24, -L1 + 0.1], [-0.24, -L1 + 0.1]], 0.4, 0.05, 2), paint);
  thigh.add(block(0.05, L1 * 0.8, 0.3, 0.01, 0.005), C.steel, { pos: [0.24, -L1 * 0.5, 0.0] });
  thigh.add(rod(0.05, -L1 * 0.9, -0.2, 8).rotateX(-Math.PI / 2), C.copper, { pos: [0.28, 0, 0.38] });
  thigh.add(cyl(0.24, 0.58, 16), C.iron, { pos: [0, -L1, 0], rot: [0, 0, Math.PI / 2] });
  for (const d of [-0.22, 0.22]) thigh.add(ring(0.245, 0.025, 16), C.brass, { pos: [d, -L1, 0], rot: [0, Math.PI / 2, 0] });
  // shin: slimmer, with a rear hydraulic ram
  shin.add(profile([[-0.24, 0], [0.24, 0], [0.16, -L2 + 0.1], [-0.16, -L2 + 0.1]], 0.32, 0.04, 2), paint);
  shin.add(pipe([[0.0, -0.1, -0.26], [0.0, -L2 * 0.5, -0.34], [0.0, -L2 + 0.35, -0.2]], 0.05, 10, 6), C.copper);
  shin.add(block(0.4, 0.2, 0.3, 0.04, 0.02), C.steel, { pos: [0, -L2 * 0.35, 0.18] });
  shin.add(cyl(0.2, 0.46, 14), C.iron, { pos: [0, -L2 + 0.1, 0], rot: [0, 0, Math.PI / 2] });
  // foot: ankle block, broad pad and three toes
  foot.add(block(0.5, 0.3, 0.5, 0.05, 0.02), C.steel, { pos: [0, WL.ankle - 0.05, 0] });
  foot.add(profile([[-0.5, 0.0], [0.62, 0.0], [0.9, 0.08], [0.55, 0.22], [-0.45, 0.22]], 0.8, 0.04, 2), C.iron);
  for (const x of [-0.26, 0, 0.26]) foot.add(profile([[0.55, 0.0], [1.05, 0.0], [1.15, 0.07], [0.6, 0.15]], 0.2, 0.02, 1), C.dark, { pos: [x, 0, 0] });
  foot.add(block(0.5, 0.1, 0.3, 0.02, 0.01), C.dark, { pos: [0, 0.07, -0.55] }); // heel
  return { thigh, shin, foot };
}

const _ik = { H: new THREE.Vector3(), A: new THREE.Vector3(), K: new THREE.Vector3(), d: new THREE.Vector3(), pole: new THREE.Vector3(), inv: new THREE.Matrix4(), dn: new THREE.Vector3(0, -1, 0), tmp: new THREE.Vector3() };
const smooth = (u) => u * u * (3 - 2 * u);

function buildStriderModel(team) {
  const key = `walker${team}`;
  if (!modelCache.has(key)) {
    const p = striderParts(team), lg = striderLeg(team);
    const gk = new CKit(); for (const [g, pos, rot] of p.glow) gk.add(g, '#ffe9a8', { pos, rot });
    modelCache.set(key, { hull: p.hull.bake(), turret: p.turret.bake(), gun: p.gunK.bake(), glow: gk.bake(), thigh: lg.thigh.bake(), shin: lg.shin.bake(), foot: lg.foot.bake() });
  }
  const m = modelCache.get(key), def = VEHICLES.walker;
  const root = new THREE.Group();
  root.name = 'vehicle-walker';
  const mesh = (g, mat = BODY, shadow = true) => { const o = new THREE.Mesh(g, mat); o.castShadow = shadow; o.receiveShadow = true; o.frustumCulled = false; return o; };
  const bodyG = new THREE.Group();
  const hull = mesh(m.hull);
  const lamps = mesh(m.glow, new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#ffd27a', emissiveIntensity: 1.3 }), false);
  bodyG.add(hull, lamps);
  const turretPivot = new THREE.Group(); turretPivot.position.set(...def.turret.pivot);
  const tMesh = mesh(m.turret);
  const gun = new THREE.Group(); gun.position.set(0.55, 0.5, 0.45);
  const gMesh = mesh(m.gun);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 2.45);
  const mortarMuzzle = new THREE.Object3D(); mortarMuzzle.position.set(-0.5, 0.55 + 1.38 * Math.sin(1.05), -0.2 + 1.38 * Math.cos(1.05));
  gun.add(gMesh, muzzle);
  turretPivot.add(tMesh, gun, mortarMuzzle);
  const meshes = [hull, tMesh, gMesh];
  const legs = [-1, 1].map((side) => {
    const th = mesh(m.thigh), sh = mesh(m.shin), ft = mesh(m.foot);
    root.add(th, sh, ft); meshes.push(th, sh, ft);
    return { side, th, sh, ft, fp: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), stepping: false, u: 0, dur: 0.45, init: false };
  });
  root.add(bodyG, turretPivot);
  const parts = { root, turretPivot, gun, gunZ: 0.45, recoilK: 0.0, muzzles: [muzzle, mortarMuzzle], meshes, legs, lastT: -1, hy: WL.hip };
  parts.animate = (v) => striderAnimate(v, parts, bodyG);
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
  if (v.parts.turretPivot) v.parts.turretPivot.position.y += P.hy - WL.hip;
  // two-bone IK from hip to ankle, knee bent forward
  v.group.updateMatrixWorld(true);
  _ik.inv.copy(v.group.matrixWorld).invert();
  for (const leg of P.legs) {
    _ik.H.set(leg.side * WL.x, P.hy, 0);
    _ik.A.copy(leg.fp).applyMatrix4(_ik.inv); _ik.A.y += WL.ankle;
    _ik.d.subVectors(_ik.A, _ik.H);
    let d = _ik.d.length(); const maxD = L1 + L2 - 0.03;
    _ik.d.multiplyScalar(1 / (d || 1));
    if (d > maxD) { d = maxD; _ik.A.copy(_ik.H).addScaledVector(_ik.d, d); }
    d = Math.max(d, 0.5);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    _ik.pole.set(0, 0, 1); _ik.pole.addScaledVector(_ik.d, -_ik.d.z).normalize();
    _ik.K.copy(_ik.H).addScaledVector(_ik.d, a).addScaledVector(_ik.pole, h);
    leg.th.position.copy(_ik.H);
    leg.th.quaternion.setFromUnitVectors(_ik.dn, _ik.tmp.subVectors(_ik.K, _ik.H).normalize());
    leg.sh.position.copy(_ik.K);
    leg.sh.quaternion.setFromUnitVectors(_ik.dn, _ik.tmp.subVectors(_ik.A, _ik.K).normalize());
    leg.ft.position.copy(_ik.A); leg.ft.position.y -= WL.ankle;
    leg.ft.quaternion.identity();
  }
}

let vehicleId = 1;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;

// ---------------- the vehicle ----------------
export class Vehicle {
  constructor(kind, team, x, z, yaw = 0) {
    const def = VEHICLES[kind];
    this.id = 1000 + vehicleId++;
    this.kind = kind;
    this.def = def;
    this.isVehicle = true;
    this.team = team;
    this.pos = new THREE.Vector3(x, height(x, z), z);
    this.yaw = yaw;
    this.pitch = 0; this.roll = 0;
    this.vel = new THREE.Vector3();
    this.speed = 0; this.yawRate = 0;
    this.hp = def.hp; this.maxHp = def.hp;
    this.alive = true;
    this.deadT = 0;
    this.t = Math.random() * 10;
    this.lastShot = -99;
    this.kills = 0;
    this.kneelK = 0;
    this.suppression = 0;
    this.seats = Array.from({ length: def.seats }, () => null); // Unit or null
    this.crew = []; // AI crew held here (not in the battle's soldier list)
    this.ctrl = { throttle: 0, steer: 0, brake: false, fire: false, fire2: false, aimAt: null };
    this.tYaw = 0; this.tPitch = 0; // turret relative to the hull, gun relative to the turret
    this.cool = [0, 0];
    this.recoil = 0;
    this.trackL = 0; this.trackR = 0;
    this.box = { x, z, yaw, hx: def.hx, hz: def.hz, h: def.h, y0: pos0(this.pos) };
    this.parts = def.build(team);
    this.group = this.parts.root;
    this.brain = null;
    this.stuck = 0;
    this.engine = null;
    this.wreckT = 0;
    this.burn = 0;
    this.centerV = new THREE.Vector3();
    this.group.userData.vehicle = this;
    this.syncModel(0);
  }

  get driver() { return this.seats[0]; }
  get occupied() { return this.seats.some(Boolean) || this.crew.length > 0; }
  get hp01() { return this.hp / this.maxHp; }
  get isPlayerDriven() { return !!this.seats[0]?.isPlayer; }
  get hasPlayer() { return this.seats.some((u) => u?.isPlayer); }
  get speedKmh() { return Math.abs(this.speed) * 3.6; }
  center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + (this.alive ? this.def.lift || 0 : 0) + this.def.h * 0.5, this.pos.z); }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + (this.def.eyeH || 1.8), this.pos.z); }
  hitBox() {
    const b = this.box;
    b.x = this.pos.x; b.z = this.pos.z; b.yaw = this.yaw; b.y0 = this.pos.y + (this.alive ? this.def.lift || 0 : 0); b.h = this.alive ? this.def.h : 1.1;
    return b;
  }
  // gun muzzle and aim for the player's HUD
  muzzlePos(w = 0, out = new THREE.Vector3()) { this.group.updateMatrixWorld(true); return this.parts.muzzles[w].getWorldPosition(out); }
  muzzleDir(w = 0, out = new THREE.Vector3()) {
    this.group.updateMatrixWorld(true);
    const o = this.parts.muzzles[w];
    return out.set(0, 0, 1).transformDirection(o.matrixWorld);
  }
  weapon(i) { return this.def.weapons[i]; }
  // first-person cockpit: hide the outside of the machine, keep the gun so you see it ahead
  setCockpit(on) {
    if (!!this.cockpitOn === on) return;
    this.cockpitOn = on;
    const gun = this.parts.gun;
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o; p; p = p.parent) if (p === gun) return;
      o.visible = !on;
    });
  }
  // where the driver's eyes are, in the world
  cockpitEye(out = new THREE.Vector3()) {
    const l = this.def.cockpit;
    out.set(l[0], l[1] + (this.parts.hy !== undefined ? this.parts.hy - WL.hip : 0), l[2]);
    this.group.updateMatrixWorld(true);
    return this.group.localToWorld(out);
  }
  hudWeapon() {
    const d = this.def.weapons[0], c = this.cool[0];
    const slow = d.interval > 1;
    return { id: d.id, def: { name: slow && c > 0 ? 'Reloading' : d.name }, mag: slow ? (c > 0 ? 0 : 1) : '', reserve: Infinity, heat: 0 };
  }

  // ---------- crew ----------
  board(unit, seat = 0) {
    if (this.seats[seat] || !this.alive) return false;
    this.seats[seat] = unit;
    unit.vehicle = this; unit.seat = seat;
    unit.pos.copy(this.pos);
    unit.vel.set(0, 0, 0);
    return true;
  }
  // put the occupant of a seat on the ground beside the vehicle; returns the unit
  eject(seat = 0, battle = null) {
    const u = this.seats[seat];
    if (!u) return null;
    this.seats[seat] = null;
    u.vehicle = null; u.seat = -1;
    const side = [1, -1];
    let spot = null;
    for (const s of side) for (const d of [this.def.hx + 1.1, this.def.hx + 2.2]) {
      const x = this.pos.x + Math.cos(this.yaw) * s * d, z = this.pos.z - Math.sin(this.yaw) * s * d;
      let ok = Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2;
      if (ok && battle) for (const p of battle.propGrid.near(x, z, 1.5, battle.tmpB)) if (p.alive && p.box.h > 0.3) { const c = { x, z }; if (pushCircle(c, 0.5, p.box)) { ok = false; break; } }
      if (ok) { spot = [x, z]; break; }
    }
    if (!spot) spot = [this.pos.x + Math.cos(this.yaw) * (this.def.hx + 1.2), this.pos.z - Math.sin(this.yaw) * (this.def.hx + 1.2)];
    u.pos.set(spot[0], height(spot[0], spot[1]), spot[1]);
    u.vel.set(0, 0, 0);
    u.grounded = true;
    return u;
  }

  // ---------- damage ----------
  hit(dmg, kind, from, battle) {
    if (!this.alive) return;
    const a = this.def.armor[kind] ?? this.def.armor.blast;
    const d = dmg * a;
    if (d < 0.5) return;
    this.hp -= d;
    this.lastHurt = this.t;
    if (from?.isPlayer) battle.onHitMarker?.(this.hp <= 0);
    const driver = this.driver;
    if (driver?.isPlayer) battle.onPlayerHurt?.(d * 0.15, from);
    if (this.hp <= 0) this.destroy(from, battle);
  }

  destroy(from, battle) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.wreckT = 0;
    this.brain = null;
    if (from && from.team !== undefined && from.team !== this.team) from.kills = (from.kills || 0) + 3;
    const c = this.center();
    battle.explode(c.clone().setY(c.y + 0.3), 5.2, 160, from || null, 1);
    for (let s = 0; s < this.seats.length; s++) {
      const u = this.seats[s];
      if (u) { this.eject(s, battle); u.hurt(9999, from, battle, 'blast'); u.impulse?.(new THREE.Vector3((Math.random() - 0.5) * 6, 6, (Math.random() - 0.5) * 6)); }
    }
    for (const u of this.crew) { u.vehicle = null; }
    this.crew.length = 0;
    battle.fx.debris(c, '#4a4a45', 14);
    battle.fx.smoke(c, new THREE.Vector3(0, 3, 0), 3, 1);
    battle.onVehicleDestroyed?.(this, from);
    this.engine?.stop(); this.engine = null;
    for (const m of this.parts.meshes) m.material = WRECK;
    // the turret is blown askew
    this.wreckTurret = { yaw: (Math.random() - 0.5) * 0.9, lift: 0.25 };
    this.cool = [0, 0];
  }

  // ---------- update ----------
  update(dt, battle) {
    this.t += dt;
    for (let i = 0; i < 2; i++) this.cool[i] = Math.max(0, this.cool[i] - dt);
    this.recoil = Math.max(0, this.recoil - dt * 1.6);
    if (!this.alive) { this.updateWreck(dt, battle); return; }
    this.suppression = 0;
    const d = this.def, c = this.ctrl;
    const driven = this.seats[0] || this.crew.length;
    const thr = driven ? clamp(c.throttle, -1, 1) : 0, str = driven ? clamp(c.steer, -1, 1) : 0;
    // ---- drive
    const fwd = _p.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const slope = (height(this.pos.x + fwd.x, this.pos.z + fwd.z) - height(this.pos.x - fwd.x, this.pos.z - fwd.z)) / 2; // rise per metre ahead
    const goal = thr > 0 ? thr * d.maxSpeed : thr * d.maxRev;
    let a = d.accel;
    if (c.brake || (goal === 0 && Math.abs(this.speed) > 0.01)) a = d.brake;
    else if (goal * this.speed < 0) a = d.brake;
    // climbing slows, going downhill helps; too steep and the tracks just spin
    const grade = clamp(slope, -1, 1);
    const maxUp = d.maxSlope;
    const climb = goal >= 0 ? grade : -grade; // rise in the direction of travel
    let g = goal * (1 - clamp(climb, 0, maxUp) / maxUp * 0.7);
    if (climb > maxUp) g = Math.sign(goal) * Math.min(Math.abs(g), 0.4);
    const dv = g - this.speed;
    this.speed += clamp(dv, -a * dt, a * dt);
    this.speed -= grade * 9.8 * dt * 0.25 * (Math.abs(this.speed) > 0.05 || c.brake ? 1 : 0.4); // roll with the hill
    if (c.brake && Math.abs(this.speed) < 0.1) this.speed = 0;
    // steering: tracks pivot on the spot, slower when hurtling
    let yawGoal;
    if (d.drive === 'tracked' || d.drive === 'legged') yawGoal = -str * d.turn * (1 - Math.min(0.55, Math.abs(this.speed) / d.maxSpeed * 0.5)) * (this.speed < -0.3 ? -1 : 1);
    else yawGoal = -str * d.turn * Math.min(1, Math.abs(this.speed) / 3) * (1 - 0.45 * Math.abs(this.speed) / d.maxSpeed) * (this.speed < -0.3 ? -1 : 1);
    this.yawRate += (yawGoal - this.yawRate) * (1 - Math.exp(-6 * dt));
    this.yaw += this.yawRate * dt;
    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    if (d.drive === 'hover') {
      // no grip: momentum slides sideways through a turn
      this.slip = (this.slip || 0) + (this.yawRate * this.speed * 0.55 - (this.slip || 0) * 1.5) * dt;
      this.pos.x += Math.cos(this.yaw) * this.slip * dt;
      this.pos.z -= Math.sin(this.yaw) * this.slip * dt;
    }
    // ---- collisions
    const hitSpeed = this.collide(dt, battle);
    void hitSpeed;
    // ---- ground
    this.settle(dt);
    // ---- turret and guns
    this.aimTurret(dt, battle);
    this.fireControl(dt, battle);
    // ---- tracks and wheels, sound, smoke
    const spin = this.speed - this.yawRate * d.hx * 0.9, spinR = this.speed + this.yawRate * d.hx * 0.9;
    this.trackL = (this.trackL + spin * dt) % LOOP.len; this.trackR = (this.trackR + spinR * dt) % LOOP.len;
    this.wheelPhase = (this.wheelPhase || 0) + this.speed * dt;
    this.effects(dt, battle);
    this.syncModel(dt);
    if (this.footfalls?.length) this.stomp(battle);
    this.updateEngine(battle);
  }

  // each planted foot of a walker shakes the dust and flattens whoever is under it
  stomp(battle) {
    for (const [x, z] of this.footfalls) {
      battle.fx.dust(new THREE.Vector3(x, height(x, z) + 0.1, z), 3, 0.7);
      if (Math.abs(this.speed) < 0.4) continue;
      for (const u of battle.nearUnits(x, z, 2)) {
        if (!u.alive || u.vehicle || u.team === this.team) continue;
        battle.damageUnit(u, 90, this.shooter(), 'blast', _s.set(Math.sin(this.yaw), 0.4, Math.cos(this.yaw)));
      }
    }
    this.footfalls.length = 0;
  }

  // push out of props, crush the low ones, run over soldiers
  collide(dt, battle) {
    const d = this.def, r = d.hx * 0.92;
    let worst = 0;
    const px = this.pos.x, pz = this.pos.z;
    for (const off of [-d.hz * 0.62, 0, d.hz * 0.62]) {
      const c = _p.set(this.pos.x + Math.sin(this.yaw) * off, 0, this.pos.z + Math.cos(this.yaw) * off);
      const circle = { x: c.x, z: c.z };
      for (const p of battle.propGrid.near(circle.x, circle.z, r + 3, battle.tmpB)) {
        if (!p.alive) continue;
        const top = p.box.y0 + p.box.h;
        if (top < this.pos.y - (d.hoverH || 0) + d.step) continue; // a kerb: roll over it
        // low, breakable cover is crushed under the tracks
        if (d.crush && p.hp !== Infinity && p.box.h < (d.crushH || 1.25) && Math.abs(this.speed) > 1.2) {
          const probe = { x: circle.x, z: circle.z };
          if (pushCircle(probe, r * 0.8, p.box)) { battle.damageProp(p, 5000, this.driver || this.crew[0] || null); this.speed *= 0.9; }
          continue;
        }
        const moved = pushCircle(circle, r, p.box);
        if (moved) {
          const dx = circle.x - c.x, dz = circle.z - c.z;
          this.pos.x += dx; this.pos.z += dz;
          const into = Math.abs(this.speed);
          worst = Math.max(worst, into);
          this.speed *= 0.55;
          if (p.hp !== Infinity && into > 3) battle.damageProp(p, into * 60, this.driver || this.crew[0] || null);
          c.x += dx; c.z += dz;
        }
      }
    }
    // stay in the field
    const E = HALF - 3;
    this.pos.x = clamp(this.pos.x, -E, E); this.pos.z = clamp(this.pos.z, -E, E);
    // other vehicles
    for (const o of battle.vehicles) {
      if (o === this || !o.alive && o.deadT > 60) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, min = (this.def.hx + o.def.hx) * 1.25 + 0.6, dist = Math.hypot(dx, dz);
      if (dist < min && dist > 0.01) {
        const k = (min - dist) * (o.alive ? 0.5 : 1);
        this.pos.x -= dx / dist * k; this.pos.z -= dz / dist * k;
        if (o.alive) { o.pos.x += dx / dist * k; o.pos.z += dz / dist * k; }
        this.speed *= 0.8;
      }
    }
    // soldiers underfoot: heavy hulls run them over, friends are shoved aside
    if (Math.abs(this.speed) > 0.6 || true) {
      for (const u of battle.nearUnits(this.pos.x, this.pos.z, d.hz + 1.5)) {
        if (!u.alive || u.vehicle) continue;
        const rel = battle.toLocalBox ? null : null; void rel;
        const dx = u.pos.x - this.pos.x, dz = u.pos.z - this.pos.z;
        const lx = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw), lz = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
        if (Math.abs(lx) > d.hx + 0.25 || Math.abs(lz) > d.hz + 0.25) continue;
        if (u.pos.y > this.pos.y + 1.0) continue;
        if (u.team !== this.team && d.runover && Math.abs(this.speed) > 1.4) {
          battle.damageUnit(u, d.runover, this.driver || this.crew[0], 'blast', _s.set(Math.sin(this.yaw), 0.3, Math.cos(this.yaw)));
        } else {
          // out sideways
          const side = Math.sign(lx) || 1;
          u.pos.x += Math.cos(this.yaw) * side * 0.12; u.pos.z -= Math.sin(this.yaw) * side * 0.12;
        }
      }
    }
    return worst + Math.hypot(this.pos.x - px, this.pos.z - pz) * 0;
  }

  settle(dt) {
    const d = this.def, hx = d.hx * 0.85, hz = d.hz * 0.8;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const at = (lx, lz) => height(this.pos.x + c * lx + s * lz, this.pos.z - s * lx + c * lz);
    const fl = at(-hx, hz), fr = at(hx, hz), bl = at(-hx, -hz), br = at(hx, -hz);
    const gy = Math.max((fl + fr + bl + br) / 4, Math.min(fl, fr, bl, br) + 0.1);
    const tp = Math.atan2((fl + fr) / 2 - (bl + br) / 2, hz * 2); // nose up when positive
    const tr = Math.atan2((fl + bl) / 2 - (fr + br) / 2, hx * 2);
    const k = 1 - Math.exp(-9 * dt);
    if (d.drive === 'hover') {
      // ride a metre up, bobbing, nose dipping with speed and leaning into turns
      const goalY = Math.max(fl, fr, bl, br) + d.hoverH + Math.sin(this.t * 2.2) * 0.07;
      this.pos.y += (goalY - this.pos.y) * (1 - Math.exp(-6 * dt));
      const lean = -THREE.MathUtils.clamp(this.yawRate * this.speed * 0.012, -0.35, 0.35);
      this.pitch += (tp * 0.5 - THREE.MathUtils.clamp((this.ctrl.throttle || 0) * 0.08, -0.1, 0.1) - this.pitch) * k;
      this.roll += (tr * 0.5 + lean - this.roll) * k;
      return;
    }
    if (d.drive === 'legged') {
      this.pos.y += (gy - this.pos.y) * Math.min(1, k * 1.4);
      const tilt = d.tilt ?? 1;
      this.pitch += (tp * tilt - this.pitch) * k;
      this.roll += (tr * tilt - this.roll) * k;
      this.rock = (this.rock || 0) * Math.exp(-4 * dt);
      return;
    }
    // tracks and wheels: lay the hull on the ground plane, then lift it until no point of the
    // footprint is under the surface (so a crest or a kerb can never swallow a wheel)
    const kk = 1 - Math.exp(-14 * dt);
    this.pitch += (tp - this.pitch) * kk;
    this.roll += (tr - this.roll) * kk;
    const tanP = Math.tan(this.pitch), tanR = Math.tan(this.roll);
    let need = -Infinity;
    const ex = d.hx * 0.9, ez = d.hz * 0.92;
    for (const lx of [-ex, 0, ex]) for (const lz of [-ez, -ez / 2, 0, ez / 2, ez]) {
      need = Math.max(need, at(lx, lz) - (lz * tanP - lx * tanR));
    }
    need -= 0.04;
    if (this.pos.y < need) this.pos.y = need;
    else this.pos.y += (need - this.pos.y) * (1 - Math.exp(-10 * dt));
    this.rock = (this.rock || 0) * Math.exp(-4 * dt);
  }

  // turn the turret and gun toward ctrl.aimAt (a world point)
  aimTurret(dt, battle) {
    const t = this.def.turret, c = this.ctrl;
    if (!t || !c.aimAt) return;
    this.group.updateMatrixWorld(true);
    // direction from the turret pivot in hull space
    const pivot = _p.set(...t.pivot).applyMatrix4(this.group.matrixWorld);
    const dir = _s.copy(c.aimAt).sub(pivot);
    const inv = new THREE.Quaternion().copy(this.group.quaternion).invert();
    dir.applyQuaternion(inv).normalize();
    const wantYaw = Math.atan2(dir.x, dir.z);
    const wantPitch = clamp(Math.asin(clamp(dir.y, -1, 1)), t.pitchMin, t.pitchMax);
    const wy = t.yawLimit ? clamp(wantYaw, -t.yawLimit, t.yawLimit) : wantYaw;
    this.tYaw = wrapA(this.tYaw + clamp(wrapA(wy - this.tYaw), -t.rate * dt, t.rate * dt));
    this.tPitch += clamp(wantPitch - this.tPitch, -t.pitchRate * dt, t.pitchRate * dt);
    this.aimErr = Math.abs(wrapA(wantYaw - this.tYaw)) + Math.abs(wantPitch - this.tPitch);
    if (this.def.turret.yawLimit && Math.abs(wantYaw) > this.def.turret.yawLimit + 0.1) this.aimErr = 1; // cannot bear
  }

  shooter() { return this.seats[1] || this.seats[0] || this.crew[0] || this; }

  fireControl(dt, battle) {
    const c = this.ctrl, who = this.shooter();
    if (c.fire && this.cool[0] <= 0) this.fireWeapon(0, battle, who);
    if (c.fire2 && this.def.weapons[1] && this.cool[1] <= 0) this.fireWeapon(1, battle, who);
  }

  fireWeapon(i, battle, who) {
    const w = this.def.weapons[i];
    this.cool[i] = w.interval;
    if (w.alt) { this.alt = -(this.alt || 1); this.parts.muzzles[i].position.x = 0.22 * this.alt; }
    const m = this.muzzlePos(i), dir = this.muzzleDir(i);
    if (w.lob) {
      // a mortar: fixed elevation, speed chosen so the bomb lands on the aim point
      const a = this.ctrl.aimAt, md = this.muzzleDir(0, _s.set(0, 0, 0));
      let hx = md.x, hz = md.z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      const R = a ? clamp(Math.hypot(a.x - m.x, a.z - m.z), w.minRange || 10, w.range) : 40, dy = a ? a.y - m.y : -2;
      const th = w.lob, den = 2 * Math.cos(th) ** 2 * (R * Math.tan(th) - dy);
      const spd = den > 0.5 ? clamp(Math.sqrt(w.gravity * R * R / den), 14, 70) : 40;
      const jit = 1 + (Math.random() - 0.5) * w.spread * 4;
      const vel = new THREE.Vector3(hx * Math.cos(th), Math.sin(th), hz * Math.cos(th)).multiplyScalar(spd * jit);
      battle.stats.shots++;
      battle.launch(w.proj, m, vel, who, w);
      battle.fx.muzzle(m, dir, 1.8);
      battle.fx.steam(m, new THREE.Vector3(0, 4, 0), 5, 0.9);
      battle.fx.smoke(m, new THREE.Vector3(0, 3, 0), 1.0, 0.4);
      battle.audio.play(w.sound, m, who?.isPlayer ? 0.8 : 1);
      battle.heard(who, m);
      this.recoil = 0.6; this.lastShot = this.t;
      return;
    }
    const sp = battle.spread(dir, w.spread + (w.kind === 'hitscan' ? Math.min(0.03, Math.abs(this.speed) * 0.002) : 0));
    battle.stats.shots++;
    if (w.kind === 'projectile') {
      const proj = battle.launch(w.proj, m, sp.multiplyScalar(w.speed), who, w);
      if (w.proj === 'shell') proj.model.scale.setScalar(1.8);
    } else battle.hitscan(who, m, sp, w);
    const big = w.vehicleGun && w.proj === 'shell';
    battle.fx.muzzle(m, dir, big ? 2.6 : 1);
    if (big) {
      battle.fx.steam(m, dir.clone().multiplyScalar(3), 5, 0.9);
      battle.fx.smoke(m, dir.clone().multiplyScalar(4), 1.1, 0.4);
      battle.fx.dust(this.pos.clone().setY(this.pos.y + 0.2), 3, 0.6);
      this.recoil = 1; this.rock = 1;
    } else this.recoil = Math.min(1, this.recoil + 0.25);
    battle.audio.play(w.sound, m, who?.isPlayer ? 0.8 : 1);
    battle.heard(who, m);
    this.lastShot = this.t;
  }

  effects(dt, battle) {
    const fx = battle.fx;
    const moving = Math.abs(this.speed) > 0.5;
    this._steamT = (this._steamT || 0) - dt;
    if (this._steamT <= 0) {
      this._steamT = moving ? 0.12 : 0.35;
      const p = _p.set(...this.def.steamAt).applyMatrix4(this.group.matrixWorld);
      fx.steam(p, new THREE.Vector3(0, 1.4 + Math.abs(this.speed) * 0.1, 0), 1, 0.45);
    }
    if (moving && Math.random() < dt * 14) {
      const s = Math.sign(Math.random() - 0.5), c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      fx.dust(new THREE.Vector3(this.pos.x + c * s * 1.0 - sn * Math.sign(this.speed) * 2.2, this.pos.y + 0.1, this.pos.z - sn * s * 1.0 - c * Math.sign(this.speed) * 2.2), 1, 0.5);
    }
    if (this.hp01 < 0.45 && Math.random() < dt * (1 - this.hp01) * 10) fx.smoke(this.center().setY(this.pos.y + 1.3), new THREE.Vector3(0, 2.2, 0), 1.2, 1);
    if (this.hp01 < 0.2 && Math.random() < dt * 8) fx.burn(this.center().setY(this.pos.y + 1.4));
  }

  updateWreck(dt, battle) {
    this.deadT += dt;
    this.speed *= Math.exp(-2 * dt);
    this.settle(dt);
    if (Math.random() < dt * 5 && this.deadT < 25) battle.fx.smoke(this.center().setY(this.pos.y + 1.2), new THREE.Vector3(0, 2, 0), 1.3, 1);
    if (this.deadT < 18 && Math.random() < dt * 2) battle.fx.burn(this.center().setY(this.pos.y + 1.1));
    this.syncModel(dt);
  }

  updateEngine(battle) {
    if (!this.alive) return;
    if (!this.engine && battle.audio?.ctx) this.engine = battle.audio.engine('tank');
    this.engine?.set(Math.min(1, Math.abs(this.speed) / this.def.maxSpeed + Math.abs(this.yawRate) * 0.3 + (this.ctrl.throttle ? 0.15 : 0)), this.pos);
  }

  syncModel() {
    const g = this.group, P = this.parts;
    g.position.copy(this.pos);
    g.rotation.order = 'YXZ';
    g.rotation.y = this.yaw;
    g.rotation.x = -this.pitch + (this.rock || 0) * 0.015 * Math.sin(this.t * 18);
    g.rotation.z = this.roll;
    if (P.turretPivot) {
      const piv = this.def.turret.pivot;
      if (this.alive) {
        P.turretPivot.rotation.y = this.tYaw;
        P.gun.rotation.x = -this.tPitch;
        P.gun.position.z = P.gunZ - this.recoil * P.recoilK;
        P.turretPivot.position.y = piv[1];
      } else if (this.wreckTurret) {
        P.turretPivot.rotation.y = this.tYaw + this.wreckTurret.yaw;
        P.turretPivot.rotation.z = 0.25;
        P.gun.rotation.x = 0.3;
        P.turretPivot.position.y = piv[1] + this.wreckTurret.lift * Math.min(1, this.deadT * 2);
      }
    }
    P.animate?.(this);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.engine?.stop(); this.engine = null;
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  }
}

function pos0(p) { return p.y; }

VEHICLES.tank.build = buildTankModel;
