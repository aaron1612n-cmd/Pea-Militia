import * as THREE from 'three';

// Squad command wheel: the player's orders to nearby friendly squads. A commanded squad runs
// in manual mode (the AI commander leaves it alone) until it is told to regroup, which hands it
// back to the commander once it reaches the player.
export const ORDERS = [
  { id: 'hold', label: 'Hold', hint: 'Stay put and cover' },
  { id: 'advance', label: 'Advance', hint: 'Push ahead of you' },
  { id: 'follow', label: 'Follow', hint: 'Stick close' },
  { id: 'attack', label: 'Attack', hint: 'Go where you aim' },
  { id: 'regroup', label: 'Regroup', hint: 'Fall in, then free' },
];

const RANGE = 80, MAX_SQUADS = 4, EDGE = 78;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clampEdge = (v) => { v.x = THREE.MathUtils.clamp(v.x, -EDGE, EDGE); v.z = THREE.MathUtils.clamp(v.z, -EDGE, EDGE); return v; };

export function nearSquads(battle, player) {
  const out = [];
  for (const s of battle.squads) {
    if (s.team !== player.team || !s.alive.length) continue;
    const d = flat(s.leader.pos, player.pos);
    if (d < RANGE) out.push({ s, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, MAX_SQUADS).map((x) => x.s);
}

// view: { dir: unit Vector3 (camera forward), aim: Vector3 (what the crosshair is on) }
export function issue(battle, player, id, view) {
  const squads = nearSquads(battle, player);
  if (!squads.length) return 0;
  const fwd = new THREE.Vector3(view.dir.x, 0, view.dir.z);
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  let target = null;
  if (id === 'advance') target = clampEdge(player.pos.clone().addScaledVector(fwd, 45));
  if (id === 'attack') {
    const a = view.aim, far = flat(a, player.pos) > 220;
    target = far ? clampEdge(player.pos.clone().addScaledVector(fwd, 60)) : clampEdge(a.clone());
    for (const p of battle.points) if (flat(p.pos, target) < p.r + 6) { target = p.pos.clone(); break; }
  }
  squads.forEach((s, i) => {
    s.manual = true;
    s.cmd = id;
    s.objective = null;
    s.waypoint = null;
    s.retreating = false;
    const lead = s.leader.pos;
    if (id === 'hold') s.order = new THREE.Vector3(lead.x, 0, lead.z);
    else if (id === 'follow' || id === 'regroup') s.order = new THREE.Vector3(player.pos.x, 0, player.pos.z);
    else {
      // squads spread a little so they don't stack on one spot
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar((i - (squads.length - 1) / 2) * 7);
      s.order = clampEdge(target.clone().add(side));
    }
  });
  return squads.length;
}

// each frame: followers track the player, regrouped squads go back to the commander
export function tick(battle, player) {
  if (!player.alive) return;
  for (const s of battle.squads) {
    if (!s.cmd || s.team !== player.team || !s.alive.length) continue;
    if (s.cmd === 'follow' || s.cmd === 'regroup') {
      const back = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing)).multiplyScalar(-4);
      s.order = new THREE.Vector3(player.pos.x + back.x, 0, player.pos.z + back.z);
      if (s.cmd === 'regroup' && flat(s.leader.pos, player.pos) < 9) { s.manual = false; s.cmd = null; s.order = null; }
    }
  }
}

// The wheel itself: five wedges round a hub. Desktop: hold T and nudge the mouse toward a wedge,
// release to give the order (or press 1-5). Touch: tap the button, then tap a wedge.
export class Wheel {
  constructor(root, onPick) {
    this.root = root;
    this.onPick = onPick;
    this.open = false;
    this.sel = -1;
    this.v = { x: 0, y: 0 };
    this.hub = root.querySelector('.wheel-hub');
    this.btns = ORDERS.map((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wheel-item';
      const a = (i / ORDERS.length) * Math.PI * 2 - Math.PI / 2;
      b.style.setProperty('--x', Math.cos(a).toFixed(3));
      b.style.setProperty('--y', Math.sin(a).toFixed(3));
      b.innerHTML = `<span class="num">${i + 1}</span>${o.label}`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => { e.preventDefault(); this.pick(i); });
      b.addEventListener('pointerenter', () => this.hover(i));
      root.querySelector('.wheel-ring').appendChild(b);
      return b;
    });
  }

  show(on) {
    this.open = on;
    this.root.hidden = !on;
    this.v.x = this.v.y = 0;
    this.hover(-1);
  }

  hover(i) {
    this.sel = i;
    this.btns.forEach((b, k) => b.classList.toggle('on', k === i));
    this.hub.textContent = i >= 0 ? ORDERS[i].hint : 'Squad orders';
  }

  // mouse deltas steer a virtual cursor; the wedge it points at is the choice
  nudge(dx, dy) {
    this.v.x += dx * 180; this.v.y += dy * 180;
    const l = Math.hypot(this.v.x, this.v.y);
    if (l > 90) { this.v.x *= 90 / l; this.v.y *= 90 / l; }
    if (l < 28) { if (this.sel >= 0 && Math.hypot(this.v.x, this.v.y) < 28) this.hover(-1); return; }
    let a = Math.atan2(this.v.y, this.v.x) + Math.PI / 2;
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const i = Math.round(a / ((Math.PI * 2) / ORDERS.length)) % ORDERS.length;
    if (i !== this.sel) this.hover(i);
  }

  pick(i) {
    if (i < 0 || i >= ORDERS.length) return;
    this.show(false);
    this.onPick(ORDERS[i].id);
  }
}
