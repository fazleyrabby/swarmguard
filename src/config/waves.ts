/**
 * Wave balance data + generator (spec §15–17, §53–56).
 *
 * Count formula:  enemyCount = baseCount + floor(wave * growthFactor)
 * Composition tiers + HP/speed multipliers follow the spec tables.
 */

import type { EnemyType } from './enemies';

export interface WaveCompositionEntry {
  enemyType: EnemyType;
  /** 0–1 fraction of the wave. Entries should sum to 1. */
  percentage: number;
}

export interface WaveDefinition {
  wave: number;
  totalEnemies: number;
  composition: WaveCompositionEntry[];
  /** Ms between spawns. */
  spawnInterval: number;
  healthMultiplier: number;
  speedMultiplier: number;
  /** Flat gold bonus for completing the wave. */
  completionReward: number;
  /** Optional single boss type that spawns at the end of the wave (every 10th). */
  boss?: EnemyType;
  /** How many bosses to spawn (default 1). Used by Boss Rush. */
  bossCount?: number;
}

export const WAVE_TUNING = {
  baseCount: 10,
  growthFactor: 9,
  baseSpawnInterval: 150,
  /** Spawn interval shrinks slightly each wave, clamped at min. */
  spawnIntervalDecayPerWave: 4,
  minSpawnInterval: 60,
  baseCompletionReward: 35,
  completionRewardPerWave: 10,
} as const;

/** Override table for waves 1–10 (spec §55). `null` wave entries use the formula. */
const WAVE_TABLE: Record<
  number,
  { enemies: number; hp: number; speed: number; composition: WaveCompositionEntry[] }
> = {
  1: { enemies: 10, hp: 1, speed: 1, composition: [{ enemyType: 'grunt', percentage: 1 }] },
  2: { enemies: 15, hp: 1, speed: 1, composition: [{ enemyType: 'grunt', percentage: 1 }] },
  3: { enemies: 20, hp: 1.1, speed: 1, composition: [{ enemyType: 'grunt', percentage: 1 }] },
  4: {
    enemies: 28,
    hp: 1.1,
    speed: 1.05,
    composition: [
      { enemyType: 'grunt', percentage: 0.8 },
      { enemyType: 'runner', percentage: 0.2 },
    ],
  },
  5: {
    enemies: 35,
    hp: 1.2,
    speed: 1.05,
    composition: [
      { enemyType: 'grunt', percentage: 0.8 },
      { enemyType: 'runner', percentage: 0.2 },
    ],
  },
  6: {
    enemies: 45,
    hp: 1.25,
    speed: 1.1,
    composition: [
      { enemyType: 'grunt', percentage: 0.7 },
      { enemyType: 'runner', percentage: 0.2 },
      { enemyType: 'tank', percentage: 0.1 },
    ],
  },
  7: {
    enemies: 55,
    hp: 1.35,
    speed: 1.1,
    composition: [
      { enemyType: 'grunt', percentage: 0.65 },
      { enemyType: 'runner', percentage: 0.25 },
      { enemyType: 'tank', percentage: 0.1 },
    ],
  },
  8: {
    enemies: 70,
    hp: 1.45,
    speed: 1.15,
    composition: [
      { enemyType: 'grunt', percentage: 0.65 },
      { enemyType: 'runner', percentage: 0.25 },
      { enemyType: 'tank', percentage: 0.1 },
    ],
  },
  9: {
    enemies: 85,
    hp: 1.6,
    speed: 1.15,
    composition: [
      { enemyType: 'grunt', percentage: 0.6 },
      { enemyType: 'runner', percentage: 0.25 },
      { enemyType: 'tank', percentage: 0.15 },
    ],
  },
  10: {
    enemies: 100,
    hp: 1.75,
    speed: 1.2,
    composition: [
      { enemyType: 'grunt', percentage: 0.6 },
      { enemyType: 'runner', percentage: 0.25 },
      { enemyType: 'tank', percentage: 0.15 },
    ],
  },
};

function compositionForEndlessWave(wave: number): WaveCompositionEntry[] {
  // Post-10 endless: keep wave-10 mix, slightly heavier on tanks over time.
  const tankShare = Math.min(0.15 + (wave - 10) * 0.01, 0.3);
  const runnerShare = 0.25;
  return [
    { enemyType: 'grunt', percentage: 1 - runnerShare - tankShare },
    { enemyType: 'runner', percentage: runnerShare },
    { enemyType: 'tank', percentage: tankShare },
  ];
}

