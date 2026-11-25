import * as THREE from 'three';

// Time of day (0..24 h) and weather. One object owns the sky, fog, lights, rain and lightning.
// Keyframes are hours; colours blend between neighbours.
const KEYS = [
  // h, sky top, sky mid, sky low, fog, hemi sky, hemi ground, hemi power, sun colour, sun power, exposure
  [0, '#0b1220', '#17213a', '#10192b', '#141c2c', '#5a6c93', '#1b1d26', 0.55, '#8da6d6', 0.55, 1.15],
  [5, '#1a2038', '#5a4a5a', '#3b3446', '#3a3a48', '#6c7794', '#2a2828', 0.7, '#e8a070', 0.9, 1.1],
  [7, '#6f8499', '#e0b98e', '#b79d82', '#c8aa8a', '#cfd0d2', '#5e554a', 0.95, '#ffbf85', 2.2, 1.0],
  [10, '#7e8f9c', '#d4cdbd', '#b9b3a6', '#c2baa9', '#d9dde2', '#5e554a', 1.05, '#fff0d8', 2.8, 1.0],
  [15, '#8d99a3', '#d4c8b2', '#b6ad9c', '#bdb5a6', '#d9dde2', '#5e554a', 1.05, '#ffe2bd', 2.7, 1.0],
  [18, '#4f5878', '#e29a63', '#a0735f', '#a8805f', '#c4b3a8', '#4a3f3a', 0.85, '#ff9a55', 2.0, 1.0],
  [20, '#1a2038', '#5e4a5a', '#3a3040', '#3b3544', '#6c7794', '#2a2828', 0.65, '#a58ab0', 0.7, 1.1],
  [24, '#0b1220', '#17213a', '#10192b', '#141c2c', '#5a6c93', '#1b1d26', 0.55, '#8da6d6', 0.55, 1.15],
];
const KC = KEYS.map((k) => k.map((v, i) => (typeof v === 'string' ? new THREE.Color(v) : v)));

export const TIMES = { dawn: 6, day: 12, dusk: 18.5, night: 0 };
// fog end distance (near, far) and how dark / grey each weather makes things
const WEATHER = {
  clear: { near: 45, far: 230, dim: 1, grey: 0, rain: 0, sight: 1, storm: 0 },
  fog: { near: 6, far: 70, dim: 0.85, grey: 0.7, rain: 0, sight: 0.45, storm: 0 },
  rain: { near: 20, far: 140, dim: 0.7, grey: 0.5, rain: 1, sight: 0.75, storm: 0 },
  storm: { near: 12, far: 95, dim: 0.5, grey: 0.7, rain: 1.8, sight: 0.6, storm: 1 },
};

const tmpOv = new THREE.Color();
const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function lerpKey(h, i, out) {
  let a = 0;
  while (a < KC.length - 2 && h >= KC[a + 1][0]) a++;
  const A = KC[a], B = KC[a + 1];
  const t = (h - A[0]) / (B[0] - A[0]);
  const s = t * t * (3 - 2 * t);
  const v = A[i], w = B[i];
  if (typeof v === 'number') return v + (w - v) * s;
  return out.copy(v).lerp(w, s);
}

export class Atmosphere {
  constructor({ scene, sky, hemi, sun, rim, renderer, reduced }) {
    Object.assign(this, { scene, sky, hemi, sun, rim, renderer, reduced });
    this.hour = 15;
    this.cycle = false;
    this.weather = 'clear';
    this.w = { ...WEATHER.clear }; // eased values
    this.target = WEATHER.clear;
    this.flash = 0;
    this.nextBolt = 6;
    this.sunDir = new THREE.Vector3(42, 40, 26);
    this.onThunder = null;
    this.sight = 1;
    this.night = 0;
    this.t = 0;
    this._buildRain();
    this.apply(0);
  }

