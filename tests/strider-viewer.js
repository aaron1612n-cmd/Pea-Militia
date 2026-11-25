// Standalone strider viewer: the walker at any angle, standing or mid-stride. shots are driven by window.shot().
import * as THREE from 'three';
import { Vehicle } from '../src/vehicles.js';
import { propModel, PROPS } from '../src/props.js';
import { VARIANTS } from '../src/propbuild.js';
import { buildScene, SCENE_VARIANTS } from '../src/scenebuild.js';
import { instance } from '../src/models.js';

const W = 1000, H = 800;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#5d6670');
scene.add(new THREE.HemisphereLight('#dfe8f2', '#4a4538', 1.1));
const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
sun.position.set(8, 14, 9); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
scene.add(sun);
const fill = new THREE.DirectionalLight('#9fb4d0', 0.8); fill.position.set(-8, 5, -8); scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(16, 40), new THREE.MeshStandardMaterial({ color: '#6c6a58', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
const ANG = { front: 0, q3: Math.PI / 4, side: Math.PI / 2, back: Math.PI, q3b: -3 * Math.PI / 4, left: -Math.PI / 2, top: 0 };

let v = null;
window.make = (team = 0) => {
  if (v) scene.remove(v.group);
  v = new Vehicle('walker', team, 0, 0, 0);
  scene.add(v.group);
  window.v = v;
  return true;
};
// walk the strider forward for `secs` seconds at `speed`
window.walk = (secs, speed = 4, dt = 1 / 60) => {
  v.speed = speed;
  for (let t = 0; t < secs; t += dt) {
    v.t += dt;
    v.pos.x += Math.sin(v.yaw) * speed * dt; v.pos.z += Math.cos(v.yaw) * speed * dt;
    v.syncModel(dt);
  }
  return true;
};
window.pose = ({ tYaw = 0, tPitch = 0, alive = true } = {}) => {
  v.tYaw = tYaw; v.tPitch = tPitch;
  if (!alive && v.alive) { v.alive = false; v.deadT = 5; v.wreckTurret = { yaw: 0.3, lift: 0.25 }; }
  v.syncModel(0.016);
  return true;
};
window.shot = ({ view = 'q3', zoom = 'full', target = null, dist = null } = {}) => {
  const [cx, cy, cz, d] = target ? [...target, dist] : (zoom === 'full' ? [0, 2.7, 0, 17] : zoom === 'body' ? [0, 4.2, 0, 8.5] : zoom === 'leg' ? [1.2, 2, 0, 8] : [0, 2.7, 0, 17]);
  const a = ANG[view] ?? 0;
  const px = v.pos.x, pz = v.pos.z;
  const off = view === 'top' ? [0, d, 0.01] : [Math.sin(a + v.yaw) * d, d * 0.12 + 0.3, Math.cos(a + v.yaw) * d];
  camera.position.set(px + cx + off[0], cy + off[1], pz + cz + off[2]);
  camera.lookAt(px + cx, cy, pz + cz);
  sun.target.position.set(px, 0, pz); sun.position.set(px + 8, 14, pz + 9); sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
  return true;
};
// a prop on its own, any angle (view: front, q3, side, back, top)
let prop = null;
window.showProp = (type, view = 'q3', variant = 0, lite = false) => {
  if (v) { scene.remove(v.group); v = null; }
  if (prop) scene.remove(prop);
  prop = type.startsWith('scene.') ? instance(buildScene(type.slice(6), variant).bake(), type) : propModel(type, variant, lite); scene.add(prop);
  const box = new THREE.Box3().setFromObject(prop), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length();
  const a = ANG[view] ?? 0.8, d = r * 1.3;
  camera.position.set(c.x + Math.sin(a) * d, c.y + d * 0.35, c.z + Math.cos(a) * d);
  camera.lookAt(c);
  renderer.render(scene, camera);
  return true;
};
window.variantCount = (t) => (t.startsWith('scene.') ? SCENE_VARIANTS[t.slice(6)] : VARIANTS[t]) || 1;
window.ready = true;
