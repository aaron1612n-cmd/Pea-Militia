import * as THREE from 'three';
import './style.css';
import { createGround, createSky, HALF } from './world.js';
import { Input } from './input.js';
import { PlayerCam } from './camera.js';
import { Unit } from './unit.js';
import { U, pose, makePose, HOLD } from './rig.js';
import { Crowd } from './crowd.js';
import { Battle, SQUAD_MIX, SQUAD_SIZE, KINDS } from './battle.js';
import { buildMap } from './map.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { SLOTS } from './weapons.js';
import { Sandbox } from './sandbox.js';
import { TEAMS } from './factions.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const params = new URLSearchParams(location.search);
const testing = params.has('test');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: testing, powerPreference: 'high-performance' });
renderer.setPixelRatio(testing ? 1 : Math.min(devicePixelRatio, 2)); // the check suite renders in software
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
// late-afternoon haze: warm, dusty, a little smoke hanging over the field
scene.fog = new THREE.Fog('#bdb5a6', 45, 230);
const sky = createSky();
sky.material.uniforms.top.value.set('#8d99a3');
sky.material.uniforms.mid.value.set('#d4c8b2');
sky.material.uniforms.low.value.set('#b6ad9c');
scene.add(sky);
const ground = createGround();
scene.add(ground);

// Overcast light: neutral sky fill, one cool key whose shadow box follows the camera.
scene.add(new THREE.HemisphereLight('#d9dde2', '#5e554a', 1.05));
const SUN = new THREE.Vector3(42, 40, 26); // lower sun: longer shadows, more shape on the blocks
const sun = new THREE.DirectionalLight('#ffe2bd', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(testing ? 1024 : 2048, testing ? 1024 : 2048);
const SH = 26;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight('#aebfd0', 0.6);
rim.position.set(-5, 3, -6);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 700);
const cam = new PlayerCam(camera);
const fx = new Effects(scene);
const audio = new Audio();
const crowd = new Crowd(scene, 700);
const hud = new Hud();
const input = new Input(canvas, {
  stick: $('stick'), knob: $('knob'), jumpBtn: $('jump'), fireBtn: $('fire'),
  buttons: { next: $('swap'), view: $('viewBtn') },
});

let battle = new Battle(scene, fx, audio);
let player = null;
let state = 'menu'; // menu | play | pause | end
let settings = { mode: 'battle', teams: 2, size: 50, tickets: 4, view: '3p', playerTeam: 0 };
let adsToggle = false;
let snap = true;
let quickThrow = -1;

cam.collide = (o, d, max) => {
  const h = battle.raycast(o, d, max, { units: false });
  return h.hit ? h.t : max;
};

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // narrow screens get a little more horizontal view
  cam.fov = w / h < 0.8 ? 78 : 70;
  camera.updateProjectionMatrix();
  fx.setCamera(camera, renderer.domElement.height);
}
addEventListener('resize', resize);
resize();

// ---------------- setup screen ----------------
const menu = $('menu');
const form = $('setup');
function fillSides() {
  const n = +form.teams.value;
  const cur = Math.min(+(form.querySelector('[name=side]:checked')?.value ?? 0), n - 1);
  $('sides').innerHTML = TEAMS.slice(0, n).map((t) => `<label><input type="radio" name="side" value="${t.id}" ${t.id === cur ? 'checked' : ''}/><span><i style="background:${t.ui}"></i>${t.name}</span></label>`).join('');
}
function syncForm() {
  $('sizeOut').textContent = `${form.size.value} per side`;
  const sandbox = form.mode.value === 'sandbox';
  $('ticketField').hidden = sandbox;
  $('sizeField').hidden = sandbox;
}
form.addEventListener('change', (e) => { if (e.target.name === 'teams') fillSides(); syncForm(); });
form.size.addEventListener('input', syncForm);
fillSides();
syncForm();
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const s = {
    mode: form.mode.value, teams: +form.teams.value, size: +form.size.value,
    tickets: +form.tickets.value, view: form.view.value, playerTeam: +(form.querySelector('[name=side]:checked')?.value ?? 0),
  };
  audio.init();
  if (!input.touch) input.requestLock();
  if (!reduced) {
    menu.classList.add('leaving');
    setTimeout(() => startBattle(s), 380);
  } else startBattle(s);
});

