/**
 * Entity interfaces (spec §11, §13, §24–26) + id counters.
 * Pure data — no PixiJS, no DOM.
 */
import type { EnemyType } from '../config/enemies';
import type { TowerId, TowerLevelStats } from '../config/towers';

export type TargetingMode = 'first' | 'nearest' | 'strongest' | 'weakest';

/** Default targeting for all towers (spec §24). */
export const DEFAULT_TARGETING: TargetingMode = 'first';

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Base speed (world px/sec) before multipliers/slow. */
  speed: number;
  damage: number;
  reward: number;
  /** Index of the last waypoint reached in the path array. */
  pathIndex: number;
  /** Total distance travelled along the path — drives "first" targeting. */
  distanceTraveled: number;
  alive: boolean;
  /** Remaining slow time (sec). 0 = not slowed. */
  slowTimeLeft: number;
  /** Slow strength 0–1 (fraction of speed removed). */
  slowFactor: number;
}

export interface Tower {
  id: string;
  type: TowerId;
  x: number;
  y: number;
  /** 1-based level into the tower definition's levels array. */
  level: number;
  /** Seconds until the tower can fire again. */
  cooldown: number;
  targeting: TargetingMode;
  /** Enemy id of current target (validated every tick — may be stale). */
  targetId?: number;
  /** Facing angle in radians (used by renderer later). */
  angle: number;
}

export type ProjectileKind = 'arrow' | 'cannonball' | 'bomb' | 'frostshard' | 'bullet';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  /** Current velocity (world px/sec). Kept so dead-target shots fly straight. */
  vx: number;
  vy: number;
  targetId: number;
  damage: number;
  speed: number;
  splashRadius?: number;
  slowFactor?: number;
  slowDuration?: number;
  sourceTowerId: string;
  alive: boolean;
  /** Seconds since fired — strays fizzle at maxAge. */
  age: number;
  maxAge: number;
}

export interface BuildSlot {
  id: string;
  x: number;
  y: number;
  occupied: boolean;
  towerId?: string;
}

// ---- id counters (resettable for tests / new games) ----

let enemyCounter = 1;
let towerCounter = 1;
let projectileCounter = 1;

export function nextEnemyId(): number {
  return enemyCounter++;
}

export function nextTowerId(): string {
  return `tower-${towerCounter++}`;
}

export function nextProjectileId(): number {
  return projectileCounter++;
}

export function resetEntityIds(): void {
  enemyCounter = 1;
  towerCounter = 1;
  projectileCounter = 1;
}

/** Re-export for systems that need current-level stats typing. */
export type { TowerLevelStats };
