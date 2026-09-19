/**
 * Movement system (spec §10, §12, §18): waypoint interpolation.
 * Enemies follow the predefined path; reaching the end damages the base
 * and despawns the enemy. No per-enemy pathfinding.
 */
import type { EventBus } from '../EventBus';
import { GameStatus, type GameState } from '../GameState';

const ARRIVE_EPS = 2;

export function effectiveSpeed(
  baseSpeed: number,
  slowTimeLeft: number,
  slowFactor: number,
): number {
  if (slowTimeLeft > 0 && slowFactor > 0) {
    return Math.max(0, baseSpeed * (1 - slowFactor));
  }
  return baseSpeed;
}

export function updateMovement(
  state: GameState,
  delta: number,
  events: EventBus,
): void {
  const path = state.map.path;
  if (path.length < 2) return;
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    if (enemy.slowTimeLeft > 0) {
      enemy.slowTimeLeft = Math.max(0, enemy.slowTimeLeft - delta);
      if (enemy.slowTimeLeft === 0) enemy.slowFactor = 0;
    }

    let remaining =
      effectiveSpeed(enemy.speed, enemy.slowTimeLeft, enemy.slowFactor) * delta;

    // Walk along successive waypoints within this tick.
    while (remaining > 0 && enemy.alive) {
      const next = path[enemy.pathIndex + 1];
      if (!next) {
        reachBase(state, enemy, events);
        break;
      }
      const dx = next.x - enemy.x;
      const dy = next.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= Math.max(ARRIVE_EPS, remaining)) {
        enemy.x = next.x;
        enemy.y = next.y;
        enemy.distanceTraveled += dist;
        enemy.pathIndex++;
        remaining -= dist;
        if (enemy.pathIndex >= path.length - 1) {
          reachBase(state, enemy, events);
        }
      } else {
        enemy.x += (dx / dist) * remaining;
        enemy.y += (dy / dist) * remaining;
        enemy.distanceTraveled += remaining;
        remaining = 0;
      }
    }
  }
}

function reachBase(
  state: GameState,
  enemy: { alive: boolean; damage: number },
  events: EventBus,
): void {
  enemy.alive = false;
  state.baseHp = Math.max(0, state.baseHp - enemy.damage);
  events.emit('enemy:reached-base', enemy);
  events.emit('base:damaged', enemy.damage);
  if (state.baseHp <= 0 && state.status !== GameStatus.GAME_OVER) {
    state.status = GameStatus.GAME_OVER;
    events.emit('game:over', { wave: state.wave });
  }
}
