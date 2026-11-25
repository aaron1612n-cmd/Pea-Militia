import * as THREE from 'three';
import { U, pose, makePose, HOLD } from './rig.js';
import { Sway } from './secondary.js';
import { Planter } from './planter.js';
import { strideLength, dirScale } from './clips.js';
import { WEAPONS, makeWeapon } from './weapons.js';
import { wrap } from './physics.js';
import { Ragdoll } from './ragdoll.js';
import { CLASSES, NEUTRAL } from './classes.js';

export const RADIUS = U.RADIUS;
export const WALK = 2.2; // m/s
export const SPRINT = 1.9; // a real sprint: with the stride in gait.js this reads as running, not speed walking
const GRAVITY = 17;
const lerp = THREE.MathUtils.lerp;
const JUMP_V = 4.8;
// The fastest any soldier can run on their own: walk pace times the sprint multiplier. One source
// of truth; weapon, stance and suppression modifiers only ever slow a soldier from here.
export const MAX_SPEED = WALK * SPRINT * 1.75; // fastest class (assault) mid-dash

// getting down and up passes through one knee: the legs fold and the hips drop before the chest goes forward
const kneelBump = (p) => THREE.MathUtils.smoothstep(p, 0.02, 0.22) * (1 - THREE.MathUtils.smoothstep(p, 0.3, 0.6));
let nextId = 1;
const WALL_O = new THREE.Vector3(), WALL_D = new THREE.Vector3();

// One soldier: movement, health, weapons and the animation state that ties them together.
// Driven each frame through `ctrl` by the player's input or an AI brain.
export class Unit {
  constructor({ team = 0, loadout = ['rifle'], pos, kind = 'rifleman' } = {}) {
    this.id = nextId++;
    this.team = team;
    this.kind = kind;
    this.pos = new THREE.Vector3();
    if (pos) this.pos.copy(pos);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.grounded = true;
    this.coyote = 0;
    this.buffer = 0;
    this.cycle = Math.random();
    this.walk = 0;
    this.air = 0;
    this.landT = 1;
    this.landK = 0;
    this.t = Math.random() * 10;
    this.jumps = 0;
    this.distance = 0;
    this.mx = 0; this.mz = 1;

    const cls = CLASSES[kind];
    this.maxHp = cls?.hp ?? 100;
    this.hp = this.maxHp;
    this.speedK = cls?.speed ?? 1;
    this.mod = NEUTRAL; this.skillT = 0; this.skillCd = 0; this.skillMax = 1; this.skillFlash = 0;
    this.alive = true;
    this.deadT = 0;
    this.lastHurt = -99;
    this.burn = 0;
    this.suppression = 0;
    this.flinch = 0;
    this.dying = false; this.dyingT = 0; this.dyK = 0; this.clutch = 0; this.dyHit = null; this.dyFrom = null; this.dyFight = false;
    this.kills = 0;
    this.god = false;
    this.shots = 0;
    // battlefield injuries: bleeding (hp/s), crippled legs, down and crawling, stagger, shell shock
    this.bleed = 0; this.leg = 0; this.arm = 0; this.down = false; this.stagger = 0; this.shock = 0;
    this.dying = false; this.dyK = 0; this.clutch = 0; this.dyHit = null;
    this.bandageT = 0; this.jamT = 0; this.cry = 0; this.corpseHp = 70;
    this.trauma = 0; this.hitN = 0; this.traumaT = 0; this.limpSide = Math.random() < 0.5 ? -1 : 1;

    this.weapons = loadout.map((id) => makeWeapon(id));
    this.wi = 0;
    this.cool = 0;
    this.reloadT = 0;
    this.throwT = 0;
    this.thrown = false;
    this.recoil = 0;
    this.recoilBuild = 0; this.shotIdx = 0; this.kickP = 0; this.kickY = 0; // climbing recoil pattern and the view kick waiting to be applied
    this.reloadDur = 1; this.reloadEmpty = false; this.adsT = 0;
    this.lastShot = -99;
    this.wasFiring = false;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.twist = 0;
    this.kneelK = 0;
    this.ready = 0.6;
    this.wallK = 0; // 0..1: how far a wall ahead crowds the gun (it comes up to a high ready)
    this.wallT = 0;
    this.ads = 0;
    this.ctrl = { wx: 0, wz: 0, jump: false, fire: false, aimAt: null, kneel: false, speed: 1, sprint: false, turnRate: Infinity };
    this.poseOut = makePose();
    this.planter = new Planter();
    this.tendK = 0; this.dragK = 0; this.drgK = 0; this.tendT = 0; this.dragT = 0; this.draggedT = 0; this.tendTarget = null; // tending a casualty, hauling one, being hauled
    this.hs = { x: 0, z: 0, vx: 0, vz: 0 }; // how the torso is rocked by hits (rad, rad/s): pitch and roll
    this.gl = [0, 0, 0, 0]; this.glv = [0, 0, 0, 0]; this.lastAim = 0; this.lastAimP = 0; // the gun's lag behind a turning body: yaw, pitch, x, y
    this.animLod = 0; // 0 near the camera .. 2 far: how much of the animation is worth computing
    this.poseState = {};
    this.world = new THREE.Matrix4();
    this.box = { x: 0, z: 0, yaw: 0, hx: U.W / 2, hz: U.D / 2, h: U.TOP, y0: 0 };
  }

  get weapon() { return this.weapons[this.wi]; }
  get busy() { return this.reloadT > 0 || this.throwT > 0; }

