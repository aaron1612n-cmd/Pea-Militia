// Soldier classes. One table drives the AI squads and the player's pick:
// loadout, toughness, walking pace and a single timed ability (key T, or the Skill button on touch).
// Ability effects are multipliers read by Unit while `skillT` runs; medic's is an instant pulse.
export const CLASSES = {
  rifleman: { name: 'Rifleman', loadout: ['rifle', 'grenade'], hp: 100, speed: 1, skill: { name: 'Steady', blurb: 'Dead-calm aim for 5s', dur: 5, cd: 16, mod: { spread: 0.2 } },
    brief: 'Accurate long range' },
  assault: { name: 'Assault', loadout: ['smg', 'grenade'], hp: 90, speed: 1.12, skill: { name: 'Dash', blurb: 'Sprint burst, no tiring', dur: 2.2, cd: 10, mod: { speed: 1.5, noTire: true } },
    brief: 'Fast, close range' },
  gunner: { name: 'Gunner', loadout: ['mg'], hp: 120, speed: 0.9, skill: { name: 'Overdrive', blurb: 'Fire 50% faster for 5s', dur: 5, cd: 18, mod: { rate: 1.5 } },
    brief: 'Heavy, sustained fire' },
  mortar: { name: 'Mortar', loadout: ['launcher'], hp: 85, speed: 0.95, skill: { name: 'Rapid load', blurb: 'Shells 2.5x faster for 5s', dur: 5, cd: 18, mod: { rate: 2.5, quick: true } },
    brief: 'Shells over cover' },
  coil: { name: 'Coil gun', loadout: ['plasma', 'grenade'], hp: 100, speed: 1, skill: { name: 'Overcharge', blurb: 'No heat, +60% damage, 4s', dur: 4, cd: 18, mod: { dmgOut: 1.6, noHeat: true } },
    brief: 'Energy bolts, overheats' },
  medic: { name: 'Medic', loadout: ['smg'], hp: 95, speed: 1.08, skill: { name: 'Heal pulse', blurb: 'Heal friends within 7m', dur: 0, cd: 14, pulse: 7 },
    brief: 'Heals the squad' },
  // The elite exoskeleton operator: every class's weapon in one kit, powered armour that shrugs off most of a rifle round, a stride
  // well past a runner's, and a field mend. Not offered in the class picker; the sandbox drops whole squads of them from a plane.
  exo: { name: 'Exo operator', elite: true, loadout: ['rifle', 'smg', 'plasma', 'mg', 'launcher', 'grenade'], hp: 320, speed: 1.32, regen: 3, jump: 1.35, tough: 0.35,
    mod: { dmgIn: 0.5, dmgOut: 1.3, spread: 0.6, rate: 1.15 },
    skill: { name: 'Overdrive', blurb: 'Near-immune, faster, harder, 6s', dur: 6, cd: 15, mod: { dmgIn: 0.15, dmgOut: 1.6, spread: 0.3, rate: 1.5, speed: 1.3, noTire: true } },
    brief: 'Elite exoskeleton squad' },
};
export const CLASS_IDS = Object.keys(CLASSES).filter((id) => !CLASSES[id].elite);
export const baseMod = (cls) => (cls?.mod ? { ...NEUTRAL, ...cls.mod } : NEUTRAL);
export const NEUTRAL = { spread: 1, speed: 1, rate: 1, dmgIn: 1, dmgOut: 1 };

// Start a soldier's ability. Returns true if it fired.
export function useSkill(u, world) {
  const c = CLASSES[u.kind], s = c?.skill;
  if (!s || !u.alive || u.skillCd > 0 || u.skillT > 0) return false;
  u.skillCd = s.cd;
  if (s.pulse) {
    let n = 0;
    for (const o of world.units) {
      if (!o.alive || o.team !== u.team || o.pos.distanceTo(u.pos) > s.pulse) continue;
      o.hp = Math.min(o.maxHp, o.hp + 45); n++;
    }
    u.skillFlash = 0.6;
    return true;
  }
  u.skillT = s.dur;
  u.skillMax = s.dur;
  u.mod = { ...u.baseMod, ...s.mod };
  if (s.mod.noBurn) u.burn = 0;
  return true;
}
