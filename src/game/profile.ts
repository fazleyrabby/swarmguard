/**
 * Meta-progression profile (persistent): gems currency, permanent talent
 * ranks, and per-map/challenge star ratings. Pure bookkeeping + localStorage —
 * no DOM, no rendering. main.ts reads `modifiers()` to seed each run and calls
 * `recordRun()` at the end.
 */

/** Permanent bonuses applied to every run, derived from talent ranks. */
export interface RunModifiers {
  /** Extra starting gold. */
  startGoldBonus: number;
  /** Extra Core max HP. */
  coreHpBonus: number;
  /** Multiplier on tower projectile damage. */
  towerDamageMult: number;
  /** Multiplier on tower range. */
  towerRangeMult: number;
  /** Multiplier on build + upgrade gold cost (<1 = discount). */
  upgradeCostMult: number;
  /** Multiplier on end-of-wave gold reward. */
  waveRewardMult: number;
}

export const NEUTRAL_MODIFIERS: RunModifiers = {
  startGoldBonus: 0,
  coreHpBonus: 0,
  towerDamageMult: 1,
  towerRangeMult: 1,
  upgradeCostMult: 1,
  waveRewardMult: 1,
};

/** Gold cost after the Logistics discount (rounded). */
export function applyCost(cost: number, mods: RunModifiers): number {
  return Math.max(0, Math.round(cost * mods.upgradeCostMult));
}

/** Projectile damage after the Sharpness bonus. */
export function applyDamage(damage: number, mods: RunModifiers): number {
  return damage * mods.towerDamageMult;
}

/** Tower range after the Optics bonus. */
export function applyRange(range: number, mods: RunModifiers): number {
  return range * mods.towerRangeMult;
}

export type TalentId =
  | 'warchest'
  | 'fortify'
  | 'sharpness'
  | 'optics'
  | 'logistics'
  | 'bounty';

export interface TalentDefinition {
  id: TalentId;
  name: string;
  icon: string;
  /** One-line description of a single rank's effect. */
  effect: string;
  maxLevel: number;
  /** Cost (in gems) to buy the given 1-based rank. */
  costFor: (rank: number) => number;
}

export const TALENTS: TalentDefinition[] = [
  { id: 'warchest', name: 'War Chest', icon: '💰', effect: '+25 starting gold per rank', maxLevel: 4, costFor: (r) => 40 * r },
  { id: 'fortify', name: 'Fortify', icon: '🛡️', effect: '+10 Core HP per rank', maxLevel: 4, costFor: (r) => 50 * r },
  { id: 'sharpness', name: 'Sharpness', icon: '⚔️', effect: '+5% tower damage per rank', maxLevel: 5, costFor: (r) => 60 * r },
  { id: 'optics', name: 'Optics', icon: '🎯', effect: '+4% tower range per rank', maxLevel: 5, costFor: (r) => 55 * r },
  { id: 'logistics', name: 'Logistics', icon: '📦', effect: '−4% build & upgrade cost per rank', maxLevel: 5, costFor: (r) => 70 * r },
  { id: 'bounty', name: 'Bounty', icon: '🏆', effect: '+10% wave reward per rank', maxLevel: 4, costFor: (r) => 50 * r },
];

export const PROFILE_KEY = 'swarmguard:profile';
export const MAX_STARS = 3;

interface ProfileData {
  currency: number;
  talents: Partial<Record<TalentId, number>>;
  /** Star rating keyed by `${mapId}:${challengeId}`. */
  stars: Record<string, number>;
}

export function starKey(mapId: string, challengeId: string): string {
  return `${mapId}:${challengeId}`;
}

/** Result of a finished run, used to compute stars + gem payout. */
export interface RunResult {
  mapId: string;
  challengeId: string;
  /** Survived the full wave list (never true in Endless). */
  victory: boolean;
  wavesSurvived: number;
  baseHp: number;
  baseMaxHp: number;
  endless: boolean;
}