/** Bosses appear on every 10th wave (10, 20, 30, …). */
export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % 10 === 0;
}

/** Boss variants cycle so wave 10/20/30 feel different. */
const BOSS_CYCLE: EnemyType[] = ['boss-shielded', 'boss-regen', 'boss-herald'];

export function bossTypeForWave(wave: number): EnemyType {
  const cycle = Math.max(0, Math.floor(wave / 10) - 1);
  return BOSS_CYCLE[cycle % BOSS_CYCLE.length];
}

export function enemyCountForWave(wave: number): number {
  const tabled = WAVE_TABLE[wave];
  if (tabled) return tabled.enemies;
  return WAVE_TUNING.baseCount + Math.floor(wave * WAVE_TUNING.growthFactor);
}

export function spawnIntervalForWave(wave: number): number {
  return Math.max(
    WAVE_TUNING.minSpawnInterval,
    WAVE_TUNING.baseSpawnInterval - wave * WAVE_TUNING.spawnIntervalDecayPerWave,
  );
}

export function generateWave(wave: number): WaveDefinition {
  const tabled = WAVE_TABLE[wave];
  const totalEnemies = tabled?.enemies ?? enemyCountForWave(wave);
  const composition = tabled?.composition ?? compositionForEndlessWave(wave);
  const healthMultiplier = tabled?.hp ?? 1.75 + (wave - 10) * 0.08;
  const speedMultiplier = tabled?.speed ?? Math.min(1.2 + (wave - 10) * 0.01, 1.5);

  return {
    wave,
    totalEnemies,
    composition,
    spawnInterval: spawnIntervalForWave(wave),
    healthMultiplier,
    speedMultiplier,
    completionReward: WAVE_TUNING.baseCompletionReward + wave * WAVE_TUNING.completionRewardPerWave,
    boss: isBossWave(wave) ? bossTypeForWave(wave) : undefined,
  };
}

/**
 * Boss Rush modifier: each wave is a squad of bosses plus a themed escort.
 * Boss count grows every 3 waves (1→2→3→4). Health ramps in gently so early
 * waves are survivable but late waves are a real wall.
 */
export function generateBossRushWave(wave: number): WaveDefinition {
  const base = generateWave(wave);
  const boss = bossTypeForWave(wave);
  // Escort = miniature versions of the boss (same theme + weaker ability).
  const escort: EnemyType =
    boss === 'boss-shielded'
      ? 'minion-shielded'
      : boss === 'boss-regen'
        ? 'minion-regen'
        : 'minion-herald';
  const escortCount = Math.min(6 + wave * 4, 46);
  const bossCount = 1 + Math.min(4, Math.floor((wave - 1) / 2));
  return {
    ...base,
    totalEnemies: escortCount,
    composition: [{ enemyType: escort, percentage: 1 }],
    boss,
    bossCount,
    // Gentle start, steep growth: 0.32 at wave 1 → 1.4 at wave 10.
    healthMultiplier: 0.2 + wave * 0.12,
    completionReward: base.completionReward,
  };
}

/** Expand a wave definition into an ordered spawn queue of enemy types. */
export function expandSpawnQueue(def: WaveDefinition, seed = 1): EnemyType[] {
  let state = seed >>> 0 || 1;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };

  const queue: EnemyType[] = [];
  let assigned = 0;
  def.composition.forEach((entry, index) => {
    const isLast = index === def.composition.length - 1;
    const count = isLast
      ? def.totalEnemies - assigned
      : Math.floor(def.totalEnemies * entry.percentage);
    assigned += count;
    for (let i = 0; i < count; i++) queue.push(entry.enemyType);
  });

  // Seeded shuffle so composition is deterministic per wave+seed.
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  // Boss always spawns last, after the swarm has thinned out.
  if (def.boss) {
    const count = Math.max(1, Math.floor(def.bossCount ?? 1));
    for (let i = 0; i < count; i++) queue.push(def.boss);
  }
  return queue;
}

export const FINAL_MVP_WAVE = 10;
