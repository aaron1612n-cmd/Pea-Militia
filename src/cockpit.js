import * as THREE from 'three';
import { TEAMS } from './factions.js';

// First-person cockpit frames. Each is a flat, camera-attached overlay on the z = -1 plane:
// the dark armour, pillars and dash that frame the view, drawn on top of the world so they
// never poke through terrain. Colours: dark steel plus the team's trim as the one accent.

const DARK = '#1f2221', STEEL = '#3b3e3d', IRON = '#4a4a45', BRASS = '#9c7a3c', LEATHER = '#3a2c22';
const BIG = 4;

function mat(color) {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
}

class Kit {
  constructor() { this.g = new THREE.Group(); this.n = 0; this.mats = new Map(); }
  m(c) { if (!this.mats.has(c)) this.mats.set(c, mat(c)); return this.mats.get(c); }
  // polygon in screen-plane units (x right, y up)
  poly(pts, color) {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const o = new THREE.Mesh(new THREE.ShapeGeometry(s), this.m(color));
    o.position.z = -1; o.renderOrder = 900 + this.n++; o.frustumCulled = false;
    this.g.add(o);
    return o;
  }
  rect(x0, y0, x1, y1, color) { return this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], color); }
  disc(cx, cy, r, color, seg = 20) {
    const o = new THREE.Mesh(new THREE.CircleGeometry(r, seg), this.m(color));
    o.position.set(cx, cy, -1); o.renderOrder = 900 + this.n++; o.frustumCulled = false;
    this.g.add(o);
    return o;
  }
  ring(cx, cy, r, w, color) {
    const o = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 28), this.m(color));
    o.position.set(cx, cy, -1); o.renderOrder = 900 + this.n++; o.frustumCulled = false;
    this.g.add(o);
    return o;
  }
}

