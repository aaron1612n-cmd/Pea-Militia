import * as THREE from 'three';
import { height, normalAt, nearRoad, layout, POINTS, POINT_R, slopeAt, noise } from './terrain.js';
import { buildScene } from './scenebuild.js';
import { HALF } from './world.js';
import { InstCull } from './instcull.js';

// Small scenery with no collision: grass and weed tufts, pebbles, rubble round the shell craters,
// barbed-wire runs on posts, tyre stacks, burnt-out wrecks and smoke columns. Everything is
// instanced, so the whole layer costs about a dozen draw calls. Fixed seed, same every battle.

const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true, ...extra });
const strip = (g) => {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position') out.deleteAttribute(k);
  out.computeVertexNormals();
  return out;
};
function pebble() {
  const g = new THREE.IcosahedronGeometry(0.09, 0);
  g.scale(1.3, 0.55, 1);
  return strip(g);
}
// one baked scene model: [geometry, material]
const model = (type, v = 0) => { const { geometry, material } = buildScene(type, v).bake()[0]; return [geometry, material]; };
const GRASS = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, vertexColors: true, side: THREE.DoubleSide });

export function buildDecor(battle, seed = 11) {
  const group = new THREE.Group();
  group.name = 'decor';
  group.userData.culls = [];
  group.userData.spots = { wreck: [], wire: [] };
  let s = seed * 9973 + 5;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const EDGE = HALF - 3;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  // one instanced mesh per model. tint: a colour or a function per item. far: how far out it is still drawn (0 = to the fog)
  const place = (g, material, list, { shadow = false, tint, far = 0, name } = {}) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(g, material, list.length);
    list.forEach((it, i) => {
      e.set(it.tx || 0, it.yaw || 0, it.tz || 0);
      q.setFromEuler(e);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, sc.setScalar(it.s || 1));
      im.setMatrixAt(i, m);
      const t = it.tint ?? tint;
      if (t) im.setColorAt(i, col.set(t).offsetHSL(0, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.12));
    });
    if (name) im.name = name;
    im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false;
    group.add(im);
    // a sphere per instance, so what is out of view or too far to read is not drawn (tufts and pebbles are under a pixel past a short distance)
    g.computeBoundingSphere();
    const bs = g.boundingSphere, sp = new Float32Array(list.length * 4);
    list.forEach((it, i) => { const s = it.s || 1; sp[i * 4] = it.x; sp[i * 4 + 1] = it.y + bs.center.y * s; sp[i * 4 + 2] = it.z; sp[i * 4 + 3] = bs.radius * s + 0.3; });
    group.userData.culls.push(new InstCull([im], sp, { far }));
    return im;
  };
  const open = (x, z) => nearRoad(x, z) > 1.5 && POINTS.every((pt) => Math.hypot(x - pt.x, z - pt.z) > 2.5) && !layout.craters.some((c) => Math.hypot(x - c.x, z - c.z) < c.r * 0.8);

  // grass tufts, dense off the roads, and a few dry weeds: one mesh, the weeds just tinted dry
  const grass = [];
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() * 2 - 1) * EDGE, z = (rnd() * 2 - 1) * EDGE;
    if (!open(x, z) || slopeAt(x, z) > 0.55) continue;
    const dry = rnd() < 0.18;
    grass.push({ x, y: height(x, z) - 0.02, z, yaw: rnd() * 6.3, s: 0.7 + rnd() * 0.9, tint: dry ? '#d8c27a' : '#8fa060' });
  }
  place(model('tuft', 0)[0], GRASS, grass, { far: 85, name: 'grass' });

  // pebbles scattered everywhere, more on slopes
  const stones = [];
  for (let i = 0; i < 900; i++) {
    const x = (rnd() * 2 - 1) * EDGE, z = (rnd() * 2 - 1) * EDGE;
    stones.push({ x, y: height(x, z) + 0.01, z, yaw: rnd() * 6.3, s: 0.6 + rnd() * 1.6 });
  }
  place(pebble(), mat('#85817a'), stones, { tint: '#85817a', far: 60 });

  // shell craters: a ring of broken earth and masonry thrown out round each, and a smoke column over some
  const rubble = [[], []], smokers = [];
  layout.craters.forEach((c, i) => {
    const n = 4 + Math.floor(c.r * 1.8);
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.3, r = c.r * (1.05 + rnd() * 0.5);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      rubble[k % 2].push({ x, y: height(x, z) + 0.01, z, yaw: rnd() * 6.3, tx: (rnd() - 0.5) * 0.15, tz: (rnd() - 0.5) * 0.15, s: 0.9 + rnd() * 1.4 });
    }
    if (i % 4 === 0 && c.r > 2.4) smokers.push({ x: c.x, y: height(c.x, c.z) + 0.2, z: c.z, r: c.r });
  });
  for (const v of [0, 1]) { const [g, mt] = model('debris', v); place(g, mt, rubble[v], { shadow: true, far: 110, name: `debris${v}` }); }

  // barbed wire: short runs of concertina between pickets, gaps left for walking through
  const coils = [];
  for (let run = 0, tries = 0; run < 16 && tries < 300; tries++) {
    const x0 = (rnd() * 2 - 1) * (EDGE - 10), z0 = (rnd() * 2 - 1) * (EDGE - 10);
    if (!open(x0, z0) || nearRoad(x0, z0) < 4) continue;
    run++;
    let yaw = rnd() * Math.PI, x = x0, z = z0;
    for (let i = 0, n = 2 + Math.floor(rnd() * 4); i < n; i++) {
      const len = 2.6, nx = x + Math.cos(yaw) * len, nz = z - Math.sin(yaw) * len;
      if (!open(nx, nz) || Math.abs(nx) > EDGE || Math.abs(nz) > EDGE) break;
      const y0 = height(x, z), y1 = height(nx, nz);
      coils.push({ x: (x + nx) / 2, y: (y0 + y1) / 2, z: (z + nz) / 2, yaw, tz: Math.atan2(y1 - y0, len) });
      x = nx; z = nz; yaw += (rnd() - 0.5) * 0.3;
    }
  }
  { const [g, mt] = model('wire'); place(g, mt, coils, { shadow: true, name: 'wire' }); }
  group.userData.spots.wire = coils.map((c) => ({ x: c.x, y: c.y, z: c.z }));

  // tyre piles and wrecks near roads and points
  const tyres = [], wrecks = [[], []];
  for (let i = 0; i < 70 && tyres.length < 14; i++) {
    const x = (rnd() * 2 - 1) * (EDGE - 8), z = (rnd() * 2 - 1) * (EDGE - 8);
    if (nearRoad(x, z) < 3 || nearRoad(x, z) > 10 || !open(x, z)) continue;
    tyres.push({ x, y: height(x, z) - 0.01, z, yaw: rnd() * 6.3 });
  }
  { const [g, mt] = model('tyres'); place(g, mt, tyres, { shadow: true, name: 'tyres' }); }
  const wreckAt = [];
  for (let i = 0, tries = 0; i < 5 && tries < 200; tries++) {
    const x = (rnd() * 2 - 1) * (EDGE - 12), z = (rnd() * 2 - 1) * (EDGE - 12);
    if (nearRoad(x, z) < 3 || !open(x, z) || POINTS.some((pt) => Math.hypot(x - pt.x, z - pt.z) < POINT_R + 6) || layout.bases.some((b) => Math.hypot(x - b.x, z - b.z) < 25)) continue;
    const n = normalAt(x, z);
    // seat the hulk on the lowest ground under its footprint so no corner floats, then tilt it with the slope
    let y = height(x, z);
    for (const [dx, dz] of [[-1.6, -0.8], [1.6, -0.8], [-1.6, 0.8], [1.6, 0.8]]) y = Math.min(y, height(x + dx, z + dz));
    const w = { x, y: y - 0.06, z, yaw: rnd() * 6.3, tx: n.z * 0.25, tz: -n.x * 0.25 };
    wrecks[i % 2].push(w); wreckAt.push(w);
    i++;
  }
  { const [g, mt] = model('tankHulk'); place(g, mt, wrecks[0], { shadow: true, name: 'wreck-tank' }); }
  { const [g, mt] = model('truckHulk'); place(g, mt, wrecks[1], { shadow: true, name: 'wreck-truck' }); }
  group.userData.spots.wreck = wreckAt.map((w) => ({ x: w.x, y: w.y, z: w.z, r: 4 }));

  // undergrowth in patches, and the odd felled tree
  const bushes = [[], []], felled = [];
  for (let i = 0, tries = 0; i < 170 && tries < 1500; tries++) {
    const x = (rnd() * 2 - 1) * EDGE, z = (rnd() * 2 - 1) * EDGE;
    if (!open(x, z) || slopeAt(x, z) > 0.6 || noise(x * 0.045 + 3, z * 0.045) < 0.5) continue;
    bushes[rnd() < 0.55 ? 0 : 1].push({ x, y: height(x, z) - 0.04, z, yaw: rnd() * 6.3, s: 0.75 + rnd() * 0.6, tint: ['#ffffff', '#f2e9c6', '#dfe8cc'][Math.floor(rnd() * 3)] });
    i++;
  }
  for (let i = 0, tries = 0; i < 16 && tries < 600; tries++) {
    const x = (rnd() * 2 - 1) * (EDGE - 6), z = (rnd() * 2 - 1) * (EDGE - 6);
    if (!open(x, z) || nearRoad(x, z) < 2.5 || slopeAt(x, z) > 0.35 || POINTS.some((pt) => Math.hypot(x - pt.x, z - pt.z) < POINT_R + 3)) continue;
    let y = height(x, z); for (const [dx, dz] of [[-1.6, 0], [1.6, 0], [0, -1], [0, 1]]) y = Math.min(y, height(x + dx, z + dz));
    felled.push({ x, y: y - 0.05, z, yaw: rnd() * 6.3 }); i++;
  }
  for (const v of [0, 1]) { const [g, mt] = model('bush', v); place(g, mt, bushes[v], { shadow: false, far: 95, name: `bush${v}` }); }
  { const [g, mt] = model('felled'); place(g, mt, felled, { shadow: true, far: 120, name: 'felled' }); }

  const wrecksAll = wreckAt;
  // smoke columns: slow rising puffs over some craters and wrecks (static when motion is reduced)
  for (const w of wrecksAll) smokers.push({ x: w.x, y: w.y + 1.4, z: w.z, r: 1.2 });
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
  group.userData.fires = wrecksAll.map((w) => ({ x: w.x, y: w.y + 1.0, z: w.z }));
  group.userData.tick = tick;
  group.userData.smoke = pts;
  return group;
}
