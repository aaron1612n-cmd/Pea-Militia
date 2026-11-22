import { HALF } from './world.js';
import { baseAt } from './battle.js';

// Lays out the field: five control points (one in the middle, four around it), a strongpoint
// at each, scattered cover in between and a little cover at each home base. Seeded, so the
// same seed gives the same field.
export function buildMap(battle, { seed = 7, teams = 2, points = true } = {}) {
  let s = seed * 9973 + 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const R = (a, b) => a + rnd() * (b - a);
  const P = (t, x, z, y = 0) => battle.spawnProp(t, x, z, y);
  const bases = Array.from({ length: teams }, (_, i) => baseAt(i, teams));
  const pts = [[0, 0]];
  const ring = 38;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    pts.push([Math.cos(a) * ring, Math.sin(a) * ring]);
  }
  const names = ['C', 'A', 'B', 'D', 'E'];
  const keep = []; // spots to keep clear
  pts.forEach(([x, z], i) => {
    if (points) battle.addPoint(names[i], x, z, 8);
    keep.push([x, z, 5]);
    strongpoint(P, x, z, i === 0 ? 'center' : rnd() < 0.5 ? 'bunker' : 'walls', R);
  });
  if (points) battle.points.sort((a, b) => a.name.localeCompare(b.name));
  for (const b of bases) {
    keep.push([b.x, b.z, 10]);
    const f = Math.atan2(-b.x, -b.z);
    const fx = Math.sin(f), fz = Math.cos(f);
    const rx = Math.cos(f), rz = -Math.sin(f);
    for (const k of [-1, 0, 1]) P('barrier', b.x + fx * 9 + rx * k * 6, b.z + fz * 9 + rz * k * 6, f + Math.PI / 2 + 0.1 * k);
    P('crate', b.x + rx * 7, b.z + rz * 7, f); P('crate', b.x - rx * 7.5, b.z - rz * 7.5, f + 0.3);
  }
  // scattered cover clusters
  const clear = (x, z, r) => keep.every(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) > kr + r);
  let placed = 0, tries = 0;
  while (placed < 70 && tries++ < 800) {
    const x = R(-HALF + 8, HALF - 8), z = R(-HALF + 8, HALF - 8);
    if (!clear(x, z, 4)) continue;
    keep.push([x, z, 4]);
    placed++;
    const kind = rnd();
    const yaw = R(0, Math.PI);
    if (kind < 0.25) { P('sandbags', x, z, yaw); P('sandbags', x + Math.cos(yaw + 0.9) * 2.6, z - Math.sin(yaw + 0.9) * 2.6, yaw + 0.9); }
    else if (kind < 0.42) { P('slab', x, z, yaw); if (rnd() < 0.5) P('crate', x + Math.sin(yaw) * 1.4, z + Math.cos(yaw) * 1.4, yaw); }
    else if (kind < 0.56) { P('barrier', x, z, yaw); P('barrier', x + Math.cos(yaw) * 3.4, z - Math.sin(yaw) * 3.4, yaw + 0.15); }
    else if (kind < 0.68) { P('crate', x, z, yaw); P('crate', x + 1.5, z + 0.4, yaw + 0.3); if (rnd() < 0.6) P('drum', x - 1, z + 1.2); }
    else if (kind < 0.8) { P('trap', x, z, yaw); P('trap', x + 2.6, z + 1.2, yaw + 1); }
    else if (kind < 0.9) { P('wall', x, z, yaw); P('sandbags', x + Math.sin(yaw) * 1.5, z + Math.cos(yaw) * 1.5, yaw); }
    else P('bunker', x, z, yaw);
  }
}

function strongpoint(P, x, z, style, R) {
  if (style === 'center') {
    // ruined block: four wall panels with gaps, sandbags in the doorways
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const cx = x + Math.sin(a) * 6, cz = z + Math.cos(a) * 6;
      P('slab', cx + Math.cos(a) * 2.6, cz - Math.sin(a) * 2.6, a);
      P('sandbags', cx - Math.cos(a) * 2.8, cz + Math.sin(a) * 2.8, a);
    }
    P('crate', x + 1.5, z + 1, 0.3); P('crate', x - 1.8, z - 1.2, 1.1); P('drum', x + 2.4, z - 2);
  } else if (style === 'bunker') {
    P('bunker', x + R(-1.5, 1.5), z + R(-1.5, 1.5), R(0, Math.PI));
    for (let i = 0; i < 3; i++) {
      const a = R(0, Math.PI * 2);
      P('sandbags', x + Math.cos(a) * 6.5, z + Math.sin(a) * 6.5, -a + Math.PI / 2);
    }
  } else {
    const yaw = R(0, Math.PI);
    P('slab', x + Math.cos(yaw) * 3, z - Math.sin(yaw) * 3, yaw);
    P('slab', x - Math.cos(yaw) * 3, z + Math.sin(yaw) * 3, yaw + 0.2);
    P('wall', x + Math.sin(yaw) * 4, z + Math.cos(yaw) * 4, yaw);
    P('sandbags', x - Math.sin(yaw) * 4.5, z - Math.cos(yaw) * 4.5, yaw);
    P('crate', x, z + 1.5, yaw);
  }
}
