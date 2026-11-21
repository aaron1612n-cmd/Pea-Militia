import * as THREE from 'three';
import { ellipsoid, taperedTube, paint, ensureOutward, mergeByPosition } from './geo.js';

// Proportions (metres-ish), modelled at full size then scaled by PEA_SCALE.
// Body centre height; ground top is y = 0.
export const PEA_SCALE = 0.78;
export const BODY_R = 0.5;
export const BODY_Y = 0.62;
const BODY_SY = 1.03;
const HIP_Y = 0.34; // upper body pivots here: leans, bobs and twists over the legs

// Walk gait (per leg phase q, 0 = heel strike). Stance is longer than swing, so both feet are
// down for a moment twice a cycle, as in a real walk.
export const GAIT = { stance: 0.62, cadence: 2.3 };

// Muted field colours: a real pea's dull green, worn olive kit, no bright accents.
// Other armies pass their own palette (see factions.js).
const DEFAULT_PALETTE = {
  peaTop: '#7f9a4c', peaMid: '#677f3a', peaLow: '#44562a',
  helmet: '#4a4f3a', helmetDark: '#33372a', badge: '#5c5546',
  boot: '#2b2520', sole: '#151311', glove: '#3d3a2f',
  eye: '#121410', brow: '#3e4f25', mouth: '#2a3319', strap: '#3d3e2f',
};
let COL = null;
function setPalette(p) {
  COL = { ...p, peaTop: new THREE.Color(p.peaTop), peaMid: new THREE.Color(p.peaMid), peaLow: new THREE.Color(p.peaLow) };
}

// Geometry and materials are shared between peas of the same army and detail level.
const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

