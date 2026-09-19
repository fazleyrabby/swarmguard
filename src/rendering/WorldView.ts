import * as PIXI from 'pixi.js';
import { DEFAULT_MAP, type MapDefinition } from '../config/maps';
import type { Game } from '../game/Game';
import type { Renderer } from './Renderer';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPath(x: number, y: number, path: { x: number; y: number }[]): number {
  let d = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    d = Math.min(d, distToSegment(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y));
  }
  return d;
}

interface SlotNode {
  root: PIXI.Container;
  plate: PIXI.Graphics;
  label: PIXI.Text;
  occupied: boolean;
  hovered: boolean;
}

/**
 * Static miniature-diorama world (spec §37–38): grass with noise dots,
 * thick rounded dirt path with border, trees/rocks/bushes/water ponds,
 * glowing CORE base with HP ring, dashed rounded build-slot plates.
 *
 * Static art is drawn ONCE. `sync()` (called from the ticker in main.ts)
 * pulses the core glow, shimmers water, redraws the HP ring only when HP
 * changes, and refreshes the range preview. Slot plates are Pixi-interactive
 * (mouse + touch via pointer events, spec §67) and report through
 * `onSlotClick`; background clicks report through `onEmptyClick`.
 */
export class WorldView {
  onSlotClick: ((slotId: string) => void) | null = null;
  onEmptyClick: (() => void) | null = null;

  private renderer: Renderer;
  private game: Game;
  private def: MapDefinition;

  private baseBar = new PIXI.Graphics();
  private baseGlowA: PIXI.Sprite | null = null;
  private baseGlowB: PIXI.Sprite | null = null;
  private baseCrystal: PIXI.Container | null = null;
  private waterGlints: PIXI.Container[] = [];
  private lanternGlows: { sprite: PIXI.Sprite; phase: number }[] = [];
  private slots = new Map<string, SlotNode>();
  private rangeG = new PIXI.Graphics();
  private rangeTarget: { x: number; y: number; r: number } | null = null;
  private lastHpFrac = -1;
  private glowCache: PIXI.Texture | null = null;
  private vignetteCache: PIXI.Texture | null = null;

