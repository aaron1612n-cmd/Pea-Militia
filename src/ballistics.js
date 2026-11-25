import * as THREE from 'three';
import { rayBox } from './physics.js';

// Bullet physics shared by every shooter, player and AI alike: rounds fly as real projectiles
// (muzzle velocity, drag, gravity drop), lose punch with range, and meet cover by material.

export const GRAVITY = 9.8;
export const MAX_BULLETS = 110;

// depth: metres a full-power round punches through. ric: grazing sine below which it skips off.
// absorb: how much of a blast wave the material soaks up per metre. fx: impact style.
export const MATERIALS = {
  sand: { depth: 0.55, ric: 0.0, absorb: 2.4, fx: 'sand', snd: 'thwack' },
  wood: { depth: 0.9, ric: 0.1, absorb: 1.6, fx: 'wood', snd: 'thwack' },
  stone: { depth: 0.2, ric: 0.32, absorb: 5, fx: 'stone', snd: 'crunch' },
  steel: { depth: 0.07, ric: 0.45, absorb: 7, fx: 'metal', snd: 'ping' },
  drum: { depth: 0.5, ric: 0.3, absorb: 1.2, fx: 'metal', snd: 'ping' },
  earth: { depth: 0.25, ric: 0.15, absorb: 4, fx: 'dust', snd: 'thud' },
};
const BY_TYPE = {
  sandbags: 'sand', crate: 'wood', tree: 'wood', drum: 'drum', wall: 'steel', trap: 'steel',
  barrier: 'stone', slab: 'stone', bunker: 'stone', ruin: 'stone', ruinLow: 'stone', stonewall: 'stone', rock: 'stone', rubble: 'stone',
};
export const materialOf = (prop) => MATERIALS[BY_TYPE[prop.type]] || MATERIALS.stone;

// Defaults for anything that fires hitscan-style without its own numbers (vehicle guns).
export function ballistics(def) {
  return {
    mv: def.mv || 300, drag: def.drag ?? 0.15, pow: def.pow ?? 1.4,
    fall: def.fall || [45, 0.6], tracerEvery: def.tracerEvery ?? 1,
  };
}

// How far a round drops over t seconds of flight once drag is counted.
export function flightTime(dist, mv, drag) {
  let t = dist / mv;
  for (let i = 0; i < 3; i++) t = dist / (mv * (drag * t > 1e-4 ? (1 - Math.exp(-drag * t)) / (drag * t) : 1));
  return t;
}
export const dropAfter = (t) => 0.5 * GRAVITY * t * t;

// Where an AI gunner should point to hit a moving target: lead along its velocity and
// aim high for drop. skill (about 0.6..1.6) decides how much of the correction they make.
export function leadPoint(out, muzzle, aim, tv, def, skill = 1) {
  const { mv, drag } = ballistics(def);
  const k = Math.min(1, 0.4 + 0.4 * skill), kd = Math.min(1, 0.55 + 0.4 * skill);
  const vx = tv?.x || 0, vz = tv?.z || 0;
  let t = muzzle.distanceTo(aim) / mv;
  for (let i = 0; i < 3; i++) {
    const dx = aim.x + vx * t * k - muzzle.x, dy = aim.y - muzzle.y, dz = aim.z + vz * t * k - muzzle.z;
    t = flightTime(Math.hypot(dx, dy, dz), mv, drag);
  }
  return out.set(aim.x + vx * t * k, aim.y + dropAfter(t) * kd, aim.z + vz * t * k);
}

// Upward tilt that makes a round cross the line of sight at the weapon's zero range.
export function zeroAngle(def) {
  const { mv, drag } = ballistics(def);
  const zr = def.zero || 30;
  return dropAfter(flightTime(zr, mv, drag)) / zr;
}

// Damage of a round at its current distance and speed.
export function bulletDamage(b) {
  const def = b.def, [start, minK] = b.fall;
  const far = Math.max(start + 1, def.range * 1.4);
  const u = Math.min(1, Math.max(0, (b.dist - start) / (far - start)));
  const k = 1 - (1 - minK) * u * u * (3 - 2 * u);
  const s = Math.min(1, b.vel.length() / b.mv);
  return def.damage * k * b.dmgK * (0.55 + 0.45 * s * s);
}

// Thickness of a box along a ray that has just entered it at `entry`.
const _far = new THREE.Vector3(), _back = new THREE.Vector3();
export function chord(box, entry, d) {
  _far.copy(entry).addScaledVector(d, 8);
  const h = rayBox(_far, _back.copy(d).negate(), 9, box);
  return h ? Math.max(0.02, 8 - h.t) : 0.1;
}