// the field behind the setup screen: an empty map and a slow drift
function showcase() {
  battle.dispose();
  battle = new Battle(scene, fx, audio);
  battle.configure({ teams: 2, size: 0, tickets: 0, mode: 'menu' });
  buildMap(battle, { seed: 7, teams: 2 });
  // a few squads standing about so the field isn't empty
  for (let t = 0; t < 2; t++) {
    const b = battle.teams[t].base;
    for (let k = 0; k < 3; k++) battle.spawnSquad(t, b.clone().add(new THREE.Vector3((k - 1) * 9, 0, t ? 8 : -8)), SQUAD_MIX[t].slice(0, 6));
  }
  battle.aiFrozen = true;
  player = null;
}

function openMenu() {
  state = 'menu';
  menu.hidden = false;
  menu.classList.remove('leaving');
  $('pause').hidden = $('end').hidden = true;
  hud.show(false);
  $('touch').hidden = true;
  $('corner').hidden = true;
  sandbox.toggle(false);
  if (document.pointerLockElement) document.exitPointerLock();
  showcase();
  cam.mode = 'menu';
}

// ---------------- battle ----------------
function startBattle(s) {
  settings = { ...settings, ...s };
  battle.dispose();
  battle = new Battle(scene, fx, audio);
  const tickets = Math.round(settings.size * settings.tickets);
  battle.configure({ teams: settings.teams, size: settings.size, tickets, mode: settings.mode, playerTeam: settings.playerTeam });
  buildMap(battle, { seed: 7 + Math.floor(Math.random() * 1000), teams: settings.teams, points: settings.mode === 'battle' });
  // the player
  player = new Unit({ team: settings.playerTeam, loadout: SLOTS, kind: 'player' });
  player.isPlayer = true;
  player.semiLatch = true;
  player.respawnT = 0;
  battle.setPlayer(player);
  const T = battle.teams[settings.playerTeam];
  player.pos.copy(T.base);
  const face = Math.atan2(-T.base.x, -T.base.z);
  player.facing = player.aimYaw = face;
  cam.yaw = face - Math.PI; cam.pitch = -0.05;
  cam.mode = settings.view;
  cam.blend = settings.view === '1p' ? 1 : 0;
  // opening armies
  if (settings.mode === 'battle') {
    for (const t of battle.teams) {
      const n = settings.size - (t.id === settings.playerTeam ? 1 : 0);
      const squads = Math.ceil(n / SQUAD_SIZE);
      const f = Math.atan2(-t.base.x, -t.base.z);
      for (let k = 0; k < squads; k++) {
        const m = Math.min(SQUAD_SIZE, n - k * SQUAD_SIZE);
        const row = Math.floor(k / 5), col = (k % 5) - 2;
        const at = t.base.clone().add(new THREE.Vector3(Math.cos(f) * col * 8 - Math.sin(f) * row * 7, 0, -Math.sin(f) * col * 8 - Math.cos(f) * row * 7));
        battle.spawnSquad(t.id, at, Array.from({ length: m }, (_, i) => SQUAD_MIX[t.id][(i + k) % 8]), f);
      }
      t.tickets = tickets;
    }
  }
  battle.onHitMarker = (kill) => { hud.hit(kill); if (kill) audio.play('ping', null, 0.4); };
  battle.onPlayerHurt = (dmg) => { hud.hurt(dmg); cam.shake = Math.min(1, cam.shake + dmg / 60); };
  battle.onKill = (u, from) => {
    if (from === player && u !== player) hud.log(`${KINDS[u.kind]?.name || 'Soldier'} · ${TEAMS[u.team].short}`, true);
    if (u === player) hud.log(from?.kind ? `Killed by ${KINDS[from.kind]?.name || 'enemy'}` : 'Killed', true);
  };
  hud.setup(battle);
  hud.show(true);
  menu.hidden = true;
  $('pause').hidden = $('end').hidden = true;
  $('touch').hidden = false;
  $('corner').hidden = false;
  state = 'play';
  snap = true;
  sandbox.build();
  if (settings.mode === 'sandbox') { sandbox.toggle(true); hud.say('Sandbox', 1.6); }
  else hud.say('Take the points', 2.4);
  document.documentElement.dataset.view = cam.mode;
  startTutorial();
}

