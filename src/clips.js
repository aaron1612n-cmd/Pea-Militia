import * as THREE from 'three';

// Authored locomotion clips. A clip is a handful of key poses over one stride cycle (cycle phase 0 =
// the right foot's heel strike, 0.5 = the left's), written as curves per channel and read back with
// a cyclic Catmull-Rom spline. Clips are blended by ground speed (walk -> jog -> run -> sprint), the
// way a mocap blend tree is, and then the feet are stride-warped: the stance foot is planted by
// distance travelled (see rig.js), so the clip supplies the *style* (lift, roll, sway, lean, twist)
// and the ground supplies the footing. Nothing here is a sine wave: each curve is a set of key poses.
//
// Channels
//   pelvis (cycle, per half-cycle): bob m (+up), sway m (+toward the stance foot), roll rad (+ the swing hip drops),
//     yaw rad (+ the pelvis turns so the leading leg's hip goes forward), pitch rad (+ tips forward)
//   chest: lean (mean forward lean, rad), twist (counter-rotation against the pelvis), roll, bounce (pitch, per half-cycle)
//   head: stabilises against the chest's bounce
//   foot (per foot, over the foot's own phase): swing lift (0..1 of `clear`), swing pitch, stance pitch
//   kit: how hard the loaded gear jolts at heel strike
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

// ---- curves --------------------------------------------------------------------------------
// keys: [[t, v], ...] with t ascending. cyclic: wraps at 1.
export function curve(keys, t, cyclic = false) {
  const n = keys.length;
  if (n === 1) return keys[0][1];
  let i = 0;
  if (cyclic) {
    t = t - Math.floor(t);
    while (i < n - 1 && keys[i + 1][0] <= t) i++;
    const i0 = (i - 1 + n) % n, i1 = i, i2 = (i + 1) % n, i3 = (i + 2) % n;
    const t1 = keys[i1][0], t2 = i2 === 0 ? keys[0][0] + 1 : keys[i2][0];
    const u = (t - t1) / Math.max(1e-6, t2 - t1);
    return hermite(keys[i0][1], keys[i1][1], keys[i2][1], keys[i3][1], u);
  }
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  while (i < n - 2 && keys[i + 1][0] <= t) i++;
  const i0 = Math.max(0, i - 1), i1 = i, i2 = i + 1, i3 = Math.min(n - 1, i + 2);
  const u = (t - keys[i1][0]) / Math.max(1e-6, keys[i2][0] - keys[i1][0]);
  return hermite(keys[i0][1], keys[i1][1], keys[i2][1], keys[i3][1], u);
}
function hermite(p0, p1, p2, p3, u) {
  const m1 = (p2 - p0) * 0.5, m2 = (p3 - p1) * 0.5, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}
// a channel authored over the first half of the cycle. sign +1: the second half repeats it (bob, pitch);
// sign -1: the second half is its mirror image (sway, roll, yaw). Returns a cyclic key list over 0..1.
function twoStep(half, sign) {
  const a = half.map(([t, v]) => [t * 0.5, v]);
  const b = half.map(([t, v]) => [0.5 + t * 0.5, v * sign]);
  const out = [...a];
  for (const k of b) if (k[0] < 1 - 1e-6) out.push(k);
  // the half-cycle keys run 0..1 of the half, so drop the duplicate at the seam (t=0.5 appears in both lists)
  return out.filter((k, i, arr) => i === 0 || k[0] - arr[i - 1][0] > 1e-6);
}

// ---- the clips -----------------------------------------------------------------------------
// Half-cycle key times run 0..1 over half a stride: 0 = a heel strike, 1 = the other heel's strike.
// Amplitudes are in metres / radians for a 0.44 m leg; the rig scales them to the body's own legs.
// Walk: low and measured, long double support, the pelvis rises over the planted leg.
// Jog and run: shorter stance, a flight phase, the body dips at mid-stance and rebounds in flight.
// Sprint: forward lean, high knees, long flight, big counter-rotation.
function clip(o) {
  const c = { ...o };
  for (const k of ['bob', 'sway', 'roll', 'yaw', 'pitch', 'twist', 'chestRoll', 'bounce']) {
    const ch = o[k];
    c[k] = ch ? twoStep(ch.keys, ch.sign ?? 1).map(([t, v]) => [t, v * (ch.amp ?? 1)]) : [[0, 0]];
  }
  return c;
}

