import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { U, setWeaponBounds, solveLegs, solveArms } from './rig.js';
import { GEAR, MARKS, KIND_IDS, kindKey } from './gear.js';
import { markMaterial, partMatrix } from './hitmarks.js';
import { torsoGeo, headGeo, helmetGeo, bootGeo, handGeos, LIMB, HEAD_COLORS } from './anatomy.js';
import { WEAPONS, weaponParts } from './weapons.js';
import { TEAMS } from './factions.js';
import { makeWoundMesh, makeDentBody, DENT_CAP, MAX_DENTS } from './wounds.js';

// Draws every soldier with a handful of instanced meshes (one per body part and per weapon
// material), so a few hundred units cost a few dozen draw calls.
const std = (o) => new THREE.MeshStandardMaterial(o);
export const PART_GEO = {
  body: torsoGeo(5),
  head: headGeo(),
  helmet: helmetGeo(),
  pack: new RoundedBoxGeometry(...U.PACK, 3, 0.04),
  boot: bootGeo(),
  ...(() => { const h = handGeos(); return { handL: h.left, handR: h.right }; })(),
};

const MP = new THREE.Vector3(), MN = new THREE.Vector3(), MQ = new THREE.Quaternion(), MQ2 = new THREE.Quaternion(), MM = new THREE.Matrix4(), MS = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UI_COL = TEAMS.map((t) => new THREE.Color(t.ui));
const HELM_COL = TEAMS.map((t) => new THREE.Color(t.ui).multiplyScalar(0.72));
const PALE = new THREE.Color('#d9d6cb');
const TROUSER = TEAMS.map((t) => new THREE.Color(t.trim).multiplyScalar(1.75));
const WOUND = new THREE.Color('#5a1212');
const BODY_COL = TEAMS.map((t) => new THREE.Color(t.body).multiplyScalar(1.45)); // field uniform: lighter than the armour accents so the figure reads
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
    this.body = mk(PART_GEO.body, std({ color: '#ffffff', roughness: 0.62, metalness: 0.05 }), cap, true);
    this.head = mk(PART_GEO.head, std({ color: '#ffffff', roughness: 0.7, metalness: 0, vertexColors: true }), cap, true);
    this.helmet = mk(PART_GEO.helmet, std({ color: '#ffffff', roughness: 0.5, metalness: 0.25, vertexColors: true }), cap, true);
    this.pack = mk(PART_GEO.pack, std({ color: '#ffffff', roughness: 0.8, metalness: 0.05 }), cap, true);
    const fixed = std({ color: '#ffffff', roughness: 0.7, metalness: 0.05, vertexColors: true });
    this.boot = mk(PART_GEO.boot, fixed, cap * 2, false);
    this.handL = mk(PART_GEO.handL, fixed, cap, false);
    this.handR = mk(PART_GEO.handR, fixed, cap, false);
    const cloth = std({ color: '#ffffff', roughness: 0.85, metalness: 0.02, vertexColors: true });
    this.upperArm = mk(LIMB.upperArm, cloth, cap * 2, true);
    this.foreArm = mk(LIMB.foreArm, cloth, cap * 2, true);
    this.thigh = mk(LIMB.thigh, cloth, cap * 2, true);
    this.shin = mk(LIMB.shin, cloth, cap * 2, true);
    // class kit (instance colour = army accent), fixed-colour marks, and the legs
    const gearMat = std({ color: '#ffffff', roughness: 0.65, metalness: 0.1, vertexColors: true });
    const markMat = std({ color: '#ffffff', roughness: 0.5, metalness: 0.05, vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.18 });
    this.gear = {}; this.marks = {}; this.gn = {}; this.mn = {};
    for (const k of KIND_IDS) {
      this.gear[k] = mk(GEAR[k], gearMat, cap, true); this.gear[k].name = `crowd-gear-${k}`;
      if (MARKS[k]) { this.marks[k] = mk(MARKS[k], markMat, cap, false); this.marks[k].name = `crowd-mark-${k}`; }
    }
    this.body.name = 'crowd-body'; this.head.name = 'crowd-head'; this.helmet.name = 'crowd-helmet'; this.boot.name = 'crowd-boots'; this.handL.name = 'crowd-hands-left'; this.handR.name = 'crowd-hands-right';
    this.nl = 0; this.na = 0;
    this.mark = mk(new THREE.PlaneGeometry(1, 1), markMaterial(), cap * 10, false); this.mark.name = 'crowd-hitmarks'; this.mark.castShadow = false; this.nm = 0;
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
    this.n = 0; this.nf = 0; this.nh = 0; this.nhl = 0; this.nhr = 0; this.nl = 0; this.na = 0;
    this.wn = {};
    this.tmp = new THREE.Matrix4();
  }

  begin() {
    this.n = this.nf = this.nh = this.nhl = this.nhr = this.nw = this.nl = this.na = this.nd = this.nm = 0;
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
      this.head.setMatrixAt(i, t.multiplyMatrices(world, p.head));
      const sk = HEAD_COLORS[(opts.seed | 0) % HEAD_COLORS.length];
      this.head.instanceColor.setXYZ(i, sk.r, sk.g, sk.b);
      this.helmet.setMatrixAt(i, t.multiplyMatrices(world, p.head));
      const hc = opts.kind === 'medic' ? PALE : HELM_COL[team];
      this.helmet.instanceColor.setXYZ(i, hc.r, hc.g, hc.b);
      this.pack.setMatrixAt(i, t.multiplyMatrices(world, p.pack));
      this.pack.instanceColor.setXYZ(i, PACK_COL[team].r, PACK_COL[team].g, PACK_COL[team].b);
      const lost = opts.lost || 0;
      if (!opts.far) {
        const kk = kindKey(opts.kind), gi = this.gn[kk]++;
        this.gear[kk].setMatrixAt(gi, t.multiplyMatrices(world, p.body));
        const ac = UI_COL[team];
        this.gear[kk].instanceColor.setXYZ(gi, ac.r, ac.g, ac.b);
        if (this.marks[kk]) this.marks[kk].setMatrixAt(this.mn[kk]++, t);
      }
      solveLegs(p);
      const tc = TROUSER[team];
      for (let k = 0; k < 2; k++) {
        if (lost & (4 << k) || this.nl + 1 > this.cap * 2) continue; // a torn-off foot takes its leg with it
        const j = this.nl++;
        this.thigh.setMatrixAt(j, t.multiplyMatrices(world, p.legs[k][0]));
        this.thigh.instanceColor.setXYZ(j, tc.r, tc.g, tc.b);
        this.shin.setMatrixAt(j, t.multiplyMatrices(world, p.legs[k][1]));
        this.shin.instanceColor.setXYZ(j, tc.r, tc.g, tc.b);
      }
      for (let k = 0; k < p.feet.length; k++) {
        if (lost & (4 << k)) continue;
        if (this.nf >= this.cap * 2) break;
        this.boot.setMatrixAt(this.nf++, t.multiplyMatrices(world, p.feet[k]));
      }
    }
    // holes, scorch and dents where rounds struck helmet, vest, pack and limbs (parts solved above)
    if (opts.marks && !opts.far) for (const m of opts.marks) {
      if (this.nm >= this.cap * 10) break;
      solveLegs(p); solveArms(p);
      const pm = t.multiplyMatrices(world, partMatrix(p, m.id));
      const pos = MP.copy(m.p).applyMatrix4(pm);
      const nw = MN.copy(m.n).transformDirection(pm);
      MQ.setFromUnitVectors(Z, nw); MQ2.setFromAxisAngle(nw, m.r); MQ.premultiply(MQ2);
      this.mark.setMatrixAt(this.nm++, MM.compose(pos.addScaledVector(nw, 0.004), MQ, MS.setScalar(m.s)));
    }
    // arms reach from the shoulders to the hands (first person too, where the shoulders are below the view)
    solveArms(p);
    const sc = BODY_COL[team];
    for (let k = 0; k < p.hands.length; k++) {
      const h = p.hands[k];
      if (opts.lost & (1 << k)) continue;
      if (this.nh >= this.cap * 2) break;
      const j = this.nh++;
      if (k === 0) this.handL.setMatrixAt(this.nhl++, t.multiplyMatrices(world, h)); else this.handR.setMatrixAt(this.nhr++, t.multiplyMatrices(world, h));
      this.upperArm.setMatrixAt(j, t.multiplyMatrices(world, p.arms[k][0]));
      this.upperArm.instanceColor.setXYZ(j, sc.r, sc.g, sc.b);
      this.foreArm.setMatrixAt(j, t.multiplyMatrices(world, p.arms[k][1]));
      this.foreArm.instanceColor.setXYZ(j, sc.r, sc.g, sc.b);
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
    fin(this.body, this.n); fin(this.head, this.n); fin(this.helmet, this.n); fin(this.pack, this.n);
    fin(this.boot, this.nf); fin(this.handL, this.nhl); fin(this.handR, this.nhr); fin(this.upperArm, this.nh); fin(this.foreArm, this.nh);
    fin(this.thigh, this.nl); fin(this.shin, this.nl);
    fin(this.mark, this.nm);
    fin(this.wound, this.nw); fin(this.dentBody, this.nd);
    const wg = this.wound.geometry.attributes, dg = this.dentBody.geometry.attributes;
    wg.aC.needsUpdate = wg.aS.needsUpdate = wg.aN.needsUpdate = true;
    for (let k = 0; k < MAX_DENTS; k++) dg[`aD${k}`].needsUpdate = true;
    for (const k of KIND_IDS) { fin(this.gear[k], this.gn[k]); if (this.marks[k]) fin(this.marks[k], this.mn[k]); }
    for (const id in this.weapons) for (const m of this.weapons[id]) fin(m, this.wn[id]);
  }
}
