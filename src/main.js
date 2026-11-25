import * as THREE from 'three';
import './style.css';
import { createSky, HALF } from './world.js';
import './haze.js';
import { Atmosphere } from './atmosphere.js';
import { Post } from './post.js';
import { View } from './cull.js';
import { Ambience } from './ambience.js';
import { setSight } from './ai.js';
import { height, updateGround, setWetness } from './terrain.js';
import { initEnv, updateEnv } from './env.js';
import { Input } from './input.js';
import { PlayerCam } from './camera.js';
import { Spectate } from './spectate.js';
import { Unit } from './unit.js';
import { U, pose, makePose, HOLD, solveLegs, solveArms } from './rig.js';
import { Crowd } from './crowd.js';
import { Battle, SQUAD_MIX, SQUAD_SIZE, KINDS, HOLD_WIN } from './battle.js';
import { buildMap } from './map.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { SLOTS, WEAPONS, weaponModel } from './weapons.js';
import { Sandbox } from './sandbox.js';
import { TEAMS, hostile } from './factions.js';
import { ViewModel, VM_FOV, VIEW } from './viewmodel.js';
import { Cockpit } from './cockpit.js';
import { MAX_SPEED } from './unit.js';
import { Wheel, ORDERS, issue as issueOrder, tick as tickOrders } from './orders.js';
import { CALLINS, ORDER, RANGE, Reticle, CallinBar } from './callins.js';
import { CLASSES, CLASS_IDS, useSkill } from './classes.js';
import { TrimEmpty } from './instcull.js';
import { Governor } from './governor.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const params = new URLSearchParams(location.search);
const testing = params.has('test');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Quality tiers: 'high' draws through the post pass (AO, grade, grain, blur); 'low' (phones, weak
// machines) draws straight to the screen with a cheap CSS vignette, smaller shadows and 1.5x pixels.
const coarse = matchMedia('(pointer: coarse)').matches;
const tier = params.get('q') || (coarse || (navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'high');
const usePost = tier === 'high' && (!testing || params.has('post'));
document.documentElement.dataset.quality = usePost ? 'high' : 'low';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: testing, powerPreference: 'high-performance' }); // MSAA on phones too: tiled mobile GPUs resolve it on chip, and without it every moving edge crawls
const BASE_DPR = testing ? 1 : Math.min(devicePixelRatio, tier === 'low' ? 1.5 : 2); // the check suite renders in software
renderer.setPixelRatio(BASE_DPR);
// frame times decide the render scale (see governor.js); the check suite and ?fixed keep full resolution so renders are repeatable
const gov = testing || params.has('fixed') ? null : new Governor();
let lastRaf = 0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = tier === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
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

// Overcast light: neutral sky fill, one cool key whose shadow box follows the camera.
const hemi = new THREE.HemisphereLight('#d9dde2', '#5e554a', 1.05);
scene.add(hemi);
const SUN = new THREE.Vector3(42, 40, 26); // overwritten each frame by the day cycle // lower sun: longer shadows, more shape on the blocks
const sun = new THREE.DirectionalLight('#ffe2bd', 2.7);
sun.castShadow = true;
const SM = testing || tier === 'low' ? 1024 : 2048;
sun.shadow.mapSize.set(SM, SM);
const SH = 26;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight('#aebfd0', 0.6);
rim.position.set(-5, 3, -6);
scene.add(rim);
const atmo = new Atmosphere({ scene, sky, hemi, sun, rim, renderer, reduced });
initEnv(renderer, sky);
let sightSet = 0;
atmo.onThunder = () => audio.play('boom', null, 0.35);

const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 700);
const cam = new PlayerCam(camera);
const spec = new Spectate(cam, camera, (o, d, max) => cam.collide ? cam.collide(o, d, max) : max);
scene.add(camera); // the cockpit frame rides on the camera
const cockpit = new Cockpit(camera);
let cockpitVeh = null;
const fx = new Effects(scene);
const audio = new Audio();
const ambience = new Ambience(fx, { low: !usePost, reduced });
const crowd = new Crowd(scene, 700);
// First-person gun and arms get their own scene, camera and depth: the gun never pokes into walls,
// and its field of view stays put when the world camera zooms to aim.
const vmScene = new THREE.Scene();
const vmHemi = new THREE.HemisphereLight('#ffffff', '#777777', 1);
const vmSun = new THREE.DirectionalLight('#ffffff', 1);
vmScene.add(vmHemi, vmSun, vmSun.target);
const vmCamera = new THREE.PerspectiveCamera(VM_FOV, 1, 0.02, 6);
const vmCrowd = new Crowd(vmScene, 2);
let vmOn = false;
const post = usePost ? new Post(renderer, { samples: 4, reduced }) : null;
let frameDt = 1 / 60;
const trim = new TrimEmpty(scene);
// The shadow map is redrawn every frame on every tier: the shadow box moves with the camera, so a stale
// map paired with a fresh matrix makes every shadow jump back and forth on the frames in between.
function renderWorld() {
  trim.run();
  if (post) {
    post.render(scene, camera, frameDt, { night: atmo.night, wet: Math.min(1, atmo.w.rain), flash: atmo.flash * atmo.flash * 0.18, noBlur: testing || state === 'menu' || cam.frozen });
    // the post pass leaves its own depth behind, so the gun gets a clean depth range on the screen
  } else renderer.render(scene, camera);
  if (!vmOn) return;
  vmCamera.position.copy(camera.position);
  vmCamera.quaternion.copy(camera.quaternion);
  const fov = camera.aspect < 0.8 ? VM_FOV + 12 : VM_FOV;
  if (vmCamera.aspect !== camera.aspect || vmCamera.fov !== fov) { vmCamera.aspect = camera.aspect; vmCamera.fov = fov; vmCamera.updateProjectionMatrix(); }
  vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor); vmHemi.intensity = hemi.intensity;
  vmSun.color.copy(sun.color); vmSun.intensity = sun.intensity;
  vmSun.position.copy(sun.position).sub(sun.target.position);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(vmScene, vmCamera);
  renderer.autoClear = true;
}
// Slide the shadow box in whole shadow-map texels (measured across the sun's view) so shadow edges stay
// put on the ground while the camera walks, instead of crawling and shimmering.
const _sx = new THREE.Vector3(), _sy = new THREE.Vector3(), _sz = new THREE.Vector3();
function snapShadowBox(p) {
  if (!(SH > 0)) return;
  const texel = (2 * SH) / SM;
  _sz.copy(SUN).normalize();
  _sx.set(0, 1, 0).cross(_sz).normalize();
  _sy.copy(_sz).cross(_sx);
  const a = Math.round(p.dot(_sx) / texel) * texel, b = Math.round(p.dot(_sy) / texel) * texel, c = p.dot(_sz);
  p.set(0, 0, 0).addScaledVector(_sx, a).addScaledVector(_sy, b).addScaledVector(_sz, c);
}
const hud = new Hud();
const input = new Input(canvas, {
  stick: $('stick'), knob: $('knob'), jumpBtn: $('jump'), fireBtn: $('fire'),
  buttons: { spot: $('spotBtn'), next: $('swap'), view: $('viewBtn'), use: $('useBtn'), wheelDown: $('cmdBtn'), skill: $('skillBtn'), bandage: $('bandBtn') },
});

