import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { height } from './terrain.js';
import { TEAMS } from './factions.js';
import { Squad } from './ai.js';

// Paradrops: a transport flies a line over the landing zone and its troopers jump from the ramp one after another, fall, open
// canopies and glide down to their own spots in a wedge round the target. The soldiers are ordinary units (Unit.drop carries the
// descent, see updateDrop); this file owns the aircraft, the canopies and the jump line.
export const DROP = {
  alt: 115, // aircraft height over the landing zone (m)
  speed: 78, // aircraft ground speed (m/s)
  run: 330, // how far out the aircraft starts its run
  gap: 0.42, // seconds between troopers leaving the ramp
  fall: 2.6, // free fall before the canopy opens (s)
  open: 46, // the canopy is open by this height above the ground
  sink: 5.2, // canopy descent rate (m/s)
  glide: 8.5, // canopy forward speed at most (m/s)
};

const BODY_COL = TEAMS.map((t) => new THREE.Color(t.body).lerp(new THREE.Color('#c9ccc4'), 0.35));

// ---- the transport: one merged mesh, nose along +z, wings high on the fuselage, four nacelles, a T-tail ---------------------------
function airfoil(chord, thick, span, rotate) {
  // a thin section: a rounded leading edge and a sharp trailing edge
  const c = chord / 2, sh = new THREE.Shape();
  sh.moveTo(-c, 0);
  sh.bezierCurveTo(-c, thick * 0.9, -c * 0.4, thick, c * 0.1, thick * 0.55);
  sh.lineTo(c, 0.04);
  sh.lineTo(c, -0.04);
  sh.lineTo(c * 0.1, -thick * 0.35);
  sh.bezierCurveTo(-c * 0.4, -thick * 0.7, -c, -thick * 0.6, -c, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -span / 2); // symmetric about the centre
  g.rotateY(-Math.PI / 2); // span along x, chord along z, leading edge toward +z
  if (rotate) g.rotateZ(rotate);
  return g;
}
function nacelle(x, y, z) {
  const g = new THREE.LatheGeometry([[0, 1.9], [0.3, 1.8], [0.55, 1.2], [0.6, 0], [0.5, -1.4], [0.25, -2.0], [0, -2.1]].map(([r, h]) => new THREE.Vector2(r, h)), 12);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
let PLANE = null;
function planeGeo() {
  if (PLANE) return PLANE;
  const l = [];
  const body = new THREE.LatheGeometry([[0, 12], [0.9, 11.2], [1.7, 9], [2.05, 5], [2.1, -4], [1.7, -8], [1.0, -11.5], [0.4, -13.2], [0, -13.4]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.95, 1);
  l.push(body);
  const wing = airfoil(4.6, 0.55, 29); wing.translate(0, 1.55, 0.6); l.push(wing);
  const tailplane = airfoil(2.8, 0.3, 11); tailplane.translate(0, 4.6, -11.8); l.push(tailplane);
  const fin = airfoil(3.6, 0.3, 5.6); fin.rotateZ(Math.PI / 2); fin.translate(0, 2.6, -11.0); l.push(fin);
  for (const x of [-9.4, -4.4, 4.4, 9.4]) l.push(nacelle(x, 1.2, 1.9));
  // propeller discs would be invisible at speed; a dark hub ring on each nacelle reads as the intake
  for (const x of [-9.4, -4.4, 4.4, 9.4]) { const r = new THREE.TorusGeometry(0.62, 0.07, 6, 14); r.translate(x, 1.2, 3.8); l.push(r); }
  PLANE = mergeGeometries(l.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; }), false);
  return PLANE;
}

