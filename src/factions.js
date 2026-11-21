// Three armies. Every pea uses the same model; each army gets its own pea variety, kit and
// vehicle paint. Team 0 is the player's.
export const TEAMS = [
  {
    id: 0,
    name: 'Garden Guard',
    ui: '#5f7a35',
    pea: {
      peaTop: '#7f9a4c', peaMid: '#677f3a', peaLow: '#44562a',
      helmet: '#4a4f3a', helmetDark: '#33372a', badge: '#5c5546',
      boot: '#2b2520', sole: '#151311', glove: '#3d3a2f',
      eye: '#121410', brow: '#3e4f25', mouth: '#2a3319', strap: '#3d3e2f',
    },
    hull: '#4f5538',
    hullDark: '#383c28',
  },
  {
    id: 1,
    name: 'Split Pea Legion',
    ui: '#a8873a',
    pea: {
      peaTop: '#c4a54e', peaMid: '#a8873a', peaLow: '#6c5724',
      helmet: '#4b5560', helmetDark: '#343b43', badge: '#857245',
      boot: '#23211f', sole: '#121110', glove: '#2f3338',
      eye: '#14130f', brow: '#6b5420', mouth: '#4a3a16', strap: '#383d43',
    },
    hull: '#59626b',
    hullDark: '#3b4148',
  },
  {
    id: 2,
    name: 'Iron Pod',
    ui: '#8a4a36',
    pea: {
      peaTop: '#d2c7a3', peaMid: '#b6aa83', peaLow: '#7d7457',
      helmet: '#5e3a2e', helmetDark: '#40271f', badge: '#86683f',
      boot: '#2a1f1a', sole: '#140f0c', glove: '#3b2a22',
      eye: '#151310', brow: '#6e6047', mouth: '#4b4130', strap: '#4a3328',
    },
    hull: '#6a4434',
    hullDark: '#472d23',
  },
];

export const hostile = (a, b) => a !== b && a >= 0 && b >= 0;
