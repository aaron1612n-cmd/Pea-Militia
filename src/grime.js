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
