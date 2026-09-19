/**
 * Spawn system (spec §17): trickle enemies off a queue on a timer so waves
 * arrive as a swarm, not all at once.
 */
import { ENEMIES, type EnemyType } from '../../config/enemies';
import { DEFAULT_MAP, type Waypoint } from '../../config/maps';
import { nextEnemyId, type Enemy } from '../entities';
import type { GameState } from '../GameState';
import type { WaveDefinition } from './WaveGenerator';

export function initWaveSpawning(
  state: GameState,
  def: WaveDefinition,
  queue: EnemyType[],
): void {
  state.spawnQueue = [...queue];
  state.spawnTimer = 0;
  // Config stores ms; simulation runs in seconds.
  state.spawnIntervalSec = Math.max(0.02, def.spawnInterval / 1000);
  state.waveHpMult = def.healthMultiplier;
  state.waveSpeedMult = def.speedMultiplier;
  state.waveTotalEnemies = def.totalEnemies;
}

/** Build one scaled enemy at the given spawn point. Pure w.r.t. inputs. */
export function makeEnemy(
  type: EnemyType,
  hpMult: number,
  speedMult: number,
  spawn: Waypoint = DEFAULT_MAP.spawn,
): Enemy {
  const def = ENEMIES[type];
  const hp = Math.max(1, Math.round(def.hp * hpMult));
  const shield =
    def.shield !== undefined ? Math.max(1, Math.round(def.shield * hpMult)) : undefined;
  return {
    id: nextEnemyId(),
    type,
    x: spawn.x,
    y: spawn.y,
    hp,
    maxHp: hp,
    speed: def.speed * speedMult,
    damage: def.damage,
    reward: def.reward,
    pathIndex: 0,
    distanceTraveled: 0,
    alive: true,
    shield,
    maxShield: shield,
    regenPerSec: def.regenPerSec,
    auraRadius: def.auraRadius,
    auraSpeedBonus: def.auraSpeedBonus,
    auraMult: 1,
    slowTimeLeft: 0,
    slowFactor: 0,
  };
}

/** Advance the spawn timer and move due enemies into state.enemies. */
export function updateSpawn(state: GameState, delta: number): void {
  if (state.spawnQueue.length === 0) return;
  state.spawnTimer += delta;
  while (
    state.spawnQueue.length > 0 &&
    state.spawnTimer >= state.spawnIntervalSec
  ) {
    state.spawnTimer -= state.spawnIntervalSec;
    const type = state.spawnQueue.shift();
    if (!type) break;
    state.enemies.push(
      makeEnemy(type, state.waveHpMult, state.waveSpeedMult, state.map.spawn),
    );
  }
}