  _buildRain() {
    // streaks live in a box around the camera and fall in the vertex shader (no per-frame JS work)
    const N = 1800, W = 40, H = 30;
    const pos = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * W, y = Math.random() * H, z = (Math.random() - 0.5) * W;
      pos.set([x, y, z, x, y + 1, z], i * 6);
      seed[i * 2] = seed[i * 2 + 1] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('end', new THREE.BufferAttribute(new Float32Array(N * 2).map((_, i) => i % 2), 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 }, cam: { value: new THREE.Vector3() }, alpha: { value: 0 }, color: { value: new THREE.Color('#b8c4d0') }, slant: { value: 0.12 } },
      vertexShader: `uniform float time; uniform vec3 cam; uniform float slant; attribute float end; varying float vA;
        void main(){
          vec3 p = position; float H = 30.0, W = 40.0;
          p.y = mod(p.y - time * 22.0, H);
          p.x += p.y * slant * 0.0 + time * 0.0;
          vec3 w = p; w.xz = mod(p.xz - cam.xz + W * 0.5, W) - W * 0.5 + cam.xz;
          w.y += cam.y - 6.0;
          w.xz += (end) * vec2(slant, slant * 0.6) * 1.2; w.y += end * 0.9;
          float d = distance(w, cam);
          vA = smoothstep(W * 0.55, 3.0, d) * 0.55;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: 'uniform vec3 color; uniform float alpha; varying float vA; void main(){ gl_FragColor = vec4(color, vA * alpha); }',
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  set({ time, weather, cycle }) {
    if (time !== undefined) this.hour = typeof time === 'number' ? time : (TIMES[time] ?? 15);
    if (weather) { this.weather = weather; this.target = WEATHER[weather] || WEATHER.clear; }
    if (cycle !== undefined) this.cycle = !!cycle;
    this.snap = true;
  }

  update(dt, camera) {
    this.t += dt;
    if (this.cycle) this.hour = (this.hour + dt / 12) % 24; // a full day in about five minutes
    // ease the weather in over a few seconds
    const k = this.snap ? 1 : Math.min(1, dt * 0.5);
    this.snap = false;
    const T = this.target;
    for (const key in T) this.w[key] += (T[key] - this.w[key]) * k;
    // lightning
    this.flash = Math.max(0, this.flash - dt * 3.5);
    if (this.w.storm > 0.5 && !this.reduced) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + Math.random() * 9;
        this.flash = 1;
        const delay = 0.4 + Math.random() * 2;
        setTimeout(() => this.onThunder?.(), delay * 1000);
      }
    }
    this.apply(dt, camera);
  }

  apply(dt, camera) {
    const h = this.hour, w = this.w;
    const f = this.flash * this.flash;
    const grey = w.grey, dim = w.dim;
    const night = 1 - Math.min(1, lerpKey(h, 9, tmpA) / 2.2);
    this.night = night;
    const ov = tmpOv.setScalar(0.42 + 0.3 * (1 - night)); // overcast grey, darker at night
    const u = this.sky.material.uniforms;
    lerpKey(h, 1, u.top.value).lerp(ov, grey * 0.8).multiplyScalar(dim * (1 + f * 2.5));
    lerpKey(h, 2, u.mid.value).lerp(ov, grey * 0.8).multiplyScalar(dim * (1 + f * 2));
    lerpKey(h, 3, u.low.value).lerp(ov, grey * 0.8).multiplyScalar(dim * (1 + f));
    const fog = this.scene.fog;
    lerpKey(h, 4, fog.color).lerp(ov, grey * 0.7).multiplyScalar(dim * (1 + f));
    fog.near = w.near; fog.far = w.far;
    this.hemi.color.copy(lerpKey(h, 5, tmpB)).lerp(ov, grey * 0.6);
    lerpKey(h, 6, this.hemi.groundColor);
    this.hemi.intensity = lerpKey(h, 7, tmpA) * (0.6 + 0.4 * dim) + f * 2.2;
    this.sun.color.copy(lerpKey(h, 8, tmpB)).lerp(ov, grey * 0.5);
    this.sun.intensity = lerpKey(h, 9, tmpA) * (1 - grey * 0.75) * dim;
    u.night.value = night;
    u.dim.value = dim;
    this.rim.intensity = 0.6 * (0.4 + 0.6 * (1 - night));
    this.renderer.toneMappingExposure = lerpKey(h, 10, tmpA) * (1 + night * 0.1);
    // sun arcs across the sky; below the horizon the moon takes over from the same side
    const a = ((h - 6) / 12) * Math.PI, el = Math.sin(a);
    const elev = Math.max(0.28, Math.abs(el)); // keep shadows from going flat
    this.sunDir.set(Math.cos(a) * 60, 20 + elev * 50, 26);
    u.sunDir.value.copy(this.sunDir).normalize();
    // rain
    const r = this.rain;
    r.visible = w.rain > 0.02;
    if (r.visible && camera) {
      this.rainMat.uniforms.time.value = this.t * (this.reduced ? 0.35 : 1);
      this.rainMat.uniforms.cam.value.copy(camera.position);
      this.rainMat.uniforms.alpha.value = Math.min(1, w.rain) * (this.reduced ? 0.6 : 1);
      this.rainMat.uniforms.color.value.copy(fog.color).multiplyScalar(1.6).addScalar(0.15);
      this.rainMat.uniforms.slant.value = this.w.storm * 0.25 + 0.05;
    }
    this.sight = w.sight * (0.55 + 0.45 * (1 - night));
  }
}
