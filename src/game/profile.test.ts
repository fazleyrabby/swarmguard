import { describe, expect, it } from 'vitest';
import {
  MAX_STARS,
  NEUTRAL_MODIFIERS,
  applyCost,
  applyDamage,
  applyRange,
  computeStars,
  runGemReward,
  type RunResult,
} from './profile';

function run(partial: Partial<RunResult>): RunResult {
  return {
    mapId: 'meadow',
    challengeId: 'standard',
    victory: false,
    wavesSurvived: 0,
    baseHp: 100,
    baseMaxHp: 100,
    endless: false,
    ...partial,
  };
}

describe('computeStars', () => {
  it('gives 0 for a lost standard run', () => {
    expect(computeStars(run({ victory: false, wavesSurvived: 5, baseHp: 0 }))).toBe(0);
  });

  it('rates a standard win by remaining Core HP', () => {
    expect(computeStars(run({ victory: true, baseHp: 100, baseMaxHp: 100 }))).toBe(3);
    expect(computeStars(run({ victory: true, baseHp: 60, baseMaxHp: 100 }))).toBe(2);
    expect(computeStars(run({ victory: true, baseHp: 20, baseMaxHp: 100 }))).toBe(1);
  });

  it('rates endless runs by waves survived', () => {
    expect(computeStars(run({ endless: true, wavesSurvived: 9 }))).toBe(0);
    expect(computeStars(run({ endless: true, wavesSurvived: 10 }))).toBe(1);
    expect(computeStars(run({ endless: true, wavesSurvived: 15 }))).toBe(2);
    expect(computeStars(run({ endless: true, wavesSurvived: 22 }))).toBe(3);
  });

  it('never exceeds MAX_STARS', () => {
    expect(computeStars(run({ victory: true }))).toBeLessThanOrEqual(MAX_STARS);
  });
});

describe('runGemReward', () => {
  it('scales with stars and waves, plus a win bonus', () => {
    expect(runGemReward(run({ wavesSurvived: 10, victory: true }), 3)).toBe(190);
    expect(runGemReward(run({ wavesSurvived: 10, victory: false }), 0)).toBe(40);
    expect(runGemReward(run({ wavesSurvived: 0, victory: false }), 0)).toBe(0);
  });
});

describe('talent modifiers', () => {
  it('leaves values untouched when neutral', () => {
    expect(applyCost(100, NEUTRAL_MODIFIERS)).toBe(100);
    expect(applyDamage(100, NEUTRAL_MODIFIERS)).toBe(100);
    expect(applyRange(100, NEUTRAL_MODIFIERS)).toBe(100);
  });

  it('applies discounts, damage and range multipliers', () => {
    const mods = { ...NEUTRAL_MODIFIERS, upgradeCostMult: 0.8, towerDamageMult: 1.5, towerRangeMult: 1.1 };
    expect(applyCost(50, mods)).toBe(40);
    expect(applyDamage(100, mods)).toBe(150);
    expect(applyRange(100, mods)).toBeCloseTo(110);
  });
});