function pause(on) {
  if (state !== 'play' && state !== 'pause') return;
  state = on ? 'pause' : 'play';
  $('pause').hidden = !on;
  if (on && document.pointerLockElement) document.exitPointerLock();
  if (!on && !input.touch && !sandbox.open) input.requestLock();
}
$('resume').addEventListener('click', () => pause(false));
$('restart').addEventListener('click', () => startBattle(settings));
$('toMenu').addEventListener('click', openMenu);
$('again').addEventListener('click', () => { if (!input.touch) input.requestLock(); startBattle(settings); });
$('endMenu').addEventListener('click', openMenu);
$('pauseBtn').addEventListener('click', () => pause(true));
$('sbxBtn').addEventListener('click', () => sandbox.toggle());
for (const id of ['pauseBtn', 'sbxBtn']) $(id).addEventListener('pointerdown', (e) => e.stopPropagation());

// losing the mouse lock mid-battle (Esc) pauses, unless the palette took it
input.onLockRequest = () => { window.__lockAsked = (window.__lockAsked || 0) + 1; };
input.onChange = () => {
  document.documentElement.dataset.locked = input.locked ? 'yes' : 'no';
  if (!input.locked && state === 'play' && !sandbox.open && !input.touch && wasLocked) pause(true);
  wasLocked = input.locked;
  showStep();
};
let wasLocked = false;

const sandbox = new Sandbox({
  getBattle: () => battle, input, cam, camera, scene, audio,
  onToggle: (on) => { if (!on && state === 'play' && !input.touch) input.requestLock(); snap = !on; },
});

// touch: aim and crouch are toggles
const aimBtn = $('aimBtn'), crouchBtn = $('crouchBtn');
for (const [el, fn] of [[aimBtn, () => { adsToggle = !adsToggle; aimBtn.setAttribute('aria-pressed', adsToggle); }], [crouchBtn, () => { input.crouchToggle = !input.crouchToggle; crouchBtn.setAttribute('aria-pressed', input.crouchToggle); }]]) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') audio.setMuted(!audio.muted);
  if (e.code === 'KeyH' && state === 'play') startTutorial();
  if (e.code === 'Escape' && state === 'pause') pause(false);
  if (e.code === 'KeyP' && (state === 'play' || state === 'pause')) pause(state === 'play');
});

// ---------------- tutorial: one prompt at a time, learned by doing ----------------
const prompt = $('prompt');
const STEPS = {
  mouse: [['lock', 'Click to play'], ['move', 'WASD to move'], ['fire', 'Click to fire · right-click for sights'], ['view', 'V switches first / third person'], ['menu', 'B opens the sandbox tools']],
  touch: [['move', 'Left thumb to move'], ['look', 'Right thumb to aim'], ['fire', 'Hold ◎ to fire'], ['view', 'Eye button switches view']],
};
const tut = { i: 0, done: true, moved: 0, looked: 0, shots: 0, view: '' };
function steps() { return STEPS[input.touch ? 'touch' : 'mouse'].filter(([k]) => !(k === 'lock' && input.locked)); }
function startTutorial() {
  if (!player) return;
  Object.assign(tut, { i: 0, done: false, moved: player.distance, looked: 0, shots: player.shots, view: cam.mode });
  showStep();
}
function showStep() {
  if (state !== 'play' || sandbox.open || !player) { prompt.classList.remove('on'); return; }
  const s = steps();
  if (tut.done || tut.i >= s.length) {
    tut.done = true;
    const lockAsk = !input.touch && !input.locked;
    prompt.textContent = lockAsk ? 'Click to play' : '';
    prompt.classList.toggle('on', lockAsk);
    return;
  }
  prompt.textContent = s[tut.i][1];
  prompt.classList.add('on');
}
function tutorialTick() {
  if (tut.done || !player) return;
  const s = steps();
  const k = s[tut.i]?.[0];
  const passed = (k === 'lock' && input.locked)
    || (k === 'move' && player.distance - tut.moved > 2)
    || (k === 'look' && tut.looked > 0.9)
    || (k === 'fire' && player.shots > tut.shots)
    || (k === 'view' && cam.mode !== tut.view && cam.mode !== 'over')
    || (k === 'menu' && sandbox.open);
  if (passed) {
    tut.i++;
    Object.assign(tut, { moved: player.distance, looked: 0, shots: player.shots, view: cam.mode });
    showStep();
  }
}

