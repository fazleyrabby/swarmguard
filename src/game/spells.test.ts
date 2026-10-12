import { describe, expect, it } from 'vitest';
import { SPELLS } from '../config/spells';
import { TOWERS } from '../config/towers';
import { Game } from './Game';
import { GameStatus } from './GameState';
import { makeEnemy } from './systems/SpawnSystem';

/** A game mid-wave with the spawn queue emptied, so tests place their own enemies. */
function activeGame(): Game {
  const g = new Game();
  g.startGame();
  g.startWave();
  g.state.spawnQueue = [];
  return g;
}

function addEnemy(g: Game, type: Parameters<typeof makeEnemy>[0], x: number, y: number) {
  const enemy = makeEnemy(type, 1, 1, { x, y });
  g.state.enemies.push(enemy);
  return enemy;
}

describe('spells', () => {
  it('cannot be cast outside an active wave', () => {
    const g = new Game();
    g.startGame();
    expect(g.canCastSpell('meteor')).toBe(false);
    expect(g.castSpell('meteor', 100, 100)).toBe(false);
    expect(g.state.meteors).toHaveLength(0);
  });

  it('go on cooldown when cast and recharge only during a wave', () => {
    const g = activeGame();
    addEnemy(g, 'tank', 800, 450);
    expect(g.castSpell('rally')).toBe(true);
    expect(g.state.spellCooldowns.rally).toBe(SPELLS.rally.cooldown);
    expect(g.castSpell('rally')).toBe(false);

    g.update(1);
    expect(g.state.spellCooldowns.rally).toBeCloseTo(SPELLS.rally.cooldown - 1);

    g.state.status = GameStatus.WAVE_COMPLETE;
    g.update(5);
    expect(g.state.spellCooldowns.rally).toBeCloseTo(SPELLS.rally.cooldown - 1);
  });

  it('meteor lands after its delay and only hits enemies in the blast', () => {
    const g = activeGame();
    const near = addEnemy(g, 'tank', 800, 450);
    const far = addEnemy(g, 'tank', 800 + SPELLS.meteor.radius! + 200, 450);
    const impacts: unknown[] = [];
    g.events.on('spell:impact', (p) => impacts.push(p));

    expect(g.castSpell('meteor', 800, 450)).toBe(true);
    g.update(SPELLS.meteor.delay! / 2);
    expect(near.hp).toBe(near.maxHp);
    expect(impacts).toHaveLength(0);

    g.update(SPELLS.meteor.delay!);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
    expect(impacts).toHaveLength(1);
    expect(g.state.meteors).toHaveLength(0);
  });

  it('meteor damage scales with the wave HP multiplier', () => {
    const g = activeGame();
    g.state.waveHpMult = 3;
    g.castSpell('meteor', 0, 0);
    expect(g.state.meteors[0].damage).toBe(SPELLS.meteor.damage! * 3);
  });

  it('freeze stops enemies in range, and bosses thaw sooner', () => {
    const g = activeGame();
    const grunt = addEnemy(g, 'grunt', 300, 300);
    const boss = addEnemy(g, 'boss', 320, 300);
    const outside = addEnemy(g, 'grunt', 300 + SPELLS.freeze.radius! + 200, 300);
    const start = { x: grunt.x, y: grunt.y };

    expect(g.castSpell('freeze', 300, 300)).toBe(true);
    expect(outside.frozenTimeLeft ?? 0).toBe(0);
    expect(boss.frozenTimeLeft!).toBeLessThan(grunt.frozenTimeLeft!);

    g.update(1);
    expect({ x: grunt.x, y: grunt.y }).toEqual(start);
    expect(outside.distanceTraveled).toBeGreaterThan(0);

    // Thawed enemies walk again.
    g.update(SPELLS.freeze.duration!);
    g.update(1);
    expect(grunt.distanceTraveled).toBeGreaterThan(0);
  });

  it('rally makes towers attack faster while it lasts', () => {
    const shotsIn = (rally: boolean): number => {
      const g = activeGame();
      g.state.gold = 10_000;
      const slot = g.state.buildSlots[0];
      g.buildTower(slot.id, 'crossbow');
      const range = TOWERS.crossbow.levels[0].range;
      const target = addEnemy(g, 'boss', slot.x + range / 2, slot.y);
      target.frozenTimeLeft = 999;
      let shots = 0;
      g.events.on('tower:fired', () => shots++);
      if (rally) g.castSpell('rally');
      for (let i = 0; i < 180; i++) g.update(1 / 30);
      return shots;
    };
    expect(shotsIn(true)).toBeGreaterThan(shotsIn(false));
  });
});

describe('lobbed shots', () => {
  it('land where the target died and still splash enemies there', () => {
    const g = activeGame();
    g.state.gold = 10_000;
    const slot = g.state.buildSlots[0];
    g.buildTower(slot.id, 'cannon');
    const range = TOWERS.cannon.levels[0].range;
    const target = addEnemy(g, 'boss', slot.x + range - 10, slot.y);
    target.frozenTimeLeft = 999;

    for (let i = 0; i < 60 && g.state.projectiles.length === 0; i++) g.update(1 / 60);
    expect(g.state.projectiles).toHaveLength(1);
    const shot = g.state.projectiles[0];
    expect({ x: shot.aimX, y: shot.aimY }).toEqual({ x: target.x, y: target.y });

    // Target dies mid-flight; a bystander stands beside the spot — out of
    // direct contact, inside the splash.
    target.alive = false;
    const bystander = addEnemy(g, 'tank', target.x, target.y + 40);
    bystander.frozenTimeLeft = 999;
    g.state.towers[0].cooldown = 999;
    for (let i = 0; i < 120 && g.state.projectiles.length > 0; i++) g.update(1 / 60);

    expect(g.state.projectiles).toHaveLength(0);
    expect(bystander.hp).toBeLessThan(bystander.maxHp);
  });
});
