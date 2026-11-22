import * as THREE from 'three';

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
      if (q.floor && q.y < 0.02 && Math.abs(q.x) < 24 && Math.abs(q.z) < 24) { q.y = 0.02; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
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
};

export class Effects {
  constructor(scene) {
    this.add = new Particles(2400, true);
    this.norm = new Particles(2400, false);
    scene.add(this.norm.points, this.add.points);
    this.shake = 0;
    // tracers
    const tg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    tg.translate(0, 0.5, 0);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: '#ffe0a8', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = [];
    for (let i = 0; i < 220; i++) {
      const m = new THREE.Mesh(tg, this.tracerMat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ m, t: 1, life: 0.06, w: 0.012 });
    }
    this.ti = 0;
    this.v = new THREE.Vector3();
  }

  setCamera(camera, height) {
    const s = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.add.mat.uniforms.uScale.value = s;
    this.norm.mat.uniforms.uScale.value = s;
  }

  update(dt) {
    this.add.update(dt);
    this.norm.update(dt);
    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.t += dt;
      if (t.t >= t.life) { t.m.visible = false; continue; }
      const w = t.w * (1 - t.t / t.life);
      t.m.scale.x = t.m.scale.z = w;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  tracer(a, b, width = 0.012) {
    const t = this.tracers[this.ti++ % this.tracers.length];
    const d = this.v.subVectors(b, a);
    const len = d.length();
    if (len < 0.05) return;
    t.m.position.copy(a);
    t.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    t.m.scale.set(width, len, width);
    t.m.visible = true;
    t.t = 0;
    t.w = width;
  }

  rnd(s = 1) { return (Math.random() * 2 - 1) * s; }
  dir(s = 1) { return new THREE.Vector3(this.rnd(), this.rnd(), this.rnd()).normalize().multiplyScalar(s * Math.random()); }

  muzzle(pos, dir, big = 1) {
    for (let i = 0; i < 3; i++) this.add.emit({ pos, vel: dir.clone().multiplyScalar(2 + i * 2).add(this.dir(0.6)), life: 0.05 + 0.02 * i, size: [0.12 * big, 0.04], color: [PAL.flash, PAL.flash2], alpha: [1, 0.2], floor: false });
    this.norm.emit({ pos, vel: dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.3, 0)), life: 0.5, size: [0.06 * big, 0.25 * big], color: [PAL.smoke1, PAL.smoke1], alpha: [0.25, 0] });
  }

  impact(pos, normal, kind = 'dust') {
    const base = normal || new THREE.Vector3(0, 1, 0);
    if (kind === 'metal') {
      for (let i = 0; i < 6; i++) this.add.emit({ pos, vel: base.clone().multiplyScalar(2).add(this.dir(3)), life: 0.25, size: [0.03, 0.01], color: [PAL.spark, PAL.flash2], grav: 9, drag: 1 });
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
    for (let i = 0; i < 26; i++) this.add.emit({ pos: pos.clone().add(this.dir(0.4 * k)), vel: this.dir(5 * k).add(new THREE.Vector3(0, 2, 0)), life: 0.35 + Math.random() * 0.35, size: [0.7 * k, 1.3 * k], color: [PAL.fire0, PAL.fire1], alpha: [1, 0], drag: 4, floor: true });
    for (let i = 0; i < 22; i++) this.norm.emit({ pos: pos.clone().add(this.dir(0.6 * k)), vel: this.dir(3 * k).add(new THREE.Vector3(0, 1.6, 0)), life: 1.6 + Math.random() * 1.4, size: [0.6 * k, 2.4 * k], color: [PAL.smoke0, PAL.smoke1], alpha: [0.75, 0], drag: 1.6, grav: -0.4 });
    for (let i = 0; i < 18; i++) this.add.emit({ pos, vel: this.dir(11 * k).add(new THREE.Vector3(0, 4, 0)), life: 0.7, size: [0.05, 0.02], color: [PAL.spark, PAL.fire1], grav: 12, drag: 0.6 });
    for (let i = 0; i < 12; i++) this.norm.emit({ pos, vel: this.dir(6 * k).add(new THREE.Vector3(0, 3, 0)), life: 1.1, size: [0.06, 0.05], color: [C('#3a352e'), C('#3a352e')], alpha: [1, 0.6], grav: 12, drag: 0.4 });
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
