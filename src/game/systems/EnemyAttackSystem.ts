/**
 * Enemy attack system: melee enemies (spearman) stop next to towers and stab
 * them instead of walking past. Towers have structural HP; at 0 the tower is
 * destroyed (slot freed, no refund — repair before that happens).
 */
import type { EventBus } from '../EventBus';
import type { Enemy, Tower } from '../entities';
import type { GameState } from '../GameState';

function inMeleeRange(enemy: Enemy, tower: Tower): boolean {
  const range = enemy.attackRange ?? 0;
  return (tower.x - enemy.x) ** 2 + (tower.y - enemy.y) ** 2 <= range * range;
}

function nearestTowerInRange(state: GameState, enemy: Enemy): Tower | undefined {
  let best: Tower | undefined;
  let bestD2 = Infinity;
  for (const tower of state.towers) {
    if (tower.hp <= 0) continue;
    const d2 = (tower.x - enemy.x) ** 2 + (tower.y - enemy.y) ** 2;
    const range = enemy.attackRange ?? 0;
    if (d2 <= range * range && d2 < bestD2) {
      bestD2 = d2;
      best = tower;
    }
  }
  return best;
}

function destroyTower(state: GameState, tower: Tower, events: EventBus): void {
  const idx = state.towers.findIndex((t) => t.id === tower.id);
  if (idx === -1) return;
  const [dead] = state.towers.splice(idx, 1);
  const slot = state.buildSlots.find((b) => b.towerId === tower.id);
  if (slot) {
    slot.occupied = false;
    slot.towerId = undefined;
  }
  if (state.selectedTowerId === tower.id) state.selectedTowerId = undefined;
  for (const enemy of state.enemies) {
    if (enemy.attackTargetId === tower.id) {
      enemy.attackTargetId = undefined;
      enemy.attackCooldown = 0;
    }
  }
  events.emit('tower:destroyed', { ...dead });
}

/**
 * Tick melee attackers. Runs before movement so engaged enemies stand still
 * (movement skips anything with `attackTargetId` set).
 */
export function updateEnemyAttacks(
  state: GameState,
  delta: number,
  events: EventBus,
): void {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    if (enemy.attackRange === undefined || enemy.attackDamage === undefined) continue;

    let tower =
      enemy.attackTargetId !== undefined
        ? state.towers.find((t) => t.id === enemy.attackTargetId)
        : undefined;
    if (!tower || tower.hp <= 0 || !inMeleeRange(enemy, tower)) {
      tower = nearestTowerInRange(state, enemy);
      enemy.attackTargetId = tower?.id;
      if (!tower) continue;
    }

    enemy.attackCooldown = (enemy.attackCooldown ?? 0) - delta;
    if (enemy.attackCooldown > 0) continue;
    enemy.attackCooldown = enemy.attackInterval ?? 1;
    tower.hp = Math.max(0, tower.hp - enemy.attackDamage);
    events.emit('tower:damaged', {
      towerId: tower.id,
      x: tower.x,
      y: tower.y,
      damage: enemy.attackDamage,
      fromX: enemy.x,
      fromY: enemy.y,
    });
    if (tower.hp <= 0) destroyTower(state, tower, events);
  }
}
