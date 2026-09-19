# 🏰 Swarmguard

A colorful, top-down tower-defense game for the browser. Place towers around the path, pop increasingly ridiculous monster swarms, and keep your castle core alive.

Built with **PixiJS + TypeScript + Vite**. No backend, no accounts, no external assets.

## Features

- **Three tower types** — Crossbow (fast single-target), Cannon (heavy splash), Bomb Tower (large AoE + slow).
- **5 upgrade levels** per tower, with live stat/cost previews and a sell-for-70% option.
- **Three enemy types** — Grunt, Runner, Tank — with distinct HP, speed, damage and bounty.
- **Boss waves** — every 10th wave sends a Warlord: huge HP, an always-visible health bar, and a screen-shaking death.
- **10 hand-tuned waves** plus an **endless mode** with scaling HP/speed and a growing Tank share.
- **Four targeting modes** — First, Nearest, Strongest, Weakest.
- **Game feel** — particles, screen shake, floating damage numbers, hit/death FX, generated WebAudio sound effects.
- **Polish** — responsive full-height layout, fullscreen toggle, portrait zoom, settings, pause/speed controls (1x–3x), game-over and victory screens, highest-wave persistence.
- **Performance** — baked textures, pooled sprites/projectiles, waypoint movement (no per-enemy pathfinding), targeting 60 FPS with 300+ enemies.

## Tech stack

| Layer         | Choice                                  |
| ------------- | --------------------------------------- |
| Language      | TypeScript                              |
| Build/dev     | Vite                                    |
| Rendering     | PixiJS (WebGL/WebGPU)                   |
| UI / HUD      | HTML + CSS (menus, panels, settings)    |
| Audio         | Web Audio API (procedurally generated)  |
| Tests         | Vitest                                  |
| Simulation    | Headless autosim script (tsx)           |

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL (default <http://localhost:5173>).

## Scripts

| Command         | Description                                              |
| --------------- | -------------------------------------------------------- |
| `npm run dev`   | Start the Vite dev server.                               |
| `npm run build` | Type-check (`tsc --noEmit`) and build for production.    |
| `npm run preview` | Serve the production build locally.                    |
| `npm test`      | Run the Vitest sim/unit tests.                           |
| `npm run sim`   | Run the headless autosim (`scripts/autosim.ts`).         |

## Controls

| Input              | Action                                    |
| ------------------ | ----------------------------------------- |
| Click build pad    | Open the build menu for that slot         |
| Click tower        | Open the upgrade / sell panel             |
| `Space`            | Pause / resume                            |
| `1` / `2` / `3`    | Game speed 1x / 2x / 3x                   |
| `Esc`              | Close the current panel                   |

### Dev-only cheats (`F` keys)

Only registered in development builds.

| Key  | Action                          |
| ---- | ------------------------------- |
| `F1` | Spawn a Grunt (during a wave)   |
| `F2` | Add 500 gold                    |
| `F3` | Toggle the debug overlay (FPS, entity counts) |
| `F4` | Skip the current wave           |
| `F5` | Kill all enemies                |

## Architecture

The simulation is DOM-free and data-driven; rendering is a separate read layer.

```
              GAME LOGIC (src/game, src/config)
                        │
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
     Entities        Systems          State
        │               │               │
        └───────────────┼───────────────┘
                        ↓
              Rendering (src/rendering)
                        ↓
                     PixiJS
                        ↓
                     Canvas
```

HUD, menus and panels (`src/ui`) communicate with game state and events only — the simulation never touches the DOM.

### Project structure

```
src/
  audio/       AudioManager — generated sound effects
  config/      Data: map, towers, enemies, waves
  game/        Entities, state, event bus, RNG, Game loop
    systems/   Combat, economy, movement, projectiles, spawn, targeting, upgrades, waves
  rendering/   Renderer, WorldView, EntityView, Effects
  ui/          HUD and side panels
  styles/      CSS
scripts/
  autosim.ts   Headless balance simulation
```

All tower, enemy and wave balancing lives in `src/config/*` and is data-driven — tune the game without touching systems.

## Testing

```bash
npm test        # Vitest unit tests for waves, economy, targeting, game flow
npm run sim     # Headless simulation of a full run
```

## Credits

Made by [fazleyrabbi](https://fazleyrabbi.xyz). If you enjoy the game, you can support development from the in-game support modal.
