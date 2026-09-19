/**
 * Map definitions (spec §51, §93 — "Multiple Maps" evolution).
 *
 * Every map shares the 1600x900 world so the camera/renderer stay constant,
 * but differs in path shape, build-slot layout and visual theme. The sim
 * reads geometry from `GameState.map`; the renderer reads the same object.
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

export interface MapTheme {
  /** Oversized backdrop beyond the playfield (letterbox bars). */
  backdrop: number;
  /** Playfield ground fill. */
  ground: number;
  dotA: number;
  dotB: number;
  patchA: number;
  patchB: number;
  tuftA: number;
  tuftB: number;
  /** Dark outline under the path. */
  pathEdge: number;
  /** Path border. */
  pathBorder: number;
  /** Path surface. */
  pathFill: number;
  pebble: number;
  frame: number;
}

export interface MapDefinition {
  id: string;
  name: string;
  description: string;
  world: { width: number; height: number };
  path: Waypoint[];
  base: { x: number; y: number; radius: number };
  spawn: Waypoint;
  buildSlots: BuildSlotConfig[];
  startingGold: number;
  baseHp: number;
  theme: MapTheme;
}

export const WORLD = { width: 1600, height: 900 } as const;

export const ECONOMY = {
  startingGold: 200,
  baseMaxHp: 100,
  baseHp: 100,
} as const;

const MEADOW_THEME: MapTheme = {
  backdrop: 0x77bd4e,
  ground: 0x8fd45e,
  dotA: 0x7cc24e,
  dotB: 0xa5e56f,
  patchA: 0x86cc54,
  patchB: 0x9bdc66,
  tuftA: 0x4e9e3a,
  tuftB: 0x63b84a,
  pathEdge: 0x3f6b28,
  pathBorder: 0xb07a4a,
  pathFill: 0xe3b877,
  pebble: 0xd1945a,
  frame: 0x5da33a,
};

const CANYON_THEME: MapTheme = {
  backdrop: 0xd9ad63,
  ground: 0xe8c684,
  dotA: 0xdcb46a,
  dotB: 0xf2d79b,
  patchA: 0xdfba74,
  patchB: 0xf0d497,
  tuftA: 0xbd8f45,
  tuftB: 0xd6a95c,
  pathEdge: 0x8a5a2b,
  pathBorder: 0xa9702f,
  pathFill: 0xd9a865,
  pebble: 0xb5793f,
  frame: 0xb98b4a,
};

const FROZEN_THEME: MapTheme = {
  backdrop: 0xd7e9f7,
  ground: 0xeaf5ff,
  dotA: 0xd5e7f5,
  dotB: 0xffffff,
  patchA: 0xdfeefb,
  patchB: 0xf4fbff,
  tuftA: 0xaac9de,
  tuftB: 0xc7ddec,
  pathEdge: 0x9db8cc,
  pathBorder: 0x8fa9c0,
  pathFill: 0xcfe0ee,
  pebble: 0xb8cfe0,
  frame: 0x9db8cc,
};

/** Meadow Vale — the original single-map layout. */
const MEADOW_VALE: MapDefinition = {
  id: 'meadow',
  name: 'Meadow Vale',
  description: 'Open fields and a single winding lane. The classic start.',
  world: { ...WORLD },
  path: [
    { x: 100, y: 200 },
    { x: 350, y: 200 },
    { x: 350, y: 450 },
    { x: 700, y: 450 },
    { x: 700, y: 650 },
    { x: 1200, y: 650 },
  ],
  base: { x: 1350, y: 650, radius: 60 },
  spawn: { x: 100, y: 120 },
  buildSlots: [
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
  ],
  startingGold: ECONOMY.startingGold,
  baseHp: ECONOMY.baseMaxHp,
  theme: MEADOW_THEME,
};

/** Serpent Canyon — a long zigzag with more corners to cover. */
const SERPENT_CANYON: MapDefinition = {
  id: 'canyon',
  name: 'Serpent Canyon',
  description: 'A long switchback. Many corners, many firing angles.',
  world: { ...WORLD },
  path: [
    { x: 110, y: 130 },
    { x: 110, y: 430 },
    { x: 400, y: 430 },
    { x: 400, y: 170 },
    { x: 740, y: 170 },
    { x: 740, y: 720 },
    { x: 1080, y: 720 },
    { x: 1080, y: 360 },
    { x: 1470, y: 360 },
    { x: 1470, y: 700 },
  ],
  base: { x: 1470, y: 700, radius: 60 },
  spawn: { x: 110, y: 130 },
  buildSlots: [
    { id: 'slot-1', x: 250, y: 280 },
    { id: 'slot-2', x: 250, y: 560 },
    { id: 'slot-3', x: 550, y: 300 },
    { id: 'slot-4', x: 550, y: 560 },
    { id: 'slot-5', x: 550, y: 830 },
    { id: 'slot-6', x: 900, y: 300 },
    { id: 'slot-7', x: 900, y: 560 },
    { id: 'slot-8', x: 900, y: 830 },
    { id: 'slot-9', x: 1250, y: 220 },
    { id: 'slot-10', x: 1250, y: 520 },
    { id: 'slot-11', x: 1250, y: 830 },
    { id: 'slot-12', x: 1380, y: 220 },
    { id: 'slot-13', x: 160, y: 560 },
  ],
  startingGold: ECONOMY.startingGold,
  baseHp: ECONOMY.baseMaxHp,
  theme: CANYON_THEME,
};

/** Frozen Pass — a snowy switchback with tighter build space. */
const FROZEN_PASS: MapDefinition = {
  id: 'frozen',
  name: 'Frozen Pass',
  description: 'A cold, twisting pass. Tighter build space, longer route.',
  world: { ...WORLD },
  path: [
    { x: 110, y: 780 },
    { x: 110, y: 480 },
    { x: 430, y: 480 },
    { x: 430, y: 780 },
    { x: 780, y: 780 },
    { x: 780, y: 180 },
    { x: 1130, y: 180 },
    { x: 1130, y: 640 },
    { x: 1470, y: 640 },
  ],
  base: { x: 1470, y: 640, radius: 60 },
  spawn: { x: 110, y: 780 },
  buildSlots: [
    { id: 'slot-1', x: 270, y: 320 },
    { id: 'slot-2', x: 270, y: 630 },
    { id: 'slot-3', x: 600, y: 320 },
    { id: 'slot-4', x: 600, y: 630 },
    { id: 'slot-5', x: 950, y: 320 },
    { id: 'slot-6', x: 950, y: 500 },
    { id: 'slot-7', x: 950, y: 760 },
    { id: 'slot-8', x: 1300, y: 400 },
    { id: 'slot-9', x: 1300, y: 780 },
  ],
  startingGold: ECONOMY.startingGold,
  baseHp: ECONOMY.baseMaxHp,
  theme: FROZEN_THEME,
};

export const MAPS: MapDefinition[] = [MEADOW_VALE, SERPENT_CANYON, FROZEN_PASS];
export const DEFAULT_MAP = MEADOW_VALE;

export function getMap(id: string): MapDefinition {
  return MAPS.find((m) => m.id === id) ?? DEFAULT_MAP;
}
