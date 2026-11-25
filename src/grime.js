import * as THREE from 'three';
import { registerEnv, envIrradiance } from './env.js';

// Wear for hard scenery. weather(material, kind) returns a copy of a standard material that adds,
// in object space so it sticks to the prop: rain streaks, soot and ground dirt on concrete and
// stone; rust blooms and worn paint on metal; scorching on wood. It also varies roughness, so
// fresh breaks are pale and rough while old surfaces are stained and dull, and metal picks up the
// sky. 'concrete' | 'stone' | 'metal' | 'wood'.
const NOISE = `
float gh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float gn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gh(i), gh(i + vec3(1,0,0)), f.x), mix(gh(i + vec3(0,1,0)), gh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(gh(i + vec3(0,0,1)), gh(i + vec3(1,0,1)), f.x), mix(gh(i + vec3(0,1,1)), gh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float gf(vec3 p){ return gn(p) * 0.55 + gn(p * 2.1 + 3.7) * 0.3 + gn(p * 4.3 + 9.1) * 0.15; }`;

const BODY = {
  concrete: `
    float st = gf(vec3(vLP.x * 5.0, vLP.y * 0.7, vLP.z * 5.0));           // long vertical rain streaks
    diffuseColor.rgb *= 0.72 + st * 0.4;
    float dirt = 1.0 - smoothstep(0.0, 0.5, vLP.y);                          // splashed up from the ground
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.17, 0.13), dirt * (0.35 + gf(vLP * 6.0) * 0.4));
    float crack = 1.0 - smoothstep(0.0, 0.025, abs(gf(vLP * 3.2) - 0.5));
    diffuseColor.rgb *= 1.0 - crack * 0.45;
    float soot = smoothstep(0.55, 0.8, gf(vLP * 2.4 + 4.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.065, 0.06), soot * 0.7);
    gRough = 0.86 + gf(vLP * 9.0) * 0.14 - soot * 0.1;`,
  stone: `
    float st = gf(vLP * 4.0);
    diffuseColor.rgb *= 0.78 + st * 0.38;
    float dirt = 1.0 - smoothstep(0.0, 0.35, vLP.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.2, 0.12), dirt * 0.4 * gf(vLP * 7.0));   // damp and mossy low down
    float soot = smoothstep(0.58, 0.82, gf(vLP * 2.0 + 8.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06), soot * 0.75);
    gRough = 0.9 + gf(vLP * 8.0) * 0.1;`,
  metal: `
    float rn = gf(vLP * 5.5) + (1.0 - smoothstep(0.0, 0.8, vLP.y)) * 0.18;
    float rust = smoothstep(0.5, 0.68, rn);
    float flake = gf(vLP * 22.0);
    vec3 rustCol = mix(vec3(0.33, 0.14, 0.05), vec3(0.5, 0.25, 0.1), flake);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + gf(vLP * 14.0) * 0.3), rustCol, rust * 0.92);
    gRough = mix(0.5, 0.88, rust) + flake * 0.08;
    gMetal = mix(1.0, 0.12, rust);`,
  wood: `
    float grain = gf(vec3(vLP.x * 2.0, vLP.y * 24.0, vLP.z * 2.0));
    diffuseColor.rgb *= 0.7 + grain * 0.5;
    float char_ = smoothstep(0.45, 0.7, gf(vLP * 3.0 + 2.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), char_ * 0.85);
    gRough = 0.8 + grain * 0.15;`,
};

const cache = new Map();
export function weather(base, kind) {
  const k = `${base.uuid}|${kind}`;
  if (cache.has(k)) return cache.get(k);
  const m = base.clone();
  m.name = `${base.name || 'mat'}-${kind}`;
  const metal = kind === 'metal';
  registerEnv(m, metal ? 0.9 : 0.35);
  m.customProgramCacheKey = () => `grime-${kind}`;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIrr = envIrradiance;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLP;\nuniform float uIrr;\nfloat gRough; float gMetal;${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n gRough = roughness; gMetal = 1.0;${BODY[kind]}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n metalnessFactor *= gMetal;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      #if defined( USE_ENVMAP ) && defined( STANDARD )
        iblIrradiance *= uIrr;
      #endif`);
  };
  cache.set(k, m);
  return m;
}