// ---------------- player control ----------------
function handle(actions) {
  for (const a of actions) {
    if (a.type === 'menu') { if (state === 'play') sandbox.toggle(); continue; }
    if (a.type === 'view') { if (cam.mode !== 'over') { cam.mode = cam.mode === '1p' ? '3p' : '1p'; document.documentElement.dataset.view = cam.mode; } continue; }
    if (!player.alive || sandbox.open) continue;
    if (a.type === 'slot') player.setWeapon(a.n);
    else if (a.type === 'next') player.cycleWeapon(1);
    else if (a.type === 'prev') player.cycleWeapon(-1);
    else if (a.type === 'reload') { if (player.startReload()) audio.play('reload', null, 0.6); }
    else if (a.type === 'grenade') {
      const g = player.weapons.findIndex((w) => w.id === 'grenade');
      if (g >= 0 && player.weapons[g].mag > 0 && !player.busy && player.wi !== g) {
        quickThrow = player.wi;
        player.setWeapon(g);
        player.cool = 0;
        player.ready = 1;
        player.fire(battle);
      }
    }
  }
  if (quickThrow >= 0 && player.throwT <= 0 && player.weapon.id === 'grenade' && player.thrown) {
    player.setWeapon(quickThrow);
    quickThrow = -1;
  }
}

const aimPoint = new THREE.Vector3();
function updateAim() {
  const d = camera.getWorldDirection(new THREE.Vector3());
  const o = camera.position.clone();
  // start the ray past the player's own body in third person
  const skip = cam.mode === '3p' ? Math.max(0, camera.position.distanceTo(player.eye()) * 0.9) : 0.2;
  const hit = battle.raycast(o.clone().addScaledVector(d, skip), d, 300, { ignore: player });
  aimPoint.copy(hit.hit ? hit.point : o.addScaledVector(d, 300));
}

function updatePlayer(dt, inp) {
  const c = player.ctrl;
  if (!player.alive) {
    player.respawnT += dt;
    player.update(dt, battle);
    const T = battle.teams[player.team];
    const can = settings.mode !== 'battle' || T.tickets > 0;
    if (player.respawnT > 4 && can) respawnPlayer();
    else if (!can && player.respawnT > 2) hud.say('No reinforcements left', 0.3);
    else hud.say(`Redeploying ${Math.max(0, Math.ceil(4 - player.respawnT))}`, 0.3);
    return;
  }
  const building = sandbox.open;
  const mv = building ? { x: 0, y: 0 } : inp.move;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  c.wx = rx * mv.x + fx * mv.y;
  c.wz = rz * mv.x + fz * mv.y;
  c.jump = !building && inp.jump;
  c.fire = !building && inp.fire;
  c.sprint = !building && inp.sprint && mv.y > 0.3;
  c.kneel = !building && inp.crouch;
  c.faceYaw = cam.mode === 'over' ? undefined : cam.bodyYaw;
  c.aimAt = building ? null : aimPoint.clone();
  const ads = !building && (inp.aim || adsToggle) && !player.sprinting && player.weapon.def.kind !== 'throw';
  cam.ads += ((ads ? 1 : 0) - cam.ads) * (1 - Math.exp(-14 * dt));
  player.ads = cam.mode === '1p' ? cam.ads : 0;
  player.fp = cam.blend;
  player.god = battle.god;
  player.update(dt, battle);
}

function respawnPlayer() {
  const T = battle.teams[player.team];
  const at = battle.spawnSpot(player.team);
  player.pos.copy(at);
  player.vel.set(0, 0, 0);
  player.alive = true;
  player.hp = player.maxHp;
  player.burn = 0;
  player.respawnT = 0;
  player.deadT = 0;
  player.reloadT = player.throwT = 0;
  for (const w of player.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve ?? Infinity; w.heat = 0; w.locked = 0; }
  if (settings.mode === 'battle') T.tickets = Math.max(0, T.tickets - 1);
  const f = Math.atan2(-at.x, -at.z);
  cam.yaw = f - Math.PI;
  snap = true;
}

// ---------------- render: everyone through the instanced crowd ----------------
const viewPose = makePose();
function drawUnits() {
  crowd.begin();
  const fp = state !== 'menu' && player && cam.mode === '1p' && cam.blend > 0.6;
  for (const u of battle.units) {
    if (u.removed) continue;
    if (u === player && fp) {
      if (!u.alive) continue;
      crowd.add(u.world, u.poseOut, u.team, { body: false, weapon: u.weapon.id });
      continue;
    }
    crowd.add(u.world, u.poseOut, u.team, { weapon: u.weapon.id });
  }
  crowd.end();
}

