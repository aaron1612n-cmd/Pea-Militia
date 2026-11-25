import * as THREE from 'three';

// Surface detail for the soldiers and the strider, added to a standard material in the shader so
// it costs no textures and no extra draw calls. Everything is computed from the part's own
// (object-space) position, so it rides the part as it moves:
//   - weave and fold bump: fine cloth grain plus soft creases, perturbing the normal
//   - camouflage: a per-class pattern (woodland, tiger stripe, digital, desert, panel lines, clean)
//     as tonal blotches on the army's colour, offset by a per-soldier seed
//   - dirt: mud and dust gathering toward the boots, knees, belly and cuffs, broken up by noise
//   - wear: chipped paint and scratches that show bare metal (armour and the strider's plating)
//   - sway (worn kit only): vertices tagged with a group and pivot swing about it by per-instance angles
// Soldiers further away than the LOD distance get a negative style and skip all of it.
const NOISE = /* glsl */ `
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm2(vec3 p) { return vnoise(p) * 0.65 + vnoise(p * 2.13 + 7.1) * 0.35; }
`;

export const STYLE_CAP = 6; // classes: rifleman, assault, gunner, mortar, coil, medic

let _id = 0;
// opts: { style: per-instance style attribute (iStyle), camo, dirt: [base, along z, below y=0], wear, bump, sway }
export function detail(mat, opts = {}) {
  const o = { style: true, camo: false, dirt: [0, 0, 0], wear: 0, bump: 0.5, sway: false, grain: 1, scale: 1, ...opts };
  const key = `fabric${++_id}`;
  mat.customProgramCacheKey = () => key;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uDirt = { value: new THREE.Vector3(...o.dirt) };
    shader.uniforms.uBump = { value: o.bump };
    shader.uniforms.uWear = { value: o.wear };
    shader.uniforms.uScale = { value: o.scale };
    const styled = o.style;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
${styled ? 'attribute float iStyle; varying float vStyle;' : ''}
varying vec3 vOP;
${o.sway ? 'attribute vec4 aSw; attribute vec4 iSwA; attribute vec4 iSwB; attribute vec2 iSwC;' : ''}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
${o.sway ? `
float swG = aSw.w; mat3 swR = mat3(1.0);
if (swG > 0.5) {
  vec2 sa = swG < 1.5 ? iSwA.xy : swG < 2.5 ? iSwA.zw : swG < 3.5 ? iSwB.xy : swG < 4.5 ? iSwB.zw : iSwC;
  float cx = cos(sa.x), sx = sin(sa.x), cz = cos(sa.y), sz = sin(sa.y);
  swR = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0) * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  objectNormal = swR * objectNormal;
}` : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vOP = position;
${styled ? 'vStyle = iStyle;' : ''}
${o.sway ? 'if (swG > 0.5) transformed = aSw.xyz + swR * (position - aSw.xyz);' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vOP;
${styled ? 'varying float vStyle;' : ''}
uniform vec3 uDirt; uniform float uBump; uniform float uWear; uniform float uScale;
${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${styled ? 'if (vStyle >= 0.0) {' : '{'}
  vec3 p = vOP * uScale;
  float foot = length(fwidth(p));
  float sd = ${styled ? 'fract(vStyle) * 41.0 + 3.0' : '3.0'};
  float cls = ${styled ? 'floor(vStyle + 0.01)' : '0.0'};
  // cloth grain: a fine speckle that fades out when it gets smaller than a pixel
  float gf = 1.0 - smoothstep(0.0015, 0.006, foot);
  ${o.grain ? 'if (gf > 0.004) diffuseColor.rgb *= 1.0 + (fbm2(p * 260.0 + sd) - 0.5) * 0.22 * gf;' : ''}
  ${o.camo ? `
  float pf = 1.0 - smoothstep(0.012, 0.05, foot);
  if (pf < 0.004) { /* too small to see: the pattern would only add shimmer, so skip its noise */ }
  else if (cls < 0.5) {
    float a = smoothstep(0.44, 0.52, fbm2(p * 24.0 + sd)), b = smoothstep(0.58, 0.66, fbm2(p * 17.0 + sd + 11.0));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.6, 0.72, 0.52), a * 0.9 * pf) * mix(vec3(1.0), vec3(1.22, 1.1, 0.84), b * 0.75 * pf);
  } else if (cls < 1.5) {
    float n = fbm2(vec3(p.x * 12.0, p.y * 38.0, p.z * 12.0) + sd);
    float st = smoothstep(0.4, 0.45, n) * (1.0 - smoothstep(0.52, 0.57, n));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.52, 0.58, 0.5), st * pf) * mix(vec3(1.0), vec3(1.16, 1.08, 0.88), smoothstep(0.62, 0.7, fbm2(p * 13.0 + sd)) * pf);
  } else if (cls < 2.5) {
    float h = h31(floor(p * 70.0) + sd), h2 = h31(floor(p * 34.0) + sd + 5.0), t = 0.55 * h + 0.45 * h2;
    vec3 tone = t < 0.36 ? vec3(0.58, 0.64, 0.58) : t > 0.72 ? vec3(1.2, 1.14, 0.98) : vec3(1.0);
    diffuseColor.rgb *= mix(vec3(1.0), tone, pf);
  } else if (cls < 3.5) {
    float a = fbm2(p * 9.0 + sd), b = fbm2(p * 31.0 + sd + 4.0);
    diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(1.2, 1.12, 0.9), vec3(0.8, 0.74, 0.62), smoothstep(0.4, 0.6, a)), 0.7 * pf) * (1.0 + (b - 0.5) * 0.18 * pf);
  } else if (cls < 4.5) {
    vec3 g = abs(fract(p * 26.0) - 0.5);
    float line = smoothstep(0.455, 0.5, max(g.x, max(g.y, g.z)));
    diffuseColor.rgb *= 1.0 - 0.38 * line * pf;
    diffuseColor.rgb *= 0.9 + 0.2 * smoothstep(0.45, 0.6, fbm2(p * 10.0 + sd));
  } else {
    diffuseColor.rgb *= 0.94 + 0.12 * smoothstep(0.4, 0.62, fbm2(p * 12.0 + sd)) * pf;
  }` : ''}
  // dirt: heaviest toward the cuffs, knees and belly, broken up by noise
  float df = 1.0 - smoothstep(0.02, 0.1, foot);
  float dd = uDirt.x + uDirt.y * smoothstep(-0.04, 0.1, p.z) + uDirt.z * smoothstep(0.08, -0.2, p.y);
  float dn = fbm2(p * 44.0 + sd * 1.7) * 0.7 + fbm2(p * 9.0 + sd) * 0.3;
  float mud = clamp((dd + (dn - 0.5) * 1.1) * 1.5, 0.0, 1.0) * (0.45 + 0.55 * df);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.41, 0.3) + vec3(0.012), mud * 0.8);
  // wear: chipped paint and scratches, lightening toward bare metal
  if (uWear > 0.0) {
    float wf = 1.0 - smoothstep(0.01, 0.06, foot);
    float chip = smoothstep(0.7, 0.8, fbm2(p * 58.0 + sd)) * wf;
    float scr = smoothstep(0.93, 0.98, vnoise(vec3(p.x * 90.0, p.y * 6.0, p.z * 90.0) + sd)) * wf;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.54, 0.5) * (0.6 + 0.4 * h31(floor(p * 40.0))), clamp(chip + scr, 0.0, 1.0) * uWear);
  }
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${styled ? 'if (vStyle >= 0.0)' : ''} {
  vec3 bp = vOP * uScale;
  float fw = length(fwidth(bp));
  float f1 = 1.0 - smoothstep(0.0012, 0.005, fw), f2 = 1.0 - smoothstep(0.01, 0.04, fw);
  float bh = 0.0;
  if (f1 > 0.004) bh += fbm2(bp * 190.0 + ${styled ? 'vStyle' : '0.0'}) * 0.55 * f1;
  if (f2 > 0.004) bh += (fbm2(bp * vec3(34.0, 34.0, 12.0) + ${styled ? 'vStyle' : '0.0'}) - 0.5) * 1.6 * f2;
  vec3 sx = normalize(dFdx(-vViewPosition)), sy = normalize(dFdy(-vViewPosition));
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  vec3 grad = sign(det) * (dFdx(bh) * r1 + dFdy(bh) * r2);
  normal = normalize(abs(det) * normal - uBump * grad);
}`);
  };
  mat.needsUpdate = true;
  return mat;
}

// per-instance float attribute, one per mesh (geometry is cloned per mesh by the crowd)
export const instAttr = (n, size = 1) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