// ---- the uber material: every kind of hard scenery in ONE material, so a whole prop is one draw call.
// Geometry carries vertex colour (the paint or the stone) and aP = (kind, wear, extra):
//   kind 0 concrete, 1 stone/brick, 2 painted metal, 3 wood (extra = the axis the plank runs along, 0/1/2), 4 sacking, 5 plain (wear = roughness, extra = metalness)
// Wear (0..1) says how beaten up the piece is. The wear is worked out in object space (so it sticks to the
// prop), offset by where the instance stands so two of the same prop never carry the same stains.
export const UBER_KIND = { concrete: 0, stone: 1, metal: 2, wood: 3, cloth: 4, plain: 5 };
const UBER_BODY = `
  float kd = vP.x, wr = vP.y;
  vec3 q = vLP + vSd;
  float up = smoothstep(0.25, 0.95, vON.y);                      // tops catch dust, moss and rain
  float low = 1.0 - smoothstep(0.0, 0.55, vLP.y);                // splashed up from the ground
  float rough = 0.9, metal = 0.0;
  float gr = gh(q * 57.0);                                        // fine grain
  if (kd < 0.5) {                                                 // concrete
    float st = gf(vec3(q.x * 6.0, q.y * 0.6, q.z * 6.0));
    diffuseColor.rgb *= 0.8 + gf(q * 2.6) * 0.34;
    diffuseColor.rgb *= 1.0 - smoothstep(0.35, 0.8, st) * (0.12 + wr * 0.28);   // rain streaks
    diffuseColor.rgb *= 0.94 + gr * 0.1;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.16, 0.12), low * (0.2 + gf(q * 6.0) * 0.45) * (0.4 + wr * 0.6));
    float crack = 1.0 - smoothstep(0.0, 0.02, abs(gf(q * 3.4) - 0.5));
    diffuseColor.rgb *= 1.0 - crack * (0.15 + wr * 0.4);
    float soot = smoothstep(0.58, 0.82, gf(q * 2.2 + 4.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.065, 0.06), soot * wr * 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.31, 0.26), up * 0.18);
    rough = 0.88 + gr * 0.12;
  } else if (kd < 1.5) {                                          // stone and brick
    diffuseColor.rgb *= 0.78 + gf(q * 4.0) * 0.36;
    diffuseColor.rgb *= 0.93 + gr * 0.12;
    float soot = smoothstep(0.55, 0.8, gf(q * 2.0 + 8.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055), soot * wr * 0.8);
    float moss = max(low * 0.7, up * 0.5) * smoothstep(0.35, 0.7, gf(q * 7.0)) * (0.3 + wr * 0.7);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.25, 0.1), moss);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.19, 0.12), low * 0.3 * gf(q * 9.0));
    rough = 0.9 + gr * 0.1;
  } else if (kd < 2.5) {                                          // painted steel
    float rn = gf(q * 3.4) + low * 0.2 + (1.0 - up) * 0.04;
    float rust = smoothstep(0.74 - wr * 0.08, 0.9 - wr * 0.06, rn) * (0.45 + wr * 0.55);
    float chip = smoothstep(0.66, 0.78, gf(q * 19.0 + 2.0)) * wr * 0.8;
    vec3 rustCol = mix(vec3(0.12, 0.05, 0.022), vec3(0.22, 0.095, 0.04), gf(q * 22.0));
    diffuseColor.rgb *= 0.88 + gf(q * 11.0) * 0.2;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.09, 0.085), chip * 0.8);       // paint chipped to bare steel
    diffuseColor.rgb = mix(diffuseColor.rgb, rustCol, rust * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04), smoothstep(0.72, 0.9, gf(q * 2.6 + 6.0)) * wr * 0.35);
    rough = mix(0.55, 0.92, max(rust, chip * 0.5)) + gr * 0.06;
    metal = mix(0.35, 0.05, rust) + chip * 0.4;
  } else if (kd < 3.5) {                                          // timber
    vec3 gs = vec3(26.0); int ax = int(vP.z + 0.5); gs[ax] = 2.0;   // the grain runs along the plank, so the noise changes slowly that way
    float grain = gf(q * gs);
    diffuseColor.rgb *= 0.72 + grain * 0.46;
    float weathered = smoothstep(0.3, 0.8, gf(q * 1.7 + 5.0)) * wr;                         // sun-bleached grey
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.31, 0.27), weathered * 0.5);
    float chr = smoothstep(0.5, 0.72, gf(q * 3.0 + 2.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), chr * wr * wr * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.17, 0.1), low * 0.25);
    rough = 0.78 + grain * 0.15;
  } else if (kd < 4.5) {                                          // sacking
    diffuseColor.rgb *= 0.86 + gf(q * 13.0) * 0.22;
    diffuseColor.rgb *= 0.95 + gr * 0.08;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.13, 0.08), low * (0.3 + gf(q * 8.0) * 0.5) * (0.4 + wr * 0.5));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.1, 1.0), up * 0.5);
    rough = 0.97;
  } else {                                                        // plain: roughness and metalness come with the geometry
    diffuseColor.rgb *= 0.95 + gr * 0.1;
    rough = vP.y; metal = vP.z;
  }`;
let uberMat = null;
export function uberMaterial() {
  if (uberMat) return uberMat;
  const m = uberMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, vertexColors: true });
  m.name = 'prop-uber';
  registerEnv(m, 0.7);
  m.customProgramCacheKey = () => 'grime-uber';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIrr = envIrradiance;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aP; varying vec3 vP; varying vec3 vLP; varying vec3 vON; varying vec3 vSd;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vP = aP; vLP = position; vON = normal;
        #ifdef USE_INSTANCING
          vSd = vec3(fract(instanceMatrix[3].x * 0.1731) * 41.0, 0.0, fract(instanceMatrix[3].z * 0.2193) * 37.0);
        #else
          vSd = vec3(0.0);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vP; varying vec3 vLP; varying vec3 vON; varying vec3 vSd;\nuniform float uIrr;${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${UBER_BODY}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = rough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = metal;')
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      #if defined( USE_ENVMAP ) && defined( STANDARD )
        iblIrradiance *= uIrr;
      #endif`);
  };
  return m;
}