const BUILDERS = {
  // armoured slit: a thick letterbox with a brass lip, rivets and gauges on the lower plate
  tank(k, accent) {
    const top = 0.46, bot = -0.3, hw = 1.15;
    k.rect(-BIG, top, BIG, BIG, DARK);
    k.rect(-BIG, -BIG, BIG, bot, DARK);
    k.rect(-BIG, bot, -hw, top, DARK);
    k.rect(hw, bot, BIG, top, DARK);
    k.rect(-hw, top - 0.02, hw, top, BRASS);
    k.rect(-hw, bot, hw, bot + 0.02, BRASS);
    k.rect(-BIG, bot - 0.5, BIG, bot - 0.02, STEEL);
    for (let i = -10; i <= 10; i++) { k.disc(i * 0.13, top + 0.06, 0.012, IRON, 8); k.disc(i * 0.13, bot - 0.06, 0.012, IRON, 8); }
    k.rect(-0.04, bot - 0.5, 0.04, bot - 0.02, DARK);
    for (const [x, y, r] of [[-0.55, -0.62, 0.07], [-0.35, -0.62, 0.05], [0.4, -0.62, 0.07], [0.6, -0.62, 0.05]]) { k.disc(x, y, r + 0.012, BRASS); k.disc(x, y, r, '#d8d2b8'); k.rect(x - 0.004, y, x + 0.004, y + r * 0.8, DARK); }
    k.rect(-hw - 0.01, bot, -hw + 0.03, top, accent);
    k.rect(hw - 0.03, bot, hw + 0.01, top, accent);
  },
  // open car: a windscreen frame, bonnet, dash, mirror and a steering wheel that turns
  jeep(k, accent) {
    k.rect(-BIG, 0.5, BIG, BIG, DARK);
    k.rect(-BIG, 0.42, BIG, 0.5, STEEL);
    k.poly([[-BIG, 0.5], [-1.0, 0.5], [-0.8, -0.16], [-BIG, -0.16]], DARK);
    k.poly([[BIG, 0.5], [1.0, 0.5], [0.8, -0.16], [BIG, -0.16]], DARK);
    k.poly([[-0.84, -0.16], [0.84, -0.16], [0.48, -0.5], [-0.48, -0.5]], accent); // bonnet
    k.rect(-0.12, -0.5, 0.12, -0.18, DARK); // bonnet rib
    k.rect(-BIG, -BIG, BIG, -0.5, DARK);
    k.rect(-BIG, -0.64, BIG, -0.5, STEEL);
    k.rect(-0.12, 0.3, 0.12, 0.42, DARK); // mirror
    k.rect(-0.1, 0.32, 0.1, 0.4, '#8fa3a0');
    for (const [x, y] of [[0.3, -0.58], [0.5, -0.58], [0.7, -0.58]]) { k.disc(x, y, 0.045, BRASS); k.disc(x, y, 0.035, '#d8d2b8'); }
    const wheel = new THREE.Group(); wheel.position.set(-0.3, -0.72, 0);
    const o = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 28), k.m(DARK));
    o.position.z = -1; o.renderOrder = 960; o.frustumCulled = false; o.scale.y = 0.55;
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.05), k.m(DARK)); sp.position.z = -1; sp.renderOrder = 961; sp.scale.y = 0.55;
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), k.m(BRASS)); hub.position.z = -1; hub.renderOrder = 962;
    wheel.add(o, sp, hub);
    k.g.add(wheel);
    k.steer = wheel;
  },
  // glass bubble: a thin arched frame, a low cowl, twin lever grips
  hover(k, accent) {
    k.rect(-BIG, 0.62, BIG, BIG, DARK);
    k.poly([[-BIG, 0.62], [-0.9, 0.62], [-1.05, -0.05], [-BIG, -0.05]], DARK);
    k.poly([[BIG, 0.62], [0.9, 0.62], [1.05, -0.05], [BIG, -0.05]], DARK);
    k.rect(-0.9, 0.6, 0.9, 0.64, accent);
    k.rect(-0.03, 0.3, 0.03, 0.62, STEEL); // centre brace
    k.poly([[-1.05, -0.05], [-0.9, -0.05], [-0.7, -0.3], [-BIG, -0.3], [-BIG, -0.05]], DARK);
    k.poly([[1.05, -0.05], [0.9, -0.05], [0.7, -0.3], [BIG, -0.3], [BIG, -0.05]], DARK);
    k.rect(-BIG, -BIG, BIG, -0.46, DARK);
    k.poly([[-1.2, -0.46], [-0.5, -0.3], [0.5, -0.3], [1.2, -0.46]], STEEL);
    k.rect(-0.7, -0.32, 0.7, -0.3, accent);
    for (const s of [-1, 1]) { k.rect(s * 0.42 - 0.018, -0.7, s * 0.42 + 0.018, -0.44, IRON); k.disc(s * 0.42, -0.42, 0.045, BRASS); }
    k.ring(0, -0.58, 0.1, 0.014, BRASS); k.disc(0, -0.58, 0.085, '#1a3a38');
  },
  // tall canopy with heavy ribs and a console
  walker(k, accent) {
    k.rect(-BIG, 0.46, BIG, BIG, DARK);
    k.rect(-BIG, -BIG, BIG, -0.4, DARK);
    k.rect(-BIG, -0.52, BIG, -0.4, STEEL);
    for (const x of [-1.05, -0.5, 0.5, 1.05]) k.poly([[x - 0.035, -0.4], [x + 0.035, -0.4], [x * 0.85 + 0.03, 0.46], [x * 0.85 - 0.03, 0.46]], x === -0.5 || x === 0.5 ? IRON : DARK);
    k.poly([[-BIG, -0.4], [-1.18, -0.4], [-1.0, 0.46], [-BIG, 0.46]], DARK);
    k.poly([[BIG, -0.4], [1.18, -0.4], [1.0, 0.46], [BIG, 0.46]], DARK);
    k.rect(-1.0, 0.44, 1.0, 0.48, accent);
    k.rect(-1.1, -0.44, 1.1, -0.4, BRASS);
    k.ring(0.7, -0.66, 0.12, 0.016, BRASS); k.disc(0.7, -0.66, 0.1, '#1a3a38');
    k.ring(-0.7, -0.66, 0.09, 0.016, BRASS); k.disc(-0.7, -0.66, 0.07, '#d8d2b8');
  },
};

export class Cockpit {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.visible = false;
    camera.add(this.root);
    this.cache = new Map();
    this.cur = null;
    this.key = '';
  }
  show(kind, team) {
    const key = `${kind}${team}`;
    if (this.key === key && this.cur) { this.root.visible = true; return; }
    this.hide();
    if (!this.cache.has(key)) {
      const k = new Kit();
      BUILDERS[kind](k, TEAMS[team]?.trim || '#c58a3a');
      this.cache.set(key, k);
    }
    this.cur = this.cache.get(key); this.key = key;
    this.root.add(this.cur.g);
    this.root.visible = true;
  }
  hide() {
    if (this.cur) this.root.remove(this.cur.g);
    this.cur = null; this.key = '';
    this.root.visible = false;
  }
  update(v, aspect) {
    if (!this.cur) return;
    this.root.scale.x = THREE.MathUtils.clamp(aspect / 1.78, 0.38, 1.3);
    if (this.cur.steer) this.cur.steer.rotation.z = -(v.ctrl.steer || 0) * 1.4;
  }
}