  // lean: sideways offset (world x/z) of a point at height y above the feet, and its drop
  leanOff(y) {
    const a = (this.leanK || 0) * 0.32, r = Math.max(0, y - (U.LIFT + 0.15));
    const side = -Math.sin(a) * r;
    return [Math.cos(this.facing) * side, -Math.sin(this.facing) * side, r * (1 - Math.cos(a))];
  }
  center(out = new THREE.Vector3()) {
    const p = this.proneK || 0;
    const y = U.BODY_Y - U.KNEEL_DROP * this.kneelK;
    const [lx, lz, ld] = this.leanOff(y);
    return out.set(this.pos.x + lx, this.pos.y + lerp(y - ld, 0.18, p), this.pos.z + lz);
  }
  eye(out = new THREE.Vector3()) {
    const p = this.proneK || 0;
    const y = U.EYE - U.KNEEL_DROP * this.kneelK;
    const [lx, lz, ld] = this.leanOff(y);
    const f = 0.42 * p;
    return out.set(this.pos.x + lx + Math.sin(this.facing) * f, this.pos.y + lerp(y - ld, 0.36, p), this.pos.z + lz + Math.cos(this.facing) * f);
  }
  muzzle(out = new THREE.Vector3()) {
    if (this.muzzleOverride) return out.copy(this.muzzleOverride); // first-person gun
    return out.copy(this.poseOut.muzzle).applyMatrix4(this.world);
  }
  // hit box: the body block, shorter when kneeling
  hitBox() {
    const b = this.box;
    b.x = this.pos.x; b.z = this.pos.z; b.yaw = this.facing;
    b.y0 = this.pos.y + U.LIFT * 0.3 - U.KNEEL_DROP * this.kneelK;
    b.h = U.TOP - U.LIFT * 0.3;
    b.hx = U.W / 2; b.hz = U.D / 2;
    const p = this.proneK || 0;
    if (p > 0.5) { b.y0 = this.pos.y; b.h = U.D + 0.04; b.hz = (U.TOP - U.LIFT) / 2; }
    else if (Math.abs(this.leanK || 0) > 0.05) { const [lx, lz] = this.leanOff(U.BODY_Y); b.x += lx * 0.7; b.z += lz * 0.7; }
    return b;
  }

  setWeapon(i, force = false) {
    if (i < 0 || i >= this.weapons.length || (i === this.wi && !force)) return;
    this.wi = i;
    this.reloadT = 0;
    this.throwT = 0;
    this.cool = force ? 0 : 0.35;
  }

  cycleWeapon(d) {
    const n = this.weapons.length;
    this.setWeapon((this.wi + d + n) % n);
  }

  startReload() {
    const w = this.weapon;
    if (this.busy || w.def.heat || w.mag >= w.def.mag || w.reserve <= 0) return false;
    // a part-used magazine is worth swapping only for a fuller one
    if (!w.inf && w.mag > 0 && Math.max(...w.spare) <= w.mag) return false;
    // tactical reload (rounds still in the gun): quicker, the old magazine goes back in the pouch.
    // Empty reload: full time plus working the charging handle.
    const d = w.def;
    this.reloadEmpty = w.mag <= 0;
    this.reloadDur = d.reload * (this.reloadEmpty ? d.empty + (d.rack || 0) * 0.5 : d.tac);
    this.reloadT = this.reloadDur;
    return true;
  }

  // zone: 'head' | 'torso' | 'arm' | 'leg'. Damage is already scaled by the zone.
  hurt(dmg, from, world, kind = 'bullet', zone = 'torso') {
    if (!this.alive || this.god) return;
    const dealt = dmg * this.mod.dmgIn * (this.isPlayer ? 0.8 : 1);
    this.hp -= dealt;
    this.lastHurt = this.t;
    this.flinch = Math.min(1, this.flinch + dmg / 40);
    this.hitKick(dmg, zone, kind);
    if (zone === 'torso' && kind !== 'fire' && dmg > 20) this.clutch = 1; // a hand goes to the wound
    // Rounds taken in a burst add up: nobody stays on his feet after a handful in a few seconds.
    if (kind !== 'fire') { this.trauma += dealt; this.hitN++; this.traumaT = 3; }
    const burst = !this.isPlayer && kind !== 'fire' && this.hitN >= 5;
    // A body hit rarely drops a man on the spot: he staggers, clutches the wound and goes down a
    // moment later. Only the head, a blast, fire, a very heavy round or a burst kills outright.
    if (burst && this.hp > 0) this.hp = 0;
    if (this.hp <= 0 && this.alive && kind !== 'fire') {
      const lastLegs = this.dying;
      if (!lastLegs && !burst && this.survivable(dealt, zone, kind)) {
        this.beginDying(-this.hp, zone, dmg, from, world);
        this.hp = 1;
      } else if (lastLegs && !burst && zone !== 'head' && kind !== 'blast' && dealt < 110) {
        // shot again on the way down: that costs him most of the time he has left
        this.dyingT -= 0.7 + dealt / 40; this.dyHit = this.lastHit; this.dyFrom = from || this.dyFrom;
        this.hp = 1;
        if (this.dyingT <= 0) { this.hp = 0; }
      } else this.hp = Math.min(this.hp, 0);
    }
    if (this.hp > 0 && kind !== 'fire') {
      // wounds keep bleeding until somebody bandages them; hits to the limbs cripple
      this.bleed = Math.min(4, this.bleed + dmg * (kind === 'blast' ? 0.05 : 0.035));
      if (zone === 'leg' && dmg > 14) this.leg = Math.min(1, this.leg + 0.55 + dmg / 120);
      if (zone === 'arm' && dmg > 14) this.arm = Math.min(1, this.arm + 0.6);
      if (dmg > 18) this.stagger = Math.min(1.1, Math.max(this.stagger, dmg / 70));
      if (!this.isPlayer && !this.down && (this.hp < this.maxHp * 0.3 && (zone === 'leg' || zone === 'torso' || kind === 'blast') || this.leg >= 1 || (this.trauma > this.maxHp * 0.5 && this.hp < this.maxHp * 0.55))) this.goDown(world);
      if (world?.audio && this.cry <= 0) { this.cry = 1.2 + Math.random(); world.audio.play(this.hp < this.maxHp * 0.35 ? 'scream' : 'grunt', this.center(), 1); }
    }
    if (this.onHurt) this.onHurt(dmg, from, kind);
    if (this.hp <= 0) this.die(from, world);
  }

