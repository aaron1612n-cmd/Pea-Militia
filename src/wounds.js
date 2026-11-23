import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { canvasTex } from './effects.js';
import { U } from './rig.js';

// Wounds that sit ON the soldier's shell. A wound decal is a small grid whose vertices are pushed
// onto the rounded body block in the vertex shader, so it wraps edges and corners instead of
// floating off as a flat slab. Wounds that dent the shell also pinch the body mesh itself: wounded
// soldiers draw with a finer copy of the body (DENT_CAP at a time) that takes up to 4 dents.
export const DENT_CAP = 48;
export const MAX_DENTS = 4;
const HALF = [U.W / 2 - U.R, U.H / 2 - U.R, U.D / 2 - U.R];
const TAU = Math.PI * 2;

// atlas tiles (2 x 2): 0 splash, 1 bullet hole, 2 bleeding run, 3 ragged exit wound
function atlas() {
  return canvasTex(256, (g, S) => {
    const T = S / 2, rnd = Math.random;
    const blob = (cx, cy, r, jag, fill) => {
      g.fillStyle = fill; g.beginPath();
      const n = 22;
      for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, k = r * (1 - jag + rnd() * jag * 2); g.lineTo(cx + Math.cos(a) * k, cy + Math.sin(a) * k); }
      g.closePath(); g.fill();
    };
    const drops = (cx, cy, n, d0, d1, r0, r1, fill) => { g.fillStyle = fill; for (let i = 0; i < n; i++) { const a = rnd() * TAU, d = d0 + rnd() * (d1 - d0), r = r0 + rnd() * (r1 - r0); g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, TAU); g.fill(); } };
    const spokes = (cx, cy, n, r0, r1, w, fill) => { g.strokeStyle = fill; g.lineCap = 'round'; for (let i = 0; i < n; i++) { const a = rnd() * TAU, l = r0 + rnd() * (r1 - r0); g.lineWidth = w * (0.5 + rnd()); g.beginPath(); g.moveTo(cx + Math.cos(a) * r0 * 0.5, cy + Math.sin(a) * r0 * 0.5); g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.stroke(); } };
    // 0: splash, glossy dark red with spokes and satellite drops
    let cx = T / 2, cy = T / 2;
    blob(cx, cy, T * 0.26, 0.35, '#7d1010'); spokes(cx, cy, 11, T * 0.3, T * 0.46, 3.5, '#6a0c0c'); drops(cx, cy, 13, T * 0.3, T * 0.46, 1.5, 4.5, '#7a1010');
    blob(cx, cy, T * 0.14, 0.3, '#4a0707');
    // 1: bullet hole, black pit, torn rim, wet halo
    cx = T + T / 2; cy = T / 2;
    blob(cx, cy, T * 0.33, 0.25, '#6b0e0e'); spokes(cx, cy, 8, T * 0.24, T * 0.4, 2.5, '#6b0e0e'); blob(cx, cy, T * 0.2, 0.2, '#2c0505'); blob(cx, cy, T * 0.12, 0.18, '#050101');
    // 2: bleeding run: a narrow wet streak that swells toward the tip
    cx = T / 2; cy = T + T / 2;
    g.fillStyle = '#7a1010'; g.beginPath(); g.moveTo(cx - 5, T + 2); g.lineTo(cx + 5, T + 2); g.bezierCurveTo(cx + 6, T + T * 0.7, cx + 11, T + T * 0.82, cx + 9, T + T * 0.92);
    g.bezierCurveTo(cx + 5, T + T * 0.99, cx - 5, T + T * 0.99, cx - 9, T + T * 0.92); g.bezierCurveTo(cx - 11, T + T * 0.82, cx - 6, T + T * 0.7, cx - 5, T + 2); g.fill();
    g.fillStyle = 'rgba(255,170,160,0.22)'; g.fillRect(cx - 2, T + 6, 2, T * 0.7);
    // 3: exit wound: bigger ragged crater with torn petals, flung drops and a dark core
    cx = T + T / 2; cy = T + T / 2;
    blob(cx, cy, T * 0.34, 0.4, '#6e0f0f'); spokes(cx, cy, 14, T * 0.3, T * 0.48, 4.5, '#6e0f0f'); drops(cx, cy, 16, T * 0.3, T * 0.48, 1.5, 4.5, '#7a1010');
    blob(cx, cy, T * 0.22, 0.35, '#3a0606'); blob(cx, cy, T * 0.13, 0.3, '#080101');
  });
}