  private vignetteTexture(): PIXI.Texture {
    if (this.vignetteCache) return this.vignetteCache;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(128, 80, 60, 128, 80, 165);
    grad.addColorStop(0, 'rgba(20,16,40,0)');
    grad.addColorStop(1, 'rgba(20,16,40,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 160);
    this.vignetteCache = PIXI.Texture.from(canvas);
    return this.vignetteCache;
  }

  constructor(renderer: Renderer, game: Game, def: MapDefinition = DEFAULT_MAP) {
    this.renderer = renderer;
    this.game = game;
    this.def = def;
    this.build();
  }

  /** Swap to another map and rebuild all static art (used by map select). */
  setMap(def: MapDefinition): void {
    this.def = def;
    this.slots.clear();
    this.build();
  }

  /** Per-frame visual sync (called from the Pixi ticker in main.ts). */
  sync(): void {
    const time = performance.now() / 1000;
    const s = this.game.state;
    this.setBaseHp(s.baseHp, s.baseMaxHp);

    if (this.baseGlowA && this.baseGlowB) {
      const p = 0.5 + 0.5 * Math.sin(time * 2.2);
      this.baseGlowA.alpha = 0.22 + p * 0.12;
      this.baseGlowB.alpha = 0.12 + p * 0.1;
      this.baseGlowA.scale.set(1 + Math.sin(time * 2.2) * 0.03);
      this.baseGlowB.scale.set(1 + (1 - p) * 0.05);
    }
    if (this.baseCrystal) {
      this.baseCrystal.position.y = Math.sin(time * 1.8) * 3;
      this.baseCrystal.rotation = Math.sin(time * 0.9) * 0.08;
    }
    for (let i = 0; i < this.waterGlints.length; i++) {
      this.waterGlints[i].alpha = 0.6 + 0.4 * Math.sin(time * 1.5 + i * 1.7);
    }
    // Lantern flame flicker: warm, natural, never fully out.
    for (const l of this.lanternGlows) {
      const f = Math.sin(time * 7 + l.phase) * 0.5 + Math.sin(time * 13 + l.phase * 2) * 0.5;
      l.sprite.alpha = 0.46 + f * 0.08;
      const s = 1 + f * 0.03;
      l.sprite.scale.set(s);
    }
  }

  /** Re-read slot occupancy from game state (after build / restart). */
  refreshSlots(): void {
    for (const slot of this.game.state.buildSlots) {
      const node = this.slots.get(slot.id);
      if (node && node.occupied !== slot.occupied) {
        node.occupied = slot.occupied;
        this.redrawPlate(node);
      }
    }
  }

  setSlotOccupied(id: string, occupied: boolean): void {
    const node = this.slots.get(id);
    if (!node || node.occupied === occupied) return;
    node.occupied = occupied;
    this.redrawPlate(node);
  }

  highlightSlot(id: string | null): void {
    for (const [key, s] of this.slots) {
      const hovered = key === id;
      if (s.hovered !== hovered) {
        s.hovered = hovered;
        this.redrawPlate(s);
      }
    }
  }

  /** Tower range preview while selected/placing (spec §64). World coords. */
  showRange(x: number, y: number, radius: number): void {
    this.rangeTarget = { x, y, r: radius };
    this.redrawRange();
  }

  hideRange(): void {
    this.rangeTarget = null;
    this.rangeG.clear();
  }

  // ---- build (once) ----

  private build(): void {
    const L = this.renderer.layers;
    L.background.removeChildren();
    L.map.removeChildren();
    L.buildSlot.removeChildren();
    L.overlay.removeChildren();
    this.slots.clear();
    this.waterGlints = [];
    this.lanternGlows = [];

    this.drawGrass(L.background);
    this.drawPath(L.map, this.def.path);
    this.drawDecorations(L.map, this.def);
    this.drawBase(L.map, this.def.base);
    this.drawSlots(L.buildSlot, this.def.buildSlots);
    L.overlay.addChild(this.rangeG);
    // Soft vignette over the whole world: focus pull to the battlefield.
    const vig = new PIXI.Sprite(this.vignetteTexture());
    vig.eventMode = 'none';
    vig.width = this.def.world.width;
    vig.height = this.def.world.height;
    vig.alpha = 0.55;
    L.overlay.addChild(vig);
    // Range preview must draw above the vignette.
    L.overlay.removeChild(this.rangeG);
    L.overlay.addChild(this.rangeG);
  }

  /** Floating castle HP bar above the keep. Redrawn only on HP change. */
  private setBaseHp(hp: number, maxHp: number): void {
    const frac = Math.min(1, Math.max(0, maxHp > 0 ? hp / maxHp : 0));
    if (Math.abs(frac - this.lastHpFrac) < 0.001) return;
    this.lastHpFrac = frac;
    const g = this.baseBar;
    g.clear();
    const w = 150;
    const h = 15;
    const x = -w / 2;
    const y = 0;
    g.roundRect(x - 3, y - 3, w + 6, h + 6, 8).fill({ color: 0x2b2440, alpha: 0.85 });
    g.roundRect(x, y, w, h, 6).fill({ color: 0x565064 });
    const color = frac > 0.55 ? 0x4ade80 : frac > 0.25 ? 0xfbbf24 : 0xef4444;
    if (frac > 0.001) {
      g.roundRect(x + 2, y + 2, Math.max(4, (w - 4) * frac), h - 4, 4).fill({ color });
    }
    // Gloss tick.
    g.roundRect(x + 5, y + 3.5, Math.max(0, (w - 10) * frac), 3, 1.5).fill({ color: 0xffffff, alpha: 0.45 });
  }

  private redrawRange(): void {
    const t = this.rangeTarget;
    if (!t) return;
    const g = this.rangeG;
    g.clear();
    g.circle(t.x, t.y, t.r).fill({ color: 0xffffff, alpha: 0.1 });
    g.circle(t.x, t.y, t.r).stroke({ width: 2.5, color: 0xffffff, alpha: 0.7 });
    g.circle(t.x, t.y, 6).fill({ color: 0xffffff, alpha: 0.8 });
  }

  private drawGrass(layer: PIXI.Container): void {
    const th = this.def.theme;
    const W = this.def.world.width;
    const H = this.def.world.height;
    // Oversized backdrop so letterbox bars show ground, not flat color.
    const backdrop = new PIXI.Graphics();
    backdrop.eventMode = 'none';
    backdrop.rect(-800, -800, W + 1600, H + 1600).fill({ color: th.backdrop });
    layer.addChild(backdrop);

    const g = new PIXI.Graphics();
    g.rect(0, 0, W, H).fill({ color: th.ground });
    // Whole-background click target for empty-space dismissal.
    g.eventMode = 'static';
    g.hitArea = new PIXI.Rectangle(0, 0, W, H);
    g.on('pointerdown', () => this.onEmptyClick?.());
    layer.addChild(g);

    const rand = mulberry32(1337);
    const dots = new PIXI.Graphics();
    dots.eventMode = 'none';
    for (let i = 0; i < 520; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const r = 2 + rand() * 4.5;
      dots.ellipse(x, y, r * 1.4, r).fill({ color: rand() < 0.5 ? th.dotA : th.dotB, alpha: 0.55 });
    }
    layer.addChild(dots);

    // Large soft two-tone ground patches (ref: autumn pack color-blocking).
    const patches = new PIXI.Graphics();
    patches.eventMode = 'none';
    for (let i = 0; i < 26; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const rx = 60 + rand() * 130;
      const ry = 40 + rand() * 80;
      patches.ellipse(x, y, rx, ry).fill({ color: i % 2 ? th.patchA : th.patchB, alpha: 0.35 });
    }
    layer.addChild(patches);

    // Grass tufts: 3-blade strokes + tiny clover/flowers (ref: pixel camp ground cover).
    const tufts = new PIXI.Graphics();
    tufts.eventMode = 'none';
    for (let i = 0; i < 240; i++) {
      const x = 20 + rand() * (W - 40);
      const y = 20 + rand() * (H - 40);
      const s = 3 + rand() * 3;
      const c = rand() < 0.7 ? th.tuftA : th.tuftB;
      tufts.poly([x - s, y, x - s * 0.4, y - s * 1.6]).stroke({ width: 2, color: c, cap: 'round' });
      tufts.poly([x + s, y, x + s * 0.4, y - s * 1.6]).stroke({ width: 2, color: c, cap: 'round' });
      tufts.poly([x, y, x, y - s * 2]).stroke({ width: 2, color: c, cap: 'round' });
      const roll = rand();
      if (roll > 0.93) {
        // 5-petal flower accent pop.
        const fc = [0xffffff, 0xf9a8d4, 0xfde047][Math.floor(rand() * 3)];
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2;
          tufts.circle(x + Math.cos(a) * 3, y - s * 2 + Math.sin(a) * 3, 2.2).fill({ color: fc });
        }
        tufts.circle(x, y - s * 2, 2).fill({ color: 0xf59e0b });
      } else if (roll > 0.88) {
        // Clover: 3 dots.
        tufts.circle(x - 2.5, y - 1, 2).fill({ color: 0x37a05c });
        tufts.circle(x + 2.5, y - 1, 2).fill({ color: 0x37a05c });
        tufts.circle(x, y - 3.5, 2).fill({ color: 0x4ade80 });
      }
    }
    layer.addChild(tufts);

    const frame = new PIXI.Graphics();
    frame.eventMode = 'none';
    frame.rect(0, 0, W, H).stroke({ width: 18, color: th.frame });
    frame.rect(9, 9, W - 18, H - 18).stroke({ width: 4, color: 0xffffff, alpha: 0.25 });
    layer.addChild(frame);
  }