  // a round shoves the torso the way it was travelling (body frame): back when hit from the front, over to the side when hit from one
  hitKick(dmg, zone, kind) {
    const h = this.lastHit, m = THREE.MathUtils.clamp(dmg / 45, 0.25, 1.2) * (zone === 'head' ? 1.2 : zone === 'leg' ? 0.6 : 1);
    let lx = 0, lz = 0;
    if (h?.dir && h.t === this.t) {
      const c = Math.cos(this.facing), sn = Math.sin(this.facing);
      lx = h.dir.x * c - h.dir.z * sn; lz = h.dir.x * sn + h.dir.z * c;
      const l = Math.hypot(lx, lz) || 1; lx /= l; lz /= l;
    } else { const a = (this.t * 12.9898 + dmg * 78.233) % 6.283; lx = Math.sin(a); lz = Math.cos(a); } // (a made-up direction from the clock: the shared random stream stays untouched)
    this.hs.vx += lz * 6 * m; this.hs.vz -= lx * 6 * m;
  }

  survivable(dealt, zone, kind) {
    if (this.isPlayer || zone === 'head' || kind === 'blast') return false;
    if (kind !== 'bullet' && kind !== 'plasma') return false;
    return dealt < 110 && -this.hp < 75;
  }

  // mortally wounded: still on his feet for a while, slower the worse it was
  beginDying(over, zone, dmg, from, world) {
    this.dying = true;
    const base = Math.max(0.8, 2.4 - over / 35);
    this.dyingT = base * (0.8 + Math.random() * 0.5) * (zone === 'leg' ? 1.2 : 1);
    this.dyFight = Math.random() < 0.15;
    this.dyFrom = from; this.dyHit = this.lastHit; this.stagger = 1.1; this.flinch = 1; this.clutch = 1;
    this.cry = 0;
    if (world?.audio) { world.audio.play('scream', this.center(), 1); this.cry = 2; }
    world?.events.push({ type: 'down', unit: this });
  }

  // too hurt to stand: drop and crawl for cover or a medic
  goDown(world) {
    if (this.down || this.isPlayer) return;
    this.down = true; this.stagger = 0;
    this.cry = 0;
    world?.events.push({ type: 'down', unit: this });
  }

  // back to a clean body: every wound, limb, bleed, shock and timer cleared (respawn, free-cam return)
  resetBody() {
    this.hp = this.maxHp; this.burn = 0; this.suppression = 0; this.flinch = 0;
    this.bleed = 0; this.leg = 0; this.arm = 0; this.down = false; this.stagger = 0; this.shock = 0;
    this.bandageT = 0; this.jamT = 0; this.cry = 0; this.corpseHp = 70; this.knockT = 0; this.trauma = 0; this.hitN = 0; this.traumaT = 0;
    this.wound = 0; this.lost = 0; this.wounds = null; this.marks = null; this.rag = null;
    this.stamina = 1; this.winded = false; this.restT = 0;
    this.reloadT = this.throwT = 0; this.thrown = false; this.recoil = 0; this.landT = 1;
    this.lastHurt = -99; this.lastHit = null;
  }

  // a bandage stops the bleeding and gets a downed soldier back up
  bandage(amount = 20) {
    if (this.dying) return; // too late: a mortal wound is not bandaged away
    this.bleed = 0;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.leg *= 0.5; this.arm *= 0.5;
    if (this.down && this.hp > this.maxHp * 0.3) { this.down = false; }
  }