// ---------------- loop ----------------
const clock = new THREE.Clock();
let frozen = false;
let menuT = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const inp = input.read();
  if (!frozen) {
    if (state === 'menu') {
      menuT += dt * (reduced ? 0.2 : 1);
      battle.update(dt);
      const a = menuT * 0.03;
      camera.position.set(Math.sin(a) * 70, 26, Math.cos(a) * 70);
      camera.lookAt(Math.sin(a + 0.6) * 10, 0, Math.cos(a + 0.6) * 10);
      cam.setFov(60, 1);
    } else if (state === 'play' || state === 'end') {
      if (state === 'play') {
        if (sandbox.open) {
          // overview camera: drag pans, keys pan, wheel zooms, right-drag turns
          const k = cam.over.height / Math.max(300, innerHeight) * 1.6;
          cam.pan(-inp.pan.dx * k, inp.pan.dy * k);
          cam.pan(inp.move.x * dt * cam.over.height * 0.8, inp.move.y * dt * cam.over.height * 0.8);
          if (inp.zoom) cam.zoom(Math.exp(inp.zoom * 0.0012));
          cam.look(inp.look.dx, inp.look.dy);
        } else {
          cam.look(inp.look.dx, inp.look.dy);
          tut.looked += Math.abs(inp.look.dx) + Math.abs(inp.look.dy);
        }
        handle(inp.actions);
      }
      const sdt = dt * battle.timeScale;
      updatePlayer(sdt, inp);
      battle.update(dt);
      tutorialTick();
      cam.shake = Math.max(cam.shake, fx.shake);
      for (const e of battle.events) {
        if (e.type === 'boom') cam.shake = Math.min(1.2, cam.shake + Math.max(0, 1 - e.pos.distanceTo(player.pos) / (e.r * 5)));
        if (e.type === 'capture') {
          hud.log(`${TEAMS[e.team].short} took ${e.point.name}`, e.team === player.team);
          if (e.team === player.team && e.point.pos.distanceTo(player.pos) < 12) hud.say(`${e.point.name} secured`);
        }
      }
      battle.events.length = 0;
      cam.shake = Math.max(0, cam.shake - dt * 2.5);
      if (battle.result && state === 'play') endBattle();
    }
  }
  if (state !== 'menu' && player) {
    cam.update(dt, player, snap);
    snap = false;
    updateAim();
  }
  if (state === 'menu') for (const u of battle.units) u.animate(dt);
  audio.listener.x = camera.position.x; audio.listener.z = camera.position.z; audio.listener.yaw = state === 'menu' ? 0 : cam.yaw;
  // shadows follow what the camera is looking at
  const look = state === 'menu' ? new THREE.Vector3() : cam.mode === 'over' ? new THREE.Vector3(cam.over.x, 0, cam.over.z) : player.pos.clone().add(cam.forward().setY(0).multiplyScalar(12));
  sun.position.copy(look).add(SUN);
  sun.target.position.copy(look);
  if (state !== 'menu' && player) hud.update(dt, player, battle, cam);
  drawUnits();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

function endBattle() {
  state = 'end';
  const won = battle.result.winner === player.team;
  $('endTitle').textContent = won ? 'Victory' : battle.result.winner < 0 ? 'Draw' : 'Defeat';
  const mins = Math.floor(battle.time / 60), secs = Math.floor(battle.time % 60);
  $('endStats').textContent = `${player.kills} kills · ${battle.stats.kills} fallen · ${mins}:${String(secs).padStart(2, '0')}`;
  $('end').hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

openMenu();
if (params.has('play')) startBattle({ mode: params.get('play') || 'battle' });

// Test hooks for the check suite.
window.__game = {
  THREE, scene, camera, renderer, cam, input, crowd, fx, SLOTS, U, pose, makePose, HOLD, HALF,
  get battle() { return battle; }, get player() { return player; }, get state() { return state; },
  sandbox, start: startBattle, openMenu, pause,
  freeze(on = true) { frozen = on; },
  // render one frame now (for screenshots while frozen)
  render() { drawUnits(); renderer.render(scene, camera); },
  view(pos, target) { cam.frozen = true; camera.position.set(...pos); camera.lookAt(...target); sun.position.set(target[0], 0, target[2]).add(SUN); sun.target.position.set(...target); },
  unfreezeCam() { cam.frozen = false; },
};