const wheel = new Wheel($('wheel'), (id) => giveOrder(id));
let wheelAt = 0;
function giveOrder(id) {
  if (!player?.alive) return;
  const n = issueOrder(battle, player, id, { dir: camera.getWorldDirection(new THREE.Vector3()), aim: aimPoint });
  const o = ORDERS.find((x) => x.id === id);
  hud.say(n ? `${o.label}: ${n} squad${n > 1 ? 's' : ''}` : 'No squad close enough to hear you', 1.6);
}
function openWheel(on) {
  if (on && (!player?.alive || sandbox.open || cam.mode === 'free' || player.vehicle)) return;
  wheel.show(on);
  if (on) wheelAt = performance.now();
}
$('wheelX').addEventListener('click', () => openWheel(false));
$('wheelX').addEventListener('pointerdown', (e) => e.stopPropagation());

let sup = 0; // suppression 0..1: rises on near misses and blasts, fades when quiet
const suppEl = document.getElementById('supp');
let suppBlur = -1;
let battle = new Battle(scene, fx, audio);
fx.gore.world = battle;
let player = null;
let state = 'menu'; // menu | play | pause | end
let settings = { mode: 'battle', teams: 2, size: 50, tickets: 4, view: '3p', playerTeam: 0 };
let adsToggle = false;
let snap = true;
let quickThrow = -1;
const vm = new ViewModel();
let lastLook = { dx: 0, dy: 0 };
let lastShots = 0;

cam.collide = (o, d, max) => {
  const h = battle.raycast(o, d, max, { units: false });
  return h.hit ? h.t : max;
};

let smokeScale = 600;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // narrow screens get a little more horizontal view
  cam.fov = w / h < 0.8 ? 78 : 70;
  camera.updateProjectionMatrix();
  fx.setCamera(camera, renderer.domElement.height);
  post?.setSize(renderer.domElement.width, renderer.domElement.height);
  smokeScale = renderer.domElement.height * 0.75;
}
addEventListener('resize', resize);
resize();

// ---------------- setup screen ----------------
const menu = $('menu');
const form = $('setup');
function fillClasses() {
  const cur = form.querySelector('[name=cls]:checked')?.value ?? (() => { try { return localStorage.getItem('sm-class'); } catch { return null; } })() ?? 'rifleman';
  $('classes').innerHTML = CLASS_IDS.map((id) => `<label><input type="radio" name="cls" value="${id}" ${id === cur ? 'checked' : ''}/><span>${CLASSES[id].name}</span></label>`).join('');
  showClass();
}
function showClass() {
  const id = form.querySelector('[name=cls]:checked')?.value ?? 'rifleman', c = CLASSES[id];
  const wp = c.loadout.map((w) => WEAPONS[w].name).join(' + ');
  $('classInfo').innerHTML = `<b>${c.name}</b> ${c.brief}. ${wp} · ${c.hp} HP · ${Math.round(c.speed * 100)}% pace<br><em>${c.skill.name}</em> (H): ${c.skill.blurb}`;
  try { localStorage.setItem('sm-class', id); } catch {}
}
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
form.addEventListener('change', (e) => { if (e.target.name === 'teams') fillSides(); if (e.target.name === 'cls') showClass(); syncForm(); });
form.size.addEventListener('input', syncForm);
fillSides();
fillClasses();
syncForm();
form.gore.value = String(fx.gore.level);
// phones: the setup folds down to a slim bar (title, Options, Deploy) so the field stays visible
$('optBtn').addEventListener('click', () => {
  const open = menu.dataset.open !== '1';
  menu.dataset.open = open ? '1' : '0';
  $('optBtn').setAttribute('aria-expanded', open);
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const s = {
    mode: form.mode.value === 'free' ? 'battle' : form.mode.value, startFree: form.mode.value === 'free', teams: +form.teams.value, size: +form.size.value,
    tickets: +form.tickets.value, view: form.view.value, playerTeam: +(form.querySelector('[name=side]:checked')?.value ?? 0),
    cls: form.querySelector('[name=cls]:checked')?.value ?? 'rifleman',
  };
  fx.gore.setLevel(+form.gore.value);
  atmo.set({ time: form.time.value === 'cycle' ? 12 : form.time.value, cycle: form.time.value === 'cycle', weather: form.weather.value });
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
  fx.gore.world = battle;
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

// blood on the lens (full and low gore, first person only)
const bloodEl = $('bloodscreen');
function bloodScreen(n, size = 1) {
  if (!fx.gore.level || cam.mode !== '1p') return;
  n = Math.min(fx.gore.level === 2 ? 5 : 2, n);
  for (let i = 0; i < n; i++) {
    const e = document.createElement('i'), s = (60 + Math.random() * 120) * size * (1 + (fx.gore.level === 2 ? 0.3 : 0));
    e.style.cssText = `left:${Math.random() * 90}%;top:${Math.random() * 80}%;width:${s}px;height:${s * (0.8 + Math.random() * 0.5)}px;transform:rotate(${Math.random() * 360}deg)`;
    bloodEl.appendChild(e);
    requestAnimationFrame(() => requestAnimationFrame(() => e.classList.add('go')));
    setTimeout(() => e.remove(), 5000);
  }
  while (bloodEl.children.length > 14) bloodEl.firstChild.remove();
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
  fx.gore.clear(); fx.clearMarks();
  battle.dispose();
  battle = new Battle(scene, fx, audio);
  fx.gore.world = battle;
  const tickets = Math.round(settings.size * settings.tickets);
  battle.configure({ teams: settings.teams, size: settings.size, tickets, mode: settings.mode, playerTeam: settings.playerTeam });
  buildMap(battle, { seed: 7 + Math.floor(Math.random() * 1000), teams: settings.teams, points: settings.mode === 'battle' });
  // the player
  const cls = CLASSES[settings.cls] || CLASSES.rifleman;
  player = new Unit({ team: settings.playerTeam, loadout: cls.loadout, kind: CLASSES[settings.cls] ? settings.cls : 'rifleman' });
  player.isPlayer = true;
  player.semiLatch = true;
  player.respawnT = 0;
  clearPlayerEffects();
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
        battle.spawnSquad(t.id, at, Array.from({ length: m }, (_, i) => SQUAD_MIX[t.id][(i + k) % SQUAD_MIX[t.id].length]), f);
      }
      t.tickets = tickets;
      battle.spawnTeamVehicle(t, true, 0, 'walker');
      if (t.id === settings.playerTeam) { battle.spawnTeamVehicle(t, false, 1, 'walker'); } // some for you to climb into
    }
  }
  battle.onNearMiss = (k) => { sup = Math.min(1, sup + k * 0.35); };
  battle.onBlast = (pos, r) => {
    if (!player) return;
    const d = pos.distanceTo(player.pos);
    audio.blast(d, r);
    sup = Math.min(1, sup + Math.max(0, 1 - d / (r * 6)) * 0.9);
    if (!reduced) cam.shake = Math.max(cam.shake, Math.min(1, Math.max(0, 1 - d / (r * 7)) * 1.3));
  };
  battle.onHitMarker = (kill) => { hud.hit(kill); if (kill) audio.play('ping', null, 0.4); };
  battle.onPlayerHurt = (dmg) => { hud.hurt(dmg); bloodScreen(Math.ceil(dmg / 15), 0.5); cam.shake = Math.min(1, cam.shake + dmg / 60); };
  battle.onShock = (sec) => { audio.deaf = Math.min(1, Math.max(audio.deaf, 0.5 + sec / 10)); if (!reduced) cam.shake = 1; bloodScreen(2, 0.6); hud.say('Shell shock', 1.6); };
  battle.onKill = (u, from) => {
    spec.onKill(u, from);
    if (from === player && u !== player && player.pos.distanceTo(u.pos) < 4) bloodScreen(3, 1.2);
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
  cancelCallin();
  sandbox.build();
  if (settings.mode === 'sandbox') { sandbox.toggle(true); hud.say('Sandbox', 1.6); }
  else hud.say('Take the points', 2.4);
  document.documentElement.dataset.view = cam.mode;
  document.documentElement.dataset.free = '0';
  startTutorial();
  if (settings.startFree) toggleFree(true, true);
}

