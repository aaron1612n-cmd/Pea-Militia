import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { U, setWeaponBounds, solveLegs } from './rig.js';
import { GEAR, MARKS, KIND_IDS, kindKey, LIMB_GEO } from './gear.js';
import { WEAPONS, weaponParts } from './weapons.js';
import { TEAMS } from './factions.js';

// Draws every soldier with a handful of instanced meshes (one per body part and per weapon
// material), so a few hundred units cost a few dozen draw calls.
const std = (o) => new THREE.MeshStandardMaterial(o);
export const PART_GEO = {
  body: new RoundedBoxGeometry(U.W, U.H, U.D, 4, U.R),
  visor: new RoundedBoxGeometry(...U.VISOR, 3, 0.03),
  pack: new RoundedBoxGeometry(...U.PACK, 3, 0.04),
  foot: new RoundedBoxGeometry(...U.FOOT, 3, 0.035),
  hand: new RoundedBoxGeometry(...U.HAND, 3, 0.04),
};
// the foot's sole sits at its local origin's -half height; nothing to shift

const WQ = new THREE.Quaternion();
const UI_COL = TEAMS.map((t) => new THREE.Color(t.ui));
const TROUSER = TEAMS.map((t) => new THREE.Color(t.trim).multiplyScalar(1.15));
const WOUND = new THREE.Color('#5a1212');
const BODY_COL = TEAMS.map((t) => new THREE.Color(t.body));
const TRIM_COL = TEAMS.map((t) => new THREE.Color(t.trim));
const PACK_COL = TEAMS.map((t) => new THREE.Color(t.body).multiplyScalar(0.62));
const DARK = new THREE.Color('#1d2126');

