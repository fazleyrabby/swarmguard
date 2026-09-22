import type { GameState } from '../GameState';
import { DIFFICULTY_MODIFIERS, type Difficulty } from '../GameState';
import type { Enemy } from '../entities';

export function getDifficultyMods(difficulty: Difficulty) {
  return DIFFICULTY_MODIFIERS[difficulty];
}

export function applyDifficultyToWave(state: GameState): void {
  const mods = getDifficultyMods(state.difficulty);
  state.waveHpMult *= mods.hpMult;
  state.waveSpeedMult *= mods.spawnRateMult;
  state.spawnIntervalSec /= mods.spawnRateMult;
}

export function updateDifficulty(dt: number, state: GameState): void {
  const mods = getDifficultyMods(state.difficulty);
  if (mods.coreHpDrainPerSec && state.baseHp > 0) {
    state.baseHp = Math.max(0, state.baseHp - mods.coreHpDrainPerSec * dt);
  }
  if (mods.coreAuraRadius) {
    const cr = mods.coreAuraRadius;
    const { x, y } = state.map.base;
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      if (dx * dx + dy * dy <= cr * cr) {
        enemy.hp -= dt * 5;
      }
    }
  }
  if (mods.enemyRegenPerSec) {
    for (const enemy of state.enemies) {
      if (enemy.alive) {
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + mods.enemyRegenPerSec * dt);
      }
    }
  }
}

export function enemyInRangeOfCore(
  enemy: Pick<Enemy, 'x' | 'y'>,
  coreX: number,
  coreY: number,
  radius: number
): boolean {
  const dx = enemy.x - coreX;
  const dy = enemy.y - coreY;
  return dx * dx + dy * dy <= radius * radius;
}
