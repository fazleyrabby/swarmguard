/**
 * Player spell balance data. Spells are the player's active layer on top of
 * tower placement: three cooldown-gated casts usable while a wave is running.
 * Data-driven: SpellSystem reads from here, never hard-codes.
 */

export type SpellId = 'meteor' | 'freeze' | 'rally';

export interface SpellDefinition {
  id: SpellId;
  name: string;
  icon: string;
  /** Keyboard shortcut (matched against `KeyboardEvent.key`, lower-cased). */
  hotkey: string;
  description: string;
  /** Seconds between casts. Only ticks while a wave is active. */
  cooldown: number;
  /** Targeted spells need a world position; untargeted ones cast instantly. */
  targeted: boolean;
  /** Effect radius in world px (targeted spells). */
  radius?: number;
  /** Base damage, multiplied by the wave's HP multiplier so it never falls off. */
  damage?: number;
  /** Seconds between cast and impact (meteor fall time). */
  delay?: number;
  /** Effect duration in seconds (freeze / rally). */
  duration?: number;
  /** Fraction of `duration` that applies to bosses (freeze). */
  bossDurationMult?: number;
  /** Attack-speed bonus for every tower while active, 0–1 (rally). */
  attackSpeedBonus?: number;
}

export const SPELLS: Record<SpellId, SpellDefinition> = {
  meteor: {
    id: 'meteor',
    name: 'Meteor',
    icon: '☄️',
    hotkey: 'q',
    description: 'Call down a meteor: heavy damage to everything in the blast.',
    cooldown: 40,
    targeted: true,
    radius: 105,
    damage: 160,
    delay: 0.6,
  },
  freeze: {
    id: 'freeze',
    name: 'Freeze',
    icon: '❄️',
    hotkey: 'w',
    description: 'Freeze enemies in place. Bosses thaw quickly.',
    cooldown: 45,
    targeted: true,
    radius: 190,
    duration: 3.5,
    bossDurationMult: 0.4,
  },
  rally: {
    id: 'rally',
    name: 'Rally',
    icon: '📯',
    hotkey: 'e',
    description: 'Every tower attacks 60% faster for a short burst.',
    cooldown: 60,
    targeted: false,
    duration: 8,
    attackSpeedBonus: 0.6,
  },
};

export const SPELL_IDS = Object.keys(SPELLS) as SpellId[];