export class Crowd {
  constructor(scene, cap = 600) {
    this.cap = cap;
    this.scene = scene;
    const mk = (geo, mat, n, colored) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.frustumCulled = false; // instances are spread over the whole map
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      scene.add(m);
      return m;
    };
    this.body = mk(PART_GEO.body, std({ color: '#ffffff', roughness: 0.5, metalness: 0.12 }), cap, true);
    this.visor = mk(PART_GEO.visor, std({ color: '#15191d', roughness: 0.18, metalness: 0.6, emissive: '#0d1013' }), cap, false);
    this.pack = mk(PART_GEO.pack, std({ color: '#ffffff', roughness: 0.7, metalness: 0.1 }), cap, true);
    this.foot = mk(PART_GEO.foot, std({ color: '#ffffff', roughness: 0.75, metalness: 0.05 }), cap * 2, true);
    this.hand = mk(PART_GEO.hand, std({ color: '#ffffff', roughness: 0.7, metalness: 0.05 }), cap * 2, true);
    // class kit (instance colour = army accent), fixed-colour marks, and the legs
    const gearMat = std({ color: '#ffffff', roughness: 0.65, metalness: 0.1, vertexColors: true });
    const markMat = std({ color: '#ffffff', roughness: 0.5, metalness: 0.05, vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.18 });
    this.gear = {}; this.marks = {}; this.gn = {}; this.mn = {};
    for (const k of KIND_IDS) {
      this.gear[k] = mk(GEAR[k], gearMat, cap, true); this.gear[k].name = `crowd-gear-${k}`;
      if (MARKS[k]) { this.marks[k] = mk(MARKS[k], markMat, cap, false); this.marks[k].name = `crowd-mark-${k}`; }
    }
    this.leg = mk(LIMB_GEO.leg, std({ color: '#ffffff', roughness: 0.8, metalness: 0.03 }), cap * 4, true);
    this.nl = 0;
    this.visor.name = 'crowd-visor'; this.body.name = 'crowd-body';
    // weapons: one instanced mesh per (weapon, material)
    this.weapons = {};
    for (const id of Object.keys(WEAPONS)) {
      const { parts, muzzle, box, sight } = weaponParts(id);
      setWeaponBounds(id, box, muzzle, sight);
      const sc = new THREE.Matrix4().makeScale(U.WEAPON_SCALE, U.WEAPON_SCALE, U.WEAPON_SCALE);
      this.weapons[id] = parts.map(({ geometry, material }) => {
        const g = geometry.clone().applyMatrix4(sc);
        const m = mk(g, material, cap, false);
        m.name = `crowd-${id}`;
        return m;
      });
    }
    // wounds stuck to the shell: thin wet-red slabs, drawn at each body's local spots
    this.wound = mk(new THREE.BoxGeometry(1, 1, 1), std({ color: '#ffffff', roughness: 0.2, metalness: 0 }), cap * 6, true);
    this.wound.castShadow = false;
    this.nw = 0;
    this.n = 0; this.nf = 0; this.nh = 0; this.nl = 0;
    this.wn = {};
    this.tmp = new THREE.Matrix4();
  }

  begin() {
    this.n = this.nf = this.nh = this.nw = this.nl = 0;
    for (const id in this.weapons) this.wn[id] = 0;
    for (const k of KIND_IDS) this.gn[k] = this.mn[k] = 0;
  }

  // world: the unit's world matrix; p: pose() output (unit-local); opts: { body: false } hides
  // the body, visor, pack and feet (first person)
  add(world, p, team, opts = {}) {
    const t = this.tmp;
    if (opts.body !== false && this.n < this.cap) {
      const i = this.n++;
      this.body.setMatrixAt(i, t.multiplyMatrices(world, p.body));
      const w = opts.wound || 0, bc = BODY_COL[team];
      if (w > 0) this.body.instanceColor.setXYZ(i, bc.r + (WOUND.r - bc.r) * w * 0.5, bc.g + (WOUND.g - bc.g) * w * 0.5, bc.b + (WOUND.b - bc.b) * w * 0.5);
      else this.body.instanceColor.setXYZ(i, bc.r, bc.g, bc.b);
      if (opts.wounds) {
        const bm = t.multiplyMatrices(world, p.body), wm = this.wm || (this.wm = new THREE.Matrix4()), ws = this.ws || (this.ws = new THREE.Vector3()), wp = this.wp || (this.wp = new THREE.Vector3());
        for (const w of opts.wounds) {
          if (this.nw >= this.cap * 6) break;
          const j = this.nw++;
          this.wound.setMatrixAt(j, wm.compose(wp.set(w.x, w.y, w.z), WQ, ws.set(w.a, w.b, w.c)).premultiply(bm));
          const k = 0.75 + w.sh * 0.5;
          if (w.hole) this.wound.instanceColor.setXYZ(j, 0.03, 0.005, 0.005);
          else this.wound.instanceColor.setXYZ(j, 0.42 * k, 0.04 * k, 0.04 * k);
        }
      }
      this.visor.setMatrixAt(i, t.multiplyMatrices(world, p.visor));
      this.pack.setMatrixAt(i, t.multiplyMatrices(world, p.pack));
      this.pack.instanceColor.setXYZ(i, PACK_COL[team].r, PACK_COL[team].g, PACK_COL[team].b);
      const lost = opts.lost || 0;
      if (!opts.far) {
        const kk = kindKey(opts.kind), gi = this.gn[kk]++;
        this.gear[kk].setMatrixAt(gi, t.multiplyMatrices(world, p.body));
        const ac = UI_COL[team];
        this.gear[kk].instanceColor.setXYZ(gi, ac.r, ac.g, ac.b);
        if (this.marks[kk]) this.marks[kk].setMatrixAt(this.mn[kk]++, t);
        solveLegs(p);
        for (let k = 0; k < 2; k++) {
          if (lost & (4 << k) || this.nl + 2 > this.cap * 4) continue; // a torn-off foot takes its leg with it
          for (let s2 = 0; s2 < 2; s2++) {
            const j = this.nl++;
            this.leg.setMatrixAt(j, t.multiplyMatrices(world, p.legs[k][s2]));
            const c = s2 ? DARK : TROUSER[team];
            this.leg.instanceColor.setXYZ(j, c.r, c.g, c.b);
          }
        }
      }
      for (let k = 0; k < p.feet.length; k++) {
        const f = p.feet[k];
        if (lost & (4 << k)) continue;
        if (this.nf >= this.cap * 2) break;
        const j = this.nf++;
        this.foot.setMatrixAt(j, t.multiplyMatrices(world, f));
        this.foot.instanceColor.setXYZ(j, DARK.r, DARK.g, DARK.b);
      }
    }
    for (let k = 0; k < p.hands.length; k++) {
      const h = p.hands[k];
      if (opts.lost & (1 << k)) continue;
      if (this.nh >= this.cap * 2) break;
      const j = this.nh++;
      this.hand.setMatrixAt(j, t.multiplyMatrices(world, h));
      this.hand.instanceColor.setXYZ(j, TRIM_COL[team].r, TRIM_COL[team].g, TRIM_COL[team].b);
    }
    if (p.showWeapon && opts.weapon) {
      const list = this.weapons[opts.weapon];
      const k = this.wn[opts.weapon];
      if (list && k < list[0].instanceMatrix.count) {
        t.multiplyMatrices(world, p.weapon);
        for (const m of list) m.setMatrixAt(k, t);
        this.wn[opts.weapon] = k + 1;
      }
    }
  }

  end() {
    const fin = (m, n) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    fin(this.body, this.n); fin(this.visor, this.n); fin(this.pack, this.n);
    fin(this.foot, this.nf); fin(this.hand, this.nh); fin(this.wound, this.nw); fin(this.leg, this.nl);
    for (const k of KIND_IDS) { fin(this.gear[k], this.gn[k]); if (this.marks[k]) fin(this.marks[k], this.mn[k]); }
    for (const id in this.weapons) for (const m of this.weapons[id]) fin(m, this.wn[id]);
  }
}
