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
    mass: 30, camDist: 9.5, camHeight: 2.6, steamAt: [0.5, 2.1, -1.9],
    turret: { rate: 1.25, pitchRate: 0.8, pitchMin: -0.14, pitchMax: 0.42, pivot: [0, 1.08, -0.15] },
    weapons: [
      { id: 'cannon', name: 'Tank gun', kind: 'projectile', proj: 'shell', damage: 230, radius: 3.8, speed: 78, gravity: 3, interval: 2.3, spread: 0.004, sound: 'cannon', mag: 1, reserve: Infinity, range: 220, burst: [1, 1], vehicleGun: true },
      { id: 'coax', name: 'Coaxial MG', kind: 'hitscan', damage: 17, interval: 0.09, spread: 0.018, sound: 'mg', mag: Infinity, reserve: Infinity, range: 90, tracer: '#ffc070', burst: [6, 12], vehicleGun: true },
    ],
  },
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
  return { root, hull, turretPivot, turret, gun, barrel, muzzle, coax, wheels, cleats, meshes: [hull, turret, barrel] };
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
    this.parts = buildTankModel(team);
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
  get speedKmh() { return Math.abs(this.speed) * 3.6; }
  center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.def.h * 0.5, this.pos.z); }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + 1.8, this.pos.z); }
  hitBox() {
    const b = this.box;
    b.x = this.pos.x; b.z = this.pos.z; b.yaw = this.yaw; b.y0 = this.pos.y; b.h = this.alive ? this.def.h : 1.1;
    return b;
  }
  // gun muzzle and aim for the player's HUD
  muzzlePos(w = 0, out = new THREE.Vector3()) { this.group.updateMatrixWorld(true); return (w === 0 ? this.parts.muzzle : this.parts.coax).getWorldPosition(out); }
  muzzleDir(w = 0, out = new THREE.Vector3()) {
    this.group.updateMatrixWorld(true);
    const o = w === 0 ? this.parts.muzzle : this.parts.coax;
    return out.set(0, 0, 1).transformDirection(o.matrixWorld);
  }
  weapon(i) { return this.def.weapons[i]; }
  hudWeapon() {
    const d = this.def.weapons[0], c = this.cool[0];
    return { id: 'cannon', def: { name: c > 0 ? 'Reloading' : d.name }, mag: c > 0 ? 0 : 1, reserve: Infinity, heat: 0 };
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
    this.parts.cleats.material = WRECK; this.parts.wheels.material = WRECK;
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
    const yawGoal = -str * d.turn * (1 - Math.min(0.55, Math.abs(this.speed) / d.maxSpeed * 0.5)) * (this.speed < -0.3 ? -1 : 1);
    this.yawRate += (yawGoal - this.yawRate) * (1 - Math.exp(-6 * dt));
    this.yaw += this.yawRate * dt;
    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    // ---- collisions
    const hitSpeed = this.collide(dt, battle);
    void hitSpeed;
    // ---- ground
    this.settle(dt);
    // ---- turret and guns
    this.aimTurret(dt, battle);
    this.fireControl(dt, battle);
    // ---- tracks, sound, smoke
    const spin = this.speed - this.yawRate * d.hx * 0.9, spinR = this.speed + this.yawRate * d.hx * 0.9;
    this.trackL = (this.trackL + spin * dt) % LOOP.len; this.trackR = (this.trackR + spinR * dt) % LOOP.len;
    this.effects(dt, battle);
    this.syncModel(dt);
    this.updateEngine(battle);
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
        if (top < this.pos.y + 0.28) continue; // a kerb: roll over it
        // low, breakable cover is crushed under the tracks
        if (p.hp !== Infinity && p.box.h < 1.25 && Math.abs(this.speed) > 1.2) {
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
        if (u.team !== this.team && Math.abs(this.speed) > 1.4) {
          battle.damageUnit(u, 400, this.driver || this.crew[0], 'blast', _s.set(Math.sin(this.yaw), 0.3, Math.cos(this.yaw)));
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
    this.pos.y += (gy - this.pos.y) * Math.min(1, k * 1.4);
    this.pitch += (tp - this.pitch) * k;
    this.roll += (tr - this.roll) * k;
    // gun fire and braking make the hull rock
    this.rock = (this.rock || 0) * Math.exp(-4 * dt);
  }

  // turn the turret and gun toward ctrl.aimAt (a world point)
  aimTurret(dt, battle) {
    const t = this.def.turret, c = this.ctrl;
    if (!c.aimAt) return;
    this.group.updateMatrixWorld(true);
    // direction from the turret pivot in hull space
    const pivot = _p.set(...t.pivot).applyMatrix4(this.group.matrixWorld);
    const dir = _s.copy(c.aimAt).sub(pivot);
    const inv = new THREE.Quaternion().copy(this.group.quaternion).invert();
    dir.applyQuaternion(inv).normalize();
    const wantYaw = Math.atan2(dir.x, dir.z);
    const wantPitch = clamp(Math.asin(clamp(dir.y, -1, 1)), t.pitchMin, t.pitchMax);
    this.tYaw = wrapA(this.tYaw + clamp(wrapA(wantYaw - this.tYaw), -t.rate * dt, t.rate * dt));
    this.tPitch += clamp(wantPitch - this.tPitch, -t.pitchRate * dt, t.pitchRate * dt);
    this.aimErr = Math.abs(wrapA(wantYaw - this.tYaw)) + Math.abs(wantPitch - this.tPitch);
  }

  shooter() { return this.driver || this.crew[0] || this; }

  fireControl(dt, battle) {
    const c = this.ctrl;
    const who = this.shooter();
    if (c.fire && this.cool[0] <= 0) this.fireCannon(battle, who);
    if (c.fire2 && this.cool[1] <= 0) this.fireCoax(battle, who);
  }

  fireCannon(battle, who) {
    const w = this.def.weapons[0];
    this.cool[0] = w.interval;
    const m = this.muzzlePos(0), dir = this.muzzleDir(0);
    const sp = battle.spread(dir, w.spread);
    battle.stats.shots++;
    const proj = battle.launch('shell', m, sp.multiplyScalar(w.speed), who, w);
    proj.model.scale.setScalar(1.8);
    battle.fx.muzzle(m, dir, 2.6);
    battle.fx.steam(m, dir.clone().multiplyScalar(3), 5, 0.9);
    battle.fx.smoke(m, dir.clone().multiplyScalar(4), 1.1, 0.4);
    battle.fx.dust(this.pos.clone().setY(this.pos.y + 0.2), 3, 0.6);
    battle.audio.play('cannon', m, who?.isPlayer ? 0.9 : 1);
    battle.heard(who, m);
    this.recoil = 1;
    this.rock = 1;
    this.lastShot = this.t;
    if (who?.isPlayer) battle.onPlayerShot?.(this);
  }
  fireCoax(battle, who) {
    const w = this.def.weapons[1];
    this.cool[1] = w.interval;
    const m = this.muzzlePos(1), dir = battle.spread(this.muzzleDir(1), w.spread);
    battle.stats.shots++;
    battle.hitscan(who, m, dir, w);
    battle.fx.muzzle(m, dir, 1);
    battle.audio.play('mg', m, 0.7);
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
    if (this.alive) {
      P.turretPivot.rotation.y = this.tYaw;
      P.gun.rotation.x = -this.tPitch;
      P.gun.position.z = 1.28 - this.recoil * 0.4;
      P.turretPivot.position.y = this.def.turret.pivot[1];
    } else if (this.wreckTurret) {
      P.turretPivot.rotation.y = this.tYaw + this.wreckTurret.yaw;
      P.turretPivot.rotation.z = 0.25;
      P.gun.rotation.x = 0.3;
      P.turretPivot.position.y = this.def.turret.pivot[1] + this.wreckTurret.lift * Math.min(1, this.deadT * 2);
    }
    animateTracks(P, this.trackL, this.trackR);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.engine?.stop(); this.engine = null;
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  }
}

function pos0(p) { return p.y; }