// Free camera: fly over the field with no soldier. The player's soldier steps out of the battle
// while you do, and drops back in wherever you were when you switch back.
function toggleFree(on = cam.mode !== 'free', start = false) {
  if (state !== 'play' || (on && cam.mode === 'free') || (!on && cam.mode !== 'free')) return;
  spec.release(); hud.setView(null);
  if (on) {
    if (sandbox.open) sandbox.toggle(false);
    cam.fr.copy(camera.position);
    if (start) { const T = battle.teams[player.team]; cam.fr.set(T.base.x * 0.5, 22, T.base.z * 0.5 + Math.sign(T.base.z || 1) * 14); cam.yaw = Math.atan2(cam.fr.x, cam.fr.z); cam.pitch = -0.4; }
    cam.mode = 'free';
    battle.units = battle.units.filter((u) => u !== player);
    player.muzzleOverride = null;
    tut.done = true; prompt.classList.remove('on');
    if (!input.touch) input.requestLock();
  } else {
    const gx = THREE.MathUtils.clamp(cam.fr.x, -HALF + 2, HALF - 2), gz = THREE.MathUtils.clamp(cam.fr.z, -HALF + 2, HALF - 2);
    player.pos.set(gx, 0, gz); player.vel.set(0, 0, 0);
    player.alive = true; player.deadT = 0; player.respawnT = 0; player.grounded = false;
    player.resetBody(); fx.gore.forget(player); clearPlayerEffects();
    for (const w of player.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve ?? Infinity; }
    if (!battle.units.includes(player)) battle.units.push(player);
    cam.yaw = cam.yaw; cam.mode = settings.view; cam.blend = settings.view === '1p' ? 1 : 0;
    snap = true;
  }
  document.documentElement.dataset.free = on ? '1' : '0';
  document.documentElement.dataset.view = cam.mode;
  if (on) hud.say(input.touch ? 'Free camera · tap a soldier to follow' : 'Free camera · click a soldier to follow · F returns', 2.6);
}

// Follow camera controls: Q / E (or the arrows on screen) step through soldiers, a click or tap picks one.
let specFire = false;
function specStep(dir) {
  if (!spec.active) { const n = spec.nearest(battle, player); if (n) { spec.follow(n); return; } }
  if (!spec.step(battle, player, dir)) hud.say('No soldiers left to follow', 1.4);
}
function specPickAt(x, y) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const reach = (input.touch ? 70 : 80) * dpr;
  const u = spec.pick(hud.pts || [], x * dpr, y * dpr, reach);
  if (u) spec.follow(u);
}
const specEl = { prev: $('specPrev'), next: $('specNext'), mode: $('specMode'), free: $('specFree'), card: $('specCard'), hint: $('specHint'), info: $('specInfo'), name: $('specName'), team: $('specTeam'), kills: $('specKills'), hp: $('specHp'), fight: $('specFight') };
for (const [el, fn] of [[specEl.prev, () => specStep(-1)], [specEl.next, () => specStep(1)], [specEl.mode, () => hud.say(spec.toggleMode() === 'duel' ? 'Duel cam · keeps his fight in frame' : 'Chase cam · you steer', 1.4)], [specEl.free, () => spec.release()]]) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  el.addEventListener('click', (e) => e.preventDefault());
}
let specLast = '', specCut = 0;
function specUi() {
  const u = spec.unit, on = !!u;
  if (specEl.info.hidden === on) { specEl.info.hidden = !on; specEl.hint.hidden = on; specEl.mode.hidden = specEl.free.hidden = !on; }
  if (!u) { specLast = ''; return; }
  const t = spec.target, dead = !u.alive;
  specEl.mode.textContent = spec.mode === 'duel' ? 'Duel' : 'Chase';
  const kind = KINDS[u.kind]?.name || 'Soldier';
  const hp = Math.max(0, Math.round((u.hp / (u.maxHp || 100)) * 100));
  const range = t ? Math.round(Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z)) : 0;
  const fight = dead ? (spec.killer ? `Killed by <em>${KINDS[spec.killer.kind]?.name || 'enemy'} · ${TEAMS[spec.killer.team].short}</em>` : 'Killed') : t ? `Fighting <em>${KINDS[t.kind]?.name || 'Soldier'} · ${TEAMS[t.team].short}</em> · ${range} m` : 'No target';
  const key = `${kind}|${u.team}|${u.kills}|${hp}|${fight}|${spec.mode}`;
  // each cut to a new soldier replays the card's entrance
  if (specCut !== u) { specCut = u; specEl.card.classList.remove('cut'); void specEl.card.offsetWidth; specEl.card.classList.add('cut'); }
  if (key === specLast) return;
  specLast = key;
  specEl.name.textContent = kind;
  specEl.team.textContent = TEAMS[u.team].short;
  specEl.kills.textContent = u.kills ? `${u.kills} kill${u.kills === 1 ? '' : 's'}` : '';
  specEl.hp.style.transform = `scaleX(${hp / 100})`;
  specEl.hp.classList.toggle('low', hp < 35);
  specEl.fight.innerHTML = fight;
  specEl.card.style.borderLeftColor = TEAMS[u.team].ui;
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
$('pauseFree').addEventListener('click', () => { pause(false); toggleFree(); });
$('pauseFree').addEventListener('pointerdown', (e) => e.stopPropagation());
$('toMenu').addEventListener('click', openMenu);
$('again').addEventListener('click', () => { if (!input.touch) input.requestLock(); startBattle(settings); });
$('endMenu').addEventListener('click', openMenu);
$('pauseBtn').addEventListener('click', () => pause(true));
$('sbxBtn').addEventListener('click', () => sandbox.toggle());
$('freeBtn').addEventListener('click', () => toggleFree());
// compact HUD: U or the eye button hides the extras; the follow bar fades after 4 s without input
function setLite(on) { document.documentElement.dataset.lite = on ? '1' : '0'; try { localStorage.setItem('hudLite', on ? '1' : '0'); } catch {} }
try { setLite(localStorage.getItem('hudLite') === '1'); } catch {}
$('hudBtn').addEventListener('click', () => setLite(document.documentElement.dataset.lite !== '1'));
let idleTimer = 0;
const wake = () => { document.documentElement.dataset.idle = '0'; clearTimeout(idleTimer); idleTimer = setTimeout(() => { document.documentElement.dataset.idle = '1'; }, 4000); };
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'touchstart']) addEventListener(ev, wake, { passive: true });
wake();
$('palMore').addEventListener('click', () => sandbox.more());
for (const id of ['pauseBtn', 'sbxBtn', 'freeBtn', 'hudBtn']) $(id).addEventListener('pointerdown', (e) => e.stopPropagation());

