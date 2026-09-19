/**
 * Wave generation facade (spec §15–17, §53–55).
 *
 * Balance data lives in src/config/waves.ts (data-driven, spec §51):
 * - waves 1–10 use the spec §55 table (counts 10…100, hp/speed mults, tiers);
 * - wave 11+ uses the count formula baseCount(10) + floor(wave * growth(9))
 *   with extrapolated multipliers and a slowly growing tank share.
 * Spawn interval shrinks per wave, clamped at a minimum.
 *
 * This module keeps the required `generateWave(waveNumber)` API and adds a
 * seeded queue builder so the order enemies spawn in is deterministic.
 */
import {
  generateWave as configGenerateWave,
  expandSpawnQueue,
  type WaveCompositionEntry,
  type WaveDefinition,
} from '../../config/waves';
import type { EnemyType } from '../../config/enemies';
import { waveSeed } from '../rng';

export type { WaveCompositionEntry, WaveDefinition };

/** Wave definition for a 1-based wave number. Pure. */
export function generateWave(waveNumber: number): WaveDefinition {
  const wave = Math.max(1, Math.floor(waveNumber));
  return configGenerateWave(wave);
}

/**
 * Expand a definition into a deterministic spawn queue.
 * Same (gameSeed, wave) always yields the same order.
 */
export function buildSpawnQueue(
  def: WaveDefinition,
  gameSeed: number,
): EnemyType[] {
  return expandSpawnQueue(def, waveSeed(gameSeed, def.wave));
}
