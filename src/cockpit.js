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