// losing the mouse lock mid-battle (Esc) pauses, unless the palette took it
input.onLockRequest = () => { window.__lockAsked = (window.__lockAsked || 0) + 1; };
input.onChange = () => {
  document.documentElement.dataset.locked = input.locked ? 'yes' : 'no';
  if (!input.locked && state === 'play' && !sandbox.open && !input.touch && wasLocked) pause(true);
  wasLocked = input.locked;
  showStep();
};
let wasLocked = false;
let vehPrompt = false;
const useBtn = $('useBtn');

const sandbox = new Sandbox({
  getBattle: () => battle, input, cam, camera, scene, audio,
  onToggle: (on) => { if (!on && state === 'play' && !input.touch) input.requestLock(); snap = !on; },
});

// touch: aim and crouch are toggles
const aimBtn = $('aimBtn'), crouchBtn = $('crouchBtn');
for (const [el, fn] of [[aimBtn, () => { adsToggle = !adsToggle; aimBtn.setAttribute('aria-pressed', adsToggle); }], [crouchBtn, () => {
  // stand -> crouch -> prone -> stand
  if (input.prone) { input.prone = false; input.crouchToggle = false; } else if (input.crouchToggle) { input.crouchToggle = false; input.prone = true; } else input.crouchToggle = true;
  crouchBtn.setAttribute('aria-pressed', input.crouchToggle || input.prone);
  crouchBtn.dataset.stance = input.prone ? 'prone' : input.crouchToggle ? 'crouch' : 'stand';
}]]) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') audio.setMuted(!audio.muted);
  if (e.code === 'KeyU') setLite(document.documentElement.dataset.lite !== '1');
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

// ---------------- call-ins: K or the buttons pick one, aim, fire to call it ----------------
const reticle = new Reticle(scene);
const ciBar = new CallinBar($('callins'), (i) => pickCallin(i));
const ci = { sel: -1, fireHeld: false, aimHeld: false };
const MIN_DIST = { strike: 30, barrage: 26, supply: 0 };
function callinOk() { return state === 'play' && !wheel.open && player && player.alive && !sandbox.open && cam.mode !== 'free'; }
function cancelCallin() { ci.sel = -1; reticle.hide(); }
function pickCallin(i) {
  if (!callinOk()) return;
  if (i === ci.sel || i < 0 || i >= ORDER.length) { cancelCallin(); return; }
  const k = ORDER[i], left = battle.callins.left(player.team, k);
  if (left > 0) { hud.say(`${CALLINS[k].name} ready in ${Math.ceil(left)}s`, 1.4); return; }
  ci.sel = i; ci.fireHeld = true; ci.aimHeld = true;
  hud.say(`${CALLINS[k].name} · aim, then ${input.touch ? 'press ◎' : 'click'} · ${input.touch ? 'tap again' : 'right-click'} cancels`, 3);
}
function cycleCallin() {
  // K steps through the ready ones, then off
  for (let n = ci.sel + 1; n < ORDER.length; n++) if (battle.callins.ready(player.team, ORDER[n])) { pickCallin(n); return; }
  if (ci.sel >= 0) cancelCallin(); else hud.say('Call-ins are recharging', 1.2);
}
function callinTarget() {
  const k = ORDER[ci.sel];
  const dist = Math.hypot(aimPoint.x - player.pos.x, aimPoint.z - player.pos.z);
  const why = dist > RANGE ? 'Out of range' : dist < MIN_DIST[k] ? 'Too close to you' : '';
  return { k, why };
}
function confirmCallin() {
  const { k, why } = callinTarget();
  if (why) { hud.say(why, 1.2); return; }
  const yaw = cam.yaw;
  if (battle.callins.call(player.team, k, aimPoint, { x: -Math.sin(yaw), z: -Math.cos(yaw) }, player)) {
    hud.say(`${CALLINS[k].name} inbound`, 1.8);
    hud.log(`${CALLINS[k].name} called`, true);
  }
  cancelCallin();
}
// runs before the player's input is used: while aiming a call-in the fire button belongs to it
function callinInput(inp) {
  if (ci.sel >= 0 && !callinOk()) cancelCallin();
  if (ci.sel < 0) return;
  const fireEdge = inp.fire && !ci.fireHeld, aimEdge = inp.aim && !ci.aimHeld;
  ci.fireHeld = inp.fire; ci.aimHeld = inp.aim;
  inp.fire = false; inp.aim = false;
  if (aimEdge) { cancelCallin(); return; }
  if (fireEdge) confirmCallin();
}
function callinVisuals() {
  if (state === 'play' && player) ciBar.update(battle, player.team, ci.sel);
  if (ci.sel >= 0 && callinOk()) { const { k, why } = callinTarget(); reticle.show(k, aimPoint, cam.yaw + Math.PI, !why); } else reticle.hide();
}

