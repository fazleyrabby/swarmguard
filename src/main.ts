/**
 * Swarmguard boot (spec §87): load settings -> create Pixi Renderer ->
 * construct WorldView + EntityView + Effects -> create Game -> wire UI
 * events -> run the game loop on the Pixi ticker.
 *
 * Rendering/UI boundary (spec §75–76): PixiJS owns map, towers, enemies,
 * projectiles, particles and range previews; HTML/CSS owns HUD, buttons,
 * menus, panels and settings. The simulation never touches the DOM.
 *
 * Debug overlay (F3) and dev cheats (F1/F2/F4/F5) are only registered
 * in development builds (import.meta.env.DEV).
 */

import './styles/main.css';
import { AudioManager } from './audio/AudioManager';
import { BASE } from './config/map';
import { ENEMIES } from './config/enemies';
import type { WaveDefinition } from './config/waves';
import { Game, type SpeedSetting } from './game/Game';
import { GameStatus, createInitialState } from './game/GameState';
import { addGold } from './game/systems/EconomySystem';
import { makeEnemy } from './game/systems/SpawnSystem';
import { Renderer } from './rendering/Renderer';
import { WorldView } from './rendering/WorldView';
import { EntityView, type RenderEnemy, type RenderProjectile, type RenderTower } from './rendering/EntityView';
import { Effects } from './rendering/Effects';
import { HUD, type GameSettings } from './ui/HUD';
import { Panels } from './ui/Panels';

const SETTINGS_KEY = 'swarmguard:settings';

const DEFAULT_SETTINGS: GameSettings = {
  sound: true,
  music: false,
  shake: true,
  damageNumbers: true,
};

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — play on with defaults */
  }
}

function requireEl<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[swarmguard] missing element #${id}`);
  return node as T;
}

/** Adapt sim state to the entity view's structural types (adds kind/angle). */
function toRenderState(game: Game): {
  enemies: RenderEnemy[];
  towers: RenderTower[];
  projectiles: RenderProjectile[];
} {
  const s = game.state;
  return {
    enemies: s.enemies,
    towers: s.towers.map((t) => ({
      id: t.id,
      kind: t.type,
      x: t.x,
      y: t.y,
      level: t.level,
      angle: t.angle,
    })),
    projectiles: s.projectiles.map((p) => ({
      id: p.id,
      kind: p.kind,
      x: p.x,
      y: p.y,
      angle: Math.atan2(p.vy, p.vx),
    })),
  };
}

