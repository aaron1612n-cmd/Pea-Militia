import * as THREE from 'three';
import { canvasTex } from './effects.js';
import { U } from './rig.js';
import { HALF } from './wounds.js';

// Bullet holes, scorch and dents on what a round actually hit: the helmet, the vest and gear,
// the pack, a limb, or the strider's plating. Soldiers' marks are stored in the local frame of
// the part they hit (so they ride the head, arm or leg as it moves) and drawn by the crowd.
export const MAX_MARKS = 16;
const TAU = Math.PI * 2;

// one tile: a scorched halo, a bright torn rim and a black pit
let _tex = null;
export function markTexture() {
  return (_tex ||= canvasTex(128, (g, S) => {
    const h = S / 2, rnd = Math.random;
    const gr = g.createRadialGradient(h, h, S * 0.08, h, h, h * 0.98);
    gr.addColorStop(0, 'rgba(18,14,10,0.92)'); gr.addColorStop(0.5, 'rgba(24,18,12,0.55)'); gr.addColorStop(1, 'rgba(24,18,12,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(h, h, h * 0.98, 0, TAU); g.fill();
    // torn rim: bare bright metal with petals
    g.fillStyle = '#b9b5a8'; g.beginPath();
    for (let i = 0; i <= 18; i++) { const a = (i / 18) * TAU, r = S * (0.17 + rnd() * 0.06); g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = '#050403'; g.beginPath();
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * TAU, r = S * (0.1 + rnd() * 0.03); g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(200,196,185,0.5)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { const a = rnd() * TAU, r0 = S * 0.18, r1 = S * (0.26 + rnd() * 0.14); g.beginPath(); g.moveTo(h + Math.cos(a) * r0, h + Math.sin(a) * r0); g.lineTo(h + Math.cos(a) * r1, h + Math.sin(a) * r1); g.stroke(); }
  }));
}
// a hit on cloth, webbing or a limb: frayed fibres round a wet dark-red hole with a blood halo. No metal, no black.
let _wtex = null;
export function woundMarkTexture() {
  return (_wtex ||= canvasTex(128, (g, S) => {
    const h = S / 2, rnd = Math.random;
    const gr = g.createRadialGradient(h, h, S * 0.05, h, h, h * 0.98);
    gr.addColorStop(0, 'rgba(92,10,10,0.9)'); gr.addColorStop(0.45, 'rgba(78,10,10,0.55)'); gr.addColorStop(1, 'rgba(70,10,10,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(h, h, h * 0.98, 0, TAU); g.fill();
    // frayed threads, pulled out of the weave
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU, r0 = S * 0.12, r1 = S * (0.2 + rnd() * 0.16);
      g.strokeStyle = i % 3 ? 'rgba(52,56,48,0.85)' : 'rgba(96,30,24,0.8)'; g.lineWidth = 1 + rnd() * 1.6;
      g.beginPath(); g.moveTo(h + Math.cos(a) * r0, h + Math.sin(a) * r0); g.lineTo(h + Math.cos(a + (rnd() - 0.5) * 0.4) * r1, h + Math.sin(a + (rnd() - 0.5) * 0.4) * r1); g.stroke();
    }
    // the tear: a ragged ring of torn cloth over wet flesh
    g.fillStyle = '#3d1210'; g.beginPath();
    for (let i = 0; i <= 18; i++) { const a = (i / 18) * TAU, r = S * (0.14 + rnd() * 0.05); g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = '#6e0d0d'; g.beginPath();
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * TAU, r = S * (0.09 + rnd() * 0.035); g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = '#2b0505'; g.beginPath();
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * TAU, r = S * (0.045 + rnd() * 0.02); g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r); }
    g.closePath(); g.fill();
    for (let i = 0; i < 9; i++) { const a = rnd() * TAU, d = S * (0.2 + rnd() * 0.2), r = 1 + rnd() * 2.6; g.fillStyle = 'rgba(100,12,12,0.9)'; g.beginPath(); g.arc(h + Math.cos(a) * d, h + Math.sin(a) * d, r, 0, TAU); g.fill(); }
  }));
}
export function woundMarkMaterial() {
  return new THREE.MeshStandardMaterial({ map: woundMarkTexture(), alphaTest: 0.25, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}
export function markMaterial() {
  return new THREE.MeshStandardMaterial({ map: markTexture(), alphaTest: 0.3, roughness: 0.55, metalness: 0.45, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}

// part ids: 0 body, 1 head, 2 pack, 3..6 legs [k][s], 7..10 arms [k][s]
export const partMatrix = (p, id) => (id === 0 ? p.body : id === 1 ? p.head : id === 2 ? p.pack : id < 7 ? p.legs[(id - 3) >> 1][(id - 3) & 1] : p.arms[(id - 7) >> 1][(id - 7) & 1]);
const LIMB_R = [0.052, 0.04, 0.036, 0.029]; // thigh, shin, upper arm, forearm (+ sleeve)
const _q = new THREE.Vector3(), _inv = new THREE.Matrix4(), _w = new THREE.Matrix4();

// Record a hit on a soldier. point/dir in world; zone from Battle.hitZone narrows the choice.
export function markUnit(u, point, dir, zone, kind = 'bullet', size = 0.05) {
  const p = u.poseOut;
  if (!p) return;
  const list = u.marks || (u.marks = []);
  let best = null;
  const cand = (id, pt, n, d) => { if (!best || d < best.d) best = { id, pt, n, d }; };
  const probe = (id) => { _inv.copy(_w.multiplyMatrices(u.world, partMatrix(p, id))).invert(); return _q.copy(point).applyMatrix4(_inv); };
  // torso: nearest point on the shell, pushed out past the vest
  { const q = probe(0).clone();
    const cx = Math.max(-HALF[0], Math.min(HALF[0], q.x)), cy = Math.max(-HALF[1], Math.min(HALF[1], q.y)), cz = Math.max(-HALF[2], Math.min(HALF[2], q.z));
    const n = new THREE.Vector3(q.x - cx, q.y - cy, q.z - cz); const l = n.length() || 1; n.divideScalar(l);
    cand(0, new THREE.Vector3(cx, cy, cz).addScaledVector(n, U.R + 0.02), n, Math.abs(l - U.R - 0.02)); }
  // head: the helmet dome
  { const q = probe(1).clone(); const c = new THREE.Vector3(0, 0.105, 0); const n = q.sub(c); const l = n.length() || 1; n.divideScalar(l);
    cand(1, c.clone().addScaledVector(n, 0.108), n, Math.abs(l - 0.108) + (zone === 'head' ? -1 : 0.01)); }
  // pack: a box behind the shoulders
  { const q = probe(2).clone(); const hx = U.PACK[0] / 2 + 0.02, hy = U.PACK[1] / 2 + 0.02, hz = U.PACK[2] / 2 + 0.02;
    const ax = Math.abs(q.x) / hx, ay = Math.abs(q.y) / hy, az = Math.abs(q.z) / hz, m = Math.max(ax, ay, az);
    const n = new THREE.Vector3(m === ax ? Math.sign(q.x) : 0, m === ay ? Math.sign(q.y) : 0, m === az ? Math.sign(q.z) : 0);
    const pt = new THREE.Vector3(Math.max(-hx, Math.min(hx, q.x)), Math.max(-hy, Math.min(hy, q.y)), Math.max(-hz, Math.min(hz, q.z)));
    if (n.x) pt.x = n.x * hx; else if (n.y) pt.y = n.y * hy; else pt.z = n.z * hz;
    cand(2, pt, n, pt.distanceTo(q) + 0.01); }
  // limbs: capsules along each segment
  if (zone === 'arm' || zone === 'leg' || zone === 'torso') for (let id = 3; id < 11; id++) {
    const q = probe(id).clone(), r = LIMB_R[id < 7 ? (id - 3) & 1 : 2 + ((id - 7) & 1)];
    const z = Math.max(-0.1, Math.min(0.1, q.z)); const n = new THREE.Vector3(q.x, q.y, 0); const l = n.length() || 1; n.divideScalar(l);
    cand(id, new THREE.Vector3(n.x * r, n.y * r, z), n, Math.hypot(l - r, q.z - z) + (zone === 'torso' ? 0.05 : 0));
  }
  if (!best) return;
  list.push({ id: best.id, w: best.id !== 1, p: best.pt, n: best.n, s: size * (0.85 + Math.random() * 0.4), r: Math.random() * TAU });
  while (list.length > MAX_MARKS) list.shift();
}

// Put a mark on a vehicle: on the mesh the ray struck, so it rides with turret and legs.
const _rc = new THREE.Raycaster(), _geo = new THREE.PlaneGeometry(1, 1), _mat = markMaterial();
const _z = new THREE.Vector3(0, 0, 1), _nq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
export function markVehicle(v, from, dir, size = 0.18) {
  const targets = v.parts?.hitMeshes || v.parts?.meshes;
  if (!v.group || !targets) return null;
  v.group.updateMatrixWorld(true);
  _rc.set(from, dir); _rc.far = 400;
  const h = _rc.intersectObjects(targets, false)[0];
  if (!h?.face) return null;
  // a skinned body is one mesh: the mark rides the joint that carries the triangle it hit (a thigh, the turret)
  let obj = h.object;
  const n = h.face.normal.clone().transformDirection(obj.matrixWorld);
  if (obj.isSkinnedMesh) {
    const si = obj.geometry.attributes.skinIndex, sw = obj.geometry.attributes.skinWeight;
    const vi = [h.face.a, h.face.b, h.face.c].reduce((best, i) => (sw.getX(i) > sw.getX(best) ? i : best), h.face.a);
    obj = obj.skeleton.bones[si.getX(vi)];
  }
  const m = new THREE.Mesh(_geo, _mat);
  m.position.copy(obj.worldToLocal(h.point.clone().addScaledVector(n, 0.012)));
  // orient in world, then bring into the mesh's frame
  _nq.setFromUnitVectors(_z, n); _rq.setFromAxisAngle(n, Math.random() * TAU); _nq.premultiply(_rq);
  obj.getWorldQuaternion(_rq); m.quaternion.copy(_rq.invert().multiply(_nq));
  const ws = obj.getWorldScale(new THREE.Vector3()).x || 1;
  m.scale.setScalar(size * (0.8 + Math.random() * 0.5) / ws);
  m.renderOrder = 2;
  obj.add(m);
  const list = v.marks || (v.marks = []);
  list.push(m);
  if (list.length > 70) { const o = list.shift(); o.parent?.remove(o); }
  return m;
}
