/**
 * Backwards-compatible view of the default map.
 *
 * Map data now lives in `src/config/maps.ts` (multiple maps). This module
 * re-exports the default map's geometry and the shared economy constants so
 * existing imports keep working. Prefer reading `GameState.map` / passing a
 * `MapDefinition` around in new code.
 */
import { DEFAULT_MAP, ECONOMY, WORLD } from './maps';

export type { Waypoint, BuildSlotConfig, MapDefinition, MapTheme } from './maps';
export { DEFAULT_MAP, ECONOMY, WORLD, getMap, MAPS } from './maps';

export const PATH = DEFAULT_MAP.path;
export const BUILD_SLOTS = DEFAULT_MAP.buildSlots;
export const SPAWN = DEFAULT_MAP.spawn;
export const BASE = {
  x: DEFAULT_MAP.base.x,
  y: DEFAULT_MAP.base.y,
  radius: DEFAULT_MAP.base.radius,
  maxHp: ECONOMY.baseMaxHp,
} as const;
