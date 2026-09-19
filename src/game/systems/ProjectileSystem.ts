/**
 * Projectile system (spec §26, §47): straight homing-ish flight, object pool.
 * Projectiles steer toward a live target; when the target is gone they keep
 * their last velocity and fizzle after maxAge. Pooled to avoid GC churn.
 */
import { ENEMIES } from '../../config/enemies';
import type { Enemy, Projectile, ProjectileKind } from '../entities';
import type { GameState } from '../GameState';

export const PROJECTILE_SPEEDS: Record<ProjectileKind, number> = {
  arrow: 600,
  cannonball: 420,
  bomb: 380,
};

/** Base contact radius added to the enemy's own radius. */
export const PROJECTILE_HIT_RADIUS = 6;

export class ProjectilePool {
  private free: Projectile[] = [];

  /** Reuse a pooled object or copy the fresh one when empty. */
  obtain(init: Projectile): Projectile {
    const pooled = this.free.pop();
    if (!pooled) return { ...init };
    Object.assign(pooled, init);
    return pooled;
  }

  release(p: Projectile): void {
    p.alive = false;
    if (this.free.length < 512) this.free.push(p);
  }

  get freeCount(): number {
    return this.free.length;
  }
}

function findTarget(enemies: Enemy[], id: number): Enemy | undefined {
  for (const e of enemies) {
    if (e.id === id) return e;
  }
  return undefined;
}

function contactRadius(enemy: Enemy): number {
  return ENEMIES[enemy.type].radius + PROJECTILE_HIT_RADIUS;
}

export type ImpactHandler = (
  projectile: Projectile,
  directHit: Enemy | undefined,
) => void;

/**
 * Move projectiles and report impacts via onImpact (resolved by CombatSystem).
 * Dead projectiles are released back to the pool and removed from state.
 */
export function updateProjectiles(
  state: GameState,
  delta: number,
  pool: ProjectilePool,
  onImpact: ImpactHandler,
): void {
  const list = state.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (!p.alive) {
      list.splice(i, 1);
      pool.release(p);
      continue;
    }
    p.age += delta;
    if (p.age >= p.maxAge) {
      // Stray shot: explode in place when carrying splash, else just fizzle.
      const splash = p.splashRadius;
      list.splice(i, 1);
      pool.release(p);
      if (splash && splash > 0) onImpact(p, undefined);
      continue;
    }

    const target = findTarget(state.enemies, p.targetId);
    if (target && target.alive) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= Math.max(contactRadius(target), p.speed * delta)) {
        p.x = target.x;
        p.y = target.y;
        list.splice(i, 1);
        pool.release(p);
        onImpact(p, target);
        continue;
      }
      // Homing-ish: re-aim velocity at the live target each tick.
      p.vx = (dx / dist) * p.speed;
      p.vy = (dy / dist) * p.speed;
    } else {
      // Target gone: check contact with any live enemy (strays can connect).
      let hit: Enemy | undefined;
      for (const e of state.enemies) {
        if (!e.alive) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const r = contactRadius(e);
        if (dx * dx + dy * dy <= r * r) {
          hit = e;
          break;
        }
      }
      if (hit) {
        p.x = hit.x;
        p.y = hit.y;
        list.splice(i, 1);
        pool.release(p);
        onImpact(p, hit);
        continue;
      }
    }

    p.x += p.vx * delta;
    p.y += p.vy * delta;
  }
}
