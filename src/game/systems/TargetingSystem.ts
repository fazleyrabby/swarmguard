/**
 * Targeting system (spec §24, §48): nearest / first / strongest / weakest.
 * Default mode is "first" (furthest along the path). Simple distance checks;
 * structured so a spatial grid can slot in later without changing callers.
 */
import { getTowerLevel } from '../../config/towers';
import type { Enemy, Tower, TargetingMode } from '../entities';
import type { GameState } from '../GameState';

export type { TargetingMode };

export function isInRange(
  tower: Pick<Tower, 'x' | 'y'>,
  enemy: Pick<Enemy, 'x' | 'y'>,
  range: number,
): boolean {
  const dx = tower.x - enemy.x;
  const dy = tower.y - enemy.y;
  return dx * dx + dy * dy <= range * range;
}

export function enemiesInRange(
  tower: Pick<Tower, 'x' | 'y'>,
  enemies: Enemy[],
  range: number,
): Enemy[] {
  const r2 = range * range;
  const out: Enemy[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = tower.x - e.x;
    const dy = tower.y - e.y;
    if (dx * dx + dy * dy <= r2) out.push(e);
  }
  return out;
}

/** Pick one target from in-range enemies. Returns undefined when none. Pure. */
export function acquireTarget(
  tower: Pick<Tower, 'x' | 'y' | 'targeting'>,
  enemies: Enemy[],
  range: number,
): Enemy | undefined {
  const candidates = enemiesInRange(tower, enemies, range);
  if (candidates.length === 0) return undefined;
  switch (tower.targeting) {
    case 'nearest': {
      let best = candidates[0];
      let bestD = distSq(tower, best);
      for (let i = 1; i < candidates.length; i++) {
        const d = distSq(tower, candidates[i]);
        if (d < bestD) {
          bestD = d;
          best = candidates[i];
        }
      }
      return best;
    }
    case 'strongest': {
      let best = candidates[0];
      for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].hp > best.hp) best = candidates[i];
      }
      return best;
    }
    case 'weakest': {
      let best = candidates[0];
      for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].hp < best.hp) best = candidates[i];
      }
      return best;
    }
    case 'first':
    default: {
      let best = candidates[0];
      for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].distanceTraveled > best.distanceTraveled) {
          best = candidates[i];
        }
      }
      return best;
    }
  }
}

function distSq(
  a: Pick<Tower, 'x' | 'y'>,
  b: Pick<Enemy, 'x' | 'y'>,
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function findEnemy(enemies: Enemy[], id: number): Enemy | undefined {
  for (const e of enemies) {
    if (e.id === id) return e;
  }
  return undefined;
}

/**
 * Refresh every tower's targetId/angle. Guards stale refs (spec §86):
 * dead or out-of-range targets are cleared before re-acquiring.
 */
export function updateTargets(state: GameState): void {
  for (const tower of state.towers) {
    const stats = getTowerLevel(tower.type, tower.level);
    let target: Enemy | undefined;
    if (tower.targetId !== undefined) {
      const current = findEnemy(state.enemies, tower.targetId);
      if (current && current.alive && isInRange(tower, current, stats.range)) {
        target = current;
      } else {
        tower.targetId = undefined;
      }
    }
    if (!target) {
      target = acquireTarget(tower, state.enemies, stats.range);
      tower.targetId = target?.id;
    }
    if (target) {
      tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    }
  }
}
