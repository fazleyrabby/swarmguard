/**
 * Upgrade system (spec §21, §30–31, §52): data-driven tower levels.
 * Upgrade cost to reach level N is stored on level N (level 1 = 0).
 */
import {
  MAX_TOWER_LEVEL,
  TOWERS,
  branchFor,
  getTowerLevel,
  isBranchChoice,
  type TowerId,
  type TowerLevelStats,
} from '../../config/towers';
import type { Tower } from '../entities';

export { MAX_TOWER_LEVEL, isBranchChoice };

/** Stats for a tower's current level + branch. Pure. */
export function statsFor(type: TowerId, level: number, branchId?: string): TowerLevelStats {
  return getTowerLevel(type, level, branchId);
}

/** Cost to upgrade FROM `level` to `level + 1`; undefined when maxed. */
export function upgradeCostFor(
  type: TowerId,
  level: number,
  branchId?: string,
): number | undefined {
  const def = TOWERS[type];
  const nextLevel = level + 1;
  const bl = def.branchLevel;
  if (branchId && bl !== undefined && nextLevel >= bl) {
    const branch = branchFor(type, branchId);
    if (branch) {
      const idx = nextLevel - bl;
      if (idx >= 0 && idx < branch.levels.length) return branch.levels[idx].upgradeCost;
    }
  }
  if (level >= def.levels.length) return undefined;
  return def.levels[level].upgradeCost;
}

export function isMaxLevel(type: TowerId, level: number): boolean {
  return level >= MAX_TOWER_LEVEL;
}

/** Bump a tower one level; optionally locks in a branch. False when maxed. */
export function applyUpgrade(tower: Tower, branchId?: string): boolean {
  if (isMaxLevel(tower.type, tower.level)) return false;
  tower.level++;
  if (branchId && !tower.branch) tower.branch = branchId;
  return true;
}

/** Build cost for a fresh level-1 tower. */
export function buildCostFor(type: TowerId): number {
  return TOWERS[type].cost;
}

/** Total gold invested in a tower at `level` (build + all upgrades so far). */
export function investedFor(type: TowerId, level: number, branchId?: string): number {
  let total = TOWERS[type].cost;
  for (let l = 2; l <= level; l++) {
    const cost = upgradeCostFor(type, l - 1, branchId);
    if (cost !== undefined) total += cost;
  }
  return total;
}

/** Sell refund (70% of invested, rounded down). */
export function sellRefundFor(type: TowerId, level: number, branchId?: string): number {
  return Math.floor(investedFor(type, level, branchId) * 0.7);
}

/** Full-repair cost: 30% of invested, scaled by the missing-HP fraction. */
export function repairCostFor(
  type: TowerId,
  level: number,
  branchId: string | undefined,
  hp: number,
  maxHp: number,
): number {
  if (hp >= maxHp || maxHp <= 0) return 0;
  return Math.max(1, Math.ceil(investedFor(type, level, branchId) * 0.3 * ((maxHp - hp) / maxHp)));
}
