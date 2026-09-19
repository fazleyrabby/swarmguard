/**
 * Game orchestrator (spec §32–34, §36, §49, §56, §69).
 *
 * Owns GameState + EventBus + RNG + projectile pool, ticks every system in
 * spec §49 order each update(), and exposes build / upgrade / wave / pause /
 * speed controls plus best-wave persistence (localStorage).
 *
 * No rendering here — the PixiJS layer observes state + events separately.
 */
import { TOWERS, type TowerId } from '../config/towers';
import { DEFAULT_MAP, type MapDefinition } from '../config/maps';
import { DEFAULT_CHALLENGE, type ChallengeDefinition } from '../config/challenges';
import { FINAL_MVP_WAVE } from '../config/waves';
import {
  DEFAULT_TARGETING,
  nextTowerId,
  type TargetingMode,
  type Tower,
} from './entities';
import { EventBus } from './EventBus';
import { GameStatus, createInitialState, isGameOver, type GameState } from './GameState';
import { mulberry32, type Rng } from './rng';
import { applyProjectileHit, updateCombat } from './systems/CombatSystem';
import {
  addGold,
  canAfford,
  grantWaveReward,
  spendGold,
} from './systems/EconomySystem';
import { updateMovement } from './systems/MovementSystem';
import { ProjectilePool, updateProjectiles } from './systems/ProjectileSystem';
import { initWaveSpawning, updateSpawn } from './systems/SpawnSystem';
import { updateTargets } from './systems/TargetingSystem';
import {
  applyUpgrade,
  buildCostFor,
  isMaxLevel,
  sellRefundFor,
  upgradeCostFor,
} from './systems/UpgradeSystem';
import { buildSpawnQueue, generateWave } from './systems/WaveGenerator';

/**
 * Default targeting per tower type.
 * Spec §20 gives crossbow "nearest"; system default is "first" (spec §24).
 */
const TOWER_DEFAULT_TARGETING: Record<TowerId, TargetingMode> = {
  crossbow: 'nearest',
  cannon: 'first',
  bomb: 'first',
  frost: 'first',
  sniper: 'strongest',
};
export const BEST_WAVE_KEY = 'swarmguard:highestWave';
export const VICTORY_WAVE = FINAL_MVP_WAVE;
export type SpeedSetting = 1 | 2 | 3;

