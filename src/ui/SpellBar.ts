/**
 * Spell bar: one button per player spell with a cooldown veil, a seconds
 * readout and a hotkey chip. Pure view — arming, targeting and casting live
 * in main.ts; this only reports clicks and mirrors sim state.
 */
import { SPELLS, SPELL_IDS, type SpellId } from '../config/spells';
import { GameStatus, type GameState } from '../game/GameState';

interface SpellButton {
  id: SpellId;
  root: HTMLButtonElement;
  secs: HTMLElement;
  lastFill: number;
  lastSecs: string;
  lastState: string;
}

export class SpellBar {
  private root: HTMLElement;
  private buttons: SpellButton[] = [];
  private lastVisible: boolean | null = null;

  constructor(root: HTMLElement, onSelect: (id: SpellId) => void) {
    this.root = root;
    for (const id of SPELL_IDS) {
      const def = SPELLS[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spell-btn';
      btn.dataset.spell = id;
      btn.title = `${def.name} (${def.hotkey.toUpperCase()}) — ${def.description}`;
      btn.setAttribute('aria-label', `${def.name}: ${def.description}`);
      btn.innerHTML =
        `<span class="spell-veil" aria-hidden="true"></span>` +
        `<span class="spell-icon" aria-hidden="true">${def.icon}</span>` +
        `<span class="spell-key" aria-hidden="true">${def.hotkey.toUpperCase()}</span>` +
        `<span class="spell-secs" aria-hidden="true"></span>`;
      btn.addEventListener('click', (e) => {
        // Drop focus after a pointer click so Space (pause) can't re-trigger
        // the spell; keyboard activation (detail 0) keeps its focus.
        if (e.detail > 0) btn.blur();
        onSelect(id);
      });
      root.appendChild(btn);
      this.buttons.push({
        id,
        root: btn,
        secs: btn.querySelector<HTMLElement>('.spell-secs')!,
        lastFill: -1,
        lastSecs: '',
        lastState: '',
      });
    }
  }

  /** Called every frame; writes to the DOM only when values change. */
  update(state: GameState, armed: SpellId | null): void {
    const visible =
      state.status === GameStatus.PREPARATION ||
      state.status === GameStatus.WAVE_ACTIVE ||
      state.status === GameStatus.WAVE_COMPLETE ||
      state.status === GameStatus.PAUSED;
    if (visible !== this.lastVisible) {
      this.lastVisible = visible;
      this.root.classList.toggle('hidden', !visible);
    }
    if (!visible) return;

    const inWave = state.status === GameStatus.WAVE_ACTIVE;
    for (const b of this.buttons) {
      const left = state.spellCooldowns[b.id];
      // Quantized so the veil repaints ~100 times per cooldown, not per frame.
      const fill = Math.ceil((left / SPELLS[b.id].cooldown) * 100) / 100;
      if (fill !== b.lastFill) {
        b.lastFill = fill;
        b.root.style.setProperty('--cd', String(fill));
      }
      const secs = left > 0 ? String(Math.ceil(left)) : '';
      if (secs !== b.lastSecs) {
        b.lastSecs = secs;
        b.secs.textContent = secs;
      }
      const active = b.id === 'rally' && state.rallyTimeLeft > 0;
      const ready = inWave && left <= 0;
      const key = `${ready}|${armed === b.id}|${active}`;
      if (key !== b.lastState) {
        b.lastState = key;
        b.root.disabled = !ready;
        b.root.classList.toggle('ready', ready);
        b.root.classList.toggle('armed', armed === b.id);
        b.root.classList.toggle('active', active);
      }
    }
  }
}
