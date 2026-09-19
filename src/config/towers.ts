/**
 * Tower balance data (spec §20–23, §31, §52).
 * Data-driven: game systems must read from here, never hard-code.
 */

export type TowerId = 'crossbow' | 'cannon' | 'bomb' | 'frost' | 'sniper';

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

/** A specialization chosen at `TowerDefinition.branchLevel`. */
export interface TowerBranch {
  id: string;
  name: string;
  /** Short tag shown on the tower badge (2 chars). */
  abbr: string;
  description: string;
  /** Badge accent color. */
  color: number;
  /** Stats for levels [branchLevel .. MAX]; `upgradeCost` is the cost to reach that level. */
  levels: TowerLevelStats[];
}

export interface TowerDefinition {
  id: TowerId;
  name: string;
  icon: string;
  /** Gold to build a level-1 tower. */
  cost: number;
  projectile: 'arrow' | 'cannonball' | 'bomb' | 'frostshard' | 'bullet';
  description: string;
  levels: TowerLevelStats[];
  /** Level at which the player must pick one of `branches` to continue. */
  branchLevel?: number;
  branches?: TowerBranch[];
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
    branchLevel: 3,
    branches: [
      {
        id: 'rapidfire',
        name: 'Rapid Fire',
        abbr: 'RF',
        description: 'Blistering attack speed. Shreds runners and grunts.',
        color: 0xffc93c,
        levels: [
          { damage: 55, range: 200, attackSpeed: 2.0, upgradeCost: 175 },
          { damage: 85, range: 210, attackSpeed: 2.6, upgradeCost: 260 },
          { damage: 120, range: 220, attackSpeed: 3.2, upgradeCost: 420 },
        ],
      },
      {
        id: 'arbalest',
        name: 'Arbalest',
        abbr: 'AR',
        description: 'Heavy bolts: huge single hits at long range, slow to reload.',
        color: 0xff8fab,
        levels: [
          { damage: 140, range: 270, attackSpeed: 0.7, upgradeCost: 175 },
          { damage: 250, range: 300, attackSpeed: 0.75, upgradeCost: 260 },
          { damage: 420, range: 330, attackSpeed: 0.8, upgradeCost: 420 },
        ],
      },
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
    branchLevel: 3,
    branches: [
      {
        id: 'mortar',
        name: 'Mortar',
        abbr: 'MO',
        description: 'Enormous shells and a wider blast. Deletes packed swarms.',
        color: 0xf97316,
        levels: [
          { damage: 220, range: 190, attackSpeed: 0.42, splashRadius: 110, upgradeCost: 250 },
          { damage: 340, range: 205, attackSpeed: 0.44, splashRadius: 130, upgradeCost: 375 },
          { damage: 520, range: 220, attackSpeed: 0.46, splashRadius: 150, upgradeCost: 550 },
        ],
      },
      {
        id: 'shrapnel',
        name: 'Shrapnel',
        abbr: 'SH',
        description: 'Faster, tighter bursts. More hits, less overkill.',
        color: 0xfbbf24,
        levels: [
          { damage: 150, range: 180, attackSpeed: 0.7, splashRadius: 70, upgradeCost: 250 },
          { damage: 210, range: 190, attackSpeed: 0.8, splashRadius: 80, upgradeCost: 375 },
          { damage: 300, range: 200, attackSpeed: 0.9, splashRadius: 90, upgradeCost: 550 },
        ],
      },
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
  frost: {
    id: 'frost',
    name: 'Frost Tower',
    icon: '❄️',
    cost: 90,
    projectile: 'frostshard',
    description: 'Low damage, strong AoE chill. Keeps swarms bunched and slow.',
    levels: [
      { damage: 12, range: 150, attackSpeed: 0.8, splashRadius: 70, slowFactor: 0.35, slowDuration: 2.0, upgradeCost: 0 },
      { damage: 18, range: 160, attackSpeed: 0.85, splashRadius: 80, slowFactor: 0.37, slowDuration: 2.1, upgradeCost: 90 },
      { damage: 26, range: 170, attackSpeed: 0.9, splashRadius: 90, slowFactor: 0.4, slowDuration: 2.2, upgradeCost: 160 },
      { damage: 38, range: 185, attackSpeed: 0.95, splashRadius: 100, slowFactor: 0.42, slowDuration: 2.3, upgradeCost: 260 },
      { damage: 52, range: 200, attackSpeed: 1.0, splashRadius: 115, slowFactor: 0.45, slowDuration: 2.5, upgradeCost: 380 },
    ],
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    icon: '🎯',
    cost: 150,
    projectile: 'bullet',
    description: 'Extreme range, huge single-target damage. Slow fire, best vs tanks & bosses.',
    levels: [
      { damage: 220, range: 380, attackSpeed: 0.45, upgradeCost: 0 },
      { damage: 320, range: 400, attackSpeed: 0.47, upgradeCost: 150 },
      { damage: 460, range: 430, attackSpeed: 0.5, upgradeCost: 260 },
      { damage: 650, range: 460, attackSpeed: 0.53, upgradeCost: 400 },
      { damage: 900, range: 500, attackSpeed: 0.56, upgradeCost: 600 },
    ],
  },
};

export const TOWER_IDS: TowerId[] = ['crossbow', 'cannon', 'bomb', 'frost', 'sniper'];

/** Cannon AoE falloff (spec §22): center 100%, 50% radius 70%, edge 40%. */
export const CANNON_FALLOFF = [
  { radiusFraction: 0, damageFraction: 1 },
  { radiusFraction: 0.5, damageFraction: 0.7 },
  { radiusFraction: 1, damageFraction: 0.4 },
] as const;

export const MAX_TOWER_LEVEL = 5;

/** Branch definition for a tower + branch id, if any. */
export function branchFor(towerId: TowerId, branchId?: string): TowerBranch | undefined {
  if (!branchId) return undefined;
  return TOWERS[towerId].branches?.find((b) => b.id === branchId);
}

/** True when upgrading to `nextLevel` requires choosing a branch on this tower. */
export function isBranchChoice(towerId: TowerId, nextLevel: number): boolean {
  const def = TOWERS[towerId];
  return !!def.branches && def.branchLevel !== undefined && nextLevel === def.branchLevel;
}

/**
 * Stats for a tower's level, honoring an active branch for levels at/after
 * `branchLevel`. Pure.
 */
export function getTowerLevel(
  towerId: TowerId,
  level: number,
  branchId?: string,
): TowerLevelStats {
  const def = TOWERS[towerId];
  const bl = def.branchLevel;
  if (branchId && bl !== undefined && level >= bl) {
    const branch = branchFor(towerId, branchId);
    if (branch) {
      const idx = Math.min(Math.max(level - bl, 0), branch.levels.length - 1);
      return branch.levels[idx];
    }
  }
  const clamped = Math.min(Math.max(level, 1), def.levels.length);
  return def.levels[clamped - 1];
}

export function getAttackIntervalMs(towerId: TowerId, level: number, branchId?: string): number {
  return attackInterval(getTowerLevel(towerId, level, branchId).attackSpeed);
}