/**
 * Stars for a finished run:
 *  - Standard: 1 = win, 2 = win holding ≥50% Core, 3 = win untouched.
 *  - Endless: 1 = wave 10, 2 = wave 15, 3 = wave 20.
 */
export function computeStars(r: RunResult): number {
  if (r.endless) {
    if (r.wavesSurvived >= 20) return 3;
    if (r.wavesSurvived >= 15) return 2;
    if (r.wavesSurvived >= 10) return 1;
    return 0;
  }
  if (!r.victory) return 0;
  const frac = r.baseMaxHp > 0 ? r.baseHp / r.baseMaxHp : 0;
  if (frac >= 1) return 3;
  if (frac >= 0.5) return 2;
  return 1;
}

/** Gems earned by a finished run (before first-clear bonus). */
export function runGemReward(r: RunResult, stars: number): number {
  const base = stars * 40 + r.wavesSurvived * 4 + (r.victory ? 30 : 0);
  return Math.max(0, Math.round(base));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — keep in memory only */
  }
}

export class Profile {
  private currency = 0;
  private talents: Partial<Record<TalentId, number>> = {};
  private stars: Record<string, number> = {};

  constructor() {
    const data = readJson<Partial<ProfileData>>(PROFILE_KEY, {});
    this.currency = Math.max(0, Math.floor(data.currency ?? 0));
    this.talents = { ...(data.talents ?? {}) };
    this.stars = { ...(data.stars ?? {}) };
  }

  get gems(): number {
    return this.currency;
  }

  // ------------------------------------------------------------- talents

  level(id: TalentId): number {
    return this.talents[id] ?? 0;
  }

  /** Cost of the next rank, or undefined when maxed. */
  nextCost(id: TalentId): number | undefined {
    const def = TALENTS.find((t) => t.id === id);
    if (!def) return undefined;
    const lvl = this.level(id);
    if (lvl >= def.maxLevel) return undefined;
    return def.costFor(lvl + 1);
  }

  canBuy(id: TalentId): boolean {
    const cost = this.nextCost(id);
    return cost !== undefined && this.currency >= cost;
  }

  /** Buy the next rank. Returns true when purchased. */
  buy(id: TalentId): boolean {
    const cost = this.nextCost(id);
    if (cost === undefined || this.currency < cost) return false;
    this.currency -= cost;
    this.talents[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  addGems(n: number): void {
    if (n <= 0) return;
    this.currency += Math.round(n);
    this.save();
  }

  /** Permanent bonuses for a fresh run. */
  modifiers(): RunModifiers {
    return {
      startGoldBonus: this.level('warchest') * 25,
      coreHpBonus: this.level('fortify') * 10,
      towerDamageMult: 1 + this.level('sharpness') * 0.05,
      towerRangeMult: 1 + this.level('optics') * 0.04,
      upgradeCostMult: Math.max(0.5, 1 - this.level('logistics') * 0.04),
      waveRewardMult: 1 + this.level('bounty') * 0.1,
    };
  }

  // --------------------------------------------------------------- stars

  starsFor(mapId: string, challengeId: string): number {
    return this.stars[starKey(mapId, challengeId)] ?? 0;
  }

  /** Best stars earned for a map across every challenge. */
  bestStarsForMap(mapId: string): number {
    let best = 0;
    for (const [key, val] of Object.entries(this.stars)) {
      if (key.startsWith(`${mapId}:`)) best = Math.max(best, val);
    }
    return best;
  }

  get totalStars(): number {
    let sum = 0;
    for (const val of Object.values(this.stars)) sum += val;
    return sum;
  }

  /** Record a run's stars, keeping the best. Returns the previous best. */
  recordStars(mapId: string, challengeId: string, stars: number): number {
    const key = starKey(mapId, challengeId);
    const prev = this.stars[key] ?? 0;
    if (stars > prev) {
      this.stars[key] = stars;
      this.save();
    }
    return prev;
  }

  private save(): void {
    const data: ProfileData = {
      currency: this.currency,
      talents: this.talents,
      stars: this.stars,
    };
    writeJson(PROFILE_KEY, data);
  }
}
