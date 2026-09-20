import { describe, expect, it } from 'vitest';
import { generateWave, generateBossRushWave, enemyCountForWave, expandSpawnQueue, isBossWave } from '../config/waves';
import { TOWERS, TOWER_IDS, getTowerLevel } from '../config/towers';
import { ENEMIES, isBossType } from '../config/enemies';
import { MAPS, getMap } from '../config/maps';
import { getChallenge } from '../config/challenges';
import { AchievementStore, evaluateAchievements } from './achievements';
import { createInitialState } from './GameState';
import { Game } from './Game';
import { EventBus } from './EventBus';
import { canAfford, spendGold, addGold } from './systems/EconomySystem';
import { acquireTarget } from './systems/TargetingSystem';
import { makeEnemy } from './systems/SpawnSystem';
import { damageEnemy } from './systems/CombatSystem';
import { updateAbilities } from './systems/AbilitySystem';
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
    expect(isBossType(def.boss!)).toBe(true);
    expect(def.boss).toBe('boss-shielded');
    const queue = expandSpawnQueue(def, 1);
    expect(queue[queue.length - 1]).toBe('boss-shielded');
    expect(queue.filter((t) => t === 'boss-shielded')).toHaveLength(1);
    // Swarm count is unchanged; the boss is extra.
    expect(def.totalEnemies).toBe(100);
    expect(queue).toHaveLength(101);
  });
  it('boss variants cycle by decade', () => {
    expect(generateWave(10).boss).toBe('boss-shielded');
    expect(generateWave(20).boss).toBe('boss-regen');
    expect(generateWave(30).boss).toBe('boss-herald');
    expect(generateWave(40).boss).toBe('boss-shielded');
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

describe('boss abilities', () => {
  it('a shield absorbs damage before HP', () => {
    const s = createInitialState();
    const events = new EventBus();
    const boss = makeEnemy('boss-shielded', 1, 1, s.map.spawn);
    const hp0 = boss.hp;
    const shield0 = boss.maxShield ?? 0;
    damageEnemy(s, boss, 500, events);
    expect(boss.shield).toBe(shield0 - 500);
    expect(boss.hp).toBe(hp0);
    damageEnemy(s, boss, 800, events);
    expect(boss.shield).toBe(0);
    expect(boss.hp).toBe(hp0 - (800 - 700));
  });
  it('regen heals over time', () => {
    const s = createInitialState();
    const events = new EventBus();
    const boss = makeEnemy('boss-regen', 1, 1, s.map.spawn);
    boss.hp = 1000;
    s.enemies = [boss];
    updateAbilities(s, 1, events);
    expect(boss.hp).toBeCloseTo(1000 + (boss.regenPerSec ?? 0), 5);
  });
  it('herald buffs the speed of nearby enemies', () => {
    const s = createInitialState();
    const events = new EventBus();
    const herald = makeEnemy('boss-herald', 1, 1, s.map.spawn);
    const near = makeEnemy('grunt', 1, 1, s.map.spawn);
    const far = makeEnemy('grunt', 1, 1, s.map.spawn);
    near.x = herald.x + 50;
    near.y = herald.y;
    far.x = herald.x + (herald.auraRadius ?? 0) + 200;
    far.y = herald.y;
    s.enemies = [herald, near, far];
    updateAbilities(s, 0.016, events);
    expect(near.auraMult).toBeCloseTo(1 + (herald.auraSpeedBonus ?? 0), 5);
    expect(far.auraMult).toBe(1);
  });
  it('boss rush is a boss squad plus a themed escort', () => {
    const g = new Game(1, undefined, getChallenge('boss-rush'));
    g.startGame();
    g.startWave();
    const queue = g.state.spawnQueue;
    expect(g.state.waveTotalEnemies).toBe(10);
    expect(queue).toHaveLength(11);
    expect(queue[queue.length - 1]).toBe('boss-shielded');
    expect(queue.filter((t) => t === 'boss-shielded')).toHaveLength(1);
    // Escort is the matching minion (Bulwark → Shieldlings).
    expect(queue.filter((t) => t === 'minion-shielded')).toHaveLength(10);
    expect(isBossType('minion-shielded')).toBe(false);
  });
  it('boss rush boss count grows every 2 waves', () => {
    expect(generateBossRushWave(1).bossCount).toBe(1);
    expect(generateBossRushWave(3).bossCount).toBe(2);
    expect(generateBossRushWave(5).bossCount).toBe(3);
    expect(generateBossRushWave(7).bossCount).toBe(4);
    expect(generateBossRushWave(9).bossCount).toBe(5);
    expect(expandSpawnQueue(generateBossRushWave(5), 1).filter((t) => isBossType(t))).toHaveLength(3);
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

describe('towers', () => {
  it('exposes five towers, each with five upgrade levels', () => {
    expect(TOWER_IDS).toHaveLength(5);
    for (const id of TOWER_IDS) {
      expect(TOWERS[id].levels).toHaveLength(5);
    }
  });
  it('new towers build with default targeting and can be upgraded', () => {
    const g = new Game(3);
    g.startGame();
    g.state.gold = 10000;
    const frost = g.buildTower('slot-1', 'frost');
    const sniper = g.buildTower('slot-2', 'sniper');
    expect(frost).toBeDefined();
    expect(sniper).toBeDefined();
    expect(frost?.targeting).toBe('first');
    expect(sniper?.targeting).toBe('strongest');
    expect(g.upgradeTower(sniper!.id)).toBe(true);
    expect(g.state.towers.find((t) => t.id === sniper!.id)?.level).toBe(2);
  });
});

describe('challenges', () => {
  it('overrides economy and base HP', () => {
    const poverty = createInitialState(1, undefined, getChallenge('poverty'));
    expect(poverty.gold).toBe(50);
    const sudden = createInitialState(1, undefined, getChallenge('sudden-death'));
    expect(sudden.baseHp).toBe(1);
    expect(sudden.baseMaxHp).toBe(1);
  });
  it('onslaught scales wave counts', () => {
    const g = new Game(1, undefined, getChallenge('onslaught'));
    g.startGame();
    g.startWave();
    expect(g.state.waveTotalEnemies).toBeGreaterThan(10);
  });
  it('endless keeps the run going past wave 10', () => {
    const g = new Game(1, undefined, getChallenge('endless'));
    g.startGame();
    g.startWave();
    // Jump the wave counter forward and clear it; endless must not declare victory.
    g.state.wave = 10;
    g.state.spawnQueue = [];
    for (const e of g.state.enemies) e.alive = false;
    g.update(0.016);
    expect(g.state.status).not.toBe('VICTORY');
  });
});

describe('achievements', () => {
  it('evaluates run milestones into the store', () => {
    const store = new AchievementStore();
    const s = createInitialState();
    s.totalKills = 1;
    s.totalGoldEarned = 2500;
    s.towers = Array.from({ length: 8 }, () => ({ level: 5 })) as never;
    const earned = evaluateAchievements(s, store, {
      mapCount: 3,
      challengeId: 'standard',
      untouched: true,
    });
    expect(earned).toContain('first-blood');
    expect(earned).toContain('architect');
    expect(earned).toContain('maxed');
    expect(earned).toContain('rich');
    expect(store.has('first-blood')).toBe(true);
    // Second evaluation must not re-award.
    const again = evaluateAchievements(s, store, {
      mapCount: 3,
      challengeId: 'standard',
      untouched: true,
    });
    expect(again).toHaveLength(0);
  });
});

describe('upgrade branches', () => {
  it('crossbow must pick a branch at level 3 and stats diverge', () => {
    const g = new Game(5);
    g.startGame();
    g.state.gold = 100000;
    const t = g.buildTower('slot-1', 'crossbow');
    expect(t).toBeDefined();
    expect(g.upgradeTower(t!.id)).toBe(true); // 1 -> 2
    expect(g.upgradeTower(t!.id)).toBe(false); // 2 -> 3 requires a branch
    expect(g.state.towers[0].level).toBe(2);
    expect(g.upgradeTower(t!.id, 'rapidfire')).toBe(true);
    expect(g.state.towers[0].level).toBe(3);
    expect(g.state.towers[0].branch).toBe('rapidfire');
    const rapid = getTowerLevel('crossbow', 3, 'rapidfire');
    const arbalest = getTowerLevel('crossbow', 3, 'arbalest');
    expect(rapid.attackSpeed).toBeGreaterThan(arbalest.attackSpeed);
    expect(arbalest.damage).toBeGreaterThan(rapid.damage);
    // Branch persists for higher levels without re-selecting.
    expect(g.upgradeTower(t!.id)).toBe(true);
    expect(getTowerLevel('crossbow', 4, g.state.towers[0].branch).attackSpeed).toBeGreaterThan(2);
  });
  it('towers without branches upgrade linearly', () => {
    const g = new Game(5);
    g.startGame();
    g.state.gold = 100000;
    const t = g.buildTower('slot-1', 'frost');
    expect(g.upgradeTower(t!.id)).toBe(true);
    expect(g.state.towers[0].branch).toBeUndefined();
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

describe('spearman', () => {
  function spearmanNextToTower(): Game {
    const g = new Game(7);
    g.startGame();
    const t = g.buildTower('slot-1', 'crossbow');
    expect(t).toBeDefined();
    const e = makeEnemy('spearman', 1, 1);
    expect(e.attackRange).toBe(110);
    e.x = t!.x + 20;
    e.y = t!.y;
    g.state.enemies.push(e);
    return g;
  }
  it('stops to stab towers in reach instead of walking past', () => {
    const g = spearmanNextToTower();
    const tower = g.state.towers[0];
    const enemy = g.state.enemies[0];
    const { x, y } = enemy;
    g.update(0.5);
    expect(enemy.attackTargetId).toBe(tower.id);
    expect(enemy.x).toBe(x);
    expect(enemy.y).toBe(y);
    expect(tower.hp).toBeLessThan(tower.maxHp);
  });
  it('destroys the tower at 0 HP, frees the slot and emits an event', () => {
    const g = spearmanNextToTower();
    const tower = g.state.towers[0];
    tower.hp = 3;
    let destroyed = 0;
    g.events.on('tower:destroyed', () => destroyed++);
    g.update(0.5);
    expect(destroyed).toBe(1);
    expect(g.state.towers).toHaveLength(0);
    expect(g.state.buildSlots.find((s) => s.id === 'slot-1')?.occupied).toBe(false);
    expect(g.buildTower('slot-1', 'crossbow')).toBeDefined();
  });
  it('repairs to full for a fraction of invested gold', () => {
    const g = spearmanNextToTower();
    const tower = g.state.towers[0];
    g.update(0.5);
    expect(tower.hp).toBeLessThan(tower.maxHp);
    const goldBefore = g.state.gold;
    expect(g.repairTower(tower.id)).toBe(true);
    expect(tower.hp).toBe(tower.maxHp);
    expect(g.state.gold).toBeLessThan(goldBefore);
    // Full HP or missing tower: no-op.
    expect(g.repairTower(tower.id)).toBe(false);
    expect(g.repairTower('nope')).toBe(false);
  });
  it('upgrades raise max HP and heal by the delta', () => {
    const g = new Game(7);
    g.startGame();
    g.state.gold = 100000;
    const t = g.buildTower('slot-1', 'crossbow');
    const before = t!.maxHp;
    t!.hp = before - 40;
    expect(g.upgradeTower(t!.id)).toBe(true);
    expect(t!.maxHp).toBeGreaterThan(before);
    expect(t!.hp).toBe(before);
  });
  it('joins wave compositions from wave 4, never before', () => {
    for (const w of [1, 2, 3]) {
      expect(generateWave(w).composition.some((c) => c.enemyType === 'spearman')).toBe(false);
    }
    for (const w of [4, 6, 10]) {
      const def = generateWave(w);
      expect(def.composition.some((c) => c.enemyType === 'spearman')).toBe(true);
      expect(expandSpawnQueue(def, 1).filter((t) => t === 'spearman').length).toBeGreaterThan(0);
    }
  });
});