function readBestWave(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    return Number(localStorage.getItem(BEST_WAVE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export class Game {
  readonly state: GameState;
  readonly events = new EventBus();
  readonly pool = new ProjectilePool();
  readonly rng: Rng;
  bestWave: number;

  constructor(
    seed = 1337,
    map: MapDefinition = DEFAULT_MAP,
    challenge: ChallengeDefinition = DEFAULT_CHALLENGE,
  ) {
    this.state = createInitialState(seed, map, challenge);
    this.rng = mulberry32(seed);
    this.bestWave = readBestWave();
  }

  /**
   * Start a fresh run on the given map/challenge, reusing this instance so all
   * views, panels and event subscriptions stay wired. Resets to MENU.
   */
  newRun(
    map: MapDefinition,
    challenge: ChallengeDefinition = this.state.challenge,
    seed = this.state.seed,
  ): void {
    Object.assign(this.state, createInitialState(seed, map, challenge));
  }

  // ---- lifecycle ----

  /** MENU → PREPARATION: player may now build, then start wave 1. */
  startGame(): void {
    if (this.state.status !== GameStatus.MENU) return;
    this.state.status = GameStatus.PREPARATION;
  }

  /**
   * Begin the next wave. Allowed from PREPARATION / WAVE_COMPLETE.
   * Returns false when a wave cannot start from the current status.
   */
  startWave(): boolean {
    const s = this.state;
    if (s.status !== GameStatus.PREPARATION && s.status !== GameStatus.WAVE_COMPLETE) {
      return false;
    }
    const def = generateWave(s.wave + 1);
    const ch = s.challenge;
    if (ch.enemyCountMult && ch.enemyCountMult !== 1) {
      def.totalEnemies = Math.max(1, Math.round(def.totalEnemies * ch.enemyCountMult));
    }
    s.wave = def.wave;
    s.killsThisWave = 0;
    s.goldThisWave = 0;
    initWaveSpawning(s, def, buildSpawnQueue(def, s.seed));
    if (ch.enemyHpMult) s.waveHpMult *= ch.enemyHpMult;
    if (ch.enemySpeedMult) s.waveSpeedMult *= ch.enemySpeedMult;
    s.status = GameStatus.WAVE_ACTIVE;
    this.events.emit('wave:started', def);
    return true;
  }

  /**
   * Single deterministic-ish tick (spec §49 order):
   * spawn → movement → targeting → combat → projectiles → wave check.
   * @param delta real seconds since last tick (scaled by speedMultiplier).
   */
  update(delta: number): void {
    const s = this.state;
    if (
      s.status === GameStatus.PAUSED ||
      s.status === GameStatus.MENU ||
      s.status === GameStatus.GAME_OVER ||
      s.status === GameStatus.VICTORY
    ) {
      return;
    }
    const dt = Math.max(0, delta) * s.speedMultiplier;
    if (dt === 0) return;
    s.time += dt;

    updateSpawn(s, dt);
    updateMovement(s, dt, this.events);
    if (isGameOver(s)) {
      this.saveBestWave();
      return;
    }
    updateTargets(s);
    updateCombat(s, dt, this.events, this.pool);
    updateProjectiles(s, dt, this.pool, (projectile, hit) =>
      applyProjectileHit(s, projectile, hit, this.events),
    );
    if (isGameOver(s)) {
      this.saveBestWave();
      return;
    }

    // Sweep the dead (logic-only pooling: objects are simply dropped).
    if (s.enemies.some((e) => !e.alive)) {
      s.enemies = s.enemies.filter((e) => e.alive);
    }

    this.checkWaveComplete();
  }

  private checkWaveComplete(): void {
    const s = this.state;
    if (s.status !== GameStatus.WAVE_ACTIVE) return;
    if (s.spawnQueue.length > 0) return;
    if (s.enemies.some((e) => e.alive)) return;

    const reward = grantWaveReward(s, s.wave, this.events);
    this.events.emit('wave:completed', {
      wave: s.wave,
      kills: s.killsThisWave,
      goldEarned: s.goldThisWave,
      reward,
    });

    if (s.wave >= VICTORY_WAVE && s.challenge.id !== 'endless') {
      s.status = GameStatus.VICTORY;
      this.saveBestWave();
      this.events.emit('victory', {
        wavesSurvived: s.wave,
        kills: s.totalKills,
        goldEarned: s.totalGoldEarned,
      });
    } else {
      s.status = GameStatus.WAVE_COMPLETE;
      this.saveBestWave();
    }
  }

  // ---- player actions ----

  /** Build a tower on an empty slot. Returns the tower or undefined. */
  buildTower(slotId: string, towerType: TowerId): Tower | undefined {
    const s = this.state;
    const slot = s.buildSlots.find((b) => b.id === slotId);
    if (!slot || slot.occupied) return undefined;
    const def = TOWERS[towerType];
    if (!def) return undefined;
    if (!canAfford(s, def.cost)) return undefined;
    spendGold(s, def.cost, this.events);

    const tower: Tower = {
      id: nextTowerId(),
      type: towerType,
      x: slot.x,
      y: slot.y,
      level: 1,
      cooldown: 0,
      targeting: TOWER_DEFAULT_TARGETING[towerType] ?? DEFAULT_TARGETING,
      targetId: undefined,
      angle: 0,
    };
    s.towers.push(tower);
    slot.occupied = true;
    slot.towerId = tower.id;
    this.events.emit('tower:built', tower);
    return tower;
  }

  /** Upgrade a tower one level. False when maxed / broke / missing. */
  upgradeTower(towerId: string): boolean {
    const s = this.state;
    const tower = s.towers.find((t) => t.id === towerId);
    if (!tower || isMaxLevel(tower.type, tower.level)) return false;
    const cost = upgradeCostFor(tower.type, tower.level);
    if (cost === undefined || !canAfford(s, cost)) return false;
    spendGold(s, cost, this.events);
    applyUpgrade(tower);
    this.events.emit('tower:upgraded', tower);
    return true;
  }

  buildCost(type: TowerId): number {
    return buildCostFor(type);
  }

  /** Sell a tower for 70% refund. Frees its build slot. Returns refund or 0. */
  sellTower(towerId: string): number {
    const s = this.state;
    const idx = s.towers.findIndex((t) => t.id === towerId);
    if (idx === -1) return 0;
    const tower = s.towers[idx];
    const refund = sellRefundFor(tower.type, tower.level);
    s.towers.splice(idx, 1);
    const slot = s.buildSlots.find((b) => b.towerId === towerId);
    if (slot) {
      slot.occupied = false;
      slot.towerId = undefined;
    }
    if (s.selectedTowerId === towerId) s.selectedTowerId = undefined;
    addGold(s, refund, this.events);
    this.events.emit('tower:sold', { ...tower, refund });
    return refund;
  }

  // ---- pause / speed (spec §36) ----

  pause(): void {
    const s = this.state;
    if (s.status === GameStatus.PAUSED) return;
    if (
      s.status === GameStatus.WAVE_ACTIVE ||
      s.status === GameStatus.PREPARATION ||
      s.status === GameStatus.WAVE_COMPLETE
    ) {
      s.prevStatus = s.status;
      s.status = GameStatus.PAUSED;
    }
  }

  resume(): void {
    const s = this.state;
    if (s.status !== GameStatus.PAUSED) return;
    s.status = s.prevStatus ?? GameStatus.PREPARATION;
    s.prevStatus = undefined;
  }

  setSpeed(speed: SpeedSetting): void {
    this.state.speedMultiplier = speed;
  }

  // ---- persistence (spec §69) ----

  saveBestWave(): void {
    // Best wave = highest wave reached, persisted across runs (spec §69).
    if (this.state.wave > this.bestWave) {
      this.bestWave = this.state.wave;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(BEST_WAVE_KEY, String(this.bestWave));
        }
      } catch {
        // Storage unavailable (SSR/tests) — bestWave still held in memory.
      }
    }
  }
}
