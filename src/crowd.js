import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { U, HOLD, setWeaponBounds, solveLegs, solveArms, solveTorso } from './rig.js';
import { GEAR, MARKS, KIND_IDS, kindKey } from './gear.js';
import { markMaterial, woundMarkMaterial, partMatrix } from './hitmarks.js';
import { torsoGeo, headGeo, helmetGeo, HELMET_KINDS, bootGeo, handGeos, packGeo, pelvisGeo, neckGeo, deltGeo, LIMB, HEAD_COLORS } from './anatomy.js';
import { detail, instAttr } from './fabric.js';
import { WEAPONS, weaponParts, weaponSlotMatrix } from './weapons.js';
import { TEAMS } from './factions.js';
import { makeWoundMesh, makeDentBody, DENT_CAP, MAX_DENTS } from './wounds.js';
import { stumpGeo, wreckHead, woundMaterial, LOST } from './wreck.js';

// Draws every soldier with a handful of instanced meshes (one per body part and per weapon
// material), so a few hundred units cost a few dozen draw calls.
const std = (o) => new THREE.MeshStandardMaterial(o);
export const PART_GEO = {
  body: torsoGeo(5),
  head: headGeo(),
  helmets: Object.fromEntries(HELMET_KINDS.map((k) => [k, helmetGeo(k)])),
  pack: packGeo(),
  boot: bootGeo('foot'),
  toe: bootGeo('toe'),
  pelvis: pelvisGeo(),
  neck: neckGeo(),
  delt: deltGeo(),
  ...(() => { const h = handGeos(); return { handL: h.left, handR: h.right, handG: h.leftGrip, openL: h.openL, openR: h.openR }; })(),
};

const MP = new THREE.Vector3(), MN = new THREE.Vector3(), MQ = new THREE.Quaternion(), MQ2 = new THREE.Quaternion(), MM = new THREE.Matrix4(), MS = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const SLOT_M = new THREE.Matrix4(), SLOT_T = new THREE.Matrix4();
const UI_COL = TEAMS.map((t) => new THREE.Color(t.ui).lerp(new THREE.Color('#ffffff'), 0.35)); // worn kit: a light army tint over its own colours
const HELM_COL = TEAMS.map((t) => new THREE.Color(t.ui).multiplyScalar(0.72));
const PALE = new THREE.Color('#d9d6cb');
const TROUSER = TEAMS.map((t) => new THREE.Color(t.trim).multiplyScalar(1.75));
const WOUND = new THREE.Color('#5a1212');
const BODY_COL = TEAMS.map((t) => new THREE.Color(t.body).multiplyScalar(1.45)); // field uniform: lighter than the armour accents so the figure reads
const TRIM_COL = TEAMS.map((t) => new THREE.Color(t.trim));
const PACK_COL = TEAMS.map((t) => new THREE.Color(t.body).multiplyScalar(0.62));
const DARK = new THREE.Color('#1d2126');
const _sp = new THREE.Vector3(), _sq = new THREE.Quaternion(), _ss = new THREE.Vector3(), _sz = new THREE.Vector3(), _sm = new THREE.Matrix4();
const NECK_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2), NECK_T = new THREE.Matrix4().makeTranslation(0, 0, 0.012), NECK_S = new THREE.Vector3(0.034, 0.034, 0.034);

