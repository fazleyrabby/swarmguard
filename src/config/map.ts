/**
 * Map / economy balance data (spec §8, §10–12, §28).
 * World is 1600x900 and resolution-independent; renderer scales to viewport.
 */

export interface Waypoint {
  x: number;
  y: number;
}

export interface BuildSlotConfig {
  id: string;
  x: number;
  y: number;
}

export const WORLD = {
  width: 1600,
  height: 900,
} as const;

export const ECONOMY = {
  startingGold: 200,
  baseMaxHp: 100,
  baseHp: 100,
} as const;

/** Enemy path waypoints (spec §10). */
export const PATH: Waypoint[] = [
  { x: 100, y: 200 },
  { x: 350, y: 200 },
  { x: 350, y: 450 },
  { x: 700, y: 450 },
  { x: 700, y: 650 },
  { x: 1200, y: 650 },
];

/** Base / core position at the end of the path. */
export const BASE = {
  x: 1350,
  y: 650,
  radius: 60,
  maxHp: ECONOMY.baseMaxHp,
} as const;

/** Enemy spawn point (start of path). */
export const SPAWN = { x: 100, y: 120 } as const;

/**
 * Predefined build slots near (but not on) the path (spec §11).
 * Agents implementing Map/BuildSlot systems should use these ids/positions.
 */
export const BUILD_SLOTS: BuildSlotConfig[] = [
  { id: 'slot-1', x: 220, y: 120 },
  { id: 'slot-2', x: 220, y: 290 },
  { id: 'slot-3', x: 460, y: 300 },
  { id: 'slot-4', x: 460, y: 540 },
  { id: 'slot-5', x: 580, y: 360 },
  { id: 'slot-6', x: 810, y: 540 },
  { id: 'slot-7', x: 810, y: 740 },
  { id: 'slot-8', x: 1000, y: 560 },
  { id: 'slot-9', x: 1080, y: 740 },
  { id: 'slot-10', x: 1160, y: 545 },
];
