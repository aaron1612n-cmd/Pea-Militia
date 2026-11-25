// Secondary motion of worn kit: spring-damped swing of the things that hang loose (canteen,
// holster, antennas, strap tails, dog tags). The soldier's own acceleration, the bounce of the
// stride and turning drive each channel; the angles go to the shader (fabric.js, group sway) via
// pose.sway: [x, z] per channel in the order of gear.js SWAY_GROUPS.
// x is the swing fore and aft, z the swing sideways; kit that hangs below its pivot lags the
// motion, kit that stands above it (antennas) leans into it, so its gain is negative.
const CH = [
  { k: 62, c: 5.5, g: 1.2 },   // right hip kit (canteen)
  { k: 74, c: 7.0, g: 0.9 },   // left hip kit (holster, held tighter)
  { k: 34, c: 1.1, g: -1.8 },  // antennas and cords: long, springy, hardly damped
  { k: 24, c: 2.6, g: 1.6 },   // strap tails
  { k: 46, c: 2.2, g: 1.4 },   // chain and tags
];
const LIM = 0.55;
export class Sway {
  constructor() {
    this.a = new Float32Array(10); this.v = new Float32Array(10);
    this.px = 0; this.pz = 0; this.fresh = true;
  }
  // vx, vz: world velocity; facing: yaw; cycle (0..1) and run (0..1) for the stride's bounce; turn: yaw rate
  update(dt, vx, vz, facing, cycle, run, turn, out) {
    dt = Math.min(dt, 0.05);
    const c = Math.cos(facing), s = Math.sin(facing);
    const lx = vx * c - vz * s, lz = vx * s + vz * c; // body frame: +z ahead, +x to the left
    if (this.fresh) { this.px = lx; this.pz = lz; this.fresh = false; }
    const inv = dt > 1e-4 ? 1 / dt : 0;
    let ax = (lx - this.px) * inv, az = (lz - this.pz) * inv;
    this.px = lx; this.pz = lz;
    // the stride: a heel strike every half cycle jolts the kit, and the hips sway once per cycle
    const T = Math.PI * 2;
    ax += Math.cos(cycle * T) * 3.2 * run - turn * 1.4;
    az += Math.sin(cycle * T * 2) * 2.4 * run;
    ax = Math.max(-25, Math.min(25, ax)); az = Math.max(-25, Math.min(25, az));
    const n = 2, h = dt / n;
    for (let it = 0; it < n; it++) {
      for (let ch = 0; ch < 5; ch++) {
        const { k, c: d, g } = CH[ch];
        const ix = ch * 2, iz = ix + 1;
        // x swings with forward acceleration; z against sideways acceleration
        this.v[ix] += (-k * this.a[ix] - d * this.v[ix] + g * az) * h;
        this.v[iz] += (-k * this.a[iz] - d * this.v[iz] - g * ax) * h;
        this.a[ix] = Math.max(-LIM, Math.min(LIM, this.a[ix] + this.v[ix] * h));
        this.a[iz] = Math.max(-LIM, Math.min(LIM, this.a[iz] + this.v[iz] * h));
      }
    }
    out.set(this.a);
    return out;
  }
}
