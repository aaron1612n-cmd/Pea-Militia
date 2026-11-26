import { U } from './rig.js';

// Foot planting while a soldier stands. Each boot is pinned to a spot on the ground in world space; it stays
// there while the body turns, sways or breathes, and takes a real step (lift, swing, set down) only when the
// body has turned or drifted too far from it. While moving, the stride clips own the feet and this just
// follows them, so the hand-over at a stop (or a start) carries on from wherever the foot actually is
// instead of snapping to a stance.
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const sm = (x) => x * x * (3 - 2 * x);
const STEP_POS = 0.15, STEP_YAW = 0.62; // how far a boot strays from home before it steps
export class Planter {
  constructor() {
    this.f = [0, 1].map(() => ({ wx: 0, wz: 0, wyaw: 0, step: -1, dur: 0.22, sx: 0, sz: 0, syaw: 0 }));
    this.k = 0; this.fresh = true; this.lastFacing = 0;
    this.out = { k: 0, x: [0, 0], z: [0, 0], yaw: [0, 0], lift: [0, 0] };
  }
  // pos, facing: the soldier in the world; fx: local [x, z, yaw] per foot from the last pose (what the clips did)
  update(dt, pos, facing, active, fx, ls = 1) {
    const c = Math.cos(facing), s = Math.sin(facing), o = this.out;
    const turn = this.fresh ? 0 : wrap(facing - this.lastFacing) / Math.max(dt, 1e-3);
    this.lastFacing = facing;
    if (!active) {
      for (let i = 0; i < 2; i++) { // follow the clip's feet
        const f = this.f[i], x = fx[i * 3], z = fx[i * 3 + 1];
        f.wx = pos.x + x * c + z * s; f.wz = pos.z - x * s + z * c; f.wyaw = facing + fx[i * 3 + 2]; f.step = -1;
      }
      this.fresh = false; this.still = 0;
      this.k *= Math.exp(-9 * dt); if (this.k < 0.01) this.k = 0; // hand the feet back to the clips smoothly
      o.k = this.k;
      for (let i = 0; i < 2; i++) { o.x[i] = fx[i * 3]; o.z[i] = fx[i * 3 + 1]; o.yaw[i] = fx[i * 3 + 2]; o.lift[i] = 0; }
      return o;
    }
    if (this.fresh) { // never planted before: start at a standing stance
      for (let i = 0; i < 2; i++) { const f = this.f[i], x = (i ? 1 : -1) * U.FOOT_X; f.wx = pos.x + x * c; f.wz = pos.z - x * s; f.wyaw = facing + (i ? 0.09 : -0.09); }
      this.fresh = false;
    }
    this.k += (1 - this.k) * (1 - Math.exp(-14 * dt));
    o.k = this.k;
    this.still = (this.still || 0) + dt;
    const busy = this.f[0].step >= 0 || this.f[1].step >= 0;
    let want = -1, worst = 0;
    for (let i = 0; i < 2; i++) {
      const f = this.f[i], side = i ? 1 : -1;
      // home: under the hip, toes a little out, led a touch in the direction the body is turning
      const hyaw = side * 0.09 + THREE_clamp(turn * 0.12, -0.5, 0.5);
      const hx = side * U.FOOT_X, hz = (i ? 0.03 : -0.03) * 0;
      const lx = (f.wx - pos.x) * c - (f.wz - pos.z) * s, lz = (f.wx - pos.x) * s + (f.wz - pos.z) * c, ly = wrap(f.wyaw - facing);
      f.lx = lx; f.lz = lz; f.ly = ly; f.hx = hx; f.hz = hz; f.hyaw = hyaw;
      if (f.step < 0) {
        const e = Math.hypot(lx - hx, lz - hz) / STEP_POS + Math.abs(wrap(ly - hyaw)) / STEP_YAW;
        const lim = this.still > 0.12 ? 0.35 : 1; // boots over the limit step (a soldier who has stood a moment settles both feet under him)
        if (e > lim && e > worst) { worst = e; want = i; }
      }
    }
    if (want >= 0 && !busy) {
      const f = this.f[want];
      f.step = 0; f.sx = f.wx; f.sz = f.wz; f.syaw = f.wyaw;
      f.dur = 0.18 + 0.05 * Math.min(3, worst);
    }
    for (let i = 0; i < 2; i++) {
      const f = this.f[i];
      let lift = 0;
      if (f.step >= 0) {
        f.step += dt / f.dur;
        const k = Math.min(1, f.step), e = sm(k);
        // the target is the home spot in the body's frame *now*, so a turning body is chased, not missed
        const tx = pos.x + f.hx * c + f.hz * s, tz = pos.z - f.hx * s + f.hz * c, ty = facing + f.hyaw;
        f.wx = f.sx + (tx - f.sx) * e; f.wz = f.sz + (tz - f.sz) * e; f.wyaw = f.syaw + wrap(ty - f.syaw) * e;
        lift = 0.05 * ls * Math.sin(Math.PI * k);
        if (k >= 1) f.step = -1;
      }
      const dx = f.wx - pos.x, dz = f.wz - pos.z;
      o.x[i] = dx * c - dz * s; o.z[i] = dx * s + dz * c; o.yaw[i] = wrap(f.wyaw - facing); o.lift[i] = lift;
    }
    return o;
  }
}
function THREE_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
