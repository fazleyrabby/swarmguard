/**
 * Upgrade system (spec §21, §30–31, §52): data-driven tower levels.
 * Upgrade cost to reach level N is stored on level N (level 1 = 0).
 */
import { MAX_TOWER_LEVEL, TOWERS, getTowerLevel, type TowerId, type TowerLevelStats } from '../../config/towers';
import type { Tower } from '../entities';

export { MAX_TOWER_LEVEL };

/** Stats for a tower's current level. Pure. */
export function statsFor(type: TowerId, level: number): TowerLevelStats {
  return getTowerLevel(type, level);
}

/** Cost to upgrade FROM `level` to `level + 1`; undefined when maxed. */
export function upgradeCostFor(type: TowerId, level: number): number | undefined {
  const def = TOWERS[type];
  const nextIndex = level; // levels[0] is level 1, so next = current 1-based level.
  if (nextIndex >= def.levels.length) return undefined;
  return def.levels[nextIndex].upgradeCost;
}

export function isMaxLevel(type: TowerId, level: number): boolean {
  return level >= TOWERS[type].levels.length;
}

/** Bump a tower one level; returns false when already maxed. */
export function applyUpgrade(tower: Tower): boolean {
  if (isMaxLevel(tower.type, tower.level)) return false;
  tower.level++;
  return true;
}

/** Build cost for a fresh level-1 tower. */
export function buildCostFor(type: TowerId): number {
  return TOWERS[type].cost;
}

/** Total gold invested in a tower at `level` (build + all upgrades so far). */
export function investedFor(type: TowerId, level: number): number {
  const def = TOWERS[type];
  let total = def.cost;
  for (let i = 1; i < level && i < def.levels.length; i++) {
    total += def.levels[i].upgradeCost;
  }
  return total;
}

/** Sell refund (70% of invested, rounded down). */
export function sellRefundFor(type: TowerId, level: number): number {
  return Math.floor(investedFor(type, level) * 0.7);
}