export const CLIPS = {
  // 1.4 m/s
  walk: clip({
    v: 1.4, beta: 0.62, clear: 0.05, lean: 0.05, fwd: 1, back: 1, cross: 0,
    bob: { keys: [[0, -1], [0.3, -0.35], [0.62, 1], [0.9, -0.3], [1, -1]], amp: 0.011 },
    sway: { keys: [[0, -0.55], [0.5, 1], [1, 0.55]], amp: 0.016, sign: -1 },
    roll: { keys: [[0, 0.25], [0.5, 1], [1, -0.25]], amp: 0.05, sign: -1 },
    yaw: { keys: [[0, 1], [0.5, 0], [1, -1]], amp: 0.1, sign: -1 },
    pitch: { keys: [[0, 0.5], [0.45, -0.4], [1, 0.5]], amp: 0.03 },
    twist: { keys: [[0, -1], [0.5, 0], [1, 1]], amp: 0.07, sign: -1 },
    chestRoll: { keys: [[0, -0.4], [0.5, 1], [1, 0.4]], amp: 0.03, sign: -1 },
    bounce: { keys: [[0, 0.7], [0.4, -0.6], [0.8, 0.2], [1, 0.7]], amp: 0.02 },
    swingLift: [[0, 0], [0.2, 0.62], [0.5, 1], [0.78, 0.55], [1, 0]],
    swingPitch: [[0, -0.6], [0.28, -0.55], [0.6, 0.0], [0.85, 0.25], [1, 0.3]], // + toe up (rad)
    stancePitch: [[0, 0.3], [0.18, 0], [0.62, 0], [0.8, -0.3], [1, -0.6]],
    kit: 0.5,
  }),
  // 2.6 m/s: a brisk jog
  jog: clip({
    v: 2.6, beta: 0.46, clear: 0.11, lean: 0.14, fwd: 0.9, back: 1.1, cross: 0.012,
    bob: { keys: [[0, -0.4], [0.22, -1], [0.55, 0.8], [0.85, 0.2], [1, -0.4]], amp: 0.02 },
    sway: { keys: [[0, -0.3], [0.5, 1], [1, 0.3]], amp: 0.016, sign: -1 },
    roll: { keys: [[0, 0.3], [0.5, 1], [1, -0.3]], amp: 0.05, sign: -1 },
    yaw: { keys: [[0, 1], [0.5, 0], [1, -1]], amp: 0.14, sign: -1 },
    pitch: { keys: [[0, 0.8], [0.4, -0.7], [1, 0.8]], amp: 0.035 },
    twist: { keys: [[0, -1], [0.5, 0], [1, 1]], amp: 0.11, sign: -1 },
    chestRoll: { keys: [[0, -0.4], [0.5, 1], [1, 0.4]], amp: 0.035, sign: -1 },
    bounce: { keys: [[0, 0.8], [0.3, -0.7], [0.75, 0.4], [1, 0.8]], amp: 0.03 },
    swingLift: [[0, 0], [0.18, 0.7], [0.45, 1], [0.75, 0.6], [1, 0]],
    swingPitch: [[0, -0.9], [0.3, -0.8], [0.65, -0.1], [0.9, 0.15], [1, 0.1]],
    stancePitch: [[0, 0.1], [0.2, 0], [0.6, 0], [0.82, -0.45], [1, -0.85]],
    kit: 1,
  }),
  // 4.0 m/s: a run
  run: clip({
    v: 4.0, beta: 0.34, clear: 0.17, lean: 0.24, fwd: 0.8, back: 1.2, cross: 0.02,
    bob: { keys: [[0, -0.3], [0.2, -1], [0.55, 0.7], [0.8, 1], [1, -0.3]], amp: 0.026 },
    sway: { keys: [[0, -0.2], [0.45, 1], [1, 0.2]], amp: 0.018, sign: -1 },
    roll: { keys: [[0, 0.3], [0.5, 1], [1, -0.3]], amp: 0.05, sign: -1 },
    yaw: { keys: [[0, 1], [0.5, 0], [1, -1]], amp: 0.17, sign: -1 },
    pitch: { keys: [[0, 0.9], [0.4, -0.8], [1, 0.9]], amp: 0.04 },
    twist: { keys: [[0, -1], [0.5, 0], [1, 1]], amp: 0.14, sign: -1 },
    chestRoll: { keys: [[0, -0.4], [0.5, 1], [1, 0.4]], amp: 0.04, sign: -1 },
    bounce: { keys: [[0, 0.9], [0.3, -0.8], [0.75, 0.5], [1, 0.9]], amp: 0.04 },
    swingLift: [[0, 0], [0.15, 0.62], [0.42, 1], [0.7, 0.72], [1, 0]],
    swingPitch: [[0, -1.0], [0.3, -0.9], [0.6, -0.2], [0.85, 0.05], [1, -0.05]],
    stancePitch: [[0, -0.05], [0.25, 0], [0.55, -0.1], [0.8, -0.6], [1, -1.0]],
    kit: 1.5,
  }),
  // 6.0+ m/s: a sprint
  sprint: clip({
    v: 6.0, beta: 0.26, clear: 0.22, lean: 0.33, fwd: 0.74, back: 1.3, cross: 0.025,
    bob: { keys: [[0, -0.2], [0.2, -1], [0.55, 0.6], [0.8, 1], [1, -0.2]], amp: 0.03 },
    sway: { keys: [[0, -0.15], [0.45, 1], [1, 0.15]], amp: 0.018, sign: -1 },
    roll: { keys: [[0, 0.3], [0.5, 1], [1, -0.3]], amp: 0.05, sign: -1 },
    yaw: { keys: [[0, 1], [0.5, 0], [1, -1]], amp: 0.2, sign: -1 },
    pitch: { keys: [[0, 1], [0.4, -0.9], [1, 1]], amp: 0.045 },
    twist: { keys: [[0, -1], [0.5, 0], [1, 1]], amp: 0.17, sign: -1 },
    chestRoll: { keys: [[0, -0.4], [0.5, 1], [1, 0.4]], amp: 0.045, sign: -1 },
    bounce: { keys: [[0, 1], [0.3, -0.9], [0.75, 0.6], [1, 1]], amp: 0.05 },
    swingLift: [[0, 0], [0.14, 0.6], [0.4, 1], [0.68, 0.75], [1, 0]],
    swingPitch: [[0, -1.05], [0.3, -0.95], [0.6, -0.25], [0.85, 0.0], [1, -0.1]],
    stancePitch: [[0, -0.1], [0.25, 0], [0.5, -0.15], [0.78, -0.7], [1, -1.05]],
    kit: 2,
  }),
};
const ORDER = [CLIPS.walk, CLIPS.jog, CLIPS.run, CLIPS.sprint];
const SPEEDS = ORDER.map((c) => c.v);