async function boot(): Promise<void> {
  const gameContainer = requireEl('game');
  const panelSlot = requireEl('panel-slot');
  const debugEl = requireEl('debug-overlay');

  const settings = loadSettings();

  // ------------------------------------------------------------ audio
  const audio = new AudioManager();
  audio.setMuted(!settings.sound);
  audio.setMusicEnabled(settings.music);
  // Browsers require a user gesture before AudioContext may start.
  window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
  window.addEventListener('keydown', () => audio.unlock());

  // ---------------------------------------------------------- rendering
  const renderer = await Renderer.create(gameContainer);
  if (!renderer?.app?.renderer) throw new Error('[swarmguard] Renderer.create did not produce app.renderer');
  const game = new Game();
  const worldView = new WorldView(renderer, game);
  const entityView = new EntityView(
    renderer.layers.enemy,
    renderer.layers.tower,
    renderer.layers.projectile,
  );
  entityView.init(renderer.app);
  const effects = new Effects(renderer.layers.effects, renderer.layers.overlay);
  effects.init(renderer.app);
  effects.onShake = (trauma: number) => renderer.addShake(trauma);
  renderer.setShakeEnabled(settings.shake);
  effects.setDamageNumbersEnabled(settings.damageNumbers);

  // ----------------------------------------------------------------- UI
  const hud = new HUD(
    {
      onPlay: () => {
        audio.unlock();
        audio.play('click');
        game.startGame();
        hud.hideMenu();
        hud.showPreparation(1);
        panels.close();
      },
      onStartWave: () => {
        audio.unlock();
        const ok = game.startWave();
        if (!ok) audio.play('error');
        panels.close();
      },
      onContinue: () => {
        audio.play('click');
        hud.showPreparation(game.state.wave + 1);
      },
      onRestart: () => restartRun(),
      onPause: () => {
        togglePause();
        audio.play('click');
      },
      onSpeed: (speed: SpeedSetting) => game.setSpeed(speed),
      onMuteToggle: () => {
        audio.unlock();
        audio.setMuted(!audio.isMuted());
        settings.sound = !audio.isMuted();
        saveSettings(settings);
      },
      onSettingsChange: (next: GameSettings) => {
        Object.assign(settings, next);
        saveSettings(settings);
        audio.setMuted(!settings.sound);
        audio.setMusicEnabled(settings.music);
        renderer.setShakeEnabled(settings.shake);
        effects.setDamageNumbersEnabled(settings.damageNumbers);
      },
    },
    settings,
  );

  const panels = new Panels(panelSlot, game, audio, {
    showRange: (x, y, r) => worldView.showRange(x, y, r),
    hideRange: () => worldView.hideRange(),
  });
  panels.bindKeyboard({
    onTogglePause: () => togglePause(),
    onSpeed: (speed: SpeedSetting) => game.setSpeed(speed),
  });

  function togglePause(): void {
    if (game.state.status === GameStatus.PAUSED) game.resume();
    else game.pause();
  }

  // ------------------------------------------------------- picking
  // Build slots are handled by WorldView's own slot plates (mouse + touch
  // via Pixi pointer events). Towers need a canvas-level picker: it runs
  // after Pixi's dispatch, and skips when the panel already shows the
  // tower (avoids a double click sound when a plate sits under a tower).
  const TOWER_HIT_R = 30;
  renderer.app.canvas.addEventListener('pointerup', (e: PointerEvent) => {
    if (renderer.wasDrag()) return;
    if (game.state.status === GameStatus.MENU) return;
    const rect = renderer.app.canvas.getBoundingClientRect();
    const { x, y } = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    let bestId: string | null = null;
    let bestD2 = TOWER_HIT_R * TOWER_HIT_R;
    for (const t of game.state.towers) {
      const d2 = (t.x - x) ** 2 + (t.y - y) ** 2;
      if (d2 <= bestD2) {
        bestD2 = d2;
        bestId = t.id;
      }
    }
    if (bestId && panels.openTowerId !== bestId) {
      panels.openUpgrade(bestId);
    }
  });

  worldView.onSlotClick = (slotId: string) => {
    if (renderer.wasDrag()) return;
    const slot = game.state.buildSlots.find((s) => s.id === slotId);
    if (!slot) return;
    if (slot.occupied && slot.towerId) panels.openUpgrade(slot.towerId);
    else if (!slot.occupied) panels.openBuild(slotId);
  };
  worldView.onEmptyClick = () => {
    if (renderer.wasDrag()) return;
    panels.close();
  };

  // ------------------------------------------------------- game events
  game.events.on('tower:fired', (payload) => {
    const { towerId } = payload as { towerId: string; targetId: number };
    const tower = game.state.towers.find((t) => t.id === towerId);
    if (!tower) return;
    entityView.kickTower(towerId);
    if (tower.type === 'crossbow') {
      effects.arrowSnap(tower.x, tower.y, tower.angle);
      audio.play('crossbow-fire');
    } else if (tower.type === 'cannon') {
      effects.muzzle(tower.x, tower.y, tower.angle, true);
      audio.play('cannon-fire');
    } else {
      effects.muzzle(tower.x, tower.y, tower.angle, false);
      audio.play('bomb-fire');
    }
  });

  game.events.on('enemy:killed', (payload) => {
    const enemy = payload as { x: number; y: number; reward: number; type: keyof typeof ENEMIES };
    effects.deathPop(enemy.x, enemy.y, ENEMIES[enemy.type]?.color ?? 0x4ade80);
    effects.gold(enemy.x, enemy.y, enemy.reward ?? 0);
    audio.play('enemy-death');
  });

  game.events.on('base:damaged', () => {
    effects.baseHit(BASE.x, BASE.y);
    audio.play('base-hit');
  });

  game.events.on('wave:started', (payload) => {
    const def = payload as WaveDefinition;
    hud.showWaveBanner(def.wave, def.totalEnemies);
    panels.close();
  });

  game.events.on('wave:completed', (payload) => {
    const info = payload as { wave: number; kills: number; goldEarned: number; reward: number };
    hud.setHighestWave(game.bestWave);
    hud.showWaveComplete({ ...info, gold: info.goldEarned, totalGold: game.state.gold });
    audio.play('wave-complete');
    panels.close();
  });

  game.events.on('tower:built', (payload) => {
    const tower = payload as { id: string; x: number; y: number };
    effects.place(tower.x, tower.y);
    worldView.refreshSlots();
    audio.play('tower-place');
    panels.refresh();
  });

  game.events.on('tower:upgraded', () => {
    audio.play('tower-upgrade');
    panels.refresh();
  });

  game.events.on('gold:changed', () => {
    panels.refresh();
  });

  const finishRun = (victory: boolean): void => {
    const s = game.state;
    panels.close();
    worldView.hideRange();
    const stats = {
      wave: s.wave,
      kills: s.totalKills,
      goldEarned: s.totalGoldEarned,
      highestWave: game.bestWave,
    };
    if (victory) {
      hud.showVictory(stats);
      audio.play('victory');
    } else {
      hud.showGameOver(stats);
      audio.play('game-over');
    }
    hud.bindEndOfGameActions(
      () => restartRun(),
      () => {
        audio.play('click');
        hud.showMenu();
      },
    );
  };
  game.events.on('game:over', () => finishRun(false));
  game.events.on('victory', () => finishRun(true));

  function restartRun(): void {
    audio.play('click');
    // Reset state in place: views, panels and subscriptions all hold this
    // Game instance, so no re-wiring is needed.
    // Clear stale FX maps first so old HP/projectile ids don't leak into the new run.
    prevHp.clear();
    prevProjectiles.clear();
    hud.clearOverlays();
    Object.assign(game.state, createInitialState(game.state.seed));
    game.startGame();
    worldView.refreshSlots();
    worldView.hideRange();
    panels.close();
    hud.setHighestWave(game.bestWave);
    hud.hideMenu();
    hud.showPreparation(1);
  }

  // -------------------------------------------------------------- debug
  const isDev = import.meta.env.DEV;
  if (isDev) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        debugEl.classList.toggle('hidden');
      } else if (e.key === 'F1') {
        e.preventDefault();
        const s = game.state;
        if (s.status === GameStatus.WAVE_ACTIVE) {
          s.enemies.push(makeEnemy('grunt', s.waveHpMult, s.waveSpeedMult));
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        addGold(game.state, 500, game.events);
      } else if (e.key === 'F4' || e.key === 'F5') {
        e.preventDefault();
        const s = game.state;
        if (s.status !== GameStatus.WAVE_ACTIVE) return;
        if (e.key === 'F4') s.spawnQueue = [];
        for (const enemy of s.enemies) enemy.alive = false;
      }
    });
  }

  // ---------------------------------------------------------- game loop
  hud.setHighestWave(game.bestWave);
  hud.showMenu();

  // Previous-frame maps for one-shot FX the sim doesn't emit events for:
  // floating damage numbers (HP deltas) and splash impact blasts.
  const prevHp = new Map<number, { x: number; y: number; hp: number }>();
  const prevProjectiles = new Map<number, { x: number; y: number; kind: string; splash: number }>();

  renderer.app.ticker.add(() => {
    const rawDt = Math.min(Math.max(renderer.app.ticker.deltaMS / 1000, 0), 0.1);
    game.update(rawDt);
    const state = game.state;

    for (const e of state.enemies) {
      if (!e.alive) continue;
      const prev = prevHp.get(e.id);
      if (prev && e.hp < prev.hp) {
        effects.damage(e.x, e.y - 6, prev.hp - e.hp);
      }
      prevHp.set(e.id, { x: e.x, y: e.y, hp: e.hp });
    }
    if (prevHp.size > state.enemies.length + 40) {
      const alive = new Set(state.enemies.map((e) => e.id));
      for (const id of [...prevHp.keys()]) {
        if (!alive.has(id)) prevHp.delete(id);
      }
    }

    const curProjectiles = new Map<number, { x: number; y: number; kind: string; splash: number }>();
    for (const p of state.projectiles) {
      curProjectiles.set(p.id, { x: p.x, y: p.y, kind: p.kind, splash: p.splashRadius ?? 0 });
    }
    for (const [id, prev] of prevProjectiles) {
      if (!curProjectiles.has(id) && prev.splash > 0) {
        if (prev.kind === 'bomb') effects.bombBlast(prev.x, prev.y, prev.splash);
        else effects.cannonBlast(prev.x, prev.y, prev.splash);
        audio.play('explosion');
      }
    }
    prevProjectiles.clear();
    for (const [id, info] of curProjectiles) prevProjectiles.set(id, info);

    worldView.sync();
    const rs = toRenderState(game);
    entityView.sync(rs.enemies, rs.towers, rs.projectiles, rawDt, state.time);
    effects.update(rawDt, state.time);
    hud.update(state, {
      paused: state.status === GameStatus.PAUSED,
      muted: audio.isMuted(),
    });

    if (isDev && !debugEl.classList.contains('hidden')) {
      const fps = Math.round(1000 / Math.max(renderer.app.ticker.deltaMS, 0.01));
      const alive = state.enemies.filter((e) => e.alive).length;
      debugEl.textContent =
        `FPS ${fps} | enemies ${alive} | towers ${state.towers.length} | ` +
        `projectiles ${state.projectiles.length} | wave ${state.wave} | t ${state.time.toFixed(1)}s\n` +
        `F1 spawn • F2 +gold • F3 overlay • F4 skip wave • F5 kill all`;
    }
  });
}

boot().catch((err) => {
  console.error('[swarmguard] boot failed', err);
  const status = document.getElementById('status-text');
  if (status) status.textContent = `Boot failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
});
