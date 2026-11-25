import { LOD } from './shapes.js';
import { helmetGeo, HELMET_KINDS, limbGeo, bootGeo, handGeos, pelvisGeo, deltGeo } from './anatomy.js';
import { gearPieces, KIND_IDS } from './gear.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Cheap copies of every soldier part for the middle and far distance. The same builders that make the
// near-detail parts are run again with the shape toolkit's quality turned down (fewer sides on every ring,
// fewer rows and columns on every plate), so the lite soldier is the same soldier with less skin on it.
const build = (q, fn) => { LOD.q = q; try { return fn(); } finally { LOD.q = 1; } };
let cache = null;
export function liteGeos() {
  if (cache) return cache;
  const hands = build(0.3, handGeos);
  cache = {
    helmets: build(0.25, () => Object.fromEntries(HELMET_KINDS.map((k) => [k, helmetGeo(k)]))),
    limbs: build(0.3, () => ({ thigh: limbGeo('thigh'), shin: limbGeo('shin'), upperArm: limbGeo('upperArm'), foreArm: limbGeo('foreArm') })),
    boot: build(0.2, () => mergeGeometries([bootGeo('foot'), bootGeo('toe')], false)), // one piece: no toe hinge at a distance
    pelvis: build(0.3, pelvisGeo),
    delt: build(0.3, deltGeo),
    hands: { L: hands.left, R: hands.right, G: hands.leftGrip, oL: hands.openL, oR: hands.openR },
    // kit: the big pieces only (plates, belt, pouches, straps); buckles, cartridges and the like are under a pixel here
    gear: Object.fromEntries(KIND_IDS.map((k) => [k, build(0.2, () => {
      const keep = gearPieces(k).pieces.filter((g) => { g.computeBoundingBox(); const b = g.boundingBox; return Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) >= 0.06; });
      return mergeGeometries(keep, false);
    })])),
  };
  return cache;
}
