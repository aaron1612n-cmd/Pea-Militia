import * as THREE from 'three';
import { ellipsoid, taperedTube, paint, ensureOutward, mergeByPosition } from './geo.js';

// Proportions (metres-ish). Body centre height; ground top is y = 0.
export const BODY_R = 0.5;
export const BODY_Y = 0.62;
const BODY_SY = 1.03;

const COL = {
  peaTop: new THREE.Color('#a4d65e'),
  peaMid: new THREE.Color('#82b844'),
  peaLow: new THREE.Color('#4f8a2a'),
  helmet: '#56603d',
  helmetDark: '#3f472c',
  brass: '#d9a441',
  boot: '#3a2a1f',
  sole: '#1e1611',
  glove: '#efe6cf',
  sclera: '#fbfaf4',
  pupil: '#1f2418',
  mouth: '#3b1a14',
  blush: '#e98a6a',
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

export function createPea() {
  const root = new THREE.Group();
  root.name = 'pea';

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
  });
  const bodyMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.3, sheenColor: new THREE.Color('#d8f0a0') });
  const limbMat = new THREE.MeshPhysicalMaterial({ color: COL.peaMid.clone().lerp(COL.peaLow, 0.25), roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const bodyMesh = part('body', bodyGeo, bodyMat);
  body.add(bodyMesh);

  // ---- face ----
  const face = new THREE.Group();
  face.name = 'face';
  body.add(face);
  const eyes = [];
  for (const s of [-1, 1]) {
    const dir = new THREE.Vector3(0.2 * s, 0.16, 0.96).normalize();
    const eye = new THREE.Group();
    eye.name = s < 0 ? 'eyeL' : 'eyeR';
    eye.position.copy(onBody(dir, -0.035));
    eye.lookAt(eye.position.clone().add(dir));
    const sclera = part(`sclera${s < 0 ? 'L' : 'R'}`, ellipsoid(0.1, 0.125, 0.075, 40, 28), mat(COL.sclera, { roughness: 0.25 }));
    eye.add(sclera);
    const pupil = part(`pupil${s < 0 ? 'L' : 'R'}`, ellipsoid(0.05, 0.064, 0.03, 32, 20), mat(COL.pupil, { roughness: 0.15 }));
    pupil.position.set(-0.012 * s, -0.008, 0.056);
    eye.add(pupil);
    const glint = part(`glint${s < 0 ? 'L' : 'R'}`, ellipsoid(0.016, 0.018, 0.008, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    glint.position.set(0.016, 0.022, 0.026);
    pupil.add(glint);
    face.add(eye);
    eyes.push(eye);

    // determined brow: tube hugging the surface above the eye
    const browPts = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const x = (0.09 + 0.2 * u) * s;
      const y = 0.33 - 0.06 * (1 - u) + 0.03 * Math.sin(u * Math.PI);
      const d = new THREE.Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)));
      browPts.push(onBody(d, 0.006));
    }
    const brow = part(`brow${s < 0 ? 'L' : 'R'}`, taperedTube(new THREE.CatmullRomCurve3(browPts), (t) => 0.02 * (0.7 + 0.5 * Math.sin(t * Math.PI)), 24, 10).geometry, mat('#2f4a1b', { roughness: 0.8 }));
    face.add(brow);

    // cheek blush, a flattened lens half-sunk into the skin
    const cdir = new THREE.Vector3(0.42 * s, -0.16, 0.89).normalize();
    const cheek = part(`cheek${s < 0 ? 'L' : 'R'}`, ellipsoid(0.062, 0.04, 0.02, 28, 16), mat(COL.blush, { roughness: 0.7 }));
    cheek.position.copy(onBody(cdir, -0.008));
    cheek.lookAt(cheek.position.clone().add(cdir));
    face.add(cheek);
  }
  // smirk
  const mouthPts = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8 - 0.5;
    const x = u * 0.26;
    const y = -0.13 - 0.05 * Math.cos(u * Math.PI) + 0.03 * u;
    mouthPts.push(onBody(new THREE.Vector3(x, y, Math.sqrt(1 - x * x - y * y)), 0.0));
  }
  const mouth = part('mouth', taperedTube(new THREE.CatmullRomCurve3(mouthPts), (t) => 0.016 * (0.6 + 0.6 * Math.sin(t * Math.PI)), 28, 10).geometry, mat(COL.mouth, { roughness: 0.5 }));
  face.add(mouth);

  // ---- helmet ----
  const helmet = new THREE.Group();
  helmet.name = 'helmetRig';
  helmet.rotation.x = -0.14;
  helmet.rotation.z = 0.06;
  body.add(helmet);
  const helmetMesh = part('helmet', helmetGeometry(), mat('#ffffff', { vertexColors: true, roughness: 0.85, metalness: 0.05 }));
  helmet.add(helmetMesh);
  const bdir = new THREE.Vector3(0, 0.62, 0.78).normalize();
  const badge = part('badge', ellipsoid(0.065, 0.065, 0.022, 32, 16), mat(COL.brass, { roughness: 0.35, metalness: 0.6 }));
  badge.position.copy(bdir.clone().multiplyScalar(0.54));
  badge.lookAt(badge.position.clone().add(bdir));
  helmet.add(badge);
  // little sprout poking out the top: the pea's stem
  const sproutPts = [new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0.01, 0.6, -0.01), new THREE.Vector3(0.05, 0.66, -0.03), new THREE.Vector3(0.1, 0.68, -0.03)];
  const sprout = part('sprout', taperedTube(new THREE.CatmullRomCurve3(sproutPts), (t) => THREE.MathUtils.lerp(0.024, 0.012, t), 20, 10).geometry, mat('#6a9c34', { roughness: 0.6 }));
  helmet.add(sprout);
  const leaf = part('leaf', ellipsoid(0.06, 0.012, 0.032, 24, 12, (v) => { v.y += 0.6 * v.x * v.x; }), mat('#7fb446', { roughness: 0.55 }));
  leaf.position.set(0.14, 0.685, -0.03);
  leaf.rotation.z = 0.35;
  helmet.add(leaf);

  // ---- arms (skinned) with mitten hands ----
  const arms = [];
  const gloveMat = mat(COL.glove, { roughness: 0.75 });
  for (const s of [-1, 1]) {
    const pts = [
      new THREE.Vector3(0.38 * s, 0.02, 0.0),
      new THREE.Vector3(0.56 * s, -0.08, 0.03),
      new THREE.Vector3(0.64 * s, -0.22, 0.07),
      new THREE.Vector3(0.66 * s, -0.33, 0.09),
    ];
    const limb = skinnedLimb(`arm${s < 0 ? 'L' : 'R'}`, pts, 0.046, 0.036, limbMat);
    body.add(limb.mesh);
    const hand = new THREE.Group();
    hand.name = `hand${s < 0 ? 'L' : 'R'}Rig`;
    hand.position.set(0.004 * s, -0.045, 0.006);
    limb.bones[2].add(hand);
    const mitt = part(`mitt${s < 0 ? 'L' : 'R'}`, ellipsoid(0.07, 0.08, 0.058, 32, 24, (v) => { v.z *= 1 - 0.25 * Math.max(0, -v.y); }), gloveMat);
    hand.add(mitt);
    const thumb = part(`thumb${s < 0 ? 'L' : 'R'}`, ellipsoid(0.026, 0.042, 0.026, 20, 14), gloveMat);
    thumb.position.set(-0.05 * s, 0.006, 0.03);
    thumb.rotation.z = 0.5 * s;
    hand.add(thumb);
    const cuff = part(`cuff${s < 0 ? 'L' : 'R'}`, ellipsoid(0.058, 0.026, 0.052, 28, 12), gloveMat);
    cuff.position.set(0, 0.06, 0);
    hand.add(cuff);
    arms.push(limb);
  }

  // ---- legs (skinned) with boots ----
  const legs = [];
  const bootMat = mat('#ffffff', { vertexColors: true, roughness: 0.7 });
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
      const sway = motion ? Math.sin((t / 3.2) * Math.PI * 2 + 0.6) : 0;
      a.bones[0].rotation.z = rest.arm[i][0].z + s * 0.05 * sway;
      a.bones[1].rotation.z = rest.arm[i][1].z + s * 0.06 * sway;
      a.bones[1].rotation.x = -0.05 * sway;
    });
    // blink: quick squash on a ~3.6s loop
    const bt = (t % 3.6) - (state.blinkAt % 3.6);
    const blink = bt > 0 && bt < 0.16 ? Math.sin((bt / 0.16) * Math.PI) : 0;
    eyes.forEach((e) => e.scale.set(1, 1 - 0.88 * blink, 1));
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
export const PEA_COLLIDER = { a: new THREE.Vector3(0, 0.3, 0), b: new THREE.Vector3(0, 1.05, 0), r: 0.78 };
