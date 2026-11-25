import * as THREE from 'three';
import { profile, turned, rod, ring, pipe } from './models.js';
import { TEAMS } from './factions.js';
import { height } from './terrain.js';
import { VEHICLES, CKit, C, P, BODY, clamp, bakeKits, buildLods, makeSkeleton, skinnedBody, slab, blk, cyl, cone } from './vkit.js';

// The Bulwark: a heavy tracked gun carrier, low and wide where the strider is tall and narrow. A hull tub between
// two track runs, an upper hull over it, and a turret on a real ring with the gun in a cradle. Each track side is
// a closed belt of 78 links driven round a high rear sprocket and a front idler on seven road wheels, each wheel
// on its own swing arm that rises and falls with the ground; the belt itself is moved in the vertex shader (every
// link rides along the loop, and the lower run follows the wheels), so the whole running gear is two draw calls.
// The body, turret and wheels are one skinned mesh; the gun is its own mesh so it can recoil and stay in the
// cockpit view. Two seats: the driver (who also works the gun when alone) and a gunner riding an AI-driven tank.
VEHICLES.tank = {
  name: 'Bulwark', drive: 'tracked', seats: 2, engine: 'diesel',
  hx: 1.75, hz: 3.5, rad: 2.5, h: 2.6, lift: 0, eyeH: 3.1,
  hp: 1150, armor: { bullet: 0.035, blast: 0.5, plasma: 0.55, flame: 0.08 },
  maxSpeed: 9.5, maxRev: 4, accel: 2.1, brake: 6.5, turn: 0.85, maxSlope: 0.85, tilt: 1,
  mass: 70, camDist: 15, camHeight: 4.2, camUp: 5.4, camSide: 1.5, cockpit: [-0.5, 3.0, -0.7], cockpitKind: 'tank',
  step: 0.8, crush: true, crushH: 2.0, runover: 140,
  exhaustAt: [[1.2, 1.95, -3.2], [-1.2, 1.95, -3.2]], leaks: [[0.6, 1.5, -2.8], [-0.7, 1.5, -2.6], [0, 2.2, -1.9]], dustX: 1.45, dustBack: 3.2,
  hint: 'WASD drive · click cannon · right-click machine gun · Space brakes · X leaves',
  turret: { rate: 0.85, pitchRate: 0.7, pitchMin: -0.13, pitchMax: 0.4, pivot: [0, 1.8, -0.25] },
  weapons: [
    { id: 'cannon', name: 'Cannon', ai: 'heavy', kind: 'projectile', proj: 'shell', damage: 270, radius: 5.8, speed: 150, gravity: 10, interval: 3.4, spread: 0.007, sound: 'cannon', mag: Infinity, reserve: Infinity, range: 230, minRange: 14, burst: [1, 1], vehicleGun: true, smoky: true },
    { id: 'coax', name: 'Machine gun', ai: 'light', kind: 'hitscan', damage: 22, interval: 0.085, spread: 0.016, sound: 'mg', mag: Infinity, reserve: Infinity, range: 140, tracer: '#ffc070', burst: [10, 18], vehicleGun: true, noRecoil: true },
  ],
};

// ---------------- the track loop ----------------
// the centre line of the belt in (z, y): a big rear sprocket and a smaller front idler, joined top and bottom by tangent
// lines, traversed clockwise (the upper run goes forward). `at(s)` gives the point and tangent at distance s along it.
const SPR = { z: -2.75, y: 0.70, r: 0.61 }, IDL = { z: 2.95, y: 0.62, r: 0.53 };
const TX = 1.42; // the track centre line, out from the middle
const LOOP = (() => {
  const dz = IDL.z - SPR.z, dy = IDL.y - SPR.y, d = Math.hypot(dz, dy), psi = Math.atan2(dy, dz), k = Math.acos((SPR.r - IDL.r) / d);
  const th = psi + k, tb = psi - k; // the outward normal angle of the top and bottom tangent lines
  const pt = (c, t) => [c.z + c.r * Math.cos(t), c.y + c.r * Math.sin(t)];
  const a1 = pt(SPR, th), a2 = pt(IDL, th), b2 = pt(IDL, tb), b1 = pt(SPR, tb);
  const top = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]), bot = Math.hypot(b2[0] - b1[0], b2[1] - b1[1]);
  const Sf = th - tb, Sr = tb - th + Math.PI * 2;
  const L = top + IDL.r * Sf + bot + SPR.r * Sr;
  const at = (s) => {
    s = ((s % L) + L) % L;
    if (s < top) { const f = s / top; return [a1[0] + (a2[0] - a1[0]) * f, a1[1] + (a2[1] - a1[1]) * f, (a2[0] - a1[0]) / top, (a2[1] - a1[1]) / top]; }
    s -= top;
    if (s < IDL.r * Sf) { const t = th - s / IDL.r; return [IDL.z + IDL.r * Math.cos(t), IDL.y + IDL.r * Math.sin(t), Math.sin(t), -Math.cos(t)]; }
    s -= IDL.r * Sf;
    if (s < bot) { const f = s / bot; return [b2[0] + (b1[0] - b2[0]) * f, b2[1] + (b1[1] - b2[1]) * f, (b1[0] - b2[0]) / bot, (b1[1] - b2[1]) / bot]; }
    s -= bot;
    const t = tb - s / SPR.r; return [SPR.z + SPR.r * Math.cos(t), SPR.y + SPR.r * Math.sin(t), Math.sin(t), -Math.cos(t)];
  };
  return { L, at, top: [a1, a2], th };
})();
const LINKS = 78, PITCH = LOOP.L / LINKS;
const M = 256; // samples in the loop texture
let loopTex = null;
function loopTexture() {
  if (loopTex) return loopTex;
  const d = new Float32Array(M * 4);
  for (let i = 0; i < M; i++) { const p = LOOP.at(i / M * LOOP.L); d.set([p[0], p[1], p[2], p[3]], i * 4); }
  loopTex = new THREE.DataTexture(d, M, 1, THREE.RGBAFormat, THREE.FloatType);
  loopTex.minFilter = loopTex.magFilter = THREE.NearestFilter; loopTex.needsUpdate = true;
  return loopTex;
}
const WZ = [-2.04, -1.36, -0.68, 0, 0.68, 1.36, 2.04], WR = 0.40, WY = 0.535; // road wheels: where, how big, how high the axles sit

