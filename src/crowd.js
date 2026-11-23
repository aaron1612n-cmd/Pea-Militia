import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { U, setWeaponBounds, solveLegs } from './rig.js';
import { GEAR, MARKS, KIND_IDS, kindKey, LIMB_GEO, FOOT_DETAIL, HAND_DETAIL } from './gear.js';
import { WEAPONS, weaponParts } from './weapons.js';
import { TEAMS } from './factions.js';
import { makeWoundMesh, makeDentBody, DENT_CAP, MAX_DENTS } from './wounds.js';

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

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
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
    this.footD = mk(FOOT_DETAIL, gearMat, cap * 2, false); this.footD.name = 'crowd-boots';
    this.handD = mk(HAND_DETAIL, gearMat, cap * 2, false); this.handD.name = 'crowd-gloves';
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
    // wounds wrap the shell (see wounds.js); soldiers with dents draw a finer, dentable body
    this.wound = makeWoundMesh(cap * 6);
    scene.add(this.wound);
    this.nw = 0;
    this.dentBody = makeDentBody(DENT_CAP, this.body.material);
    scene.add(this.dentBody);
    this.nd = 0;
    this.n = 0; this.nf = 0; this.nh = 0; this.nl = 0;
    this.wn = {};
    this.tmp = new THREE.Matrix4();
  }

  begin() {
    this.n = this.nf = this.nh = this.nw = this.nl = this.nd = this.nfd = this.nhd = 0;
    for (const id in this.weapons) this.wn[id] = 0;
    for (const k of KIND_IDS) this.gn[k] = this.mn[k] = 0;
  }

  // world: the unit's world matrix; p: pose() output (unit-local); opts: { body: false } hides
  // the body, visor, pack and feet (first person)
  add(world, p, team, opts = {}) {
    const t = this.tmp;
    if (opts.body !== false && this.n < this.cap) {
      const i = this.n++;
      const bm = t.multiplyMatrices(world, p.body);
      const w = opts.wound || 0, bc = BODY_COL[team];
      const cr = bc.r + (WOUND.r - bc.r) * w * 0.5, cg = bc.g + (WOUND.g - bc.g) * w * 0.5, cb = bc.b + (WOUND.b - bc.b) * w * 0.5;
      const ws = opts.wounds;
      let dents = 0;
      if (ws && !opts.far && this.nd < DENT_CAP) for (let k = ws.length - 1; k >= 0 && dents < MAX_DENTS; k--) if (ws[k].dent) dents++;
      if (dents) {
        // the plain body steps aside for the dented one (same slot, collapsed)
        const d = this.nd++, g = this.dentBody.geometry;
        this.dentBody.setMatrixAt(d, bm);
        this.dentBody.instanceColor.setXYZ(d, cr, cg, cb);
        let k2 = 0;
        for (let k = ws.length - 1; k >= 0 && k2 < MAX_DENTS; k--) if (ws[k].dent) { g.attributes[`aD${k2++}`].setXYZW(d, ws[k].x, ws[k].y, ws[k].z, ws[k].dent); }
        for (; k2 < MAX_DENTS; k2++) g.attributes[`aD${k2}`].setXYZW(d, 0, 0, 0, 0);
        this.body.setMatrixAt(i, ZERO);
      } else {
        this.body.setMatrixAt(i, bm);
      }
      this.body.instanceColor.setXYZ(i, cr, cg, cb);
      if (ws) {
        const aC = this.wound.geometry.attributes.aC, aS = this.wound.geometry.attributes.aS, aN = this.wound.geometry.attributes.aN;
        for (const w of ws) {
          if (this.nw >= this.cap * 6) break;
          const j = this.nw++;
          this.wound.setMatrixAt(j, bm);
          aC.setXYZW(j, w.x, w.y, w.z, w.tile);
          aS.setXYZW(j, w.sa, w.sb, 0.75 + w.sh * 0.5, w.dd || 0);
          aN.setXYZ(j, w.nx, 0, w.nz);
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
        if (!opts.far) this.footD.setMatrixAt(this.nfd++, t);
        this.foot.instanceColor.setXYZ(j, DARK.r, DARK.g, DARK.b);
      }
    }
    for (let k = 0; k < p.hands.length; k++) {
      const h = p.hands[k];
      if (opts.lost & (1 << k)) continue;
      if (this.nh >= this.cap * 2) break;
      const j = this.nh++;
      this.hand.setMatrixAt(j, t.multiplyMatrices(world, h));
      if (!opts.far) this.handD.setMatrixAt(this.nhd++, t);
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
    fin(this.footD, this.nfd); fin(this.handD, this.nhd);
    fin(this.foot, this.nf); fin(this.hand, this.nh); fin(this.wound, this.nw); fin(this.dentBody, this.nd);
    const wg = this.wound.geometry.attributes, dg = this.dentBody.geometry.attributes;
    wg.aC.needsUpdate = wg.aS.needsUpdate = wg.aN.needsUpdate = true;
    for (let k = 0; k < MAX_DENTS; k++) dg[`aD${k}`].needsUpdate = true;
     fin(this.leg, this.nl);
    for (const k of KIND_IDS) { fin(this.gear[k], this.gn[k]); if (this.marks[k]) fin(this.marks[k], this.mn[k]); }
    for (const id in this.weapons) for (const m of this.weapons[id]) fin(m, this.wn[id]);
  }
}
