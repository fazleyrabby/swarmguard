/**
 * Achievements (spec §93): persistent, event-driven unlocks.
 *
 * The store owns localStorage; `AchievementTracker` observes a run and calls
 * `unlock`, returning newly-earned ids so the HUD can toast them. No rendering
 * or DOM here — pure game-side bookkeeping.
 */
import type { GameState } from './GameState';

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: 'first-blood', name: 'First Blood', description: 'Destroy your first enemy.', icon: '🩸' },
  { id: 'boss-slayer', name: 'Boss Slayer', description: 'Take down a Warlord.', icon: '👑' },
  { id: 'maxed', name: 'Fully Equipped', description: 'Upgrade a tower to level 5.', icon: '⭐' },
  { id: 'architect', name: 'Architect', description: 'Have 8 towers built at once.', icon: '🏗️' },
  { id: 'rich', name: 'War Chest', description: 'Earn 2000 gold in a single run.', icon: '💰' },
  { id: 'guardian', name: 'Guardian', description: 'Survive all 10 waves.', icon: '🛡️' },
  { id: 'unbroken', name: 'Unbroken', description: 'Reach wave 15 in endless.', icon: '♾️' },
  { id: 'untouchable', name: 'Untouchable', description: 'Win without your Core taking damage.', icon: '✨' },
  { id: 'explorer', name: 'Explorer', description: 'Play a run on every map.', icon: '🗺️' },
  { id: 'challenger', name: 'Challenger', description: 'Win on a non-standard challenge.', icon: '🔥' },
];

export const ACHIEVEMENTS_KEY = 'swarmguard:achievements';
export const CAREER_KILLS_KEY = 'swarmguard:careerKills';
export const MAPS_PLAYED_KEY = 'swarmguard:mapsPlayed';

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

export class AchievementStore {
  private unlocked = new Set<string>();
  private mapsPlayed = new Set<string>();
  careerKills = 0;

  constructor() {
    const saved = readJson<string[]>(ACHIEVEMENTS_KEY, []);
    for (const id of saved) this.unlocked.add(id);
    const maps = readJson<string[]>(MAPS_PLAYED_KEY, []);
    for (const id of maps) this.mapsPlayed.add(id);
    this.careerKills = readJson<number>(CAREER_KILLS_KEY, 0) || 0;
  }

  has(id: string): boolean {
    return this.unlocked.has(id);
  }

  get unlockedIds(): string[] {
    return [...this.unlocked];
  }

  /** Returns true when newly unlocked (caller toasts + saves). */
  unlock(id: string): boolean {
    if (this.unlocked.has(id)) return false;
    this.unlocked.add(id);
    writeJson(ACHIEVEMENTS_KEY, [...this.unlocked]);
    return true;
  }

  addCareerKills(n: number): void {
    if (n <= 0) return;
    this.careerKills += n;
    writeJson(CAREER_KILLS_KEY, this.careerKills);
  }

  get mapsPlayedCount(): number {
    return this.mapsPlayed.size;
  }

  /** Returns true when this map is newly recorded. */
  recordMap(id: string): boolean {
    if (this.mapsPlayed.has(id)) return false;
    this.mapsPlayed.add(id);
    writeJson(MAPS_PLAYED_KEY, [...this.mapsPlayed]);
    return true;
  }
}

export interface RunContext {
  mapCount: number;
  challengeId: string;
  /** Core HP never dropped this run. */
  untouched: boolean;
}

/**
 * Pure-ish evaluator: call after meaningful events; returns newly earned ids.
 * `state` is the live run; context describes run-wide facts main.ts tracks.
 */
export function evaluateAchievements(
  state: GameState,
  store: AchievementStore,
  context: RunContext,
): string[] {
  const earned: string[] = [];
  const give = (id: string) => {
    if (store.unlock(id)) earned.push(id);
  };

  if (state.totalKills >= 1) give('first-blood');
  if (state.towers.length >= 8) give('architect');
  if (state.towers.some((t) => t.level >= 5)) give('maxed');
  if (state.totalGoldEarned >= 2000) give('rich');
  if (state.wave >= 15) give('unbroken');
  if (store.mapsPlayedCount >= context.mapCount) give('explorer');
  return earned;
}
