// Runs in the page: a seeded 50v50 fight, measuring how well squads keep moving and, if the AI
// reports them, how often morale, fireteams, medic drags and shelling reactions kick in.
export const aiSim = ({ seconds = 180, size = 50 } = {}) => {
  const g = window.__game;
  let seed = 20261124;
  const real = Math.random;
  Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  g.start({ mode: 'battle', teams: 2, size, tickets: 60, view: '3p', playerTeam: 0 });
  g.freeze(true);
  const b = g.battle;
  b.god = true;
  const st = new Map();
  let dist = 0, speedN = 0, win = 0, winLinger = 0, stalled = 0, samples = 0;
  const states = {};
  for (let i = 0; i < 30 * seconds; i++) {
    b.update(1 / 30);
    b.events.length = 0;
    if (i % 15) continue;
    for (const u of b.units) {
      if (!u.alive || u === b.player || u.down) continue;
      let s = st.get(u);
      if (!s) { s = { last: u.pos.clone(), win: u.pos.clone(), n: 0 }; st.set(u, s); }
      const moved = Math.hypot(u.pos.x - s.last.x, u.pos.z - s.last.z);
      s.last.copy(u.pos);
      dist += moved; speedN += 0.5; samples++;
      if (u.brain.stallT >= 1) stalled += 0.5;
      const k = u.brain.state || 'steady';
      states[k] = (states[k] || 0) + 1;
      if (++s.n % 20 === 0) { // every 10 s
        const br = u.brain, sq = u.squad;
        const hold = sq.holding || br.mission || u.busy || (br.cover && Math.hypot(br.cover.x - u.pos.x, br.cover.z - u.pos.z) < 1.2) || br.state === 'surrender' || br.state === 'cower';
        win++;
        if (Math.hypot(u.pos.x - s.win.x, u.pos.z - s.win.z) < 3 && !hold) winLinger++;
        s.win.copy(u.pos);
      }
    }
  }
  Math.random = real;
  g.freeze(false);
  const per = states; const tot = Object.values(per).reduce((a, c) => a + c, 0) || 1;
  for (const k in per) per[k] = +(per[k] / tot).toFixed(3);
  return { avgSpeed: +(dist / Math.max(1, speedN)).toFixed(2), lingerPct: +(100 * winLinger / Math.max(1, win)).toFixed(1), stalledPerSoldier: +(stalled / Math.max(1, st.size)).toFixed(2), soldiers: st.size, kills: b.teams.map((t) => t.kills), ai: b.aiStats || null, stateShare: per, alive: b.counts() };
};
