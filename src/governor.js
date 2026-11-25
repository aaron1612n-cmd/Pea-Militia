// Adaptive resolution. The game cannot know how fast a phone's GPU is, so it watches how long frames
// really take and trades a little sharpness for smoothness: when the typical frame runs past the budget
// the render scale steps down (about 10% of the pixel ratio at a time), and after a long calm spell it
// tries a step back up. Each failed try waits twice as long before the next, so a device that can only just
// manage a size is not bounced between two sizes every few seconds. Multisampling, shadows and the post
// pass stay as they are; only the pixel count changes.
export class Governor {
  constructor({ min = 0.6, slowMs = 21, windowMs = 1000, retryMs = 12000 } = {}) {
    this.scale = 1;
    this.min = min; this.slowMs = slowMs; this.windowMs = windowMs;
    this.buf = []; this.since = 0;
    this.hold = 3000; // ignore the first few seconds: shaders are still compiling
    this.retry = retryMs; this.retryBase = retryMs; this.calm = 0;
    this.probing = false; this.probeAge = 0;
  }
  // feed one real frame time in ms; returns the new scale when it changes, otherwise 0
  sample(ms) {
    if (ms > 1000 || ms <= 0) { this.since = 0; this.buf.length = 0; return 0; } // tab switch, pause, a long load hitch: not a speed measurement
    this.hold -= ms;
    if (this.hold > 0) return 0;
    this.buf.push(ms); this.since += ms;
    if (this.probing) this.probeAge += ms;
    if (this.since < this.windowMs) return 0;
    const b = this.buf.slice().sort((x, y) => x - y), med = b[b.length >> 1];
    this.buf.length = 0; this.since = 0;
    if (med > this.slowMs && this.scale > this.min + 1e-6) {
      // too slow: step down. If this followed a step up, that step was too much: back off before trying again.
      if (this.probing) { this.retry = Math.min(this.retry * 2, 120000); this.probing = false; }
      this.calm = 0;
      this.scale = Math.max(this.min, +(this.scale - 0.1).toFixed(2));
      this.hold = 1500; // let the new size settle before judging it
      return this.scale;
    }
    if (med <= this.slowMs) {
      if (this.probing && this.probeAge > 6000) { this.probing = false; this.retry = this.retryBase; } // held: the step up stuck
      this.calm += this.windowMs;
      if (this.scale < 1 && this.calm >= this.retry && !this.probing) {
        this.scale = Math.min(1, +(this.scale + 0.05).toFixed(2));
        this.calm = 0; this.probing = true; this.probeAge = 0; this.hold = 1000;
        return this.scale;
      }
    }
    return 0;
  }
}
