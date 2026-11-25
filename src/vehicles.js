import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAT, profile, roundRect, turned, turnedY, rod, ring, bolt, pipe, block } from './models.js';
import { ellipsoid } from './geo.js';
import { TEAMS } from './factions.js';
import { height } from './terrain.js';
import { pushCircle } from './physics.js';
import { HALF } from './world.js';
import { detail } from './fabric.js';

// Vehicles: heavy, believable machines for the big field. Each is one body on the ground with
// a hull box for hits and collisions, a turret and gun that turn on their own, and seats for
// crew. Drawn with a few merged, vertex-coloured meshes so a strider costs about six draw calls.
// World yaw convention matches soldiers: forward is (sin yaw, cos yaw).

export const VEHICLES = {};

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

// plating: chipped paint, dirt toward the ground and a pitted surface, in metre-sized features (see fabric.js)
const BODY = detail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.3 }), { style: false, grain: 0, dirt: [0.04, 0, 0.35], wear: 0.35, bump: 0.5, scale: 0.16 });
const WRECK = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#3c3835', roughness: 0.95, metalness: 0.1 });
const cyl = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg);

const modelCache = new Map();

const _up = new THREE.Vector3(0, 1, 0), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _b = [0, 0, 0];

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
  // strider detail: armour plate seams and rivets, ladder, hatches, running lights, exhaust louvres, hydraulic lines
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) hull.add(new THREE.SphereGeometry(0.03, 5, 4), C.steel, { pos: [s * 1.2, 0.5 + i * 0.12, 0.8] });
    hull.add(block(0.04, 0.9, 0.04, 0.01, 0.006), C.dark, { pos: [s * 1.17, 0.75, 0.3] }); // armour seam
    hull.add(block(0.04, 0.9, 0.04, 0.01, 0.006), C.dark, { pos: [s * 1.1, 0.75, -0.6] });
    for (let i = 0; i < 5; i++) hull.add(block(0.04, 0.05, 0.2, 0.01, 0.005), C.dark, { pos: [s * 1.06, 0.45 + i * 0.1, -0.2] }); // louvres
    hull.add(pipe([[s * 0.95, 0.1, 0.2], [s * 1.12, 0.0, 0.0], [s * 1.2, 0.0, -0.4]], 0.03, 10, 6), C.copper); // hydraulic line
    hull.add(block(0.05, 0.9, 0.04, 0.01, 0.006), C.steel, { pos: [s * 0.2, 0.7, -1.55] }); // rear ladder rail
  }
  for (let i = 0; i < 7; i++) hull.add(block(0.4, 0.03, 0.03, 0.006, 0.003), C.steel, { pos: [0, 0.35 + i * 0.13, -1.55] }); // ladder rungs
  hull.add(block(0.4, 0.04, 0.4, 0.03, 0.01), C.dark, { pos: [0, 1.5, 0.25] }); // roof hatch
  hull.add(block(1.2, 0.1, 0.06, 0.015, 0.008), trim, { pos: [0, 0.2, 1.3] }); // lower chin plate
  for (let i = 0; i < 5; i++) hull.add(new THREE.SphereGeometry(0.03, 5, 4), C.steel, { pos: [-0.4 + i * 0.2, 0.22, 1.32] });
  hull.add(block(0.9, 0.04, 0.04, 0.01, 0.005), C.brass, { pos: [0, 1.3, -0.45] }); // manifold bar
  for (const s of [-1, 1]) glow.push([bolt(0.05), [s * 1.15, 0.9, 0.9], [0, 0, -Math.PI / 2 * s]]);
  // hull plating: layered armour over the hip housings, panel lines, rivet rows and bolt heads
  const rivets = (kit, a, b, n, rot, r = 0.03, col = C.steel) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); kit.add(new THREE.SphereGeometry(r, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), col, { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], rot }); } };
  for (const s of [-1, 1]) {
    hull.add(block(0.1, 0.62, 1.1, 0.06, 0.03), paint, { pos: [s * 1.3, 0.12, 0.0], rot: [0, 0, s * 0.1] }); // hip armour, a plate over each housing
    hull.add(block(0.06, 0.5, 0.9, 0.05, 0.02), C.iron, { pos: [s * 1.37, 0.05, 0.0], rot: [0, 0, s * 0.1] }); // second layer
    rivets(hull, [s * 1.42, 0.3, -0.45], [s * 1.42, 0.3, 0.45], 6, [0, 0, -s * Math.PI / 2 + s * 0.1]);
    rivets(hull, [s * 1.42, -0.12, -0.45], [s * 1.42, -0.12, 0.45], 6, [0, 0, -s * Math.PI / 2 + s * 0.1]);
    for (const z of [-0.2, 0.2]) hull.add(block(0.07, 0.6, 0.025, 0.01, 0.005), C.dark, { pos: [s * 1.345, 0.1, z], rot: [0, 0, s * 0.1] }); // panel line
    hull.add(block(0.05, 0.12, 0.34, 0.02, 0.01), trim, { pos: [s * 1.43, 0.34, 0.0], rot: [0, 0, s * 0.1] }); // unit stripe
    // hull side vents and a grab rail
    for (let i = 0; i < 4; i++) hull.add(block(0.05, 0.035, 0.34, 0.01, 0.005), C.dark, { pos: [s * 1.07, 1.05 + i * 0.07, 0.58] });
    hull.add(pipe([[s * 1.1, 1.2, 0.95], [s * 1.2, 1.2, 0.95], [s * 1.2, 1.2, 0.35], [s * 1.1, 1.2, 0.35]], 0.025, 12, 6), C.steel);
    // shoulder lamp pods on the chin
    hull.add(cyl(0.1, 0.16, 12), C.dark, { pos: [s * 0.55, 0.34, 1.26], rot: [Math.PI / 2, 0, 0] });
    glow.push([cyl(0.075, 0.03, 10), [s * 0.55, 0.34, 1.35], [Math.PI / 2, 0, 0]]);
  }
  // cockpit: frame ribs over the glass, a brow visor, wipers and a roof searchlight
  for (const x of [-0.3, 0, 0.3]) hull.add(block(0.04, 0.5, 0.04, 0.01, 0.005), C.dark, { pos: [x, 1.05, 1.5], rot: [-0.55, 0, 0] });
  hull.add(profile([[0.9, 1.5], [1.55, 1.38], [1.62, 1.3], [0.9, 1.34]], 1.3, 0.02, 1), paint, { pos: [0, 0.0, 0.0] }); // brow visor
  for (const x of [-0.18, 0.22]) hull.add(rod(0.012, 0, 0.5, 6), C.dark, { pos: [x, 0.78, 1.37], rot: [-0.55 + 0.3, 0, x > 0 ? 0.5 : -0.4] }); // wipers
  hull.add(cyl(0.12, 0.12, 14), C.dark, { pos: [0.55, 1.58, 0.55] });
  glow.push([cyl(0.09, 0.03, 12), [0.55, 1.58, 0.65], [Math.PI / 2, 0, 0]]);
  hull.add(rod(0.012, 0, 1.2, 6), C.dark, { pos: [-0.7, 1.45, -0.9], rot: [-1.45, 0, 0.1] }); // whip antenna
  // belly armour skirt and a tow shackle
  hull.add(block(1.5, 0.08, 0.5, 0.03, 0.015), C.iron, { pos: [0, -0.28, 0.5] });
  hull.add(ring(0.1, 0.025, 14), C.steel, { pos: [0, 0.18, 1.34], rot: [0.3, 0, 0] });
  // turret: a squat drum, a cheek for the cannon, the mortar tube racked on the left
  turret.add(cyl(0.62, 0.3, 22), C.steel, { pos: [0, 0.1, 0] });
  turret.add(profile([[-0.7, 0.2], [0.7, 0.2], [0.55, 0.62], [-0.5, 0.7]], 1.3, 0.05, 2), paint, { pos: [0, 0.1, 0] });
  turret.add(block(0.5, 0.5, 0.6, 0.06, 0.03), C.iron, { pos: [0.55, 0.5, 0.45] });  // gun cradle
  turret.add(block(0.5, 0.2, 0.5, 0.03, 0.02), paint, { pos: [-0.5, 0.38, -0.2] }); // mortar seat
  turret.add(rod(0.2, 0.0, 1.35, 14), C.dark, { pos: [-0.5, 0.55, -0.2], rot: [-1.05, 0, 0] });
  turret.add(turned([[0.2, 1.2], [0.26, 1.2], [0.26, 1.35], [0.2, 1.35]], 14), C.iron, { pos: [-0.5, 0.55, -0.2], rot: [-1.05, 0, 0] });
  for (const z of [0.4, 0.8]) turret.add(ring(0.205, 0.03, 14), C.brass, { pos: [-0.5 + 0, 0.55 + z * Math.sin(1.05), -0.2 + z * Math.cos(1.05)], rot: [-1.05, 0, 0] });
  turret.add(block(0.7, 0.04, 0.5, 0.01, 0.006), trim, { pos: [0, 0.78, -0.1] });
  for (let i = 0; i < 6; i++) turret.add(new THREE.SphereGeometry(0.028, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), C.steel, { pos: [-0.5 + i * 0.2, 0.7, 0.5] });
  turret.add(block(0.06, 0.26, 0.5, 0.02, 0.01), trim, { pos: [0.7, 0.45, -0.1] }); // side stripe
  turret.add(cyl(0.05, 0.4, 8), C.dark, { pos: [0.68, 0.7, -0.45] }); // sight mast
  turret.add(cyl(0.09, 0.14, 10), C.iron, { pos: [0.68, 0.92, -0.45], rot: [Math.PI / 2, 0, 0] });
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
  const paint = T.body, trim = T.trim;
  const { L1, L2 } = WL;
  const thigh = new CKit(), shin = new CKit(), foot = new CKit(), toes = new CKit(), ramTube = new CKit(), ramRod = new CKit();
  const dome = (kit, r, pos, rot, col = C.steel) => kit.add(new THREE.SphereGeometry(r, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), col, { pos, rot });
  // hip: a gimbal drum between two collars, bolted down
  thigh.add(cyl(0.3, 0.62, 16), C.brass, { rot: [0, 0, Math.PI / 2] });
  for (const sx of [-1, 1]) {
    thigh.add(cyl(0.36, 0.06, 18), C.iron, { pos: [sx * 0.33, 0, 0], rot: [0, 0, Math.PI / 2] });
    thigh.add(ring(0.31, 0.03, 18), C.copper, { pos: [sx * 0.31, 0, 0], rot: [0, Math.PI / 2, 0] });
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; dome(thigh, 0.026, [sx * 0.365, Math.cos(a) * 0.27, Math.sin(a) * 0.27], [0, 0, -sx * Math.PI / 2]); }
  }
  // thigh: a tapered armoured slab with layered plates, a piston pair and a stiffening rib
  thigh.add(profile([[-0.34, -0.1], [0.34, -0.1], [0.24, -L1 + 0.1], [-0.24, -L1 + 0.1]], 0.4, 0.05, 2), paint);
  thigh.add(block(0.05, L1 * 0.8, 0.3, 0.01, 0.005), C.steel, { pos: [0.24, -L1 * 0.5, 0.0] });
  thigh.add(block(0.05, L1 * 0.8, 0.3, 0.01, 0.005), C.steel, { pos: [-0.24, -L1 * 0.5, 0.0] });
  thigh.add(block(0.3, L1 * 0.62, 0.05, 0.02, 0.01), C.iron, { pos: [0, -L1 * 0.52, 0.3], rot: [0.12, 0, 0] }); // front shield
  for (const y of [-0.55, -0.9, -1.25]) thigh.add(block(0.32, 0.03, 0.06, 0.01, 0.005), C.dark, { pos: [0, y, 0.3], rot: [0.12, 0, 0] }); // panel lines
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) dome(thigh, 0.022, [sx * 0.13, -0.5 - i * 0.2, 0.33 - i * 0.012], [0.12 + Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) {
    thigh.add(rod(0.05, -L1 * 0.9, -0.2, 8).rotateX(-Math.PI / 2), C.copper, { pos: [sx * 0.29, 0, 0.38] });
    thigh.add(cyl(0.065, 0.55, 10), C.steel, { pos: [sx * 0.29, -0.55, 0.38] }); // piston sleeve
    for (const y of [-0.34, -0.76]) thigh.add(ring(0.068, 0.014, 10), C.brass, { pos: [sx * 0.29, y, 0.38], rot: [Math.PI / 2, 0, 0] });
  }
  thigh.add(block(0.36, 0.3, 0.1, 0.03, 0.015), trim, { pos: [0, -0.3, -0.3] }); // rear marking plate
  // knee: a drum between two collars, with a plated cap on the front
  thigh.add(cyl(0.24, 0.58, 16), C.iron, { pos: [0, -L1, 0], rot: [0, 0, Math.PI / 2] });
  for (const d of [-0.22, 0.22]) thigh.add(ring(0.245, 0.025, 16), C.brass, { pos: [d, -L1, 0], rot: [0, Math.PI / 2, 0] });
  thigh.add(block(0.46, 0.3, 0.16, 0.05, 0.02), paint, { pos: [0, -L1 + 0.02, 0.28], rot: [0.15, 0, 0] });
  for (const sx of [-1, 1]) { dome(thigh, 0.026, [sx * 0.2, -L1 + 0.04, 0.36], [0.15 + Math.PI / 2, 0, 0]); dome(thigh, 0.03, [sx * 0.3, -L1, 0], [0, 0, -sx * Math.PI / 2]); }
  // ram anchor lug at the upper rear of the thigh
  thigh.add(block(0.14, 0.16, 0.12, 0.02, 0.01), C.iron, { pos: [0, -0.5, -0.34] });
  // shin: slimmer, with a front greave, calf cover, hose loops and the ram's lower mount
  shin.add(profile([[-0.24, 0], [0.24, 0], [0.16, -L2 + 0.1], [-0.16, -L2 + 0.1]], 0.32, 0.04, 2), paint);
  shin.add(pipe([[0.0, -0.1, -0.26], [0.0, -L2 * 0.5, -0.34], [0.0, -L2 + 0.35, -0.2]], 0.05, 10, 6), C.copper);
  shin.add(block(0.4, 0.2, 0.3, 0.04, 0.02), C.steel, { pos: [0, -L2 * 0.35, 0.18] });
  shin.add(block(0.26, L2 * 0.62, 0.05, 0.02, 0.01), C.iron, { pos: [0, -L2 * 0.5, 0.24], rot: [0.09, 0, 0] }); // greave
  for (const y of [-0.5, -0.85, -1.2]) shin.add(block(0.28, 0.025, 0.06, 0.008, 0.004), C.dark, { pos: [0, y, 0.25], rot: [0.09, 0, 0] });
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) dome(shin, 0.02, [sx * 0.1, -0.45 - i * 0.28, 0.28 - i * 0.007], [0.09 + Math.PI / 2, 0, 0]);
  shin.add(block(0.2, 0.55, 0.1, 0.03, 0.015), C.iron, { pos: [0, -0.95, -0.3] }); // calf cover over the hose
  shin.add(pipe([[0.12, -0.25, 0.1], [0.3, -0.5, 0.0], [0.3, -1.0, -0.05], [0.18, -1.35, 0.05]], 0.03, 14, 6), C.rubber); // hose loop
  shin.add(block(0.14, 0.16, 0.12, 0.02, 0.01), C.iron, { pos: [0, -0.95, -0.4] }); // ram lug
  shin.add(cyl(0.2, 0.46, 14), C.iron, { pos: [0, -L2 + 0.1, 0], rot: [0, 0, Math.PI / 2] });
  for (const sx of [-1, 1]) { shin.add(ring(0.205, 0.022, 14), C.brass, { pos: [sx * 0.2, -L2 + 0.1, 0], rot: [0, Math.PI / 2, 0] }); dome(shin, 0.024, [sx * 0.235, -L2 + 0.1, 0], [0, 0, -sx * Math.PI / 2]); }
  // hydraulic ram: a sleeve from the thigh lug and a polished rod from the shin lug, aimed at each other (unit length along +z)
  ramTube.add(turned([[0.0001, 0], [0.085, 0], [0.085, 0.92], [0.07, 0.96], [0.0001, 0.96]], 12), C.dark);
  for (const z of [0.15, 0.75]) ramTube.add(ring(0.088, 0.016, 12), C.brass, { pos: [0, 0, z] });
  ramTube.add(turned([[0.04, 0.9], [0.1, 0.9], [0.1, 1.0], [0.04, 1.0]], 12), C.iron);
  ramRod.add(turned([[0.0001, 0], [0.04, 0], [0.04, 0.98], [0.0001, 0.98]], 10), '#b9bcbc');
  ramRod.add(turned([[0.0001, 0], [0.075, 0], [0.075, 0.1], [0.0001, 0.1]], 10), C.iron);
  // foot: ankle ball under a bellows, a broad armoured pad with a tread, and a heel guard
  foot.add(cyl(0.3, 0.1, 16), C.steel, { pos: [0, WL.ankle + 0.06, 0] });
  foot.add(new THREE.SphereGeometry(0.24, 12, 8), C.iron, { pos: [0, WL.ankle + 0.06, 0] });
  for (const y of [0.14, 0.2, 0.26]) foot.add(ring(0.27 - (y - 0.14) * 0.5, 0.025, 14), C.rubber, { pos: [0, WL.ankle + y - 0.12, 0], rot: [Math.PI / 2, 0, 0] });
  foot.add(block(0.5, 0.3, 0.5, 0.05, 0.02), C.steel, { pos: [0, WL.ankle - 0.05, 0] });
  foot.add(profile([[-0.5, 0.0], [0.58, 0.0], [0.6, 0.1], [0.5, 0.22], [-0.45, 0.22]], 0.8, 0.04, 2), C.iron);
  foot.add(block(0.5, 0.1, 0.3, 0.02, 0.01), C.dark, { pos: [0, 0.07, -0.55] }); // heel
  for (let i = 0; i < 5; i++) foot.add(block(0.76, 0.03, 0.05, 0.008, 0.004), C.rubber, { pos: [0, 0.015, -0.4 + i * 0.2] }); // tread bars
  foot.add(block(0.46, 0.04, 0.34, 0.02, 0.01), paint, { pos: [0, 0.26, 0.2] }); // top plate
  for (const sx of [-1, 1]) dome(foot, 0.02, [sx * 0.3, 0.285, 0.3], [0, 0, 0]);
  // toes: three claws on a hinge bar, ridged on top; origin at the hinge (0, 0, 0), toes reach +z
  toes.add(cyl(0.09, 0.78, 10), C.steel, { pos: [0, 0.1, 0], rot: [0, 0, Math.PI / 2] });
  for (const x of [-0.26, 0, 0.26]) {
    toes.add(profile([[0.0, 0.0], [0.54, 0.0], [0.64, 0.07], [0.1, 0.17]], 0.2, 0.02, 1), C.dark, { pos: [x, 0, 0] });
    toes.add(block(0.06, 0.05, 0.38, 0.01, 0.005), C.iron, { pos: [x, 0.17, 0.28], rot: [-0.18, 0, 0] });
    toes.add(profile([[0.52, 0.0], [0.7, 0.02], [0.66, 0.09], [0.54, 0.09]], 0.14, 0.01, 1), C.steel, { pos: [x, 0, 0] }); // claw tip
  }
  return { thigh, shin, foot, toes, ramTube, ramRod };
}

