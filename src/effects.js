import * as THREE from 'three';
import { height, normalAt } from './terrain.js';
import { Gore } from './gore.js';

// Particles as soft round sprites: one additive system (fire, sparks, plasma, flashes) and one
// normal-blended system (smoke, steam, dust, pea juice). Plus pooled tracer streaks.
const VERT = `
attribute float alpha; attribute float size; attribute vec3 tint;
uniform float uScale; varying float vA; varying vec3 vC;
void main(){ vA = alpha; vC = tint; vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = size * uScale / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }`;
const FRAG = `
varying float vA; varying vec3 vC; uniform float uSoft;
void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = vA * (1.0 - smoothstep(uSoft, 1.0, d));
  if (a < 0.01) discard; gl_FragColor = vec4(vC, a);
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(max, additive) {
    this.max = max;
    this.n = 0;
    this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 400 }, uSoft: { value: additive ? 0.1 : 0.35 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  // o: { pos, vel, life, size:[a,b], color:[c0,c1], alpha:[a0,a1], drag, grav }
  emit(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.pos.x, y: o.pos.y, z: o.pos.z,
      vx: o.vel?.x || 0, vy: o.vel?.y || 0, vz: o.vel?.z || 0,
      t: 0, life: o.life || 0.5,
      s0: o.size[0], s1: o.size[1],
      c0: o.color[0], c1: o.color[1] || o.color[0],
      a0: o.alpha?.[0] ?? 1, a1: o.alpha?.[1] ?? 0,
      drag: o.drag ?? 1, grav: o.grav ?? 0, floor: o.floor ?? true,
    });
  }

  update(dt) {
    const out = [];
    const c = new THREE.Color();
    let i = 0;
    for (const q of this.p) {
      q.t += dt;
      if (q.t >= q.life) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vz *= k; q.vy = q.vy * k - q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.floor && q.vy < 0 && q.y < (q.gy = height(q.x, q.z)) + 0.02) { q.y = q.gy + 0.02; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      out.push(q);
      const u = q.t / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      c.copy(q.c0).lerp(q.c1, u);
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.alpha[i] = q.a0 + (q.a1 - q.a0) * u;
      this.size[i] = q.s0 + (q.s1 - q.s0) * u;
      i++;
    }
    this.p = out;
    const g = this.points.geometry;
    g.setDrawRange(0, i);
    for (const k of ['position', 'tint', 'alpha', 'size']) g.attributes[k].needsUpdate = true;
  }
}

const C = (h) => new THREE.Color(h);
const PAL = {
  flash: C('#fff2c0'), flash2: C('#ff9a3a'),
  fire0: C('#ffd27a'), fire1: C('#c2381a'),
  smoke0: C('#57534c'), smoke1: C('#8d8a84'),
  steam: C('#eef0ee'),
  dust: C('#8f8b80'),
  spark: C('#ffcf7a'),
  plasma: C('#a8fff4'), plasma1: C('#2bb7ab'),
  juice: C('#6f8f3a'), juice1: C('#4d6427'),
  yjuice: C('#c3a144'), cjuice: C('#cbbf98'),
  metal: C('#c9c3b5'),
  dust1: C('#a7a194'), chip: C('#5d5a53'), mote: C('#d9d2c2'),
};
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const TRACER_SPEED = 240; // m/s, slowed down so the eye can follow it
const TRACER_LEN = 3.2;

export function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// four-point star with a hot core
function flashTexture() {
  return canvasTex(64, (g, S) => {
    const h = S / 2;
    const gr = g.createRadialGradient(h, h, 0, h, h, h);
    gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,200,120,0.8)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gr;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? h * 0.28 : h * (0.75 + Math.random() * 0.25);
      g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
    }
    g.fill();
  });
}
function holeTexture() {
  return canvasTex(64, (g, S) => {
    const h = S / 2;
    const gr = g.createRadialGradient(h, h, 0, h, h, h);
    gr.addColorStop(0, 'rgba(25,24,22,0.95)'); gr.addColorStop(0.25, 'rgba(45,43,40,0.7)'); gr.addColorStop(0.6, 'rgba(70,68,64,0.25)'); gr.addColorStop(1, 'rgba(70,68,64,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
}
function scorchTexture() {
  return canvasTex(128, (g, S) => {
    const h = S / 2;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * h * 0.35, r = h * (0.35 + Math.random() * 0.35);
      const x = h + Math.cos(a) * d, y = h + Math.sin(a) * d;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(20,18,16,0.32)'); gr.addColorStop(1, 'rgba(20,18,16,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    }
    // spatter streaks thrown out from the centre
    g.strokeStyle = 'rgba(22,20,18,0.35)';
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r0 = h * 0.3, r1 = h * (0.55 + Math.random() * 0.4);
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath(); g.moveTo(h + Math.cos(a) * r0, h + Math.sin(a) * r0); g.lineTo(h + Math.cos(a) * r1, h + Math.sin(a) * r1); g.stroke();
    }
  });
}
function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array, pb = b.attributes.position.array;
  const ua = a.attributes.uv.array, ub = b.attributes.uv.array;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...pa, ...pb]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([...ua, ...ub]), 2));
  const n = pa.length / 3;
  g.setIndex([...a.index.array, ...[...b.index.array].map((i) => i + n)]);
  return g;
}
export function decalMesh(scene, n, tex, rough) {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: rough, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.count = 0;
  m.frustumCulled = false;
  m.receiveShadow = true;
  m.renderOrder = 1;
  m.userData.next = 0;
  scene.add(m);
  return m;
}
const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _ds = new THREE.Vector3(), _dp = new THREE.Vector3(), _dr = new THREE.Quaternion();
export function stamp(mesh, pos, normal, size) {
  const n = mesh.instanceMatrix.count;
  const i = mesh.userData.next++ % n;
  _dq.setFromUnitVectors(Y, normal);
  _dr.setFromAxisAngle(Y, Math.random() * Math.PI * 2);
  _dq.multiply(_dr);
  _dp.copy(pos).addScaledVector(normal, 0.012);
  mesh.setMatrixAt(i, _dm.compose(_dp, _dq, _ds.set(size, 1, size)));
  mesh.count = Math.min(n, Math.max(mesh.count, i + 1));
  mesh.instanceMatrix.needsUpdate = true;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.add = new Particles(2600, true);
    this.norm = new Particles(2600, false);
    this.motes = new Particles(160, false);
    this.motes.mat.uniforms.uSoft.value = 0.2;
    scene.add(this.norm.points, this.add.points, this.motes.points);
    this.shake = 0;
    this.cam = null;
    // tracers: short glowing streaks that fly from the muzzle to the hit
    const tg = new THREE.CylinderGeometry(1, 0.35, 1, 6, 1, true);
    tg.translate(0, -0.5, 0); // the head sits at the origin, the tail trails behind
    this.tracerMat = new THREE.MeshBasicMaterial({ color: '#ffc57a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tracers = [];
    for (let i = 0; i < 260; i++) {
      const m = new THREE.Mesh(tg, this.tracerMat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 4;
      scene.add(m);
      this.tracers.push({ m, a: new THREE.Vector3(), d: new THREE.Vector3(), len: 0, t: 0, w: 0.012 });
    }
    this.ti = 0;
    this.v = new THREE.Vector3();
    // muzzle flash cards: two crossed star-shaped quads along the barrel
    this.flashTex = flashTexture();
    const fg = new THREE.PlaneGeometry(1, 1);
    const fg2 = fg.clone().rotateY(Math.PI / 2);
    const fgeo = mergeTwo(fg, fg2);
    fgeo.translate(0, 0, 0.5);
    this.flashMat = new THREE.MeshBasicMaterial({ map: this.flashTex, color: '#ffd9a0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.flashes = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(fgeo, this.flashMat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 5;
      scene.add(m);
      this.flashes.push({ m, t: 1, life: 0.05 });
    }
    this.fi = 0;
    // a few pooled lights that blink with nearby shots and blasts (fixed count: no shader rebuilds)
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight('#ffb35c', 0, 9, 1.6);
      l.userData = { t: 1, life: 0.06, peak: 0 };
      scene.add(l);
      this.lights.push(l);
    }
    this.li = 0;
    // blast rings: a flat shockwave that races out over the ground
    const rg = new THREE.RingGeometry(0.9, 1, 48);
    rg.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: '#f0e2c8', transparent: true, opacity: 0, depthWrite: false, fog: false }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 2;
      scene.add(m);
      this.rings.push({ m, t: 1, life: 0.45, r: 3 });
    }
    this.ri = 0;
    // marks left on the field: bullet scuffs and blast scorches (ring buffers of instances)
    this.holes = decalMesh(scene, 1800, holeTexture(), 0.9);
    this.scorch = decalMesh(scene, 60, scorchTexture(), 0.92);
    this.gore = new Gore(scene, this);
    // things that keep smoking for a while (blast sites, burning bodies)
    this.emitters = [];
    this.q = new THREE.Quaternion();
  }

  setCamera(camera, height) {
    const s = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.add.mat.uniforms.uScale.value = s;
    this.norm.mat.uniforms.uScale.value = s;
    this.motes.mat.uniforms.uScale.value = s;
    this.cam = camera;
  }

  update(dt) {
    this.add.update(dt);
    this.norm.update(dt);
    this.gore.update(dt);
    this.updateMotes(dt);
    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.t += dt;
      const head = t.t * TRACER_SPEED;
      if (head - TRACER_LEN > t.len) { t.m.visible = false; continue; }
      const h = Math.min(head, t.len), tail = Math.max(0, head - TRACER_LEN);
      t.m.position.copy(t.a).addScaledVector(t.d, h);
      t.m.scale.set(t.w, Math.max(0.01, h - tail), t.w);
    }
    for (const f of this.flashes) {
      if (!f.m.visible) continue;
      f.t += dt;
      if (f.t >= f.life) f.m.visible = false;
    }
    for (const l of this.lights) {
      const u = l.userData;
      if (u.t >= u.life) { l.intensity = 0; continue; }
      u.t += dt;
      l.intensity = u.peak * Math.max(0, 1 - u.t / u.life);
    }
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.m.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k);
      r.m.scale.setScalar(0.3 + r.r * 1.6 * e);
      r.m.material.opacity = 0.22 * (1 - k) * (1 - k);
    }
    const keep = [];
    for (const e of this.emitters) {
      e.t += dt;
      if (e.t >= e.life) continue;
      e.acc += dt * e.rate * (1 - e.t / e.life * 0.6);
      while (e.acc >= 1) { e.acc -= 1; e.fn(e, this); }
      keep.push(e);
    }
    this.emitters = keep;
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  // drifting dust in the air around the camera, so the field has some depth
  updateMotes(dt) {
    const m = this.motes;
    if (this.cam && m.p.length < 120 && Math.random() < dt * 60) {
      const c = this.cam.position;
      m.emit({
        pos: new THREE.Vector3(c.x + this.rnd(22), Math.max(0.3, c.y + this.rnd(6)), c.z + this.rnd(22)),
        vel: new THREE.Vector3(0.35 + this.rnd(0.15), this.rnd(0.06), 0.12 + this.rnd(0.1)),
        life: 5 + Math.random() * 4, size: [0.035, 0.035], color: [PAL.mote, PAL.mote], alpha: [0, 0], drag: 0, floor: false,
      });
    }
    m.update(dt);
    // fade in and out (alpha in the buffer is overwritten after update)
    for (let i = 0; i < m.p.length; i++) {
      const q = m.p[i];
      const u = q.t / q.life;
      m.alpha[i] = 0.45 * Math.sin(Math.PI * u);
    }
  }

  // light pulse at p (skipped when far from the camera)
  pulse(p, peak, life, dist = 9, color) {
    if (this.cam && this.cam.position.distanceToSquared(p) > 45 * 45) return;
    const l = this.lights[this.li++ % this.lights.length];
    l.position.copy(p);
    l.distance = dist;
    l.color.set(color || '#ffb35c');
    l.userData.t = 0; l.userData.life = life; l.userData.peak = peak;
    l.intensity = peak;
  }

  tracer(a, b, width = 0.012) {
    const t = this.tracers[this.ti++ % this.tracers.length];
    const len = this.v.subVectors(b, a).length();
    if (len < 0.3) return;
    t.a.copy(a);
    t.d.copy(this.v).divideScalar(len);
    t.len = len;
    t.t = 0;
    t.w = width * 1.4;
    t.m.quaternion.setFromUnitVectors(Y, t.d);
    t.m.position.copy(a);
    t.m.scale.set(t.w, 0.01, t.w);
    t.m.visible = true;
  }

  // scuff on a surface the bullet hit (only flat-ish ground and tops keep a mark)
  mark(pos, normal, size = 0.16) {
    if (!normal || normal.y < 0.7) return;
    stamp(this.holes, pos, normal, size * (0.8 + Math.random() * 0.5));
  }

  rnd(s = 1) { return (Math.random() * 2 - 1) * s; }
  dir(s = 1) { return new THREE.Vector3(this.rnd(), this.rnd(), this.rnd()).normalize().multiplyScalar(s * Math.random()); }

  muzzle(pos, dir, big = 1) {
    const f = this.flashes[this.fi++ % this.flashes.length];
    f.m.position.copy(pos);
    f.m.quaternion.setFromUnitVectors(Z, this.v.copy(dir).normalize());
    f.m.rotateZ(Math.random() * Math.PI);
    const s = (0.22 + Math.random() * 0.12) * big;
    f.m.scale.set(s, s, s * 1.8);
    f.t = 0; f.life = 0.045; f.m.visible = true;
    this.pulse(pos, 2.2 * big, 0.06, 7);
    for (let i = 0; i < 3; i++) this.add.emit({ pos, vel: dir.clone().multiplyScalar(2 + i * 2).add(this.dir(0.6)), life: 0.05 + 0.02 * i, size: [0.14 * big, 0.04], color: [PAL.flash, PAL.flash2], alpha: [1, 0.2], floor: false });
    for (let i = 0; i < 2; i++) this.add.emit({ pos, vel: dir.clone().multiplyScalar(6).add(this.dir(3)), life: 0.12, size: [0.025, 0.01], color: [PAL.spark, PAL.flash2], grav: 4, floor: false });
    this.norm.emit({ pos, vel: dir.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.35, 0)), life: 0.9, size: [0.06 * big, 0.45 * big], color: [PAL.smoke1, PAL.smoke1], alpha: [0.3, 0], drag: 2, grav: -0.3 });
  }

  impact(pos, normal, kind = 'dust') {
    const base = normal || new THREE.Vector3(0, 1, 0);
    if (kind === 'metalhole' && normal) { stamp(this.holes, pos, normal, 0.12 + Math.random() * 0.08); kind = 'metal'; }
    if (kind === 'metal') {
      for (let i = 0; i < 6; i++) this.add.emit({ pos, vel: base.clone().multiplyScalar(2).add(this.dir(3)), life: 0.25, size: [0.03, 0.01], color: [PAL.spark, PAL.flash2], grav: 9, drag: 1 });
      return;
    }
    if (kind === 'dust') {
      this.mark(pos, normal);
      for (let i = 0; i < 4; i++) this.norm.emit({ pos, vel: base.clone().multiplyScalar(2.2 + Math.random() * 1.5).add(this.dir(0.9)), life: 0.5 + Math.random() * 0.5, size: [0.06, 0.35], color: [PAL.dust, PAL.dust1], alpha: [0.7, 0], drag: 3, grav: 0.3 });
      for (let i = 0; i < 4; i++) this.norm.emit({ pos, vel: base.clone().multiplyScalar(2.5).add(this.dir(2)), life: 0.6, size: [0.035, 0.03], color: [PAL.chip, PAL.chip], alpha: [1, 0.8], grav: 11, drag: 0.5 });
      this.add.emit({ pos, life: 0.05, size: [0.12, 0.05], color: [PAL.spark, PAL.flash2], alpha: [0.7, 0], floor: false });
      return;
    }
    const col = kind === 'juice' ? PAL.juice : kind === 'yjuice' ? PAL.yjuice : kind === 'cjuice' ? PAL.cjuice : PAL.dust;
    const n = kind.endsWith('juice') ? 7 : 5;
    for (let i = 0; i < n; i++) {
      this.norm.emit({ pos, vel: base.clone().multiplyScalar(1.2).add(this.dir(1.4)), life: 0.4 + Math.random() * 0.3, size: [0.05, kind.endsWith('juice') ? 0.03 : 0.2], color: [col, kind.endsWith('juice') ? PAL.juice1 : PAL.dust], alpha: [0.9, 0], grav: kind.endsWith('juice') ? 8 : 0.5, drag: 2 });
    }
  }

  explosion(pos, r = 3) {
    const k = r / 3;
    const gy = height(pos.x, pos.z);
    this.pulse(pos.clone().setY(pos.y + 0.6), 40 * k, 0.35, 18 * k, '#ff9a48');
    // blinding core, then a rolling fireball
    for (let i = 0; i < 6; i++) this.add.emit({ pos: pos.clone().add(this.dir(0.3 * k)), vel: this.dir(1.5 * k), life: 0.12, size: [1.8 * k, 2.6 * k], color: [PAL.flash, PAL.fire0], alpha: [1, 0], drag: 6, floor: false });
    for (let i = 0; i < 30; i++) this.add.emit({ pos: pos.clone().add(this.dir(0.4 * k)), vel: this.dir(5 * k).add(new THREE.Vector3(0, 2.4, 0)), life: 0.35 + Math.random() * 0.45, size: [0.7 * k, 1.5 * k], color: [PAL.fire0, PAL.fire1], alpha: [1, 0], drag: 4, grav: -1, floor: true });
    // dark smoke that billows up and hangs around
    for (let i = 0; i < 24; i++) this.norm.emit({ pos: pos.clone().add(this.dir(0.6 * k)), vel: this.dir(3 * k).add(new THREE.Vector3(0, 1.8, 0)), life: 2.2 + Math.random() * 2, size: [0.6 * k, 3 * k], color: [PAL.smoke0, PAL.smoke1], alpha: [0.8, 0], drag: 1.6, grav: -0.5 });
    // ground skirt: dust thrown out low and wide
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
      this.norm.emit({ pos: pos.clone().setY(gy + (pos.y - gy) * 0.3 + 0.1), vel: new THREE.Vector3(Math.cos(a), 0.12, Math.sin(a)).multiplyScalar(7 * k), life: 1.2 + Math.random() * 0.6, size: [0.4 * k, 1.8 * k], color: [PAL.dust, PAL.dust1], alpha: [0.6, 0], drag: 3.2 });
    }
    for (let i = 0; i < 22; i++) this.add.emit({ pos, vel: this.dir(12 * k).add(new THREE.Vector3(0, 5, 0)), life: 0.8, size: [0.05, 0.02], color: [PAL.spark, PAL.fire1], grav: 12, drag: 0.6 });
    for (let i = 0; i < 14; i++) this.norm.emit({ pos, vel: this.dir(7 * k).add(new THREE.Vector3(0, 4, 0)), life: 1.3, size: [0.07, 0.06], color: [PAL.chip, PAL.chip], alpha: [1, 0.7], grav: 12, drag: 0.4 });
    const ring = this.rings[this.ri++ % this.rings.length];
    ring.m.position.set(pos.x, Math.max(gy, pos.y - 0.4) + 0.05, pos.z);
    ring.t = 0; ring.r = r; ring.m.visible = true;
    if (pos.y < gy + 1.2) stamp(this.scorch, new THREE.Vector3(pos.x, Math.max(gy, pos.y - 0.4), pos.z), normalAt(pos.x, pos.z), r * (1.1 + Math.random() * 0.3));
    // a smoke column that keeps rising for a few seconds
    const at = pos.clone();
    this.emitters.push({ t: 0, life: 4 + k * 2, rate: 7, acc: 0, fn: (e, fx) => {
      fx.norm.emit({ pos: at.clone().add(fx.dir(0.5 * k)), vel: new THREE.Vector3(fx.rnd(0.2) + 0.2, 1.1 + Math.random() * 0.6, fx.rnd(0.2)), life: 3 + Math.random() * 1.5, size: [0.5 * k, 2.4 * k], color: [PAL.smoke0, PAL.smoke1], alpha: [0.4 * (1 - e.t / e.life), 0], drag: 0.6, grav: -0.1, floor: false });
      if (e.t < 1.2 && Math.random() < 0.6) fx.add.emit({ pos: at.clone().add(fx.dir(0.4 * k)).setY(gy + (at.y - gy) * 0.4 + 0.1), vel: new THREE.Vector3(0, 0.8, 0), life: 0.4, size: [0.4 * k, 0.1], color: [PAL.fire0, PAL.fire1], alpha: [0.8, 0], floor: false });
    } });
  }

  // a body that keeps smouldering for a few seconds
  smoulder(getPos, life = 3) {
    this.emitters.push({ t: 0, life, rate: 5, acc: 0, fn: (e, fx) => fx.smoke(getPos().add(fx.dir(0.15)), new THREE.Vector3(fx.rnd(0.1), 0.7, fx.rnd(0.1)), 0.7, 1) });
  }

  plasmaBurst(pos, r = 1.3) {
    for (let i = 0; i < 18; i++) this.add.emit({ pos, vel: this.dir(4 * r), life: 0.35, size: [0.35 * r, 0.05], color: [PAL.plasma, PAL.plasma1], alpha: [1, 0], drag: 5 });
  }

  plasmaTrail(pos) {
    this.add.emit({ pos, life: 0.14, size: [0.14, 0.02], color: [PAL.plasma, PAL.plasma1], alpha: [0.8, 0], floor: false });
  }

  flame(pos, vel) {
    this.add.emit({ pos, vel, life: 0.42 + Math.random() * 0.2, size: [0.06, 0.9], color: [PAL.fire0, PAL.fire1], alpha: [0.9, 0], drag: 2.2, grav: -1.5 });
    if (Math.random() < 0.3) this.norm.emit({ pos: pos.clone().addScaledVector(vel, 0.3), vel: vel.clone().multiplyScalar(0.5), life: 1.0, size: [0.3, 1.1], color: [PAL.smoke0, PAL.smoke1], alpha: [0.35, 0], drag: 1.5, grav: -1 });
  }

  burn(pos) {
    this.add.emit({ pos: pos.clone().add(this.dir(0.2)), vel: new THREE.Vector3(this.rnd(0.2), 1.2, this.rnd(0.2)), life: 0.4, size: [0.25, 0.05], color: [PAL.fire0, PAL.fire1], alpha: [0.9, 0], floor: false });
  }

  steam(pos, vel, n = 3, size = 0.5) {
    for (let i = 0; i < n; i++) this.norm.emit({ pos, vel: (vel || new THREE.Vector3(0, 1, 0)).clone().add(this.dir(0.4)), life: 0.9 + Math.random() * 0.6, size: [0.1 * size, size], color: [PAL.steam, PAL.steam], alpha: [0.55, 0], drag: 1.8, grav: -0.6, floor: false });
  }

  smoke(pos, vel, size = 0.5, dark = 0) {
    this.norm.emit({ pos, vel: vel || new THREE.Vector3(0, 0.8, 0), life: 1.5, size: [size * 0.3, size], color: [dark ? PAL.smoke0 : PAL.smoke1, PAL.smoke1], alpha: [0.45, 0], drag: 1, grav: -0.3, floor: false });
  }

  dust(pos, n = 2, size = 0.4) {
    for (let i = 0; i < n; i++) this.norm.emit({ pos: pos.clone().add(this.dir(0.2)), vel: new THREE.Vector3(this.rnd(0.6), 0.3, this.rnd(0.6)), life: 0.8, size: [size * 0.3, size], color: [PAL.dust, PAL.dust], alpha: [0.35, 0], drag: 2 });
  }

  debris(pos, color = '#7a6a50', n = 10) {
    const c = C(color);
    for (let i = 0; i < n; i++) this.norm.emit({ pos, vel: this.dir(4).add(new THREE.Vector3(0, 3, 0)), life: 1.0, size: [0.09, 0.07], color: [c, c], alpha: [1, 0.7], grav: 11, drag: 0.5 });
  }
}
