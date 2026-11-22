import { TEAMS } from './factions.js';
import { SLOTS } from './weapons.js';
import { HALF } from './world.js';
import { minimapImage } from './terrain.js';

const $ = (id) => document.getElementById(id);

// Heads-up display: points and tickets, radar, health, weapon, crosshair, hit markers,
// a short feed of the player's kills and point captures.
export class Hud {
  constructor() {
    this.el = $('hud');
    this.hp = $('hpbar'); this.hpNum = $('hpnum');
    this.wname = $('wname'); this.ammo = $('ammo');
    this.heat = $('heat'); this.heatBar = this.heat.parentElement;
    this.cross = $('cross'); this.hitEl = $('hitmark'); this.hurtEl = $('hurt');
    this.pointsEl = $('points'); this.ticketsEl = $('tickets');
    this.feed = $('feed'); this.banner = $('banner');
    this.cap = $('capture'); this.capText = $('capText'); this.capFill = $('capFill');
    this.slots = $('slots');
    this.radar = $('radar'); this.rc = this.radar.getContext('2d');
    this.hitT = 0; this.hurtT = 0; this.bannerT = 0; this.radarT = 0;
    this.last = {};
    this.slots.innerHTML = SLOTS.map(() => '<span></span>').join('');
  }

  show(on) { this.el.hidden = !on; }

  setup(battle) {
    this.pointsEl.innerHTML = battle.points.map((p) => `<span class="pt" data-p="${p.name}">${p.name}<i></i></span>`).join('');
    this.ticketsEl.innerHTML = battle.teams.map((t) => `<span class="tk" data-t="${t.id}"><i style="background:${TEAMS[t.id].ui}"></i>${TEAMS[t.id].short} <b class="num">0</b></span>`).join('');
    this.ticketsEl.hidden = battle.settings.mode !== 'battle';
    this.feed.innerHTML = '';
    this.last = {};
  }

  hit(kill) {
    this.hitT = kill ? 0.35 : 0.18;
    this.hitEl.classList.toggle('kill', !!kill);
  }
  hurt(dmg) { this.hurtT = Math.min(1, this.hurtT + dmg / 45); }

  say(text, t = 2.2) {
    this.banner.textContent = text;
    this.banner.classList.add('on');
    this.bannerT = t;
  }