const _ik = { A0: new THREE.Vector3(), R1: new THREE.Vector3(), R2: new THREE.Vector3(), Z: new THREE.Vector3(0, 0, 1), Q: new THREE.Quaternion(), H: new THREE.Vector3(), A: new THREE.Vector3(), K: new THREE.Vector3(), d: new THREE.Vector3(), pole: new THREE.Vector3(), inv: new THREE.Matrix4(), dn: new THREE.Vector3(0, -1, 0), tmp: new THREE.Vector3() };
const smooth = (u) => u * u * (3 - 2 * u);

function buildStriderModel(team) {
  const key = `walker${team}`;
  if (!modelCache.has(key)) {
    const p = striderParts(team), lg = striderLeg(team);
    const gk = new CKit(); for (const [g, pos, rot] of p.glow) gk.add(g, '#ffe9a8', { pos, rot });
    modelCache.set(key, { hull: p.hull.bake(), turret: p.turret.bake(), gun: p.gunK.bake(), glow: gk.bake(), thigh: lg.thigh.bake(), shin: lg.shin.bake(), foot: lg.foot.bake(), toes: lg.toes.bake(), ramTube: lg.ramTube.bake(), ramRod: lg.ramRod.bake() });
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
    const th = mesh(m.thigh), sh = mesh(m.shin), ft = mesh(m.foot), toe = mesh(m.toes), rt = mesh(m.ramTube), rr = mesh(m.ramRod);
    toe.position.set(0, 0, 0.58); ft.add(toe); // the toes hinge on the front of the pad
    root.add(th, sh, ft, rt, rr); meshes.push(th, sh, ft, toe, rt, rr);
    return { side, th, sh, ft, toe, rt, rr, fp: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), stepping: false, u: 0, dur: 0.45, init: false };
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
    _ik.R1.set(0, -0.5, -0.34).applyQuaternion(leg.th.quaternion).add(leg.th.position);
    _ik.R2.set(0, -0.95, -0.4).applyQuaternion(leg.sh.quaternion).add(leg.sh.position);
    _ik.d.subVectors(_ik.R2, _ik.R1);
    const rd = Math.max(0.2, _ik.d.length()); _ik.d.multiplyScalar(1 / rd);
    leg.rt.position.copy(_ik.R1); leg.rt.quaternion.setFromUnitVectors(_ik.Z, _ik.d); leg.rt.scale.set(1, 1, rd * 0.62);
    leg.rr.position.copy(_ik.R2); leg.rr.quaternion.setFromUnitVectors(_ik.Z, _ik.d.negate()); leg.rr.scale.set(1, 1, rd * 0.5);
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
    yawGoal = -str * d.turn * (1 - Math.min(0.55, Math.abs(this.speed) / d.maxSpeed * 0.5)) * (this.speed < -0.3 ? -1 : 1);
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
    // ---- tracks and wheels, sound, smoke
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
        if (top < this.pos.y + d.step) continue; // a kerb: roll over it
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
    if (!this.engine && battle.audio?.ctx) this.engine = battle.audio.engine('walker');
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

