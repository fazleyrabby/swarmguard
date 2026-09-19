import * as PIXI from 'pixi.js';

export const WORLD_W = 1600;
export const WORLD_H = 900;

export type LayerName =
  | 'background'
  | 'map'
  | 'buildSlot'
  | 'tower'
  | 'enemy'
  | 'projectile'
  | 'effects'
  | 'overlay';

export interface RendererOptions {
  background?: string;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Pixi Application owner (spec §7–9): fixed 1600x900 world scaled to the
 * viewport (never distorted), 8 ordered layers, wheel-zoom camera and a
 * trauma-based shake API.
 *
 * Views (`WorldView`, `EntityView`, `Effects`) are constructed separately
 * in main.ts with `(renderer, game)` and draw into `renderer.layers`.
 */
export class Renderer {
  readonly layers = {} as Record<LayerName, PIXI.Container>;
  readonly world = new PIXI.Container();
  readonly minZoom: number;
  readonly maxZoom: number;

  app!: PIXI.Application;

  private container: HTMLElement;
  private baseScale = 1;
  private zoom = 1;
  private trauma = 0;
  private shakeOn = true;
  private baseX = 0;
  private baseY = 0;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private dragging = false;
  private lastPX = 0;
  private lastPY = 0;
  private dragMoved = 0;
  private lastDragEnd = 0;

  private constructor(container: HTMLElement, opts: RendererOptions = {}) {
    this.container = container;
    this.minZoom = opts.minZoom ?? 0.55;
    this.maxZoom = opts.maxZoom ?? 2.5;
    this.world.label = 'world';
  }

  static async create(container: HTMLElement, opts: RendererOptions = {}): Promise<Renderer> {
    const renderer = new Renderer(container, opts);
    await renderer.boot(opts.background ?? '#79c14e');
    return renderer;
  }

  private async boot(background: string): Promise<void> {
    this.app = new PIXI.Application();
    await this.app.init({
      background,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    this.container.appendChild(this.app.canvas);

    this.app.stage.addChild(this.world);
    const order: LayerName[] = [
      'background',
      'map',
      'buildSlot',
      'tower',
      'enemy',
      'projectile',
      'effects',
      'overlay',
    ];
    for (const name of order) {
      const c = new PIXI.Container();
      c.label = `layer-${name}`;
      this.world.addChild(c);
      this.layers[name] = c;
    }

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    // Drag to pan (mouse + touch), wheel to zoom. Clicks still work:
    // a drag > 6px suppresses the follow-up click via wasDrag().
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      this.dragging = true;
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
      this.dragMoved = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPX;
      const dy = e.clientY - this.lastPY;
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      if (this.dragMoved > 2) {
        this.baseX += dx;
        this.baseY += dy;
        this.clampPan();
      }
    });
    const endDrag = () => {
      if (!this.dragging) return;
      this.dragging = false;
      canvas.style.cursor = 'grab';
      if (this.dragMoved > 6) this.lastDragEnd = performance.now();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Wheel zoom anchored at the cursor (spec §9).
    canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = this.app.canvas.getBoundingClientRect();
        const before = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0012));
        const after = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const s = this.effectiveScale();
        this.baseX += (after.x - before.x) * -s;
        this.baseY += (after.y - before.y) * -s;
        this.clampPan();
      },
      { passive: false },
    );

    // Camera-side shake: absolute offset recomputed per tick (never accumulates).
    this.app.ticker.add((ticker) => {
      if (this.disposed) return;
      const dt = Math.min(ticker.deltaMS / 1000, 0.05);
      if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - dt * 2.2);
      const sh = this.shakeOn ? this.trauma * this.trauma : 0;
      this.world.position.set(
        this.baseX + sh * 14 * (Math.random() * 2 - 1),
        this.baseY + sh * 14 * (Math.random() * 2 - 1),
      );
    });
  }

  // ---- camera API ----

  /** Subtle trauma-based shake (spec §43). amount 0..1, decays in ~0.5s. */
  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  setShakeEnabled(enabled: boolean): void {
    this.shakeOn = enabled;
    if (!enabled) this.trauma = 0;
  }

  setZoom(z: number): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, z));
    this.applyTransform();
    this.clampPan();
  }

  getZoom(): number {
    return this.zoom;
  }

  /** True if the last pointer gesture was a drag (used to suppress clicks). */
  wasDrag(timeoutMs = 250): boolean {
    return performance.now() - this.lastDragEnd < timeoutMs;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    const s = this.effectiveScale();
    return { x: (px - this.baseX) / s, y: (py - this.baseY) / s };
  }

  resize(): void {
    if (!this.app) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.app.renderer.resize(w, h);
    this.applyTransform();
  }

  destroy(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.app?.destroy(true);
  }

  // ---- internals ----

  private effectiveScale(): number {
    return this.baseScale * this.zoom;
  }

  /** Fit the whole world letterboxed (spec §8, §68), centered at zoom 1. */
  private applyTransform(): void {
    if (!this.app) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.baseScale = Math.min(w / WORLD_W, h / WORLD_H);
    const s = this.effectiveScale();
    if (this.zoom === 1) {
      this.baseX = w / 2 - (WORLD_W / 2) * s;
      this.baseY = h / 2 - (WORLD_H / 2) * s;
    }
    this.world.scale.set(s);
    this.world.position.set(this.baseX, this.baseY);
  }

  private clampPan(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const s = this.effectiveScale();
    const margin = 120;
    const cx = this.baseX + (WORLD_W / 2) * s;
    const cy = this.baseY + (WORLD_H / 2) * s;
    const nx = Math.min(Math.max(cx, -margin), w + margin);
    const ny = Math.min(Math.max(cy, -margin), h + margin);
    this.baseX += nx - cx;
    this.baseY += ny - cy;
  }
}
