// Runs in the page: a seeded 150 s fight, measuring per-soldier idle time, clumping and overwatch use.
export const idleSim = () => {
    const g = window.__game;
    let seed = 20261122;
    const real = Math.random;
    Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    g.start({ mode: 'battle', teams: 2, size: 40, tickets: 40, view: '3p', playerTeam: 0 });
    g.freeze(true);
    const b = g.battle;
    b.god = true;
    // every AI shot: is the line from the real muzzle to the aim point clear of props and ground?
    const shots = { n: 0, blocked: 0, intoGround: 0 };
    const discharge = b.discharge.bind(b);
    b.discharge = (sh, def) => {
      const a = sh.ctrl.aimAt;
      if (!sh.isPlayer && a && !def.gravity && def.kind !== 'throw') {
        shots.n++;
        const m = sh.muzzle();
        if (!b.los(m, a)) shots.blocked++;
        if (a.y < g.height(a.x, a.z) - 0.02) shots.intoGround++;
      }
      return discharge(sh, def);
    };
    const st = new Map();
    const worst = { free: 0, fight: 0 }, total = { free: 0, fight: 0 };
    let samples = 0, clumps = 0, fightSamples = 0, flanks = 0, overwatch = 0, defilade = 0;
    let who = null;
    for (let i = 0; i < 30 * 150; i++) {
      b.update(1 / 30);
      for (const u of b.units) {
        if (!u.alive || u === b.player) continue;
        let s = st.get(u);
        if (!s) st.set(u, (s = { t: 0, last: u.pos.clone(), n: Math.floor(real() * 15) }));
        if (++s.n % 15) continue; // every half second
        const moved = s.last.distanceTo(u.pos);
        s.last.copy(u.pos);
        const br = u.brain, sq = u.squad;
        const inCover = br.cover && Math.hypot(br.cover.x - u.pos.x, br.cover.z - u.pos.z) < 1.2;
        const hold = sq.holding && sq.objective && Math.hypot(sq.objective.pos.x - u.pos.x, sq.objective.pos.z - u.pos.z) < sq.objective.r * 2;
        const kind = br.seen || sq.inContact() ? 'fight' : 'free';
        samples++;
        if (kind === 'fight') {
          fightSamples++;
          if (br.overwatch) overwatch++;
          if (br.cover?.terrain) defilade++;
          let n = 0;
          for (const m of b.nearUnits(u.pos.x, u.pos.z, 1.6)) if (m !== u && m.alive && m.team === u.team) n++;
          if (n >= 2 && !inCover) clumps++;
        }
        const idle = moved < 0.15 && !inCover && !br.mission && !hold && !u.busy && !(kind === 'fight' && u.kneelK > 0.5 && br.seen);
        if (idle) {
          s.t += 0.5; total[kind] += 0.5;
          if (s.t > worst[kind]) { worst[kind] = s.t; who = { prone: +u.proneK.toFixed(2), kneel: +u.kneelK.toFixed(2), vel: +Math.hypot(u.vel.x, u.vel.z).toFixed(2), gd: br.goal && +Math.hypot(br.goal.x - u.pos.x, br.goal.z - u.pos.z).toFixed(1), stall: br.stallT, lead: sq.leader === u, ret: sq.retreating, anchorD: +Math.hypot(sq.anchor.x - u.pos.x, sq.anchor.z - u.pos.z).toFixed(1), obj: sq.objective?.name, own: sq.objective?.owner, holding: sq.holding, hasCover: !!br.cover, med: !!br.mission, kind: u.kind, at: [Math.round(u.pos.x), Math.round(u.pos.z)], t: Math.round(b.time), seen: br.seen }; }
        } else s.t = 0;
      }
      for (const q of b.squads) if (q.waypoint && q.pinT === 0) flanks++;
    }
    Math.random = real;
    g.freeze(false);
    return { shots, worstFree: worst.free, worstFight: worst.fight, idleShare: +((total.free + total.fight) / 0.5 / samples).toFixed(3), clumpShare: +(clumps / Math.max(1, fightSamples)).toFixed(3), overwatchShare: +(overwatch / Math.max(1, fightSamples)).toFixed(3), defilade, who, alive: b.counts() };
  };