// ---- canopy: a flattened dome of eight gores, with shroud lines down to the soldier's raised hands ----------------------------------
const CANOPY_R = 1.9;
let CANOPY = null;
function canopyGeo() {
  if (CANOPY) return CANOPY;
  const g = new THREE.SphereGeometry(CANOPY_R, 16, 7, 0, Math.PI * 2, 0, Math.PI * 0.46);
  g.scale(1, 0.55, 1);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), p = g.attributes.position;
  for (let i = 0; i < n; i++) { const gore = Math.floor(((Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI * 2) + 1.0625) % 1) * 8); const v = gore % 2 ? 1 : 0.72; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  CANOPY = g;
  return g;
}
const CANOPY_H = 3.5; // the dome's rim height above the soldier's feet
function makeCanopy(team) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: BODY_COL[team], roughness: 0.9, side: THREE.DoubleSide, vertexColors: true });
  const dome = new THREE.Mesh(canopyGeo(), mat);
  dome.position.y = CANOPY_H;
  dome.castShadow = false;
  g.add(dome);
  // eight shroud lines from the rim, drawn in two bundles that meet at the raised hands
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, rim = [Math.cos(a) * CANOPY_R, CANOPY_H, Math.sin(a) * CANOPY_R], hand = [Math.cos(a) > 0 ? 0.17 : -0.17, 1.02, 0.02];
    pts.push(...rim, ...hand);
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#d6d2c4' }));
  g.add(lines);
  g.userData.mat = mat; g.userData.lg = lg; g.userData.lm = lines.material;
  return g;
}

const RING = new THREE.RingGeometry(0.9, 1, 48); RING.rotateX(-Math.PI / 2);

export class Paradrops {
  constructor(battle) {
    this.b = battle;
    this.jobs = [];
    this.spent = []; // canopies of soldiers who have landed, settling to the ground
    this.group = new THREE.Group();
    battle.scene.add(this.group);
  }

