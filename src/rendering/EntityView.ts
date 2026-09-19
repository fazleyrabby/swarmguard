import * as PIXI from 'pixi.js';

/** Structural enemy view — sim `Enemy` objects are assignable as-is. */
export interface RenderEnemy {
  id: number;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

/** Structural tower view — `main.ts` maps sim towers via `toRenderState()`. */
export interface RenderTower {
  id: string | number;
  kind: string;
  x: number;
  y: number;
  level: number;
  angle?: number;
}

export interface RenderProjectile {
  id: number;
  kind: string;
  x: number;
  y: number;
  angle: number;
}

interface EnemyNode {
  root: PIXI.Container;
  body: PIXI.Sprite;
  flash: PIXI.Sprite;
  hpBar: PIXI.Graphics;
  phase: number;
  flashT: number;
  lastHp: number;
  lastHpFrac: number;
  lastHpVisible: boolean;
  type: string;
}

interface TowerNode {
  root: PIXI.Container;
  top: PIXI.Container;
  base: PIXI.Sprite;
  badge: PIXI.Text;
  angle: number;
  recoil: number;
  level: number;
  kind: string;
}

interface ProjectileNode {
  sprite: PIXI.Sprite;
  kind: string;
}

function texKey(kind: string, prefix: string, fallback: string): string {
  switch (kind) {
    case 'grunt':
    case 'runner':
    case 'tank':
    case 'crossbow':
    case 'cannon':
    case 'bomb':
    case 'arrow':
    case 'cannonball':
      return `${prefix}${kind}`;
    default:
      return fallback;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

const LEVEL_TINTS = [0xffffff, 0xfff3d6, 0xffe4a8, 0xffd27a, 0xffb84d];

/**
 * Cute procedural entity sprites (spec §37, §39–40, §71–75):
 * Graphics -> textures baked ONCE in `init()`, pooled Sprites/Containers,
 * walk wobble (scale/rotation oscillation), white-flash hit overlays,
 * HP bars only when damaged, rotating tower tops with recoil.
 * No per-frame Graphics allocs (HP bars redraw only on HP change).
 */
export class EntityView {
  private enemyLayer: PIXI.Container;
  private towerLayer: PIXI.Container;
  private projectileLayer: PIXI.Container;

  private tex = new Map<string, PIXI.Texture>();
  private enemies = new Map<number, EnemyNode>();
  private towers = new Map<string | number, TowerNode>();
  private projectiles = new Map<number, ProjectileNode>();
  private projPool: ProjectileNode[] = [];
  private deadPool: EnemyNode[] = [];

  constructor(enemy: PIXI.Container, tower: PIXI.Container, projectile: PIXI.Container) {
    this.enemyLayer = enemy;
    this.towerLayer = tower;
    this.projectileLayer = projectile;
  }

  /** Bake all textures. Called from main.ts after `Renderer.create()`. Accepts Application or Renderer. */
  init(appOrRenderer: PIXI.Application | PIXI.Renderer): void {
    const renderer = (appOrRenderer as PIXI.Application).renderer ?? (appOrRenderer as PIXI.Renderer);
    if (!renderer?.generateTexture) throw new Error('[swarmguard] Pixi renderer not ready (EntityView.init)');
    const bake = (key: string, g: PIXI.Graphics): void => {
      this.tex.set(key, renderer.generateTexture(g));
      g.destroy();
    };
    bake('shadow', this.shadowG());
    bake('grunt', this.gruntG());
    bake('runner', this.runnerG());
    bake('tank', this.tankG());
    bake('flash-grunt', this.flashCircleG(20));
    bake('flash-runner', this.flashCircleG(16));
    bake('flash-tank', this.flashCircleG(30));
    bake('tower-base-crossbow', this.towerBaseG(0xb0845a, 0x6b4226));
    bake('tower-base-cannon', this.towerBaseG(0x6b7280, 0x374151));
    bake('tower-base-bomb', this.towerBaseG(0x2dd4bf, 0x0f766e));
    bake('top-crossbow', this.crossbowTopG());
    bake('top-cannon', this.cannonTopG());
    bake('top-bomb', this.bombTopG());
    bake('arrow', this.arrowG());
    bake('cannonball', this.cannonballG());
    bake('bomb', this.bombProjG());
  }

  /** Reconcile pools with sim state (called every tick from main.ts). */
  sync(
    enemies: RenderEnemy[],
    towers: RenderTower[],
    projectiles: RenderProjectile[],
    dt: number,
    time: number,
  ): void {
    this.syncEnemies(enemies, dt, time);
    this.syncTowers(towers, dt);
    this.syncProjectiles(projectiles);
  }

  /** White-flash hit feedback (spec §42). Also auto-fired on HP drops. */
  flashEnemy(id: number): void {
    const n = this.enemies.get(id);
    if (n) n.flashT = 0.09;
  }

  /** Recoil kick on fire (spec §40). Wired to `tower:fired` in main.ts. */
  kickTower(id: string | number, strength = 1): void {
    const n = this.towers.get(id);
    if (n) n.recoil = Math.min(1.4, n.recoil + strength);
  }

  // ---------- enemies ----------

  private syncEnemies(list: RenderEnemy[], dt: number, time: number): void {
    const seen = new Set<number>();
    for (const e of list) {
      seen.add(e.id);
      const key = e.type === 'runner' ? 'runner' : e.type === 'tank' ? 'tank' : 'grunt';
      let n = this.enemies.get(e.id);
      if (!n) {
        n = this.makeEnemy(key);
        this.enemies.set(e.id, n);
        this.enemyLayer.addChild(n.root);
        n.root.scale.set(0.2); // spawn pop
      } else if (n.type !== key) {
        n.type = key;
        n.body.texture = this.tex.get(key) ?? PIXI.Texture.WHITE;
        n.flash.texture = this.tex.get(`flash-${key}`) ?? PIXI.Texture.WHITE;
      }
      if (e.hp < n.lastHp) this.flashEnemy(e.id);
      n.lastHp = e.hp;

      n.root.position.set(e.x, e.y);
      // Walk wobble: scale/rotation oscillation (spec §39).
      const speedMul = key === 'runner' ? 1.8 : key === 'tank' ? 0.6 : 1;
      const wob = Math.sin(time * 9 * speedMul + n.phase);
      const k = Math.min(1, dt * 14);
      n.root.scale.x += (1 + wob * 0.055 - n.root.scale.x) * k;
      n.root.scale.y += (1 - wob * 0.055 - n.root.scale.y) * k;
      n.body.rotation = Math.cos(time * 7 * speedMul + n.phase) * 0.09;

      if (n.flashT > 0) {
        n.flashT -= dt;
        n.flash.alpha = Math.max(0, n.flashT / 0.09) * 0.9;
      } else {
        n.flash.alpha = 0;
      }

      // HP bar only when damaged (spec §74), redrawn only on change.
      const frac = e.maxHp > 0 ? Math.min(1, Math.max(0, e.hp / e.maxHp)) : 0;
      const visible = frac < 0.999;
      if (visible !== n.lastHpVisible || Math.abs(frac - n.lastHpFrac) > 0.01) {
        n.lastHpVisible = visible;
        n.lastHpFrac = frac;
        n.hpBar.visible = visible;
        if (visible) {
          n.hpBar.clear();
          n.hpBar.roundRect(0, 0, 40, 6, 3).fill({ color: 0x1f2937, alpha: 0.85 });
          n.hpBar
            .roundRect(1, 1, 38 * frac, 4, 2)
            .fill({ color: frac > 0.55 ? 0x4ade80 : frac > 0.28 ? 0xfbbf24 : 0xef4444 });
        }
      }
    }
    for (const [id, n] of this.enemies) {
      if (!seen.has(id)) {
        this.enemyLayer.removeChild(n.root);
        if (this.deadPool.length < 400) this.deadPool.push(n);
        this.enemies.delete(id);
      }
    }
  }

  private makeEnemy(type: string): EnemyNode {
    const pooled = this.deadPool.pop();
    const root = pooled?.root ?? new PIXI.Container();
    root.eventMode = 'none';
    const body = pooled?.body ?? new PIXI.Sprite();
    body.texture = this.tex.get(type) ?? PIXI.Texture.WHITE;
    body.anchor.set(0.5);
    const flash = pooled?.flash ?? new PIXI.Sprite();
    flash.texture = this.tex.get(`flash-${type}`) ?? PIXI.Texture.WHITE;
    flash.anchor.set(0.5);
    flash.alpha = 0;
    const hpBar = pooled?.hpBar ?? new PIXI.Graphics();
    hpBar.visible = false;
    hpBar.eventMode = 'none';
    if (!pooled) {
      const shadow = new PIXI.Sprite(this.tex.get('shadow'));
      shadow.anchor.set(0.5);
      shadow.position.y = type === 'tank' ? 24 : type === 'runner' ? 13 : 16;
      shadow.scale.set(type === 'tank' ? 1.5 : type === 'runner' ? 0.75 : 1);
      shadow.alpha = 0.9;
      root.addChild(shadow, body, flash, hpBar);
      hpBar.position.set(-20, type === 'tank' ? -34 : -26);
    } else {
      if (body.parent !== root) root.addChild(body);
      if (flash.parent !== root) root.addChild(flash);
      if (hpBar.parent !== root) root.addChild(hpBar);
    }
    return {
      root, body, flash, hpBar,
      phase: Math.random() * Math.PI * 2,
      flashT: 0,
      lastHp: Number.POSITIVE_INFINITY,
      lastHpFrac: 1,
      lastHpVisible: false,
      type,
    };
  }

  // ---------- towers ----------

  private syncTowers(list: RenderTower[], dt: number): void {
    const seen = new Set<string | number>();
    for (const t of list) {
      seen.add(t.id);
      const kind = t.kind === 'cannon' ? 'cannon' : t.kind === 'bomb' ? 'bomb' : 'crossbow';
      let n = this.towers.get(t.id);
      if (!n) {
        n = this.makeTower(kind, t.level);
        n.root.position.set(t.x, t.y);
        this.towers.set(t.id, n);
        this.towerLayer.addChild(n.root);
        n.root.scale.set(0.2); // placement bounce (Effects.place plays the glow)
      }
      n.root.position.set(t.x, t.y);
      if (n.root.scale.x < 1) {
        const s = Math.min(1, n.root.scale.x + dt * 4);
        n.root.scale.set(s >= 1 ? 1 : s < 0.8 ? s : 1 + (s - 0.8) * 0.5);
      }
      if (n.level !== t.level) {
        n.level = t.level;
        n.badge.text = t.level > 1 ? `Lv${t.level}` : '';
        n.base.tint = LEVEL_TINTS[Math.min(4, Math.max(0, t.level - 1))];
      }
      // Rotate weapon toward target (spec §40) + recoil decay.
      if (t.angle !== undefined) n.angle = lerpAngle(n.angle, t.angle, dt * 10);
      n.recoil = Math.max(0, n.recoil - dt * 6);
      n.top.rotation = n.angle;
      const back = n.recoil * 7;
      n.top.position.set(-Math.cos(n.angle) * back, -Math.sin(n.angle) * back);
    }
    for (const [id, n] of this.towers) {
      if (!seen.has(id)) {
        this.towerLayer.removeChild(n.root);
        this.towers.delete(id);
      }
    }
  }

  private makeTower(kind: string, level: number): TowerNode {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const shadow = new PIXI.Sprite(this.tex.get('shadow'));
    shadow.anchor.set(0.5);
    shadow.position.y = 24;
    shadow.scale.set(1.4);
    const base = new PIXI.Sprite(this.tex.get(texKey(kind, 'tower-base-', 'tower-base-crossbow')));
    base.anchor.set(0.5);
    base.tint = LEVEL_TINTS[Math.min(4, Math.max(0, level - 1))];
    const top = new PIXI.Container();
    const topSprite = new PIXI.Sprite(this.tex.get(texKey(kind, 'top-', 'top-crossbow')));
    topSprite.anchor.set(0.5);
    top.addChild(topSprite);
    const badge = new PIXI.Text({
      text: level > 1 ? `Lv${level}` : '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '800',
        fill: 0xffffff,
        stroke: { color: 0x3a2b1f, width: 3 },
        align: 'center',
      },
    });
    badge.anchor.set(0.5);
    badge.position.y = -38;
    badge.eventMode = 'none';
    root.addChild(shadow, base, top, badge);
    return { root, top, base, badge, angle: -Math.PI / 2, recoil: 0, level, kind };
  }

  // ---------- projectiles (pooled sprites) ----------

  private syncProjectiles(list: RenderProjectile[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let n = this.projectiles.get(p.id);
      if (!n) {
        const reuse = this.projPool.pop();
        const sprite = reuse?.sprite ?? new PIXI.Sprite();
        sprite.eventMode = 'none';
        sprite.texture = this.tex.get(p.kind) ?? this.tex.get('arrow') ?? PIXI.Texture.WHITE;
        sprite.anchor.set(0.5);
        n = { sprite, kind: p.kind };
        if (sprite.parent !== this.projectileLayer) this.projectileLayer.addChild(sprite);
        sprite.visible = true;
        this.projectiles.set(p.id, n);
      }
      if (n.kind !== p.kind) {
        n.kind = p.kind;
        n.sprite.texture = this.tex.get(p.kind) ?? PIXI.Texture.WHITE;
      }
      n.sprite.position.set(p.x, p.y);
      n.sprite.rotation = p.angle;
      if (p.kind === 'bomb') n.sprite.scale.set(1 + Math.sin(p.x * 0.05 + p.y * 0.05) * 0.08);
    }
    for (const [id, n] of this.projectiles) {
      if (!seen.has(id)) {
        this.projectileLayer.removeChild(n.sprite);
        n.sprite.visible = false;
        if (this.projPool.length < 256) this.projPool.push(n);
        this.projectiles.delete(id);
      }
    }
  }

  // ---------- procedural texture painters (chunky cartoon) ----------

  private shadowG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.ellipse(16, 8, 15, 7).fill({ color: 0x1a2e12, alpha: 0.32 });
    return g;
  }

  private gruntG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(24, 26, 18).fill({ color: 0x4ade80 });
    g.circle(24, 26, 18).stroke({ width: 4, color: 0x1f7a3d });
    g.ellipse(24, 32, 10, 7).fill({ color: 0x86efac });
    g.circle(30, 18, 4).fill({ color: 0xbbf7d0, alpha: 0.9 });
    g.circle(15, 42, 5).fill({ color: 0x22c55e });
    g.circle(33, 42, 5).fill({ color: 0x22c55e });
    g.circle(17, 22, 6.5).fill({ color: 0xffffff });
    g.circle(31, 22, 6.5).fill({ color: 0xffffff });
    g.circle(17, 22, 6.5).stroke({ width: 2, color: 0x1f7a3d });
    g.circle(31, 22, 6.5).stroke({ width: 2, color: 0x1f7a3d });
    g.circle(18, 23, 3).fill({ color: 0x1f2937 });
    g.circle(32, 23, 3).fill({ color: 0x1f2937 });
    g.circle(19, 22, 1.2).fill({ color: 0xffffff });
    g.circle(33, 22, 1.2).fill({ color: 0xffffff });
    return g;
  }

