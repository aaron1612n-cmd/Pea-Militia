// Armies. Every unit uses the same model; each army gets its own shell colour. The player picks
// which army they fight for on the setup screen.
export const TEAMS = [
  { id: 0, name: 'Meridian', short: 'MER', body: '#4d6378', trim: '#2c3946', ui: '#7f9bb5' },
  { id: 1, name: 'Ashfall', short: 'ASH', body: '#8a4b3b', trim: '#4e2a22', ui: '#c97a63' },
  { id: 2, name: 'Verdant Pact', short: 'VER', body: '#6b7346', trim: '#3c4128', ui: '#a8b26c' },
];

export const hostile = (a, b) => a !== b && a >= 0 && b >= 0;
