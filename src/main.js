import * as THREE from 'three';
import './style.css';
import { PEA_COLLIDER } from './pea.js';
import { createBaseplate, createSky, PLATE_COLLIDER } from './world.js';
import { Input } from './input.js';
import { FollowCam } from './player.js';
import { Player } from './soldier.js';
import { World, SQUADS } from './game.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { SLOTS } from './weapons.js';
import { spawnVehicle, nearestEnterable } from './vehicles.js';
import { Sandbox } from './sandbox.js';

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
scene.fog = new THREE.Fog('#c9cbc8', 30, 90);
scene.add(createSky());

const plate = createBaseplate();
scene.add(plate);

// Flat overcast light: neutral sky fill, one cool key that follows the action for crisp shadows.
scene.add(new THREE.HemisphereLight('#e4e7e8', '#6d6e68', 1.3));
const SUN = new THREE.Vector3(4, 7, 5).multiplyScalar(2);
const sun = new THREE.DirectionalLight('#f2f3f0', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SH = 9;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 50 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight('#d8dde0', 0.5);
rim.position.set(-5, 3, -6);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
const cam = new FollowCam(camera);
const fx = new Effects(scene);
const audio = new Audio();
const world = new World(scene, fx, audio);
const player = new Player({ drop: !reduced && !testing });
const pea = player.pea;
world.setPlayer(player);
const hud = new Hud();
const input = new Input(canvas, {
  stick: document.getElementById('stick'),
  knob: document.getElementById('knob'),
  jumpBtn: document.getElementById('jump'),
  fireBtn: document.getElementById('fire'),
  buttons: { next: document.getElementById('swap'), order: document.getElementById('orderBtn'), use: document.getElementById('use') },
});
world.onHitMarker = (kill) => { hud.hit(kill); if (kill) audio.play('ping', null, 0.4); };
world.onPlayerHurt = (dmg) => { hud.hurt(dmg); cam.shake = Math.min(1, cam.shake + dmg / 60); };

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // tall screens: step back a little so the pea isn't cramped side to side
  cam.dist = THREE.MathUtils.clamp(w / h < 0.8 ? 3.9 : 2.7, cam.limits.minDist, cam.limits.maxDist);
  cam.baseDist = cam.dist;
  camera.updateProjectionMatrix();
  fx.setCamera(camera, renderer.domElement.height);
}
addEventListener('resize', resize);
resize();

// ---- a ready-made skirmish: your squad, two enemy armies, cover between them ----
function setupBattle() {
  const P = (t, x, z, y = 0) => world.spawnProp(t, x, z, y);
  // your side
  P('barrier', -3, 5, 0.1); P('barrier', 3.2, 5.5, -0.15); P('crate', -6.5, 3); P('crate', 6.5, 2.2, 0.4); P('drum', -1.2, 7.5);
  // no man's land
  P('sandbags', 0, -3.5); P('sandbags', -5, -5, 0.25); P('sandbags', 5, -5.5, -0.2);
  P('wall', -9, -9, 0.3); P('wall', 9, -9.5, -0.35); P('trap', 0, -10); P('trap', -13, -2); P('trap', 13, -1);
  P('crate', -2.5, -9); P('drum', 2.6, -8.6); P('drum', 3.2, -9.2);
  // the Legion's line
  P('sandbags', -5, -15); P('sandbags', 5, -15.5); P('sandbags', 0, -17.5); P('crate', -9, -16); P('crate', 9, -14.5, 0.3); P('barrier', 0, -21);
  // the Iron Pod's corner
  P('wall', 16, -6, Math.PI / 2); P('sandbags', 15, -13, 0.6); P('barrier', 19, -10, Math.PI / 2); P('crate', 17.5, -2);
  // flanks
  P('wall', -17, -8, Math.PI / 2 - 0.2); P('crate', -15, 2); P('sandbags', -16, -14, 0.4); P('barrier', 12, 9, 0.7); P('sandbags', -11, 9, -0.5);
  spawnVehicle(world, 'jeep', 0, new THREE.Vector3(-3.5, 0, 1.5), Math.PI + 0.3);
  spawnVehicle(world, 'tank', 0, new THREE.Vector3(5, 0, 2.5), Math.PI);
  spawnVehicle(world, 'walker', 1, new THREE.Vector3(-8, 0, -20), 0.2, true);
  spawnVehicle(world, 'hover', 2, new THREE.Vector3(19, 0, -18), -0.7, true);
  world.spawnSquad(0, new THREE.Vector3(0, 0, -1.2), ['rifleman', 'gunner', 'assault', 'grenadier'], Math.PI);
  player.facing = player.aimYaw = Math.PI;
  world.spawnSquad(1, new THREE.Vector3(-3, 0, -19), SQUADS[1], 0);
  world.spawnSquad(2, new THREE.Vector3(17, 0, -15), SQUADS[2], -0.8);
}
if (!testing) setupBattle();

