/**
 * Seeded RNG (spec §83). Deterministic simulation: same seed → same waves.
 *
 * mulberry32 is small, fast, and good enough for spawn shuffles / variance.
 */
export type Rng = () => number;

/** Create a seeded random function returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a per-wave seed from the game seed so waves are reproducible. */
export function waveSeed(gameSeed: number, wave: number): number {
  return ((gameSeed >>> 0) ^ Math.imul(wave + 1, 0x9e3779b1)) >>> 0 || 1;
}
