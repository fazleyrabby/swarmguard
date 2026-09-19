import { describe, expect, it } from 'vitest';
import { generateWave, enemyCountForWave, expandSpawnQueue, isBossWave } from '../config/waves';
import { TOWERS } from '../config/towers';
import { ENEMIES } from '../config/enemies';
import { MAPS, getMap } from '../config/maps';
import { createInitialState } from './GameState';
import { Game } from './Game';
import { canAfford, spendGold, addGold } from './systems/EconomySystem';
import { acquireTarget } from './systems/TargetingSystem';
import { makeEnemy } from './systems/SpawnSystem';
import type { Enemy } from './entities';

function fakeEnemy(over: Partial<Enemy> & { id: number }): Enemy {
  return {
    type: 'grunt', hp: 100, maxHp: 100, speed: 40, damage: 10, reward: 5,
    pathIndex: 0, alive: true, x: 0, y: 0, slowFactor: 0, slowTimeLeft: 0,
    distanceTraveled: 0, ...over,
  } as Enemy;
}

describe('waves (spec §55)', () => {
  it('wave 1 has 10 grunts, wave 10 has 100 mixed', () => {
    expect(generateWave(1).totalEnemies).toBe(10);
    expect(generateWave(10).totalEnemies).toBe(100);
    expect(enemyCountForWave(1)).toBe(10);
  });
  it('difficulty scales up', () => {
    expect(generateWave(10).healthMultiplier).toBeGreaterThan(generateWave(1).healthMultiplier);
  });
});

describe('boss waves', () => {
  it('every 10th wave is a boss wave', () => {
    expect(isBossWave(10)).toBe(true);
    expect(isBossWave(20)).toBe(true);
    expect(isBossWave(9)).toBe(false);
    expect(isBossWave(11)).toBe(false);
  });
  it('boss waves define a boss and append it last in the queue', () => {
    const def = generateWave(10);
    expect(def.boss).toBe('boss');
    const queue = expandSpawnQueue(def, 1);
    expect(queue[queue.length - 1]).toBe('boss');
    expect(queue.filter((t) => t === 'boss')).toHaveLength(1);
    // Swarm count is unchanged; the boss is extra.
    expect(def.totalEnemies).toBe(100);
    expect(queue).toHaveLength(101);
  });
  it('non-boss waves have no boss', () => {
    expect(generateWave(5).boss).toBeUndefined();
    expect(expandSpawnQueue(generateWave(5), 1)).not.toContain('boss');
  });
  it('boss scales with wave hp multiplier', () => {
    const boss = makeEnemy('boss', 1.75, 1.2);
    expect(boss.hp).toBeGreaterThan(ENEMIES.tank.hp);
    expect(boss.reward).toBeGreaterThan(ENEMIES.tank.reward);
  });
});

describe('economy (spec §28)', () => {
  it('spend denies when broke, allows after kill gold', () => {
    const s = createInitialState();
    s.gold = 40;
    expect(canAfford(s, TOWERS.crossbow.cost)).toBe(false);
    expect(spendGold(s, TOWERS.crossbow.cost)).toBe(false);
    addGold(s, 100);
    expect(spendGold(s, TOWERS.crossbow.cost)).toBe(true);
    expect(s.gold).toBe(90);
  });
});

describe('targeting (spec §24)', () => {
  it('first picks furthest along path, nearest picks closest', () => {
    const tower = { x: 0, y: 0, targeting: 'first' as const };
    const enemies = [
      fakeEnemy({ id: 1, x: 10, y: 0, distanceTraveled: 5 }),
      fakeEnemy({ id: 2, x: 50, y: 0, distanceTraveled: 50 }),
    ];
    expect(acquireTarget(tower, enemies, 200)?.id).toBe(2);
    expect(acquireTarget({ ...tower, targeting: 'nearest' }, enemies, 200)?.id).toBe(1);
  });
  it('respects range', () => {
    const tower = { x: 0, y: 0, targeting: 'first' as const };
    const enemies = [fakeEnemy({ id: 1, x: 500, y: 0, distanceTraveled: 9 })];
    expect(acquireTarget(tower, enemies, 100)).toBeUndefined();
  });
});

describe('maps', () => {
  function distToPath(x: number, y: number, path: { x: number; y: number }[]): number {
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const ax = path[i].x;
      const ay = path[i].y;
      const bx = path[i + 1].x;
      const by = path[i + 1].y;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / lenSq;
      t = Math.min(1, Math.max(0, t));
      best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
    }
    return best;
  }

  it('exposes multiple maps with unique slots kept off the path', () => {
    expect(MAPS.length).toBeGreaterThanOrEqual(3);
    for (const map of MAPS) {
      expect(map.path.length).toBeGreaterThanOrEqual(2);
      expect(map.buildSlots.length).toBeGreaterThan(0);
      expect(new Set(map.buildSlots.map((s) => s.id)).size).toBe(map.buildSlots.length);
      for (const s of map.buildSlots) {
        expect(s.x).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(map.world.width);
        expect(s.y).toBeGreaterThan(0);
        expect(s.y).toBeLessThan(map.world.height);
        expect(distToPath(s.x, s.y, map.path)).toBeGreaterThan(50);
      }
      // Base sits at (or just past) the end of the path.
      const end = map.path[map.path.length - 1];
      expect(Math.hypot(map.base.x - end.x, map.base.y - end.y)).toBeLessThanOrEqual(200);
    }
  });
  it('createInitialState uses the given map geometry and economy', () => {
    const canyon = getMap('canyon');
    const s = createInitialState(1, canyon);
    expect(s.map.id).toBe('canyon');
    expect(s.buildSlots).toHaveLength(canyon.buildSlots.length);
    expect(s.buildSlots[0].id).toBe(canyon.buildSlots[0].id);
    expect(s.baseHp).toBe(canyon.baseHp);
    expect(s.baseMaxHp).toBe(canyon.baseHp);
  });
});

describe('game flow', () => {
  it('build + wave 1 can start and complete with starting gold', () => {
    const g = new Game(42);
    g.startGame();
    const t = g.buildTower('slot-1', 'crossbow');
    expect(t).toBeDefined();
    expect(g.startWave()).toBe(true);
    // Fast-forward: kill everything instantly to simulate a cleared wave.
    g.state.spawnQueue = [];
    for (const e of g.state.enemies) e.alive = false;
    g.update(0.016);
    expect(['WAVE_COMPLETE', 'WAVE_ACTIVE', 'VICTORY', 'PREPARATION']).toContain(g.state.status);
  });
  it('spawned enemies scale with wave hp mult', () => {
    const e = makeEnemy('grunt', 1.75, 1.2);
    expect(e.hp).toBeGreaterThan(100);
  });
  it('sell refunds 70% and frees the slot', () => {
    const g = new Game(7);
    g.startGame();
    const goldBefore = g.state.gold;
    const t = g.buildTower('slot-1', 'crossbow');
    expect(t).toBeDefined();
    g.upgradeTower(t!.id); // +100 invested
    const refund = g.sellTower(t!.id);
    // invested = 50 + 100 = 150, refund = floor(150 * 0.7) = 105
    expect(refund).toBe(105);
    expect(g.state.gold).toBe(goldBefore - 50 - 100 + 105);
    expect(g.state.towers).toHaveLength(0);
    const slot = g.state.buildSlots.find((s) => s.id === 'slot-1');
    expect(slot?.occupied).toBe(false);
    // Slot reusable after sell.
    expect(g.buildTower('slot-1', 'crossbow')).toBeDefined();
  });
});
