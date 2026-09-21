/**
 * Economy system (spec §28–29): gold in from kills / wave bonuses,
 * gold out for building / upgrading. Starting gold: 150.
 */
import { ECONOMY } from '../../config/map';
import { generateWave } from '../../config/waves';
import type { Enemy } from '../entities';
import type { EventBus } from '../EventBus';
import type { GameState } from '../GameState';

export const STARTING_GOLD = ECONOMY.startingGold;

export function addGold(
  state: GameState,
  amount: number,
  events?: EventBus,
): void {
  if (amount <= 0) return;
  state.gold += amount;
  events?.emit('gold:changed', state.gold);
}

export function canAfford(state: GameState, cost: number): boolean {
  return state.gold >= cost;
}

/** Spend gold; returns false (no-op) when funds are insufficient. */
export function spendGold(
  state: GameState,
  cost: number,
  events?: EventBus,
): boolean {
  if (cost < 0) return false;
  if (state.gold < cost) return false;
  state.gold -= cost;
  events?.emit('gold:changed', state.gold);
  return true;
}

/** Kill reward comes from the enemy definition (grunt 5 / runner 7 / tank 25). */
export function killRewardFor(enemy: Pick<Enemy, 'reward'>): number {
  return enemy.reward;
}

/** Flat completion bonus, scaling with wave (config-driven). */
export function waveRewardFor(wave: number): number {
  return generateWave(Math.max(1, wave)).completionReward;
}

export function grantWaveReward(
  state: GameState,
  wave: number,
  events?: EventBus,
): number {
  const reward = Math.round(waveRewardFor(wave) * state.mods.waveRewardMult);
  addGold(state, reward, events);
  return reward;
}

/**
 * Frugal reward (spec §94): after a wave, refund a slice of the gold the player
 * had in reserve at wave start. Encourages tight tower placements.
 */
export function grantEfficiencyBonus(state: GameState, events?: EventBus): number {
  const unspent = Math.max(0, state.gold - state.goldAtWaveStart);
  const bonus = Math.min(50, Math.floor(unspent * 0.1));
  if (bonus > 0) {
    addGold(state, bonus, events);
  }
  return bonus;
}
