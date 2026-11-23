// Keyboard + mouse (pointer lock, drag fallback) and touch (floating stick on the left,
// drag-to-look on the right, jump button). Each frame the game calls read().
export class Input {
  constructor(canvas, { stick, knob, jumpBtn, fireBtn, buttons = {} }) {
    this.canvas = canvas;
    this.stickEl = stick;
    this.knobEl = knob;
    this.keys = new Set();
    this.look = { dx: 0, dy: 0 };
    this.jumpQueued = false;
    this.locked = false;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.stick = null; // { id, ox, oy, x, y }
    this.lookId = null;
    this.drag = null; // mouse drag-look when not locked
    this.onChange = null; // device type / lock changes
    this.onLockRequest = null;
    this.radius = 52;
    this.fire = false;
    this.fireTouch = false;
    this.aim = false;
    this.actions = []; // one-shot commands: { type: 'slot', n } | 'next' | 'prev' | 'reload' | 'grenade' | 'view' | 'menu'
    this.pan = { dx: 0, dy: 0 }; // build mode: drag pans the overview camera
    this.crouchToggle = false;
    this.zoom = 0;
    this.mode = 'play'; // 'play' or 'build' (sandbox clicks go to the world, not the gun)
    this.onWorldClick = null;
    this.bind(jumpBtn);
    if (fireBtn) this.bindFire(fireBtn);
    for (const [action, el] of Object.entries(buttons)) this.bindButton(el, action);
    this.setTouch(this.touch);
  }

  setTouch(on) {
    if (this.touch === on && document.documentElement.dataset.input) return;
    this.touch = on;
    document.documentElement.dataset.input = on ? 'touch' : 'mouse';
    if (this.onChange) this.onChange();
  }