// ---- short tutorial: one prompt at a time, learned by doing; "?" or H replays it ----
const prompt = document.getElementById('prompt');
const help = document.getElementById('help');
const STEPS = {
  mouse: [['lock', 'Click to play'], ['move', 'WASD to move'], ['look', 'Mouse to look'], ['jump', 'Space to jump'], ['fire', 'Click to fire'], ['swap', '1–7 or wheel: weapons'], ['order', 'F: squad orders'], ['use', 'E: drive a vehicle'], ['menu', 'B: sandbox tools']],
  touch: [['move', 'Left thumb to move'], ['look', 'Right thumb to look'], ['jump', 'Tap ↑ to jump'], ['fire', 'Hold ◎ to fire'], ['swap', 'Tap ⇄ for weapons'], ['order', 'Tap ⚑ for squad orders'], ['menu', 'Tap ▦ for sandbox tools']],
};
const tut = { i: 0, done: false, moved: 0, looked: 0, jumps: 0, shots: 0, wi: 0, order: 'follow' };
function steps() { return STEPS[input.touch ? 'touch' : 'mouse'].filter(([k]) => !(k === 'lock' && input.locked)); }
function startTutorial() {
  Object.assign(tut, { i: 0, done: false, moved: player.distance, looked: 0, jumps: player.jumps, shots: player.shots || 0, wi: player.wi, order: world.order });
  showStep();
}
function showStep() {
  if (input.mode === 'build') { prompt.classList.remove('on'); return; }
  const s = steps();
  if (tut.i >= s.length) {
    tut.done = true;
    prompt.textContent = '';
    prompt.classList.remove('on');
    if (!input.touch && !input.locked && input.mode === 'play') { prompt.textContent = 'Click to play'; prompt.classList.add('on'); }
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
    || (k === 'jump' && player.jumps > tut.jumps)
    || (k === 'fire' && (player.shots || 0) > tut.shots)
    || (k === 'swap' && player.wi !== tut.wi)
    || (k === 'order' && world.order !== tut.order)
    || (k === 'use' && !!player.vehicle)
    || (k === 'menu' && input.mode === 'build');
  if (passed) {
    tut.i++;
    Object.assign(tut, { moved: player.distance, looked: 0, jumps: player.jumps, shots: player.shots || 0, wi: player.wi, order: world.order });
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
addEventListener('keydown', (e) => { if (e.code === 'KeyH') startTutorial(); if (e.code === 'KeyM') audio.setMuted(!audio.muted); });
input.onChange();
startTutorial();

// ---- player commands ----
const ORDERS = ['follow', 'hold', 'attack'];
let quickThrow = -1;
function setOrder(o) {
  world.order = o;
  for (const u of world.units) if (u.squad?.commanded) u.holdPos = u.pos.clone();
  audio.play('clink', null, 0.6);
}
function handle(actions) {
  for (const a of actions) {
    if (a.type === 'menu') { world.onMenu?.(); continue; }
    if (!player.alive) continue;
    if (a.type === 'slot') player.setWeapon(a.n);
    else if (a.type === 'next') player.cycleWeapon(1);
    else if (a.type === 'prev') player.cycleWeapon(-1);
    else if (a.type === 'reload') { if (player.startReload()) audio.play('reload', null, 0.6); }
    else if (a.type === 'order') setOrder(ORDERS[(ORDERS.indexOf(world.order) + 1) % ORDERS.length]);
    else if (a.type === 'grenade') {
      const g = player.weapons.findIndex((w) => w.id === 'grenade');
      if (g >= 0 && player.weapons[g].mag > 0 && !player.busy && player.wi !== g) {
        quickThrow = player.wi;
        player.setWeapon(g);
        player.cool = 0;
        player.aimHold = 1.5;
        player.fire(world);
      }
    }
    else if (a.type === 'use') world.onUse?.(player);
  }
  if (quickThrow >= 0 && player.throwT <= 0 && player.weapon.id === 'grenade' && player.thrown) {
    player.setWeapon(quickThrow);
    quickThrow = -1;
  }
}

// vehicles: E (or the use button) gets in and out; the player drives with move keys and shoots
// where the camera points
world.useHint = (u) => {
  if (!u.alive || input.mode !== 'play') return '';
  if (u.vehicle) return '';
  const v = nearestEnterable(world, u);
  return v ? (input.touch ? 'Drive' : 'E  Drive') : '';
};
world.onUse = (u) => {
  if (u.vehicle) { u.vehicle.eject(u, world); snap = true; return; }
  const v = nearestEnterable(world, u);
  if (v && v.enter(u, world)) snap = true;
};
world.controlVehicle = (u, inp, camera, at, dt) => {
  const v = u.vehicle;
  v.drive(inp, at);
  for (const a of inp.actions || []) if (a.type === 'next' || a.type === 'prev' || a.type === 'slot') v.cycleWeapon();
};

const sandbox = new Sandbox({ world, input, camera, cam, scene, audio, onToggle: () => { input.onChange(); } });
world.onMenu = () => sandbox.toggle();

// where the crosshair points in the world
const ray = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
function updateAim() {
  camera.getWorldDirection(ray);
  const o = camera.position.clone();
  const hit = world.raycast(o.clone().addScaledVector(ray, cam.dist * 0.8), ray, 150, { ignore: player });
  aimPoint.copy(hit.hit ? hit.point : o.addScaledVector(ray, 150));
}

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
    if (player.vehicle) {
      const keep = inp.actions.filter((a) => a.type === 'use' || a.type === 'order' || a.type === 'menu');
      inp.actions = inp.actions.filter((a) => !keep.includes(a));
      world.controlVehicle(player, inp, cam, aimPoint, dt);
      handle(keep);
    } else handle(inp.actions);
    const sdt = dt * world.timeScale;
    const before = player.respawns;
    player.god = world.god;
    player.ctrl.speed = inp.sprint ? 1.7 : 1;
    if (!player.vehicle) player.update(sdt, world, inp, cam.yaw, aimPoint);
    else player.t += sdt;
    if (player.respawns !== before) snap = true;
    world.update(dt);
    tutorialTick();
    const armed = player.alive && !player.vehicle;
    cam.shoulderGoal = armed ? 0.42 * Math.min(1, camera.aspect * 0.9) : 0;
    const vd = player.vehicle?.def.cam;
    cam.limits.maxDist = vd ? 11 : 5;
    const want = vd ? vd.dist : cam.baseDist;
    cam.dist += (want - cam.dist) * (1 - Math.exp(-4 * dt));
    cam.shake = Math.max(cam.shake, fx.shake);
    for (const e of world.events) {
      if (e.type === 'boom') cam.shake = Math.min(1.2, cam.shake + Math.max(0, 1 - e.pos.distanceTo(player.pos) / (e.r * 5)));
    }
    world.events.length = 0;
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
  }
  const focus = player.vehicle ? player.vehicle.camFocus() : player.alive ? player.pos : player.pos;
  cam.update(dt, focus, snap);
  snap = false;
  updateAim();
  audio.listener.x = camera.position.x; audio.listener.z = camera.position.z; audio.listener.yaw = cam.yaw;
  sun.position.copy(cam.target).add(SUN);
  sun.target.position.copy(cam.target);
  hud.update(dt, player, world, { useNear: world.useHint?.(player), vehicle: player.vehicle });
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

// Test hooks for the check suite.
window.__pea = {
  THREE, scene, camera, renderer, cam, player, input, pea, plate, world, fx, SLOTS,
  colliders: { pea: PEA_COLLIDER, plate: PLATE_COLLIDER },
  // freeze the game and show one pose at the origin (st: pose state, or a number for idle time)
  pause(st) {
    paused = true;
    pea.position.set(0, 0, 0);
    pea.rotation.set(0, 0, 0);
    if (typeof st === 'number') pea.userData.pose({ t: st, hold: 1 }, true);
    else pea.userData.pose({ t: 0, hold: 1, ...st }, true);
    sun.position.copy(SUN); sun.target.position.set(0, 0, 0);
  },
  resume() { paused = false; cam.frozen = false; },
  // place the camera by hand for renders
  view(yaw, pitch, dist, target) {
    cam.frozen = true;
    const t = new THREE.Vector3(...target);
    camera.position.set(t.x + Math.sin(yaw) * Math.cos(pitch) * dist, t.y + Math.sin(pitch) * dist, t.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(t);
    sun.position.copy(t).add(SUN); sun.target.position.copy(t);
    renderer.render(scene, camera);
  },
  render() { renderer.render(scene, camera); },
  battle: setupBattle,
  setOrder,
  spawnVehicle: (type, team, pos, yaw, crewed) => spawnVehicle(world, type, team, pos, yaw, crewed),
  sandbox,
};
