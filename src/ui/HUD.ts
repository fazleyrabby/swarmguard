/**
 * HUD: HTML/CSS overlay (spec §32–35, §61–62, §69–70).
 * PixiJS owns the canvas; this class owns the top bar, bottom bar,
 * menu / preparation / wave-complete / game-over / victory overlays,
 * banner toasts and the settings modal. No game logic lives here —
 * every button delegates through HudCallbacks into main.ts -> Game.
 */

import type { SpeedSetting } from '../game/Game';
import { GameStatus, type GameState } from '../game/GameState';

export interface GameSettings {
  sound: boolean;
  music: boolean;
  shake: boolean;
  damageNumbers: boolean;
}

export interface MapOption {
  id: string;
  name: string;
  description: string;
}

export interface ChallengeOption {
  id: string;
  name: string;
  description: string;
}

export interface AchievementView {
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
}

export interface HudCallbacks {
  onPlay: () => void;
  onStartWave: () => void;
  onContinue: () => void;
  onRestart: () => void;
  onPause: () => void;
  onMenu: () => void;
  onResume: () => void;
  onSpeed: (speed: SpeedSetting) => void;
  onMuteToggle: () => void;
  onSettingsChange: (settings: GameSettings) => void;
  onSelectMap: (id: string) => void;
  onSelectChallenge: (id: string) => void;
  getAchievements: () => AchievementView[];
}

export interface EndOfGameStats {
  wave: number;
  kills: number;
  goldEarned: number;
  highestWave: number;
}

export interface WaveCompleteStats {
  wave: number;
  kills: number;
  gold: number;
  reward: number;
  totalGold: number;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[HUD] missing element #${id}`);
  return node as T;
}

export class HUD {
  private callbacks: HudCallbacks;
  private settings: GameSettings;
  private highestWave = 0;
  private maps: MapOption[];
  private selectedMapId: string;
  private challenges: ChallengeOption[];
  private selectedChallengeId: string;

  private top = el('ui');
  private hp = el('hud-hp');
  private goldEl = el('hud-gold');
  private waveEl = el('hud-wave');
  private menuBtn = el<HTMLButtonElement>('btn-menu');
  private pauseBtn = el<HTMLButtonElement>('btn-pause');
  private muteBtn = el<HTMLButtonElement>('btn-mute');
  private fullscreenBtn = el<HTMLButtonElement>('btn-fullscreen');
  private speedBtns: HTMLButtonElement[] = [];
  private bottomArea = el('bottom-area');
  private footerToggleBtn = el<HTMLButtonElement>('btn-footer-toggle');
  private statusText = el('status-text');
  private startWaveBtn = el<HTMLButtonElement>('btn-start-wave');
  private overlayRoot = el('overlay-root');
  private bannerEl: HTMLElement | null = null;
  private bannerTimer = 0;
  private supportBackdrop = el('support-backdrop');
  private supportOpenBtn = el<HTMLButtonElement>('btn-open-support');
  private supportCloseBtn = el<HTMLButtonElement>('btn-close-support');
  private payoneerBtn = el<HTMLButtonElement>('btn-copy-payoneer');
  private payoneerLabel = el('payoneer-copy-label');

  // Cache to avoid DOM churn at 60fps.
  private lastHp = '';
  private lastGold = '';
  private lastWave = '';
  private lastSpeed = 0;
  private lastPaused: boolean | null = null;
  private lastMuted: boolean | null = null;
  private lastCard: string | null = null;
  /** True when the menu was opened mid-run, so it can offer RESUME. */
  private menuInGame = false;

  constructor(
    callbacks: HudCallbacks,
    settings: GameSettings,
    maps: MapOption[] = [],
    selectedMapId = maps[0]?.id ?? '',
    challenges: ChallengeOption[] = [],
    selectedChallengeId = challenges[0]?.id ?? '',
  ) {
    this.callbacks = callbacks;
    this.settings = { ...settings };
    this.maps = maps;
    this.selectedMapId = selectedMapId;
    this.challenges = challenges;
    this.selectedChallengeId = selectedChallengeId;
    this.speedBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-speed]'));