// one link of the belt in its own frame (z along the belt, y outward, x across), then every link of one side
// laid on the loop: `position` is the rest pose, aL/aN let the shader move it
function linkGeo(skip) {
  const pitch = PITCH * skip;
  const box = (w, h, d, x, y, z, col) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); return { g, col }; };
  const list = [box(0.6, 0.095, pitch * 1.04, 0, 0.0025, 0, '#303230'), box(0.56, 0.035, pitch * 0.4, 0, 0.0675, 0, '#242523'), box(0.07, 0.1, pitch * 0.5, 0, -0.095, 0, '#3a3b38')];
  return { list, pitch };
}
function trackGeo(skip) {
  const { list, pitch } = linkGeo(skip), n = LINKS / skip;
  const pos = [], nor = [], col = [], aL = [], aN = [];
  const c = new THREE.Color();
  for (const sx of [1, -1]) for (let i = 0; i < n; i++) {
    const s0 = (i + 0.5) * pitch, [pz, py, tz, ty] = LOOP.at(s0);
    const hh = Math.sin((i + (sx > 0 ? 0 : 41)) * 12.9898) * 43758.5453, j = 1 + (hh - Math.floor(hh)) * 0.18 - 0.09;
    for (const { g, col: hex } of list) {
      const p = g.attributes.position, nn = g.attributes.normal;
      c.set(hex).multiplyScalar(j);
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        // frame: t = (0, ty, tz), n = (0, tz, -ty) in (x, y, z)
        pos.push(x + sx * TX, py + tz * y + ty * z, pz - ty * y + tz * z);
        const nx = nn.getX(k), ny = nn.getY(k), nz = nn.getZ(k);
        nor.push(nx, tz * ny + ty * nz, -ty * ny + tz * nz);
        col.push(c.r, c.g, c.b);
        aL.push(s0, z, y, x + sx * TX); aN.push(nz, ny, nx);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aL', new THREE.Float32BufferAttribute(aL, 4));
  g.setAttribute('aN', new THREE.Float32BufferAttribute(aN, 3));
  g.computeBoundingSphere();
  return g;
}
// each tank has its own belt material (its own phase and suspension uniforms); the program is shared
function trackMaterial() {
  const u = { uLoop: { value: loopTexture() }, uLoopInfo: { value: new THREE.Vector2(M, LOOP.L) }, uPhase: { value: new THREE.Vector2() }, uSusp: { value: new Float32Array(14) } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.5 });
  m.customProgramCacheKey = () => 'tank-track';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aL; attribute vec3 aN;
uniform highp sampler2D uLoop; uniform vec2 uLoopInfo; uniform vec2 uPhase; uniform float uSusp[14];
vec3 tkPos; vec3 tkNor;
void trackLink() {
  float side = aL.w > 0.0 ? 1.0 : -1.0;
  float s = mod(aL.x + (side > 0.0 ? uPhase.x : uPhase.y), uLoopInfo.y);
  float f = s / uLoopInfo.y * uLoopInfo.x;
  int i0 = int(floor(f)); int i1 = i0 + 1; if (i1 >= int(uLoopInfo.x)) i1 = 0;
  float fr = f - float(i0);
  vec4 a = texelFetch(uLoop, ivec2(i0, 0), 0), b = texelFetch(uLoop, ivec2(i1, 0), 0);
  vec2 p = mix(a.xy, b.xy, fr), t = normalize(mix(a.zw, b.zw, fr)), n = vec2(-t.y, t.x);
  vec2 q = p + t * aL.y + n * aL.z;
  float zi = clamp((q.x + 2.04) / 0.68, 0.0, 6.0); int k = int(floor(zi)); int k2 = min(k + 1, 6);
  int o = side > 0.0 ? 0 : 7;
  q.y += mix(uSusp[o + k], uSusp[o + k2], zi - float(k)) * (1.0 - smoothstep(0.35, 0.8, p.y));
  tkPos = vec3(aL.w, q.y, q.x);
  tkNor = vec3(0.0, t.y, t.x) * aN.x + vec3(0.0, n.y, n.x) * aN.y + vec3(1.0, 0.0, 0.0) * aN.z;
}`)
      .replace('#include <beginnormal_vertex>', 'trackLink();\nvec3 objectNormal = tkNor;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = tkPos;');
  };
  m.userData.u = u;
  return m;
}

// ---------------- the skeleton ----------------
// hull, turret, then per side (left = +x first): 7 swing arms, 7 road wheels (children of their arms), 3 return rollers, the sprocket, the idler
const SIDE = 19, B0 = 2;
const ROLL = [[-1.6, 0.0], [0.0, 0.0], [1.6, 0.0]].map(([z]) => { const [a1, a2] = LOOP.top; const y = a1[1] + (a2[1] - a1[1]) * (z - a1[0]) / (a2[0] - a1[0]) - 0.045 - 0.135; return [z, y]; });
const BONES = [{ name: 'hull', parent: -1, anchor: [0, 0, 0] }, { name: 'turret', parent: -1, anchor: [0, 1.8, -0.25] }];
for (const sx of [1, -1]) {
  const b = BONES.length;
  for (let i = 0; i < 7; i++) BONES.push({ name: 'arm', parent: 0, anchor: [sx * 1.16, 0.66, WZ[i] + 0.38] });
  for (let i = 0; i < 7; i++) BONES.push({ name: 'wheel', parent: b + i, anchor: [sx * TX, WY, WZ[i]] });
  for (let i = 0; i < 3; i++) BONES.push({ name: 'roller', parent: 0, anchor: [sx * TX, ROLL[i][1], ROLL[i][0]] });
  BONES.push({ name: 'sprocket', parent: 0, anchor: [sx * TX, SPR.y, SPR.z] });
  BONES.push({ name: 'idler', parent: 0, anchor: [sx * TX, IDL.y, IDL.z] });
}

const GUN_AT = [0, 0.58, 1.2];

function tankParts(team) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = P(T.body), trim = P(T.trim);
  const hull = new CKit('hull', 0, [0, 0, 0]), turret = new CKit('turret', 1, BONES[1].anchor, 0.2);
  const dome = (kit, r, pos, rot, col = C.steel) => kit.add(new THREE.SphereGeometry(r, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2), col, { pos, rot, minor: true });
  const bolts = (kit, a, b, n, rot, r = 0.025) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); dome(kit, r, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], rot); } };
  // ---- the lower hull: a tub between the tracks with a sharp pike nose, and the upper hull over it
  hull.add(profile([[-3.4, 0.58], [-3.4, 1.3], [-3.1, 1.4], [-1.85, 1.4], [-1.55, 1.52], [2.35, 1.52], [3.45, 0.96], [3.52, 0.78], [3.0, 0.58]], 2.2, 0.05, 2), paint, { wear: 0.4 });
  hull.add(profile([[-2.1, 1.36], [-2.1, 1.72], [-1.9, 1.8], [1.7, 1.8], [2.2, 1.62], [2.2, 1.36]], 3.1, 0.04, 2), paint, { wear: 0.35 });
  for (const s of [-1, 1]) hull.add(slab(0.05, 0.1, 3.7), trim, { pos: [s * 1.575, 1.58, -0.1], wear: 0.45 }); // the army's stripe along the upper hull
  // fenders over the tracks, a mudguard curling down over the idler, and a rear lip
  for (const s of [-1, 1]) {
    hull.add(profile([[2.2, 1.4], [3.1, 1.42], [3.55, 1.3], [3.64, 1.12], [3.56, 1.1], [3.05, 1.36], [2.2, 1.36]], 0.66, 0.012, 1), paint, { pos: [s * 1.42, 0, 0], wear: 0.6 });
    hull.add(slab(0.66, 0.05, 1.5), paint, { pos: [s * 1.42, 1.42, -2.7], wear: 0.6 });
    hull.add(slab(0.66, 0.2, 0.04), paint, { pos: [s * 1.42, 1.34, -3.43], wear: 0.6, minor: true });
    // side skirts hung from the fender edge over the upper wheels, gaps between plates, a few dished in by the day's work
    for (let i = 0; i < 6; i++) {
      const z = -2.25 + i * 0.86;
      hull.add(slab(0.035, 0.6, 0.78), paint, { pos: [s * 1.79, 1.1, z], wear: 0.7 });
      hull.add(slab(0.05, 0.05, 0.8), C.dark, { pos: [s * 1.78, 1.42, z], minor: true });
      hull.add(slab(0.03, 0.025, 0.74), C.dark, { pos: [s * 1.81, 0.95, z], minor: true }); // a stiffening fold
    }
    // stowage on the front and rear fenders: a tool box, a spare roadwheel's worth of links, a shovel and a jack
    hull.add(blk(0.46, 0.3, 0.84, 0.04, 0.012), C.canvas, { pos: [s * 1.5, 1.6, -2.75], wear: 0.6 });
    hull.add(slab(0.5, 0.025, 0.88), C.dark, { pos: [s * 1.5, 1.77, -2.75], minor: true });
    hull.add(slab(0.4, 0.06, 0.7), C.steel, { pos: [s * 1.52, 1.47, 2.7], wear: 0.6 });
    for (let i = 0; i < 4; i++) hull.add(slab(0.3, 0.035, 0.2), P('#303230'), { pos: [s * 1.52, 1.52 + i * 0.04, 2.55 + (i % 2) * 0.1], minor: true });
    hull.add(slab(0.05, 0.02, 0.8), P('#6a4a2f', 'cloth'), { pos: [s * 1.82, 1.5, 0.9], minor: true }); // shovel handle
    hull.add(slab(0.2, 0.012, 0.28), C.steel, { pos: [s * 1.82, 1.5, 1.45], minor: true }); // shovel blade
    // headlamp in a cage on the mudguard
    hull.add(cyl(0.1, 0.18, 10), C.dark, { pos: [s * 1.3, 1.5, 3.3], rot: [Math.PI / 2, 0, 0], minor: true });
  }
  // ---- the bow: the driver's hatch and vision blocks on the left, a ball-mounted machine gun on the right, tow hooks, spare links, the tow cable
  hull.add(cyl(0.34, 0.07, 16), C.steel, { pos: [0.55, 1.55, 2.55], wear: 0.5 });
  hull.add(cyl(0.38, 0.06, 16), C.iron, { pos: [0.55, 1.51, 2.55], minor: true });
  hull.add(slab(0.5, 0.05, 0.1), C.dark, { pos: [0.55, 1.6, 2.28], minor: true });
  for (const x of [0.28, 0.55, 0.82]) hull.add(slab(0.18, 0.1, 0.1), C.glass, { pos: [x, 1.66, 2.82], rot: [0.3, 0, 0], minor: true });
  hull.add(slab(0.45, 0.09, 0.14), C.dark, { pos: [0.55, 1.32, 3.1], rot: [-0.9, 0, 0], minor: true }); // the driver's visor in the glacis
  hull.add(new THREE.SphereGeometry(0.17, 8, 5), C.steel, { pos: [-0.65, 1.2, 3.02] });
  hull.add(rod(0.03, 0.1, 0.65, 6), C.dark, { pos: [-0.65, 1.2, 3.02], minor: true });
  for (const x of [-0.95, 0.95]) {
    hull.add(ring(0.1, 0.028, 8), C.steel, { pos: [x, 0.78, 3.53], rot: [0, 0, 0], minor: true });
    hull.add(blk(0.2, 0.1, 0.1, 0.02, 0.008), C.iron, { pos: [x, 0.78, 3.47], minor: true });
  }
  hull.add(pipe([[-1.0, 1.42, 3.0], [-0.3, 1.18, 3.2], [0.4, 1.12, 3.25], [1.0, 1.4, 3.0]], 0.035, 12, 5), C.rubber, { minor: true }); // the tow cable across the nose
  for (let i = 0; i < 5; i++) hull.add(slab(0.5, 0.05, 0.18), P('#303230'), { pos: [-0.2 - i * 0.0, 1.3 + 0.0, 2.65 + i * 0.12], rot: [-0.78, 0, 0], minor: true });
  // weld beads and panel seams: along the glacis edges, the roof, the fighting compartment's flanks
  for (const x of [-1.04, 1.04]) hull.add(slab(0.03, 0.025, 1.4), C.dark, { pos: [x, 1.2, 2.9], rot: [-0.47, 0, 0], minor: true });
  hull.add(slab(2.1, 0.02, 0.03), C.dark, { pos: [0, 1.53, 2.35], minor: true });
  hull.add(slab(2.1, 0.02, 0.03), C.dark, { pos: [0, 1.53, -1.55], minor: true });
  for (const z of [-1.0, 0.9]) hull.add(slab(3.0, 0.015, 0.025), C.dark, { pos: [0, 1.805, z], minor: true });
  for (const s of [-1, 1]) {
    for (const z of [-1.4, -0.2, 1.0]) hull.add(slab(0.02, 0.34, 0.025), C.dark, { pos: [s * 1.56, 1.6, z], minor: true });
    bolts(hull, [s * 1.56, 1.72, -1.9], [s * 1.56, 1.72, 2.0], 9, [0, 0, -s * Math.PI / 2]);
  }
  // ---- the engine deck: louvres, two fan grilles, the stacks on the rear corners, a tarpaulin roll lashed across the back
  hull.add(slab(2.2, 0.03, 0.9), C.dark, { pos: [0, 1.405, -2.6] });
  for (let i = 0; i < 7; i++) hull.add(slab(1.9, 0.03, 0.06), C.steel, { pos: [0, 1.43, -3.15 + i * 0.1], rot: [0.3, 0, 0], minor: i % 2 === 1 });
  for (const s of [-1, 1]) {
    hull.add(ring(0.4, 0.03, 14), C.steel, { pos: [s * 0.62, 1.435, -2.45], rot: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 4; i++) hull.add(slab(0.8, 0.012, 0.025), C.steel, { pos: [s * 0.62, 1.44, -2.45], rot: [0, i * Math.PI / 4, 0], minor: true });
    // exhaust: a pipe off the deck's rear corner, up and back into a mouth under a heat shield
    hull.add(pipe([[s * 1.2, 1.4, -3.0], [s * 1.2, 1.78, -3.0], [s * 1.2, 1.95, -3.2]], 0.1, 8, 7), C.iron);
    hull.add(cyl(0.12, 0.06, 10), C.dark, { pos: [s * 1.2, 1.97, -3.22], rot: [0.7, 0, 0], minor: true });
    hull.add(profile([[-3.3, 1.62], [-2.7, 1.62], [-2.7, 1.88], [-3.3, 1.88]], 0.34, 0.01, 1), C.steel, { pos: [s * 1.2, 0, 0], minor: true });
    hull.add(slab(0.03, 0.4, 0.04), C.iron, { pos: [s * 1.2, 1.6, -2.9], minor: true });
  }
  hull.add(cyl(0.26, 1.7, 12), P('#5d6240'), { pos: [0, 1.72, -3.2], rot: [0, 0, Math.PI / 2], wear: 0.6 }); // a fuel drum across the back of the deck
  for (const x of [-0.5, 0.5]) hull.add(ring(0.265, 0.02, 10), C.dark, { pos: [x, 1.72, -3.2], rot: [0, Math.PI / 2, 0], minor: true });
  hull.add(slab(0.4, 0.4, 0.04), trim, { pos: [0, 1.0, -3.43], wear: 0.5 }); // the rear marking plate
  hull.add(ring(0.12, 0.03, 8), C.steel, { pos: [0, 0.8, -3.46], minor: true }); // rear tow ring
  // ---- the turret ring and race on the hull roof
  hull.add(cyl(1.12, 0.1, 22), C.dark, { pos: [0, 1.82, -0.25] });
  // ---- the turret: a twelve-sided cast body with sloped sides and flats front, back and sides; bustle; cupola; hatches; sights
  const body = new THREE.CylinderGeometry(0.88, 1.06, 0.88, 12); body.rotateY(Math.PI / 12); body.scale(1, 1, 1.38);
  turret.add(cyl(1.02, 0.14, 22), C.steel, { pos: [0, 0.07, 0] });
  turret.add(ring(1.0, 0.03, 22), C.brass, { pos: [0, 0.15, 0], rot: [Math.PI / 2, 0, 0], minor: true });
  turret.add(body, paint, { pos: [0, 0.58, 0], wear: 0.4 });
  turret.add(slab(1.93, 0.03, 0.04), C.dark, { pos: [0, 0.8, 1.19], minor: true });
  turret.add(profile([[-1.9, 0.14], [-1.9, 0.78], [-1.58, 0.94], [-1.0, 0.98], [-1.0, 0.14]], 1.6, 0.04, 2), paint, { wear: 0.5 }); // the bustle
  for (const x of [-0.45, 0.45]) turret.add(slab(0.05, 0.62, 0.04), C.dark, { pos: [x, 0.52, -1.92], minor: true }); // its door's seams
  turret.add(slab(1.45, 0.05, 0.05), trim, { pos: [0, 0.47, -1.93], minor: true });
  // the front: the gun port in a recessed frame, angled cheek plates beside it, a chin
  turret.add(blk(1.34, 0.86, 0.2, 0.08, 0.02), C.dark, { pos: [0, 0.6, 1.22] });
  for (const s of [-1, 1]) {
    turret.add(slab(0.5, 0.78, 0.07), paint, { pos: [s * 0.82, 0.58, 1.12], rot: [0, -s * 0.55, 0], wear: 0.5 });
    bolts(turret, [s * 0.66, 0.9, 1.28], [s * 0.98, 0.9, 1.05], 3, [Math.PI / 2, 0, 0]);
    // smoke dischargers in a bank on each cheek
    for (let i = 0; i < 3; i++) turret.add(cyl(0.045, 0.28, 8), C.dark, { pos: [s * (1.02 + i * 0.1), 0.8, 0.62 - i * 0.12], rot: [0.5, 0, -s * 0.35], minor: true });
    // a rack of spare links and a bedroll on the cheeks and bustle
    for (let i = 0; i < 4; i++) turret.add(slab(0.08, 0.2, 0.34), P('#303230'), { pos: [s * 1.2, 0.5, -0.3 - i * 0.36], rot: [0, 0, s * 0.18], minor: true });
    turret.add(slab(0.04, 0.2, 1.6), C.dark, { pos: [s * 1.1, 0.27, -0.75], minor: true });
    // a handrail round the bustle roof
    turret.add(pipe([[s * 0.72, 0.99, -1.0], [s * 0.78, 1.04, -1.4], [s * 0.7, 1.0, -1.82]], 0.02, 8, 4), C.steel, { minor: true });
  }
  turret.add(cyl(0.12, 0.8, 10), C.canvas, { pos: [0, 1.08, -1.55], rot: [0, 0, Math.PI / 2], wear: 0.6 }); // a tarpaulin roll across the bustle roof
  for (const x of [-0.25, 0.25]) turret.add(ring(0.125, 0.015, 10), C.dark, { pos: [x, 1.08, -1.55], rot: [0, Math.PI / 2, 0], minor: true });
  // commander's cupola on the right: a drum with eight vision slits, a ring, a hatch standing open on its hinge, a pintle with a machine gun
  turret.add(cyl(0.36, 0.2, 14), C.steel, { pos: [-0.5, 1.12, -0.5], wear: 0.5 });
  turret.add(ring(0.36, 0.035, 14), C.iron, { pos: [-0.5, 1.23, -0.5], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; turret.add(slab(0.11, 0.04, 0.025), C.glass, { pos: [-0.5 + Math.sin(a) * 0.365, 1.14, -0.5 + Math.cos(a) * 0.365], rot: [0, a, 0], minor: true }); }
  turret.add(cyl(0.3, 0.05, 14), C.steel, { pos: [-0.52, 1.5, -0.88], rot: [0.95, 0, 0], wear: 0.5 }); // the hatch lid, swung up
  turret.add(slab(0.06, 0.18, 0.04), C.iron, { pos: [-0.5, 1.28, -0.84], minor: true });
  turret.add(cyl(0.025, 0.4, 6), C.steel, { pos: [-0.5, 1.4, -0.35], minor: true }); // the pintle post
  turret.add(blk(0.16, 0.18, 0.5, 0.02, 0.01), C.dark, { pos: [-0.5, 1.62, -0.2], minor: true });
  turret.add(rod(0.025, 0.1, 0.75, 6), C.steel, { pos: [-0.5, 1.64, -0.2], minor: true });
  turret.add(slab(0.4, 0.3, 0.02), C.iron, { pos: [-0.5, 1.7, 0.1], minor: true }); // the gun shield
  // loader's hatch on the left, a round lid with a hinge and a handle; a periscope beside it
  turret.add(cyl(0.3, 0.04, 14), C.iron, { pos: [0.55, 1.0, -0.62], wear: 0.5 });
  turret.add(ring(0.3, 0.025, 14), C.steel, { pos: [0.55, 1.02, -0.62], rot: [Math.PI / 2, 0, 0], minor: true });
  turret.add(slab(0.2, 0.05, 0.06), C.dark, { pos: [0.55, 1.04, -0.35], minor: true });
  turret.add(slab(0.12, 0.12, 0.12), C.glass, { pos: [0.55, 1.02, 0.0], minor: true });
  // the gunner's sight: an armoured box on the roof forward of the loader, a lens in its face, a hood
  turret.add(blk(0.34, 0.24, 0.4, 0.04, 0.012), C.iron, { pos: [0.5, 1.1, 0.62] });
  turret.add(slab(0.2, 0.12, 0.02), C.glass, { pos: [0.5, 1.1, 0.83] });
  turret.add(slab(0.4, 0.03, 0.2), C.dark, { pos: [0.5, 1.24, 0.72], rot: [0.2, 0, 0], minor: true });
  // aerial on the bustle, a lamp on the roof
  turret.add(cyl(0.07, 0.1, 8), C.dark, { pos: [0.7, 1.03, -1.65], minor: true });
  turret.add(rod(0.01, 0, 1.9, 5), C.dark, { pos: [0.7, 1.08, -1.65], rot: [-Math.PI / 2 + 0.08, 0, 0.05], minor: true });
  // ---- running gear: wheels on swing arms, return rollers, drive sprocket, idler
  const wheels = [], rollers = [], sprockets = [];
  for (const sx of [1, -1]) {
    const b = B0 + (sx > 0 ? 0 : SIDE);
    const kits = { arms: [], wheels: [], rollers: [], sprocket: null, idler: null };
    for (let i = 0; i < 7; i++) {
      const arm = new CKit('arm', b + i, BONES[b + i].anchor, 1.3), wh = new CKit('wheel', b + 7 + i, BONES[b + 7 + i].anchor, 1.6);
      // the arm: a plate from its pivot boss on the hull wall to the axle
      arm.add(cyl(0.11, 0.1, 10), C.iron, { pos: [-sx * 0.04, 0, 0], rot: [0, 0, Math.PI / 2] });
      arm.add(slab(0.09, 0.16, 0.5), C.steel, { pos: [-sx * 0.02, -0.062, -0.19], rot: [-0.318, 0, 0], wear: 0.55 }); // down and back to the axle
      arm.add(cyl(0.05, 0.1, 8), C.dark, { pos: [-sx * 0.04, 0, 0], rot: [0, 0, Math.PI / 2], minor: true });
      // the wheel is in its own frame at the axle: two rubber-tyred discs either side of the guide horns
      for (const dx of [-0.14, 0.14]) {
        wh.add(cyl(WR, 0.12, 14), C.rubber, { pos: [sx * 0 + dx, 0, 0], rot: [0, 0, Math.PI / 2] });
        wh.add(cyl(0.29, 0.135, 14), C.steel, { pos: [dx, 0, 0], rot: [0, 0, Math.PI / 2], wear: 0.55 });
        wh.add(cyl(0.12, 0.17, 10), C.iron, { pos: [dx + Math.sign(dx) * 0.01, 0, 0], rot: [0, 0, Math.PI / 2] });
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; wh.add(cyl(0.04, 0.16, 4), C.dark, { pos: [dx, Math.cos(a) * 0.2, Math.sin(a) * 0.2], rot: [0, 0, Math.PI / 2], minor: true }); }
      }
      wh.add(cyl(0.06, 0.62, 8), C.dark, { rot: [0, 0, Math.PI / 2] }); // the axle, out to the arm
      wh.add(cyl(0.1, 0.05, 8), C.brass, { pos: [sx * 0.3, 0, 0], rot: [0, 0, Math.PI / 2], minor: true });
      kits.arms.push(arm); kits.wheels.push(wh);
    }
    for (let i = 0; i < 3; i++) {
      const r = new CKit('roller', b + 14 + i, BONES[b + 14 + i].anchor, 1.2);
      for (const dx of [-0.12, 0.12]) r.add(cyl(0.13, 0.1, 10), C.rubber, { pos: [dx, 0, 0], rot: [0, 0, Math.PI / 2] });
      r.add(cyl(0.1, 0.34, 8), C.steel, { rot: [0, 0, Math.PI / 2], minor: true });
      r.add(cyl(0.05, 0.5, 8), C.dark, { pos: [-sx * 0.25, 0, 0], rot: [0, 0, Math.PI / 2] }); // the stub back to the hull wall
      kits.rollers.push(r);
    }
    const sp = new CKit('sprocket', b + 17, BONES[b + 17].anchor, 1.4);
    for (const dx of [-0.13, 0.13]) {
      sp.add(cyl(0.5, 0.06, 18), C.steel, { pos: [dx, 0, 0], rot: [0, 0, Math.PI / 2], wear: 0.6 });
      for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; sp.add(slab(0.07, 0.1, 0.1), C.dark, { pos: [dx, Math.cos(a) * 0.52, Math.sin(a) * 0.52], rot: [-a, 0, 0], wear: 0.7, minor: k % 2 === 1 }); }
    }
    sp.add(cyl(0.2, 0.44, 12), C.iron, { rot: [0, 0, Math.PI / 2] });
    sp.add(cyl(0.07, 0.56, 8), C.dark, { pos: [-sx * 0.35, 0, 0], rot: [0, 0, Math.PI / 2] }); // out of the final drive housing on the hull
    sp.add(cyl(0.22, 0.12, 12), C.iron, { pos: [-sx * 0.58, 0, 0], rot: [0, 0, Math.PI / 2] });
    const id = new CKit('idler', b + 18, BONES[b + 18].anchor, 1.4);
    for (const dx of [-0.13, 0.13]) { id.add(cyl(0.46, 0.08, 16), C.steel, { pos: [dx, 0, 0], rot: [0, 0, Math.PI / 2], wear: 0.6 }); id.add(cyl(0.2, 0.1, 10), C.iron, { pos: [dx, 0, 0], rot: [0, 0, Math.PI / 2], minor: true }); }
    id.add(cyl(0.12, 0.44, 10), C.iron, { rot: [0, 0, Math.PI / 2] });
    id.add(cyl(0.06, 0.6, 8), C.dark, { pos: [-sx * 0.35, 0, 0], rot: [0, 0, Math.PI / 2] }); // the adjuster arm's stub into the hull
    kits.sprocket = sp; kits.idler = id;
    wheels.push(...kits.arms, ...kits.wheels); rollers.push(...kits.rollers); sprockets.push(sp, id);
  }
  // ---- damage overlays
  for (const s of [-1, 1]) {
    hull.add(slab(0.02, 0.5, 1.2), C.scorch, { pos: [s * 1.575, 1.58, 0.35], tier: 1 }); // scorched flanks
    hull.add(slab(0.03, 0.55, 0.78), paint, { pos: [s * 1.95, 1.0, -0.65], rot: [0, 0, s * 0.5], tier: 1 }); // a skirt plate hanging off its fender
    hull.add(slab(0.4, 0.04, 0.6), C.dark, { pos: [s * 1.45, 1.35, 3.3], rot: [0.3, 0, s * 0.15], tier: 1 }); // a crumpled mudguard
  }
  turret.add(slab(1.0, 0.012, 0.9), C.scorch, { pos: [0, 1.03, 0.1], tier: 1 });
  turret.add(slab(0.02, 0.4, 0.9), C.scorch, { pos: [-1.0, 0.6, 0.3], tier: 1 });
  turret.add(new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), C.scorch, { pos: [0.98, 0.6, 0.55], rot: [0, 0, -Math.PI / 2], scale: [0.5, 1, 1], tier: 1 }); // a dent where a shell glanced off
  turret.add(slab(0.14, 0.18, 0.4), C.dark, { pos: [0.5, 1.1, 0.62], rot: [0, 0.25, 0.35], tier: 1 }); // the sight box knocked askew
  hull.add(slab(2.0, 0.04, 1.2), C.dark, { pos: [0, 1.46, -2.6], rot: [0, 0, 0.14], tier: 2 }); // the engine deck torn open
  for (const x of [-0.6, 0, 0.6]) hull.add(cyl(0.05, 0.9, 6), C.iron, { pos: [x, 1.38, -2.7], rot: [0.8, 0, 0], tier: 2 });
  hull.add(cyl(0.34, 0.5, 8), C.dark, { pos: [0, 1.55, -2.4], tier: 2 }); // the engine block showing
  hull.add(pipe([[1.2, 1.78, -3.0], [1.4, 1.95, -3.2], [1.75, 1.85, -3.4]], 0.1, 6, 6), C.dark, { tier: 2 }); // a stack torn over
  hull.add(slab(0.02, 1.2, 2.5), C.scorch, { pos: [1.58, 1.4, -0.7], tier: 2 });
  turret.add(slab(1.0, 0.04, 0.5), C.dark, { pos: [0.1, 1.12, -1.2], rot: [-0.3, 0, 0.1], tier: 2 }); // the bustle lid sprung
  turret.add(slab(0.45, 0.02, 0.3), C.dark, { pos: [-0.5, 1.28, -0.5], rot: [0.4, 0, 0.4], tier: 2 });
  return { hull, turret, running: [...wheels, ...rollers, ...sprockets], paint, trim };
}

// ---- the gun: the cradle with its mantlet and the coax (fixed to the cradle, pitching with it) and the barrel that recoils
function gunParts(team) {
  const T = TEAMS[team] || TEAMS[0];
  const paint = P(T.body);
  const cradle = new CKit('cradle'), barrel = new CKit('barrel');
  cradle.add(blk(1.0, 0.66, 0.28, 0.12, 0.05), paint, { pos: [0, 0, 0.14], wear: 0.5 }); // the mantlet
  cradle.add(slab(1.06, 0.05, 0.1), C.dark, { pos: [0, 0.3, 0.2], minor: true });
  for (const s of [-1, 1]) { cradle.add(cyl(0.14, 0.08, 12), C.iron, { pos: [s * 0.54, 0, 0], rot: [0, 0, Math.PI / 2], minor: true }); }
  cradle.add(ring(0.18, 0.05, 14), C.steel, { pos: [0, 0, 0.32] });
  cradle.add(cone(0.3, 0.15, 0.5, 12), C.canvas, { pos: [0, 0, 0.52], rot: [Math.PI / 2, 0, 0], wear: 0.55 }); // the canvas cover round the barrel's root
  for (const z of [0.4, 0.56]) cradle.add(ring(0.2 - (z - 0.4) * 0.3, 0.012, 12), C.dark, { pos: [0, 0, z], minor: true });
  // the coax machine gun in its own port beside the main gun
  cradle.add(cyl(0.08, 0.2, 10), C.iron, { pos: [0.34, -0.04, 0.3], rot: [Math.PI / 2, 0, 0] });
  cradle.add(turned([[0.04, 0.3], [0.05, 0.35], [0.05, 0.85], [0.035, 0.9]], 8), C.dark, { pos: [0.34, -0.04, 0.2] });
  cradle.add(turned([[0.065, 0.78], [0.065, 0.92]], 8), C.iron, { pos: [0.34, -0.04, 0.2], minor: true });
  // the barrel: a tapering tube from the mantlet to the muzzle with a fume extractor, thermal sleeve bands and a two-baffle brake
  barrel.add(turned([[0.0001, -0.9], [0.17, -0.9], [0.17, 0.0], [0.13, 0.15], [0.12, 0.6], [0.105, 2.2], [0.085, 4.1], [0.085, 4.2], [0.0001, 4.2]], 14), C.steel);
  barrel.add(turned([[0.105, 1.8], [0.15, 1.9], [0.15, 2.5], [0.105, 2.6]], 12), C.iron); // the fume extractor
  for (const z of [0.9, 1.2, 3.3, 3.55]) barrel.add(ring(0.092 + 0.02 * (z < 2 ? 1 : 0), 0.014, 12), C.dark, { pos: [0, 0, z], minor: true });
  for (const z of [4.0, 4.14]) barrel.add(turned([[0.085, z], [0.16, z], [0.16, z + 0.09], [0.085, z + 0.09]], 12), C.iron);
  barrel.add(turned([[0.0001, 4.2], [0.05, 4.2], [0.05, 4.24]], 8), C.dark, { minor: true }); // the bore
  barrel.add(slab(0.14, 0.05, 0.05), C.dark, { pos: [0.15, 0, 4.12], minor: true }); // brake ports
  barrel.add(slab(0.14, 0.05, 0.05), C.dark, { pos: [-0.15, 0, 4.12], minor: true });
  return { cradle, barrel };
}

const modelCache = new Map();
const _v = new THREE.Vector3();

function buildTankModel(team) {
  const key = `tank${team}`;
  if (!modelCache.has(key)) {
    const { near, far } = buildLods(() => ({ p: tankParts(team), g: gunParts(team) }));
    modelCache.set(key, { body: bakeKits([near.p.hull, near.p.turret, ...near.p.running], [far.p.hull, far.p.turret, ...far.p.running]), cradle: bakeKits([near.g.cradle], [far.g.cradle]), barrel: bakeKits([near.g.barrel], [far.g.barrel]), trackNear: null, trackFar: null });
  }
  const m = modelCache.get(key), def = VEHICLES.tank;
  m.trackNear ||= trackGeo(1); m.trackFar ||= trackGeo(2);
  const root = new THREE.Group();
  root.name = 'vehicle-tank';
  const skeleton = makeSkeleton(root, BONES);
  const sk = skinnedBody(root, skeleton, m.body, { radius: 6.5, centre: [0, 1.5, 0] });
  const B = skeleton.bones;
  const turretPivot = B[1];
  const mkMesh = (geo) => { const o = new THREE.Mesh(geo, BODY); o.castShadow = true; o.receiveShadow = true; return o; };
  const mantlet = mkMesh(m.cradle.near), barrelMesh = mkMesh(m.barrel.near);
  const gun = new THREE.Group(); gun.position.set(...GUN_AT);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 4.35);
  const coax = new THREE.Object3D(); coax.position.set(0.34, -0.04, 1.1);
  barrelMesh.add(muzzle);
  gun.add(mantlet, barrelMesh, coax);
  turretPivot.add(gun);
  // the commander's eyes, in the cupola: they turn with the turret
  const eyeObj = new THREE.Object3D(); eyeObj.position.set(-0.5, 1.55, -0.55); turretPivot.add(eyeObj);
  const track = new THREE.Mesh(m.trackNear, trackMaterial());
  track.frustumCulled = false; track.castShadow = true; track.receiveShadow = true; track.name = 'tracks';
  root.add(track);
  const u = track.material.userData.u;
  const sides = [1, -1].map((sx, i) => {
    const b = B0 + i * SIDE;
    return { sx, arms: B.slice(b, b + 7), wheels: B.slice(b + 7, b + 14), rollers: B.slice(b + 14, b + 17), sprocket: B[b + 17], idler: B[b + 18], phase: 0, spin: 0, dy: new Float32Array(7) };
  });
  const parts = {
    root, turretPivot, gun, gunZ: GUN_AT[2], recoilK: 0, muzzles: [muzzle, coax], skeleton, sk, ownWreck: true,
    meshes: [sk.body, mantlet, barrelMesh, track, ...(sk.dmg ? [sk.dmg] : [])], hitMeshes: [sk.hit, mantlet, barrelMesh], track, sides, eyeObj,
    barrel: barrelMesh, mantlet, kitObjects: { cradle: mantlet, barrel: barrelMesh }, bones: B, blow: null, lastT: -1, yawPrev: 0,
  };
  parts.setLod = (l) => {
    sk.setLod(l);
    const tg = l > 0 ? m.trackFar : m.trackNear;
    if (track.geometry !== tg) track.geometry = tg;
    track.castShadow = l < 2;
    const fb = l > 0 ? m.barrel.far : m.barrel.near, fc = l > 0 ? m.cradle.far : m.cradle.near;
    if (barrelMesh.geometry !== fb) { barrelMesh.geometry = fb; mantlet.geometry = fc; }
    barrelMesh.castShadow = mantlet.castShadow = l < 2;
  };
  parts.setDamage = (t) => sk.setDamage(t);
  parts.setCockpit = (on) => { sk.show(!on); track.visible = !on; mantlet.visible = !on; };
  parts.onDestroy = (v) => {
    // the turret goes up and comes down somewhere nearby, tumbling; the ammunition cooks off in the hull
    parts.blow = { off: new THREE.Vector3(), vel: new THREE.Vector3((Math.random() - 0.5) * 5, 8 + Math.random() * 3, (Math.random() - 0.5) * 5), ang: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3), rot: new THREE.Euler(), landed: false, t: 0 };
  };
  parts.animate = (v) => tankAnimate(v, parts, u);
  return parts;
}
VEHICLES.tank.build = buildTankModel;

// track phase, wheel spin, suspension, the turret and the gun
function tankAnimate(v, P, u) {
  const dt = P.lastT < 0 ? 0 : clamp(v.t - P.lastT, 0, 0.1);
  P.lastT = v.t;
  const alive = v.alive, def = v.def;
  const gauge = TX;
  const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
  const tanP = Math.tan(v.pitch), tanR = Math.tan(v.roll);
  const yawRate = alive ? v.yawRate : 0, speed = alive ? v.speed : 0;
  for (const side of P.sides) {
    // skid steering: the side on the outside of the turn runs faster (local +x is the left)
    const vt = speed - side.sx * yawRate * gauge;
    side.phase = (side.phase + vt * dt) % LOOP.L;
    side.spin += vt * dt;
    const ph = u.uPhase.value, w = (side.phase + LOOP.L) % LOOP.L;
    if (side.sx > 0) ph.x = w; else ph.y = w;
    // road wheels ride the ground: how far below the hull's plane the ground lies under each, drooping the wheel to meet it
    for (let i = 0; i < 7; i++) {
      const lx = side.sx * TX, lz = WZ[i];
      const wx = v.pos.x + c * lx + s * lz, wz = v.pos.z - s * lx + c * lz;
      const plane = v.pos.y + lz * tanP - lx * tanR;
      const want = alive ? clamp(height(wx, wz) - plane + 0.005, -0.3, 0) : -0.12 * (0.5 + 0.5 * Math.sin(i * 2.3 + side.sx));
      side.dy[i] = dt === 0 ? want : side.dy[i] + (want - side.dy[i]) * Math.min(1, dt * 14);
      u.uSusp.value[(side.sx > 0 ? 0 : 7) + i] = side.dy[i];
      side.arms[i].rotation.x = side.dy[i] / 0.38;
      side.wheels[i].rotation.x = side.spin / WR;
    }
    for (const r of side.rollers) r.rotation.x = side.spin / 0.13;
    side.sprocket.rotation.x = side.spin / SPR.r;
    side.idler.rotation.x = side.spin / IDL.r;
  }
  // the turret and gun: the cradle pitches, the barrel slides back in it and returns
  const tp = P.turretPivot;
  if (alive) {
    P.gun.position.z = GUN_AT[2];
    P.barrel.position.z = -v.recoil * 0.45;
    tp.position.y = def.turret.pivot[1];
  } else if (P.blow) {
    const b = P.blow;
    if (!b.landed) {
      b.t += dt;
      b.vel.y -= 17 * dt; b.off.addScaledVector(b.vel, dt);
      b.rot.x += b.ang.x * dt; b.rot.y += b.ang.y * dt; b.rot.z += b.ang.z * dt;
      v.group.updateMatrixWorld(true);
      const wp = _v.copy(tp.position).add(b.off).applyMatrix4(v.group.matrixWorld);
      if (b.t > 0.3 && wp.y < height(wp.x, wp.z) + 0.55) {
        b.landed = true; b.rot.x *= 0.15; b.rot.z = 0.35 + (Math.random() - 0.5) * 0.4;
        b.off.y -= wp.y - (height(wp.x, wp.z) + 0.5);
      }
    }
    tp.position.set(0, def.turret.pivot[1], def.turret.pivot[2]).add(b.off);
    tp.rotation.set(b.rot.x, v.tYaw + b.rot.y, b.rot.z);
    P.gun.rotation.x = 0.2;
  }
  if (alive) { tp.rotation.set(0, v.tYaw, 0); P.gun.rotation.x = -v.tPitch; }
  P.refresh?.();
}