  private drawPath(layer: PIXI.Container, path: { x: number; y: number }[]): void {
    const th = this.def.theme;
    const flat: number[] = [];
    for (const p of path) flat.push(p.x, p.y);
    const g = new PIXI.Graphics();
    g.eventMode = 'none';
    g.poly(flat).stroke({ width: 74, color: th.pathEdge, alpha: 0.35, cap: 'round', join: 'round' });
    g.poly(flat).stroke({ width: 64, color: th.pathBorder, cap: 'round', join: 'round' });
    g.poly(flat).stroke({ width: 48, color: th.pathFill, cap: 'round', join: 'round' });
    layer.addChild(g);

    const pebbles = new PIXI.Graphics();
    pebbles.eventMode = 'none';
    const rand = mulberry32(77);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.floor(len / 46);
      for (let sIdx = 0; sIdx <= steps; sIdx++) {
        const t = steps === 0 ? 0.5 : sIdx / steps;
        pebbles
          .ellipse(
            a.x + (b.x - a.x) * t + (rand() - 0.5) * 26,
            a.y + (b.y - a.y) * t + (rand() - 0.5) * 26,
            4 + rand() * 4,
            3 + rand() * 3,
          )
          .fill({ color: th.pebble, alpha: 0.8 });
      }
      // Cobble edge stones along both borders (ref: defined walkable lanes).
      const nx = -(b.y - a.y) / (len || 1);
      const ny = (b.x - a.x) / (len || 1);
      const edgeSteps = Math.floor(len / 44);
      for (let sIdx = 0; sIdx <= edgeSteps; sIdx++) {
        const t = edgeSteps === 0 ? 0.5 : sIdx / edgeSteps;
        const cx = a.x + (b.x - a.x) * t;
        const cy = a.y + (b.y - a.y) * t;
        for (const side of [-1, 1]) {
          const sx = cx + nx * side * (36 + (rand() - 0.5) * 6);
          const sy = cy + ny * side * (36 + (rand() - 0.5) * 6);
          const r = 5 + rand() * 3.5;
          pebbles.ellipse(sx, sy + 2, r, r * 0.6).fill({ color: th.pathEdge, alpha: 0.3 });
          pebbles.circle(sx, sy, r).fill({ color: 0xcfc4ae });
          pebbles.circle(sx, sy, r).stroke({ width: 2, color: 0x9a917f });
          pebbles.circle(sx - r * 0.25, sy - r * 0.25, r * 0.35).fill({ color: 0xe8e0cf });
        }
      }
    }
    layer.addChild(pebbles);
  }

  private drawDecorations(layer: PIXI.Container, def: MapDefinition): void {
    const rand = mulberry32(20240);
    const clearOf = (x: number, y: number, pad: number): boolean => {
      if (distToPath(x, y, def.path) < pad) return false;
      if (Math.hypot(x - def.base.x, y - def.base.y) < def.base.radius + 110) return false;
      for (const s of def.buildSlots) {
        if (Math.hypot(x - s.x, y - s.y) < 70) return false;
      }
      return true;
    };
    const place = (count: number, pad: number, fn: (x: number, y: number, r: number) => void) => {
      let placed = 0;
      let guard = 0;
      while (placed < count && guard++ < count * 40) {
        const x = 50 + rand() * (def.world.width - 100);
        const y = 50 + rand() * (def.world.height - 100);
        if (!clearOf(x, y, pad)) continue;
        fn(x, y, rand());
        placed++;
      }
    };

    place(3, 90, (x, y) => {
      const pond = new PIXI.Graphics();
      pond.eventMode = 'none';
      pond.ellipse(x, y, 64, 42).fill({ color: 0x5aa9d6 });
      pond.ellipse(x, y, 56, 35).fill({ color: 0x6ec6f0 });
      const glint = new PIXI.Container();
      glint.eventMode = 'none';
      const gg = new PIXI.Graphics();
      gg.ellipse(-12, -8, 22, 8).fill({ color: 0xffffff, alpha: 0.55 });
      glint.addChild(gg);
      glint.position.set(x, y);
      layer.addChild(pond, glint);
      this.waterGlints.push(glint);
    });

    place(14, 62, (x, y, r) => {
      const t = new PIXI.Graphics();
      t.eventMode = 'none';
      t.ellipse(x, y + 20, 26, 9).fill({ color: 0x3f6b28, alpha: 0.3 });
      t.rect(x - 5, y - 2, 10, 24).fill({ color: 0x8a5a3b });
      t.circle(x - 10, y - 12, 20).fill({ color: 0x3e9e4f });
      t.circle(x + 12, y - 16, 24).fill({ color: 0x46b15a });
      t.circle(x + 4, y - 26, 10).fill({ color: 0x7ede8a, alpha: 0.9 });
      if (r > 0.6) {
        t.circle(x - 18, y - 22, 6).fill({ color: 0x5cc46a });
        t.circle(x + 22, y - 8, 5).fill({ color: 0x5cc46a });
      }
      t.circle(x - 10, y - 12, 20).stroke({ width: 3, color: 0x2c6e38 });
      t.circle(x + 12, y - 16, 24).stroke({ width: 3, color: 0x2c6e38 });
      layer.addChild(t);
    });

    place(10, 58, (x, y, r) => {
      const rock = new PIXI.Graphics();
      rock.eventMode = 'none';
      const s = 14 + r * 14;
      rock.ellipse(x, y + s * 0.5, s * 1.1, s * 0.35).fill({ color: 0x3f6b28, alpha: 0.3 });
      rock.roundRect(x - s, y - s * 0.7, s * 2, s * 1.4, s * 0.55).fill({ color: 0xb8c0cc });
      rock.roundRect(x - s, y - s * 0.7, s * 2, s * 1.4, s * 0.55).stroke({ width: 3, color: 0x8f99a8 });
      rock.ellipse(x - s * 0.3, y - s * 0.25, s * 0.5, s * 0.28).fill({ color: 0xd7dde6 });
      layer.addChild(rock);
    });

    place(16, 56, (x, y, r) => {
      // Bush cluster: 3–5 rounded blobs, never a lonely single (ref: foliage groups).
      const b = new PIXI.Graphics();
      b.eventMode = 'none';
      const s = 10 + r * 10;
      b.ellipse(x, y + s * 0.7, s * 1.9, s * 0.55).fill({ color: 0x3f6b28, alpha: 0.3 });
      const puffs: [number, number, number][] = [
        [0, 0, 1], [-0.9, 0.15, 0.72], [0.9, 0.15, 0.72],
        [-0.45, -0.45, 0.8], [0.45, -0.45, 0.8],
      ];
      for (const [ox, oy, k] of puffs) {
        const px = x + ox * s;
        const py = y + oy * s;
        b.circle(px, py, s * 0.66 * k).fill({ color: 0x3f8f4e });
        b.circle(px, py, s * 0.66 * k).stroke({ width: 2.5, color: 0x2c6e38 });
      }
      b.circle(x - s * 0.2, y - s * 0.5, s * 0.24).fill({ color: 0xa9e8b2 });
      b.circle(x + s * 0.55, y - s * 0.3, s * 0.16).fill({ color: 0xa9e8b2, alpha: 0.9 });
      layer.addChild(b);
    });

    // Red-cap mushrooms: storybook accent pops (ref: pixel camp).
    place(9, 52, (x, y, r) => {
      const m = new PIXI.Graphics();
      m.eventMode = 'none';
      const n = 1 + Math.floor(r * 2.4);
      for (let i = 0; i < n; i++) {
        const mx = x + (r - 0.5) * 26 * (i - (n - 1) / 2);
        const my = y + (r - 0.5) * 10 * ((i % 2) * 2 - 1);
        const s = 5 + r * 4;
        m.ellipse(mx, my + s, s * 1.2, s * 0.4).fill({ color: 0x3f6b28, alpha: 0.3 });
        m.rect(mx - 2, my, 4, s).fill({ color: 0xf5ead2 });
        m.rect(mx - 2, my, 4, s).stroke({ width: 1.5, color: 0xb8a888 });
        m.circle(mx, my - 1, s).fill({ color: 0xef4444 });
        m.circle(mx, my - 1, s).stroke({ width: 2, color: 0x991b1b });
        m.circle(mx - s * 0.3, my - s * 0.4, s * 0.28).fill({ color: 0xffffff });
        m.circle(mx + s * 0.35, my + s * 0.1, s * 0.2).fill({ color: 0xffffff, alpha: 0.9 });
      }
      layer.addChild(m);
    });

    // Tree stumps with moss + rings.
    place(6, 60, (x, y, r) => {
      const st = new PIXI.Graphics();
      st.eventMode = 'none';
      const s = 12 + r * 8;
      st.ellipse(x, y + s * 0.7, s * 1.1, s * 0.35).fill({ color: 0x3f6b28, alpha: 0.3 });
      st.ellipse(x, y, s, s * 0.8).fill({ color: 0x8a5a3b });
      st.ellipse(x, y, s, s * 0.8).stroke({ width: 3, color: 0x5b3a22 });
      st.ellipse(x, y - 1, s * 0.72, s * 0.56).fill({ color: 0xd9b98c });
      st.ellipse(x, y - 1, s * 0.45, s * 0.34).stroke({ width: 2, color: 0xb08c5a });
      st.circle(x - s * 0.6, y + s * 0.25, s * 0.22).fill({ color: 0x58b368 });
      layer.addChild(st);
    });

    // Lantern posts beside the path: warm glow accents (ref: camp lantern).
    const lanternSpots: [number, number][] = [
      [525, 498], [950, 602], [950, 698], [150, 260], [620, 392],
    ];
    let lanterns = 0;
    for (const [lx, ly] of lanternSpots) {
      if (lanterns >= 4) break;
      if (distToPath(lx, ly, def.path) > 78) continue;
      let blocked = Math.hypot(lx - def.base.x, ly - def.base.y) < def.base.radius + 90;
      for (const s of def.buildSlots) {
        if (Math.hypot(lx - s.x, ly - s.y) < 58) blocked = true;
      }
      if (blocked) continue;
      this.drawLantern(layer, lx, ly);
      lanterns++;
    }
  }

  /** Wooden lantern post with flickering warm glow. Glow sprite pulses in sync(). */
  private drawLantern(layer: PIXI.Container, x: number, y: number): void {
    const g = new PIXI.Graphics();
    g.eventMode = 'none';
    g.ellipse(x, y + 22, 20, 7).fill({ color: 0x3f6b28, alpha: 0.3 });
    g.rect(x - 4, y - 6, 8, 30).fill({ color: 0x6b4226 });
    g.rect(x - 4, y - 6, 8, 30).stroke({ width: 2, color: 0x3f2412 });
    g.rect(x - 9, y - 30, 18, 26).fill({ color: 0x2b2440 });
    g.rect(x - 9, y - 30, 18, 26).stroke({ width: 2.5, color: 0x14101f });
    g.rect(x - 6, y - 27, 12, 20).fill({ color: 0xffd66e });
    g.poly([x - 11, y - 30, x + 11, y - 30, x, y - 40]).fill({ color: 0x8a5a3b });
    g.poly([x - 11, y - 30, x + 11, y - 30, x, y - 40]).stroke({ width: 2, color: 0x3f2412 });
    g.circle(x - 3, y - 20, 3).fill({ color: 0xfff6c9 });
    layer.addChild(g);
    const glow = new PIXI.Sprite(this.glowTexture());
    glow.anchor.set(0.5);
    glow.tint = 0xffc95e;
    glow.alpha = 0.5;
    glow.width = 150;
    glow.height = 150;
    glow.position.set(x, y - 16);
    glow.eventMode = 'none';
    layer.addChild(glow);
    this.lanternGlows.push({ sprite: glow, phase: Math.random() * Math.PI * 2 });
  }

  private drawBase(layer: PIXI.Container, base: MapDefinition['base']): void {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    root.position.set(base.x, base.y);
    layer.addChild(root);

    this.baseGlowA = new PIXI.Sprite(this.glowTexture());
    this.baseGlowA.anchor.set(0.5);
    this.baseGlowA.tint = 0xffd66e;
    this.baseGlowA.alpha = 0.3;
    this.baseGlowA.width = base.radius * 4.4;
    this.baseGlowA.height = base.radius * 4.4;
    this.baseGlowB = new PIXI.Sprite(this.glowTexture());
    this.baseGlowB.anchor.set(0.5);
    this.baseGlowB.tint = 0xffd66e;
    this.baseGlowB.alpha = 0.18;
    this.baseGlowB.width = base.radius * 5.6;
    this.baseGlowB.height = base.radius * 5.6;
    root.addChild(this.baseGlowA, this.baseGlowB);

    const g = new PIXI.Graphics();
    // Courtyard shadow + stone platform.
    g.ellipse(0, base.radius * 0.9, base.radius * 1.35, base.radius * 0.42).fill({ color: 0x3f6b28, alpha: 0.35 });
    g.roundRect(-base.radius - 16, -base.radius - 8, (base.radius + 16) * 2, (base.radius + 8) * 2, 26).fill({ color: 0xe8e4da });
    g.roundRect(-base.radius - 16, -base.radius - 8, (base.radius + 16) * 2, (base.radius + 8) * 2, 26).stroke({ width: 5, color: 0x9a917f });
    // Courtyard cobble seams.
    g.poly([-58, 20, 58, 20]).stroke({ width: 2, color: 0xcfc8b8 });
    g.poly([-20, -52, -20, 52]).stroke({ width: 2, color: 0xcfc8b8, alpha: 0.7 });
    g.poly([24, -52, 24, 52]).stroke({ width: 2, color: 0xcfc8b8, alpha: 0.7 });
    root.addChild(g);

    // Side turrets behind the keep: stone drums + conical roofs + pennants.
    for (const side of [-1, 1]) {
      const tx = side * 52;
      const t = new PIXI.Graphics();
      t.ellipse(tx, 26, 24, 8).fill({ color: 0x3f6b28, alpha: 0.3 });
      t.circle(tx, 0, 22).fill({ color: 0xcfc8b8 });
      t.circle(tx, 0, 22).stroke({ width: 4, color: 0x8a7f63 });
      t.circle(tx - 6, -6, 4).fill({ color: 0xe8e0cf });
      t.rect(tx - 5, -12, 10, 16).fill({ color: 0x5b4a3a });
      t.rect(tx - 5, -12, 10, 16).stroke({ width: 2, color: 0x2e2118 });
      // Conical roof (ref: blue/red castle towers).
      t.poly([tx - 24, -18, tx + 24, -18, tx, -52]).fill({ color: side < 0 ? 0x3b82c4 : 0xd94f3d });
      t.poly([tx - 24, -18, tx + 24, -18, tx, -52]).stroke({ width: 3.5, color: 0x2b2440 });
      t.poly([tx - 12, -26, tx - 2, -40]).stroke({ width: 3, color: 0xffffff, alpha: 0.65, cap: 'round' });
      // Pennant.
      t.rect(tx - 1.5, -66, 3, 14).fill({ color: 0x6b4226 });
      t.poly([tx + 1.5, -66, tx + 22, -61, tx + 1.5, -56]).fill({ color: side < 0 ? 0xffc93c : 0x3b82c4 });
      t.poly([tx + 1.5, -66, tx + 22, -61, tx + 1.5, -56]).stroke({ width: 1.5, color: 0x2b2440 });
      root.addChild(t);
    }

    // Central keep with battlements.
    const k = new PIXI.Graphics();
    k.roundRect(-32, -30, 64, 66, 10).fill({ color: 0xf2ecdc });
    k.roundRect(-32, -30, 64, 66, 10).stroke({ width: 4.5, color: 0x8a7f63 });
    // Stone courses.
    k.poly([-32, -8, 32, -8]).stroke({ width: 2, color: 0xd8d0ba });
    k.poly([-32, 14, 32, 14]).stroke({ width: 2, color: 0xd8d0ba });
    // Battlements along the top.
    for (let i = 0; i < 4; i++) {
      const bx = -27 + i * 18;
      k.rect(bx, -42, 12, 14).fill({ color: 0xf2ecdc });
      k.rect(bx, -42, 12, 14).stroke({ width: 3, color: 0x8a7f63 });
    }
    // Gate arch.
    k.circle(0, 36, 13).fill({ color: 0x5b4a3a });
    k.circle(0, 36, 13).stroke({ width: 3, color: 0x2e2118 });
    k.rect(-13, 30, 26, 8).fill({ color: 0x5b4a3a });
    k.poly([-8, 36, -8, 28, -3, 28, -3, 36]).fill({ color: 0x8a6d4f });
    k.poly([3, 36, 3, 28, 8, 28, 8, 36]).fill({ color: 0x8a6d4f });
    // Windows + shield banner.
    k.rect(-22, -20, 8, 12).fill({ color: 0x35507a });
    k.rect(-22, -20, 8, 12).stroke({ width: 2, color: 0x2b2440 });
    k.rect(14, -20, 8, 12).fill({ color: 0x35507a });
    k.rect(14, -20, 8, 12).stroke({ width: 2, color: 0x2b2440 });
    k.poly([-9, -2, 9, -2, 9, 8, 0, 15, -9, 8]).fill({ color: 0xd94f3d });
    k.poly([-9, -2, 9, -2, 9, 8, 0, 15, -9, 8]).stroke({ width: 2.5, color: 0x2b2440 });
    k.poly([0, -2, 0, 12]).stroke({ width: 2, color: 0xffc93c });
    root.addChild(k);

    // Tall banner flags on the keep (bob gently via the existing crystal anim).
    const flags = new PIXI.Container();
    const f = new PIXI.Graphics();
    f.rect(-2, -72, 4, 30).fill({ color: 0x6b4226 });
    f.poly([2, -72, 26, -66, 2, -60]).fill({ color: 0xffc93c });
    f.poly([2, -72, 26, -66, 2, -60]).stroke({ width: 1.5, color: 0x7a5b00 });
    flags.addChild(f);
    root.addChild(flags);
    this.baseCrystal = flags;

    this.baseBar = new PIXI.Graphics();
    this.baseBar.eventMode = 'none';
    this.baseBar.position.set(0, -112);
    root.addChild(this.baseBar);
    this.lastHpFrac = -1;
  }

  private drawSlots(layer: PIXI.Container, slots: MapDefinition['buildSlots']): void {
    for (const s of slots) {
      const root = new PIXI.Container();
      root.position.set(s.x, s.y);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(-42, -32, 84, 64);
      const plate = new PIXI.Graphics();
      plate.eventMode = 'none';
      const label = new PIXI.Text({
        text: '+',
        style: {
          fontFamily: 'ui-rounded, system-ui, sans-serif',
          fontSize: 30,
          fontWeight: '900',
          fill: 0xc9a86a,
          align: 'center',
        },
      });
      label.anchor.set(0.5);
      label.eventMode = 'none';
      root.addChild(plate, label);
      root.on('pointerdown', (e) => {
        e.stopPropagation();
        this.onSlotClick?.(s.id);
      });
      root.on('pointerover', () => {
        const node = this.slots.get(s.id);
        if (node && !node.hovered) {
          node.hovered = true;
          this.redrawPlate(node);
        }
      });
      root.on('pointerout', () => {
        const node = this.slots.get(s.id);
        if (node?.hovered) {
          node.hovered = false;
          this.redrawPlate(node);
        }
      });
      layer.addChild(root);
      const occupied = this.game.state.buildSlots.find((b) => b.id === s.id)?.occupied ?? false;
      const node: SlotNode = { root, plate, label, occupied, hovered: false };
      this.slots.set(s.id, node);
      this.redrawPlate(node);
    }
  }

  /** Dashed rounded plate. Redrawn only on occupied/hover change. */
  private redrawPlate(s: SlotNode): void {
    const g = s.plate;
    g.clear();
    const w = 84;
    const h = 64;
    const r = 18;
    g.ellipse(0, h / 2 - 2, w / 2, 12).fill({ color: 0x3f6b28, alpha: 0.3 });
    if (s.occupied) {
      g.roundRect(-w / 2, -h / 2, w, h, r).fill({ color: 0xd9c9a3, alpha: 0.9 });
      g.roundRect(-w / 2, -h / 2, w, h, r).stroke({ width: 4, color: 0x8a6d3b });
      s.label.visible = false;
      return;
    }
    s.label.visible = true;
    g.roundRect(-w / 2, -h / 2, w, h, r).fill({ color: s.hovered ? 0xfff6dd : 0xfff8e7, alpha: 0.95 });
    this.dashedRoundRect(g, -w / 2, -h / 2, w, h, r, 10, 7, s.hovered ? 0xe8a13c : 0xc9a86a, s.hovered ? 5 : 4);
  }

  private dashedRoundRect(
    g: PIXI.Graphics,
    x: number, y: number, w: number, h: number, r: number,
    dash: number, gap: number, color: number, width: number,
  ): void {
    const pts: number[] = [];
    const seg = 10;
    const push = (px: number, py: number) => pts.push(px, py);
    for (let i = 0; i <= seg; i++) push(x + r + ((w - 2 * r) * i) / seg, y);
    const corners: [number, number, number][] = [
      [x + w - r, y + r, -Math.PI / 2],
      [x + w - r, y + h - r, 0],
      [x + r, y + h - r, Math.PI / 2],
      [x + r, y + r, Math.PI],
    ];
    for (const [cx, cy, start] of corners) {
      for (let i = 1; i <= seg; i++) {
        const a = start + (i / seg) * (Math.PI / 2);
        push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    }
    let acc = 0;
    let drawing = true;
    let chunk: number[] = [pts[0], pts[1]];
    for (let i = 1; i < pts.length / 2; i++) {
      acc += Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]);
      chunk.push(pts[i * 2], pts[i * 2 + 1]);
      if (acc >= (drawing ? dash : gap)) {
        if (drawing) g.poly(chunk.slice()).stroke({ width, color, cap: 'round', join: 'round' });
        drawing = !drawing;
        acc = 0;
        chunk = [pts[i * 2], pts[i * 2 + 1]];
      }
    }
    if (drawing && chunk.length >= 4) {
      g.poly(chunk.slice()).stroke({ width, color, cap: 'round', join: 'round' });
    }
  }

  private glowTexture(): PIXI.Texture {
    if (this.glowCache) return this.glowCache;    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    this.glowCache = PIXI.Texture.from(canvas);
    return this.glowCache;
  }
}
