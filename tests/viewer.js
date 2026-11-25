// Standalone soldier viewer for close-up renders: one soldier of any class, any angle and pose.
// Served by vite (npm run dev -> /tests/viewer.html). shots.mjs drives window.shot().
import * as THREE from 'three';
import { Crowd } from '../src/crowd.js';
import { pose, makePose, U } from '../src/rig.js';
import { CLASSES } from '../src/classes.js';
import { Sway } from '../src/secondary.js';

const W = 900, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#5d6670');
scene.add(new THREE.HemisphereLight('#dfe8f2', '#4a4538', 1.1));
const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
sun.position.set(2.2, 3.2, 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 10 });
scene.add(sun);
const fill = new THREE.DirectionalLight('#9fb4d0', 0.8); fill.position.set(-2, 1.5, -2); scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.MeshStandardMaterial({ color: '#6c6a58', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const crowd = new Crowd(scene, 8);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
const WEAPON = { rifleman: 'rifle', assault: 'smg', gunner: 'mg', mortar: 'launcher', coil: 'plasma', medic: 'smg' };
const ANG = { front: 0, q3: Math.PI / 4, side: Math.PI / 2, back: Math.PI, q3b: -3 * Math.PI / 4, left: -Math.PI / 2 };
// zoom targets: [centre y, camera distance]
const ZOOM = { full: [0.62, 3.4], upper: [0.82, 1.6], head: [0.99, 0.75], legs: [0.3, 1.5], boots: [0.08, 0.8], torso: [0.72, 1.1] };

window.shot = ({ kind = 'rifleman', team = 0, view = 'front', mode = 'idle', zoom = 'full', phase = 0.1 } = {}) => {
  const s = { t: 1.3, walk: 0, cycle: 0, speed: 0, ready: 1, weapon: WEAPON[kind], mx: 0, mz: 1, stride: 0.5 };
  if (mode === 'run') Object.assign(s, { walk: 1, speed: 4.2, cycle: phase, sprint: false, free: 0 });
  if (mode === 'walk') Object.assign(s, { walk: 1, speed: 1.4, cycle: phase });
  if (mode === 'kneel') Object.assign(s, { kneel: 1 });
  if (mode === 'low') Object.assign(s, { ready: 0 });
  if (mode === 'prone') Object.assign(s, { prone: 1 });
  if (mode === 'dead') Object.assign(s, { dead: 1 });
  if (mode === 'sprint') Object.assign(s, { walk: 1, speed: 6, cycle: phase, free: 1 });
  if (mode === 'reload') Object.assign(s, { reload: 0.5 });
  if (mode === 'fire') Object.assign(s, { recoil: 0.6 });
  const p = pose(s, makePose());
  // loose kit: run a few seconds of the soldier's motion through the springs so the shot catches it mid-swing
  if (s.walk > 0) { const sw = new Sway(); for (let i = 0; i < 90; i++) sw.update(1 / 60, 0, s.speed, 0, (phase + i * s.speed * 0.4 / 60 / (0.45 + 0.32 * s.speed)) % 1, 1, 0, p.sway); }
  const world = new THREE.Matrix4();
  crowd.begin();
  crowd.add(world, p, team, { weapon: WEAPON[kind], seed: 2, kind });
  crowd.end();
  const [cy, d] = ZOOM[zoom] || ZOOM.full;
  const a = ANG[view] ?? 0;
  camera.position.set(Math.sin(a) * d, cy + (zoom === 'full' ? 0.18 : 0.06), Math.cos(a) * d);
  camera.lookAt(0, cy, 0);
  renderer.render(scene, camera);
  return true;
};
window.ready = true;
