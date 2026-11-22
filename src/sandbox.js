import * as THREE from 'three';
import { KINDS, SQUAD_MIX } from './battle.js';
import { PROPS, propModel } from './props.js';
import { TEAMS } from './factions.js';

// Sandbox palette: pick a tool straight from the grid, then click (or tap) the field.
// Opening it switches to the overview camera; drag pans, wheel zooms, right-drag turns.
const ICON = {
  unit: '<rect x="8" y="4" width="8" height="14" rx="2.5"/><path d="M9.5 8h5M8 21h3M13 21h3"/>',
  squad: '<rect x="3" y="7" width="5" height="10" rx="1.6"/><rect x="9.5" y="5" width="5" height="12" rx="1.6"/><rect x="16" y="7" width="5" height="10" rx="1.6"/>',
  platoon: '<rect x="3" y="3" width="4" height="7" rx="1.2"/><rect x="10" y="3" width="4" height="7" rx="1.2"/><rect x="17" y="3" width="4" height="7" rx="1.2"/><rect x="3" y="14" width="4" height="7" rx="1.2"/><rect x="10" y="14" width="4" height="7" rx="1.2"/><rect x="17" y="14" width="4" height="7" rx="1.2"/>',
  sandbags: '<path d="M3 18h18M4 18v-3h5v3M9.5 18v-3h5v3M15 18v-3h5v3M6.5 15v-3h5v3M12.5 15v-3h5v3"/>',
  crate: '<rect x="4" y="7" width="16" height="12"/><path d="M4 11h16M4 15h16"/>',
  barrier: '<path d="M3 19h18l-3-3-1-8H7l-1 8z"/>',
  drum: '<rect x="7" y="4" width="10" height="16" rx="1.5"/><path d="M7 9h10M7 15h10"/>',
  wall: '<rect x="3" y="5" width="18" height="14"/><path d="M8 5v14M16 5v14"/>',
  trap: '<path d="M4 19L20 7M4 7l16 12M12 4v16"/>',
  slab: '<path d="M3 20V8l3-2 2 2 3-3 2 3 3-2 2 2 3-1v13z"/>',
  bunker: '<path d="M3 19V9h18v10zM6 12h4M14 12h4M2 9h20"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  delete: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  command: '<path d="M6 21V4M6 4h11l-3 4 3 4H6"/>',
};
const UNIT_ITEMS = [...Object.entries(KINDS).map(([k, v]) => ({ id: k, name: v.name, icon: 'unit', kind: 'unit' })),
  { id: 'squad', name: 'Squad ×6', icon: 'squad', kind: 'group', n: 6 }, { id: 'platoon', name: 'Platoon ×24', icon: 'platoon', kind: 'group', n: 24 }];
const COVER_ITEMS = Object.entries(PROPS).map(([k, v]) => ({ id: k, name: v.name, icon: k, kind: 'prop' }));
const TOOL_ITEMS = [
  { id: 'move', name: 'Move', icon: 'move', kind: 'tool', hint: 'Click a soldier or cover, then click where it goes.' },
  { id: 'delete', name: 'Delete', icon: 'delete', kind: 'tool', hint: 'Click soldiers or cover to remove them.' },
  { id: 'command', name: 'Command', icon: 'command', kind: 'tool', hint: 'Click a soldier to pick their squad, then click to send it there.' },
];
const TABS = [['units', 'Units', UNIT_ITEMS], ['cover', 'Cover', COVER_ITEMS], ['tools', 'Tools', TOOL_ITEMS]];

