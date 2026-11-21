// Keyboard + mouse (pointer lock, drag fallback) and touch (floating stick on the left,
// drag-to-look on the right, jump button). Each frame the game calls read().
export class Input {
  constructor(canvas, { stick, knob, jumpBtn }) {
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
    this.bind(jumpBtn);
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
          this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
          this.placeStick(e.clientX, e.clientY);
        } else if (this.lookId === null) {
          this.lookId = e.pointerId;
          this.lookAt = { x: e.clientX, y: e.clientY };
        }
        this.capture(e.pointerId);
        return;
      }
      this.setTouch(false);
      if (!this.locked) {
        this.requestLock();
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.capture(e.pointerId);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        let x = e.clientX - this.stick.ox, y = e.clientY - this.stick.oy;
        const l = Math.hypot(x, y), R = this.radius;
        if (l > R) { x *= R / l; y *= R / l; }
        this.stick.x = x / R; this.stick.y = y / R;
        this.knobEl.style.transform = `translate(${x}px, ${y}px)`;
      } else if (e.pointerId === this.lookId) {
        const k = 4.2 / Math.max(320, Math.min(innerWidth, innerHeight));
        this.look.dx += (e.clientX - this.lookAt.x) * k;
        this.look.dy += (e.clientY - this.lookAt.y) * k;
        this.lookAt = { x: e.clientX, y: e.clientY };
      } else if (this.drag && e.pointerId === this.drag.id && !this.locked) {
        const k = 0.005;
        this.look.dx += (e.clientX - this.drag.x) * k;
        this.look.dy += (e.clientY - this.drag.y) * k;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
      }
    });
    const end = (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        this.stick = null;
        this.knobEl.style.transform = '';
        this.stickEl.style.left = this.stickEl.style.top = '';
        this.stickEl.classList.remove('live');
      }
      if (e.pointerId === this.lookId) this.lookId = null;
      if (this.drag && e.pointerId === this.drag.id) this.drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (this.locked) this.drag = null;
      if (this.onChange) this.onChange();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look.dx += e.movementX * 0.0024;
      this.look.dy += e.movementY * 0.0024;
    });

    const GAME = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    addEventListener('keydown', (e) => {
      if (GAME.has(e.code)) e.preventDefault();
      if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
      this.keys.add(e.code);
      if (this.touch && GAME.has(e.code)) this.setTouch(false);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    const jump = (e) => { e.preventDefault(); e.stopPropagation(); this.jumpQueued = true; jumpBtn.classList.add('down'); };
    const up = () => jumpBtn.classList.remove('down');
    jumpBtn.addEventListener('pointerdown', jump);
    jumpBtn.addEventListener('pointerup', up);
    jumpBtn.addEventListener('pointercancel', up);
    jumpBtn.addEventListener('pointerleave', up);
    jumpBtn.addEventListener('click', (e) => e.preventDefault());
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
    const out = { move: { x, y }, look: { ...this.look }, jump: this.jumpQueued };
    this.look.dx = this.look.dy = 0;
    this.jumpQueued = false;
    return out;
  }
}
