import * as THREE from 'three';

// Image-based reflections for the ground and the props: the sky dome is baked into a small
// environment map now and then (when the hour or the weather has moved on), so puddles mirror the
// sky and steel catches its colour. Only materials that opt in get it (registerEnv), so the
// soldiers' look is untouched.
const mats = new Set();
let pm = null, rt = null, scene = null, key = '', last = -99;
export const envIrradiance = { value: 0.14 }; // shared: how much sky fill the env adds to diffuse light

export function registerEnv(m, intensity = 1) {
  m.envMapIntensity = intensity;
  mats.add(m);
  if (rt) { m.envMap = rt.texture; m.needsUpdate = true; }
}

export function initEnv(renderer, sky) {
  pm = new THREE.PMREMGenerator(renderer);
  scene = new THREE.Scene();
  const dome = new THREE.Mesh(sky.geometry, sky.material); // shares the sky's shader and uniforms
  dome.frustumCulled = false;
  scene.add(dome);
}

// Re-bake when the sky has changed enough; never more than every few seconds.
export function updateEnv(now, hour, weather, force = false) {
  if (!pm) return;
  const k = `${Math.round(hour * 3)}|${weather}`;
  if (!force && (k === key || now - last < 4)) return;
  key = k; last = now;
  const next = pm.fromScene(scene, 0, 1, 1200, { size: 128 });
  const first = !rt;
  rt?.dispose();
  rt = next;
  for (const m of mats) { m.envMap = rt.texture; if (first) m.needsUpdate = true; }
}