// Cadence: one full stride (a cycle of one foot) in metres at a speed. Longer strides at speed, but the
// step stays inside what the leg can reach (the rig scales this by the body's own leg length).
export const STRIDE_BASE = 0.55, STRIDE_PER_MS = 0.2;
export const strideLength = (v, ls = 1) => (STRIDE_BASE + STRIDE_PER_MS * (v / ls)) * ls;
// how much shorter the stride is when moving across or against the way the body faces (mx, mz: the move direction in the body frame)
export const dirScale = (mx, mz) => (1 - 0.55 * Math.min(1, Math.abs(mx))) * (1 - 0.22 * Math.max(0, -mz));

// The clip pair that brackets a speed, and how far between them. Below walk speed the walk clip
// fades toward standing still (amplitudes shrink with the speed, so a shuffle is a small walk).
const _ws = { a: CLIPS.walk, b: CLIPS.walk, f: 0, amp: 0 };
export function bracket(v) {
  const i = v <= SPEEDS[0] ? 0 : v >= SPEEDS[3] ? 2 : v <= SPEEDS[1] ? 0 : v <= SPEEDS[2] ? 1 : 2;
  _ws.a = ORDER[i]; _ws.b = ORDER[i + 1];
  _ws.f = THREE.MathUtils.clamp((v - SPEEDS[i]) / (SPEEDS[i + 1] - SPEEDS[i]), 0, 1);
  _ws.f = _ws.f * _ws.f * (3 - 2 * _ws.f);
  _ws.amp = smooth(0, 1.2, v); // standing still has no stride
  return _ws;
}

