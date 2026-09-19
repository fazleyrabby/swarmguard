/**
 * Enemy balance data (spec §13–14, §28).
 */

export type EnemyType = 'grunt' | 'runner' | 'tank' | 'boss';

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
};

export const ENEMY_TYPES: EnemyType[] = ['grunt', 'runner', 'tank', 'boss'];