  bind(jumpBtn) {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.setTouch(true);
        if (e.clientX < innerWidth * 0.45 && !this.stick) {
          this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0, moved: 0, t: performance.now() };
          this.placeStick(e.clientX, e.clientY);
        } else if (this.lookId === null) {
          this.lookId = e.pointerId;
          this.lookAt = { x: e.clientX, y: e.clientY }; this.lookT = e.timeStamp;
          this.lookTap = { x: e.clientX, y: e.clientY, moved: 0 };
        }
        this.capture(e.pointerId);
        return;
      }
      this.setTouch(false);
      if (this.mode === 'build') {
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, button: e.button };
        this.capture(e.pointerId);
        return;
      }
      if (!this.locked) {
        this.requestLock();
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.capture(e.pointerId);
      } else if (e.button === 0) this.fire = true;
      else if (e.button === 2) this.aim = true;
    });
    c.addEventListener('mousedown', (e) => { if (this.locked && this.mode === 'play' && e.button === 2) this.aim = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; if (e.button === 2) this.aim = false; });
    c.addEventListener('pointermove', (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        let x = e.clientX - this.stick.ox, y = e.clientY - this.stick.oy;
        const l = Math.hypot(x, y), R = this.radius;
        this.stick.moved = Math.max(this.stick.moved, l);
        this.stick.over = l / R;
        if (l > R) { x *= R / l; y *= R / l; }
        this.stick.x = x / R; this.stick.y = y / R;
        this.knobEl.style.transform = `translate(${x}px, ${y}px)`;
      } else if (e.pointerId === this.lookId) {
        if (this.lookTap) this.lookTap.moved += Math.hypot(e.clientX - this.lookAt.x, e.clientY - this.lookAt.y);
        let k = 4.2 / Math.max(320, Math.min(innerWidth, innerHeight));
        // response curve: slow drags are fine aim, quick swipes turn fast
        const now = e.timeStamp, dist = Math.hypot(e.clientX - this.lookAt.x, e.clientY - this.lookAt.y);
        const v = dist / Math.max(4, now - (this.lookT || now - 16));
        this.lookT = now;
        k *= Math.min(1.35, 0.42 + v * 0.55);
        if (this.mode === 'build') {
          this.pan.dx += e.clientX - this.lookAt.x;
          this.pan.dy += e.clientY - this.lookAt.y;
        } else {
          this.look.dx += (e.clientX - this.lookAt.x) * k;
          this.look.dy += (e.clientY - this.lookAt.y) * k;
        }
        this.lookAt = { x: e.clientX, y: e.clientY };
      } else if (this.drag && e.pointerId === this.drag.id && !this.locked) {
        const k = 0.005;
        this.drag.moved = (this.drag.moved || 0) + Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y);
        if (this.mode === 'build' && this.onWorldHover) this.onWorldHover(e.clientX, e.clientY, true);
        if (this.mode === 'build' && this.drag.moved < 8) return;
        if (this.mode === 'build' && this.drag.button !== 2) {
          this.pan.dx += e.clientX - this.drag.x;
          this.pan.dy += e.clientY - this.drag.y;
        } else {
          this.look.dx += (e.clientX - this.drag.x) * k;
          this.look.dy += (e.clientY - this.drag.y) * k;
        }
        this.drag.x = e.clientX; this.drag.y = e.clientY;
      }
    });
    const end = (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        if (this.mode === 'build' && this.stick.moved < 10 && performance.now() - this.stick.t < 400 && this.onWorldClick) this.onWorldClick(this.stick.ox, this.stick.oy);
        this.stick = null;
        this.knobEl.style.transform = '';
        this.stickEl.style.left = this.stickEl.style.top = '';
        this.stickEl.classList.remove('live');
      }
      if (e.pointerId === this.lookId) {
        this.lookId = null;
        // a still tap in build mode is a click on the world
        if (this.mode === 'build' && this.lookTap && this.lookTap.moved < 10 && this.onWorldClick) this.onWorldClick(e.clientX, e.clientY);
        this.lookTap = null;
      }
      if (this.drag && e.pointerId === this.drag.id) {
        if (this.mode === 'build' && (this.drag.moved || 0) < 8 && this.onWorldClick && e.type === 'pointerup') this.onWorldClick(e.clientX, e.clientY, this.drag.button);
        this.drag = null;
      }
    };
    c.addEventListener('pointermove', (e) => { if (this.mode === 'build' && e.pointerType !== 'touch' && this.onWorldHover) this.onWorldHover(e.clientX, e.clientY, false); });
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (this.locked) this.drag = null;
      else { this.fire = false; this.aim = false; }
      if (this.onChange) this.onChange();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look.dx += e.movementX * 0.0024;
      this.look.dy += e.movementY * 0.0024;
    });

    const GAME = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    const KEYS = { KeyR: 'reload', KeyG: 'grenade', KeyB: 'menu', KeyV: 'view', KeyF: 'free', KeyX: 'use' };
    const WHEEL = 'KeyT';
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (GAME.has(e.code)) e.preventDefault();
      if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
      if (!e.repeat && e.code === WHEEL) this.actions.push({ type: 'wheelDown' });
      if (!e.repeat && KEYS[e.code]) this.actions.push({ type: KEYS[e.code] });
      if (!e.repeat && e.code === 'KeyZ') this.prone = !this.prone;
      if (!e.repeat && (e.code === 'KeyC' || e.code === 'ControlLeft' || e.code === 'Space')) this.prone = false;
      if (!e.repeat && /^Digit[1-9]$/.test(e.code)) this.actions.push({ type: 'slot', n: +e.code.slice(5) - 1 });
      this.keys.add(e.code);
      if (this.touch && GAME.has(e.code)) this.setTouch(false);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === WHEEL) this.actions.push({ type: 'wheelUp' }); });
    addEventListener('blur', () => { this.keys.clear(); this.fire = false; this.aim = false; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode !== 'play') { this.zoom += e.deltaY; return; }
      this.wheel = (this.wheel || 0) + e.deltaY;
      if (Math.abs(this.wheel) > 40) { this.actions.push({ type: this.wheel > 0 ? 'next' : 'prev' }); this.wheel = 0; }
    }, { passive: false });

    const jump = (e) => { e.preventDefault(); e.stopPropagation(); this.jumpQueued = true; this.jumpTouch = true; jumpBtn.classList.add('down'); };
    const up = () => { this.jumpTouch = false; jumpBtn.classList.remove('down'); };
    jumpBtn.addEventListener('pointerdown', jump);
    jumpBtn.addEventListener('pointerup', up);
    jumpBtn.addEventListener('pointercancel', up);
    jumpBtn.addEventListener('pointerleave', up);
    jumpBtn.addEventListener('click', (e) => e.preventDefault());
  }

  bindFire(el) {
    const down = (e) => { e.preventDefault(); e.stopPropagation(); this.fireTouch = true; this.firePulse = true; el.classList.add('down'); try { el.setPointerCapture(e.pointerId); } catch {} };
    const up = () => { this.fireTouch = false; el.classList.remove('down'); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', (e) => e.preventDefault());
  }

  bindButton(el, type) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.actions.push({ type }); el.classList.add('down'); });
    const up = () => el.classList.remove('down');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('click', (e) => e.preventDefault());
  }

  capture(id) {
    try { this.canvas.setPointerCapture(id); } catch { /* pointer lock already owns it */ }
  }

  placeStick(x, y) {
    const s = this.stickEl;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.classList.add('live');
  }

  requestLock() {
    if (this.touch || !this.canvas.requestPointerLock) return;
    if (this.onLockRequest) this.onLockRequest();
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* lock unsupported: drag-look still works */ }
  }

  // move: x right, y forward, length <= 1
  read() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (this.stick) {
      const l = Math.hypot(this.stick.x, this.stick.y);
      if (l > 0.12) { x += this.stick.x; y -= this.stick.y; }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    const play = this.mode === 'play';
    const out = {
      move: { x, y }, look: { ...this.look }, jump: this.jumpQueued, jumpHeld: k.has('Space') || this.jumpTouch,
      fire: play && ((this.fire && this.locked) || this.fireTouch || this.firePulse), aim: play && this.aim && this.locked,
      // phones: drag the stick well past its rim, forward, to run
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || !!(this.stick && this.stick.over > 1.35 && this.stick.y < -0.5),
      crouch: k.has('KeyC') || k.has('ControlLeft') || this.crouchToggle,
      prone: !!this.prone,
      lean: (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0),
      actions: this.actions,
      pan: { ...this.pan }, zoom: this.zoom,
    };
    this.actions = [];
    this.pan.dx = this.pan.dy = 0;
    this.zoom = 0;
    this.firePulse = false;
    this.look.dx = this.look.dy = 0;
    this.jumpQueued = false;
    return out;
  }
}
