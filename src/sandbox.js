import * as THREE from 'three';
import { KINDS, SQUADS } from './game.js';
import { PROPS, propModel } from './props.js';
import { VEHICLES, Vehicle, spawnVehicle } from './vehicles.js';
import { TEAMS } from './factions.js';
import { Soldier } from './soldier.js';

// Sandbox panel: spawn peas (any army), vehicles and cover; move, delete, freeze the AI,
// change game speed, god mode, clear the plate. Plain buttons, one word each.
const CATALOG = {
  units: [...Object.entries(KINDS).map(([id, k]) => ({ id, name: k.name, kind: 'unit' })), { id: 'squad', name: 'Squad', kind: 'squad' }],
  vehicles: Object.entries(VEHICLES).map(([id, v]) => ({ id, name: v.name.split(' ').pop(), kind: 'vehicle' })),
  props: Object.entries(PROPS).map(([id, p]) => ({ id, name: p.name.split(' ').pop(), kind: 'prop' })),
};
const SPEEDS = [1, 0.5, 0.25, 2];

export class Sandbox {
  constructor({ world, input, camera, cam, scene, audio, onToggle }) {
    Object.assign(this, { world, input, camera, cam, scene, audio, onToggle });
    this.open = false;
    this.tab = 'units';
    this.team = 1;
    this.item = CATALOG.units[0];
    this.tool = 'spawn';
    this.held = null;
    this.speedI = 0;
    this.thumbs = new Map();
    this.el = document.getElementById('panel');
    this.grid = document.getElementById('catalog');
    this.btn = document.getElementById('sandbox');
    this.btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.btn.addEventListener('click', () => { this.btn.blur(); this.toggle(); });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => this.click(e));
    // ground marker under the cursor
    const g = new THREE.RingGeometry(0.42, 0.5, 40);
    g.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#1e1f1d', transparent: true, opacity: 0.6, depthWrite: false }));
    this.marker.visible = false;
    this.marker.renderOrder = 4;
    scene.add(this.marker);
    input.onWorldClick = (x, y, button) => this.worldClick(x, y, button);
    input.onWorldHover = (x, y) => this.hover(x, y);
    this.render();
  }

  toggle(on = !this.open) {
    this.open = on;
    this.el.hidden = !on;
    this.input.mode = on ? 'build' : 'play';
    document.documentElement.dataset.mode = on ? 'build' : 'play';
    if (on && document.pointerLockElement) document.exitPointerLock();
    if (!on) { this.marker.visible = false; this.drop(); }
    this.btn.setAttribute('aria-pressed', String(on));
    this.onToggle?.(on);
    if (on) this.makeThumbs();
  }

  render() {
    const t = (id, label, on, extra = '') => `<button type="button" data-tool="${id}" class="tool${on ? ' on' : ''}" ${extra}>${label}</button>`;
    const w = this.world;
    document.getElementById('tools').innerHTML = [
      t('spawn', 'Spawn', this.tool === 'spawn'),
      t('move', 'Move', this.tool === 'move'),
      t('delete', 'Delete', this.tool === 'delete'),
      '<span class="sep"></span>',
      t('freeze', w.aiFrozen ? 'Frozen' : 'Freeze', w.aiFrozen, 'aria-pressed="' + w.aiFrozen + '"'),
      t('speed', `×${SPEEDS[this.speedI]}`, SPEEDS[this.speedI] !== 1),
      t('god', 'God', w.god, 'aria-pressed="' + w.god + '"'),
      t('clear', this.confirm ? 'Sure?' : 'Clear', !!this.confirm),
    ].join('');
    document.getElementById('tabs').innerHTML = ['units', 'vehicles', 'props'].map((id) => `<button type="button" data-tab="${id}" class="tab${this.tab === id ? ' on' : ''}">${id[0].toUpperCase() + id.slice(1)}</button>`).join('')
      + '<span class="sep"></span>'
      + TEAMS.map((tm, i) => `<button type="button" data-team="${i}" class="swatch${this.team === i ? ' on' : ''}" style="--c:${tm.ui}" aria-label="${tm.name}" title="${tm.name}"></button>`).join('');
    this.grid.innerHTML = CATALOG[this.tab].map((it) => {
      const k = this.thumbKey(it);
      const src = this.thumbs.get(k);
      return `<button type="button" class="item${this.item === it && this.tool === 'spawn' ? ' on' : ''}" data-item="${it.id}">${src ? `<img alt="" src="${src}">` : '<span class="ph"></span>'}<span>${it.name}</span></button>`;
    }).join('');
  }

  click(e) {
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    const w = this.world;
    if (b.dataset.tab) { this.tab = b.dataset.tab; this.item = CATALOG[this.tab][0]; this.tool = 'spawn'; this.makeThumbs(); }
    else if (b.dataset.team) { this.team = +b.dataset.team; this.makeThumbs(); }
    else if (b.dataset.item) { this.item = CATALOG[this.tab].find((x) => x.id === b.dataset.item); this.tool = 'spawn'; }
    else if (b.dataset.tool) {
      const t = b.dataset.tool;
      if (t === 'spawn' || t === 'move' || t === 'delete') { this.tool = t; this.drop(); }
      else if (t === 'freeze') w.aiFrozen = !w.aiFrozen;
      else if (t === 'speed') { this.speedI = (this.speedI + 1) % SPEEDS.length; w.timeScale = SPEEDS[this.speedI]; }
      else if (t === 'god') { w.god = !w.god; if (w.player) w.player.hp = w.player.maxHp; }
      else if (t === 'clear') {
        if (this.confirm) { clearTimeout(this.confirm); this.confirm = null; this.drop(); w.clearAll(); }
        else this.confirm = setTimeout(() => { this.confirm = null; this.render(); }, 2500);
      }
      if (t !== 'clear' && this.confirm) { clearTimeout(this.confirm); this.confirm = null; }
    }
    this.audio.play('clink', null, 0.4);
    this.render();
  }

  // screen point -> world hit
  pick(x, y) {
    const r = this.camera.position.clone();
    const ndc = new THREE.Vector3((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, 0.5).unproject(this.camera);
    const d = ndc.sub(r).normalize();
    return this.world.raycast(r, d, 200, { ignore: this.held?.unit || null });
  }

  hover(x, y) {
    const h = this.pick(x, y);
    const ok = h.hit && Math.abs(h.point.x) < 24 && Math.abs(h.point.z) < 24;
    this.marker.visible = ok;
    if (ok) this.marker.position.set(h.point.x, 0.02, h.point.z);
    if (this.held && ok) this.place(this.held, h.point, false);
  }

  worldClick(x, y) {
    if (!this.open) return;
    const w = this.world;
    const h = this.pick(x, y);
    if (!h.hit) return;
    const p = h.point.clone().setY(0);
    if (Math.abs(p.x) > 23.6 || Math.abs(p.z) > 23.6) return;
    const yaw = this.cam.yaw;
    if (this.tool === 'spawn') {
      const it = this.item;
      if (it.kind === 'unit') w.spawnUnit(this.team, it.id, p, { yaw: yaw + Math.PI });
      else if (it.kind === 'squad') w.spawnSquad(this.team, p, SQUADS[this.team], yaw + Math.PI);
      else if (it.kind === 'vehicle') spawnVehicle(w, it.id, this.team, p, yaw + Math.PI, this.team !== 0);
      else if (it.kind === 'prop') w.spawnProp(it.id, p.x, p.z, yaw);
      this.audio.play('clank', p, 0.5);
    } else if (this.tool === 'delete') {
      if (h.unit && h.unit !== w.player) w.removeUnit(h.unit);
      else if (h.vehicle) { if (h.vehicle.driver === w.player) h.vehicle.eject(w.player, w); w.removeVehicle(h.vehicle); }
      else if (h.prop) w.removeProp(h.prop);
      else return;
      this.audio.play('clank', p, 0.5);
    } else if (this.tool === 'move') {
      if (this.held) { this.place(this.held, p, true); this.drop(); }
      else if (h.unit) this.held = { unit: h.unit };
      else if (h.vehicle) this.held = { vehicle: h.vehicle };
      else if (h.prop) this.held = { prop: h.prop };
    }
    this.marker.position.set(p.x, 0.02, p.z);
  }

  place(held, p, final) {
    const w = this.world;
    if (held.unit) {
      const u = held.unit;
      u.pos.set(p.x, w.groundAt(p.x, p.z, 5), p.z);
      u.vel.set(0, 0, 0);
      u.holdPos = u.pos.clone();
      u.homePos = u.pos.clone();
      if (u.brain) { u.brain.releaseCover(); u.brain.goal.copy(u.pos); }
      u.pea.position.copy(u.pos);
    } else if (held.vehicle) {
      held.vehicle.pos.set(p.x, 0, p.z);
      held.vehicle.speed = 0;
      held.vehicle.vel?.set(0, 0, 0);
      held.vehicle.holdPos = held.vehicle.pos.clone();
      held.vehicle.pose(0);
    } else if (held.prop) w.moveProp(held.prop, p.x, p.z);
    if (final) this.audio.play('clank', p, 0.4);
  }

  drop() { this.held = null; }

  thumbKey(it) { return it.kind === 'prop' ? `p:${it.id}` : `${it.kind}:${it.id}:${this.team}`; }

  // small renders of each catalogue entry, made once on first open
  makeThumbs() {
    const todo = CATALOG[this.tab].filter((it) => !this.thumbs.has(this.thumbKey(it)));
    if (!todo.length) return this.render();
    if (!this.tr) {
      this.tc = document.createElement('canvas');
      this.tc.width = this.tc.height = 128;
      try { this.tr = new THREE.WebGLRenderer({ canvas: this.tc, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return; }
      this.tr.toneMapping = THREE.ACESFilmicToneMapping;
      this.ts = new THREE.Scene();
      this.ts.add(new THREE.HemisphereLight('#e4e7e8', '#6d6e68', 1.6));
      const d = new THREE.DirectionalLight('#ffffff', 2.2);
      d.position.set(3, 5, 4);
      this.ts.add(d);
      this.tcam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    }
    // one thumbnail per frame so opening the panel never stalls input
    const gen = (this.thumbGen = (this.thumbGen || 0) + 1);
    this.render();
    const next = () => {
      if (gen !== this.thumbGen) return;
      const it = todo.shift();
      if (!it) return;
      if (!this.thumbs.has(this.thumbKey(it))) this.thumbOne(it);
      this.render();
      if (todo.length) setTimeout(next, 30);
    };
    setTimeout(next, 30);
  }

  thumbOne(it) {
    {
      let obj, size;
      if (it.kind === 'unit' || it.kind === 'squad') {
        const kinds = it.kind === 'squad' ? KINDS.gunner : KINDS[it.id];
        const s = new Soldier({ team: this.team, lod: 0.5, loadout: kinds.loadout, drop: false });
        s.facing = 1.1;
        s.animate(0);
        obj = s.pea;
        size = 0.95;
      } else if (it.kind === 'vehicle') {
        const v = new Vehicle(this.world, it.id, this.team, new THREE.Vector3(900, 0, 900), 0.7);
        obj = v.group;
        obj.position.set(0, 0, 0);
        size = it.id === 'walker' ? 3.3 : 3.6;
      } else {
        obj = propModel(it.id);
        obj.rotation.y = 0.5;
        size = Math.max(PROPS[it.id].hx * 2, PROPS[it.id].h) * 1.3 + 0.4;
      }
      this.ts.add(obj);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const c = box.getCenter(new THREE.Vector3());
      const dist = size * 1.9;
      this.tcam.position.set(c.x + dist * 0.55, c.y + dist * 0.45, c.z + dist * 0.75);
      this.tcam.lookAt(c);
      this.tr.render(this.ts, this.tcam);
      this.thumbs.set(this.thumbKey(it), this.tc.toDataURL('image/png'));
      this.ts.remove(obj);
    }
  }
}