    this.menuBtn.addEventListener('click', () => callbacks.onMenu());
    this.pauseBtn.addEventListener('click', () => callbacks.onPause());
    this.muteBtn.addEventListener('click', () => callbacks.onMuteToggle());
    this.fullscreenBtn.addEventListener('click', () => void this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => {
      const on = document.fullscreenElement !== null;
      this.fullscreenBtn.textContent = on ? '🗗' : '⛶';
      this.fullscreenBtn.title = on ? 'Exit fullscreen' : 'Fullscreen';
    });
    for (const btn of this.speedBtns) {
      btn.addEventListener('click', () => {
        const speed = Number(btn.dataset.speed) as SpeedSetting;
        callbacks.onSpeed(speed);
      });
    }
    this.startWaveBtn.addEventListener('click', () => callbacks.onStartWave());
    this.footerToggleBtn.addEventListener('click', () => {
      const open = this.bottomArea.classList.toggle('footer-open');
      this.footerToggleBtn.textContent = open ? '▴' : '▾';
      this.footerToggleBtn.setAttribute('aria-expanded', String(open));
    });

    this.supportOpenBtn.addEventListener('click', () => this.showSupport());
    this.supportCloseBtn.addEventListener('click', () => this.hideSupport());
    this.supportBackdrop.addEventListener('click', (e) => {
      if (e.target === this.supportBackdrop) this.hideSupport();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.supportBackdrop.classList.contains('hidden')) {
        this.hideSupport();
      }
    });
    this.payoneerBtn.addEventListener('click', () => void this.copyPayoneer());
  }

  setHighestWave(n: number): void {
    this.highestWave = n;
  }

  // ---------------------------------------------------------------- update

  /** Called every frame; writes to the DOM only when values change. */
  update(state: GameState, opts: { paused: boolean; muted: boolean }): void {
    const hpText = `❤️ ${state.baseHp}/${state.baseMaxHp}`;
    if (hpText !== this.lastHp) {
      this.lastHp = hpText;
      this.hp.textContent = hpText;
      this.hp.classList.toggle('low', state.baseMaxHp > 0 && state.baseHp / state.baseMaxHp <= 0.25);
    }
    const goldText = `💰 ${state.gold}`;
    if (goldText !== this.lastGold) {
      this.lastGold = goldText;
      this.goldEl.textContent = goldText;
    }
    const waveText = `WAVE ${Math.max(state.wave, 1)}`;
    if (waveText !== this.lastWave) {
      this.lastWave = waveText;
      this.waveEl.textContent = state.status === GameStatus.MENU ? 'WAVE –' : waveText;
    }
    if (state.speedMultiplier !== this.lastSpeed) {
      this.lastSpeed = state.speedMultiplier;
      for (const btn of this.speedBtns) {
        btn.classList.toggle('active', Number(btn.dataset.speed) === state.speedMultiplier);
      }
    }
    if (opts.paused !== this.lastPaused) {
      this.lastPaused = opts.paused;
      this.pauseBtn.textContent = opts.paused ? '▶' : '⏸';
      this.pauseBtn.classList.toggle('active', opts.paused);
      this.pauseBtn.title = opts.paused ? 'Resume (Space)' : 'Pause (Space)';
    }
    if (opts.muted !== this.lastMuted) {
      this.lastMuted = opts.muted;
      this.muteBtn.textContent = opts.muted ? '🔇' : '🔊';
      this.muteBtn.title = opts.muted ? 'Unmute sound' : 'Mute sound';
    }

    // Bottom bar: START WAVE is only meaningful while preparing.
    const canStart =
      state.status === GameStatus.PREPARATION || state.status === GameStatus.WAVE_COMPLETE;
    this.startWaveBtn.disabled = !canStart;
    let status = '';
    switch (state.status) {
      case GameStatus.MENU:
        status = 'Press PLAY to defend the Core.';
        break;
      case GameStatus.PREPARATION:
        status =
          state.wave === 0
            ? 'Build towers, then start Wave 1.'
            : `Prepare for Wave ${state.wave + 1} — build or upgrade, then start.`;
        break;
      case GameStatus.WAVE_ACTIVE:
        status = `Wave ${state.wave}: ${state.enemies.filter((e) => e.alive).length} enemies active${state.spawnQueue.length > 0 ? ` (+${state.spawnQueue.length} incoming)` : ''}.`;
        break;
      case GameStatus.WAVE_COMPLETE:
        status = `Wave ${state.wave} cleared! +${state.goldThisWave} gold.`;
        break;
      case GameStatus.PAUSED:
        status =
          window.matchMedia?.('(pointer: coarse)').matches
            ? 'Paused — tap ▶ to resume.'
            : 'Paused — press Space to resume.';
        break;
      case GameStatus.GAME_OVER:
        status = 'The Core has fallen.';
        break;
      case GameStatus.VICTORY:
        status = 'Area defended! Victory!';
        break;
    }
    if (this.statusText.textContent !== status) this.statusText.textContent = status;
  }

  setChromeVisible(visible: boolean): void {
    this.top.classList.toggle('hidden', !visible);
    this.bottomArea.classList.toggle('hidden', !visible);
  }

  // --------------------------------------------------------------- overlays

  private clearCard(): void {
    this.overlayRoot.querySelectorAll('[data-card]').forEach((n) => n.remove());
    this.lastCard = null;
  }

  private mountCard(name: string, html: string): HTMLElement {
    this.clearCard();
    this.lastCard = name;
    const card = document.createElement('div');
    card.className = 'overlay-card';
    card.dataset.card = name;
    card.innerHTML = html;
    this.overlayRoot.appendChild(card);
    return card;
  }

  showMenu(inGame = false): void {
    this.menuInGame = inGame;
    this.setChromeVisible(false);
    const mapButtons = this.maps
      .map((m) => {
        const active = m.id === this.selectedMapId ? ' active' : '';
        return `<button class="map-btn${active}" data-map="${m.id}">
          <span class="map-name">${m.name}</span>
          <span class="map-desc">${m.description}</span>
        </button>`;
      })
      .join('');
    const picker = mapButtons ? `<div class="map-picker">${mapButtons}</div>` : '';
    const challengeButtons = this.challenges
      .map((c) => {
        const active = c.id === this.selectedChallengeId ? ' active' : '';
        return `<button class="challenge-btn${active}" data-challenge="${c.id}" title="${c.description}">${c.name}</button>`;
      })
      .join('');
    const challenges = challengeButtons
      ? `<div class="challenge-label">Challenge</div><div class="challenge-picker">${challengeButtons}</div>`
      : '';
    const primary = inGame
      ? `<button class="btn btn-primary btn-big" data-action="resume">▶ RESUME</button>`
      : `<button class="btn btn-primary btn-big" data-action="play">▶ PLAY</button>`;
    const card = this.mountCard(
      'menu',
      `<div class="game-title">🏰 SWARMGUARD</div>
       <div class="game-subtitle">${inGame ? 'Paused — pick a map, challenge or settings' : 'Defend the Core'}</div>
       <div class="menu-best">Highest wave: <strong>${this.highestWave}</strong></div>
       ${picker}
       ${challenges}
       ${primary}
       <button class="btn" data-action="achievements">🏆 ACHIEVEMENTS</button>
       <button class="btn" data-action="settings">⚙ SETTINGS</button>
       <div class="menu-hint">Click a glowing pad to build • click a tower to upgrade • Space pauses</div>`,
    );
    card.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.map;
        if (!id) return;
        // Re-tapping the active map must not wipe the current run.
        if (id === this.selectedMapId) {
          this.showMenu(this.menuInGame);
          return;
        }
        this.selectedMapId = id;
        this.callbacks.onSelectMap(id);
        this.showMenu(false);
      });
    });
    card.querySelectorAll<HTMLButtonElement>('[data-challenge]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.challenge;
        if (!id) return;
        if (id === this.selectedChallengeId) {
          this.showMenu(this.menuInGame);
          return;
        }
        this.selectedChallengeId = id;
        this.callbacks.onSelectChallenge(id);
        this.showMenu(false);
      });
    });
    card
      .querySelector('[data-action="play"]')
      ?.addEventListener('click', () => this.callbacks.onPlay());
    card
      .querySelector('[data-action="resume"]')
      ?.addEventListener('click', () => this.callbacks.onResume());
    card.querySelector('[data-action="achievements"]')?.addEventListener('click', () =>
      this.showAchievements(this.callbacks.getAchievements()),
    );
    card.querySelector('[data-action="settings"]')?.addEventListener('click', () => this.showSettings(true));
  }

  /** Read-only achievements list with a back-to-menu button. */
  showAchievements(items: AchievementView[]): void {
    const rows = items
      .map(
        (a) => `<div class="achv${a.unlocked ? ' unlocked' : ''}">
          <span class="achv-icon">${a.unlocked ? a.icon : '🔒'}</span>
          <span class="achv-body">
            <span class="achv-name">${a.name}</span>
            <span class="achv-desc">${a.description}</span>
          </span>
        </div>`,
      )
      .join('');
    const got = items.filter((a) => a.unlocked).length;
    const card = this.mountCard(
      'achievements',
      `<h2>🏆 Achievements</h2>
       <div class="menu-best">Unlocked <strong>${got}</strong> / ${items.length}</div>
       <div class="achv-list">${rows}</div>
       <button class="btn btn-primary" data-action="back">↩ BACK</button>`,
    );
    card
      .querySelector('[data-action="back"]')
      ?.addEventListener('click', () => this.showMenu(this.menuInGame));
  }

  /** Toast an achievement unlock over the battlefield. */
  showAchievementToast(icon: string, name: string): void {
    this.banner(`${icon} Achievement unlocked: ${name}`, 2800);
  }

  hideMenu(): void {
    this.setChromeVisible(true);
    this.clearCard();
  }

  /** Clear any overlay card/banner (used on restart). */
  clearOverlays(): void {
    this.clearCard();
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
    }
    window.clearTimeout(this.bannerTimer);
  }

  showSettings(fromMenu: boolean): void {
    const s = this.settings;
    const card = this.mountCard(
      'settings',
      `<h2>⚙ Settings</h2>
       <label class="setting-row"><span>🔊 Sound effects</span>
         <button class="btn btn-small" data-setting="sound">${s.sound ? 'ON' : 'OFF'}</button></label>
       <label class="setting-row"><span>🎵 Music</span>
         <button class="btn btn-small" data-setting="music">${s.music ? 'ON' : 'OFF'}</button></label>
       <label class="setting-row"><span>📳 Screen shake</span>
         <button class="btn btn-small" data-setting="shake">${s.shake ? 'ON' : 'OFF'}</button></label>
       <label class="setting-row"><span>💥 Damage numbers</span>
         <button class="btn btn-small" data-setting="damageNumbers">${s.damageNumbers ? 'ON' : 'OFF'}</button></label>
       <button class="btn btn-primary" data-action="close">DONE</button>`,
    );
    card.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.setting as keyof GameSettings;
        this.settings[key] = !this.settings[key];
        btn.textContent = this.settings[key] ? 'ON' : 'OFF';
        this.callbacks.onSettingsChange({ ...this.settings });
      });
    });
    card.querySelector('[data-action="close"]')?.addEventListener('click', () => {
      if (fromMenu) this.showMenu(this.menuInGame);
      else this.clearCard();
    });
  }

  /** Preparation uses the bottom-bar START WAVE button + a banner; no modal. */
  showPreparation(nextWave: number): void {
    // Restart path clears victory/game-over cards first via clearOverlays(),
    // so only skip wave-complete cards here (they have their own CONTINUE flow).
    if (this.lastCard === 'wave-complete') return;
    if (this.lastCard !== 'prep') {
      this.clearCard();
      this.lastCard = 'prep';
    }
    this.banner(`WAVE ${nextWave} INCOMING — build, then press START WAVE`, 2600);
  }

  showWaveComplete(stats: WaveCompleteStats): void {
    const card = this.mountCard(
      'wave-complete',
      `<div class="banner-title">✅ WAVE ${stats.wave} COMPLETE!</div>
       <div class="stat-list">
         <div class="stat-row"><span>Enemies defeated</span><strong>${stats.kills}</strong></div>
         <div class="stat-row"><span>Gold earned</span><strong>+${stats.gold}</strong></div>
         <div class="stat-row"><span>Wave reward</span><strong>+${stats.reward}</strong></div>
         <div class="stat-row total"><span>Total gold</span><strong>💰 ${stats.totalGold}</strong></div>
       </div>
       <button class="btn btn-primary btn-big" data-action="continue">CONTINUE</button>`,
    );
    card.querySelector('[data-action="continue"]')?.addEventListener('click', () => {
      this.clearCard();
      this.lastCard = 'prep';
      this.callbacks.onContinue();
    });
  }

  showWaveBanner(wave: number, total: number, bossName?: string): void {
    this.clearCard();
    this.banner(
      bossName
        ? `☠ WAVE ${wave} — BOSS: ${bossName.toUpperCase()}!`
        : `⚔ WAVE ${wave} — ${total} enemies!`,
      bossName ? 2800 : 2200,
    );
  }

  showGameOver(stats: EndOfGameStats): void {
    this.mountCard(
      'game-over',
      `<div class="banner-title danger">💀 GAME OVER</div>
       <div class="game-subtitle">The Core has fallen on Wave ${stats.wave}</div>
       <div class="stat-list">
         <div class="stat-row"><span>Waves survived</span><strong>${Math.max(0, stats.wave - 1)}</strong></div>
         <div class="stat-row"><span>Enemies defeated</span><strong>${stats.kills}</strong></div>
         <div class="stat-row"><span>Gold earned</span><strong>${stats.goldEarned}</strong></div>
         <div class="stat-row"><span>Best wave</span><strong>${stats.highestWave}</strong></div>
       </div>
       <button class="btn btn-primary btn-big" data-action="restart">↻ PLAY AGAIN</button>
       <button class="btn" data-action="menu">MENU</button>`,
    );
  }

  showVictory(stats: EndOfGameStats): void {
    this.mountCard(
      'victory',
      `<div class="banner-title gold">🏆 AREA DEFENDED!</div>
       <div class="game-subtitle">You survived all 10 waves</div>
        <div class="stat-list">
          <div class="stat-row"><span>Waves survived</span><strong>10</strong></div>
          <div class="stat-row"><span>Enemies defeated</span><strong>${stats.kills}</strong></div>
          <div class="stat-row"><span>Gold earned</span><strong>${stats.goldEarned}</strong></div>
          <div class="stat-row"><span>Best wave</span><strong>${stats.highestWave}</strong></div>
        </div>
        <button class="btn btn-primary btn-big" data-action="restart">↻ PLAY AGAIN</button>
        <button class="btn" data-action="menu">MENU</button>`,
    );
  }

  bindEndOfGameActions(onRestart: () => void, onMenu: () => void): void {
    this.overlayRoot.querySelector('[data-action="restart"]')?.addEventListener('click', onRestart);
    this.overlayRoot.querySelector('[data-action="menu"]')?.addEventListener('click', onMenu);
  }

  // ---------------------------------------------------------- support modal

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        try {
          const orient = screen.orientation as ScreenOrientation & {
            lock?: (orientation: string) => Promise<void>;
          };
          await orient.lock?.('landscape');
        } catch {
          /* orientation lock only works in fullscreen on Android — ignore */
        }
      }
    } catch {
      /* fullscreen unavailable — play on in normal mode */
    }
  }

  showSupport(): void {
    this.supportBackdrop.classList.remove('hidden');
  }

  hideSupport(): void {
    this.supportBackdrop.classList.add('hidden');
  }

  private async copyPayoneer(): Promise<void> {
    const id = document.getElementById('payoneer-id-number')?.textContent?.trim() ?? '24076084';
    try {
      await navigator.clipboard.writeText(id);
      this.payoneerLabel.textContent = '✅ Copied!';
    } catch {
      this.payoneerLabel.textContent = id;
    }
    window.setTimeout(() => {
      this.payoneerLabel.textContent = '📋 Copy';
    }, 1800);
  }

  banner(text: string, ms = 2200): void {
    if (this.bannerEl) this.bannerEl.remove();
    window.clearTimeout(this.bannerTimer);
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.textContent = text;
    this.overlayRoot.appendChild(banner);
    this.bannerEl = banner;
    this.bannerTimer = window.setTimeout(() => {
      banner.remove();
      if (this.bannerEl === banner) this.bannerEl = null;
    }, ms);
  }
}
