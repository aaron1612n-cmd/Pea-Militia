// Reach probe: arm stretch for each gun in each stance (1.0 = arms reach without stretching).
import * as THREE from 'three';
import { pose, makePose, solveArms, setWeaponBounds, U } from '../src/rig.js';
import { weaponParts, SLOTS } from '../src/weapons.js';
for (const id of SLOTS) { if (id === 'grenade') continue; const { muzzle, box, sight } = weaponParts(id); setWeaponBounds(id, box, muzzle, sight); }
const sh = [new THREE.Vector3(U.SH_X, U.SH_Y, -0.005), new THREE.Vector3(-U.SH_X, U.SH_Y, -0.005)];
const v = new THREE.Vector3(), reach = U.ARM[0] + U.ARM[1];
const states = { idle: {}, walk: { walk: 1, speed: 1.4 }, run: { walk: 1, speed: 4.2 }, reload: { reload: 0.5 }, kneel: { kneel: 1 }, ads: { ads: 1, fp: 1 } };
for (const id of SLOTS) { if (id === 'grenade') continue;
  const row = [];
  for (const [n, o] of Object.entries(states)) {
    let worst = 0;
    for (const cyc of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const p = pose({ t: 1, ready: 1, weapon: id, mx: 0, mz: 1, cycle: cyc, ...o }, makePose());
      for (let i = 0; i < 2; i++) { v.setFromMatrixPosition(p.hands[i]); const d = v.distanceTo(sh[i].clone().applyMatrix4(p.body)); worst = Math.max(worst, d / reach); }
    }
    row.push(`${n} ${worst.toFixed(2)}`);
  }
  console.log(id.padEnd(9), row.join('  '));
}
