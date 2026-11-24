// Small synthesised sound set (no files): shots, blasts, steam, plasma, engines.
// Starts on the first user gesture; distance and side set volume and pan.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.recent = new Map();
    const start = () => this.init();
    addEventListener('pointerdown', start, { once: true });
    addEventListener('keydown', start, { once: true });
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    this.master.connect(comp).connect(c.destination);
    const len = c.sampleRate * 1.5;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // open-field echo: a generated decaying impulse; far sounds send more into it
    try {
      const rl = Math.floor(c.sampleRate * 2.2);
      const ir = c.createBuffer(2, rl, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const o = ir.getChannelData(ch);
        for (let i = 0; i < rl; i++) {
          const t = i / c.sampleRate;
          // a slap off the far edge at ~0.12 s, then a long soft tail
          const slap = t > 0.11 && t < 0.16 ? 0.5 : 0;
          o[i] = (Math.random() * 2 - 1) * (Math.exp(-t * 2.6) * 0.5 + slap * Math.exp(-(t - 0.11) * 30));
        }
      }
      this.verb = c.createConvolver();
      this.verb.buffer = ir;
      const vg = c.createGain();
      vg.gain.value = 0.55;
      this.verb.connect(vg).connect(this.master);
    } catch { this.verb = null; }
    this.ambience();
  }

  // a low wind bed and, now and then, a far-off battle rumble
  ambience() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.4;
    const g = c.createGain();
    g.gain.value = 0.05;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = c.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    const rumble = () => {
      if (this.ctx && !this.muted && document.visibilityState !== 'hidden') {
        const d = this.ctx.createGain();
        d.gain.value = 0.12 + Math.random() * 0.12;
        d.connect(this.master);
        if (this.verb) d.connect(this.verb);
        this.noiseBurst(d, { dur: 2.2, f: 260, f2: 50, peak: 0.6, attack: 0.05 });
        this.tone(d, { dur: 1.4, f: 46, f2: 26, peak: 0.5, attack: 0.04 });
      }
      setTimeout(rumble, 5000 + Math.random() * 9000);
    };
    setTimeout(rumble, 4000);
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }

  // returns an output node for a sound at world position p, or null if too far / throttled
  out(p, key, vol = 1) {
    const c = this.ctx;
    if (!c || this.muted) return null;
    const now = c.currentTime;
    // big battles: cap how many sounds start in any short window
    if (now - (this.windowT || 0) > 0.08) { this.windowT = now; this.windowN = 0; }
    if (p && ++this.windowN > 6) return null;
    if (key) {
      const last = this.recent.get(key) || 0;
      if (now - last < 0.035) return null;
      this.recent.set(key, now);
    }
    let g = vol, pan = 0;
    if (p) {
      const dx = p.x - this.listener.x, dz = p.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      g *= 1 / (1 + d * 0.09);
      if (g < 0.02) return null;
      const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
      pan = d > 0.5 ? Math.max(-0.8, Math.min(0.8, (dx * rx + dz * rz) / d)) : 0;
    }
    const gain = c.createGain();
    gain.gain.value = g;
    // distance takes the top end off and pushes more of the sound into the echo
    const dist = p ? Math.hypot(p.x - this.listener.x, p.z - this.listener.z) : 0;
    let head = gain;
    if (dist > 6) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 16000 / (1 + (dist - 6) * 0.12));
      gain.connect(lp);
      head = lp;
    }
    const panner = c.createStereoPanner ? c.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; head.connect(panner).connect(this.master); } else head.connect(this.master);
    if (this.verb) {
      const send = c.createGain();
      send.gain.value = 0.25 + Math.min(0.9, dist / 40);
      head.connect(send).connect(this.verb);
    }
    this.near = dist < 10;
    return gain;
  }

  noiseBurst(dest, { t = 0, dur = 0.2, type = 'lowpass', f = 1200, q = 0.7, peak = 1, attack = 0.002, f2 } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = c.createBiquadFilter();
    flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const now = c.currentTime + t;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, now);
    e.gain.exponentialRampToValueAtTime(peak, now + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(flt).connect(e).connect(dest);
    s.start(now, Math.random() * 1.0, dur + 0.05);
  }

  tone(dest, { t = 0, dur = 0.2, type = 'sine', f = 100, f2, peak = 0.6, attack = 0.003 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    const now = c.currentTime + t;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, now);
    e.gain.exponentialRampToValueAtTime(peak, now + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(e).connect(dest);
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  play(kind, p, vol = 1) {
    const d = this.out(p, kind + (p ? Math.round(p.x) + ',' + Math.round(p.z) : ''), vol);
    if (!d) return;
    switch (kind) {
      case 'rifle':
        if (this.near) this.noiseBurst(d, { dur: 0.03, type: 'highpass', f: 3500, peak: 0.7, attack: 0.001 });
        this.noiseBurst(d, { dur: 0.36, f: 2600, f2: 260, peak: 0.9 });
        this.tone(d, { dur: 0.18, f: 140, f2: 45, peak: 0.6 });
        break;
      case 'smg':
        this.noiseBurst(d, { dur: 0.11, f: 3000, f2: 500, peak: 0.5 });
        this.tone(d, { dur: 0.07, f: 170, f2: 70, peak: 0.3 });
        break;
      case 'mg':
        if (this.near) this.noiseBurst(d, { dur: 0.025, type: 'highpass', f: 3200, peak: 0.5, attack: 0.001 });
        this.noiseBurst(d, { dur: 0.18, f: 2200, f2: 280, peak: 0.75 });
        this.tone(d, { dur: 0.1, f: 120, f2: 50, peak: 0.45 });
        break;
      case 'plasma':
        this.tone(d, { dur: 0.22, type: 'sawtooth', f: 1400, f2: 180, peak: 0.16 });
        this.tone(d, { dur: 0.18, type: 'sine', f: 600, f2: 90, peak: 0.25 });
        break;
      case 'flame':
        this.noiseBurst(d, { dur: 0.16, type: 'bandpass', f: 700, q: 0.6, peak: 0.25, attack: 0.03 });
        break;
      case 'steam':
        this.tone(d, { dur: 0.22, f: 90, f2: 40, peak: 0.8 });
        this.noiseBurst(d, { dur: 0.7, type: 'highpass', f: 2500, peak: 0.35, attack: 0.01 });
        break;
      case 'throw':
        this.noiseBurst(d, { dur: 0.2, type: 'bandpass', f: 900, f2: 400, q: 1.2, peak: 0.2, attack: 0.04 });
        break;
      case 'boom':
        if (this.near) this.noiseBurst(d, { dur: 0.08, type: 'highpass', f: 1800, peak: 0.9, attack: 0.001 });
        this.noiseBurst(d, { dur: 1.8, f: 1100, f2: 50, peak: 1 });
        this.tone(d, { dur: 0.9, f: 72, f2: 24, peak: 1 });
        // debris pattering down afterwards
        for (let i = 0; i < 5; i++) this.noiseBurst(d, { t: 0.35 + Math.random() * 0.9, dur: 0.05, type: 'bandpass', f: 1500 + Math.random() * 1500, q: 4, peak: 0.12 });
        break;
      case 'thud':
        this.tone(d, { dur: 0.16, f: 85, f2: 45, peak: 0.55 });
        this.noiseBurst(d, { dur: 0.12, f: 600, f2: 200, peak: 0.35 });
        this.tone(d, { t: 0.05, dur: 0.07, type: 'triangle', f: 1100 + Math.random() * 500, f2: 800, peak: 0.08 });
        break;
      case 'whiz':
        this.noiseBurst(d, { dur: 0.16, type: 'bandpass', f: 4200, f2: 1600, q: 3, peak: 0.6, attack: 0.03 });
        break;
      case 'zap':
        this.tone(d, { dur: 0.3, type: 'square', f: 300, f2: 60, peak: 0.12 });
        this.noiseBurst(d, { dur: 0.3, type: 'highpass', f: 3000, peak: 0.25 });
        break;
      case 'cannon':
        this.noiseBurst(d, { dur: 0.9, f: 1400, f2: 80, peak: 1 });
        this.tone(d, { dur: 0.5, f: 80, f2: 30, peak: 1 });
        break;
      case 'clink':
        this.tone(d, { dur: 0.06, type: 'triangle', f: 1800, f2: 1200, peak: 0.15 });
        break;
      case 'reload':
        this.tone(d, { dur: 0.05, type: 'square', f: 900, peak: 0.08 });
        this.tone(d, { t: 0.12, dur: 0.05, type: 'square', f: 600, peak: 0.08 });
        break;
      case 'hit':
        this.noiseBurst(d, { dur: 0.08, type: 'bandpass', f: 500, q: 2, peak: 0.35 });
        break;
      case 'ping':
        this.tone(d, { dur: 0.09, type: 'triangle', f: 2400, f2: 1700, peak: 0.25 });
        break;
      case 'whistle':
        this.tone(d, { dur: 1.5, type: 'sine', f: 2400, f2: 700, peak: 0.1, attack: 0.3 });
        this.noiseBurst(d, { dur: 1.5, type: 'bandpass', f: 3000, f2: 900, q: 5, peak: 0.12, attack: 0.4 });
        break;
      case 'jet':
        this.noiseBurst(d, { dur: 3, type: 'bandpass', f: 500, f2: 250, q: 0.8, peak: 0.7, attack: 1.1 });
        this.tone(d, { dur: 3, type: 'sawtooth', f: 190, f2: 90, peak: 0.12, attack: 1.2 });
        break;
      case 'radio':
        this.tone(d, { dur: 0.08, type: 'square', f: 1500, peak: 0.07 });
        this.tone(d, { t: 0.14, dur: 0.08, type: 'square', f: 1100, peak: 0.07 });
        this.noiseBurst(d, { t: 0.28, dur: 0.25, type: 'bandpass', f: 1800, q: 1.5, peak: 0.08 });
        break;
      case 'clank':
        this.tone(d, { dur: 0.15, type: 'square', f: 220, f2: 140, peak: 0.12 });
        this.noiseBurst(d, { dur: 0.12, type: 'bandpass', f: 1600, q: 3, peak: 0.2 });
        break;
    }
  }

  // continuous engine hum: returns a handle with set(speed01, pos) and stop()
  engine(kind) {
    const c = this.ctx;
    if (!c) return { set() {}, stop() {} };
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300;
    const g = c.createGain();
    g.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    o.connect(f).connect(g);
    if (pan) g.connect(pan).connect(this.master); else g.connect(this.master);
    o.start();
    const base = { walker: 45 }[kind] || 45;
    return {
      set: (k, p) => {
        const t = c.currentTime;
        o.frequency.setTargetAtTime(base * (1 + k * 0.9), t, 0.1);
        f.frequency.setTargetAtTime(220 + k * 500, t, 0.1);
        let v = this.muted ? 0 : 0.08 + 0.07 * k;
        if (p) {
          const d = Math.hypot(p.x - this.listener.x, p.z - this.listener.z);
          v /= 1 + d * 0.12;
        }
        g.gain.setTargetAtTime(v, t, 0.1);
      },
      stop: () => { g.gain.setTargetAtTime(0, c.currentTime, 0.05); setTimeout(() => { try { o.stop(); } catch {} }, 300); },
    };
  }
}