// ---------------- player control ----------------
function handle(actions) {
  for (const a of actions) {
    if (a.type === 'free') { toggleFree(); continue; }
    if (a.type === 'menu') { if (state === 'play') sandbox.toggle(); continue; }
    if (a.type === 'use') { useVehicle(); continue; }
    if (a.type === 'wheelDown') { openWheel(!wheel.open); continue; }
    if (a.type === 'wheelUp') {
      if (wheel.open && !input.touch) { if (wheel.sel >= 0) wheel.pick(wheel.sel); else if (performance.now() - wheelAt > 300) openWheel(false); }
      continue;
    }
    if (wheel.open) { if (a.type === 'slot') wheel.pick(a.n); continue; }
    if (a.type === 'callin') { if (callinOk()) cycleCallin(); continue; }
    if (a.type === 'map') { hud.toggleMap(); continue; }
    if (a.type === 'spot') { if (player.alive && cam.mode !== 'free' && !sandbox.open) spotEnemy(); continue; }
    if (cam.mode === 'free' && !sandbox.open) {
      if (a.type === 'specNext' || a.type === 'specPrev') { specStep(a.type === 'specNext' ? 1 : -1); continue; }
      if (a.type === 'tap') { specPickAt(a.x, a.y); continue; }
      if (a.type === 'next' || a.type === 'prev') { if (spec.active) spec.zoom(a.type === 'next' ? 1.15 : 0.87); continue; }
      if (a.type === 'view') { if (spec.active) hud.say(spec.toggleMode() === 'duel' ? 'Duel cam · keeps his fight in frame' : 'Chase cam · you steer', 1.4); continue; }
    }
    if (a.type === 'view') { if (player.vehicle) { cam.cockpit = !cam.cockpit; hud.say(cam.cockpit ? 'Cockpit view' : 'Chase view', 1); continue; } if (cam.mode !== 'over' && cam.mode !== 'free') { cam.mode = cam.mode === '1p' ? '3p' : '1p'; document.documentElement.dataset.view = cam.mode; } continue; }
    if (!player.alive || sandbox.open || cam.mode === 'free') continue;
    if (a.type === 'slot') player.setWeapon(a.n);
    else if (a.type === 'next') player.cycleWeapon(1);
    else if (a.type === 'prev') player.cycleWeapon(-1);
    else if (a.type === 'bandage') {
      if (player.bleed > 0.05 && player.bandageT <= 0 && !player.vehicle) { player.bandageT = 3; hud.say('Bandaging…', 2.6); audio.play('reload', null, 0.5); }
      else if (player.bleed <= 0.05) hud.say('Not bleeding', 1);
    }
    else if (a.type === 'skill') { if (useSkill(player, battle)) audio.play('reload', null, 0.5); }
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

// ---------------- vehicles ----------------
function nearestVehicle() {
  let best = null, bd = 6.5;
  for (const v of battle.vehicles) {
    if (!v.alive || v.team !== player.team) continue;
    if (v.seats[0] && !(v.seats.length > 1 && !v.seats[1] && v.crew.length)) continue;
    if (!v.seats[0] && v.crew.length && v.seats.length < 2 && false) continue;
    const d = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z) - v.def.hx;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}
function useVehicle() {
  if (state !== 'play' || !player.alive || sandbox.open || cam.mode === 'free') return;
  const cur = player.vehicle;
  if (cur) {
    const seat = player.seat || 0;
    if (seat === 0) { cur.ctrl.throttle = cur.ctrl.steer = 0; cur.ctrl.brake = true; }
    cur.ctrl.fire = cur.ctrl.fire2 = false;
    cur.eject(seat, battle);
    player.facing = player.aimYaw = cur.yaw;
    cam.mode = settings.view; cam.blend = settings.view === '1p' ? 1 : 0;
    document.documentElement.dataset.view = cam.mode;
    snap = true;
    hud.say('On foot', 1);
    return;
  }
  const v = nearestVehicle();
  if (!v) return;
  // a second seat on a crewed car: ride as its gunner
  if (v.crew.length && v.seats.length > 1 && !v.seats[1]) {
    v.board(player, 1);
    player.vehicle = v;
    player.ctrl.fire = false; player.ctrl.wx = player.ctrl.wz = 0;
    cam.mode = '3p'; cam.blend = 0; cam.cockpit = false; cam.yaw = v.yaw + Math.PI; cam.pitch = -0.12;
    document.documentElement.dataset.view = '3p';
    snap = true;
    hud.say(`${v.def.name} · gunner · aim and click · X leaves`, 3);
    return;
  }
  // a friendly crew steps out and carries on as infantry
  for (const u of v.crew) battle.spawnUnit(v.team, 'rifleman', new THREE.Vector3(v.pos.x + Math.cos(v.yaw) * (v.def.hx + 1.4), 0, v.pos.z - Math.sin(v.yaw) * (v.def.hx + 1.4)), { yaw: v.yaw });
  v.crew.length = 0; v.brain = null;
  v.board(player, 0);
  player.vehicle = v;
  player.ctrl.fire = false; player.ctrl.wx = player.ctrl.wz = 0;
  cam.mode = '3p'; cam.blend = 0; cam.cockpit = false; cam.yaw = v.yaw + Math.PI; cam.pitch = -0.12;
  document.documentElement.dataset.view = '3p';
  snap = true;
  hud.say(input.touch ? `${v.def.name} · stick drives · ◎ fires` : `${v.def.name} · ${v.def.hint}`, 3);
}
function driveVehicle(inp) {
  const v = player.vehicle, c = v.ctrl;
  const building = sandbox.open;
  if (player.seat === 0) {
    c.throttle = building ? 0 : inp.move.y;
    c.steer = building ? 0 : inp.move.x;
    c.brake = !building && inp.jumpHeld;
  }
  c.fire = !building && inp.fire;
  c.fire2 = !building && (inp.aim || adsToggle);
  c.aimAt = building ? null : aimPoint.clone();
  player.pos.copy(v.pos);
  player.facing = v.yaw;
}

// Tag the enemy under the crosshair (or nearest to it). Your squad and any friendly squad close by hear of it.
let spotCool = 0;
function spotEnemy() {
  if (battle.time < spotCool) return;
  spotCool = battle.time + 0.5;
  const d = camera.getWorldDirection(new THREE.Vector3()), o = camera.position;
  let tgt = null;
  const hit = battle.raycast(o, d, 300, { ignore: player });
  if (hit.unit && hostile(hit.unit.team, player.team)) tgt = hit.unit;
  else if (hit.vehicle && hostile(hit.vehicle.team, player.team)) tgt = hit.vehicle;
  else {
    let best = 0.96; // within about 16 degrees
    const v = new THREE.Vector3();
    for (const e of [...battle.units, ...battle.vehicles]) {
      if (!e.alive || !hostile(e.team, player.team) || e.vehicle) continue;
      v.set(e.pos.x - o.x, e.pos.y + 1 - o.y, e.pos.z - o.z);
      const dist = v.length();
      if (dist > 160 || dist < 2) continue;
      const dot = v.dot(d) / dist;
      if (dot > best && battle.los(o, new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z))) { best = dot; tgt = e; }
    }
  }
  if (!tgt) { hud.say('No enemy in sight', 0.8); return; }
  tgt.markedUntil = tgt.spottedUntil = battle.time + 10; tgt.seenAt = battle.time; (tgt.lastKnown || (tgt.lastKnown = new THREE.Vector3())).copy(tgt.pos);
  for (const sq of battle.squads) if (sq.team === player.team && sq.alive.length && sq.alive[0].pos.distanceTo(player.pos) < 120) sq.know(tgt, tgt.pos, true);
  audio.play('ping', null, 0.35);
  hud.say(`Enemy spotted · ${tgt.crew ? tgt.def.name : KINDS[tgt.kind]?.name || 'Soldier'}`, 1.2);
}
const aimPoint = new THREE.Vector3();
const _aimD = new THREE.Vector3(), _aimO = new THREE.Vector3(), _aimS = new THREE.Vector3();
function updateAim() {
  const d = camera.getWorldDirection(_aimD);
  const o = _aimO.copy(camera.position);
  // start the ray past the player's own body in third person
  const skip = cam.mode === '3p' ? Math.max(0, camera.position.distanceTo(player.eye()) * 0.9) : 0.2;
  const hit = battle.raycast(_aimS.copy(o).addScaledVector(d, skip), d, 300, { ignore: player });
  aimPoint.copy(hit.hit ? hit.point : o.addScaledVector(d, 300));
}

// Touch aim assist: the view slows down over an enemy (friction) and, while you move or shoot,
// drifts gently onto them (magnetism). Only for visible enemies close to the crosshair.
const AA = { dir: new THREE.Vector3(), to: new THREE.Vector3(), c: new THREE.Vector3() };
function aimAssist(dt, inp) {
  camera.getWorldDirection(AA.dir);
  let best = null, bestA = Infinity;
  for (const u of battle.units) {
    if (!u.alive || u.team === player.team) continue;
    u.center(AA.c);
    AA.to.subVectors(AA.c, camera.position);
    const d = AA.to.length();
    if (d > 60 || d < 1) continue;
    const ang = AA.dir.angleTo(AA.to);
    const cone = 0.035 + 0.9 / d; // wider up close
    if (ang < cone && ang < bestA) { bestA = ang; best = u; }
  }
  if (!best || !battle.los(camera.position, best.center(AA.c))) return;
  inp.look.dx *= 0.5; inp.look.dy *= 0.5;
  const busy = inp.fire || Math.hypot(inp.move.x, inp.move.y) > 0.2 || Math.hypot(inp.look.dx, inp.look.dy) > 0;
  if (!busy) return;
  AA.to.subVectors(best.center(AA.c), camera.position).normalize();
  const yawT = Math.atan2(-AA.to.x, -AA.to.z), pitchT = Math.asin(THREE.MathUtils.clamp(AA.to.y, -1, 1));
  const dy = Math.atan2(Math.sin(yawT - cam.yaw), Math.cos(yawT - cam.yaw)), dp = pitchT - cam.pitch;
  const k = 1 - Math.exp(-(inp.fire ? 4 : 2) * dt);
  cam.yaw += dy * k; cam.pitch += dp * k;
}

const lookAcc = { x: 0, y: 0 };
let swayT = 0, swayPrev = 0, recoilDebt = 0;
// the rifle is never dead still: breathing sway, worse when winded, hurt or shocked
function battleFeel(dt) {
  const p = player;
  if (reduced || !p.alive || state === 'menu') return;
  const sup = p.suppression, sh = Math.min(1, p.shock / 3);
  swayT += dt;
  const wob = (0.00045 + (p.winded ? 0.0009 : 0) + p.arm * 0.0007 + (p.bleed > 0.3 ? 0.0004 : 0) + sh * 0.0016 + sup * 0.0004) * (p.weapon.def.sway ?? 1) * (1 - 0.3 * cam.ads + Math.min(0.9, Math.max(0, p.adsT - 3) * 0.25)) * (1 - 0.4 * p.kneelK) * (1 - 0.5 * (p.proneK || 0));
  const now = Math.sin(swayT * 1.7) + Math.sin(swayT * 2.9) * 0.5;
  cam.pitch += (now - swayPrev) * wob * 3;
  cam.yaw += (Math.cos(swayT * 1.3) - Math.cos((swayT - dt) * 1.3)) * wob * 3;
  swayPrev = now;
}

function updatePlayer(dt, inp) {
  const c = player.ctrl;
  player.onJam = player.onJam || (() => hud.say('Weapon jammed', 1.6));
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
  if (player.vehicle) { driveVehicle(inp); return; }
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
  c.prone = !building && inp.prone;
  { const st = input.prone ? 'prone' : input.crouchToggle ? 'crouch' : 'stand'; if (crouchBtn.dataset.stance !== st) { crouchBtn.dataset.stance = st; crouchBtn.setAttribute('aria-pressed', st !== 'stand'); } }
  c.lean = building ? 0 : inp.lean;
  c.faceYaw = cam.mode === 'over' ? undefined : cam.bodyYaw;
  c.aimAt = building ? null : aimPoint.clone();
  const ads = !building && (inp.aim || adsToggle || window.__adsForce) && !player.sprinting && player.weapon.def.kind !== 'throw';
  cam.ads += ((ads ? 1 : 0) - cam.ads) * (1 - Math.exp(-14 * dt));
  player.ads = cam.mode === '1p' ? cam.ads : 0;
  player.fp = cam.blend;
  player.god = battle.god;
  player.update(dt, battle);
}

// screen and sound leftovers from being hurt: blood on the lens, deafness, ringing, shake, bleed text
function clearPlayerEffects() {
  bloodEl.replaceChildren();
  audio.deaf = 0; audio.sup = 0;
  cam.shake = 0; cam.ads = 0; adsToggle = false;
  hud.hurtT = 0;
  hud.bleedEl.hidden = true; hud.last.bl = '';
}

function respawnPlayer() {
  const T = battle.teams[player.team];
  const at = battle.spawnSpot(player.team);
  player.pos.copy(at);
  player.vel.set(0, 0, 0);
  player.alive = true;
  player.resetBody();
  fx.gore.forget(player);
  clearPlayerEffects();
  player.respawnT = 0;
  player.deadT = 0;
  for (const w of player.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve ?? Infinity; w.heat = 0; w.locked = 0; }
  if (settings.mode === 'battle') T.tickets = Math.max(0, T.tickets - 1);
  const f = Math.atan2(-at.x, -at.z);
  cam.yaw = f - Math.PI;
  snap = true;
}

// ---------------- render: everyone through the instanced crowd ----------------
const viewPose = makePose();
const LOD_FAR = 52; // beyond this, soldiers draw as the plain block, hands, feet, arms and weapon
const view = new View();
let unitView = new Uint8Array(256); // per soldier: 0 skip, 1 camera only, 2 camera and shadow box
const LOD_FAR2 = 85; // beyond this a glove is under a pixel and is not drawn
function drawUnits() {
  crowd.begin();
  vmCrowd.begin();
  vmOn = false;
  // what the camera or the sun's shadow can reach: everything else is left out of the instance buffers
  view.update(camera, sun, scene.fog.far);
  battle.batch.cull(view);
  for (const d of battle.decor) if (d.userData.culls) for (const c of d.userData.culls) c.update(view);
  // machines the camera and the sun's shadow cannot reach (or past the haze) are not sent to the GPU at all
  for (const v of battle.vehicles) v.group.visible = v.hasPlayer || view.test(v.pos.x, v.pos.y + 3, v.pos.z, 7) > 0;
  const fp = state !== 'menu' && player && cam.mode === '1p' && cam.blend > 0.6;
  const cp = camera.position;
  const us = battle.units;
  if (unitView.length < us.length) unitView = new Uint8Array(us.length * 2);
  for (let i = 0; i < us.length; i++) {
    const u = us[i];
    unitView[i] = u.removed || u.vehicle ? 0 : u === player ? 2 : view.test(u.pos.x, u.pos.y + 1, u.pos.z, 2.4);
  }
  // soldiers inside the sun's shadow box first, then the rest that only the camera sees: the shadow pass
  // draws just the first group (see Crowd.snap)
  for (let pass = 2; pass >= 1; pass--) {
    for (let i = 0; i < us.length; i++) {
      if (unitView[i] !== pass) continue;
      const u = us[i];
      if (u === player && fp) {
        if (!u.alive) continue;
        vmCrowd.add(vm.identity, vm.pose, u.team, { body: false, weapon: u.weapon.id });
        vmOn = true;
        continue;
      }
      const dd = u.pos.distanceToSquared(cp);
      crowd.add(u.world, u.poseOut, u.team, { weapon: u.weapon.id, seed: u.id, wound: u.wound, lost: u.lost, wounds: u.wounds, marks: u.marks, kind: u.kind, far: dd > LOD_FAR * LOD_FAR, far2: dd > LOD_FAR2 * LOD_FAR2 });
    }
    if (pass === 2) crowd.snap();
  }
  crowd.end();
  vmCrowd.end();
}

// ---------------- loop ----------------
const clock = new THREE.Clock();
const _look = new THREE.Vector3(), _fwd = new THREE.Vector3(); // reused each frame: nothing is allocated in the loop
let frozen = false;
let menuT = 0;
let skipDraw = false;
function frame(_t, fixedDt) {
  const dt = fixedDt ?? Math.min(clock.getDelta(), 0.05);
  if (gov && fixedDt === undefined) {
    const now = performance.now(), ms = lastRaf ? now - lastRaf : 0;
    lastRaf = now;
    const k = state === 'pause' ? 0 : gov.sample(ms);
    if (k) { renderer.setPixelRatio(BASE_DPR * k); resize(); }
  }
  frameDt = dt;
  { const now = performance.now() / 1000; if (!reduced) sky.material.uniforms.time.value = now; if (!reduced) for (const p of battle.points) p.model.userData.wave?.(now); }
  for (const d of battle.decor) if (d.userData.tick) { d.userData.tick(performance.now() / 1000); d.userData.smoke.material.uniforms.scale.value = smokeScale; }
  const inp = input.read();
  if (!frozen) {
    if (state === 'menu') {
      menuT += dt * (reduced ? 0.2 : 1);
      battle.update(dt);
      const a = menuT * 0.03;
      camera.position.set(Math.sin(a) * 70, 30, Math.cos(a) * 70);
      camera.lookAt(Math.sin(a + 0.6) * 10, 2, Math.cos(a + 0.6) * 10);
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
        } else if (cam.mode === 'free') {
          const up = (inp.jumpHeld ? 1 : 0) - (inp.crouch ? 1 : 0);
          if (spec.active) {
            // following: look orbits him, the wheel zooms, and any move key lets go
            spec.nudge(inp.look.dx, inp.look.dy);
            if (inp.move.x || inp.move.y || up) spec.release();
          } else {
            cam.look(inp.look.dx, inp.look.dy);
            cam.fly(dt, inp.move, up, inp.sprint);
          }
          // a click with the mouse locked picks the soldier under the crosshair
          if (inp.fire && !specFire && !input.touch) specPickAt(innerWidth / 2, innerHeight / 2);
          specFire = inp.fire;
        } else {
          if (input.touch && player?.alive) aimAssist(dt, inp);
          if (wheel.open) { wheel.nudge(inp.look.dx, inp.look.dy); inp.look.dx = inp.look.dy = 0; inp.fire = false; }
          {
            // weighty aim: input is eased in over a few frames (nothing is lost), heavier guns turn slower
            const wt = player?.weapon ? 1 / (1 + 0.3 * ((player.weapon.def.sway ?? 1) - 1)) : 1;
            lookAcc.x += inp.look.dx * wt; lookAcc.y += inp.look.dy * wt;
            const f = input.touch ? 1 : 1 - Math.exp(-dt / 0.035);
            const sx = lookAcc.x * f, sy = lookAcc.y * f;
            lookAcc.x -= sx; lookAcc.y -= sy;
            cam.look(sx, sy);
          }
          lastLook = inp.look;
          tut.looked += Math.abs(inp.look.dx) + Math.abs(inp.look.dy);
        }
        handle(inp.actions);
        callinInput(inp);
      }
      const sdt = dt * battle.timeScale;
      if (cam.mode !== 'free') updatePlayer(sdt, inp);
      battle.update(dt);
      if (player) tickOrders(battle, player);
      if (wheel.open && (!player?.alive || player.vehicle)) openWheel(false);
      if (cam.mode !== 'free') tutorialTick();
      cam.shake = Math.max(cam.shake, fx.shake);
      for (const e of battle.events) {
        if (e.type === 'boom') cam.shake = Math.min(1.2, cam.shake + Math.max(0, 1 - e.pos.distanceTo(player.pos) / (e.r * 5)));
        if (e.type === 'incoming') hud.say(`Incoming ${CALLINS[e.kind].name.toLowerCase()} · take cover`, 2.6);
        if (e.type === 'resupply') hud.say('Resupplied', 1.4);
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
    // recoil: the view takes the kick of each shot; once you stop firing it settles most of the way back
    {
      const kp = player.kickP, ky = player.kickY;
      player.kickP = player.kickY = 0;
      cam.pitch += kp * (1 - 0.2 * cam.ads); cam.yaw += ky;
      recoilDebt += kp;
      const idle = player.t - (player.lastShotT || -9) > 0.14;
      if (idle && recoilDebt > 0) {
        const back = Math.min(recoilDebt, Math.max(0.004, recoilDebt * 3) * dt * (player.weapon.def.rc?.rec ?? 1) * 2.4);
        cam.pitch -= back * 0.7; recoilDebt -= back;
      }
      if (!player.alive) recoilDebt = 0;
    }
    cam.adsZoom = (VIEW[player.weapon.id] || VIEW.rifle).zoom;
    if (cam.mode === 'free') spec.update(dt, battle, player, reduced);
    cam.update(dt, player, snap);
    snap = false;
    {
      const pv = player.vehicle, want = pv && cam.cockpit && player.alive && cam.mode !== 'over' && cam.mode !== 'free' ? pv : null;
      if (cockpitVeh && cockpitVeh !== want) cockpitVeh.setCockpit(false);
      if (want) { want.setCockpit(true); cockpit.show(want.def.cockpitKind, want.team); cockpit.update(want, camera.aspect); } else cockpit.hide();
      cockpitVeh = want;
    }
    const fpOn = cam.mode === '1p' && cam.blend > 0.6 && player.alive && !player.vehicle;
    // the "get in / get out" button
    {
      const show = state === 'play' && player.alive && !sandbox.open && cam.mode !== 'free' && (!!player.vehicle || !!nearestVehicle());
      if (useBtn.hidden === show) useBtn.hidden = !show;
      if (show) {
        const text = player.vehicle ? 'X · Leave' : input.touch ? '' : `X · Get in ${nearestVehicle().def.name}`;
        if (!input.touch && prompt.textContent !== text && tut.done) { prompt.textContent = text; prompt.classList.add('on'); vehPrompt = true; }
      } else if (vehPrompt) { vehPrompt = false; showStep(); }
    }
    if (fpOn) {
      vm.update(dt, camera, player, cam.ads, lastLook);
      player.muzzleOverride = vm.pose.muzzle;
    } else player.muzzleOverride = null;
    if (cam.mode !== 'free') updateAim();
    callinVisuals();
  }
  if (state === 'menu') for (const u of battle.units) u.animate(dt);
  if (state === 'play') {
    sup = Math.max(0, sup - dt * 0.3);
    if (player?.alive === false) sup = 0;
    if (!reduced && sup > 0.2) cam.shake = Math.max(cam.shake, sup * 0.35);
    const b = reduced ? 0 : Math.round(sup * sup * 12) / 2; // half-pixel steps so the filter isn't restyled every frame
    if (b !== suppBlur) { suppBlur = b; canvas.style.filter = b ? `blur(${b}px)` : ''; }
    suppEl.style.opacity = sup.toFixed(2);
  } else { sup = 0; if (suppBlur) { suppBlur = 0; canvas.style.filter = ''; suppEl.style.opacity = 0; } }
  audio.tick(dt, sup);
  if (state !== 'menu' && player) battleFeel(dt);
  audio.listener.x = camera.position.x; audio.listener.z = camera.position.z; audio.listener.yaw = state === 'menu' ? 0 : cam.yaw;
  // shadows follow what the camera is looking at
  const look = _look;
  if (state === 'menu') look.set(0, 0, 0);
  else if (cam.mode === 'over') look.set(cam.over.x, 0, cam.over.z);
  else if (cam.mode === 'free') look.copy(cam.fr).add(cam.forward(_fwd).setY(0).normalize().multiplyScalar(22)).setY(0);
  else look.copy(player.pos).add(cam.forward(_fwd).setY(0).multiplyScalar(12));
  atmo.update(dt, camera);
  setWetness(Math.min(1, atmo.w.rain));
  if (state !== 'menu') ambience.update(dt, camera, battle);
  updateEnv(performance.now() / 1000, atmo.hour, atmo.weather);
  SUN.copy(atmo.sunDir);
  if (Math.abs(atmo.sight - sightSet) > 0.02) { sightSet = atmo.sight; setSight(sightSet); }
  snapShadowBox(look);
  sun.position.copy(look).add(SUN);
  sun.target.position.copy(look);
  if (state !== 'menu' && player) {
    // free camera: the radar and compass work from the camera (or the soldier being followed)
    if (cam.mode === 'free') {
      const f = spec.unit, c = camera.position;
      hud.setView({ x: c.x, z: c.z, cx: f ? f.pos.x : c.x, cz: f ? f.pos.z : c.z, unit: f, target: spec.target });
    } else hud.setView(null);
    hud.update(dt, player, battle, cam);
    if (cam.mode === 'free') { hud.drawSpecMarks(battle, camera, player, spec); specUi(); }
    else if (cam.mode === 'over') hud.clearMarks();
    else hud.drawMarks(player, battle, camera);
  }
  if (skipDraw) return;
  drawUnits();
  updateGround(camera);
  sky.position.copy(camera.position); // the dome rides with the eye so no part falls past the far plane
  renderWorld();
}
renderer.setAnimationLoop(frame);

function endBattle() {
  state = 'end';
  const won = battle.result.winner === player.team;
  $('endTitle').textContent = won ? 'Victory' : battle.result.winner < 0 ? 'Draw' : 'Defeat';
  const mins = Math.floor(battle.time / 60), secs = Math.floor(battle.time % 60);
  $('endWhy').textContent = battle.result.why === 'points' ? 'Every point held' : battle.result.winner < 0 ? '' : 'Enemy out of tickets';
  $('endBoard').innerHTML = '<tr><th></th><th>Kills</th><th>Lost</th><th>Points</th><th>Left</th></tr>' + battle.teams.map((t) => `<tr${t.id === player.team ? ' class="me"' : ''}><td><i style="background:${TEAMS[t.id].ui}"></i>${TEAMS[t.id].short}</td><td>${t.kills}</td><td>${t.losses}</td><td>${t.caps}</td><td>${t.tickets + t.alive}</td></tr>`).join('');
  $('endStats').textContent = `${player.kills} kills · ${battle.stats.kills} fallen · ${mins}:${String(secs).padStart(2, '0')}`;
  $('end').hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

openMenu();
if (params.has('play')) startBattle({ mode: params.get('play') || 'battle' });

// Test hooks for the check suite.
window.__game = { maxSpeed: MAX_SPEED,
  THREE, scene, camera, renderer, cam, input, crowd, fx, SLOTS, U, pose, makePose, solveLegs, solveArms, HOLD, HALF, weaponModel,
  spec, height, get battle() { return battle; }, get player() { return player; }, get state() { return state; }, gov,
  sandbox, atmo, ambience, envNow: () => updateEnv(1e9, atmo.hour, atmo.weather, true), start: startBattle, openMenu, pause,
  freeze(on = true) { frozen = on; },
  // render one frame now (for screenshots while frozen)
  render() { drawUnits(); updateGround(camera); sky.position.copy(camera.position); renderWorld(); },
  view(pos, target) { cam.frozen = true; camera.position.set(...pos); camera.lookAt(...target); sun.position.set(target[0], 0, target[2]).add(SUN); sun.target.position.set(...target); },
  unfreezeCam() { cam.frozen = false; },
  // Deterministic fast-forward for the check suite: run n frames of fixed dt, independent of how
  // slow the headless renderer is. Held keys, queued taps and touches all keep working.
  // Only the last frame draws: queueing renders back to back starves the software GL process.
  step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) { skipDraw = i < n - 1; frame(0, dt); } skipDraw = false; },
  // Step until fn() is true (checked each frame); returns whether it got there within max frames.
  until(fn, max = 900, dt = 1 / 30) { let ok = fn(); for (let i = 0; i < max && !ok; i++) { skipDraw = true; frame(0, dt); ok = fn(); } skipDraw = false; frame(0, dt); return ok || fn(); },
};

// Phones: no pinch or double-tap zoom anywhere in the game (iOS ignores the viewport flag).
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
{
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    if (now - lastTap < 320 && !e.target.closest('input, select, textarea, button, label, a, [data-t], .pal-grid')) e.preventDefault();
    lastTap = now;
  }, { passive: false });
}
