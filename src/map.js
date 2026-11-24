import { HALF } from './world.js';
import { baseAt } from './battle.js';
import { setupTerrain, mountTerrain, height, slopeAt, nearRoad, layout, POINTS, POINT_R } from './terrain.js';
import { buildTrees } from './trees.js';
import { buildDecor } from './decor.js';

// Lays out the field over the terrain: a ruined village at C, bunkered hilltops at A and D,
// farms with walled fields and orchards at B and E, woods on the slopes, rocks, field walls and
// scattered cover. The landscape is the same every battle; the loose cover shuffles with the seed.
export function buildMap(battle, { seed = 7, teams = 2, points = true } = {}) {
  const bases = Array.from({ length: teams }, (_, i) => baseAt(i, teams));
  setupTerrain(bases);
  mountTerrain(battle.scene);
  for (const t of battle.teams) t.base.y = height(t.base.x, t.base.z);

  // fixed layout randomness, and a per-battle one for loose cover
  const rng = (s0) => { let s = s0 * 9973 + 17; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
  const fixed = rng(7), loose = rng(seed);
  const P = (t, x, z, y = 0) => battle.spawnProp(t, x, z, y);
  const keep = []; // [x, z, r] spots to keep clear
  const EDGE = HALF - 4;
  const clear = (x, z, r) => keep.every(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) > kr + r);
  const inside = (x, z, m = 0) => Math.abs(x) < EDGE - m && Math.abs(z) < EDGE - m;
  // ground level enough for something about `r` across
  const level = (x, z, r, rise = 0.45) => {
    const h = [height(x - r, z - r), height(x + r, z - r), height(x - r, z + r), height(x + r, z + r), height(x, z)];
    return Math.max(...h) - Math.min(...h) < rise;
  };
  const Lx = (x, z, yaw, lx, lz) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];

  // ---- control points
  for (const p of POINTS) {
    if (points) battle.addPoint(p.name, p.x, p.z, POINT_R);
    keep.push([p.x, p.z, POINT_R - 1]);
  }
  if (points) battle.points.sort((a, b) => a.name.localeCompare(b.name));
  const C = POINTS[0];
  // the village: a sandbagged crossroads with ruined houses round it
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + 0.5;
    P('sandbags', C.x + Math.cos(a) * 5.2, C.z + Math.sin(a) * 5.2, -a + Math.PI / 2);
  }
  P('crate', C.x + 1.6, C.z + 1.1, 0.3); P('crate', C.x - 1.9, C.z - 0.9, 1.1); P('drum', C.x + 2.2, C.z - 2.1);
  P('ruinLow', C.x - 3.3, C.z + 3.6, 0.6);
  let houses = 0;
  for (let k = 0; k < 120 && houses < 15; k++) {
    const a = fixed() * Math.PI * 2, r = 12 + fixed() * 22;
    const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    if (nearRoad(x, z) < 4.5 || !clear(x, z, 4.5) || !level(x, z, 3.5, 0.9)) continue;
    house(x, z, Math.round((a + Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2) + (fixed() - 0.5) * 0.2);
    houses++;
  }

  for (const p of POINTS.slice(1)) {
    if (p.theme === 'depot') {
      // supply depot: concrete walls, barrier lines, stacked crates and fuel drums, open ground for vehicles
      const a = Math.atan2(-p.z, -p.x);
      for (const k of [-1, 1]) P('slab', p.x + Math.sin(a) * k * 7, p.z - Math.cos(a) * k * 7, a);
      for (let i = 0; i < 4; i++) P('barrier', p.x + Math.cos(a + 2.2 + i * 0.4) * 11, p.z + Math.sin(a + 2.2 + i * 0.4) * 11, -(a + 2.2 + i * 0.4) + Math.PI / 2);
      for (let i = 0; i < 5; i++) P('crate', p.x + 2.5 + (i % 3) * 0.9, p.z + 1.5 + Math.floor(i / 3) * 0.7, i * 0.4);
      for (let i = 0; i < 4; i++) P('drum', p.x - 3 + i * 0.7, p.z - 2.4 + (i % 2) * 0.6);
      P('bunker', p.x - Math.cos(a) * 6, p.z - Math.sin(a) * 6, a);
    } else if (p.theme === 'hill') {
      // hilltop: a bunker, sandbag arcs looking down both slopes, boulders round the crown
      const off = Math.atan2(p.z, p.x);
      P('bunker', p.x + Math.cos(off) * 2.5, p.z + Math.sin(off) * 2.5, off);
      for (let i = 0; i < 4; i++) {
        const a = off + Math.PI * 0.75 + i * 0.5;
        P('sandbags', p.x + Math.cos(a) * 6.3, p.z + Math.sin(a) * 6.3, -a + Math.PI / 2);
      }
      P('crate', p.x - 1.5, p.z + 1.2, 0.4); P('drum', p.x - 2.4, p.z - 0.4);
      for (let i = 0; i < 8; i++) {
        const a = fixed() * Math.PI * 2, r = POINT_R + 3 + fixed() * 6;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (nearRoad(x, z) > 2 && clear(x, z, 1.5)) { P('rock', x, z, fixed() * Math.PI); keep.push([x, z, 1.5]); }
      }
    } else {
      // farm: a ruined farmhouse, low walls, an orchard
      const off = Math.atan2(p.z, p.x);
      P('ruinLow', p.x + Math.cos(off + 1.2) * 4.5, p.z + Math.sin(off + 1.2) * 4.5, -off - 1.2 + Math.PI / 2);
      P('sandbags', p.x + Math.cos(off - 1.5) * 4.8, p.z + Math.sin(off - 1.5) * 4.8, -off + 1.5 + Math.PI / 2);
      P('crate', p.x + 1.2, p.z - 1.4, 0.2); P('crate', p.x + 1.9, p.z - 0.7, 0.9);
      for (let k = 0; k < 20; k++) {
        const a = off + (fixed() - 0.5) * 2.4, r = 14 + fixed() * 5;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (nearRoad(x, z) < 4.5 || !clear(x, z, 4.5) || !level(x, z, 3.5, 0.9) || !inside(x, z, 4)) continue;
        house(x, z, -a + (fixed() - 0.5) * 0.3);
        break;
      }
    }
  }

  // ---- home bases: a line of barriers facing the field, crates either side
  for (const b of bases) {
    keep.push([b.x, b.z, 16]);
    const f = Math.atan2(-b.x, -b.z);
    const fx = Math.sin(f), fz = Math.cos(f);
    const rx = Math.cos(f), rz = -Math.sin(f);
    for (const k of [-2, -1, 1, 2]) P('barrier', b.x + fx * 9 + rx * k * 3.6, b.z + fz * 9 + rz * k * 3.6, f + Math.PI / 2 + 0.08 * k);
    P('crate', b.x + rx * 7, b.z + rz * 7, f); P('crate', b.x - rx * 7.5, b.z - rz * 7.5, f + 0.3);
    P('wall', b.x - fx * 3 + rx * 5, b.z - fz * 3 + rz * 5, f + 0.2);
  }

  // ---- trees: woods on the slopes, roadside trees, orchards by the farms
  const trees = [];
  const treeOK = (x, z, gap) => inside(x, z, 1) && nearRoad(x, z) > 1.8 && clear(x, z, 1) && trees.every((t) => Math.hypot(t.x - x, t.z - z) > gap)
    && POINTS.every((p) => Math.hypot(x - p.x, z - p.z) > POINT_R + 3) && layout.bases.every((b) => Math.hypot(x - b.x, z - b.z) > 16);
  const tree = (x, z, kind, s) => { trees.push({ x, z, kind, s, yaw: fixed() * Math.PI * 2 }); };
  let woods = 0;
  for (let k = 0; k < 400 && woods < 30; k++) {
    const x = (fixed() * 2 - 1) * (EDGE - 6), z = (fixed() * 2 - 1) * (EDGE - 6);
    if (nearRoad(x, z) < 7 || POINTS.some((p) => Math.hypot(x - p.x, z - p.z) < 20) || layout.bases.some((b) => Math.hypot(x - b.x, z - b.z) < 26)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 18)) continue;
    woods++;
    const n = 9 + Math.floor(fixed() * 10), R = 7 + fixed() * 6;
    for (let i = 0, tries = 0; i < n && tries < 60; tries++) {
      const a = fixed() * Math.PI * 2, r = Math.sqrt(fixed()) * R;
      const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
      if (!treeOK(tx, tz, 2.4)) continue;
      tree(tx, tz, fixed() < 0.8 ? 'fir' : 'leaf', 0.75 + fixed() * 0.45);
      i++;
    }
  }
  for (const r of layout.roads) {
    if (r.kind !== 'road') continue;
    for (let i = 2; i < r.pts.length - 1; i += 3) {
      if (fixed() < 0.45) continue;
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az) || 1, side = fixed() < 0.5 ? -1 : 1;
      const x = r.pts[i][0] + (-(bz - az) / l) * side * (r.w + 2.6), z = r.pts[i][1] + ((bx - ax) / l) * side * (r.w + 2.6);
      if (treeOK(x, z, 5)) tree(x, z, 'leaf', 0.7 + fixed() * 0.25);
    }
  }
  for (const p of POINTS.filter((q) => q.theme === 'farm')) {
    // orchard rows on the far side of the farm from the village
    const a = Math.atan2(p.z, p.x) + 0.9;
    const ox = p.x + Math.cos(a) * 17, oz = p.z + Math.sin(a) * 17;
    for (let i = -2; i <= 2; i++) for (let j = -1; j <= 2; j++) {
      const [x, z] = Lx(ox, oz, a, i * 3.6, j * 3.6);
      if (treeOK(x, z, 2.5)) tree(x + (fixed() - 0.5) * 0.4, z + (fixed() - 0.5) * 0.4, 'leaf', 0.55 + fixed() * 0.15);
    }
  }
  for (let i = 0, tries = 0; i < 120 && tries < 1200; tries++) {
    const x = (fixed() * 2 - 1) * EDGE, z = (fixed() * 2 - 1) * EDGE;
    if (treeOK(x, z, 6)) { tree(x, z, fixed() < 0.5 ? 'fir' : 'leaf', 0.7 + fixed() * 0.4); i++; }
  }
  // hills beyond the fence get trees too (no colliders)
  const far = [];
  for (let i = 0; i < 220; i++) {
    const a = fixed() * Math.PI * 2, r = HALF + 6 + fixed() * 90;
    const x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r * 1.1;
    if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 4) continue;
    far.push({ x, z, kind: fixed() < 0.75 ? 'fir' : 'leaf', s: 0.9 + fixed() * 0.6, yaw: fixed() * 6.3 });
  }
  const treeGroup = buildTrees([...trees, ...far]);
  battle.scene.add(treeGroup);
  battle.decor.push(treeGroup);
  for (const t of trees) { P('tree', t.x, t.z, t.yaw); keep.push([t.x, t.z, 1]); }

  const decor = buildDecor(battle);
  battle.scene.add(decor);
  battle.decor.push(decor);

  // ---- field walls: short dry-stone runs with gaps, along level ground
  for (let k = 0, runs = 0; k < 240 && runs < 28; k++) {
    const x0 = (fixed() * 2 - 1) * (EDGE - 8), z0 = (fixed() * 2 - 1) * (EDGE - 8);
    if (nearRoad(x0, z0) < 3 || !clear(x0, z0, 3) || POINTS.some((p) => Math.hypot(x0 - p.x, z0 - p.z) < POINT_R + 2)) continue;
    runs++;
    let yaw = fixed() * Math.PI, x = x0, z = z0;
    const n = 3 + Math.floor(fixed() * 6);
    for (let i = 0; i < n; i++) {
      const dx = Math.cos(yaw) * 3.15, dz = -Math.sin(yaw) * 3.15;
      const ok = fixed() > 0.18 && inside(x, z) && nearRoad(x, z) > 1.2 && clear(x, z, 1.7) && Math.abs(height(x + dx / 2, z + dz / 2) - height(x - dx / 2, z - dz / 2)) < 0.35;
      if (ok) { P('stonewall', x, z, yaw); keep.push([x, z, 1.7]); }
      x += dx; z += dz;
      yaw += (fixed() - 0.5) * 0.25;
    }
  }

  // ---- boulders where the ground breaks
  for (let i = 0, tries = 0; i < 46 && tries < 900; tries++) {
    const x = (fixed() * 2 - 1) * EDGE, z = (fixed() * 2 - 1) * EDGE;
    if (slopeAt(x, z) < 0.18 && fixed() < 0.85) continue;
    if (nearRoad(x, z) < 1.5 || !clear(x, z, 1.6)) continue;
    P('rock', x, z, fixed() * Math.PI); keep.push([x, z, 1.6]); i++;
  }

  // ---- loose cover, shuffled each battle
  let placed = 0, tries = 0;
  while (placed < 190 && tries++ < 4000) {
    const x = (loose() * 2 - 1) * (EDGE - 4), z = (loose() * 2 - 1) * (EDGE - 4);
    if (!clear(x, z, 2.6) || !level(x, z, 2, 0.4) || nearRoad(x, z) < 0.5) continue;
    keep.push([x, z, 2.6]);
    placed++;
    const kind = loose();
    const yaw = loose() * Math.PI;
    if (kind < 0.3) { P('sandbags', x, z, yaw); P('sandbags', x + Math.cos(yaw + 0.9) * 2.6, z - Math.sin(yaw + 0.9) * 2.6, yaw + 0.9); }
    else if (kind < 0.45) { P('ruinLow', x, z, yaw); if (loose() < 0.5) P('crate', x + Math.sin(yaw) * 1.2, z + Math.cos(yaw) * 1.2, yaw); }
    else if (kind < 0.58) { P('barrier', x, z, yaw); P('barrier', x + Math.cos(yaw) * 3.4, z - Math.sin(yaw) * 3.4, yaw + 0.15); }
    else if (kind < 0.7) { P('crate', x, z, yaw); P('crate', x + 1.5, z + 0.4, yaw + 0.3); if (loose() < 0.6) P('drum', x - 1, z + 1.2); }
    else if (kind < 0.8) { P('trap', x, z, yaw); P('trap', x + 2.6, z + 1.2, yaw + 1); }
    else if (kind < 0.9) { P('wall', x, z, yaw); P('sandbags', x + Math.sin(yaw) * 1.5, z + Math.cos(yaw) * 1.5, yaw); }
    else P('bunker', x, z, yaw);
  }

  // ---- ruined hamlets scattered over the open ground, so no stretch of the field is bare
  for (let k = 0, hamlets = 0; k < 200 && hamlets < 7; k++) {
    const hx = (fixed() * 2 - 1) * (EDGE - 14), hz = (fixed() * 2 - 1) * (EDGE - 14);
    if (nearRoad(hx, hz) < 6 || !clear(hx, hz, 12) || !level(hx, hz, 8, 1.4)) continue;
    hamlets++;
    keep.push([hx, hz, 10]);
    const n = 2 + Math.floor(fixed() * 3);
    for (let i = 0, t = 0; i < n && t < 30; t++) {
      const a = fixed() * Math.PI * 2, r = 4 + fixed() * 8, x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      if (!clear(x, z, 4.5) || !level(x, z, 3.5, 0.9) || nearRoad(x, z) < 4 || !inside(x, z, 4)) continue;
      house(x, z, Math.round(a / (Math.PI / 2)) * (Math.PI / 2) + (fixed() - 0.5) * 0.3);
      i++;
    }
  }

  // ---- trench lines: broken runs of sandbags and wrecked walls to fight from and move between
  for (let k = 0, lines = 0; k < 300 && lines < 14; k++) {
    let x = (fixed() * 2 - 1) * (EDGE - 10), z = (fixed() * 2 - 1) * (EDGE - 10);
    if (nearRoad(x, z) < 3 || !clear(x, z, 2.5) || POINTS.some((p) => Math.hypot(x - p.x, z - p.z) < POINT_R)) continue;
    lines++;
    const yaw = fixed() * Math.PI, dx = Math.cos(yaw) * 2.5, dz = -Math.sin(yaw) * 2.5;
    const n = 5 + Math.floor(fixed() * 6);
    for (let i = 0; i < n; i++) {
      if (fixed() > 0.2 && inside(x, z, 2) && nearRoad(x, z) > 1.5 && clear(x, z, 1.2) && level(x, z, 1.2, 0.4)) {
        P(fixed() < 0.75 ? 'sandbags' : 'ruinLow', x, z, yaw);
        keep.push([x, z, 1.2]);
        if (fixed() < 0.25) P('crate', x - Math.sin(yaw) * 1.6, z - Math.cos(yaw) * 1.6, yaw + 0.3); // supplies behind the line
      }
      x += dx; z += dz;
    }
  }

  // A ruined house, open on two sides so soldiers can walk through: a tall back wall, a side
  // wall, a broken front wall, and some rubble inside.
  function house(x, z, yaw) {
    const at = (lx, lz) => Lx(x, z, yaw, lx, lz);
    const piece = (t, lx, lz, turn = 0) => { const [px, pz] = at(lx, lz); P(t, px, pz, yaw + turn); };
    piece('ruin', -1.3, -2.6);
    piece('ruinLow', 2.3, -2.6);
    piece('ruin', -3.5, 0.0, Math.PI / 2);
    piece('ruinLow', 1.8, 2.6);
    piece('crate', 0.2, -1.4, 0.3);
    if (fixed() < 0.6) piece('drum', -2.4, 1.6);
    keep.push([x, z, 5]);
  }
}