  // team drops `kinds` (a list of class ids) on `at`, the aircraft arriving along `dir` (unit vector). The squad is born at the ramp.
  call(team, at, dir, kinds, { lateral = 0 } = {}) {
    const d = new THREE.Vector3(dir.x, 0, dir.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
    d.normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x);
    const pos = new THREE.Vector3(at.x, height(at.x, at.z), at.z).addScaledVector(side, lateral);
    const plane = new THREE.Mesh(planeGeo(), new THREE.MeshStandardMaterial({ color: BODY_COL[team].clone().multiplyScalar(0.85), roughness: 0.6, metalness: 0.25, flatShading: true }));
    plane.castShadow = false; plane.scale.setScalar(0.85); plane.visible = false;
    this.group.add(plane);
    const ring = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color: TEAMS[team].ui, transparent: true, opacity: 0.6, depthWrite: false, fog: false }));
    ring.position.copy(pos).setY(pos.y + 0.25); ring.scale.setScalar(5);
    this.group.add(ring);
    // wedge of landing spots round the target, nose along the run
    const spots = kinds.map((k, i) => {
      const row = Math.floor((i + 1) / 2), s = i % 2 ? 1 : -1;
      return pos.clone().addScaledVector(d, -row * 2.6).addScaledVector(side, s * row * 2.4);
    });
    const alt = Math.max(pos.y, height(pos.x, pos.z)) + DROP.alt;
    // the ramp is a few metres behind the aircraft's centre; free fall carries a jumper on for a while, so the line opens early
    const lead = 22;
    const job = { team, pos, dir: d, side, kinds, spots, alt, t: 0, n: 0, squad: null, troopers: [], ring, plane, lead, started: false, done: false };
    this.jobs.push(job);
    this.b.audio.play('radio', pos, 0.6);
    return job;
  }

  // metres along the run: 0 over the target
  s(j) { return -DROP.run + DROP.speed * j.t; }

  update(dt) {
    const b = this.b;
    for (const f of [...this.spent]) {
      f.t += dt;
      const k = Math.min(1, f.t / 1.4);
      f.c.position.y = f.y + 0.3 - 0.9 * k; f.c.scale.set(1 + 0.5 * k, Math.max(0.05, 1 - 0.95 * k), 1 + 0.5 * k);
      if (k >= 1) { this.group.remove(f.c); this.disposeCanopy(f.c); this.spent.splice(this.spent.indexOf(f), 1); }
    }
    for (const j of [...this.jobs]) {
      j.t += dt;
      const s = this.s(j);
      const p = j.pos.clone().addScaledVector(j.dir, s); p.y = j.alt;
      j.plane.position.copy(p);
      j.plane.rotation.set(0, Math.atan2(j.dir.x, j.dir.z), Math.sin(j.t * 0.7) * 0.03, 'YXZ');
      if (!j.plane.visible && s > -DROP.run) { j.plane.visible = true; b.audio.play('jet', p, 0.7); }
      // troopers leave the ramp on the jump line, starting `lead` metres before the target
      while (j.n < j.kinds.length && j.t >= (DROP.run - j.lead) / DROP.speed + j.n * DROP.gap) this.jump(j, p);
      // canopies follow their soldiers
      for (const q of [...j.troopers]) this.follow(j, q, dt);
      j.ring.material.opacity = 0.35 + 0.25 * Math.sin(b.time * 6);
      j.ring.scale.setScalar(4 + 1.2 * Math.sin(b.time * 3));
      if (s > DROP.run * 0.55) j.plane.visible = false;
      if (j.n >= j.kinds.length && !j.troopers.length && s > DROP.run * 0.55) this.finish(j);
    }
  }

  jump(j, planePos) {
    const b = this.b, i = j.n++, kind = j.kinds[i];
    if (!j.squad) { j.squad = new Squad(b, j.team); b.squads.push(j.squad); }
    const ramp = planePos.clone().addScaledVector(j.dir, -9); ramp.y -= 1.2;
    ramp.addScaledVector(j.side, ((i % 3) - 1) * 0.5);
    const u = b.spawnUnit(j.team, kind, ramp, { squad: j.squad, yaw: Math.atan2(j.dir.x, j.dir.z) });
    u.pos.copy(ramp);
    u.vel.copy(j.dir).multiplyScalar(DROP.speed * 0.38).setY(-1);
    u.grounded = false; u.air = 1;
    u.drop = { phase: 'fall', t: 0, goal: j.spots[i].clone(), open: 0 };
    u.facing = u.aimYaw = Math.atan2(j.dir.x, j.dir.z);
    u.ready = 0;
    const q = { u, canopy: null };
    j.troopers.push(q);
    b.audio.play('clank', ramp, 0.3);
  }

  follow(j, q, dt) {
    const u = q.u, d = u.drop;
    if (!u.alive || u.removed || !d) {
      if (q.canopy) { this.spent.push({ c: q.canopy, t: 0, x: u.pos.x, y: u.pos.y, z: u.pos.z }); q.canopy = null; } // the canopy settles and goes
      j.troopers.splice(j.troopers.indexOf(q), 1);
      return;
    }
    if (d.phase === 'chute') {
      if (!q.canopy) { q.canopy = makeCanopy(j.team); q.canopy.scale.setScalar(0.2); this.group.add(q.canopy); }
      // the canopy blossoms over the opening second, and swings a little under the soldier
      const k = Math.min(1, d.open / 0.9), sw = Math.sin(d.open * 1.7) * 0.045 * (1 - 0.3 * k);
      const sc = 0.2 + 0.8 * (1 - Math.pow(1 - k, 3));
      q.canopy.scale.set(sc, sc * (0.7 + 0.3 * k), sc);
      q.canopy.position.set(u.pos.x, u.pos.y, u.pos.z);
      q.canopy.rotation.set(sw, u.facing, -sw * 0.7, 'YXZ');
    }
  }

  disposeCanopy(c) { c.userData.mat.dispose(); c.userData.lg.dispose(); c.userData.lm.dispose(); }
  dropCanopy(q) { this.group.remove(q.canopy); this.disposeCanopy(q.canopy); q.canopy = null; }

  finish(j) {
    this.jobs = this.jobs.filter((q) => q !== j);
    this.group.remove(j.plane, j.ring);
    j.plane.material.dispose(); j.ring.material.dispose();
    for (const q of j.troopers) if (q.canopy) this.dropCanopy(q);
  }

  clear() {
    for (const j of [...this.jobs]) this.finish(j);
    for (const f of this.spent) { this.group.remove(f.c); this.disposeCanopy(f.c); }
    this.spent.length = 0;
  }
  dispose() { this.clear(); this.b.scene.remove(this.group); }
}
