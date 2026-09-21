/**
 * Entity interfaces (spec §11, §13, §24–26) + id counters.
 * Pure data — no PixiJS, no DOM.
 */
import type { EnemyType } from '../config/enemies';
import type { TowerId, TowerLevelStats } from '../config/towers';

export type TargetingMode = 'first' | 'nearest' | 'strongest' | 'weakest';

/** Default targeting for all towers (spec §24). */
export const DEFAULT_TARGETING: TargetingMode = 'first';

export interface PoisonEffect {
  sourceTowerId: string;
  damagePerSecond: number;
  duration: number;
  elapsed: number;
  tickTimer: number;
}

/** Apply or refresh a poison dose from one tower. */
export function applyPoisonEffect(
  enemy: Enemy,
  sourceTowerId: string,
  damagePerSecond: number,
  duration: number,
): void {
  if (damagePerSecond <= 0 || duration <= 0) return;
  const effects = enemy.poisonEffects ?? [];
  const existing = effects.find((effect) => effect.sourceTowerId === sourceTowerId);
  if (existing) {
    existing.damagePerSecond = Math.max(existing.damagePerSecond, damagePerSecond);
    existing.duration = Math.max(existing.duration, duration);
    existing.elapsed = 0;
    existing.tickTimer = 0;
    return;
  }
  effects.push({ sourceTowerId, damagePerSecond, duration, elapsed: 0, tickTimer: 0 });
  enemy.poisonEffects = effects;
}

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
  /** Remaining absorbing shield (shield ability). */
  shield?: number;
  maxShield?: number;
  /** HP restored per second (regen ability). */
  regenPerSec?: number;
  /** Speed aura radius in world px (herald ability). */
  auraRadius?: number;
  /** Bonus speed fraction granted to nearby allies (herald ability). */
  auraSpeedBonus?: number;
  /** Runtime speed multiplier from nearby heralds (1 = unaffected). */
  auraMult?: number;
  /** Remaining slow time (sec). 0 = not slowed. */
  slowTimeLeft: number;
  /** Slow strength 0–1 (fraction of speed removed). */
  slowFactor: number;
  /** Active poison effects, keyed by source tower. */
  poisonEffects?: PoisonEffect[];
  /** Tower-attack range in world px (spearman). Undefined = walks past towers. */
  attackRange?: number;
  /** Damage dealt per stab to the engaged tower. */
  attackDamage?: number;
  /** Seconds between stabs. */
  attackInterval?: number;
  /** Seconds until the next stab lands. */
  attackCooldown?: number;
  /** Id of the tower currently being stabbed (validated every tick). */
  attackTargetId?: string;
}

export interface Tower {
  id: string;
  type: TowerId;
  x: number;
  y: number;
  /** 1-based level into the tower definition's levels array. */
  level: number;
  /** Current structural HP — spearmen chew through this. */
  hp: number;
  /** Max structural HP at the current level. */
  maxHp: number;
  /** Chosen specialization id (once level reaches the tower's branchLevel). */
  branch?: string;
  /** Seconds until the tower can fire again. */
  cooldown: number;
  targeting: TargetingMode;
  /** Enemy id of current target (validated every tick — may be stale). */
  targetId?: number;
  /** Facing angle in radians (used by renderer later). */
  angle: number;
  /** Aura radius granted by a support tower, after run range modifiers. */
  auraRadius?: number;
  /** Runtime attack-speed bonus from the nearest War Drums tower. */
  auraAttackSpeedBonus?: number;
  /** Runtime damage bonus from the nearest War Drums tower. */
  auraDamageBonus?: number;
  /** Source support tower for the current aura buff. */
  auraSourceTowerId?: string;
}

export type ProjectileKind = 'arrow' | 'cannonball' | 'bomb' | 'frostshard' | 'vial' | 'bullet';

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
  poisonDamagePerSec?: number;
  poisonDuration?: number;
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
