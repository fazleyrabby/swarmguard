/**
 * Challenge modifiers (spec §93): optional run-altering rules chosen from the
 * menu. Kept data-driven and additive so the sim reads them generically.
 */

export interface ChallengeDefinition {
  id: string;
  name: string;
  description: string;
  /** Absolute starting-gold override (otherwise the map's value). */
  startingGold?: number;
  /** Absolute Core HP override (otherwise the map's value). */
  baseHp?: number;
  /** Multiplies enemies per wave. */
  enemyCountMult?: number;
  /** Multiplies enemy max HP. */
  enemyHpMult?: number;
  /** Multiplies enemy speed. */
  enemySpeedMult?: number;
  /** Multiplies all tower damage. */
  towerDamageMult?: number;
}

export const CHALLENGES: ChallengeDefinition[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'The intended experience. No modifiers.',
  },
  {
    id: 'sudden-death',
    name: 'Sudden Death',
    description: 'Your Core has a single hit point. One leak ends the run.',
    baseHp: 1,
  },
  {
    id: 'poverty',
    name: 'Poverty',
    description: 'Start with only 50 gold. Every tower counts.',
    startingGold: 50,
  },
  {
    id: 'onslaught',
    name: 'Onslaught',
    description: '50% more enemies per wave. Bring AoE.',
    enemyCountMult: 1.5,
  },
  {
    id: 'glass-cannon',
    name: 'Glass Cannon',
    description: 'Towers deal double damage, but enemies move 25% faster.',
    towerDamageMult: 2,
    enemySpeedMult: 1.25,
  },
  {
    id: 'endless',
    name: 'Endless',
    description: 'No victory at wave 10 — survive as long as you can.',
  },
];

export const DEFAULT_CHALLENGE = CHALLENGES[0];

export function getChallenge(id: string): ChallengeDefinition {
  return CHALLENGES.find((c) => c.id === id) ?? DEFAULT_CHALLENGE;
}
