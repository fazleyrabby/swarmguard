/**
 * Spell system: the player's active abilities (meteor / freeze / rally).
 * Cooldowns only tick while a wave is active, so idling between waves never
 * banks free casts. Pending meteors and the rally timer keep running until
 * they resolve, even if the wave ends mid-flight.
 */
import { ENEMIES, isBossType } from '../../config/enemies';
import { SPELLS, SPELL_IDS, type SpellId } from '../../config/spells';
import { nextMeteorId } from '../entities';
import type { EventBus } from '../EventBus';
import { GameStatus, type GameState } from '../GameState';
import { damageEnemy } from './CombatSystem';

export function spellReady(state: GameState, id: SpellId): boolean {
  return state.status === GameStatus.WAVE_ACTIVE && state.spellCooldowns[id] <= 0;
}

/**
 * Cast a spell at a world position (ignored by untargeted spells).
 * Returns false when it is on cooldown or no wave is running.
 */
export function castSpell(
  state: GameState,
  id: SpellId,
  x: number,
  y: number,
  events: EventBus,
): boolean {
  if (!spellReady(state, id)) return false;
  const def = SPELLS[id];
  state.spellCooldowns[id] = def.cooldown;

  if (id === 'meteor') {
    const delay = def.delay ?? 0;
    state.meteors.push({
      id: nextMeteorId(),
      x,
      y,
      delay,
      timeLeft: delay,
      damage: (def.damage ?? 0) * state.waveHpMult,
      radius: def.radius ?? 0,
    });
  } else if (id === 'freeze') {
    const radius = def.radius ?? 0;
    const duration = def.duration ?? 0;
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const reach = radius + ENEMIES[enemy.type].radius;
      if ((enemy.x - x) ** 2 + (enemy.y - y) ** 2 > reach * reach) continue;
      const time = isBossType(enemy.type) ? duration * (def.bossDurationMult ?? 1) : duration;
      enemy.frozenTimeLeft = Math.max(enemy.frozenTimeLeft ?? 0, time);
    }
  } else {
    state.rallyTimeLeft = def.duration ?? 0;
  }

  events.emit('spell:cast', { id, x, y, radius: def.radius ?? 0 });
  return true;
}

export function updateSpells(state: GameState, delta: number, events: EventBus): void {
  if (state.status === GameStatus.WAVE_ACTIVE) {
    for (const id of SPELL_IDS) {
      if (state.spellCooldowns[id] > 0) {
        state.spellCooldowns[id] = Math.max(0, state.spellCooldowns[id] - delta);
      }
    }
  }

  if (state.rallyTimeLeft > 0) state.rallyTimeLeft = Math.max(0, state.rallyTimeLeft - delta);

  if (state.meteors.length === 0) return;
  for (const meteor of state.meteors) {
    meteor.timeLeft -= delta;
    if (meteor.timeLeft > 0) continue;
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const reach = meteor.radius + ENEMIES[enemy.type].radius;
      if ((enemy.x - meteor.x) ** 2 + (enemy.y - meteor.y) ** 2 <= reach * reach) {
        damageEnemy(state, enemy, meteor.damage, events);
      }
    }
    events.emit('spell:impact', { id: 'meteor', x: meteor.x, y: meteor.y, radius: meteor.radius });
  }
  state.meteors = state.meteors.filter((meteor) => meteor.timeLeft > 0);
}
