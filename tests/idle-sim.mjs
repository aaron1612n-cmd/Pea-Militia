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
        const hold = sq.holding && sq.objective && Math.hypot(sq.objective.pos.x - u.pos.x, sq.objective.pos.z - u.pos.z) < sq.objective.r * 1.3;
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
          if (s.t > worst[kind]) { worst[kind] = s.t; who = { kind: u.kind, at: [Math.round(u.pos.x), Math.round(u.pos.z)], t: Math.round(b.time), seen: br.seen }; }
        } else s.t = 0;
      }
      for (const q of b.squads) if (q.waypoint && q.pinT === 0) flanks++;
    }
    Math.random = real;
    g.freeze(false);
    return { worstFree: worst.free, worstFight: worst.fight, idleShare: +((total.free + total.fight) / 0.5 / samples).toFixed(3), clumpShare: +(clumps / Math.max(1, fightSamples)).toFixed(3), overwatchShare: +(overwatch / Math.max(1, fightSamples)).toFixed(3), defilade, who, alive: b.counts() };
  };