export class Crowd {
  constructor(scene, cap = 600) {
    this.cap = cap;
    this.scene = scene;
    // style: per-instance class and seed for the camouflage; sway: per-instance swing angles of loose kit
    const mk = (geo, mat, n, colored, { style = false, sway = false } = {}) => {
      if (style || sway) geo = geo.clone(); // the per-instance attributes live on the geometry, which two crowds must not share
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.frustumCulled = false; // instances are spread over the whole map
      m.castShadow = true;
      // the shadow pass draws only the front part of the list (soldiers inside the sun's shadow box; see snap())
      m.onBeforeShadow = () => { m._full = m.count; m.count = Math.min(m.count, m._sc ?? m.count); };
      m.onAfterShadow = () => { m.count = m._full; };
      m.receiveShadow = true;
      m.count = 0;
      if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      if (style) geo.setAttribute('iStyle', instAttr(n));
      if (sway) { geo.setAttribute('iSwA', instAttr(n, 4)); geo.setAttribute('iSwB', instAttr(n, 4)); geo.setAttribute('iSwC', instAttr(n, 2)); }
      scene.add(m);
      return m;
    };
    const mks = (g, m, n, c, o = {}) => mk(g, m, n, c, { style: true, ...o });
    const cloth = (o) => detail(std({ color: '#ffffff', roughness: 0.85, metalness: 0.02, vertexColors: true }), { camo: true, bump: 0.55, ...o });
    this.body = mks(PART_GEO.body, detail(std({ color: '#ffffff', roughness: 0.62, metalness: 0.05 }), { camo: true, dirt: [0.04, 0, 0.55], bump: 0.4 }), cap, true);
    this.head = mk(PART_GEO.head, std({ color: '#ffffff', roughness: 0.7, metalness: 0, vertexColors: true }), cap, true, { style: false });
    // one helmet mesh per class (the headgear is how a class reads at a glance); each draws only its own soldiers
    const helmMat = detail(std({ color: '#ffffff', roughness: 0.5, metalness: 0.25, vertexColors: true }), { dirt: [0.08, 0, 0.1], wear: 0.3, bump: 0.3 });
    this.helmets = {}; this.hn = {};
    for (const k of HELMET_KINDS) { this.helmets[k] = mks(PART_GEO.helmets[k], helmMat, cap, true); this.helmets[k].name = `crowd-helmet-${k}`; }
    this.pack = mks(PART_GEO.pack, cloth({ dirt: [0.1, 0, 0.5] }), cap, true);
    const leather = () => detail(std({ color: '#ffffff', roughness: 0.7, metalness: 0.05, vertexColors: true }), { dirt: [0.12, 0, 0.5], bump: 0.35 });
    this.boot = mks(PART_GEO.boot, detail(std({ color: '#ffffff', roughness: 0.7, metalness: 0.05, vertexColors: true }), { dirt: [0.3, 0, 0.7], bump: 0.5 }), cap * 2, false);
    this.toe = mks(PART_GEO.toe, this.boot.material, cap * 2, false);
    this.pelvis = mks(PART_GEO.pelvis, cloth({ dirt: [0.08, 0, 0.5] }), cap, true);
    this.neck = mk(PART_GEO.neck, std({ color: '#ffffff', roughness: 0.8, metalness: 0, vertexColors: true }), cap, true, { style: false });
    this.delt = mks(PART_GEO.delt, cloth({ dirt: [0.05, 0, 0] }), cap * 2, true);
    const glove = leather();
    // hands: cup (left, forend), grip (right, pistol grip), leftGrip (left, vertical foregrip), open (either, fingers spread)
    this.hands = {};
    for (const [id, key] of [['L', 'handL'], ['G', 'handG'], ['R', 'handR'], ['oL', 'openL'], ['oR', 'openR']]) {
      this.hands[id] = mks(PART_GEO[key], glove, cap, false);
      this.hands[id].name = `crowd-hands-${id}`;
    }
    this.handL = this.hands.L; this.handR = this.hands.R; this.handG = this.hands.G;
    this.hn2 = {};
    this.upperArm = mks(LIMB.upperArm, cloth({ dirt: [0.04, 0.3, 0] }), cap * 2, true);
    this.foreArm = mks(LIMB.foreArm, cloth({ dirt: [0.08, 0.5, 0] }), cap * 2, true);
    this.thigh = mks(LIMB.thigh, cloth({ dirt: [0.08, 0.55, 0] }), cap * 2, true);
    this.shin = mks(LIMB.shin, cloth({ dirt: [0.18, 0.8, 0] }), cap * 2, true);
    // class kit (instance colour = army accent), fixed-colour marks, and the legs
    const gearMat = detail(std({ color: '#ffffff', roughness: 0.65, metalness: 0.1, vertexColors: true }), { sway: true, dirt: [0.05, 0, 0.45], wear: 0.3, bump: 0.45 });
    const markMat = detail(std({ color: '#ffffff', roughness: 0.5, metalness: 0.05, vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.18 }), { sway: true, style: false, grain: 0, bump: 0 });
    this.gear = {}; this.marks = {}; this.gn = {}; this.mn = {};
    for (const k of KIND_IDS) {
      this.gear[k] = mks(GEAR[k], gearMat, cap, true, { sway: true }); this.gear[k].name = `crowd-gear-${k}`;
      if (MARKS[k]) { this.marks[k] = mk(MARKS[k], markMat, cap, false, { sway: true }); this.marks[k].name = `crowd-mark-${k}`; }
    }
    this.body.name = 'crowd-body'; this.head.name = 'crowd-head'; this.boot.name = 'crowd-boots'; this.toe.name = 'crowd-toes'; this.pelvis.name = 'crowd-pelvis'; this.neck.name = 'crowd-neck'; this.delt.name = 'crowd-shoulders';
    // wound faces where limbs and heads were torn off, and ruined heads (see wreck.js)
    const wm = () => woundMaterial({ roughness: 0.5 });
    this.stump = mk(stumpGeo(), wm(), 240, true); this.stump.name = 'crowd-stumps'; this.ns = 0;
    this.wreckFace = mk(wreckHead('face'), wm(), 48, true); this.wreckFace.name = 'crowd-head-face'; this.nwf = 0;
    this.wreckTop = mk(wreckHead('top'), wm(), 48, true); this.wreckTop.name = 'crowd-head-top'; this.nwt = 0;
    // The shadow map is about 5 cm a texel, so fingers, toe caps, kit pouches and shoulder pads leave no shadow of their own:
    // they stay out of the shadow pass (the body, limbs, helmet, boots and gun still cast).
    for (const m of [...Object.values(this.hands), this.toe, this.neck, this.delt, ...Object.values(this.gear), ...Object.values(this.marks)]) m.castShadow = false;
    this.nl = 0; this.na = 0;
    this.mark = mk(new THREE.PlaneGeometry(1, 1), markMaterial(), cap * 10, false); this.mark.name = 'crowd-hitmarks'; this.mark.castShadow = false; this.nm = 0;
    this.markW = mk(new THREE.PlaneGeometry(1, 1), woundMarkMaterial(), cap * 10, false); this.markW.name = 'crowd-woundmarks'; this.markW.castShadow = false; this.nmw = 0;
    // weapons: one instanced mesh per (weapon, material)
    this.weapons = {};
    for (const id of Object.keys(WEAPONS)) {
      const { parts, muzzle, box, sight } = weaponParts(id);
      setWeaponBounds(id, box, muzzle, sight);
      const sc = new THREE.Matrix4().makeScale(U.WEAPON_SCALE, U.WEAPON_SCALE, U.WEAPON_SCALE);
      this.weapons[id] = parts.map(({ geometry, material, slot }) => {
        const g = geometry.clone().applyMatrix4(sc);
        const m = mk(g, material, cap, false);
        m.name = `crowd-${id}${slot ? '-' + slot : ''}`;
        m.userData.slot = slot; // a moving part: its matrix is the gun's plus the slot's offset (magazine, bolt)
        return m;
      });
    }
    // wounds wrap the shell (see wounds.js); soldiers with dents draw a finer, dentable body
    this.wound = makeWoundMesh(cap * 6);
    scene.add(this.wound);
    this.nw = 0;
    this.dentBody = makeDentBody(DENT_CAP, this.body.material);
    this.dentBody.geometry.setAttribute('iStyle', instAttr(DENT_CAP));
    detail(this.dentBody.material, { camo: true, dirt: [0.04, 0, 0.55], bump: 0.4 });
    scene.add(this.dentBody);
    this.nd = 0;
    this.n = 0; this.nf = 0; this.nh = 0; this.nl = 0; this.na = 0;
    this.wn = {};
    this.sh = { gn: {}, mn: {}, hn: {}, hn2: {}, wn: {} }; this.snapped = false;
    this.tmp = new THREE.Matrix4();
  }