// Sampled, blended gait for one speed. `out` is reused. cyc is the cycle phase (right foot's strike = 0).
const CH = ['bob', 'sway', 'roll', 'yaw', 'pitch', 'twist', 'chestRoll', 'bounce'];
export function gaitFor(v, cyc, out = {}, ls = 1, dscale = 1) {
  // ls: the body's leg length over the default soldier's. A longer leg strides further at the same ground speed.
  v = v / ls;
  const br = bracket(v), a = br.a, b = br.b, f = br.f;
  const mix = (x, y) => lerp(x, y, f);
  out.v = v * ls;
  out.ls = ls;
  out.L = strideLength(v) * ls * dscale; // a sidestep or a backward step is a shorter stride at a quicker cadence
  out.beta = mix(a.beta, b.beta);
  out.clear = mix(a.clear, b.clear) * ls;
  out.lean = mix(a.lean, b.lean) * (0.35 + 0.65 * br.amp);
  out.fwd = mix(a.fwd, b.fwd); out.back = mix(a.back, b.back);
  out.cross = mix(a.cross, b.cross);
  out.kit = mix(a.kit, b.kit);
  out.half = out.beta * out.L / 2; // the stance foot travels 2 * half back along the ground
  out.run = smooth(1.6, 2.6, v); // 0 walking .. 1 running
  out.sprint = smooth(4.6, 6.0, v);
  out.amp = br.amp;
  for (const k of CH) out[k] = mix(curve(a[k], cyc, true), curve(b[k], cyc, true)) * br.amp * (k === 'bob' || k === 'sway' ? ls : 1);
  out.a = a; out.b = b; out.f = f;
  return out;
}
// foot curves at a foot's own phase within its swing or stance (0..1)
export function swingAt(g, k, o) {
  o.lift = lerp(curve(g.a.swingLift, k), curve(g.b.swingLift, k), g.f) * g.clear;
  o.pitch = lerp(curve(g.a.swingPitch, k), curve(g.b.swingPitch, k), g.f);
  return o;
}
export function stancePitchAt(g, u) { return lerp(curve(g.a.stancePitch, u), curve(g.b.stancePitch, u), g.f); }

// One foot at cycle phase ph (0..1; touchdown at 0). Returns forward travel along the move direction
// ('along', in half-strides), lift above the ground and pitch (+ toe up), and whether it is on the ground.
// Stance: planted, sliding back at ground speed. Swing: lifted, carried through to the next strike.
const FOO = { lift: 0, pitch: 0 };
export function footAt(ph, g, o) {
  const b = g.beta;
  // a runner strikes closer to the hips and pushes off further behind them
  const fwd = g.fwd, back = g.back;
  if (ph < b) {
    const u = ph / b;
    o.along = lerp(fwd, -back, u) * g.half;
    o.lift = 0;
    o.pitch = stancePitchAt(g, u);
    o.stance = 1; o.k = u;
  } else {
    const k = (ph - b) / (1 - b);
    const e = smooth(0, 1, k); // slow off the ground, fast past the other leg, easing into the strike
    o.along = lerp(-back, fwd, e) * g.half;
    swingAt(g, k, FOO);
    o.lift = FOO.lift; o.pitch = FOO.pitch;
    o.stance = 0; o.k = k;
  }
  return o;
}

// ---- standing still -----------------------------------------------------------------------
// A long loop of small things a man does while he stands: breathing, shifting weight from one foot to the
// other, a slow look about. Time in seconds; values are small by design.
export const IDLE = {
  breathe: [[0, 0], [0.28, 1], [0.5, 0.6], [0.78, -0.4], [1, 0]], // chest rise (period 4.2 s)
  shift: [[0, 0], [0.18, 1], [0.5, 1], [0.66, 0], [0.82, -1], [1, 0]], // weight onto one leg and back (period 9 s)
  look: [[0, 0], [0.2, 0.7], [0.32, 0.7], [0.5, -0.2], [0.64, -0.8], [0.8, -0.8], [1, 0]], // head wander (period 13 s)
  lookPitch: [[0, 0], [0.3, 0.5], [0.6, -0.3], [1, 0]],
};
