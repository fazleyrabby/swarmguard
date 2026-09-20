/**
 * Enemy balance data (spec §13–14, §28) + boss abilities.
 */

export type EnemyType =
  | 'grunt'
  | 'runner'
  | 'tank'
  | 'spearman'
  | 'boss'
  | 'boss-shielded'
  | 'boss-regen'
  | 'boss-herald'
  | 'minion-shielded'
  | 'minion-regen'
  | 'minion-herald';

/** Special boss behavior, handled generically by the ability system. */
export type EnemyAbility = 'shield' | 'regen' | 'herald';

export interface EnemyDefinition {
  type: EnemyType;
  name: string;
  hp: number;
  /** World px per second. */
  speed: number;
  /** Damage dealt to the base on arrival. */
  damage: number;
  /** Gold awarded on kill. */
  reward: number;
  /** Display radius in world px (for placeholder art). */
  radius: number;
  color: number;
  description: string;
  ability?: EnemyAbility;
  /** Absorbing shield points (shield ability). */
  shield?: number;
  /** HP restored per second (regen ability). */
  regenPerSec?: number;
  /** Radius of the speed aura, world px (herald ability). */
  auraRadius?: number;
  /** Bonus speed fraction granted to allies in the aura (herald ability). */
  auraSpeedBonus?: number;
  /** Tower-attack range in world px — stops to stab towers this close. */
  attackRange?: number;
  /** Damage dealt per stab to the engaged tower. */
  attackDamage?: number;
  /** Seconds between stabs. */
  attackInterval?: number;
}

export const ENEMIES: Record<EnemyType, EnemyDefinition> = {
  grunt: {
    type: 'grunt',
    name: 'Grunt',
    hp: 100,
    speed: 40,
    damage: 10,
    reward: 5,
    radius: 14,
    color: 0x7ec850,
    description: 'Standard blob creature.',
  },
  runner: {
    type: 'runner',
    name: 'Runner',
    hp: 60,
    speed: 90,
    damage: 8,
    reward: 7,
    radius: 11,
    color: 0xffc93c,
    description: 'Fast but fragile.',
  },
  tank: {
    type: 'tank',
    name: 'Tank',
    hp: 500,
    speed: 20,
    damage: 30,
    reward: 25,
    radius: 22,
    color: 0xb06bd6,
    description: 'Slow, armored, dangerous.',
  },
  spearman: {
    type: 'spearman',
    name: 'Spearman',
    hp: 130,
    speed: 34,
    damage: 10,
    reward: 8,
    radius: 13,
    color: 0xef4444,
    attackRange: 110,
    attackDamage: 3,
    attackInterval: 1.4,
    description: 'Hurls spears at towers in reach instead of walking past.',
  },
  boss: {
    type: 'boss',
    name: 'Warlord',
    hp: 3000,
    speed: 16,
    damage: 40,
    reward: 200,
    radius: 42,
    color: 0x9f1239,
    description: 'Wave boss. A huge slab of HP that hits the core hard.',
  },
  'boss-shielded': {
    type: 'boss-shielded',
    name: 'Bulwark',
    hp: 2600,
    speed: 15,
    damage: 40,
    reward: 220,
    radius: 42,
    color: 0x3b82f6,
    ability: 'shield',
    shield: 1200,
    description: 'Boss with a shield that must be broken before its HP.',
  },
  'boss-regen': {
    type: 'boss-regen',
    name: 'Leech',
    hp: 3200,
    speed: 16,
    damage: 40,
    reward: 220,
    radius: 42,
    color: 0x22c55e,
    ability: 'regen',
    regenPerSec: 45,
    description: 'Boss that slowly heals — burst it down before it recovers.',
  },
  'boss-herald': {
    type: 'boss-herald',
    name: 'Herald',
    hp: 2600,
    speed: 18,
    damage: 40,
    reward: 240,
    radius: 42,
    color: 0xf59e0b,
    ability: 'herald',
    auraRadius: 190,
    auraSpeedBonus: 0.3,
    description: 'Boss that hastens every enemy around it. Kill it first.',
  },
  'minion-shielded': {
    type: 'minion-shielded',
    name: 'Shieldling',
    hp: 260,
    speed: 24,
    damage: 10,
    reward: 14,
    radius: 16,
    color: 0x3b82f6,
    ability: 'shield',
    shield: 140,
    description: 'Tiny Bulwark. Weak shield, but they come in packs.',
  },
  'minion-regen': {
    type: 'minion-regen',
    name: 'Sporeling',
    hp: 320,
    speed: 26,
    damage: 10,
    reward: 14,
    radius: 16,
    color: 0x22c55e,
    ability: 'regen',
    regenPerSec: 12,
    description: 'Tiny Leech. Slowly heals, so finish it quickly.',
  },
  'minion-herald': {
    type: 'minion-herald',
    name: 'Heraldling',
    hp: 240,
    speed: 28,
    damage: 10,
    reward: 14,
    radius: 16,
    color: 0xf59e0b,
    ability: 'herald',
    auraRadius: 130,
    auraSpeedBonus: 0.15,
    description: 'Tiny Herald. Speeds up the friends around it.',
  },
};

export const ENEMY_TYPES: EnemyType[] = [
  'grunt',
  'runner',
  'tank',
  'spearman',
  'boss',
  'boss-shielded',
  'boss-regen',
  'boss-herald',
  'minion-shielded',
  'minion-regen',
  'minion-herald',
];

/** True for the plain boss and every boss variant. */
export function isBossType(type: EnemyType): boolean {
  return type === 'boss' || type.startsWith('boss-');
}