export class Sandbox {
  constructor({ getBattle, input, cam, camera, scene, audio, onToggle }) {
    Object.assign(this, { getBattle, input, cam, camera, scene, audio, onToggle });
    this.el = document.getElementById('palette');
    this.tabsEl = document.getElementById('palTabs');
    this.teamsEl = document.getElementById('palTeams');
    this.gridEl = document.getElementById('palGrid');
    this.hintEl = document.getElementById('palHint');
    this.togglesEl = document.getElementById('palToggles');
    this.open = false;
    this.tab = 'units';
    this.tool = null; // item
    this.team = 1;
    this.yaw = 0;
    this.picked = null; // move/command: chosen thing
    this.ray = new THREE.Raycaster();
    this.ghost = null;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    scene.add(this.ring);
    this.build();
    document.getElementById('palClose').addEventListener('click', () => this.toggle(false));
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.onWorldClick = (x, y, button) => this.click(x, y, button);
    input.onWorldHover = (x, y) => this.hover(x, y);
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape') { if (this.tool) this.select(null); else this.toggle(false); }
      if (e.code === 'KeyR') { this.yaw += Math.PI / 4; if (this.ghost) this.ghost.rotation.y = this.yaw; }
    });
  }

  build() {
    this.tabsEl.innerHTML = TABS.map(([id, name]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === this.tab}">${name}</button>`).join('');
    this.tabsEl.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { this.tab = b.dataset.tab; this.select(null); this.build(); } };
    const teams = this.getBattle().teams.length || 2;
    this.team = Math.min(this.team, teams - 1);
    this.teamsEl.hidden = this.tab === 'cover';
    this.teamsEl.innerHTML = TEAMS.slice(0, teams).map((t) => `<button type="button" data-team="${t.id}" aria-pressed="${t.id === this.team}"><i style="background:${t.ui}"></i>${t.short}</button>`).join('');
    this.teamsEl.onclick = (e) => { const b = e.target.closest('[data-team]'); if (b) { this.team = +b.dataset.team; this.build(); } };
    const items = TABS.find((t) => t[0] === this.tab)[2];
    this.gridEl.innerHTML = items.map((it) => `<button type="button" class="pal-item" role="option" data-id="${it.id}" aria-selected="${this.tool?.id === it.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[it.icon]}</svg>${it.name}</button>`).join('');
    this.gridEl.onclick = (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const it = items.find((x) => x.id === b.dataset.id);
      this.select(this.tool?.id === it.id ? null : it);
    };
    this.buildToggles();
    this.updateHint();
  }

  buildToggles() {
    const b = this.getBattle();
    const T = [
      ['freeze', 'Pause AI', b.aiFrozen], ['slow', 'Slow motion', b.timeScale < 1], ['god', 'God mode', b.god],
      ...(b.settings.mode === 'battle' ? [['reinforce', 'Reinforcements', b.reinforce]] : []),
      ['clearUnits', 'Clear soldiers', null], ['clearCover', 'Clear cover', null],
    ];
    this.togglesEl.innerHTML = T.map(([id, name, on]) => `<button type="button" data-t="${id}" ${on === null ? 'class="act"' : `aria-pressed="${!!on}"`}>${name}</button>`).join('');
    this.togglesEl.onclick = (e) => { const el = e.target.closest('[data-t]'); if (el) this.toggleWorld(el.dataset.t); };
  }

  toggleWorld(id) {
    const b = this.getBattle();
    if (id === 'freeze') b.aiFrozen = !b.aiFrozen;
    else if (id === 'slow') b.timeScale = b.timeScale < 1 ? 1 : 0.3;
    else if (id === 'god') b.god = !b.god;
    else if (id === 'reinforce') b.reinforce = !b.reinforce;
    else if (id === 'clearUnits') b.clearUnits();
    else if (id === 'clearCover') { for (const p of [...b.props]) b.removeProp(p); }
    this.audio.play('clink', null, 0.5);
    this.buildToggles();
  }

  select(it) {
    this.tool = it;
    this.picked = null;
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (it?.kind === 'prop') {
      this.ghost = propModel(it.id);
      this.ghost.traverse((o) => {
        if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.45; o.material.depthWrite = false; o.castShadow = false; }
      });
      this.ghost.rotation.y = this.yaw;
      this.ghost.visible = false;
      this.scene.add(this.ghost);
    }
    this.ring.visible = false;
    for (const b of this.gridEl.children) b.setAttribute('aria-selected', String(b.dataset.id === it?.id));
    this.updateHint();
  }

  updateHint() {
    const it = this.tool;
    const touch = this.input.touch;
    let h = touch ? 'Pick a tool, then tap the field. Drag to pan.' : 'Pick a tool, then click the field. Drag to pan, wheel to zoom, right-drag to turn.';
    if (it?.kind === 'unit' || it?.kind === 'group') h = `${touch ? 'Tap' : 'Click'} to place ${it.name.toLowerCase()} for ${TEAMS[this.team].name}.`;
    else if (it?.kind === 'prop') h = `${touch ? 'Tap' : 'Click'} to place. ${touch ? '' : 'R turns it.'}`;
    else if (it?.hint) h = this.picked ? `${touch ? 'Tap' : 'Click'} where it goes.` : it.hint;
    this.hintEl.textContent = h;
  }

  toggle(on = !this.open) {
    if (on === this.open) return;
    this.open = on;
    this.el.hidden = !on;
    document.documentElement.dataset.palette = on ? 'open' : 'closed';
    this.input.mode = on ? 'build' : 'play';
    this.cam.setMode(on ? 'over' : this.cam.prevMode || '3p');
    document.documentElement.dataset.view = this.cam.mode;
    if (on) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.build();
    } else {
      this.select(null);
      this.ring.visible = false;
    }
    this.onToggle?.(on);
  }

  // screen point to the field
  pick(x, y) {
    const b = this.getBattle();
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    return b.raycast(o, d, 400);
  }

  hover(x, y) {
    if (!this.open || !this.tool) return;
    const h = this.pick(x, y);
    if (!h.hit) return;
    const p = h.point;
    if (this.ghost) { this.ghost.visible = true; this.ghost.position.set(p.x, p.y, p.z); this.ghost.rotation.y = this.yaw; }
    else { this.ring.visible = true; this.ring.position.set(p.x, p.y + 0.05, p.z); }
  }

  click(x, y, button = 0) {
    if (!this.open) return;
    if (button === 2) { this.select(null); return; }
    const it = this.tool;
    if (!it) return;
    const b = this.getBattle();
    const h = this.pick(x, y);
    if (!h.hit) return;
    const p = h.point.clone().setY(0);
    const face = Math.atan2(-p.x, -p.z);
    if (it.kind === 'unit') {
      b.spawnUnit(this.team, it.id, p, { yaw: face });
    } else if (it.kind === 'group') {
      const mix = SQUAD_MIX[this.team];
      const rows = Math.ceil(it.n / 6);
      for (let r = 0; r < rows; r++) {
        const at = p.clone().add(new THREE.Vector3(Math.sin(face + Math.PI / 2) * (r - (rows - 1) / 2) * 7, 0, Math.cos(face + Math.PI / 2) * (r - (rows - 1) / 2) * 7));
        b.spawnSquad(this.team, at, Array.from({ length: Math.min(6, it.n - r * 6) }, (_, i) => mix[(i + r) % mix.length]), face);
      }
    } else if (it.kind === 'prop') {
      b.spawnProp(it.id, p.x, p.z, this.yaw);
    } else if (it.id === 'delete') {
      if (h.unit && h.unit !== b.player) b.removeUnit(h.unit);
      else if (h.prop && !h.prop.def.fixed) b.removeProp(h.prop);
      else {
        // nearest soldier to the click, within a couple of metres
        const near = b.nearUnits(p.x, p.z, 2).filter((u) => u.alive && u !== b.player);
        if (near[0]) b.removeUnit(near[0]);
      }
    } else if (it.id === 'move') {
      if (!this.picked) {
        const near = h.unit || b.nearUnits(p.x, p.z, 2).find((u) => u.alive);
        this.picked = near ? { unit: near } : h.prop && !h.prop.def.fixed ? { prop: h.prop } : null;
      } else {
        if (this.picked.unit) { this.picked.unit.pos.copy(p); this.picked.unit.vel.set(0, 0, 0); }
        else if (this.picked.prop?.alive) b.moveProp(this.picked.prop, p.x, p.z);
        this.picked = null;
      }
    } else if (it.id === 'command') {
      if (!this.picked) {
        const u = h.unit || b.nearUnits(p.x, p.z, 2.5).find((m) => m.alive && m.squad);
        if (u?.squad) this.picked = { squad: u.squad };
      } else {
        const sq = this.picked.squad;
        sq.manual = true;
        sq.order = p.clone();
        sq.objective = null;
        sq.waypoint = null;
        sq.retreating = false;
        this.picked = null;
      }
    }
    this.audio.play('clink', null, 0.4);
    this.updateHint();
  }
}
