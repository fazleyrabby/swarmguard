/**
 * Central game state (spec §77) + initial-state factory.
 * Plain data — systems mutate it, renderer/UI observe it.
 */
import { DEFAULT_MAP, type MapDefinition } from '../config/maps';
import type { BuildSlot, Enemy, Projectile, Tower } from './entities';
import { resetEntityIds } from './entities';
import type { EnemyType } from '../config/enemies';

export enum GameStatus {
  MENU = 'MENU',
  PREPARATION = 'PREPARATION',
  WAVE_ACTIVE = 'WAVE_ACTIVE',
  WAVE_COMPLETE = 'WAVE_COMPLETE',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY',
  PAUSED = 'PAUSED',
}

export interface GameState {
  status: GameStatus;
  /** Active map definition (geometry + economy). */
  map: MapDefinition;
  /** Status to restore on resume() after a pause. */
  prevStatus?: GameStatus;
  wave: number;
  gold: number;
  baseHp: number;
  baseMaxHp: number;
  enemies: Enemy[];
  towers: Tower[];
  projectiles: Projectile[];
  buildSlots: BuildSlot[];
  selectedTowerId?: string;
  /** Game-speed multiplier: 1 | 2 | 3 (spec §36). 0/paused is modelled via status. */
  speedMultiplier: number;
  // --- active-wave spawn state (spec §17) ---
  /** Pending spawn queue (front = next to spawn). */
  spawnQueue: EnemyType[];
  /** Seconds since the last spawn. */
  spawnTimer: number;
  /** Seconds between spawns for the active wave. */
  spawnIntervalSec: number;
  /** Difficulty multipliers snapshot for the active wave. */
  waveHpMult: number;
  waveSpeedMult: number;
  waveTotalEnemies: number;
  // --- stats ---
  killsThisWave: number;
  goldThisWave: number;
  totalKills: number;
  totalGoldEarned: number;
  /** Simulated seconds elapsed (already speed-scaled). */
  time: number;
  /** Seed for deterministic wave generation. */
  seed: number;
}

/** Narrowing-safe game-over check (status is mutated by systems). */
export function isGameOver(state: GameState): boolean {
  return state.status === GameStatus.GAME_OVER;
}

export function createInitialState(
  seed = 1337,
  map: MapDefinition = DEFAULT_MAP,
): GameState {
  resetEntityIds();
  return {
    status: GameStatus.MENU,
    map,
    wave: 0,
    gold: map.startingGold,
    baseHp: map.baseHp,
    baseMaxHp: map.baseHp,
    enemies: [],
    towers: [],
    projectiles: [],
    buildSlots: map.buildSlots.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      occupied: false,
    })),
    selectedTowerId: undefined,
    speedMultiplier: 1,
    spawnQueue: [],
    spawnTimer: 0,
    spawnIntervalSec: 0.15,
    waveHpMult: 1,
    waveSpeedMult: 1,
    waveTotalEnemies: 0,
    killsThisWave: 0,
    goldThisWave: 0,
    totalKills: 0,
    totalGoldEarned: 0,
    time: 0,
    seed,
  };
}