  // class (0..5) and a per-soldier seed make the camouflage; a negative style is a distant soldier, drawn plain
  style(mesh, i, v) { mesh.geometry.attributes.iStyle.setX(i, v); }
  swayTo(mesh, i, sw) {
    const g = mesh.geometry.attributes;
    g.iSwA.setXYZW(i, sw[0], sw[1], sw[2], sw[3]); g.iSwB.setXYZW(i, sw[4], sw[5], sw[6], sw[7]); g.iSwC.setXY(i, sw[8], sw[9]);
  }

  // a torn wound face at the start of limb segment `seg` (pos at its root, face toward its far end), pushed `adv` along it
  addStump(world, seg, radius, color, adv = 0) {
    if (this.ns >= 240) return;
    _sm.multiplyMatrices(world, seg).decompose(_sp, _sq, _ss);
    _sz.set(0, 0, 1).applyQuaternion(_sq);
    _sp.addScaledVector(_sz, -0.5 * _ss.z * 0.2 + adv);
    const j = this.ns++;
    this.stump.setMatrixAt(j, _sm.compose(_sp, _sq, _ss.setScalar(radius)));
    this.stump.instanceColor.setXYZ(j, color.r, color.g, color.b);
  }

  begin() {
    this.n = this.nf = this.nh = this.nw = this.nl = this.na = this.nd = this.nm = this.nmw = this.ns = this.nwf = this.nwt = 0;
    for (const id in this.weapons) this.wn[id] = 0;
    for (const k of KIND_IDS) this.gn[k] = this.mn[k] = 0;
    for (const k of HELMET_KINDS) this.hn[k] = 0;
    for (const g in this.hands) this.hn2[g] = 0;
  }

