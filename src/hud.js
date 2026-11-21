import { TEAMS } from './factions.js';

const $ = (id) => document.getElementById(id);
const ORDER_NAMES = { follow: 'Follow', hold: 'Hold', attack: 'Attack' };

// Plain readouts: health line, squad order, army counts, weapon + ammo, crosshair, hit ticks.
export class Hud {
  constructor() {
    this.hp = $('hpbar');
    this.order = $('order');
    this.counts = $('counts');
    this.wname = $('wname');
    this.ammo = $('ammo');
    this.heat = $('heat');
    this.cross = $('cross');
    this.hurtEl = $('hurt');
    this.useBtn = $('use');
    this.hint = $('hint');
    this.last = {};
    this.hitT = 0;
    this.hurtK = 0;
    this.counts.innerHTML = TEAMS.map((t, i) => `<span><i style="background:${t.ui}"></i><b id="count${i}">0</b></span>`).join('');
  }

  set(el, key, v) {
    if (this.last[key] === v) return;
    this.last[key] = v;
    el.textContent = v;
  }

  hit(kill) {
    this.hitT = kill ? 0.35 : 0.16;
    this.cross.classList.toggle('kill', kill);
  }

  hurt(dmg) { this.hurtK = Math.min(1, this.hurtK + dmg / 50); }

  update(dt, player, world, { useNear, vehicle } = {}) {
    const hpK = Math.max(0, player.hp / player.maxHp);
    if (this.last.hp !== Math.round(hpK * 100)) {
      this.last.hp = Math.round(hpK * 100);
      this.hp.style.transform = `scaleX(${hpK})`;
      this.hp.parentElement.classList.toggle('low', hpK < 0.35);
    }
    this.set(this.order, 'order', ORDER_NAMES[world.order]);
    const n = world.counts();
    n.forEach((c, i) => this.set($(`count${i}`), `c${i}`, String(c)));
    if (vehicle) {
      const w = vehicle.weapon;
      this.set(this.wname, 'wn', w ? w.name : vehicle.def.name);
      this.set(this.ammo, 'am', w ? (w.cool > 0.05 && w.reload > 1 ? '…' : '') : '');
      this.heat.style.transform = `scaleX(${w ? Math.max(0, 1 - w.cool / w.reload) : 0})`;
      this.heat.parentElement.hidden = false;
    } else {
      const w = player.weapon;
      this.set(this.wname, 'wn', w.def.name);
      if (w.def.heat) {
        this.set(this.ammo, 'am', w.locked > 0 ? 'hot' : '');
        this.heat.style.transform = `scaleX(${w.heat})`;
        this.heat.parentElement.hidden = false;
      } else {
        this.heat.parentElement.hidden = true;
        const r = w.reserve === Infinity || world.god ? '∞' : w.reserve;
        this.set(this.ammo, 'am', player.reloadT > 0 ? '…' : `${w.mag} / ${r}`);
      }
    }
    this.hitT = Math.max(0, this.hitT - dt);
    this.cross.classList.toggle('hit', this.hitT > 0);
    this.hurtK = Math.max(0, this.hurtK - dt * 1.2);
    this.hurtEl.style.opacity = this.hurtK.toFixed(2);
    if (this.useBtn) this.useBtn.hidden = !useNear;
    if (this.hint) this.set(this.hint, 'hint', useNear ? useNear : '');
    this.hint?.classList.toggle('on', !!useNear);
  }
}
