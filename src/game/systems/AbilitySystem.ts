/**
 * Enemy and tower status system:
 * - regen: bosses (Leech) restore HP over time.
 * - herald: the Herald grants a speed aura to nearby enemies.
 * - poison: Alchemist doses tick once per second and expire independently.
 * - war drums: the nearest support tower grants one non-stacking attack buff.
 */
import { TOWERS, getTowerLevel } from '../../config/towers';
import type { EventBus } from '../EventBus';
import type { GameState } from '../GameState';
import { applyDamage, applyRange } from '../profile';
import { damageEnemy } from './CombatSystem';

export function applyPoison(state: GameState, delta: number, events: EventBus): void {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const effects = enemy.poisonEffects;
    if (!effects || effects.length === 0) continue;
    for (const effect of effects) {
      effect.elapsed += delta;
      effect.tickTimer += delta;
      while (effect.tickTimer >= 1 && enemy.alive) {
        effect.tickTimer -= 1;
        damageEnemy(state, enemy, effect.damagePerSecond, events);
      }
    }
    enemy.poisonEffects = effects.filter((effect) => effect.elapsed < effect.duration);
  }
}

function updateTowerAuras(state: GameState): void {
  state.auraTimer -= 1 / 60;
  if (state.auraTimer > 0) return;
  state.auraTimer = 0.5;
  recalculateAuras(state);
}

export function recalculateAuras(state: GameState): void {
  for (const tower of state.towers) {
    tower.auraRadius = undefined;
    tower.auraAttackSpeedBonus = undefined;
    tower.auraDamageBonus = undefined;
    tower.auraSourceTowerId = undefined;
  }

  const drums = state.towers.filter((tower) => TOWERS[tower.type].projectile === 'none');
  for (const tower of state.towers) {
    if (TOWERS[tower.type].projectile === 'none') continue;
    let nearest: { tower: typeof tower; distanceSq: number } | undefined;
    for (const source of drums) {
      const stats = getTowerLevel(source.type, source.level, source.branch);
      const radius = applyRange(stats.auraRadius ?? 0, state.mods);
      const dx = tower.x - source.x;
      const dy = tower.y - source.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= radius * radius && (!nearest || distanceSq < nearest.distanceSq)) {
        nearest = { tower: source, distanceSq };
      }
    }
    if (!nearest) continue;
    const stats = getTowerLevel(nearest.tower.type, nearest.tower.level, nearest.tower.branch);
    tower.auraRadius = applyRange(stats.auraRadius ?? 0, state.mods);
    tower.auraAttackSpeedBonus = stats.attackSpeedBonus ?? 0;
    tower.auraDamageBonus = stats.damageBonus ?? 0;
    tower.auraSourceTowerId = nearest.tower.id;
  }
}

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

  updateTowerAuras(state);
}

