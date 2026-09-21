/**
 * Combat system (spec §22–23, §25, §27): cooldowns → projectiles → damage.
 * Towers never touch enemies directly; they emit projectiles and this module
 * resolves impacts (single-target, cannon falloff splash, bomb slow).
 */
import { ENEMIES } from '../../config/enemies';
import {
  CANNON_FALLOFF,
  TOWERS,
  getTowerLevel,
} from '../../config/towers';
import {
  applyPoisonEffect,
  nextProjectileId,
  type Enemy,
  type Projectile,
  type ProjectileKind,
} from '../entities';
import type { EventBus } from '../EventBus';
import type { GameState } from '../GameState';
import { applyDamage, applyRange } from '../profile';
import { addGold } from './EconomySystem';
import type { ProjectilePool } from './ProjectileSystem';
import { PROJECTILE_HIT_RADIUS, PROJECTILE_SPEEDS } from './ProjectileSystem';

export function findEnemyById(
  enemies: Enemy[],
  id: number,
): Enemy | undefined {
  for (const e of enemies) {
    if (e.id === id) return e;
  }
  return undefined;
}

function inRange(
  tx: number,
  ty: number,
  ex: number,
  ey: number,
  range: number,
): boolean {
  const dx = tx - ex;
  const dy = ty - ey;
  return dx * dx + dy * dy <= range * range;
}

/**
 * Tick cooldowns and fire at validated targets.
 * Stale target refs (dead/missing/out of range) are cleared (spec §86).
 */
export function updateCombat(
  state: GameState,
  delta: number,
  events: EventBus,
  pool: ProjectilePool,
): void {
  for (const tower of state.towers) {
    const stats = getTowerLevel(tower.type, tower.level, tower.branch);
    if (TOWERS[tower.type].projectile === 'none') continue;
    const range = applyRange(stats.range, state.mods);
    tower.cooldown -= delta;

    let target: Enemy | undefined;
    if (tower.targetId !== undefined) {
      const current = findEnemyById(state.enemies, tower.targetId);
      if (
        current &&
        current.alive &&
        inRange(tower.x, tower.y, current.x, current.y, range)
      ) {
        target = current;
      } else {
        tower.targetId = undefined;
      }
    }

    if (!target || tower.cooldown > 0) continue;

    const dx = target.x - tower.x;
    const dy = target.y - tower.y;
    const dist = Math.hypot(dx, dy) || 1;
    const kind = TOWERS[tower.type].projectile as ProjectileKind;
    const speed = PROJECTILE_SPEEDS[kind];
    const attackSpeed =
      stats.attackSpeed * (1 + (tower.auraAttackSpeedBonus ?? 0));
    const damage =
      applyDamage(stats.damage, state.mods) *
      (state.challenge.towerDamageMult ?? 1) *
      (1 + (tower.auraDamageBonus ?? 0));
    const projectile = pool.obtain({
      id: nextProjectileId(),
      kind,
      x: tower.x,
      y: tower.y,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      targetId: target.id,
      damage,
      speed,
      splashRadius: stats.splashRadius,
      slowFactor: stats.slowFactor,
      slowDuration: stats.slowDuration,
      poisonDamagePerSec: stats.poisonDamagePerSec,
      poisonDuration: stats.poisonDuration,
      sourceTowerId: tower.id,
      alive: true,
      age: 0,
      maxAge: 4,
    });
    state.projectiles.push(projectile);
    tower.cooldown = 1 / attackSpeed;
    tower.angle = Math.atan2(dy, dx);
    events.emit('tower:fired', { towerId: tower.id, targetId: target.id });
  }
}

/** Damage one enemy; kills grant gold and emit events. */
export function damageEnemy(
  state: GameState,
  enemy: Enemy,
  damage: number,
  events: EventBus,
): void {
  if (!enemy.alive) return;
  let remaining = damage;

  // Absorbing shield soaks damage before HP (shield ability).
  if (enemy.shield && enemy.shield > 0) {
    const absorbed = Math.min(enemy.shield, remaining);
    enemy.shield -= absorbed;
    remaining -= absorbed;
    if (enemy.shield <= 0) {
      enemy.shield = 0;
      events.emit('enemy:shield-broken', enemy);
    }
    if (remaining <= 0) return;
  }

  enemy.hp -= remaining;
  if (enemy.hp <= 0) {
    enemy.alive = false;
    addGold(state, enemy.reward);
    state.killsThisWave++;
    state.goldThisWave += enemy.reward;
    state.totalKills++;
    state.totalGoldEarned += enemy.reward;
    events.emit('enemy:killed', enemy);
    events.emit('gold:changed', state.gold);
  }
}

/** Cannon stepwise falloff (spec §22): 100% / 70% / 40%. */
export function cannonFalloff(damage: number, dist: number, radius: number): number {
  if (radius <= 0) return damage;
  const f = dist / radius;
  if (f <= CANNON_FALLOFF[0].radiusFraction) return damage;
  if (f <= CANNON_FALLOFF[1].radiusFraction) {
    return Math.round(damage * CANNON_FALLOFF[1].damageFraction);
  }
  return Math.round(damage * CANNON_FALLOFF[2].damageFraction);
}

function applySlow(enemy: Enemy, factor: number | undefined, duration: number | undefined): void {
  if (factor === undefined || duration === undefined) return;
  if (factor <= 0 || duration <= 0) return;
  // Keep the strongest slow; refresh duration.
  if (factor >= enemy.slowFactor || enemy.slowTimeLeft <= 0) {
    enemy.slowFactor = factor;
  }
  enemy.slowTimeLeft = Math.max(enemy.slowTimeLeft, duration);
}

/**
 * Resolve a projectile impact at (x, y) against its direct hit.
 * Splash (cannon/bomb) also hits others within splashRadius.
 */
export function applyProjectileHit(
  state: GameState,
  projectile: Projectile,
  directHit: Enemy | undefined,
  events: EventBus,
): void {
  const ix = directHit ? directHit.x : projectile.x;
  const iy = directHit ? directHit.y : projectile.y;
  const radius = projectile.splashRadius ?? 0;

  if (directHit && directHit.alive) {
    damageEnemy(state, directHit, projectile.damage, events);
    applySlow(directHit, projectile.slowFactor, projectile.slowDuration);
    applyPoisonEffect(
      directHit,
      projectile.sourceTowerId,
      projectile.poisonDamagePerSec ?? 0,
      projectile.poisonDuration ?? 0,
    );
  }

  if (radius > 0) {
    const isBomb = projectile.kind === 'bomb';
    for (const enemy of state.enemies) {
      if (!enemy.alive || enemy === directHit) continue;
      const def = ENEMIES[enemy.type];
      const dist =
        Math.hypot(enemy.x - ix, enemy.y - iy) - def.radius - PROJECTILE_HIT_RADIUS;
      if (dist <= radius) {
        const dmg = isBomb
          ? projectile.damage
          : cannonFalloff(projectile.damage, Math.max(0, dist), radius);
        damageEnemy(state, enemy, dmg, events);
        applySlow(enemy, projectile.slowFactor, projectile.slowDuration);
      }
    }
  }
}