let KEY = '';
const mat = (color, opts = {}) => cached(`mat|${color}|${JSON.stringify(opts)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts }));

function part(name, geometry, material, kind = 'mesh') {
  const m = kind === 'skinned' ? new THREE.SkinnedMesh(geometry, material) : new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.part = true;
  return m;
}

// Point on the body surface in a given direction (body-local, origin at body centre).
function onBody(dir, lift = 0) {
  const d = dir.clone().normalize();
  // ellipsoid radius along d
  const r = 1 / Math.sqrt((d.x / BODY_R) ** 2 + (d.y / (BODY_R * BODY_SY)) ** 2 + (d.z / BODY_R) ** 2);
  return d.multiplyScalar(r + lift);
}

// A limb as a real skinned mesh: tapered tube bound to a 3-bone chain along its path.
function skinnedLimb(name, pts, r0, r1, material, lod = 1) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const { geometry, ts } = cached(`limb|${name}|${lod}`, () => taperedTube(curve, (t) => THREE.MathUtils.lerp(r0, r1, t) * (1 + 0.12 * Math.sin(t * Math.PI)), lod < 1 ? 18 : 36, lod < 1 ? 10 : 16));
  const bonesT = [0, 0.5, 1];
  const bonePts = bonesT.map((t) => curve.getPointAt(t));
  const si = [], sw = [];
  for (const t of ts) {
    const k = Math.min(1, Math.floor(t * 2));
    const w = t * 2 - k;
    si.push(k, k + 1, 0, 0);
    sw.push(1 - w, w, 0, 0);
  }
  if (!geometry.attributes.skinIndex) {
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  const bones = bonePts.map((p, i) => {
    const b = new THREE.Bone();
    b.name = `${name}_b${i}`;
    if (i === 0) b.position.copy(p);
    else b.position.copy(p).sub(bonePts[i - 1]);
    return b;
  });
  bones[0].add(bones[1]);
  bones[1].add(bones[2]);
  const mesh = part(name, geometry, material, 'skinned');
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  return { mesh, bones, curve };
}

function helmetGeometry(lod = 1) {
  const pts = [];
  const A = 58;
  const step = lod < 1 ? 4 : 2;
  for (let a = 0; a <= A; a += step) {
    const r = THREE.MathUtils.degToRad(a);
    pts.push(new THREE.Vector2(0.535 * Math.sin(r), 0.553 * Math.cos(r)));
  }
  // brim flare, rolled lip, underside
  const last = pts[pts.length - 1];
  pts.push(new THREE.Vector2(last.x + 0.04, last.y - 0.03));
  pts.push(new THREE.Vector2(0.556, 0.236));
  pts.push(new THREE.Vector2(0.566, 0.222));
  pts.push(new THREE.Vector2(0.562, 0.208));
  pts.push(new THREE.Vector2(0.54, 0.205));
  pts.push(new THREE.Vector2(0.47, 0.232));
  for (let a = A + 2; a >= 0; a -= step) {
    const r = THREE.MathUtils.degToRad(a);
    pts.push(new THREE.Vector2(0.478 * Math.sin(r), 0.5 * Math.cos(r)));
  }
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, lod < 1 ? 36 : 72);
  // merge seam/poles so it is a single closed shell, then smooth-shade
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeByPosition(g);
  ensureOutward(m);
  m.computeVertexNormals();
  // subtle panel shading: darker toward the rim
  paint(m, (v, c) => c.set(COL.helmet).lerp(new THREE.Color(COL.helmetDark), THREE.MathUtils.clamp((0.42 - v.y) / 0.25, 0, 1) * 0.7));
  return m;
}

// The sculpted body surface for a unit direction u (matches the body geometry's shape fn).
function bodySurface(u, out = new THREE.Vector3()) {
  const seam = 0.012 * Math.exp(-((u.x * 6) ** 2)) * THREE.MathUtils.smoothstep(-u.z, 0, 0.4);
  const belly = u.z > 0 && u.y < 0 ? 0.03 * u.z * -u.y : 0;
  const k = 1 - seam + belly;
  return out.set(u.x * k * BODY_R, u.y * k * BODY_R * BODY_SY, u.z * k * BODY_R);
}
function bodyNormal(p) {
  return new THREE.Vector3(p.x / BODY_R ** 2, p.y / (BODY_R * BODY_SY) ** 2, p.z / BODY_R ** 2).normalize();
}

// Circle on the unit sphere through a, m, b; returns t in [0,1] -> unit direction, a -> m -> b.
function arcOnSphere(a, m, b) {
  [a, m, b] = [a, m, b].map((v) => v.clone().normalize());
  const n = b.clone().sub(a).cross(m.clone().sub(a)).normalize();
  const c = n.clone().multiplyScalar(n.dot(a));
  const rho = Math.sqrt(1 - c.lengthSq());
  const e1 = a.clone().sub(c).normalize();
  let e2 = n.clone().cross(e1);
  const ang = (v) => { const d = v.clone().sub(c); return (Math.atan2(d.dot(e2), d.dot(e1)) + Math.PI * 2) % (Math.PI * 2); };
  if (ang(m) > ang(b)) e2.negate();
  const end = ang(b);
  return (t) => c.clone().addScaledVector(e1, rho * Math.cos(t * end)).addScaledVector(e2, rho * Math.sin(t * end)).normalize();
}

// Closed band lying on the body: rounded-rectangle section (half-width hw, from h0 below the
// skin to h1 above it), every vertex projected onto the body surface, ends fanned shut.
function surfaceRibbon(path, t0, t1, { hw, h0, h1, r }, segs) {
  const prof = [];
  const arc = (cx, cy, a0) => { for (let k = 0; k <= 3; k++) { const a = a0 + (k / 3) * (Math.PI / 2); prof.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  arc(hw - r, h1 - r, 0); prof.push([0, h1]);
  arc(-(hw - r), h1 - r, Math.PI / 2);
  arc(-(hw - r), h0 + r, Math.PI); prof.push([0, h0]);
  arc(hw - r, h0 + r, Math.PI * 1.5);
  const P = prof.length;
  const pos = [], idx = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = THREE.MathUtils.lerp(t0, t1, i / segs);
    bodySurface(path(t), p);
    const T = bodySurface(path(Math.min(1, t + 1e-3)), new THREE.Vector3()).sub(bodySurface(path(Math.max(0, t - 1e-3)), tmp)).normalize();
    const across = T.clone().cross(bodyNormal(p)).normalize();
    for (const [x, h] of prof) {
      bodySurface(q.copy(p).addScaledVector(across, x).normalize(), q);
      q.addScaledVector(bodyNormal(q), h);
      pos.push(q.x, q.y, q.z);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < P; j++) {
    const a = i * P + j, b = i * P + ((j + 1) % P), c = a + P, d = b + P;
    idx.push(a, b, c, b, d, c);
  }
  for (const end of [0, segs]) {
    const ctr = pos.length / 3;
    const cx = [0, 0, 0];
    for (let j = 0; j < P; j++) for (let k = 0; k < 3; k++) cx[k] += pos[(end * P + j) * 3 + k] / P;
    pos.push(...cx);
    for (let j = 0; j < P; j++) {
      const a = end * P + j, b = end * P + ((j + 1) % P);
      if (end === 0) idx.push(b, a, ctr); else idx.push(a, b, ctr);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  ensureOutward(g);
  g.computeVertexNormals();
  return g;
}

// opts: { palette, team, lod } — lod < 1 builds a lighter mesh for crowds.
export function createPea({ palette = DEFAULT_PALETTE, team = 0, lod = 1 } = {}) {
  setPalette(palette);
  KEY = `${team}|${lod}`;
  const hi = lod >= 1;
  const root = new THREE.Group();
  root.name = 'pea';
  root.scale.setScalar(PEA_SCALE);

  // Upper body pivots at the hips so breathing never lifts the feet.
  const upper = new THREE.Group();
  upper.name = 'upper';
  upper.position.y = HIP_Y;
  root.add(upper);
  const body = new THREE.Group();
  body.position.y = BODY_Y - HIP_Y;
  upper.add(body);

  // ---- body: slightly egg-shaped pea with a crease ----
  const bodyGeo = cached(`body|${KEY}`, () => paintBody(ellipsoid(BODY_R, BODY_R * BODY_SY, BODY_R, hi ? 96 : 40, hi ? 64 : 28, (v) => {
    // soft seam where a pea sits in its pod, plus a gentle belly
    const seam = 0.012 * Math.exp(-((v.x * 6) ** 2)) * THREE.MathUtils.smoothstep(-v.z, 0, 0.4);
    const belly = v.z > 0 && v.y < 0 ? 0.03 * v.z * -v.y : 0;
    const k = 1 - seam + belly;
    v.multiplyScalar(k);
  })));
  function paintBody(g) { return paint(g, (v, c) => {
    const t = (v.y / (BODY_R * BODY_SY) + 1) / 2;
    if (t > 0.5) c.copy(COL.peaMid).lerp(COL.peaTop, (t - 0.5) * 2);
    else c.copy(COL.peaLow).lerp(COL.peaMid, t * 2);
    // low-frequency mottling so the skin reads as a real, slightly bruised pea
    const n = Math.sin(v.x * 23.1 + v.y * 7.3) * Math.sin(v.z * 19.7 - v.y * 11.9) + 0.5 * Math.sin(v.x * 41 + v.z * 37 + v.y * 29);
    c.multiplyScalar(1 + 0.05 * n);
  }); }
  const bodyMat = cached('bodyMat', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68 }));
  const limbMat = cached(`limbMat|${KEY}`, () => new THREE.MeshStandardMaterial({ color: COL.peaMid.clone().lerp(COL.peaLow, 0.35), roughness: 0.7 }));
  const bodyMesh = part('body', bodyGeo, bodyMat);
  body.add(bodyMesh);

  // ---- face: small, hooded eyes under a flat brow ridge; a set, straight mouth ----
  // Face parts ride on the body mesh so they breathe with it and never float off.
  const face = new THREE.Group();
  face.name = 'face';
  bodyMesh.add(face);
  const eyes = [];
  const surf = (x, y, lift) => onBody(new THREE.Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))), lift);
  for (const s of [-1, 1]) {
    const tag = s < 0 ? 'L' : 'R';
    const dir = new THREE.Vector3(0.17 * s, 0.13, 0.977).normalize();
    const eye = new THREE.Group();
    eye.name = `eye${tag}Rig`;
    eye.position.copy(onBody(dir, -0.018));
    eye.lookAt(eye.position.clone().add(dir));
    // almond-shaped eye, mostly sunk into the skin
    const eyeMesh = part(`eye${tag}`, cached(`eye|${lod}`, () => ellipsoid(0.05, 0.022, 0.03, hi ? 36 : 16, hi ? 20 : 10, (v) => { v.y *= 1 - 0.35 * v.x * v.x; })), mat(COL.eye, { roughness: 0.55 }));
    eye.add(eyeMesh);
    face.add(eye);
    eyes.push(eye);

    // brow ridge: a level, even bar that shows nothing
    const browPts = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      browPts.push(surf((0.075 + 0.17 * u) * s, 0.215, 0.002));
    }
    const brow = part(`brow${tag}`, cached(`brow${tag}|${lod}`, () => taperedTube(new THREE.CatmullRomCurve3(browPts), (t) => 0.017 * (0.85 + 0.15 * Math.sin(t * Math.PI)), hi ? 28 : 12, hi ? 12 : 6).geometry), mat(COL.brow, { roughness: 0.85 }));
    face.add(brow);
  }
  // mouth: a short, straight line
  const mouthPts = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8 - 0.5;
    mouthPts.push(surf(u * 0.13, -0.17, 0.0));
  }
  const mouth = part('mouth', cached(`mouth|${lod}`, () => taperedTube(new THREE.CatmullRomCurve3(mouthPts), (t) => 0.007 * (0.75 + 0.3 * Math.sin(t * Math.PI)), hi ? 28 : 12, hi ? 10 : 6).geometry), mat(COL.mouth, { roughness: 0.7 }));
  face.add(mouth);

  // chin strap: a flat webbing band that tucks up inside the helmet shell in front of each
  // ear, lies flat on the skin and cups under the mouth. Built as a ribbon whose every vertex
  // is projected onto the real (sculpted) body surface, so it hugs with no gap and no clipping.
  const strapPath = arcOnSphere(
    new THREE.Vector3(-0.7, 0.55, 0.455),
    new THREE.Vector3(0, -0.36, 0.933),
    new THREE.Vector3(0.7, 0.55, 0.455),
  );
  face.add(part('strap', cached(`strap|${lod}`, () => surfaceRibbon(strapPath, 0, 1, { hw: 0.021, h0: -0.003, h1: 0.0065, r: 0.003 }, hi ? 96 : 48)), mat(COL.strap, { roughness: 0.92 })));
  // a small slide buckle on the right cheek, sitting proud of the webbing
  {
    const t = 0.796, c = bodySurface(strapPath(t)), n = bodyNormal(c);
    const along = bodySurface(strapPath(t + 1e-3)).sub(bodySurface(strapPath(t - 1e-3))).normalize();
    const across = along.clone().cross(n).normalize();
    along.crossVectors(n, across);
    // squared-off slide, sculpted from a sphere so it stays one closed, smooth shell
    const geo = cached(`buckle|${lod}`, () => ellipsoid(0.029, 0.022, 0.011, hi ? 40 : 16, hi ? 24 : 10, (v) => { v.x = Math.sign(v.x) * Math.abs(v.x) ** 0.6; v.y = Math.sign(v.y) * Math.abs(v.y) ** 0.6; }));
    const buckle = part('buckle', geo, mat(COL.badge, { roughness: 0.55, metalness: 0.35 }));
    buckle.position.copy(c).addScaledVector(n, 0.003);
    buckle.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, along, n));
    face.add(buckle);
  }

  // ---- helmet: set square and low over the brow ----
  const helmet = new THREE.Group();
  helmet.name = 'helmetRig';
  helmet.rotation.x = -0.03;
  body.add(helmet);
  const helmetMesh = part('helmet', cached(`helmet|${KEY}`, () => helmetGeometry(lod)), mat('#ffffff', { vertexColors: true, roughness: 0.9, metalness: 0.02 }));
  helmet.add(helmetMesh);
  // small stamped plate, the same dull metal as the kit
  const bdir = new THREE.Vector3(0, 0.55, 0.835).normalize();
  const badge = part('badge', cached(`badge|${lod}`, () => ellipsoid(0.042, 0.05, 0.016, hi ? 28 : 14, hi ? 14 : 8, (v) => { v.y *= 1 - 0.3 * Math.max(0, -v.y); })), mat(COL.badge, { roughness: 0.7, metalness: 0.3 }));
  badge.position.copy(bdir.clone().multiplyScalar(0.548));
  badge.lookAt(badge.position.clone().add(bdir));
  helmet.add(badge);

  // ---- arms (skinned) with mitten hands ----
  const arms = [];
  const hands = [];
  const gloveMat = mat(COL.glove, { roughness: 0.85 });
  for (const s of [-1, 1]) {
    const pts = [
      // relaxed stand: shoulder slopes off the round body, upper arm hangs close
      // along the side, soft elbow bend lets the forearm drift a little forward
      new THREE.Vector3(0.45 * s, 0.13, -0.005),
      new THREE.Vector3(0.548 * s, -0.005, -0.012),
      new THREE.Vector3(0.556 * s, -0.12, -0.008),
      new THREE.Vector3(0.515 * s, -0.245, 0.05),
    ];
    const limb = skinnedLimb(`arm${s < 0 ? 'L' : 'R'}`, pts, 0.046, 0.036, limbMat, lod);
    body.add(limb.mesh);
    const hand = new THREE.Group();
    hand.name = `hand${s < 0 ? 'L' : 'R'}Rig`;
    // hand hangs in line with the forearm, tipped a touch forward, palm toward the thigh
    hand.position.set(-0.004 * s, -0.04, 0.012);
    hand.rotation.set(-0.22, 0.12 * s, 0.06 * s);
    limb.bones[2].add(hand);
    hands.push(hand);
    // loosely curled hand: flat across the palm, fingers rolling in toward the body
    const mitt = part(`mitt${s < 0 ? 'L' : 'R'}`, cached(`mitt${s}|${lod}`, () => ellipsoid(0.05, 0.078, 0.062, hi ? 32 : 14, hi ? 24 : 10, (v) => {
      const d = Math.max(0, -v.y);
      v.x -= s * 0.45 * d * d; // fingertips curl toward the palm side
      v.z *= 1 - 0.18 * d;
    })), gloveMat);
    hand.add(mitt);
    const thumb = part(`thumb${s < 0 ? 'L' : 'R'}`, cached(`thumb|${lod}`, () => ellipsoid(0.022, 0.04, 0.024, hi ? 20 : 10, hi ? 14 : 8)), gloveMat);
    // thumb rests along the front of the curled fingers
    thumb.position.set(-0.01 * s, -0.012, 0.05);
    thumb.rotation.set(0.25, 0, 0.12 * s);
    hand.add(thumb);
    const cuff = part(`cuff${s < 0 ? 'L' : 'R'}`, cached(`cuff|${lod}`, () => ellipsoid(0.054, 0.026, 0.056, hi ? 28 : 14, hi ? 12 : 8)), gloveMat);
    cuff.position.set(0, 0.058, 0);
    hand.add(cuff);
    arms.push(limb);
  }

  // ---- legs (skinned) with boots ----
  const legs = [];
  const bootMat = mat('#ffffff', { vertexColors: true, roughness: 0.8 });
  for (const s of [-1, 1]) {
    const pts = [
      new THREE.Vector3(0.17 * s, 0.34, 0.0),
      new THREE.Vector3(0.185 * s, 0.22, 0.03),
      new THREE.Vector3(0.19 * s, 0.13, 0.02),
      new THREE.Vector3(0.19 * s, 0.085, 0.01),
    ];
    const limb = skinnedLimb(`leg${s < 0 ? 'L' : 'R'}`, pts, 0.062, 0.05, limbMat, lod);
    root.add(limb.mesh);
    const foot = new THREE.Group();
    foot.name = `foot${s < 0 ? 'L' : 'R'}Rig`;
    limb.bones[2].add(foot);
    // boot: sculpted ellipsoid with a flat sole and a rounded toe box
    const SOLE = -0.083; // ankle sits at y=0.085, so the sole lands 2mm above the plate
    const bootGeo = cached(`boot|${KEY}`, () => {
      const g = ellipsoid(0.1, 0.085, 0.16, hi ? 48 : 20, hi ? 32 : 14, (v) => {
        if (v.z > 0) v.y *= 1 - 0.25 * v.z; // toe slopes down
        if (v.y < -0.4) v.y = -0.4 - (v.y + 0.4) * 0.15; // flatten into sole
      });
      const bb = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
      g.translate(0, SOLE - bb.min.y, 0.05);
      return paint(g, (v, c) => c.set(v.y < SOLE + 0.025 ? COL.sole : COL.boot));
    });
    const boot = part(`boot${s < 0 ? 'L' : 'R'}`, bootGeo, bootMat);
    foot.add(boot);
    legs.push({ ...limb, foot, s, bootGeo });
  }

  // ---- animation: idle, walk, jump, land ----
  const rest = {
    arm: arms.map((a) => a.bones.map((b) => b.rotation.clone())),
  };
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { blinkAt: 2.4 };
  const { sin, cos, PI, max, min } = Math;
  const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
  const lerp = THREE.MathUtils.lerp;

  // Two-bone leg IK in the side (y/z) plane, knee bending forward like a real knee.
  for (const L of legs) {
    const [b0, b1, b2] = L.bones;
    const H = b0.position.clone(), K = H.clone().add(b1.position), A = K.clone().add(b2.position);
    L.H0 = H;
    L.A0 = A;
    L.l1 = Math.hypot(K.y - H.y, K.z - H.z);
    L.l2 = Math.hypot(A.y - K.y, A.z - K.z);
    L.p1 = Math.atan2(K.z - H.z, -(K.y - H.y));
    L.p2 = Math.atan2(A.z - K.z, -(A.y - K.y));
    // lowest point of the boot for each foot pitch, so a tilted foot rolls on heel or toe
    // instead of sinking into the ground
    L.low = cached(`bootLow|${lod}`, () => {
      const pos = L.bootGeo.attributes.position;
      const low = [];
      for (let i = 0; i <= 80; i++) {
        const th = -0.8 + (i / 80) * 1.6;
        let lo = Infinity;
        for (let k = 0; k < pos.count; k++) lo = min(lo, pos.getY(k) * cos(th) - pos.getZ(k) * sin(th));
        low.push(lo);
      }
      return low;
    });
  }
  const rollLift = (L, th) => {
    const f = THREE.MathUtils.clamp((th + 0.8) / 1.6 * 80, 0, 80);
    const i = Math.floor(f), j = min(80, i + 1);
    return L.low[40] - lerp(L.low[i], L.low[j], f - i);
  };
  function solveLeg(L, hipDy, hipDz, ty, tz, pitch) {
    const [b0, b1] = L.bones;
    const hy = L.H0.y + hipDy, hz = L.H0.z + hipDz;
    b0.position.set(L.H0.x, hy, hz);
    const dy = ty - hy, dz = tz - hz;
    const d = THREE.MathUtils.clamp(Math.hypot(dy, dz), Math.abs(L.l1 - L.l2) + 1e-3, L.l1 + L.l2 - 1e-4);
    const pD = Math.atan2(dz, -dy);
    const a = Math.acos(THREE.MathUtils.clamp((L.l1 ** 2 + d ** 2 - L.l2 ** 2) / (2 * L.l1 * d), -1, 1));
    const p1 = pD + a;
    const ky = hy - L.l1 * cos(p1), kz = hz + L.l1 * sin(p1);
    const ay = hy - d * cos(pD), az = hz + d * sin(pD);
    const p2 = Math.atan2(az - kz, -(ay - ky));
    b0.rotation.x = -(p1 - L.p1);
    b1.rotation.x = -(p2 - L.p2) + (p1 - L.p1);
    L.foot.rotation.x = pitch + (p2 - L.p2);
  }

  // Foot path for one leg over a walk cycle: planted and rolling heel-to-toe in stance,
  // lifted and carried forward in swing.
  function gaitFoot(q, F) {
    const ST = GAIT.stance;
    if (q < ST) {
      const s = q / ST;
      const pitch = -0.22 * (1 - smooth(0, 0.16, s)) + 0.5 * smooth(0.58, 1, s);
      return { z: F * (1 - 2 * s), lift: 0, pitch };
    }
    const u = (q - ST) / (1 - ST);
    const z = -F * cos(PI * u);
    const lift = 0.055 * sin(PI * u ** 0.8);
    const pitch = lerp(0.5, -0.22, smooth(0, 0.75, u));
    return { z, lift, pitch };
  }

  // st: { t, walk 0..1, cycle 0..1, stride (model units), air 0..1, rise -1..1, land 0..1, crouch 0..1,
  //       hold 0..1 (weapon up in the right hand), aim (pitch, rad), recoil 0..1, twist (upper body yaw),
  //       kneel 0..1 (down behind cover), seat 0..1 (sitting at controls), throw 0..1 (throw phase),
  //       flinch 0..1 }
  function pose(st = {}, motion = !reduced) {
    const t = st.t || 0;
    const seat = st.seat || 0;
    const walk = (st.walk || 0) * (1 - (st.air || 0)) * (1 - seat);
    const air = (st.air || 0) * (1 - seat), rise = st.rise || 0, land = st.land || 0, crouch = st.crouch || 0;
    const hold = st.hold || 0, aim = st.aim || 0, recoil = st.recoil || 0, kneel = (st.kneel || 0) * (1 - seat);
    const thr = st.throw || 0, flinch = st.flinch || 0;
    const q = ((st.cycle || 0) % 1 + 1) % 1;
    const F = st.stride ?? 0.13;

    // breathing: body swells a touch and rises, pivoting around the hips
    const breathe = motion ? sin((t / 3.2) * PI * 2) : 0;
    body.position.y = BODY_Y - HIP_Y + 0.008 * breathe;
    const squash = land * 0.05 + crouch * 0.04 - air * 0.03 * max(0, rise);
    bodyMesh.scale.set(1 + 0.008 * breathe + squash * 0.5, 1 + 0.012 * breathe - squash, 1 + 0.008 * breathe + squash * 0.5);

    // whole upper body: bob lowest at each heel strike, sway over the stance foot, shoulders
    // counter-rotate with the arms, lean into the walk; drop into landings and the jump crouch
    const reach = Math.sqrt(max(0, (legs[0].l1 + legs[0].l2 - 0.003) ** 2 - F ** 2));
    const need = max(0, legs[0].H0.y - legs[0].A0.y - reach);
    const bob = -walk * (need + 0.006) * (0.5 + 0.5 * cos(4 * PI * q));
    const drop = bob - 0.06 * land - 0.05 * crouch - 0.12 * kneel - 0.19 * seat;
    upper.position.set(-0.018 * walk * sin(2 * PI * q), HIP_Y + drop, 0.03 * kneel);
    upper.rotation.set(0.055 * walk + 0.08 * land + 0.06 * crouch + 0.04 * air + 0.1 * kneel - 0.12 * flinch - 0.12 * aim * hold - 0.05 * seat,
      -0.07 * walk * cos(2 * PI * q) * (1 - 0.6 * hold) + (st.twist || 0), 0.02 * walk * sin(2 * PI * q));

    // legs
    legs.forEach((L, i) => {
      const lq = (q + (i === 0 ? 0 : 0.5)) % 1;
      const g = gaitFoot(lq, F);
      let z = g.z * walk, lift = g.lift * walk, pitch = g.pitch * walk;
      if (air > 0) {
        // in the air: one knee comes up and forward, the other trails; both reach down to land
        const tuck = 0.35 + 0.65 * max(0, rise);
        const front = i === 0;
        z = lerp(z, (front ? 0.05 : -0.035) * tuck, air);
        lift = lerp(lift, (front ? 0.075 : 0.045) * tuck, air);
        pitch = lerp(pitch, 0.25 * tuck, air);
      }
      if (seat > 0) {
        // sitting: feet forward on the floor plate, toes up
        z = lerp(z, 0.17, seat);
        lift = lerp(lift, 0.02, seat);
        pitch = lerp(pitch, -0.3, seat);
      }
      if (kneel > 0) z = lerp(z, i === 0 ? 0.06 : -0.06, kneel);
      const ty = L.A0.y + lift + rollLift(L, pitch);
      solveLeg(L, drop, 0, ty, L.A0.z + z, pitch);
    });

    // arms: swing opposite the legs, a little further forward than back, elbows bending more
    // on the forward swing; out and up for balance in the air; forward to absorb a landing
    arms.forEach((a, i) => {
      const s = i === 0 ? -1 : 1;
      const sway = motion ? sin((t / 3.2) * PI * 2 + 0.5) : 0;
      const oq = (q + (s > 0 ? 0 : 0.5) - 0.04) % 1;
      const f = cos(2 * PI * oq);
      const right = s > 0;
      const carry = right ? 1 - 0.85 * hold : 1 - 0.5 * hold;
      const swing = walk * (0.06 + 0.28 * f) * carry;
      const flex = walk * (0.12 + 0.14 * (1 + f)) * carry;
      const up = air * (0.35 + 0.25 * max(0, rise));
      const out = air * (0.25 + 0.2 * max(0, -rise));
      a.bones[0].rotation.x = rest.arm[i][0].x - 0.018 * sway - swing - up - 0.14 * land - 0.1 * crouch;
      a.bones[0].rotation.z = rest.arm[i][0].z + s * (0.008 * sway + walk * (0.03 + 0.04 * max(0, f)) + out + 0.12 * land + 0.05 * crouch);
      a.bones[1].rotation.x = rest.arm[i][1].x - 0.012 * sway - flex - air * 0.35 - 0.22 * land - 0.15 * crouch;
      const [b0, b1] = a.bones;
      if (right && hold > 0) {
        // weapon up: upper arm forward along the flank, elbow bent, so the gun sits at the hip
        // pointing ahead; aim pitch swings the whole arm, recoil kicks it back a little
        b0.rotation.x = lerp(b0.rotation.x, HOLD.x - aim * 0.9 + recoil * 0.16, hold);
        b0.rotation.y = lerp(0, HOLD.y, hold);
        b0.rotation.z = lerp(b0.rotation.z, HOLD.z, hold);
        b1.rotation.x = lerp(b1.rotation.x, HOLD.elbow + recoil * 0.12, hold);
      } else if (right) b0.rotation.y = 0;
      if (!right && hold > 0) {
        // free arm at the ready: a little forward, elbow soft
        b0.rotation.x -= 0.22 * hold;
        b0.rotation.z += s * 0.06 * hold;
        b1.rotation.x -= 0.45 * hold;
      }
      if (right && thr > 0) {
        // overarm throw: wind up out and back over the shoulder, whip forward, follow through
        const up = thr < 0.45 ? smooth(0, 0.45, thr) : 1 - smooth(0.45, 0.75, thr) * 0.55;
        const k = thr < 0.9 ? 1 : 1 - smooth(0.9, 1, thr);
        b0.rotation.x = lerp(b0.rotation.x, -2.55 * up - 0.9 * (thr > 0.45 ? smooth(0.45, 0.75, thr) : 0), k);
        b0.rotation.y = lerp(b0.rotation.y, 0, k);
        b0.rotation.z = lerp(b0.rotation.z, 0.75 * up, k);
        b1.rotation.x = lerp(b1.rotation.x, -1.2 * up, k);
      }
      if (seat > 0) {
        // hands forward on the controls
        b0.rotation.x = lerp(b0.rotation.x, -0.95, seat);
        b0.rotation.z = lerp(b0.rotation.z, s * 0.18, seat);
        b1.rotation.x = lerp(b1.rotation.x, -0.55, seat);
      }
    });

    // blink: quick squash on a ~3.6s loop
    const bt = (t % 3.6) - (state.blinkAt % 3.6);
    const blink = bt > 0 && bt < 0.16 ? sin((bt / 0.16) * PI) : 0;
    eyes.forEach((e) => e.scale.set(1, 1 - 0.85 * blink, 1));
    root.updateMatrixWorld(true);
  }
  const setPhase = (t, motion = !reduced) => pose({ t }, motion);
  setPhase(0);

  root.userData = { setPhase, pose, parts: () => collectParts(root), rig: { upper, body, hands, arms, legs } };
  return root;
}

// Right-arm weapon hold (bone rotations), tuned so the gun rides at the hip pointing ahead.
export const HOLD = { x: -0.92, y: -0.1, z: 0.2, elbow: -0.85 };

export function collectParts(root) {
  const out = [];
  root.traverse((o) => { if (o.isMesh && o.userData.part) out.push(o); });
  return out;
}

// Collision volume for the pea: vertical capsule around body + limbs.
export const PEA_COLLIDER = { a: new THREE.Vector3(0, 0.3, 0).multiplyScalar(PEA_SCALE), b: new THREE.Vector3(0, 1.05, 0).multiplyScalar(PEA_SCALE), r: 0.84 * PEA_SCALE };