  // world: the unit's world matrix; p: pose() output (unit-local); opts: { body: false } hides
  // the body, visor, pack and feet (first person)
  add(world, p, team, opts = {}) {
    const t = this.tmp;
    const cls = Math.max(0, KIND_IDS.indexOf(kindKey(opts.kind)));
    let sv = cls + ((opts.seed || 0) * 0.6180339 % 1) * 0.9;
    if (opts.far) sv = -1 - sv;
    const sw = p.sway;
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
        this.style(this.dentBody, d, sv);
      } else {
        this.body.setMatrixAt(i, bm);
      }
      this.style(this.body, i, sv);
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
      const hl = opts.lost || 0, sk = TRIM_COL[team]; // the head is a dark balaclava under the headgear
      const hm = t.multiplyMatrices(world, p.head);
      if (hl & (LOST.HEAD | LOST.FACE | LOST.CROWN)) {
        // ruined head: the helmet is gone, the neck or skull shows its wound
        this.head.setMatrixAt(i, ZERO);
        if (hl & LOST.HEAD) {
          if (this.ns < 240) { const j = this.ns++; this.stump.setMatrixAt(j, _sm.multiplyMatrices(hm, NECK_UP).multiply(NECK_T).scale(NECK_S)); this.stump.instanceColor.setXYZ(j, sk.r * 1.6, sk.g * 1.6, sk.b * 1.6); }
        } else {
          const face = hl & LOST.FACE, w = face ? this.wreckFace : this.wreckTop, j = face ? this.nwf++ : this.nwt++;
          if (j < 48) { w.setMatrixAt(j, hm); w.instanceColor.setXYZ(j, sk.r * 1.6, sk.g * 1.6, sk.b * 1.6); } else if (face) this.nwf--; else this.nwt--;
        }
      } else {
        this.head.setMatrixAt(i, hm);
        this.head.instanceColor.setXYZ(i, sk.r * 1.6, sk.g * 1.6, sk.b * 1.6);
        const hk = HELMET_KINDS.includes(opts.kind) ? opts.kind : 'rifleman', hi = this.hn[hk]++;
        this.helmets[hk].setMatrixAt(hi, t.multiplyMatrices(world, p.head));
        this.style(this.helmets[hk], hi, sv);
        const hc = opts.kind === 'medic' ? PALE : HELM_COL[team];
        this.helmets[hk].instanceColor.setXYZ(hi, hc.r, hc.g, hc.b);
      }
      this.pack.setMatrixAt(i, t.multiplyMatrices(world, p.pack));
      this.pack.instanceColor.setXYZ(i, PACK_COL[team].r, PACK_COL[team].g, PACK_COL[team].b);
      this.style(this.pack, i, sv);
      const lost = opts.lost || 0;
      if (!opts.far) {
        const kk = kindKey(opts.kind), gi = this.gn[kk]++;
        this.gear[kk].setMatrixAt(gi, t.multiplyMatrices(world, p.body));
        const ac = UI_COL[team];
        this.gear[kk].instanceColor.setXYZ(gi, ac.r, ac.g, ac.b);
        this.style(this.gear[kk], gi, sv); this.swayTo(this.gear[kk], gi, sw);
        if (this.marks[kk]) { const mi = this.mn[kk]++; this.marks[kk].setMatrixAt(mi, t); this.swayTo(this.marks[kk], mi, sw); }
      }
      solveLegs(p);
      const tc = TROUSER[team];
      // pelvis and neck: the joints between the chest, the hips and the head
      this.pelvis.setMatrixAt(i, t.multiplyMatrices(world, p.pelvis));
      this.pelvis.instanceColor.setXYZ(i, tc.r, tc.g, tc.b);
      this.style(this.pelvis, i, sv);
      if (!(hl & LOST.HEAD)) { this.neck.setMatrixAt(i, t.multiplyMatrices(world, p.neck)); this.neck.instanceColor.setXYZ(i, sk.r * 1.6, sk.g * 1.6, sk.b * 1.6); } else this.neck.setMatrixAt(i, ZERO);
      for (let k = 0; k < 2; k++) {
        if (lost & (LOST.LEG << k)) { this.addStump(world, p.legs[k][0], 0.056, tc, 0.03); continue; } // torn off at the hip: leg, shin and boot go together
        if (this.nl + 1 > this.cap * 2) continue;
        const j = this.nl++;
        this.thigh.setMatrixAt(j, t.multiplyMatrices(world, p.legs[k][0]));
        this.thigh.instanceColor.setXYZ(j, tc.r, tc.g, tc.b);
        this.style(this.thigh, j, sv); this.style(this.shin, j, sv);
        if (lost & (LOST.SHIN << k)) { this.shin.setMatrixAt(j, ZERO); this.addStump(world, p.legs[k][1], 0.043, tc, 0.03); continue; } // torn off at the knee
        this.shin.setMatrixAt(j, t.multiplyMatrices(world, p.legs[k][1]));
        this.shin.instanceColor.setXYZ(j, tc.r, tc.g, tc.b);
      }
      for (let k = 0; k < p.feet.length; k++) {
        if (lost & ((LOST.LEG | LOST.SHIN) << k)) continue;
        if (this.nf >= this.cap * 2) break;
        this.style(this.boot, this.nf, sv); this.style(this.toe, this.nf, sv);
        this.toe.setMatrixAt(this.nf, t.multiplyMatrices(world, p.toes[k]));
        this.boot.setMatrixAt(this.nf++, t.multiplyMatrices(world, p.feet[k]));
      }
    }
    // holes, scorch and dents where rounds struck helmet, vest, pack and limbs (parts solved above)
    if (opts.marks && !opts.far) for (const m of opts.marks) {
      if (m.w ? this.nmw >= this.cap * 10 : this.nm >= this.cap * 10) break;
      solveLegs(p); solveArms(p);
      const pm = t.multiplyMatrices(world, partMatrix(p, m.id));
      const pos = MP.copy(m.p).applyMatrix4(pm);
      const nw = MN.copy(m.n).transformDirection(pm);
      MQ.setFromUnitVectors(Z, nw); MQ2.setFromAxisAngle(nw, m.r); MQ.premultiply(MQ2);
      (m.w ? this.markW : this.mark).setMatrixAt(m.w ? this.nmw++ : this.nm++, MM.compose(pos.addScaledVector(nw, 0.004), MQ, MS.setScalar(m.s * (m.w ? 1.5 : 1))));
    }
    // arms reach from the shoulders to the hands (first person too, where the shoulders are below the view)
    solveArms(p);
    const sc = BODY_COL[team];
    for (let k = 0; k < p.hands.length; k++) {
      const h = p.hands[k];
      const al = opts.lost || 0;
      if (al & (LOST.ARM << k)) { this.addStump(world, p.arms[k][0], 0.039, sc, 0.03); continue; } // torn off at the shoulder
      if (this.nh >= this.cap * 2) break;
      const j = this.nh++;
      this.upperArm.setMatrixAt(j, t.multiplyMatrices(world, p.arms[k][0]));
      this.upperArm.instanceColor.setXYZ(j, sc.r, sc.g, sc.b);
      this.delt.setMatrixAt(j, t.multiplyMatrices(world, p.delts[k])); this.delt.instanceColor.setXYZ(j, sc.r, sc.g, sc.b);
      this.style(this.upperArm, j, sv); this.style(this.foreArm, j, sv); this.style(this.delt, j, sv);
      if (al & (LOST.FORE << k)) { this.foreArm.setMatrixAt(j, ZERO); this.addStump(world, p.arms[k][1], 0.031, sc, 0.024); continue; } // torn off at the elbow, hand and all
      // open fingers when the hand is free, otherwise the cup / grip / foregrip hand the gun asks for
      const free = p.curl[k] < 0.5;
      const hid = free ? (k === 0 ? 'oL' : 'oR') : k === 0 ? (HOLD[opts.weapon]?.grips?.lk === 'grip' ? 'G' : 'L') : 'R';
      if (!opts.far2) { const hm = this.hands[hid], n = this.hn2[hid]++; hm.setMatrixAt(n, t.multiplyMatrices(world, h)); this.style(hm, n, sv); } // a glove past ~100 m is under a pixel
      this.foreArm.setMatrixAt(j, t.multiplyMatrices(world, p.arms[k][1]));
      this.foreArm.instanceColor.setXYZ(j, sc.r, sc.g, sc.b);
    }
    if (p.showWeapon && opts.weapon) {
      const list = this.weapons[opts.weapon];
      const k = this.wn[opts.weapon];
      if (list && k < list[0].instanceMatrix.count) {
        t.multiplyMatrices(world, p.weapon);
        for (const m of list) {
          const sl = m.userData.slot;
          if (!sl) { m.setMatrixAt(k, t); continue; }
          weaponSlotMatrix(opts.weapon, sl, p.mvReload ?? -1, p.mvRack || 0, p.mvRecoil || 0, SLOT_M);
          SLOT_M.elements[12] *= U.WEAPON_SCALE; SLOT_M.elements[13] *= U.WEAPON_SCALE; SLOT_M.elements[14] *= U.WEAPON_SCALE;
          m.setMatrixAt(k, SLOT_T.multiplyMatrices(t, SLOT_M));
        }
        this.wn[opts.weapon] = k + 1;
      }
    }
  }

  // Call once the soldiers that cast a shadow into view have been added and before the rest: every
  // mesh's list then starts with those, and the shadow pass draws just that front part.
  snap() {
    const c = this.sh;
    c.n = this.n; c.nf = this.nf; c.nh = this.nh; c.nl = this.nl; c.nd = this.nd; c.nm = this.nm; c.nmw = this.nmw; c.ns = this.ns; c.nwf = this.nwf; c.nwt = this.nwt;
    for (const k in this.gn) c.gn[k] = this.gn[k];
    for (const k in this.mn) c.mn[k] = this.mn[k];
    for (const k in this.hn) c.hn[k] = this.hn[k];
    for (const k in this.hn2) c.hn2[k] = this.hn2[k];
    for (const k in this.wn) c.wn[k] = this.wn[k];
    this.snapped = true;
  }

  end() {
    const sh = this.snapped ? this.sh : null; this.snapped = false;
    const fin = (m, n, s = n) => {
      m._sc = s;
      m.count = n;
      m.visible = n > 0; // an empty mesh costs nothing: no draw call, no state changes
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      const ga = m.geometry.attributes;
      if (ga.iStyle) ga.iStyle.needsUpdate = true;
      if (ga.iSwA) ga.iSwA.needsUpdate = ga.iSwB.needsUpdate = ga.iSwC.needsUpdate = true;
    };
    const S = (k, n) => (sh ? k : n); // the shadow count, or the whole list when no snap() came
    fin(this.body, this.n, S(sh?.n, this.n)); fin(this.head, this.n, S(sh?.n, this.n)); for (const k of HELMET_KINDS) fin(this.helmets[k], this.hn[k], S(sh?.hn[k], this.hn[k])); fin(this.pack, this.n, S(sh?.n, this.n));
    fin(this.boot, this.nf, S(sh?.nf, this.nf)); fin(this.toe, this.nf, S(sh?.nf, this.nf)); fin(this.pelvis, this.n, S(sh?.n, this.n)); fin(this.neck, this.n, S(sh?.n, this.n)); fin(this.delt, this.nh, S(sh?.nh, this.nh));
    for (const g in this.hands) fin(this.hands[g], this.hn2[g], S(sh?.hn2[g], this.hn2[g]));
    fin(this.upperArm, this.nh, S(sh?.nh, this.nh)); fin(this.foreArm, this.nh, S(sh?.nh, this.nh));
    fin(this.thigh, this.nl, S(sh?.nl, this.nl)); fin(this.shin, this.nl, S(sh?.nl, this.nl));
    fin(this.mark, this.nm); fin(this.markW, this.nmw);
    fin(this.stump, this.ns, S(sh?.ns, this.ns)); fin(this.wreckFace, this.nwf, S(sh?.nwf, this.nwf)); fin(this.wreckTop, this.nwt, S(sh?.nwt, this.nwt));
    fin(this.wound, this.nw); fin(this.dentBody, this.nd, S(sh?.nd, this.nd));
    const wg = this.wound.geometry.attributes, dg = this.dentBody.geometry.attributes;
    wg.aC.needsUpdate = wg.aS.needsUpdate = wg.aN.needsUpdate = true;
    for (let k = 0; k < MAX_DENTS; k++) dg[`aD${k}`].needsUpdate = true;
    for (const k of KIND_IDS) { fin(this.gear[k], this.gn[k], S(sh?.gn[k], this.gn[k])); if (this.marks[k]) fin(this.marks[k], this.mn[k], S(sh?.mn[k], this.mn[k])); }
    for (const id in this.weapons) for (const m of this.weapons[id]) fin(m, this.wn[id], S(sh?.wn[id], this.wn[id]));
  }
}