  log(text, me = false) {
    const li = document.createElement('li');
    li.textContent = text;
    if (me) li.className = 'me';
    this.feed.prepend(li);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => li.remove(), 6000);
  }

  update(dt, player, battle, cam) {
    // health
    const hp = Math.max(0, Math.round(player.hp));
    if (hp !== this.last.hp) {
      this.last.hp = hp;
      this.hp.style.width = `${hp}%`;
      this.hp.classList.toggle('low', hp < 35);
      this.hpNum.textContent = hp;
    }
    // weapon
    const w = player.weapon, def = w.def;
    const ammo = def.heat ? `${Math.round(w.heat * 100)}%` : `${w.mag}${w.reserve === Infinity ? '' : ` / ${w.reserve}`}`;
    const label = player.reloadT > 0 ? 'Reloading' : def.name;
    if (ammo !== this.last.ammo) { this.ammo.textContent = ammo; this.last.ammo = ammo; }
    if (label !== this.last.label) { this.wname.textContent = label; this.last.label = label; }
    this.heatBar.hidden = !def.heat;
    if (def.heat) { this.heat.style.width = `${w.heat * 100}%`; this.heat.classList.toggle('hot', w.locked > 0); }
    if (player.wi !== this.last.wi) {
      this.last.wi = player.wi;
      [...this.slots.children].forEach((s, i) => s.classList.toggle('on', i === player.wi));
    }
    // crosshair gap grows with spread, movement and suppression
    const moving = Math.hypot(player.vel.x, player.vel.z) > 0.5;
    const gap = 5 + (def.spread || 0.01) * 260 * (1 + (moving ? 1.2 : 0)) * (1 - 0.5 * cam.ads) + player.recoil * 5;
    this.cross.style.setProperty('--g', `${gap.toFixed(1)}px`);
    this.cross.classList.toggle('ads', cam.ads > 0.6);
    this.hitT = Math.max(0, this.hitT - dt);
    this.hitEl.style.opacity = this.hitT > 0 ? 1 : 0;
    this.hurtT = Math.max(0, this.hurtT - dt * 1.4);
    this.hurtEl.style.opacity = this.hurtT.toFixed(2);
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner.classList.remove('on'); }

    // points + tickets (a few times a second)
    this.radarT -= dt;
    if (this.radarT > 0) return;
    this.radarT = 0.12;
    const me = player.team;
    for (const p of battle.points) {
      const el = this.pointsEl.querySelector(`[data-p="${p.name}"]`);
      if (!el) continue;
      el.style.background = p.owner >= 0 ? hexA(TEAMS[p.owner].ui, 0.55) : '';
      el.classList.toggle('mine', p.owner === me);
      const bar = el.firstElementChild;
      bar.style.width = `${Math.round((p.owner >= 0 ? p.capture : p.capture) * 100)}%`;
      bar.style.background = p.capTeam >= 0 ? TEAMS[p.capTeam].ui : '';
    }
    for (const t of battle.teams) {
      const el = this.ticketsEl.querySelector(`[data-t="${t.id}"]`);
      if (!el) continue;
      el.lastElementChild.textContent = t.tickets + t.alive;
      el.classList.toggle('lost', t.lost);
    }
    // capture progress when standing on a point
    const on = player.alive && battle.points.find((p) => (player.pos.x - p.pos.x) ** 2 + (player.pos.z - p.pos.z) ** 2 < p.r * p.r);
    if (on && (on.owner !== me || on.capture < 1 || on.contested)) {
      this.cap.hidden = false;
      const txt = on.contested ? `Contested ${on.name}` : on.owner === me ? `Securing ${on.name}` : on.capTeam === me ? `Capturing ${on.name}` : `Neutralising ${on.name}`;
      this.capText.textContent = txt;
      this.capFill.style.width = `${Math.round((on.capTeam === me || on.owner === me ? on.capture : 1 - on.capture) * 100)}%`;
    } else this.cap.hidden = true;
    this.drawRadar(player, battle, cam);
  }

  drawRadar(player, battle, cam) {
    const c = this.rc, W = this.radar.width;
    const R = 60; // metres shown from centre to edge
    const s = W / 2 / R;
    c.clearRect(0, 0, W, W);
    c.save();
    c.translate(W / 2, W / 2);
    // rotate so the view direction points up
    c.rotate(cam.mode === 'over' ? 0 : cam.yaw);
    const ox = cam.mode === 'over' ? cam.over.x : player.pos.x, oz = cam.mode === 'over' ? cam.over.z : player.pos.z;
    const X = (x) => (x - ox) * s, Z = (z) => (z - oz) * s;
    // the ground itself: hill shading, roads and contours
    const map = minimapImage();
    if (map) { c.globalAlpha = 0.55; c.drawImage(map, X(-HALF), Z(-HALF), HALF * 2 * s, HALF * 2 * s); c.globalAlpha = 1; }
    c.strokeStyle = 'rgba(230,232,228,0.18)';
    c.lineWidth = 2;
    c.strokeRect(X(-HALF), Z(-HALF), HALF * 2 * s, HALF * 2 * s);
    for (const p of battle.points) {
      c.fillStyle = p.owner >= 0 ? TEAMS[p.owner].ui : 'rgba(230,232,228,0.5)';
      c.globalAlpha = 0.35;
      c.beginPath(); c.arc(X(p.pos.x), Z(p.pos.z), p.r * s, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    }
    for (const u of battle.units) {
      if (!u.alive || u === player) continue;
      const x = X(u.pos.x), z = Z(u.pos.z);
      if (Math.abs(x) > W * 0.75 || Math.abs(z) > W * 0.75) continue;
      // enemies show only when somebody on your side has them in sight or they're shooting
      if (u.team !== player.team && u.t - u.lastShot > 1.5 && !(battle.time < (u.spottedUntil || 0))) continue;
      c.fillStyle = TEAMS[u.team].ui;
      c.fillRect(x - 3, z - 3, 6, 6);
    }
    c.restore();
    // you, at the centre
    c.fillStyle = '#ff7a1a';
    c.beginPath();
    c.moveTo(W / 2, W / 2 - 9); c.lineTo(W / 2 + 6, W / 2 + 6); c.lineTo(W / 2 - 6, W / 2 + 6); c.closePath();
    c.fill();
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
