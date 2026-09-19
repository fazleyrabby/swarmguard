/**
 * Tower balance data (spec §20–23, §31, §52).
 * Data-driven: game systems must read from here, never hard-code.
 */

export type TowerId = 'crossbow' | 'cannon' | 'bomb';

export interface TowerLevelStats {
  damage: number;
  range: number;
  /** Attacks per second. */
  attackSpeed: number;
  /** Gold to upgrade FROM the previous level TO this level. Level 1 = 0 (build cost covers it). */
  upgradeCost: number;
  /** Splash radius in world px (cannon / bomb only). */
  splashRadius?: number;
  /** Slow applied on hit, 0–1 (bomb only). */
  slowFactor?: number;
  /** Slow duration in seconds (bomb only). */
  slowDuration?: number;
}

export interface TowerDefinition {
  id: TowerId;
  name: string;
  icon: string;
  /** Gold to build a level-1 tower. */
  cost: number;
  projectile: 'arrow' | 'cannonball' | 'bomb';
  description: string;
  levels: TowerLevelStats[];
}

function attackInterval(attackSpeed: number): number {
  return Math.round(1000 / attackSpeed);
}

export const TOWERS: Record<TowerId, TowerDefinition> = {
  crossbow: {
    id: 'crossbow',
    name: 'Crossbow',
    icon: '🏹',
    cost: 50,
    projectile: 'arrow',
    description: 'Fast single-target tower. Best vs grunts/runners, weak vs tanks.',
    levels: [
      { damage: 28, range: 190, attackSpeed: 1.0, upgradeCost: 0 },
      { damage: 40, range: 190, attackSpeed: 1.1, upgradeCost: 100 },
      { damage: 65, range: 210, attackSpeed: 1.25, upgradeCost: 175 },
      { damage: 100, range: 230, attackSpeed: 1.4, upgradeCost: 250 },
      { damage: 150, range: 250, attackSpeed: 1.6, upgradeCost: 400 },
    ],
  },
  cannon: {
    id: 'cannon',
    name: 'Cannon',
    icon: '💥',
    cost: 100,
    projectile: 'cannonball',
    description: 'Slow, heavy splash damage. Best vs packed groups.',
    levels: [
      { damage: 100, range: 160, attackSpeed: 0.4, splashRadius: 60, upgradeCost: 0 },
      { damage: 150, range: 170, attackSpeed: 0.42, splashRadius: 70, upgradeCost: 150 },
      { damage: 220, range: 180, attackSpeed: 0.45, splashRadius: 80, upgradeCost: 250 },
      { damage: 320, range: 195, attackSpeed: 0.48, splashRadius: 90, upgradeCost: 375 },
      { damage: 450, range: 210, attackSpeed: 0.5, splashRadius: 100, upgradeCost: 550 },
    ],
  },
  bomb: {
    id: 'bomb',
    name: 'Bomb Tower',
    icon: '💣',
    cost: 125,
    projectile: 'bomb',
    description: 'Lobs bombs with big AoE + 20% slow for 1.5s. Swarm control.',
    levels: [
      {
        damage: 70,
        range: 140,
        attackSpeed: 0.5,
        splashRadius: 100,
        slowFactor: 0.2,
        slowDuration: 1.5,
        upgradeCost: 0,
      },
      {
        damage: 105,
        range: 150,
        attackSpeed: 0.52,
        splashRadius: 110,
        slowFactor: 0.22,
        slowDuration: 1.5,
        upgradeCost: 175,
      },
      {
        damage: 150,
        range: 160,
        attackSpeed: 0.55,
        splashRadius: 120,
        slowFactor: 0.25,
        slowDuration: 1.6,
        upgradeCost: 275,
      },
      {
        damage: 220,
        range: 175,
        attackSpeed: 0.58,
        splashRadius: 130,
        slowFactor: 0.28,
        slowDuration: 1.7,
        upgradeCost: 400,
      },
      {
        damage: 300,
        range: 190,
        attackSpeed: 0.6,
        splashRadius: 145,
        slowFactor: 0.3,
        slowDuration: 1.8,
        upgradeCost: 600,
      },
    ],
  },
};

export const TOWER_IDS: TowerId[] = ['crossbow', 'cannon', 'bomb'];

/** Cannon AoE falloff (spec §22): center 100%, 50% radius 70%, edge 40%. */
export const CANNON_FALLOFF = [
  { radiusFraction: 0, damageFraction: 1 },
  { radiusFraction: 0.5, damageFraction: 0.7 },
  { radiusFraction: 1, damageFraction: 0.4 },
] as const;

export function getTowerLevel(towerId: TowerId, level: number): TowerLevelStats {
  const def = TOWERS[towerId];
  const clamped = Math.min(Math.max(level, 1), def.levels.length);
  return def.levels[clamped - 1];
}

export function getAttackIntervalMs(towerId: TowerId, level: number): number {
  return attackInterval(getTowerLevel(towerId, level).attackSpeed);
}

export const MAX_TOWER_LEVEL = 5;
