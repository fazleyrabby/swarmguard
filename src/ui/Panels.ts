/**
 * Panels: floating build menu + tower upgrade panel (spec §29–31, §63–66).
 * Rendered as HTML/CSS into the bottom-panel container; the game world
 * itself stays in PixiJS. Keyboard: Space pause, 1/2/3 speed, Esc close.
 * All input uses click/pointer events so mouse + touch both work.
 */

import { TOWERS, TOWER_IDS, getTowerLevel, type TowerId } from '../config/towers';
import { Game, type SpeedSetting } from '../game/Game';
import type { Tower } from '../game/entities';
import { isBranchChoice, isMaxLevel, sellRefundFor, upgradeCostFor } from '../game/systems/UpgradeSystem';
import type { AudioManager } from '../audio/AudioManager';

export interface PanelHooks {
  showRange: (x: number, y: number, radius: number) => void;
  hideRange: () => void;
}

export interface PanelKeyboard {
  onTogglePause: () => void;
  onSpeed: (speed: SpeedSetting) => void;
}

const BUILD_ORDER: TowerId[] = TOWER_IDS;
const SPEED_KEYS: Record<string, SpeedSetting> = { 1: 1, 2: 2, 3: 3 };

export class Panels {
  private container: HTMLElement;
  private game: Game;
  private audio: AudioManager;
  private hooks: PanelHooks;
  private openSlotId: string | null = null;
  /** Currently inspected tower. */
  openTowerId: string | null = null;
  private keyboardBound = false;
  /** Signature of the currently rendered panel; rebuild only when this changes. */
  private renderedKey: string | null = null;

  constructor(container: HTMLElement, game: Game, audio: AudioManager, hooks: PanelHooks) {
    this.container = container;
    this.game = game;
    this.audio = audio;
    this.hooks = hooks;
  }

  /** Swap the Game instance (used on restart, which creates a fresh Game). */
  setGame(game: Game): void {
    this.game = game;
    this.close();
  }

  get isOpen(): boolean {
    return this.openSlotId !== null || this.openTowerId !== null;
  }

  // ------------------------------------------------------------ build menu

  openBuild(slotId: string): void {
    const slot = this.game.state.buildSlots.find((s) => s.id === slotId);
    if (!slot || slot.occupied) return;
    if (this.openSlotId === slotId) return;
    this.openSlotId = slotId;
    this.openTowerId = null;
    this.audio.play('click');
    this.render();
  }

  // ---------------------------------------------------------- upgrade panel

  openUpgrade(towerId: string): void {
    const tower = this.game.state.towers.find((t) => t.id === towerId);
    if (!tower) return;
    if (this.openTowerId === towerId) return;
    this.openTowerId = towerId;
    this.openSlotId = null;
    this.audio.play('click');
    const stats = getTowerLevel(tower.type, tower.level, tower.branch);
    this.hooks.showRange(tower.x, tower.y, stats.range);
    this.render();
  }

  close(): void {
    if (!this.isOpen) return;
    this.openSlotId = null;
    this.openTowerId = null;
    this.renderedKey = null;
    this.hooks.hideRange();
    this.render();
  }

  /** Re-render the open panel (affordability / stats change as gold changes). */
  refresh(): void {
    if (!this.isOpen) return;
    if (this.openTowerId !== null && !this.game.state.towers.some((t) => t.id === this.openTowerId)) {
      this.close();
      return;
    }
    if (this.openSlotId !== null) {
      const slot = this.game.state.buildSlots.find((s) => s.id === this.openSlotId);
      if (!slot) {
        this.close();
        return;
      }
      if (slot.occupied) {
        // Slot just got a tower — switch to its upgrade panel.
        if (slot.towerId) {
          this.openUpgrade(slot.towerId);
          return;
        }
        this.close();
        return;
      }
    }
    // Rebuilding innerHTML on every kill replaces the buttons mid-click
    // (and replays the pop-in animation = the "jump"). Rebuild only when
    // the panel identity/level changed; otherwise just flip affordability.
    const key = this.panelKey();
    if (key !== this.renderedKey) {
      this.render();
    } else {
      this.updateAffordability();
    }
  }

  /** Identity of the open panel: tower id + level, or slot id. */
  private panelKey(): string {
    if (this.openTowerId !== null) {
      const tower = this.game.state.towers.find((t) => t.id === this.openTowerId);
      return tower ? `up:${tower.id}:${tower.level}` : 'none';
    }
    return `build:${this.openSlotId}`;
  }