  private runnerG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(20, 22, 13).fill({ color: 0xfb923c });
    g.circle(20, 22, 13).stroke({ width: 3.5, color: 0xb45309 });
    g.ellipse(20, 27, 7, 5).fill({ color: 0xfed7aa });
    g.circle(25, 15, 3).fill({ color: 0xffedd5, alpha: 0.95 });
    g.circle(13, 35, 4).fill({ color: 0xf97316 });
    g.circle(27, 35, 4).fill({ color: 0xf97316 });
    g.circle(15, 19, 5.5).fill({ color: 0xffffff });
    g.circle(26, 19, 5.5).fill({ color: 0xffffff });
    g.circle(15, 19, 5.5).stroke({ width: 2, color: 0xb45309 });
    g.circle(26, 19, 5.5).stroke({ width: 2, color: 0xb45309 });
    g.circle(16, 20, 2.6).fill({ color: 0x1f2937 });
    g.circle(27, 20, 2.6).fill({ color: 0x1f2937 });
    g.rect(7, 10, 28, 5).fill({ color: 0xef4444 });
    return g;
  }

  private tankG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(32, 34, 26).fill({ color: 0xa78bfa });
    g.circle(32, 34, 26).stroke({ width: 5, color: 0x5b21b6 });
    g.roundRect(8, 12, 16, 12, 4).fill({ color: 0xd1d5db });
    g.roundRect(8, 12, 16, 12, 4).stroke({ width: 2.5, color: 0x6b7280 });
    g.roundRect(40, 12, 16, 12, 4).fill({ color: 0xd1d5db });
    g.roundRect(40, 12, 16, 12, 4).stroke({ width: 2.5, color: 0x6b7280 });
    g.roundRect(22, 44, 20, 12, 4).fill({ color: 0xd1d5db });
    g.roundRect(22, 44, 20, 12, 4).stroke({ width: 2.5, color: 0x6b7280 });
    g.circle(16, 18, 2).fill({ color: 0x9ca3af });
    g.circle(48, 18, 2).fill({ color: 0x9ca3af });
    g.ellipse(32, 42, 13, 8).fill({ color: 0xc4b5fd });
    g.circle(23, 28, 7).fill({ color: 0xffffff });
    g.circle(41, 28, 7).fill({ color: 0xffffff });
    g.circle(23, 28, 7).stroke({ width: 2.5, color: 0x5b21b6 });
    g.circle(41, 28, 7).stroke({ width: 2.5, color: 0x5b21b6 });
    g.circle(23, 29, 3.2).fill({ color: 0xdc2626 });
    g.circle(41, 29, 3.2).fill({ color: 0xdc2626 });
    g.poly([15, 20, 29, 23]).stroke({ width: 3.5, color: 0x5b21b6, cap: 'round' });
    g.poly([35, 23, 49, 20]).stroke({ width: 3.5, color: 0x5b21b6, cap: 'round' });
    return g;
  }

  private flashCircleG(r: number): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(24, 24, r * 0.8).fill({ color: 0xffffff });
    return g;
  }

  private towerBaseG(fill: number, edge: number): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(28, 30, 24).fill({ color: fill });
    g.circle(28, 30, 24).stroke({ width: 5, color: edge });
    g.circle(28, 30, 15).fill({ color: 0xffffff, alpha: 0.22 });
    for (const [bx, by] of [[12, 16], [44, 16], [12, 44], [44, 44]] as const) {
      g.circle(bx, by, 3.2).fill({ color: edge });
    }
    return g;
  }

  private crossbowTopG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.roundRect(8, 24, 34, 8, 4).fill({ color: 0x92400e });
    g.roundRect(8, 24, 34, 8, 4).stroke({ width: 2.5, color: 0x451a03 });
    g.poly([40, 8, 34, 28, 40, 48]).stroke({ width: 6, color: 0x78350f, cap: 'round', join: 'round' });
    g.poly([40, 8, 34, 28, 40, 48]).stroke({ width: 2, color: 0xd6d3d1 });
    g.poly([40, 8, 26, 28, 40, 48]).stroke({ width: 2, color: 0xfef3c7 });
    g.poly([10, 28, 46, 28]).stroke({ width: 3.5, color: 0x44403c, cap: 'round' });
    g.poly([46, 28, 40, 24, 40, 32]).fill({ color: 0x9ca3af });
    g.circle(24, 28, 8).fill({ color: 0xa16207 });
    g.circle(24, 28, 8).stroke({ width: 3, color: 0x451a03 });
    g.circle(24, 28, 3).fill({ color: 0xfde68a });
    return g;
  }

  private cannonTopG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.roundRect(6, 20, 34, 17, 8).fill({ color: 0x374151 });
    g.roundRect(6, 20, 34, 17, 8).stroke({ width: 3, color: 0x111827 });
    g.roundRect(34, 23, 12, 11, 4).fill({ color: 0x111827 });
    g.rect(12, 21, 6, 15).fill({ color: 0x9ca3af, alpha: 0.8 });
    g.circle(22, 28, 9).fill({ color: 0x4b5563 });
    g.circle(22, 28, 9).stroke({ width: 3, color: 0x111827 });
    g.circle(22, 28, 3.5).fill({ color: 0x9ca3af });
    return g;
  }

  private bombTopG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(28, 28, 17).fill({ color: 0x0d9488 });
    g.circle(28, 28, 17).stroke({ width: 4, color: 0x134e4a });
    g.ellipse(34, 28, 10, 12).fill({ color: 0x134e4a });
    g.ellipse(34, 28, 7, 9).fill({ color: 0x042f2e });
    g.circle(20, 20, 4).fill({ color: 0x99f6e4, alpha: 0.9 });
    g.circle(14, 36, 3).fill({ color: 0x134e4a });
    g.circle(42, 36, 3).fill({ color: 0x134e4a });
    return g;
  }

  private arrowG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.poly([0, 4, 16, 4]).stroke({ width: 3, color: 0x92400e, cap: 'round' });
    g.poly([16, 0, 24, 4, 16, 8]).fill({ color: 0x9ca3af });
    g.poly([0, 2, 5, 4, 0, 6]).fill({ color: 0xef4444 });
    return g;
  }

  private cannonballG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(8, 8, 7).fill({ color: 0x1f2937 });
    g.circle(6, 6, 2.5).fill({ color: 0x9ca3af });
    return g;
  }

  private bombProjG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(10, 11, 9).fill({ color: 0x134e4a });
    g.circle(10, 11, 9).stroke({ width: 2.5, color: 0x042f2e });
    g.circle(7, 8, 3).fill({ color: 0x5eead4 });
    g.poly([15, 5, 19, 1]).stroke({ width: 2.5, color: 0x92400e, cap: 'round' });
    g.circle(20, 1, 2.5).fill({ color: 0xfde047 });
    return g;
  }
}
