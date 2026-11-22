import { toLocal } from './physics.js';
import { slopeAt } from './terrain.js';

// Walking routes for the AI. A coarse grid over the field: cells are blocked by anything solid
// (props taller than a step, trunks, walls) grown by the soldier's width, and steep or exposed ground
// costs more. A* finds the route, then it is pulled tight so soldiers cut corners instead of
// tracing the grid. Rebuilt only when props change.

const CELL = 1;
const CLEAR = 0.55; // body radius plus a margin so nobody scrapes a corner
const TIGHT = 0.38; // squeezing through: little more than the body's own radius
const STEP = 0.3;   // props lower than this are stepped over (anything taller is a wall to a walking soldier)

export class Nav {
  constructor(half) {
    this.half = half;
    this.n = Math.ceil((half * 2) / CELL);
    this.blocked = new Uint8Array(this.n * this.n);
    this.tight = new Uint8Array(this.n * this.n);
    this.cost = null; // slope cost, worked out once: the ground doesn't change
    this.version = -1;
    this.g = new Float32Array(this.n * this.n);
    this.from = new Int32Array(this.n * this.n);
    this.mark = new Uint32Array(this.n * this.n); // search id per cell
    this.closed = new Uint32Array(this.n * this.n);
    this.search = 0;
    this.heap = [];
  }

  cellOf(x, z) {
    const n = this.n;
    const i = Math.min(n - 1, Math.max(0, Math.floor((x + this.half) / CELL)));
    const j = Math.min(n - 1, Math.max(0, Math.floor((z + this.half) / CELL)));
    return j * n + i;
  }
  center(c, out) {
    const n = this.n;
    out.x = (c % n) * CELL - this.half + CELL / 2;
    out.z = Math.floor(c / n) * CELL - this.half + CELL / 2;
    return out;
  }

  build(props, version) {
    if (version === this.version) return;
    this.version = version;
    const n = this.n;
    this.blocked.fill(0);
    this.tight.fill(0);
    if (!this.cost) {
      this.cost = new Float32Array(n * n);
      for (let c = 0; c < n * n; c++) {
        const x = (c % n) * CELL - this.half + CELL / 2, z = Math.floor(c / n) * CELL - this.half + CELL / 2;
        this.cost[c] = 1 + Math.min(2.5, slopeAt(x, z) * 3);
      }
    }
    for (const p of props) {
      if (!p.alive || p.box.h < STEP) continue;
      const b = p.box, r = Math.hypot(b.hx, b.hz) + CLEAR + CELL;
      const i0 = Math.max(0, Math.floor((b.x - r + this.half) / CELL)), i1 = Math.min(n - 1, Math.floor((b.x + r + this.half) / CELL));
      const j0 = Math.max(0, Math.floor((b.z - r + this.half) / CELL)), j1 = Math.min(n - 1, Math.floor((b.z + r + this.half) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * CELL - this.half + CELL / 2, z = j * CELL - this.half + CELL / 2;
        const [lx, lz] = toLocal(b, x, z);
        const dx = Math.max(0, Math.abs(lx) - b.hx), dz = Math.max(0, Math.abs(lz) - b.hz);
        const d2 = dx * dx + dz * dz;
        if (d2 < CLEAR * CLEAR) this.blocked[j * n + i] = 1;
        if (d2 < TIGHT * TIGHT) this.tight[j * n + i] = 1;
      }
    }
  }

  // nearest open cell to c (the goal or start may sit inside a grown obstacle)
  open(c, B = this.blocked) {
    if (!B[c]) return c;
    const n = this.n, ci = c % n, cj = Math.floor(c / n);
    for (let r = 1; r < 6; r++) {
      let best = -1, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n || B[j * n + i]) continue;
        const d = (i - ci) ** 2 + (j - cj) ** 2;
        if (d < bd) { bd = d; best = j * n + i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  push(c, f) {
    const h = this.heap;
    h.push([f, c]);
    let k = h.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (h[p][0] <= h[k][0]) break;
      [h[p], h[k]] = [h[k], h[p]]; k = p;
    }
  }
  pop() {
    const h = this.heap, top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < h.length && h[l][0] < h[m][0]) m = l;
        if (r < h.length && h[r][0] < h[m][0]) m = r;
        if (m === k) break;
        [h[m], h[k]] = [h[k], h[m]]; k = m;
      }
    }
    return top[1];
  }

  // route from (ax,az) to (bx,bz) as a list of {x,z}; null when there is none.
  // avoid(x,z) may add a cost to cells (exposed ground, crowded lanes).
  path(ax, az, bx, bz, squeeze = false, avoid = null) {
    const n = this.n, B = squeeze ? this.tight : this.blocked;
    const s = this.open(this.cellOf(ax, az), B), t = this.open(this.cellOf(bx, bz), B);
    if (s < 0 || t < 0) return null;
    const id = ++this.search;
    this.heap.length = 0;
    const tx = t % n, tz = Math.floor(t / n);
    this.g[s] = 0; this.mark[s] = id; this.from[s] = -1;
    this.push(s, 0);
    let found = false, iter = 0;
    const tmp = { x: 0, z: 0 };
    while (this.heap.length && iter++ < 30000) {
      const c = this.pop();
      if (this.closed[c] === id) continue;
      this.closed[c] = id;
      if (c === t) { found = true; break; }
      const ci = c % n, cj = Math.floor(c / n);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const k = j * n + i;
        if (B[k] || this.closed[k] === id) continue;
        // no cutting corners past a blocked neighbour
        if (di && dj && (B[cj * n + i] || B[j * n + ci])) continue;
        let step = (di && dj ? 1.414 : 1) * this.cost[k];
        if (avoid) step += avoid(this.center(k, tmp).x, tmp.z);
        const g = this.g[c] + step;
        if (this.mark[k] !== id || g < this.g[k]) {
          this.mark[k] = id; this.g[k] = g; this.from[k] = c;
          const dx = Math.abs(i - tx), dz = Math.abs(j - tz);
          this.push(k, g + (dx + dz) - 0.586 * Math.min(dx, dz));
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let c = t; c >= 0; c = this.from[c]) out.push(this.center(c, { x: 0, z: 0 }));
    out.reverse();
    out.shift(); // we are already in the first cell
    return out;
  }
}