  /** Flip disabled states in place — no DOM replacement, clicks survive. */
  private updateAffordability(): void {
    const gold = this.game.state.gold;
    this.container.querySelectorAll<HTMLButtonElement>('[data-cost]').forEach((btn) => {
      btn.disabled = gold < Number(btn.dataset.cost);
    });
  }

  // --------------------------------------------------------------- rendering

  private render(): void {
    this.container.innerHTML = '';
    if (this.openSlotId !== null) {
      this.container.appendChild(this.buildMenuEl(this.openSlotId));
    } else if (this.openTowerId !== null) {
      const tower = this.game.state.towers.find((t) => t.id === this.openTowerId);
      if (tower) this.container.appendChild(this.upgradeEl(tower));
    }
    this.renderedKey = this.panelKey();
    this.container.classList.toggle('hidden', !this.isOpen);
  }

  private buildMenuEl(slotId: string): HTMLElement {
    const state = this.game.state;
    const slot = state.buildSlots.find((s) => s.id === slotId);
    const wrap = document.createElement('div');
    wrap.className = 'panel';
    const title = document.createElement('h2');
    title.textContent = '🛠 Build tower';
    wrap.appendChild(title);

    for (const id of BUILD_ORDER) {
      const def = TOWERS[id];
      const level = def.levels[0];
      const affordable = state.gold >= def.cost;
      const card = document.createElement('button');
      card.className = 'tower-option';
      card.disabled = !affordable;
      card.dataset.cost = String(def.cost);
      card.innerHTML =
        `<span class="tower-name">${def.icon} ${def.name}</span>` +
        `<span class="tower-cost">💰 ${def.cost}</span>`;
      card.title = `${def.description} (DMG ${level.damage}, RNG ${level.range})`;
      // Hovering a card previews that tower's range from the slot.
      card.addEventListener('pointerenter', () => {
        if (slot) this.hooks.showRange(slot.x, slot.y, level.range);
      });
      card.addEventListener('pointerleave', () => this.hooks.hideRange());
      card.addEventListener('click', () => {
        if (this.game.state.gold < def.cost) {
          this.audio.play('error');
          card.classList.remove('denied');
          // Retrigger the shake animation.
          void card.offsetWidth;
          card.classList.add('denied');
          return;
        }
        const tower = this.game.buildTower(slotId, id);
        if (!tower) {
          this.audio.play('error');
          return;
        }
        // refresh() auto-switches to the upgrade panel on success.
        this.refresh();
      });
      const sub = document.createElement('small');
      sub.className = 'tower-sub';
      sub.textContent = `DMG ${level.damage} • RNG ${level.range}${level.splashRadius ? ` • AoE ${level.splashRadius}` : ''}`;
      card.appendChild(sub);
      wrap.appendChild(card);
    }

    wrap.appendChild(this.closeRow());
    return wrap;
  }

