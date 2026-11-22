import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { U, setWeaponBounds } from './rig.js';
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
    this.visor.name = 'crowd-visor'; this.body.name = 'crowd-body';
    // weapons: one instanced mesh per (weapon, material)
    this.weapons = {};
    for (const id of Object.keys(WEAPONS)) {
      const { parts, muzzle, box } = weaponParts(id);
      setWeaponBounds(id, box, muzzle);
      const sc = new THREE.Matrix4().makeScale(U.WEAPON_SCALE, U.WEAPON_SCALE, U.WEAPON_SCALE);
      this.weapons[id] = parts.map(({ geometry, material }) => {
        const g = geometry.clone().applyMatrix4(sc);
        const m = mk(g, material, cap, false);
        m.name = `crowd-${id}`;
        return m;
      });
    }
    this.n = 0; this.nf = 0; this.nh = 0;
    this.wn = {};
    this.tmp = new THREE.Matrix4();
  }

  begin() {
    this.n = this.nf = this.nh = 0;
    for (const id in this.weapons) this.wn[id] = 0;
  }

  // world: the unit's world matrix; p: pose() output (unit-local); opts: { body: false } hides
  // the body, visor, pack and feet (first person)
  add(world, p, team, opts = {}) {
    const t = this.tmp;
    if (opts.body !== false && this.n < this.cap) {
      const i = this.n++;
      this.body.setMatrixAt(i, t.multiplyMatrices(world, p.body));
      this.body.instanceColor.setXYZ(i, BODY_COL[team].r, BODY_COL[team].g, BODY_COL[team].b);
      this.visor.setMatrixAt(i, t.multiplyMatrices(world, p.visor));
      this.pack.setMatrixAt(i, t.multiplyMatrices(world, p.pack));
      this.pack.instanceColor.setXYZ(i, PACK_COL[team].r, PACK_COL[team].g, PACK_COL[team].b);
      for (const f of p.feet) {
        if (this.nf >= this.cap * 2) break;
        const j = this.nf++;
        this.foot.setMatrixAt(j, t.multiplyMatrices(world, f));
        this.foot.instanceColor.setXYZ(j, DARK.r, DARK.g, DARK.b);
      }
    }
    for (const h of p.hands) {
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
    fin(this.foot, this.nf); fin(this.hand, this.nh);
    for (const id in this.weapons) for (const m of this.weapons[id]) fin(m, this.wn[id]);
  }
}
