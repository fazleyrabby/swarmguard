import * as PIXI from 'pixi.js';
import { PATH, BUILD_SLOTS, BASE, WORLD } from '../config/map';
import type { Game } from '../game/Game';
import type { Renderer } from './Renderer';

export interface MapDef {
  path: { x: number; y: number }[];
  slots: { id: string; x: number; y: number }[];
  base: { x: number; y: number; radius: number };
}

/** MapDef straight from data-driven config (spec §51). */
export function mapDefFromConfig(): MapDef {
  return {
    path: PATH.map((p) => ({ ...p })),
    slots: BUILD_SLOTS.map((s) => ({ ...s })),
    base: { x: BASE.x, y: BASE.y, radius: BASE.radius },
  };
}

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
  private def: MapDef;

  private baseRing = new PIXI.Graphics();
  private baseGlowA: PIXI.Sprite | null = null;
  private baseGlowB: PIXI.Sprite | null = null;
  private baseCrystal: PIXI.Container | null = null;
  private waterGlints: PIXI.Container[] = [];
  private slots = new Map<string, SlotNode>();
  private rangeG = new PIXI.Graphics();
  private rangeTarget: { x: number; y: number; r: number } | null = null;
  private lastHpFrac = -1;
  private glowCache: PIXI.Texture | null = null;

  constructor(renderer: Renderer, game: Game, def?: MapDef) {
    this.renderer = renderer;
    this.game = game;
    this.def = def ?? mapDefFromConfig();
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

    this.drawGrass(L.background);
    this.drawPath(L.map, this.def.path);
    this.drawDecorations(L.map, this.def);
    this.drawBase(L.map, this.def.base);
    this.drawSlots(L.buildSlot, this.def.slots);
    L.overlay.addChild(this.rangeG);
  }

  private setBaseHp(hp: number, maxHp: number): void {
    const frac = Math.min(1, Math.max(0, maxHp > 0 ? hp / maxHp : 0));
    if (Math.abs(frac - this.lastHpFrac) < 0.001) return;
    this.lastHpFrac = frac;
    const r = this.def.base.radius + 26;
    const g = this.baseRing;
    g.clear();
    g.circle(0, 0, r).stroke({ width: 9, color: 0x3a2b1f, alpha: 0.85 });
    const color = frac > 0.55 ? 0x4ade80 : frac > 0.25 ? 0xfbbf24 : 0xef4444;
    if (frac > 0.001) {
      g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2).stroke({
        width: 9,
        color,
        cap: 'round',
      });
    }
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
    const g = new PIXI.Graphics();
    g.rect(0, 0, WORLD.width, WORLD.height).fill({ color: 0x8fd45e });
    // Whole-background click target for empty-space dismissal.
    g.eventMode = 'static';
    g.hitArea = new PIXI.Rectangle(0, 0, WORLD.width, WORLD.height);
    g.on('pointerdown', () => this.onEmptyClick?.());
    layer.addChild(g);

    const rand = mulberry32(1337);
    const dots = new PIXI.Graphics();
    dots.eventMode = 'none';
    for (let i = 0; i < 520; i++) {
      const x = rand() * WORLD.width;
      const y = rand() * WORLD.height;
      const r = 2 + rand() * 4.5;
      dots.ellipse(x, y, r * 1.4, r).fill({ color: rand() < 0.5 ? 0x7cc24e : 0xa5e56f, alpha: 0.55 });
    }
    layer.addChild(dots);

    const frame = new PIXI.Graphics();
    frame.eventMode = 'none';
    frame.rect(0, 0, WORLD.width, WORLD.height).stroke({ width: 18, color: 0x5da33a });
    frame.rect(9, 9, WORLD.width - 18, WORLD.height - 18).stroke({ width: 4, color: 0xffffff, alpha: 0.25 });
    layer.addChild(frame);
  }

  private drawPath(layer: PIXI.Container, path: { x: number; y: number }[]): void {
    const flat: number[] = [];
    for (const p of path) flat.push(p.x, p.y);
    const g = new PIXI.Graphics();
    g.eventMode = 'none';
    g.poly(flat).stroke({ width: 74, color: 0x3f6b28, alpha: 0.35, cap: 'round', join: 'round' });
    g.poly(flat).stroke({ width: 64, color: 0xb07a4a, cap: 'round', join: 'round' });
    g.poly(flat).stroke({ width: 48, color: 0xe3b877, cap: 'round', join: 'round' });
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
          .fill({ color: 0xd1945a, alpha: 0.8 });
      }
    }
    layer.addChild(pebbles);
  }

  private drawDecorations(layer: PIXI.Container, def: MapDef): void {
    const rand = mulberry32(20240);
    const clearOf = (x: number, y: number, pad: number): boolean => {
      if (distToPath(x, y, def.path) < pad) return false;
      if (Math.hypot(x - def.base.x, y - def.base.y) < def.base.radius + 110) return false;
      for (const s of def.slots) {
        if (Math.hypot(x - s.x, y - s.y) < 70) return false;
      }
      return true;
    };
    const place = (count: number, pad: number, fn: (x: number, y: number, r: number) => void) => {
      let placed = 0;
      let guard = 0;
      while (placed < count && guard++ < count * 40) {
        const x = 50 + rand() * (WORLD.width - 100);
        const y = 50 + rand() * (WORLD.height - 100);
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
      const b = new PIXI.Graphics();
      b.eventMode = 'none';
      const s = 10 + r * 10;
      b.ellipse(x, y + s * 0.6, s * 1.2, s * 0.4).fill({ color: 0x3f6b28, alpha: 0.3 });
      b.circle(x - s * 0.5, y, s * 0.62).fill({ color: 0x58b368 });
      b.circle(x + s * 0.5, y, s * 0.62).fill({ color: 0x58b368 });
      b.circle(x, y - s * 0.4, s * 0.7).fill({ color: 0x6fce7f });
      b.circle(x - s * 0.2, y - s * 0.55, s * 0.22).fill({ color: 0xa9e8b2 });
      layer.addChild(b);
    });
  }

  private drawBase(layer: PIXI.Container, base: MapDef['base']): void {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    root.position.set(base.x, base.y);
    layer.addChild(root);

    this.baseGlowA = new PIXI.Sprite(this.glowTexture());
    this.baseGlowA.anchor.set(0.5);
    this.baseGlowA.tint = 0x7df9ff;
    this.baseGlowA.alpha = 0.3;
    this.baseGlowA.width = base.radius * 4.4;
    this.baseGlowA.height = base.radius * 4.4;
    this.baseGlowB = new PIXI.Sprite(this.glowTexture());
    this.baseGlowB.anchor.set(0.5);
    this.baseGlowB.tint = 0x7df9ff;
    this.baseGlowB.alpha = 0.18;
    this.baseGlowB.width = base.radius * 5.6;
    this.baseGlowB.height = base.radius * 5.6;
    root.addChild(this.baseGlowA, this.baseGlowB);

    const g = new PIXI.Graphics();
    g.ellipse(0, base.radius * 0.85, base.radius * 1.25, base.radius * 0.4).fill({ color: 0x3f6b28, alpha: 0.35 });
    g.roundRect(-base.radius - 14, -base.radius - 6, (base.radius + 14) * 2, (base.radius + 6) * 2, 26).fill({ color: 0xe8e4da });
    g.roundRect(-base.radius - 14, -base.radius - 6, (base.radius + 14) * 2, (base.radius + 6) * 2, 26).stroke({ width: 5, color: 0x9a917f });
    g.roundRect(-base.radius + 2, -base.radius + 10, (base.radius - 2) * 2, (base.radius - 10) * 2, 18).stroke({ width: 3, color: 0xcfc8b8 });
    root.addChild(g);

    const crystal = new PIXI.Container();
    const c = new PIXI.Graphics();
    const R = 30;
    c.poly([0, -R - 10, R, -6, R * 0.55, R + 8, -R * 0.55, R + 8, -R, -6]).fill({ color: 0x38c6f4 });
    c.poly([0, -R - 10, R, -6, R * 0.55, R + 8, -R * 0.55, R + 8, -R, -6]).stroke({ width: 4, color: 0x1d6f8e });
    c.poly([-9, -R + 2, 0, -R - 6, 9, -R + 2, 0, 6]).fill({ color: 0xbdf3ff });
    c.circle(-8, 8, 4).fill({ color: 0xffffff, alpha: 0.9 });
    crystal.addChild(c);
    root.addChild(crystal);
    this.baseCrystal = crystal;

    this.baseRing = new PIXI.Graphics();
    this.baseRing.eventMode = 'none';
    root.addChild(this.baseRing);
    this.lastHpFrac = -1;
  }

  private drawSlots(layer: PIXI.Container, slots: MapDef['slots']): void {
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
    if (this.glowCache) return this.glowCache;
    const canvas = document.createElement('canvas');
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
