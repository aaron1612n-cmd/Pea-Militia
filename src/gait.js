import * as THREE from 'three';

// Locomotion for the soldier rig: one continuous gait driven by ground speed, from a shuffle to a
// full sprint. The cycle phase advances by DISTANCE (see Unit.animate), and a stance foot travels
// back exactly as fast as the soldier travels forward, so planted feet never slide. Faster speeds
// lengthen the stride, shorten the time on the ground until both feet leave it (the airborne
// phase of a run), lift the knees, lean the body into the run and make the hips dip and rebound.
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

// speed (m/s) keys for every gait parameter; values are interpolated between keys
const V = [0.0, 0.8, 1.4, 2.0, 2.6, 3.6, 5.0, 7.0];
const TABLE = {
  beta:   [0.64, 0.62, 0.60, 0.53, 0.45, 0.36, 0.30, 0.26], // share of the cycle each foot is on the ground
  clear:  [0.03, 0.035, 0.045, 0.07, 0.10, 0.16, 0.20, 0.22], // peak foot lift in the swing (m)
  push:   [0.3, 0.35, 0.4, 0.5, 0.55, 0.8, 0.9, 0.9], // toe-down as the heel leaves the ground / kicks back
  strike: [0.3, 0.3, 0.3, 0.2, 0.1, -0.05, -0.1, -0.1], // toe-up at touchdown (negative = forefoot strike)
  lean: [0.0, 0.04, 0.06, 0.1, 0.15, 0.27, 0.34, 0.38], // forward body lean (rad)
  bob: [0.0, 0.008, 0.008, -0.004, -0.018, -0.03, -0.034, -0.036], // hip rise at mid-stance (+) or dip (-)
  crouch: [0, 0, 0.004, 0.015, 0.03, 0.05, 0.06, 0.06], // mean hip lowering from bent knees
  swing: [0.02, 0.05, 0.08, 0.13, 0.17, 0.23, 0.26, 0.27], // free-arm swing (m, fore and aft)
  twist: [0, 0.02, 0.03, 0.06, 0.09, 0.14, 0.16, 0.16], // shoulders turn against the hips (rad)
};
export const STRIDE_BASE = 0.45, STRIDE_PER_MS = 0.32;
// stride (one full cycle of one foot) in metres at a given speed
export const strideLength = (v) => STRIDE_BASE + STRIDE_PER_MS * v;

function sample(key, v) {
  const t = TABLE[key];
  if (v <= V[0]) return t[0];
  for (let i = 1; i < V.length; i++) if (v <= V[i]) return lerp(t[i - 1], t[i], (v - V[i - 1]) / (V[i] - V[i - 1]));
  return t[t.length - 1];
}

const G = {};
export function gaitFor(v, out = G) {
  out.v = v;
  out.L = strideLength(v);
  for (const k in TABLE) out[k] = sample(k, v);
  out.half = out.beta * out.L / 2; // the stance foot travels 2 * half back along the ground
  out.run = smooth(1.6, 2.6, v); // 0 walking .. 1 running
  out.sprint = smooth(2.8, 3.8, v);
  return out;
}

// pitch of the foot (toe up positive) through the swing
const PITCH_KEYS = (g) => [[0, -g.push], [0.28, -g.push * 1.05], [0.62, -0.02], [1, g.strike]];
function curve(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], smooth(keys[i - 1][0], keys[i][0], t));
  return keys[keys.length - 1][1];
}

// One foot at cycle phase ph (0..1; touchdown at 0). Returns forward travel along the move
// direction ('along', +1 = full half-stride ahead), lift above the ground, and toe-up pitch.
// Stance: planted, sliding back at ground speed. Swing: lifted, carried through to the next strike.
export function footAt(ph, g, o) {
  const b = g.beta;
  // a runner strikes closer to the hips and pushes off further behind them
  const fwd = lerp(1, 0.72, g.run), back = lerp(1, 1.28, g.run);
  if (ph < b) {
    const u = ph / b;
    o.along = lerp(fwd, -back, u) * g.half;
    o.lift = 0;
    // heel strike, flat foot, then the heel rises before toe-off
    o.pitch = g.strike * (1 - smooth(0, 0.3, u)) - g.push * smooth(0.55, 1, u);
    o.stance = 1;
  } else {
    const k = (ph - b) / (1 - b);
    const e = smooth(0, 1, k); // slow off the ground, fast past the other leg, easing into the strike
    o.along = lerp(-back, fwd, e) * g.half;
    o.lift = g.clear * Math.pow(Math.sin(Math.PI * Math.pow(k, 0.78)), 0.85);
    o.pitch = curve(k, PITCH_KEYS(g));
    o.stance = 0;
  }
  return o;
}

// hip height change from the gait: up at mid-stance when walking, a dip at mid-stance (and a
// rebound through the flight) when running. period: twice per cycle
export function hipBob(cyc, g) {
  const m = Math.cos(4 * Math.PI * (cyc - g.beta / 2));
  return -g.crouch + g.bob * m;
}