const GLSL_DENT = /* glsl */`
float dentT(vec3 p, vec4 d) { return length(p - d.xyz) / (0.06 + abs(d.w) * 1.2); }
// signed shell displacement along the normal: a pit, with a raised lip (taller on exit wounds)
float dentDisp(vec3 p, vec4 d) {
  float t = dentT(p, d);
  if (t >= 1.0 || d.w == 0.0) return 0.0;
  float a = abs(d.w), pit = -a * (1.0 - t * t) * (1.0 - t * t);
  float lip = a * (d.w < 0.0 ? 0.55 : 0.3) * exp(-pow((t - 0.8) * 5.0, 2.0));
  return pit + lip;
}
`;

let _atlas = null;
function wmat() {
  _atlas = _atlas || atlas();
  const m = new THREE.MeshStandardMaterial({ map: _atlas, alphaTest: 0.35, roughness: 0.22, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aC; attribute vec4 aS; attribute vec3 aN;
varying float vShade; varying vec2 vWUv;
const vec3 HALF = vec3(${HALF.map((v) => v.toFixed(4)).join(',')});
${GLSL_DENT}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vec3 wq = aC.xyz + vec3(abs(aN.z), 0.0, abs(aN.x)) * position.x * aS.x + vec3(0.0, 1.0, 0.0) * position.y * aS.y;
vec3 wc = clamp(wq, -HALF, HALF);
vec3 wd = wq - wc;
float wl = length(wd);
vec3 wn = wl > 1e-4 ? wd / wl : aN;
objectNormal = wn;
vShade = aS.z;`)
      .replace('#include <begin_vertex>', `vec3 wp = wc + wn * ${U.R.toFixed(4)};
vec4 wdent = vec4(aC.xyz, aS.w);
wp += wn * (dentDisp(wp, wdent) + 0.006);
vec3 transformed = wp;
vWUv = (vec2(mod(aC.w, 2.0), floor(aC.w / 2.0)) + uv) * 0.5;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShade; varying vec2 vWUv;')
      .replace('#include <map_fragment>', `diffuseColor *= texture2D(map, vWUv); diffuseColor.rgb *= vShade;`);
  };
  return m;
}

// the instanced decal mesh; add() order = draw order
export function makeWoundMesh(n) {
  const geo = new THREE.PlaneGeometry(1, 1, 6, 8);
  const m = new THREE.InstancedMesh(geo, wmat(), n);
  geo.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  geo.setAttribute('aS', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  geo.setAttribute('aN', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.count = 0;
  m.name = 'crowd-wounds';
  return m;
}

// fine copy of the body that takes dents
export function makeDentBody(n, material) {
  const geo = new RoundedBoxGeometry(U.W, U.H, U.D, 9, U.R);
  for (let k = 0; k < MAX_DENTS; k++) geo.setAttribute(`aD${k}`, new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  const mat = material.clone();
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aD0; attribute vec4 aD1; attribute vec4 aD2; attribute vec4 aD3;
varying float vPit;
${GLSL_DENT}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vec3 dpos = position; float dsum = 0.0; vec3 dgrad = vec3(0.0);
vec4 dd[4]; dd[0] = aD0; dd[1] = aD1; dd[2] = aD2; dd[3] = aD3;
for (int i = 0; i < 4; i++) {
  float t = dentT(dpos, dd[i]);
  if (t < 1.0 && dd[i].w != 0.0) {
    dsum += dentDisp(dpos, dd[i]);
    vec3 rad = dpos - dd[i].xyz; rad -= objectNormal * dot(rad, objectNormal);
    float a = abs(dd[i].w), r = 0.06 + a * 1.2;
    dgrad += normalize(rad + 1e-5) * (4.0 * a * t * (1.0 - t * t) / r) * 0.9;
  }
}
objectNormal = normalize(objectNormal - dgrad);
vPit = clamp(-dsum / 0.05, 0.0, 1.0);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed += normal * dsum;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPit;')
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.02, 0.02), vPit * 0.85);`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.count = 0;
  mesh.name = 'crowd-body-dented';
  return mesh;
}

// nearest point on the body shell to a body-local point (so wound centres sit on the surface)
export function onShell(x, y, z, out = {}) {
  const cx = Math.max(-HALF[0], Math.min(HALF[0], x)), cy = Math.max(-HALF[1], Math.min(HALF[1], y)), cz = Math.max(-HALF[2], Math.min(HALF[2], z));
  let dx = x - cx, dy = y - cy, dz = z - cz;
  const l = Math.hypot(dx, dy, dz) || 1;
  out.x = cx + dx / l * U.R; out.y = cy + dy / l * U.R; out.z = cz + dz / l * U.R;
  return out;
}
export { HALF };