  die(from, world) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.deadT = 0;
    if (from && from.pos && from !== this) {
      // fall away from whoever did it
      this.facing = Math.atan2(from.pos.x - this.pos.x, from.pos.z - this.pos.z);
      if (from.team !== undefined) from.kills++;
    }
    // ragdoll: a body is heavy. A bullet shoves it a step or two and the legs give way under it;
    // only a blast throws it. The kick is momentum over mass, so heavy rounds push a little harder.
    const h = this.lastHit;
    const kick = new THREE.Vector3();
    this.heavy = h?.kind === 'blast';
    if (h && h.dir && this.t - h.t < 0.05) {
      // bullets: small for rifles, bigger for heavy rounds; head and leg hits shove less than torso
      const zk = { head: 0.8, torso: 1, arm: 0.7, leg: 0.6 }[h.zone] ?? 1;
      const k = h.kind === 'blast' ? THREE.MathUtils.clamp(3 + h.dmg / 40, 3, 9) : THREE.MathUtils.clamp(0.5 + h.dmg / 60, 0.6, 3.2) * zk;
      kick.copy(h.dir).setY(0).normalize().multiplyScalar(k);
      kick.y = h.kind === 'blast' ? 2.5 + Math.random() * 1.5 + h.dmg / 80 : (h.zone === 'leg' ? 0 : 0.05 + Math.random() * 0.2);
    } else {
      // burned or bled out: the knees go and the body slumps where it stood
      const a = this.facing + (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5);
      kick.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
    }
    // the body keeps whatever speed the soldier had (run, sprint, fall); the ragdoll adds the hit on top
    this.rag = new Ragdoll(this, kick);
    if (window.__DEATHLOG__) window.__DEATHLOG__.push({ v0: this.vel.clone(), p0: this.pos.clone(), kind: h?.kind || 'none', rag: this.rag });
    this.vel.set(0, 0, 0);
    this.lastThud = 0;
    if (world) world.onDeath(this, from);
  }

  impulse(v) {
    if (this.rag && !this.alive) { this.rag.kick(v.clone().multiplyScalar(1.3)); return; }
    this.vel.add(v);
    this.knockT = 0.6;
    if (v.y > 0.5) this.grounded = false;
  }

  // ---- per-frame ----
  update(dt, world) {
    this.t += dt;
    this.wref = world;
    if (!this.alive) return this.updateDead(dt, world);
    this.rag = null;
    const c = this.ctrl;
    this.cool -= dt * this.mod.rate;
    if (this.skillT > 0) { this.skillT -= dt; if (this.skillT <= 0) this.mod = NEUTRAL; if (this.mod.noBurn) this.burn = 0; }
    this.skillCd = Math.max(0, this.skillCd - dt);
    this.skillFlash = Math.max(0, this.skillFlash - dt);
    if (this.mod.quick && this.reloadT > 0.3) this.reloadT = 0.3;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.suppression = Math.max(0, this.suppression - dt * 0.35);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (this.t - (this.lastShotT || -9) > 0.14) this.recoilBuild = Math.max(0, this.recoilBuild - dt * (this.weapon.def.rc?.rec ?? 1));
    this.adsT = this.ads > 0.5 ? this.adsT + dt : Math.max(0, this.adsT - dt * 2);
    // no regeneration: wounds bleed until bandaged, minor ones clot slowly
    this.stagger = Math.max(0, this.stagger - dt); this.shock = Math.max(0, this.shock - dt); this.cry -= dt;
    if (this.jamT > 0) this.jamT -= dt;
    if (this.traumaT > 0 && (this.traumaT -= dt) <= 0) { this.trauma = 0; this.hitN = 0; }
    this.clutch = Math.max(0, this.clutch - dt * 0.8);
    this.dyK += ((this.dying ? 1 : 0) - this.dyK) * (1 - Math.exp(-5 * dt));
    if (this.dying) {
      this.dyingT -= dt;
      this.stagger = Math.max(this.stagger, 0.5);
      if (this.dyingT <= 0) {
        const h = this.dyHit || this.lastHit;
        this.lastHit = h ? { ...h, t: this.t } : null;
        this.dying = false; this.hp = 0;
        this.die(this.dyFrom, world);
        return;
      }
    }
    if (this.bleed > 0 && !this.dying) {
      this.hp -= this.bleed * dt;
      this.bleed = this.bleed > 0.25 ? this.bleed * Math.exp(-dt * 0.012) : Math.max(0, this.bleed - dt * 0.004);
      if (this.hp <= 0) { this.lastHit = null; this.die(null, world); return; }
      if (this.down && Math.random() < dt * 0.35 && world?.audio) world.audio.play('moan', this.center(), 1);
    }
    if (this.bandageT > 0) {
      this.bandageT -= dt;
      if (this.bandageT <= 0) { this.bandage(this.isPlayer ? 18 : 25); world?.audio?.play('reload', null, 0.4); }
    }
    if (this.burn > 0) {
      this.burn -= dt;
      if (Math.random() < dt * 25) world.fx.burn(this.center());
      this.hurt(14 * dt, this.burnBy, world, 'fire');
      if (!this.alive) return;
    }
    for (const w of this.weapons) {
      if (w.def.heat) {
        w.heat = Math.max(0, w.heat - dt * (w.locked > 0 ? 0.55 : 0.35));
        w.locked = Math.max(0, w.locked - dt);
      }
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const w = this.weapon;
        if (this.god || w.inf) w.mag = w.def.mag;
        else if (w.spare.length) {
          // swap in the fullest spare magazine; a part-used one is stowed, not thrown away
          let bi = 0;
          for (let i = 1; i < w.spare.length; i++) if (w.spare[i] > w.spare[bi]) bi = i;
          const fresh = w.spare.splice(bi, 1)[0], old = w.mag;
          const keep = old > 0 && w.def.chamber ? 1 : 0; // the round in the breech stays
          if (old - keep > 0) w.spare.push(old - keep);
          w.mag = fresh + keep;
          if (old <= 0) world?.fx?.dust?.(this.pos.clone().setY(this.pos.y + 0.05), 1, 0.15);
        }
        this.reloadT = 0;
      }
    }
    if (this.throwT > 0) {
      const before = this.throwT;
      this.throwT -= dt;
      if (before > 0.3 && this.throwT <= 0.3 && !this.thrown) { this.thrown = true; world.releaseThrow(this); }
      if (this.throwT <= 0) {
        this.throwT = 0;
        if (this.weapon.mag <= 0) this.startReload();
      }
    }

    // aim: AI turns at a human pace, the player snaps to the crosshair
    const aiming = !!c.aimAt;
    this.tendT -= dt; this.dragT -= dt; this.draggedT -= dt;
    if (!this.isPlayer && c.faceYaw !== undefined && this.dragT <= 0 && this.draggedT <= 0) c.faceYaw = undefined;
    if (aiming) {
      const sx = this.pos.x, sz = this.pos.z, sy = this.eye().y - 0.1;
      const yaw = Math.atan2(c.aimAt.x - sx, c.aimAt.z - sz);
      const pitch = Math.atan2(c.aimAt.y - sy, Math.hypot(c.aimAt.x - sx, c.aimAt.z - sz));
      const rate = c.turnRate ?? Infinity;
      const dy = wrap(yaw - this.aimYaw), dp = pitch - this.aimPitch;
      // the gun has weight: it eases off as it nears the target instead of snapping onto it
      const ease = (d) => Math.min(1, 0.22 + Math.abs(d) / 0.45);
      this.aimYaw = wrap(this.aimYaw + Math.sign(dy) * Math.min(Math.abs(dy), rate * ease(dy) * dt));
      this.aimPitch += THREE.MathUtils.clamp(dp, -rate * ease(dp) * 0.8 * dt, rate * ease(dp) * 0.8 * dt);
      this.aimPitch = THREE.MathUtils.clamp(this.aimPitch, -1.2, 1.2);
      // time on target: the longer the sights stay on, the tighter the shots
      const off = Math.hypot(dy * Math.cos(this.aimPitch), dp);
      if (off < 0.05) this.onT = (this.onT || 0) + dt; else this.onT = off > 0.3 ? 0 : Math.max(0, (this.onT || 0) - dt * 2);
    } else {
      this.onT = 0;
      this.aimYaw = this.facing + this.twist;
      this.aimPitch *= 1 - Math.min(1, dt * 6);
    }

    const def = this.weapon.def;
    // stamina: sprinting drains it; once spent you jog until it's a third back
    if (this.stamina === undefined) { this.stamina = 1; this.winded = false; }
    let sprint = c.sprint && !c.fire && !this.busy && Math.hypot(c.wx, c.wz) > 0.3 && !this.winded && this.leg < 0.5 && !this.down && this.bandageT <= 0;
    if (sprint) { if (!this.mod.noTire) this.stamina -= dt / 7; this.restT = 0.9; if (this.stamina <= 0) { this.stamina = 0; this.winded = true; sprint = false; } }
    else { this.restT = Math.max(0, (this.restT || 0) - dt); if (this.restT <= 0) this.stamina = Math.min(1, this.stamina + dt / 5); }
    if (this.winded && this.stamina > 0.35) this.winded = false;
    const cantFight = (this.dying && !this.dyFight) || this.down || this.stagger > 0.35 || this.bandageT > 0 || this.jamT > 0 || (this.shock > 0 && !this.isPlayer);
    const prone = (c.prone || this.down || (this.shock > 0 && !this.isPlayer)) && this.grounded ? 1 : 0;
    // getting up goes prone -> crouch -> standing, never straight from the dirt to a sprint
    const rising = !prone && (this.proneK || 0) > 0.3;
    if (prone || rising) sprint = false;
    this.proneK = (this.proneK || 0) + (prone - (this.proneK || 0)) * (1 - Math.exp(-5 * dt));
    const lean = !sprint && this.proneK < 0.3 ? THREE.MathUtils.clamp(c.lean || 0, -1, 1) : 0;
    this.leanK = (this.leanK || 0) + (lean - (this.leanK || 0)) * (1 - Math.exp(-10 * dt));
    const kneel = (c.kneel || rising || this.dying || this.bandageT > 0 || this.tendT > 0) && !sprint && !prone ? 1 : 0;
    this.kneelK += (kneel - this.kneelK) * (1 - Math.exp(-9 * dt));
    const speed = WALK * this.speedK * this.mod.speed * (c.speed ?? 1) * (def.move || 1) * (sprint ? SPRINT : 1) * (1 - 0.6 * this.kneelK) * (1 - 0.72 * this.proneK) * (1 - 0.5 * Math.abs(this.leanK)) * (1 - 0.25 * this.suppression) * (1 - 0.28 * this.ads) * (this.reloadT > 0 ? 0.82 : 1) * (1 - 0.12 * this.recoilBuild) * (1 - 0.55 * this.leg) * (this.down ? 0.28 : 1) * (this.stagger > 0 ? 0.45 : 1) * (this.dying ? 0.55 : 1) * (this.shock > 0 && !this.isPlayer ? 0.2 : 1) * (this.bandageT > 0 ? 0.2 : 1);
    this.sprinting = sprint;
    this.move(dt, c.wx, c.wz, c.jump && this.proneK < 0.3 && this.leg < 0.5 && !this.down, speed, world, aiming || c.faceYaw !== undefined);
    c.jump = false;

    const readyGoal = sprint ? 0.15 : aiming || c.fire ? 1 : 0.55;
    this.ready += (readyGoal - this.ready) * (1 - Math.exp(-10 * dt));
    this.probeWall(dt, world);
    if (c.fire && !sprint && this.ready > 0.7 && !cantFight) this.fire(world);
    else if (!c.fire) this.wasFiring = false;
    if (c.reload) { this.startReload(); c.reload = false; }
    this.animate(dt);
  }

  // A wall or prop within the gun's length ahead: the gun comes back and up so it never pokes through.
  // The player checks every frame, everyone else a few times a second.
  probeWall(dt, world) {
    this.wallT -= dt;
    let goal = this.wallK > 0.01 ? this.wallGoal : 0;
    if (this.wallT <= 0 && world?.raycast && this.alive) {
      this.wallT = this.isPlayer ? 0 : 0.14 + (this.id % 5) * 0.02;
      const len = 0.36 + (this.weapon.def.kind === 'throw' ? 0 : (HOLD[this.weapon.id]?.muzzle.z ?? 0.45));
      const pitch = THREE.MathUtils.clamp(this.aimPitch, -0.15, 0.35);
      const cp = Math.cos(pitch);
      // along the aim, and straight out of the chest (a wall square to the body counts too)
      goal = 0;
      for (const yaw of [this.aimYaw, this.facing]) {
        WALL_D.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
        const h = world.raycast(this.eye(WALL_O), WALL_D, len, { units: false });
        if (h.prop) goal = Math.max(goal, THREE.MathUtils.smoothstep(len - h.t, 0, len - 0.35));
      }
      this.wallGoal = goal;
    }
    this.wallK += (goal - this.wallK) * (1 - Math.exp(-12 * dt));
    if (this.wallK < 0.005) this.wallK = 0;
  }

  move(dt, wx, wz, jump, speedMax, world, faceAim) {
    const wish = Math.hypot(wx, wz);
    const accel = this.grounded ? 11 : 3;
    const a = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speedMax - this.vel.x) * a;
    this.vel.z += (wz * speedMax - this.vel.z) * a;
    // hard cap on self-propelled speed (blasts and hits get a moment to throw a soldier further)
    this.knockT = Math.max(0, (this.knockT || 0) - dt);
    const hv = Math.hypot(this.vel.x, this.vel.z), cap = Math.min(MAX_SPEED, Math.max(speedMax, 0.01)) * 1.02;
    if (hv > cap && this.knockT <= 0) { this.vel.x *= cap / hv; this.vel.z *= cap / hv; }

    // facing: aiming units square up to the aim (strafing and backing off as needed);
    // otherwise they turn to where they walk
    let goal = null;
    const c = this.ctrl;
    if (c.faceYaw !== undefined) goal = c.faceYaw;
    else if (faceAim) goal = this.aimYaw;
    else if (wish > 0.25) goal = Math.atan2(wx, wz);
    if (goal !== null) {
      if (c.faceYaw !== undefined) this.facing = wrap(goal);
      else this.facing = wrap(this.facing + wrap(goal - this.facing) * (1 - Math.exp(-(faceAim ? 10 : 6) * dt)));
    }
    const tw = faceAim ? THREE.MathUtils.clamp(wrap(this.aimYaw - this.facing), -0.5, 0.5) : 0;
    this.twist += (tw - this.twist) * (1 - Math.exp(-14 * dt));

    if (jump) this.buffer = 0.15;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0) {
      this.vel.y = JUMP_V; this.grounded = false; this.coyote = 0; this.buffer = 0; this.jumps++;
    }

    if (!this.grounded) this.vel.y -= GRAVITY * dt;
    const prevY = this.pos.y;
    this.pos.addScaledVector(this.vel, dt);
    if (this.grounded) this.distance += Math.hypot(this.vel.x, this.vel.z) * dt;

    if (world) world.collideBody(this);

    const ground = world ? world.groundAt(this.pos.x, this.pos.z, this.pos.y) : 0;
    if (this.pos.y <= ground && prevY >= ground - 0.3) {
      if (!this.grounded) {
        this.landK = THREE.MathUtils.clamp(-this.vel.y / 7, 0.3, 1);
        this.landT = 0;
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y < ground) {
      this.pos.y = ground; this.vel.y = 0; this.grounded = true;
    } else if (this.grounded && this.pos.y - ground > 0.05) {
      // walking downhill: keep the feet on the slope instead of skipping into the air;
      // stepping off something tall still falls
      if (this.vel.y <= 0 && this.pos.y - ground < 0.32) this.pos.y = ground;
      else this.grounded = false;
    }
  }

  fire(world) {
    const w = this.weapon, def = w.def;
    if (this.busy || this.cool > 0) return false;
    if (!def.auto && this.wasFiring && this.semiLatch) return false;
    if (def.heat) { if (w.locked > 0) return false; }
    else if (w.mag <= 0) { this.startReload(); return false; }
    this.wasFiring = true;
    // dirty, hot weapons jam now and then: a second or two to clear it
    if (def.kind === 'hitscan' && Math.random() < 0.0028 * (1 + (this.suppression > 0.5 ? 1 : 0)) * (1 + (world?.barrelHeat?.(w) || 0) * 3)) { this.jamT = 1.4 + Math.random(); this.onJam?.(); world?.audio?.play('jam', this.center(), 0.8); return false; }
    this.shots++;
    this.cool = def.interval;
    this.lastShot = this.t;
    if (def.kind === 'throw') {
      this.throwT = 0.6;
      this.thrown = false;
      if (!this.god) w.mag--;
      world.audio.play('throw', this.pos);
      return true;
    }
    world.discharge(this, def);
    if (def.heat) {
      if (!this.mod.noHeat) w.heat += def.heat;
      if (w.heat >= 1) { w.heat = 1; w.locked = 1.6; world.fx.steam(this.muzzle(), new THREE.Vector3(0, 0.8, 0), 4, 0.35); }
    } else if (!this.god) w.mag--;
    this.recoil = 1;
    {
      // recoil: each shot kicks the view up and sideways along the weapon's pattern; it builds
      // while you hold the trigger and settles when you let go
      const rc = def.rc, pat = def.pattern || [0];
      if (this.recoilBuild < 0.05 || this.t - this.lastShotT > 0.5) this.shotIdx = 0;
      const k = 1 + this.recoilBuild * 1.1;
      const steady = (this.isPlayer ? 1 - 0.4 * this.ads : 1) * (1 - 0.3 * this.kneelK) * (1 - 0.45 * (this.proneK || 0));
      this.kickP += rc.up * k * steady;
      this.kickY += (pat[this.shotIdx % pat.length] * rc.side * (0.5 + this.recoilBuild) + (Math.random() - 0.5) * rc.side * 0.5) * steady;
      this.shotIdx++;
      this.recoilBuild = Math.min(1, this.recoilBuild + rc.build);
      this.lastShotT = this.t;
    }
    if (w.mag <= 0 && !def.heat && def.kind !== 'throw') this.startReload();
    return true;
  }

  updateDead(dt, world) {
    this.deadT += dt;
    if (this.burn > 0) { this.burn -= dt; if (Math.random() < dt * 15) world.fx.burn(this.center()); }
    if (this.rag) {
      this.rag.step(dt, world);
      const b = this.rag.body.pos;
      this.pos.x = b.x; this.pos.z = b.z;
      this.pos.y = world ? world.groundAt(b.x, b.z, b.y) : 0;
      const th = this.rag.takeThump();
      if (th > 1.1 && this.t - this.lastThud > 0.25 && world?.audio) {
        this.lastThud = this.t;
        world.audio.play('thud', b, Math.min(1, 0.4 + th / 5)); // a body landing is a dull weight, even from a slump
        if (th > 2.4) world.fx?.dust(b.clone().setY(this.pos.y + 0.05), 2, 0.5);
      }
      this.animate(dt);
      return;
    }
    if (!this.grounded || this.vel.lengthSq() > 0.01) {
      this.vel.y -= GRAVITY * dt;
      const drag = Math.exp(-(this.grounded ? 6 : 0.3) * dt);
      this.vel.x *= drag; this.vel.z *= drag;
      this.pos.addScaledVector(this.vel, dt);
      if (world) world.collideBody(this);
      const g = world ? world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.2) : 0;
      if (this.pos.y <= g) { this.pos.y = g; this.vel.y = 0; this.grounded = true; } else this.grounded = false;
    }
    this.animate(dt);
  }

  // ground height and slope under each boot (from where the last pose put it), for the feet to rest on
  groundFeet(s) {
    const wr = this.wref, fx = this.poseOut.fx;
    const pp = this.gpos || (this.gpos = { x: this.pos.x, z: this.pos.z, f: this.facing }), px = pp.x, pz = pp.z, pf = pp.f; // where the boots' last pose was placed from
    pp.x = this.pos.x; pp.z = this.pos.z; pp.f = this.facing;
    if (!wr || this.animLod > 0 || !this.grounded || !this.alive) { s.gnd = null; s.slope = null; return; }
    const g = this.gndBuf || (this.gndBuf = [0, 0]), sl = this.slopeBuf || (this.slopeBuf = [[0, 0], [0, 0]]);
    const c = Math.cos(this.facing), sn = Math.sin(this.facing), pc = Math.cos(pf), ps = Math.sin(pf);
    for (let i = 0; i < 2; i++) {
      const x = fx[i * 3], z = fx[i * 3 + 1];
      let wx = px + x * pc + z * ps, wz = pz - x * ps + z * pc;
      // a boot in the swing is a frame ahead of where it was last posed: look where it is heading
      const lw = this.lastFoot || (this.lastFoot = [[wx, wz], [wx, wz]]), lf = lw[i];
      const nx = wx + THREE.MathUtils.clamp(wx - lf[0], -0.1, 0.1), nz = wz + THREE.MathUtils.clamp(wz - lf[1], -0.1, 0.1);
      lf[0] = wx; lf[1] = wz; wx = nx; wz = nz;
      // the ground's gradient in the soldier's own frame (x across, z ahead), from forward differences about the boot
      const dd = 0.12, ax = c * dd, az = -sn * dd, bx = sn * dd, bz = c * dd;
      const h = wr.groundAt(wx, wz, this.pos.y + 0.2);
      g[i] = THREE.MathUtils.clamp(h - this.pos.y, -0.3, 0.3);
      sl[i][0] = THREE.MathUtils.clamp((wr.groundAt(wx + ax, wz + az, this.pos.y + 0.2) - h) / dd, -0.7, 0.7);
      sl[i][1] = THREE.MathUtils.clamp((wr.groundAt(wx + bx, wz + bz, this.pos.y + 0.2) - h) / dd, -0.7, 0.7);
    }
    s.gnd = g; s.slope = sl;
  }

  // spring-damped follow: hit rocking and the gun's lag are both second-order, so they overshoot and settle
  springs(dt) {
    const h = this.hs, n = Math.min(dt, 0.05);
    h.vx += (-150 * h.x - 15 * h.vx) * n; h.vz += (-150 * h.z - 15 * h.vz) * n;
    h.x = THREE.MathUtils.clamp(h.x + h.vx * n, -0.5, 0.5); h.z = THREE.MathUtils.clamp(h.z + h.vz * n, -0.5, 0.5);
    const turn = THREE.MathUtils.clamp(wrap(this.aimYaw - this.lastAim) / Math.max(dt, 1e-3), -8, 8);
    const pr = THREE.MathUtils.clamp((this.aimPitch - this.lastAimP) / Math.max(dt, 1e-3), -6, 6);
    this.lastAim = this.aimYaw; this.lastAimP = this.aimPitch;
    const tgt = [-turn * 0.022, -pr * 0.03, -turn * 0.004, -Math.abs(turn) * 0.0015 - this.landK * (this.landT < 0.25 ? 0.015 : 0)];
    for (let i = 0; i < 4; i++) {
      this.glv[i] += (-120 * (this.gl[i] - tgt[i]) - 13 * this.glv[i]) * n;
      this.gl[i] += this.glv[i] * n;
    }
  }

  animate(dt) {
    this.springs(dt);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    // gait speed: the ground speed, eased so the stride doesn't jitter with every velocity wobble
    this.gspeed = (this.gspeed ?? speed) + (speed - (this.gspeed ?? speed)) * (1 - Math.exp(-14 * dt));
    const gs = this.gspeed;
    this.walk += ((this.grounded && this.alive ? THREE.MathUtils.smoothstep(gs, 0.08, 0.5) : 0) - this.walk) * (1 - Math.exp(-10 * dt));
    if (speed > 0.05) {
      // move direction in the body's frame, for feet and lean: an angle, so a change of direction swings round
      // (a straight blend of two directions would shrink to nothing halfway) and a start from rest takes the new one at once
      const c = Math.cos(this.facing), s = Math.sin(this.facing);
      const ang = Math.atan2(this.vel.x * c - this.vel.z * s, this.vel.x * s + this.vel.z * c);
      if (this.mAng === undefined || (this.mStill || 0) > 0.12) this.mAng = ang;
      else this.mAng += wrap(ang - this.mAng) * (1 - Math.exp(-12 * dt));
      this.mStill = 0;
      this.mx = Math.sin(this.mAng); this.mz = Math.cos(this.mAng);
    } else this.mStill = (this.mStill || 0) + dt;
    // the first step from a standstill leads with one foot: start the cycle where that foot is mid-stance (planted
    // at home) and the other is about to swing, alternating the lead foot, so the feet don't skate into the stride
    if (gs < 0.05) this.started = false;
    else if (this.wasStanding && !this.started && gs > 0.12 && this.grounded) { this.cycle = this.leadLeft ? 0.16 + 0.5 : 0.16; this.leadLeft = !this.leadLeft; this.started = true; }
    if (this.grounded) {
      // the stride advances by distance covered, so a planted foot moves back exactly as fast as the soldier moves on
      const L = strideLength(gs) * dirScale(this.mx, this.mz);
      this.cycle = (this.cycle + speed * dt / L) % 1;
      this.stride = L;
    }
    this.freeK = (this.freeK || 0) + ((this.sprinting ? 1 : 0) - (this.freeK || 0)) * (1 - Math.exp(-9 * dt));
    this.air += ((this.grounded ? 0 : 1) - this.air) * (1 - Math.exp(-(this.grounded ? 22 : 14) * dt));
    this.landT += dt;
    const lt = this.landT;
    const land = this.landK * (lt < 0.05 ? lt / 0.05 : 1 - THREE.MathUtils.smoothstep(lt, 0.05, 0.34));
    const s = this.poseState;
    s.t = this.t; s.walk = this.walk; s.cycle = this.cycle; s.stride = this.stride ?? 0.3; s.speed = this.gspeed || 0; s.free = this.freeK; s.down = this.down;
    s.mx = this.mx; s.mz = this.mz; s.air = this.air; s.rise = THREE.MathUtils.clamp(this.vel.y / JUMP_V, -1, 1);
    s.land = land; s.kneel = Math.max(this.kneelK, this.alive ? kneelBump(this.proneK || 0) : 0); s.aimPitch = THREE.MathUtils.clamp(this.aimPitch, -0.9, 0.9);
    s.twist = this.twist; s.ready = Math.min(this.ready, 1 - this.wallK * 0.85); s.recoil = this.recoil;
    s.reload = this.reloadT > 0 ? 1 - this.reloadT / this.reloadDur : -1;
    s.rack = s.reload > 0.72 && this.reloadEmpty && this.weapon.def.rack ? Math.sin(((s.reload - 0.72) / 0.28) * Math.PI) : 0;
    s.throw = this.throwT > 0 ? 1 - this.throwT / 0.6 : -1;
    s.limp = this.leg * this.limpSide; s.flinch = this.flinch; s.dying = Math.max(this.dyK, this.clutch * 0.7); s.ads = this.ads; s.fp = this.fp || 0; s.sprint = this.sprinting;
    s.lean = this.alive ? this.leanK || 0 : 0; s.prone = this.alive ? this.proneK || 0 : 0;
    s.dead = this.alive ? -1 : Math.min(1, this.deadT / 0.7);
    s.weapon = this.weapon.id;
    const a = 1 - Math.exp(-8 * dt), al = this.alive;
    this.tendK += (((al && (this.tendT > 0 || this.bandageT > 0) && this.dragT <= 0) ? 1 : 0) - this.tendK) * a;
    this.dragK += (((al && this.dragT > 0) ? 1 : 0) - this.dragK) * a;
    this.drgK += (((al && this.draggedT > 0) ? 1 : 0) - this.drgK) * a;
    s.tend = this.tendK; s.drag = this.dragK; s.drg = this.drgK;
    if (this.tendK > 0.01) {
      const tt = this.tendT > 0 ? this.tendTarget : null, ca = Math.cos(this.facing), sa = Math.sin(this.facing);
      let lx = -this.limpSide * 0.12, ly = 0.3, lz = 0.16;
      if (tt) {
        const dx = tt.pos.x - this.pos.x, dz = tt.pos.z - this.pos.z;
        lx = dx * ca - dz * sa; lz = dx * sa + dz * ca; ly = 0.12;
        const l = Math.hypot(lx, lz), mx = 0.7; if (l > mx) { lx *= mx / l; lz *= mx / l; }
      }
      (s.tendAt || (s.tendAt = [0, 0, 0]))[0] = lx; s.tendAt[1] = ly; s.tendAt[2] = lz;
    }
    s.wx = this.pos.x; s.wz = this.pos.z; s.wy = this.pos.y; s.wf = this.facing; s.dt = dt; s.wref = this.grounded ? this.wref : null;
    s.hx = this.hs.x; s.hz = this.hs.z; s.gl = this.gl; s.stag = this.alive ? this.stagger : 0;
    if (s.stag > 0) s.ready = Math.min(s.ready, 1 - 0.45 * Math.min(1, s.stag));
    if (this.rag && !this.alive) {
      // the ragdoll writes world-space parts; sink into the ground before removal
      this.world.identity();
      this.rag.write(this.poseOut, this.deadT > 10 ? (this.deadT - 10) * 0.2 : 0);
      return;
    }
    // feet: planted while standing (turning on the spot takes steps), on the terrain they stand on
    const standing = this.grounded && this.alive && this.walk < 0.35 && gs < 0.3 && this.kneelK < 0.3 && (this.proneK || 0) < 0.3 && this.air < 0.15;
    s.pf = this.planter.update(dt, this.pos, this.facing, standing, this.poseOut.fx); this.wasStanding = standing; this.poseOut.pfk = s.pf.k.toFixed(2);
    this.groundFeet(s);
    s.lod = this.animLod;
    // far soldiers pose every other frame (the world matrix below still moves them every frame)
    if (this.animLod >= 2 && this.alive && ((this.animTick = (this.animTick || 0) + 1) & 1)) {
      this.world.makeRotationY(this.facing).setPosition(this.pos.x, this.pos.y, this.pos.z);
      return;
    }
    pose(s, this.poseOut);
    // loose kit swings on the soldier's acceleration, the stride's bounce and turning
    const sw = this.sway || (this.sway = new Sway());
    const run = THREE.MathUtils.smoothstep(this.gspeed || 0, 1.2, 3.2) * this.walk * (1 - this.air);
    const turn = THREE.MathUtils.clamp(((this.facing - (this.lastFacing ?? this.facing) + Math.PI * 3) % (Math.PI * 2) - Math.PI) / Math.max(dt, 1e-3), -8, 8);
    this.lastFacing = this.facing;
    sw.update(dt, this.vel.x, this.vel.z, this.facing, this.cycle, run, turn, this.poseOut.sway);
    this.poseOut.showWeapon = this.alive && !(this.weapon.def.kind === 'throw' && this.thrown && this.throwT > 0);
    this.world.makeRotationY(this.facing).setPosition(this.pos.x, this.pos.y - (this.deadT > 10 ? (this.deadT - 10) * 0.2 : 0), this.pos.z);
  }
}
