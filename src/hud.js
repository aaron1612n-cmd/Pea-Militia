import * as THREE from 'three';
import { TEAMS } from './factions.js';
import { SLOTS } from './weapons.js';
import { HALF } from './world.js';
import { minimapImage } from './terrain.js';

const $ = (id) => document.getElementById(id);
const V = new THREE.Vector3();
const PX = 2.2; // compass pixels per degree

// Heads-up display: points and tickets, radar, health, weapon, crosshair, hit markers,
// a short feed of the player's kills and point captures.
export class Hud {
  constructor() {
    this.el = $('hud');
    this.hp = $('hpbar'); this.hpNum = $('hpnum'); this.stam = $('stambar');
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
    // compass strip: three turns of ticks so it can scroll either way without a seam
    this.compass = $('compass'); this.supp = $('supp');
    const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let d = -360; d <= 720; d += 15) {
      const n = ((d % 360) + 360) % 360;
      html += CARD[n] ? `<span class="card" style="left:${d * PX}px">${CARD[n]}</span>` : `<span class="tick" style="left:${d * PX}px"></span>`;
    }
    this.compass.innerHTML = html + '<b id="cobj"></b>';
    this.cobj = $('cobj');
    this.marks = $('marks'); this.mc = this.marks.getContext('2d');
    this.bigEl = $('bigmap'); this.big = $('bigcanvas'); this.bc = this.big.getContext('2d');
    this.radar.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.toggleMap(true); });
    this.bigEl.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.toggleMap(false); });
  }

  // squad markers: a small chevron over each friendly in view, fading with distance
  drawMarks(player, battle, camera) {
    const c = this.marks, dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = this.mc;
    g.clearRect(0, 0, W, H);
    if (!player.alive) return;
    g.fillStyle = TEAMS[player.team].ui;
    for (const u of battle.units) {
      if (u === player || !u.alive || u.team !== player.team) continue;
      const dx = u.pos.x - player.pos.x, dz = u.pos.z - player.pos.z, d = Math.hypot(dx, dz);
      if (d > 45 || d < 2) continue;
      V.set(u.pos.x, u.pos.y + 1.45, u.pos.z).project(camera);
      if (V.z > 1 || Math.abs(V.x) > 1 || Math.abs(V.y) > 1) continue;
      const x = (V.x * 0.5 + 0.5) * W, y = (-V.y * 0.5 + 0.5) * H, s = (4 + 3 * (1 - d / 45)) * dpr;
      g.globalAlpha = 0.85 * (1 - d / 55) * (u.squad === player.squad ? 1 : 0.7);
      g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y - s); g.lineTo(x, y + s * 0.4); g.closePath(); g.fill();
    }
    for (const v of battle.vehicles) {
      if (!v.alive || v.team !== player.team || v === player.vehicle) continue;
      const d = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z);
      if (d > 90 || d < 4) continue;
      V.set(v.pos.x, v.pos.y + 3.2, v.pos.z).project(camera);
      if (V.z > 1 || Math.abs(V.x) > 1 || Math.abs(V.y) > 1) continue;
      const x = (V.x * 0.5 + 0.5) * W, y = (-V.y * 0.5 + 0.5) * H, s = 9 * dpr;
      g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y - s); g.lineTo(x, y + s * 0.6); g.closePath(); g.fill();
    }
    // enemies you or your squad have tagged: an orange diamond with the range, seen through cover
    g.font = `600 ${Math.round(11 * dpr)}px "Chakra Petch", sans-serif`; g.textAlign = 'center';
    for (const e of [...battle.units, ...battle.vehicles]) {
      if (!e.alive || e.team === player.team || !(battle.time < (e.markedUntil || 0))) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      V.set(e.pos.x, e.pos.y + (e.crew ? 4 : 2.1), e.pos.z).project(camera);
      if (V.z > 1 || Math.abs(V.x) > 1 || Math.abs(V.y) > 1) continue;
      const x = (V.x * 0.5 + 0.5) * W, y = (-V.y * 0.5 + 0.5) * H, s = 7 * dpr;
      g.globalAlpha = Math.min(1, (e.markedUntil - battle.time) / 2);
      g.fillStyle = '#ff7a1a'; g.strokeStyle = '#101316'; g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath(); g.fill(); g.stroke();
      g.lineWidth = 3 * dpr; g.strokeText(`${Math.round(d)}m`, x, y - s - 4 * dpr); g.fillText(`${Math.round(d)}m`, x, y - s - 4 * dpr);
    }
    g.globalAlpha = 1;
  }

  show(on) { this.el.hidden = !on; if (!on) this.bigEl.hidden = true; }

  setup(battle) {
    this.cobj.innerHTML = battle.points.map((p) => `<span class="obj" data-p="${p.name}">${p.name}</span>`).join('');
    this.objEls = [...this.cobj.children];
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
    // compass: heading from the view, north is -z; objectives sit at their bearing
    const head = ((-cam.yaw * 180) / Math.PI % 360 + 360) % 360;
    const cw = this.compass.parentElement.clientWidth;
    this.compass.style.transform = `translateX(${(cw / 2 - head * PX).toFixed(1)}px)`;
    battle.points.forEach((p, i) => {
      const el = this.objEls?.[i];
      if (!el) return;
      let b = (Math.atan2(p.pos.x - player.pos.x, -(p.pos.z - player.pos.z)) * 180) / Math.PI;
      b = ((b % 360) + 360) % 360;
      if (b - head > 180) b -= 360; else if (head - b > 180) b += 360;
      el.style.left = `${b * PX}px`;
      const col = p.owner >= 0 ? TEAMS[p.owner].ui : '#d8d8d4';
      if (el.dataset.c !== col) { el.dataset.c = col; el.style.background = col; }
    });
    // suppression: the edges close in under fire
    const sp = Math.round((player.alive ? player.suppression : 0) * 20) / 20;
    if (sp !== this.last.sp) { this.last.sp = sp; this.supp.style.opacity = Math.min(1, sp * 1.3); }
    // health
    const st = Math.round((player.stamina ?? 1) * 50) / 50;
    if (st !== this.last.st || !!player.winded !== this.last.wd) {
      this.last.st = st; this.last.wd = !!player.winded;
      this.stam.style.transform = `scaleX(${st})`;
      this.stam.classList.toggle('full', st >= 1);
      this.stam.classList.toggle('winded', !!player.winded);
    }
    const veh = player.vehicle;
    const hp = Math.max(0, Math.round(veh ? veh.hp01 * 100 : player.hp));
    if (hp !== this.last.hp) {
      this.last.hp = hp;
      this.hp.style.width = `${hp}%`;
      this.hp.classList.toggle('low', hp < 35);
      this.hpNum.textContent = hp;
    }
    // weapon
    const w = veh ? veh.hudWeapon() : player.weapon, def = w.def;
    const ammo = def.heat ? `${Math.round(w.heat * 100)}%` : `${w.mag}${w.reserve === Infinity ? '' : ` / ${w.reserve}`}`;
    const label = veh ? def.name : player.reloadT > 0 ? 'Reloading' : def.name;
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
    this.lastPlayer = player; this.lastBattle = battle; this.lastCam = cam;
    this.drawRadar(player, battle, cam);
    this.paintBig(player, battle, cam);
  }

  drawRadar(player, battle, cam) {
    const over = cam.mode === 'over';
    this.paintMap(this.rc, this.radar.width, 60, over ? cam.over.x : player.pos.x, over ? cam.over.z : player.pos.z, over ? 0 : cam.yaw, player, battle, cam, false);
  }

  // the full battlefield, north up, with every point named (N or tap the radar)
  toggleMap(on = this.bigEl.hidden) { this.bigEl.hidden = !on; if (on) this.paintBig(this.lastPlayer, this.lastBattle, this.lastCam); }
  paintBig(player, battle, cam) {
    if (!player || this.bigEl.hidden) return;
    const c = this.big, W = this.big.width;
    this.paintMap(this.bc, W, HALF * 1.04, 0, 0, 0, player, battle, cam, true);
  }

  // One painter for both maps. `R` is metres from centre to edge; `rot` turns the world so the view points up.
  paintMap(c, W, R, ox, oz, rot, player, battle, cam, full) {
    const s = W / 2 / R, k = W / 150; // k keeps marker sizes steady whatever the canvas size
    c.clearRect(0, 0, W, W);
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(rot);
    const X = (x) => (x - ox) * s, Z = (z) => (z - oz) * s;
    // the ground itself: hill shading, roads and contours
    const map = minimapImage();
    if (map) { c.globalAlpha = full ? 0.8 : 0.55; c.drawImage(map, X(-HALF), Z(-HALF), HALF * 2 * s, HALF * 2 * s); c.globalAlpha = 1; }
    c.strokeStyle = 'rgba(230,232,228,0.18)';
    c.lineWidth = 2;
    c.strokeRect(X(-HALF), Z(-HALF), HALF * 2 * s, HALF * 2 * s);
    c.font = `600 ${Math.round(13 * k)}px "Chakra Petch", sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const p of battle.points) {
      const col = p.owner >= 0 ? TEAMS[p.owner].ui : '#d8d8d4';
      c.fillStyle = col;
      c.globalAlpha = 0.3;
      c.beginPath(); c.arc(X(p.pos.x), Z(p.pos.z), p.r * s, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
      c.save(); c.translate(X(p.pos.x), Z(p.pos.z)); c.rotate(-rot);
      let lx = 0, lz = 0, off = false;
      // a point beyond the edge of the radar shows as a lettered tab on the rim
      const d = Math.hypot(X(p.pos.x), Z(p.pos.z)), lim = W / 2 - 11 * k;
      if (!full && d > lim) { off = true; lx = -X(p.pos.x) * (1 - lim / d); lz = -Z(p.pos.z) * (1 - lim / d); const q = Math.cos(rot), w = Math.sin(rot); const rx = lx * q + lz * w, rz = -lx * w + lz * q; lx = rx; lz = rz; }
      c.translate(lx, lz);
      c.fillStyle = 'rgba(14,17,20,0.85)';
      c.fillRect(-8 * k, -8 * k, 16 * k, 16 * k);
      c.strokeStyle = col; c.lineWidth = 1.5 * k; c.strokeRect(-8 * k, -8 * k, 16 * k, 16 * k);
      c.fillStyle = col;
      c.fillText(p.name, 0, 1 * k);
      c.restore();
      if (off) continue;
    }
    for (const u of battle.units) {
      if (!u.alive || u === player || u.vehicle) continue;
      const x = X(u.pos.x), z = Z(u.pos.z);
      if (Math.abs(x) > W * 0.75 || Math.abs(z) > W * 0.75) continue;
      const foe = u.team !== player.team;
      // enemies show only when somebody on your side has them in sight or they're shooting
      if (foe && u.t - u.lastShot > 1.5 && !(battle.time < (u.spottedUntil || 0))) continue;
      if (foe) this.foe(c, x, z, k, battle.time < (u.markedUntil || 0), rot);
      else {
        c.fillStyle = TEAMS[u.team].ui;
        const r = (u.squad === player.squad ? 3.4 : 2.6) * k;
        c.fillRect(x - r, z - r, r * 2, r * 2);
      }
    }
    for (const v of battle.vehicles) {
      if (!v.alive || v === player.vehicle) continue;
      const foe = v.team !== player.team;
      if (foe && v.t - v.lastShot > 2 && !(battle.time < (v.spottedUntil || 0))) continue;
      c.save();
      c.translate(X(v.pos.x), Z(v.pos.z));
      c.rotate(-v.yaw + Math.PI);
      c.fillStyle = TEAMS[v.team].ui;
      c.fillRect(-4 * k, -7 * k, 8 * k, 14 * k);
      c.fillStyle = '#101316';
      c.fillRect(-1 * k, -7 * k, 2 * k, 6 * k);
      c.restore();
      if (foe) this.foe(c, X(v.pos.x), Z(v.pos.z), k * 1.6, battle.time < (v.markedUntil || 0), rot);
    }
    // you
    c.save();
    c.translate(X(player.pos.x), Z(player.pos.z));
    if (full) c.rotate(-cam.yaw); else c.rotate(-rot);
    c.fillStyle = '#ff7a1a';
    c.beginPath();
    c.moveTo(0, -9 * k); c.lineTo(6 * k, 6 * k); c.lineTo(-6 * k, 6 * k); c.closePath();
    c.fill();
    c.restore();
    c.restore();
  }

  // a spotted enemy: a hollow diamond, filled and ringed when you tagged it yourself
  foe(c, x, z, k, marked, rot) {
    const r = 5 * k;
    c.save(); c.translate(x, z); c.rotate(-rot);
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r, 0); c.lineTo(0, r); c.lineTo(-r, 0); c.closePath();
    c.fillStyle = marked ? '#ff7a1a' : 'rgba(226,81,59,0.9)'; c.fill();
    c.lineWidth = 1.2 * k; c.strokeStyle = '#101316'; c.stroke();
    if (marked) { c.beginPath(); c.arc(0, 0, r * 1.9, 0, Math.PI * 2); c.strokeStyle = '#ff7a1a'; c.lineWidth = 1.5 * k; c.stroke(); }
    c.restore();
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
