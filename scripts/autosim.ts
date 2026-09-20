import { Game } from '../src/game/Game';
import { GameStatus } from '../src/game/GameState';
import { TOWERS } from '../src/config/towers';
import { getChallenge } from '../src/config/challenges';
import { isBranchChoice, upgradeCostFor } from '../src/game/systems/UpgradeSystem';

let destroyedTowers = 0;

function autoSpend(g: Game, midWave = false): void {
  const s = g.state;
  for (const t of s.towers) {
    if (t.hp < t.maxHp) g.repairTower(t.id);
  }
  const counts = { crossbow: 0, cannon: 0, bomb: 0 };
  for (const t of s.towers) counts[t.type]++;
  const want: Array<'crossbow' | 'cannon' | 'bomb'> = [];
  while (counts.crossbow < 4) { want.push('crossbow'); counts.crossbow++; }
  while (counts.cannon < 2) { want.push('cannon'); counts.cannon++; }
  while (counts.bomb < 1) { want.push('bomb'); counts.bomb++; }
  for (const slot of s.buildSlots) {
    if (slot.occupied || want.length === 0) continue;
    const type = want[0];
    if (s.gold >= TOWERS[type].cost) { g.buildTower(slot.id, type); want.shift(); counts[type]++; }
    else break;
  }
  if (midWave) return;
  for (let i = 0; i < 50; i++) {
    let best: { id: string; cost: number; branchId?: string } | null = null;
    for (const t of g.state.towers) {
      const nextLevel = t.level + 1;
      const branchId = isBranchChoice(t.type, nextLevel)
        ? t.type === 'cannon'
          ? 'mortar'
          : 'rapidfire'
        : t.branch;
      const cost = upgradeCostFor(t.type, t.level, branchId);
      if (cost === undefined || g.state.gold < cost) continue;
      if (!best || cost < best.cost) best = { id: t.id, cost, branchId };
    }
    if (!best) break;
    g.upgradeTower(best.id, best.branchId);
  }
  for (const slot of g.state.buildSlots) {
    if (!slot.occupied && g.state.gold >= TOWERS.cannon.cost) g.buildTower(slot.id, 'cannon');
  }
}

const challengeId = process.argv[2] ?? 'standard';
const g = new Game(1337, undefined, getChallenge(challengeId));
g.events.on('tower:destroyed', () => destroyedTowers++);
g.startGame();
autoSpend(g);
let steps = 0;
const DT = 1 / 30;
const maxWave = challengeId === 'endless' ? 30 : Infinity;
const t0 = Date.now();
while (
  g.state.status !== GameStatus.VICTORY &&
  g.state.status !== GameStatus.GAME_OVER &&
  g.state.wave < maxWave
) {
  if (g.state.status === GameStatus.PREPARATION || g.state.status === GameStatus.WAVE_COMPLETE) {
    autoSpend(g);
    console.log(`start wave ${g.state.wave + 1} gold=${g.state.gold} towers=${g.state.towers.length} hp=${g.state.baseHp}`);
    g.startWave();
  }
  g.update(DT);
  steps++;
  if (steps % 300 === 0) autoSpend(g, true);
  if (steps > 30 * 60 * 60) throw new Error('timeout');
}
console.log(`END ${g.state.status} wave=${g.state.wave} hp=${g.state.baseHp} kills=${g.state.totalKills} goldEarned=${g.state.totalGoldEarned} steps=${steps} wallMs=${Date.now() - t0}`);
console.log(`towers: ${g.state.towers.map((t) => `${t.type}L${t.level}`).join(', ')}`);
console.log(`towers destroyed: ${destroyedTowers}`);
