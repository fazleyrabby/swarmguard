/**
 * Enemy ability system: passive boss behaviors that don't belong in movement
 * or combat.
 *
 * - regen: bosses (Leech) restore HP over time.
 * - herald: the Herald grants a speed aura to nearby enemies. The multiplier
 *   is recomputed every tick, so it disappears the instant the Herald dies.
 */
import type { EventBus } from '../EventBus';
import type { GameState } from '../GameState';

export function updateAbilities(state: GameState, delta: number, _events: EventBus): void {
  let hasHerald = false;
  for (const e of state.enemies) {
    if (e.alive && e.auraRadius && e.auraSpeedBonus) {
      hasHerald = true;
      break;
    }
  }

  if (hasHerald) {
    for (const e of state.enemies) {
      if (e.alive) e.auraMult = 1;
    }
    for (const herald of state.enemies) {
      if (!herald.alive || !herald.auraRadius || !herald.auraSpeedBonus) continue;
      const r2 = herald.auraRadius * herald.auraRadius;
      for (const e of state.enemies) {
        if (!e.alive) continue;
        const dx = e.x - herald.x;
        const dy = e.y - herald.y;
        if (dx * dx + dy * dy <= r2) {
          e.auraMult = Math.max(e.auraMult ?? 1, 1 + herald.auraSpeedBonus);
        }
      }
    }
  } else {
    for (const e of state.enemies) {
      if (e.auraMult !== undefined && e.auraMult !== 1) e.auraMult = 1;
    }
  }

  for (const e of state.enemies) {
    if (!e.alive || !e.regenPerSec) continue;
    if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.regenPerSec * delta);
  }
}
