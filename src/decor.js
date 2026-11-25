import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { height, normalAt, nearRoad, layout, POINTS, POINT_R, slopeAt } from './terrain.js';
import { HALF } from './world.js';

// Small scenery with no collision: grass and weed tufts, pebbles, rubble round the shell craters,
// barbed-wire runs on posts, tyre stacks, burnt-out wrecks and smoke columns. Everything is
// instanced, so the whole layer costs about a dozen draw calls. Fixed seed, same every battle.

const strip = (g) => {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position') out.deleteAttribute(k);
  out.computeVertexNormals();
  return out;
};
const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true, ...extra });

function tuft() {
  // a fan of bent blades
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.ConeGeometry(0.028, 0.34 + (i % 3) * 0.08, 3, 1);
    g.translate(0, 0.17, 0);
    g.rotateZ(0.25 + (i % 2) * 0.2);
    g.rotateY((i / 6) * Math.PI * 2);
    parts.push(strip(g));
  }
  return mergeGeometries(parts);
}
function pebble() {
  const g = new THREE.IcosahedronGeometry(0.09, 0);
  g.scale(1.3, 0.55, 1);
  return strip(g);
}
function wirePost() {
  const post = new THREE.CylinderGeometry(0.03, 0.04, 1.1, 5);
  post.translate(0, 0.55, 0);
  return strip(post);
}
function coil(len) {
  // a loose helix of wire strung between two posts
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, a = t * Math.PI * 2 * 7;
    pts.push(new THREE.Vector3(-len / 2 + t * len, 0.55 + Math.sin(a) * 0.16 - Math.sin(t * Math.PI) * 0.08, Math.cos(a) * 0.16));
  }
  return strip(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.009, 3, false));
}
function tyre() {
  const g = new THREE.TorusGeometry(0.3, 0.12, 6, 12);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.12, 0);
  return strip(g);
}
function wreck() {
  // a burnt hull: blackened box, tilted turret ring, bent barrel
  const parts = [];
  const hull = new THREE.BoxGeometry(2.6, 0.7, 1.5, 3, 2, 3);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3) * 0.07);
  hull.translate(0, 0.45, 0);
  parts.push(strip(hull));
  const tur = new THREE.CylinderGeometry(0.5, 0.6, 0.35, 8);
  tur.translate(0.2, 1.0, 0); tur.rotateZ(0.12);
  parts.push(strip(tur));
  const gun = new THREE.CylinderGeometry(0.06, 0.07, 1.6, 6);
  gun.rotateZ(Math.PI / 2 + 0.35); gun.translate(1.1, 1.25, 0);
  parts.push(strip(gun));
  for (const z of [-0.85, 0.85]) {
    const tr = new THREE.BoxGeometry(2.7, 0.3, 0.25);
    tr.translate(0, 0.22, z);
    parts.push(strip(tr));
  }
  return mergeGeometries(parts);
}

