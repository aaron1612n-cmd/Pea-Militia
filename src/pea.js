import * as THREE from 'three';
import { ellipsoid, taperedTube, paint, ensureOutward, mergeByPosition } from './geo.js';

// Proportions (metres-ish), modelled at full size then scaled by PEA_SCALE.
// Body centre height; ground top is y = 0.
export const PEA_SCALE = 0.78;
export const BODY_R = 0.5;
export const BODY_Y = 0.62;
const BODY_SY = 1.03;

// Muted field colours: a real pea's dull green, worn olive kit, no bright accents.
const COL = {
  peaTop: new THREE.Color('#7f9a4c'),
  peaMid: new THREE.Color('#677f3a'),
  peaLow: new THREE.Color('#44562a'),
  helmet: '#4a4f3a',
  helmetDark: '#33372a',
  badge: '#5c5546',
  boot: '#2b2520',
  sole: '#151311',
  glove: '#3d3a2f',
  eye: '#121410',
  brow: '#3e4f25',
  mouth: '#2a3319',
  strap: '#3d3e2f',
};

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });

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
function skinnedLimb(name, pts, r0, r1, material) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const { geometry, ts } = taperedTube(curve, (t) => THREE.MathUtils.lerp(r0, r1, t) * (1 + 0.12 * Math.sin(t * Math.PI)), 36, 16);
  const bonesT = [0, 0.5, 1];
  const bonePts = bonesT.map((t) => curve.getPointAt(t));
  const si = [], sw = [];
  for (const t of ts) {
    const k = Math.min(1, Math.floor(t * 2));
    const w = t * 2 - k;
    si.push(k, k + 1, 0, 0);
    sw.push(1 - w, w, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
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

function helmetGeometry() {
  const pts = [];
  const A = 58;
  for (let a = 0; a <= A; a += 2) {
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
  for (let a = A + 2; a >= 0; a -= 2) {
    const r = THREE.MathUtils.degToRad(a);
    pts.push(new THREE.Vector2(0.478 * Math.sin(r), 0.5 * Math.cos(r)));
  }
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, 72);
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

export function createPea() {
  const root = new THREE.Group();
  root.name = 'pea';
  root.scale.setScalar(PEA_SCALE);

  // Upper body pivots at the hips so breathing never lifts the feet.
  const upper = new THREE.Group();
  upper.name = 'upper';
  root.add(upper);
  const body = new THREE.Group();
  body.position.y = BODY_Y;
  upper.add(body);

  // ---- body: slightly egg-shaped pea with a crease ----
  const bodyGeo = ellipsoid(BODY_R, BODY_R * BODY_SY, BODY_R, 96, 64, (v) => {
    // soft seam where a pea sits in its pod, plus a gentle belly
    const seam = 0.012 * Math.exp(-((v.x * 6) ** 2)) * THREE.MathUtils.smoothstep(-v.z, 0, 0.4);
    const belly = v.z > 0 && v.y < 0 ? 0.03 * v.z * -v.y : 0;
    const k = 1 - seam + belly;
    v.multiplyScalar(k);
  });
  paint(bodyGeo, (v, c) => {
    const t = (v.y / (BODY_R * BODY_SY) + 1) / 2;
    if (t > 0.5) c.copy(COL.peaMid).lerp(COL.peaTop, (t - 0.5) * 2);
    else c.copy(COL.peaLow).lerp(COL.peaMid, t * 2);
    // low-frequency mottling so the skin reads as a real, slightly bruised pea
    const n = Math.sin(v.x * 23.1 + v.y * 7.3) * Math.sin(v.z * 19.7 - v.y * 11.9) + 0.5 * Math.sin(v.x * 41 + v.z * 37 + v.y * 29);
    c.multiplyScalar(1 + 0.05 * n);
  });
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68 });
  const limbMat = new THREE.MeshStandardMaterial({ color: COL.peaMid.clone().lerp(COL.peaLow, 0.35), roughness: 0.7 });
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
    const eyeMesh = part(`eye${tag}`, ellipsoid(0.05, 0.022, 0.03, 36, 20, (v) => { v.y *= 1 - 0.35 * v.x * v.x; }), mat(COL.eye, { roughness: 0.55 }));
    eye.add(eyeMesh);
    face.add(eye);
    eyes.push(eye);

    // brow ridge: a level, even bar that shows nothing
    const browPts = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      browPts.push(surf((0.075 + 0.17 * u) * s, 0.215, 0.002));
    }
    const brow = part(`brow${tag}`, taperedTube(new THREE.CatmullRomCurve3(browPts), (t) => 0.017 * (0.85 + 0.15 * Math.sin(t * Math.PI)), 28, 12).geometry, mat(COL.brow, { roughness: 0.85 }));
    face.add(brow);
  }
  // mouth: a short, straight line
  const mouthPts = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8 - 0.5;
    mouthPts.push(surf(u * 0.13, -0.17, 0.0));
  }
  const mouth = part('mouth', taperedTube(new THREE.CatmullRomCurve3(mouthPts), (t) => 0.007 * (0.75 + 0.3 * Math.sin(t * Math.PI)), 28, 10).geometry, mat(COL.mouth, { roughness: 0.7 }));
  face.add(mouth);

  // chin strap: a flat webbing band that tucks up inside the helmet shell in front of each
  // ear, lies flat on the skin and cups under the mouth. Built as a ribbon whose every vertex
  // is projected onto the real (sculpted) body surface, so it hugs with no gap and no clipping.
  const strapPath = arcOnSphere(
    new THREE.Vector3(-0.7, 0.55, 0.455),
    new THREE.Vector3(0, -0.36, 0.933),
    new THREE.Vector3(0.7, 0.55, 0.455),
  );
  face.add(part('strap', surfaceRibbon(strapPath, 0, 1, { hw: 0.021, h0: -0.003, h1: 0.0065, r: 0.003 }, 96), mat(COL.strap, { roughness: 0.92 })));
  // a small slide buckle on the right cheek, sitting proud of the webbing
  {
    const t = 0.796, c = bodySurface(strapPath(t)), n = bodyNormal(c);
    const along = bodySurface(strapPath(t + 1e-3)).sub(bodySurface(strapPath(t - 1e-3))).normalize();
    const across = along.clone().cross(n).normalize();
    along.crossVectors(n, across);
    // squared-off slide, sculpted from a sphere so it stays one closed, smooth shell
    const geo = ellipsoid(0.029, 0.022, 0.011, 40, 24, (v) => { v.x = Math.sign(v.x) * Math.abs(v.x) ** 0.6; v.y = Math.sign(v.y) * Math.abs(v.y) ** 0.6; });
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
  const helmetMesh = part('helmet', helmetGeometry(), mat('#ffffff', { vertexColors: true, roughness: 0.9, metalness: 0.02 }));
  helmet.add(helmetMesh);
  // small stamped plate, the same dull metal as the kit
  const bdir = new THREE.Vector3(0, 0.55, 0.835).normalize();
  const badge = part('badge', ellipsoid(0.042, 0.05, 0.016, 28, 14, (v) => { v.y *= 1 - 0.3 * Math.max(0, -v.y); }), mat(COL.badge, { roughness: 0.7, metalness: 0.3 }));
  badge.position.copy(bdir.clone().multiplyScalar(0.548));
  badge.lookAt(badge.position.clone().add(bdir));
  helmet.add(badge);

  // ---- arms (skinned) with mitten hands ----
  const arms = [];
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
    const limb = skinnedLimb(`arm${s < 0 ? 'L' : 'R'}`, pts, 0.046, 0.036, limbMat);
    body.add(limb.mesh);
    const hand = new THREE.Group();
    hand.name = `hand${s < 0 ? 'L' : 'R'}Rig`;
    // hand hangs in line with the forearm, tipped a touch forward, palm toward the thigh
    hand.position.set(-0.004 * s, -0.04, 0.012);
    hand.rotation.set(-0.22, 0.12 * s, 0.06 * s);
    limb.bones[2].add(hand);
    // loosely curled hand: flat across the palm, fingers rolling in toward the body
    const mitt = part(`mitt${s < 0 ? 'L' : 'R'}`, ellipsoid(0.05, 0.078, 0.062, 32, 24, (v) => {
      const d = Math.max(0, -v.y);
      v.x -= s * 0.45 * d * d; // fingertips curl toward the palm side
      v.z *= 1 - 0.18 * d;
    }), gloveMat);
    hand.add(mitt);
    const thumb = part(`thumb${s < 0 ? 'L' : 'R'}`, ellipsoid(0.022, 0.04, 0.024, 20, 14), gloveMat);
    // thumb rests along the front of the curled fingers
    thumb.position.set(-0.01 * s, -0.012, 0.05);
    thumb.rotation.set(0.25, 0, 0.12 * s);
    hand.add(thumb);
    const cuff = part(`cuff${s < 0 ? 'L' : 'R'}`, ellipsoid(0.054, 0.026, 0.056, 28, 12), gloveMat);
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
    const limb = skinnedLimb(`leg${s < 0 ? 'L' : 'R'}`, pts, 0.062, 0.05, limbMat);
    root.add(limb.mesh);
    const foot = new THREE.Group();
    foot.name = `foot${s < 0 ? 'L' : 'R'}Rig`;
    limb.bones[2].add(foot);
    // boot: sculpted ellipsoid with a flat sole and a rounded toe box
    const SOLE = -0.083; // ankle sits at y=0.085, so the sole lands 2mm above the plate
    const bootGeo = ellipsoid(0.1, 0.085, 0.16, 48, 32, (v) => {
      if (v.z > 0) v.y *= 1 - 0.25 * v.z; // toe slopes down
      if (v.y < -0.4) v.y = -0.4 - (v.y + 0.4) * 0.15; // flatten into sole
    });
    const bb = new THREE.Box3().setFromBufferAttribute(bootGeo.attributes.position);
    bootGeo.translate(0, SOLE - bb.min.y, 0.05);
    paint(bootGeo, (v, c) => c.set(v.y < SOLE + 0.025 ? COL.sole : COL.boot));
    const boot = part(`boot${s < 0 ? 'L' : 'R'}`, bootGeo, bootMat);
    foot.add(boot);
    legs.push({ ...limb, foot, s });
  }

  // ---- idle animation ----
  const rest = {
    arm: arms.map((a) => a.bones.map((b) => b.rotation.clone())),
  };
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { blinkAt: 2.4 };

  function setPhase(t, motion = !reduced) {
    const breathe = motion ? Math.sin((t / 3.2) * Math.PI * 2) : 0;
    // breathing: body swells a touch and rises, pivoting around the hips
    body.position.y = BODY_Y + 0.008 * breathe;
    bodyMesh.scale.set(1 + 0.008 * breathe, 1 + 0.012 * breathe, 1 + 0.008 * breathe);
    arms.forEach((a, i) => {
      const s = i === 0 ? -1 : 1;
      const sway = motion ? Math.sin((t / 3.2) * Math.PI * 2 + 0.5) : 0;
      // arms ride the breath: a faint swing that lags the chest, elbows stay soft
      a.bones[0].rotation.x = rest.arm[i][0].x - 0.018 * sway;
      a.bones[0].rotation.z = rest.arm[i][0].z + s * 0.008 * sway;
      a.bones[1].rotation.x = rest.arm[i][1].x - 0.012 * sway;
    });
    // blink: quick squash on a ~3.6s loop
    const bt = (t % 3.6) - (state.blinkAt % 3.6);
    const blink = bt > 0 && bt < 0.16 ? Math.sin((bt / 0.16) * Math.PI) : 0;
    eyes.forEach((e) => e.scale.set(1, 1 - 0.85 * blink, 1));
    root.updateMatrixWorld(true);
  }
  setPhase(0);

  root.userData = { setPhase, parts: () => collectParts(root) };
  return root;
}

export function collectParts(root) {
  const out = [];
  root.traverse((o) => { if (o.isMesh && o.userData.part) out.push(o); });
  return out;
}

// Collision volume for the pea: vertical capsule around body + limbs.
export const PEA_COLLIDER = { a: new THREE.Vector3(0, 0.3, 0).multiplyScalar(PEA_SCALE), b: new THREE.Vector3(0, 1.05, 0).multiplyScalar(PEA_SCALE), r: 0.78 * PEA_SCALE };