  private upgradeEl(tower: Tower): HTMLElement {
    const state = this.game.state;
    const wrap = document.createElement('div');
    wrap.className = 'panel';
    const def = TOWERS[tower.type];
    const stats = getTowerLevel(tower.type, tower.level, tower.branch);
    const maxed = isMaxLevel(tower.type, tower.level);
    const cost = upgradeCostFor(tower.type, tower.level, tower.branch);
    const attackPerSec = stats.attackSpeed.toFixed(2).replace(/\.?0+$/, '');
    const branch = tower.branch ? def.branches?.find((b) => b.id === tower.branch) : undefined;

    const title = document.createElement('h2');
    title.textContent = `${def.icon} ${def.name}`;
    wrap.appendChild(title);

    const level = document.createElement('div');
    level.className = 'tower-level';
    level.textContent = `Level ${tower.level}${maxed ? ' — MAX' : ''}${branch ? ` • ${branch.name}` : ''}`;
    wrap.appendChild(level);

    const statsEl = document.createElement('div');
    statsEl.className = 'stat-list';
    let rows =
      `<div class="stat-row"><span>Damage</span><strong>${stats.damage}</strong></div>` +
      `<div class="stat-row"><span>Range</span><strong>${stats.range}</strong></div>` +
      `<div class="stat-row"><span>Attack</span><strong>${attackPerSec}/s</strong></div>`;
    if (stats.splashRadius) {
      rows += `<div class="stat-row"><span>Splash</span><strong>${stats.splashRadius}</strong></div>`;
    }
    if (stats.slowFactor) {
      rows += `<div class="stat-row"><span>Slow</span><strong>${Math.round(stats.slowFactor * 100)}% / ${stats.slowDuration}s</strong></div>`;
    }
    statsEl.innerHTML = rows;
    wrap.appendChild(statsEl);

    const nextLevel = tower.level + 1;
    const needsBranch = !maxed && isBranchChoice(tower.type, nextLevel) && !tower.branch;

    if (needsBranch && def.branches) {
      const label = document.createElement('div');
      label.className = 'branch-label';
      label.textContent = 'Choose a specialization:';
      wrap.appendChild(label);
      for (const br of def.branches) {
        const tier = br.levels[nextLevel - (def.branchLevel ?? nextLevel)] ?? br.levels[0];
        const bCost = upgradeCostFor(tower.type, tower.level, br.id) ?? cost ?? 0;
        const btn = document.createElement('button');
        btn.className = 'tower-option branch-option';
        btn.disabled = state.gold < bCost;
        btn.dataset.cost = String(bCost);
        btn.style.borderColor = `#${br.color.toString(16).padStart(6, '0')}`;
        btn.title = br.description;
        btn.innerHTML =
          `<span class="tower-name">${br.abbr} · ${br.name}</span>` +
          `<span class="tower-cost">💰 ${bCost}</span>`;
        const sub = document.createElement('small');
        sub.className = 'tower-sub';
        sub.textContent =
          `DMG ${tier.damage} • RNG ${tier.range} • ${tier.attackSpeed}/s` +
          (tier.splashRadius ? ` • AoE ${tier.splashRadius}` : '');
        btn.appendChild(sub);
        btn.addEventListener('pointerenter', () => this.hooks.showRange(tower.x, tower.y, tier.range));
        btn.addEventListener('pointerleave', () => this.hooks.showRange(tower.x, tower.y, stats.range));
        btn.addEventListener('click', () => {
          if (!this.game.upgradeTower(tower.id, br.id)) this.audio.play('error');
          this.refresh();
        });
        wrap.appendChild(btn);
      }
    } else if (!maxed && cost !== undefined) {
      const next = getTowerLevel(tower.type, nextLevel, tower.branch);
      const up = document.createElement('button');
      up.className = 'btn btn-accent btn-block';
      up.disabled = state.gold < cost;
      up.dataset.cost = String(cost);
      up.innerHTML = `⬆ Upgrade → <strong>💰 ${cost}</strong><small>DMG ${next.damage} • RNG ${next.range}</small>`;
      up.addEventListener('pointerenter', () => this.hooks.showRange(tower.x, tower.y, next.range));
      up.addEventListener('pointerleave', () => this.hooks.showRange(tower.x, tower.y, stats.range));
      up.addEventListener('click', () => {
        const ok = this.game.upgradeTower(tower.id);
        if (!ok) {
          this.audio.play('error');
        } else {
          const t = this.game.state.towers.find((x) => x.id === tower.id);
          if (t) {
            const s = getTowerLevel(t.type, t.level, t.branch);
            this.hooks.showRange(t.x, t.y, s.range);
          }
        }
        this.refresh();
      });
      wrap.appendChild(up);
    }

    const refund = sellRefundFor(tower.type, tower.level, tower.branch);
    const sell = document.createElement('button');
    sell.className = 'btn btn-block';
    sell.innerHTML = `💰 Sell → <strong>+${refund}g</strong><small>70% refund</small>`;
    sell.addEventListener('click', () => {
      const got = this.game.sellTower(tower.id);
      this.audio.play(got > 0 ? 'tower-sell' : 'error');
      this.close();
    });
    wrap.appendChild(sell);

    wrap.appendChild(this.closeRow());
    return wrap;
  }

  private closeRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'panel-close-row';
    const close = document.createElement('button');
    close.className = 'btn btn-small';
    close.textContent = '✕ Close (Esc)';
    close.addEventListener('click', () => this.close());
    row.appendChild(close);
    return row;
  }

  // --------------------------------------------------------------- keyboard

  bindKeyboard(keys: PanelKeyboard): void {
    if (this.keyboardBound) return;
    this.keyboardBound = true;
    window.addEventListener('keydown', (e) => {
      // Don't hijack typing in inputs.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        keys.onTogglePause();
      } else if (e.key === 'Escape') {
        this.close();
      } else if (SPEED_KEYS[e.key] !== undefined) {
        keys.onSpeed(SPEED_KEYS[e.key]);
      }
    });
  }
}
