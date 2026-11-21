import * as THREE from 'three';
import './style.css';
import { createPea, PEA_COLLIDER } from './pea.js';
import { createBaseplate, createSky, PLATE_COLLIDER } from './world.js';
import { Input } from './input.js';
import { Player, FollowCam } from './player.js';

const canvas = document.getElementById('scene');
const params = new URLSearchParams(location.search);
const testing = params.has('test');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: testing });
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

// Flat overcast light: neutral sky fill, one cool key that follows the pea for crisp shadows.
scene.add(new THREE.HemisphereLight('#e4e7e8', '#6d6e68', 1.3));
const SUN = new THREE.Vector3(4, 7, 5);
const sun = new THREE.DirectionalLight('#f2f3f0', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 30 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight('#d8dde0', 0.5);
rim.position.set(-5, 3, -6);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
const cam = new FollowCam(camera);
const player = new Player(pea, { drop: !reduced && !testing });
const input = new Input(canvas, {
  stick: document.getElementById('stick'),
  knob: document.getElementById('knob'),
  jumpBtn: document.getElementById('jump'),
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // tall screens: step back a little so the pea isn't cramped side to side
  cam.dist = THREE.MathUtils.clamp(w / h < 0.8 ? 3.3 : 2.7, cam.limits.minDist, cam.limits.maxDist);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---- short tutorial: one prompt at a time, learned by doing; "?" or H replays it ----
const prompt = document.getElementById('prompt');
const help = document.getElementById('help');
const STEPS = {
  mouse: [['lock', 'Click to play'], ['move', 'WASD to move'], ['look', 'Mouse to look'], ['jump', 'Space to jump']],
  touch: [['move', 'Left thumb to move'], ['look', 'Right thumb to look'], ['jump', 'Tap ↑ to jump']],
};
const tut = { i: 0, done: false, moved: 0, looked: 0, jumps: 0 };
function steps() { return STEPS[input.touch ? 'touch' : 'mouse'].filter(([k]) => !(k === 'lock' && input.locked)); }
function startTutorial() {
  Object.assign(tut, { i: 0, done: false, moved: player.distance, looked: 0, jumps: player.jumps });
  showStep();
}
function showStep() {
  const s = steps();
  if (tut.i >= s.length) {
    tut.done = true;
    prompt.textContent = '';
    prompt.classList.remove('on');
    if (!input.touch && !input.locked) { prompt.textContent = 'Click to play'; prompt.classList.add('on'); }
    return;
  }
  prompt.textContent = s[tut.i][1];
  prompt.classList.add('on');
}
function tutorialTick() {
  if (tut.done) return;
  const s = steps();
  const k = s[tut.i]?.[0];
  const passed = (k === 'lock' && input.locked)
    || (k === 'move' && player.distance - tut.moved > 1.2)
    || (k === 'look' && tut.looked > 0.9)
    || (k === 'jump' && player.jumps > tut.jumps);
  if (passed) {
    tut.i++;
    tut.moved = player.distance; tut.looked = 0; tut.jumps = player.jumps;
    showStep();
  }
}
input.onChange = () => {
  document.documentElement.dataset.locked = input.locked ? 'yes' : 'no';
  if (tut.done) showStep();
  else { tut.i = Math.min(tut.i, steps().length); showStep(); }
};
help.addEventListener('pointerdown', (e) => e.stopPropagation());
help.addEventListener('click', () => { help.blur(); startTutorial(); });
addEventListener('keydown', (e) => { if (e.code === 'KeyH') startTutorial(); });
input.onChange();
startTutorial();

// ---- loop ----
const clock = new THREE.Clock();
let paused = false;
let snap = true;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) {
    const inp = input.read();
    cam.look(inp.look.dx, inp.look.dy);
    tut.looked += Math.abs(inp.look.dx) + Math.abs(inp.look.dy);
    const before = player.respawns;
    player.update(dt, inp, cam.yaw);
    if (player.respawns !== before) snap = true;
    tutorialTick();
  }
  cam.update(dt, player.pos, snap);
  snap = false;
  sun.position.copy(player.pos).add(SUN);
  sun.target.position.copy(player.pos);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

// Test hooks for the check suite.
window.__pea = {
  THREE, scene, camera, renderer, cam, player, input, pea, plate,
  colliders: { pea: PEA_COLLIDER, plate: PLATE_COLLIDER },
  // freeze the game and show one pose at the origin (st: pose state, or a number for idle time)
  pause(st) {
    paused = true;
    pea.position.set(0, 0, 0);
    pea.rotation.y = 0;
    if (typeof st === 'number') pea.userData.setPhase(st, true);
    else pea.userData.pose({ t: 0, ...st }, true);
    sun.position.copy(SUN); sun.target.position.set(0, 0, 0);
  },
  resume() { paused = false; cam.frozen = false; },
  // place the camera by hand for renders
  view(yaw, pitch, dist, target) {
    cam.frozen = true;
    const t = new THREE.Vector3(...target);
    camera.position.set(t.x + Math.sin(yaw) * Math.cos(pitch) * dist, t.y + Math.sin(pitch) * dist, t.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(t);
    renderer.render(scene, camera);
  },
  render() { renderer.render(scene, camera); },
};