export function buildDecor(battle, seed = 11) {
  const group = new THREE.Group();
  group.name = 'decor';
  let s = seed * 9973 + 5;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const EDGE = HALF - 3;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const place = (g, material, list, { shadow = false, tint } = {}) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(g, material, list.length);
    list.forEach((it, i) => {
      e.set(it.tx || 0, it.yaw || 0, it.tz || 0);
      q.setFromEuler(e);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, sc.setScalar(it.s || 1));
      im.setMatrixAt(i, m);
      if (tint) im.setColorAt(i, new THREE.Color(tint).offsetHSL(0, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.12));
    });
    im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false;
    group.add(im);
    return im;
  };
  const open = (x, z) => nearRoad(x, z) > 1.5 && POINTS.every((pt) => Math.hypot(x - pt.x, z - pt.z) > 2.5) && !layout.craters.some((c) => Math.hypot(x - c.x, z - c.z) < c.r * 0.8);

  // grass tufts, dense off the roads, and a few dry weeds
  const grass = [], weeds = [];
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() * 2 - 1) * EDGE, z = (rnd() * 2 - 1) * EDGE;
    if (!open(x, z) || slopeAt(x, z) > 0.55) continue;
    const it = { x, y: height(x, z) - 0.02, z, yaw: rnd() * 6.3, s: 0.7 + rnd() * 0.9 };
    (rnd() < 0.18 ? weeds : grass).push(it);
  }
  const tuftG = tuft();
  place(tuftG, new THREE.MeshStandardMaterial({ color: '#6f7a45', roughness: 1, flatShading: true, side: THREE.DoubleSide }), grass, { tint: '#6f7a45' });
  place(tuftG, new THREE.MeshStandardMaterial({ color: '#a39560', roughness: 1, flatShading: true, side: THREE.DoubleSide }), weeds, { tint: '#a39560' });

  // pebbles scattered everywhere, more on slopes
  const stones = [];
  for (let i = 0; i < 900; i++) {
    const x = (rnd() * 2 - 1) * EDGE, z = (rnd() * 2 - 1) * EDGE;
    stones.push({ x, y: height(x, z) + 0.01, z, yaw: rnd() * 6.3, s: 0.6 + rnd() * 1.6 });
  }
  place(pebble(), mat('#85817a'), stones, { tint: '#85817a' });

  // rubble ring and scorch round each crater; a few wrecks and smoke columns
  const rubble = [], scorch = [], smokers = [];
  layout.craters.forEach((c, i) => {
    const n = 5 + Math.floor(c.r * 2.2);
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.3, r = c.r * (1.05 + rnd() * 0.5);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      rubble.push({ x, y: height(x, z) + 0.02, z, yaw: rnd() * 6.3, tx: rnd() * 0.6, s: 1.2 + rnd() * 2.4 });
    }
    if (i % 4 === 0 && c.r > 2.4) smokers.push({ x: c.x, y: height(c.x, c.z) + 0.2, z: c.z, r: c.r });
  });
  place(pebble(), mat('#6b665e'), rubble, { shadow: true, tint: '#6b665e' });

  // barbed wire: short runs, gaps left for walking through
  const posts = [], coils = [];
  const cg = new Map();
  for (let run = 0, tries = 0; run < 16 && tries < 300; tries++) {
    const x0 = (rnd() * 2 - 1) * (EDGE - 10), z0 = (rnd() * 2 - 1) * (EDGE - 10);
    if (!open(x0, z0) || nearRoad(x0, z0) < 4) continue;
    run++;
    let yaw = rnd() * Math.PI, x = x0, z = z0;
    for (let i = 0, n = 2 + Math.floor(rnd() * 4); i < n; i++) {
      const len = 2.6, nx = x + Math.cos(yaw) * len, nz = z - Math.sin(yaw) * len;
      if (!open(nx, nz) || Math.abs(nx) > EDGE || Math.abs(nz) > EDGE) break;
      const y0 = height(x, z), y1 = height(nx, nz);
      posts.push({ x, y: y0, z, yaw: rnd() * 6.3, tz: (rnd() - 0.5) * 0.15 });
      if (i === n - 1) posts.push({ x: nx, y: y1, z: nz, yaw: 0, tz: (rnd() - 0.5) * 0.15 });
      coils.push({ x: (x + nx) / 2, y: (y0 + y1) / 2, z: (z + nz) / 2, yaw, tz: Math.atan2(y1 - y0, len) });
      x = nx; z = nz; yaw += (rnd() - 0.5) * 0.3;
    }
  }
  void cg;
  place(wirePost(), mat('#4a3b2c'), posts, { shadow: true });
  place(coil(2.6), new THREE.MeshStandardMaterial({ color: '#2f3233', metalness: 0.7, roughness: 0.5 }), coils);

  // tyre piles and wrecks near roads and points
  const tyres = [], wrecks = [];
  for (let i = 0; i < 70 && tyres.length < 14; i++) {
    const x = (rnd() * 2 - 1) * (EDGE - 8), z = (rnd() * 2 - 1) * (EDGE - 8);
    if (nearRoad(x, z) < 3 || nearRoad(x, z) > 10 || !open(x, z)) continue;
    for (let k = 0; k < 3; k++) tyres.push({ x: x + (k % 2) * 0.55 - 0.25, y: height(x, z) + (k === 2 ? 0.22 : 0), z: z + (k === 2 ? 0.25 : 0) + (k === 1 ? 0.1 : 0), yaw: rnd() * 6.3 });
  }
  place(tyre(), mat('#1f1f1f'), tyres, { shadow: true });
  for (let i = 0, tries = 0; i < 5 && tries < 200; tries++) {
    const x = (rnd() * 2 - 1) * (EDGE - 12), z = (rnd() * 2 - 1) * (EDGE - 12);
    if (nearRoad(x, z) < 3 || !open(x, z) || POINTS.some((pt) => Math.hypot(x - pt.x, z - pt.z) < POINT_R + 6) || layout.bases.some((b) => Math.hypot(x - b.x, z - b.z) < 25)) continue;
    const n = normalAt(x, z);
    wrecks.push({ x, y: height(x, z) - 0.05, z, yaw: rnd() * 6.3, tx: n.z * 0.4, tz: -n.x * 0.4 });
    i++;
  }
  place(wreck(), mat('#262422'), wrecks, { shadow: true });

  // smoke columns: slow rising puffs over some craters and wrecks (static when motion is reduced)
  for (const w of wrecks) smokers.push({ x: w.x, y: w.y + 1.4, z: w.z, r: 1.2 });
  const puffTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    r.addColorStop(0, 'rgba(255,255,255,0.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  // one Points object for every puff: size and fade come from per-puff attributes
  const puffs = [];
  for (const sm of smokers.slice(0, 10)) for (let k = 0; k < 8; k++) puffs.push({ sm, ph: rnd() });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(puffs.length * 3), 3));
  geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(puffs.length), 1));
  geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(puffs.length), 1));
  const pm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { map: { value: puffTex }, scale: { value: 600 } },
    vertexShader: 'attribute float size; attribute float alpha; varying float vA; uniform float scale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vA = alpha * smoothstep(10.0, 40.0, -mv.z); gl_PointSize = min(size * scale / -mv.z, 200.0); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying float vA; void main(){ vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(0.3,0.28,0.26), c.a * vA); }',
  });
  const pts = new THREE.Points(geo, pm);
  pts.frustumCulled = false;
  group.add(pts); 
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tick = (t) => {
    const P = geo.attributes.position, S = geo.attributes.size, A = geo.attributes.alpha;
    puffs.forEach(({ sm, ph }, i) => {
      const u = still ? ph : (t * 0.045 + ph) % 1;
      P.setXYZ(i, sm.x + Math.sin(u * 5 + ph * 9) * 0.5 + u * 3, sm.y + u * 9, sm.z + Math.cos(u * 4 + ph * 7) * 0.5);
      S.setX(i, 2.5 + u * 8);
      A.setX(i, 0.55 * Math.sin(Math.min(u * 1.1, 1) * Math.PI) ** 0.8);
    });
    P.needsUpdate = S.needsUpdate = A.needsUpdate = true;
  };
  tick(0);
  group.userData.fires = wrecks.map((w) => ({ x: w.x, y: w.y + 1.0, z: w.z }));
  group.userData.tick = tick;
  group.userData.smoke = pts;
  return group;
}
