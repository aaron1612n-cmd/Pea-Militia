import * as THREE from 'three';
import './style.css';
import { createPea, PEA_COLLIDER, BODY_Y, PEA_SCALE } from './pea.js';
import { createBaseplate, createSky, PLATE_COLLIDER } from './world.js';
import { OrbitCam } from './controls.js';

const canvas = document.getElementById('scene');
const hint = document.getElementById('hint');
let hinted = false;
const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.dataset.input = touch ? 'touch' : 'mouse';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).has('test') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#c9cbc8', 26, 80);
scene.add(createSky());

const plate = createBaseplate();
scene.add(plate);

const pea = createPea();
scene.add(pea);

// Flat overcast light: neutral sky fill, one cool key, no warm glow.
scene.add(new THREE.HemisphereLight('#e4e7e8', '#6d6e68', 1.3));
const sun = new THREE.DirectionalLight('#f2f3f0', 2.3);
sun.position.set(4, 7, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 20 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const rim = new THREE.DirectionalLight('#d8dde0', 0.5);
rim.position.set(-5, 3, -6);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
const controls = new OrbitCam(camera, canvas, {
  colliders: { capsules: [PEA_COLLIDER], groundY: PLATE_COLLIDER.max.y },
  focus: { center: new THREE.Vector3(0, (BODY_Y - 0.06) * PEA_SCALE, 0), radius: 0.8 * PEA_SCALE },
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!hinted) controls.fit(false); // keep the player's view once they've moved it
}
addEventListener('resize', resize);
resize();
controls.fit(true);

// The one motion moment: camera drops in from above and settles on the pea.
if (!reduced) {
  controls.cur.pitch = 1.2;
  controls.cur.dist = controls.goal.dist * 2.6;
  controls.cur.yaw = controls.goal.yaw - 1.1;
}

// UI
controls.onInteract = () => {
  if (hinted) return;
  hinted = true;
  hint.classList.add('gone');
};
setTimeout(() => controls.onInteract(), 9000);
document.getElementById('recenter').addEventListener('click', () => controls.fit());

// Loop
const clock = new THREE.Clock();
let paused = false;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) pea.userData.setPhase(clock.elapsedTime);
  controls.update(dt);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

// Test hooks for the check suite.
window.__pea = {
  THREE, scene, camera, renderer, controls, pea, plate,
  colliders: { pea: PEA_COLLIDER, plate: PLATE_COLLIDER },
  pause(t) { paused = true; pea.userData.setPhase(t, true); },
  resume() { paused = false; },
  render() { renderer.render(scene, camera); },
};
