import * as PIXI from 'pixi.js';
import { branchFor, type TowerId } from '../config/towers';

/** Structural enemy view — sim `Enemy` objects are assignable as-is. */
export interface RenderEnemy {
  id: number;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  shield?: number;
  maxShield?: number;
  /** Total distance walked — drives distance-synced footsteps. */
  distanceTraveled?: number;
  /** Active poison effects for the green overlay / tint. */
  poisonEffects?: unknown[];
}

/** Structural tower view — `main.ts` maps sim towers via `toRenderState()`. */
export interface RenderTower {
  id: string | number;
  kind: string;
  x: number;
  y: number;
  level: number;
  angle?: number;
  branch?: string;
  hp?: number;
  maxHp?: number;
  /** Aura ring radius (War Drums source). */
  auraRadius?: number;
  /** Whether this tower is currently buffed by an aura source. */
  buffed?: boolean;
}

export interface RenderProjectile {
  id: number;
  kind: string;
  x: number;
  y: number;
  angle: number;
  /** Only for Alchemist vials that explode into a poison cloud on expiry. */
  poison?: boolean;
}

interface EnemyNode {
  root: PIXI.Container;
  shadow: PIXI.Sprite;
  body: PIXI.Sprite;
  flash: PIXI.Sprite;
  hpBar: PIXI.Graphics;
  poison: PIXI.Sprite;
  phase: number;
  flashT: number;
  lastHp: number;
  lastHpFrac: number;
  lastHpVisible: boolean;
  lastHasShield: boolean;
  lastPoisoned: boolean;
  type: string;
  textureName: string;
  /** Motion state. */
  popScale: number;
  walkPhase: number;
  hitPunch: number;
  lastDist: number;
  lastX: number;
  lastY: number;
  skewX: number;
  skewY: number;
}

interface TowerNode {
  root: PIXI.Container;
  top: PIXI.Container;
  base: PIXI.Sprite;
  badge: PIXI.Text;
  pips: PIXI.Graphics;
  hpBar: PIXI.Graphics;
  aura: PIXI.Graphics;
  buff: PIXI.Graphics;
  angle: number;
  recoil: number;
  level: number;
  kind: string;
  branch?: string;
  /** Placement grow 0.2->1, multiplied with hitPunch for the final scale. */
  baseScale: number;
  hitPunch: number;
  lastHpFrac: number;
  lastHpVisible: boolean;
  lastAuraRadius: number;
  lastBuffed: boolean;
}

interface ProjectileNode {
  sprite: PIXI.Sprite;
  shadow: PIXI.Sprite;
  kind: string;
}

/** Soft baked ground shadows read at this fraction of their per-type scale. */
const SOFT_SHADOW = 0.34;
/** Weapon height above the tower origin — sits on the drum's top face. */
const TOP_RISE = -14;

function texKey(kind: string, prefix: string, fallback: string): string {
  switch (kind) {
    case 'grunt':
    case 'runner':
    case 'tank':
    case 'boss':
    case 'boss-shielded':
    case 'boss-regen':
    case 'boss-herald':
    case 'crossbow':
    case 'cannon':
    case 'bomb':
    case 'frost':
    case 'alchemist':
    case 'war-drums':
    case 'sniper':
    case 'arrow':
    case 'cannonball':
    case 'frostshard':
    case 'vial':
    case 'bullet':
      return `${prefix}${kind}`;
    default:
      return fallback;
  }
}

/** Linear blend of two 0xRRGGBB colors (t=0 -> a, t=1 -> b). */
function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

const LEVEL_TINTS = [0xffffff, 0xfff3d6, 0xffe4a8, 0xffd27a, 0xffb84d];

interface EnemyVisual {
  key: 'grunt' | 'runner' | 'tank' | 'boss';
  /** Texture name (variant bosses/minions use their own art or a scaled boss). */
  texture: string;
  flash: string;
  wobble: number;
  /** Static body/flash scale (minions render the boss art small). */
  bodyScale: number;
  shadowY: number;
  shadowScale: number;
  barW: number;
  barH: number;
  barY: number;
  alwaysHpBar: boolean;
  /** Gait: hop height, squash amount, step frequency, lean (skew). */
  hop: number;
  squash: number;
  stride: number;
  lean: number;
}

const BOSS_VARIANTS = new Set(['boss-shielded', 'boss-regen', 'boss-herald']);
const MINION_TEXTURE: Record<string, string> = {
  'minion-shielded': 'boss-shielded',
  'minion-regen': 'boss-regen',
  'minion-herald': 'boss-herald',
};

function enemyVisual(type: string): EnemyVisual {
  switch (type) {
    case 'runner':
      return { key: 'runner', texture: 'runner', flash: 'flash-runner', wobble: 1.8, bodyScale: 1, shadowY: 13, shadowScale: 0.75, barW: 36, barH: 6, barY: -24, alwaysHpBar: false, hop: 2.5, squash: 0.05, stride: 0.18, lean: 0.14 };
    case 'tank':
      return { key: 'tank', texture: 'tank', flash: 'flash-tank', wobble: 0.6, bodyScale: 1, shadowY: 24, shadowScale: 1.5, barW: 48, barH: 6, barY: -34, alwaysHpBar: false, hop: 1.2, squash: 0.03, stride: 0.1, lean: 0.04 };
    case 'spearman':
      return { key: 'grunt', texture: 'spearman', flash: 'flash-spearman', wobble: 1.2, bodyScale: 1, shadowY: 15, shadowScale: 0.9, barW: 38, barH: 6, barY: -26, alwaysHpBar: false, hop: 3.5, squash: 0.07, stride: 0.15, lean: 0.08 };
    case 'boss':
    case 'boss-shielded':
    case 'boss-regen':
    case 'boss-herald':
      return {
        key: 'boss',
        texture: BOSS_VARIANTS.has(type) ? type : 'boss',
        flash: 'flash-boss',
        wobble: 0.5,
        bodyScale: 1,
        shadowY: 43,
        shadowScale: 2.6,
        barW: 96,
        barH: 10,
        barY: -60,
        alwaysHpBar: true,
        hop: 1.4,
        squash: 0.04,
        stride: 0.08,
        lean: 0,
      };
    case 'minion-shielded':
    case 'minion-regen':
    case 'minion-herald':
      return {
        key: 'boss',
        texture: MINION_TEXTURE[type] ?? 'boss',
        flash: 'flash-boss',
        wobble: 1.4,
        bodyScale: 0.42,
        shadowY: 18,
        shadowScale: 1.0,
        barW: 40,
        barH: 6,
        barY: -28,
        alwaysHpBar: false,
        hop: 5,
        squash: 0.1,
        stride: 0.22,
        lean: 0.1,
      };
    default:
      return { key: 'grunt', texture: 'grunt', flash: 'flash-grunt', wobble: 1, bodyScale: 1, shadowY: 16, shadowScale: 1, barW: 40, barH: 6, barY: -26, alwaysHpBar: false, hop: 4, squash: 0.07, stride: 0.16, lean: 0.06 };
  }
}

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
    this.softShadowTexture();
    bake('grunt', this.gruntG());
    bake('runner', this.runnerG());
    bake('tank', this.tankG());
    bake('spearman', this.spearmanG());
    bake('boss', this.bossG());
    bake('boss-shielded', this.bossG(0x3b82f6, 0x1e3a8a, 0xbfdbfe, 0x93c5fd, 0x1e40af, 0xe0f2fe, 0x1e40af));
    bake('boss-regen', this.bossG(0x22c55e, 0x14532d, 0xbbf7d0, 0x86efac, 0x166534, 0xfef3c7, 0x7a5b00));
    bake('boss-herald', this.bossG(0xf59e0b, 0x92400e, 0xfde68a, 0xfcd34d, 0xb45309, 0xfff7ed, 0x92400e));
    bake('flash-grunt', this.flashCircleG(20));
    bake('flash-runner', this.flashCircleG(16));
    bake('flash-tank', this.flashCircleG(30));
    bake('flash-spearman', this.flashCircleG(19));
    bake('flash-boss', this.flashCircleG(52, 52, 56));
    bake('tower-base-crossbow', this.towerBaseG(0xb0845a, 0x6b4226));
    bake('tower-base-cannon', this.towerBaseG(0x6b7280, 0x374151));
    bake('tower-base-bomb', this.towerBaseG(0x2dd4bf, 0x0f766e));
    bake('tower-base-frost', this.towerBaseG(0x93c5fd, 0x1e40af));
    bake('tower-base-sniper', this.towerBaseG(0x6b7280, 0x1f2937));
    bake('tower-base-alchemist', this.towerBaseG(0x7c3bed, 0x4b0082));
    bake('tower-base-war-drums', this.towerBaseG(0xf59e0b, 0x92400e));
    bake('top-crossbow', this.crossbowTopG());
    bake('top-cannon', this.cannonTopG());
    bake('top-bomb', this.bombTopG());
    bake('top-frost', this.frostTopG());
    bake('top-sniper', this.sniperTopG());
    bake('top-alchemist', this.alchemistTopG());
    bake('top-war-drums', this.warDrumsTopG());
    bake('poison-overlay', this.poisonOverlayG());
    bake('arrow', this.arrowG());
    bake('cannonball', this.cannonballG());
    bake('bomb', this.bombProjG());
    bake('frostshard', this.frostshardG());
    bake('vial', this.vialG());
    bake('bullet', this.bulletG());
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
    if (n) {
      n.flashT = 0.09;
      n.hitPunch = 1;
    }
  }

  /** Recoil kick on fire (spec §40). Wired to `tower:fired` in main.ts. */
  kickTower(id: string | number, strength = 1): void {
    const n = this.towers.get(id);
    if (n) n.recoil = Math.min(1.4, n.recoil + strength);
  }

  /** Scale-punch when a tower takes melee damage. Wired to `tower:damaged`. */
  flashTower(id: string | number): void {
    const n = this.towers.get(id);
    if (n) n.hitPunch = 1;
  }

  // ---------- enemies ----------

  private syncEnemies(list: RenderEnemy[], dt: number, time: number): void {
    const seen = new Set<number>();
    for (const e of list) {
      seen.add(e.id);
      const vis = enemyVisual(e.type);
      let n = this.enemies.get(e.id);
      if (!n) {
        n = this.makeEnemy(vis);
        this.enemies.set(e.id, n);
        this.enemyLayer.addChild(n.root);
        n.root.scale.set(0.2); // spawn pop
      } else if (n.textureName !== vis.texture) {
        n.type = vis.key;
        n.textureName = vis.texture;
        n.body.texture = this.tex.get(vis.texture) ?? PIXI.Texture.WHITE;
        n.flash.texture = this.tex.get(vis.flash) ?? PIXI.Texture.WHITE;
      }
      if (e.hp < n.lastHp) this.flashEnemy(e.id);
      n.lastHp = e.hp;

      const poisoned = (e.poisonEffects ?? []).length > 0;
      if (poisoned !== n.lastPoisoned) {
        n.lastPoisoned = poisoned;
        n.poison.alpha = poisoned ? 0.6 : 0;
      }

      n.root.position.set(e.x, e.y);
      n.root.zIndex = e.y; // 2.5D depth: lower on screen draws in front

      // --- Fluid motion layer (transform-only, distance-synced) ---
      // Footsteps advance with actual distance walked, so rhythm matches speed
      // and stays framerate-independent.
      const dist = e.distanceTraveled ?? 0;
      let stepDist = n.lastDist === 0 ? 0 : dist - n.lastDist;
      if (stepDist < 0 || stepDist > 200) stepDist = 0; // teleport/reset guard
      n.lastDist = dist;
      n.walkPhase += stepDist * vis.stride;
      const hop = Math.abs(Math.sin(n.walkPhase));

      // Spawn pop eases in once.
      if (n.popScale < 1) n.popScale = Math.min(1, n.popScale + dt * 4);
      n.root.scale.set(n.popScale);

      // Jelly squash/stretch + hit punch.
      n.hitPunch = Math.max(0, n.hitPunch - dt * 6);
      const sx = 1 - hop * vis.squash + n.hitPunch * 0.18;
      const sy = 1 + hop * vis.squash - n.hitPunch * 0.12;
      n.body.scale.set(vis.bodyScale * sx, vis.bodyScale * sy);
      n.flash.scale.set(vis.bodyScale * sx, vis.bodyScale * sy);

      // Grounded shadow: body lifts on the hop, shadow stays put and tightens
      // (smaller + fainter) as the creature rises — the core 2.5D depth cue.
      const lift = hop * vis.hop * 1.7;
      n.body.position.y = -lift;
      n.flash.position.y = -lift;
      n.poison.position.y = -lift;
      const shadowK = vis.shadowScale * SOFT_SHADOW * (1 - hop * 0.28);
      n.shadow.scale.set(shadowK, shadowK * 0.62);
      n.shadow.alpha = 0.95 - hop * 0.35;

      // Lean into travel direction (skew), smoothed.
      if (Number.isNaN(n.lastX)) {
        n.lastX = e.x;
        n.lastY = e.y;
      }
      const vx = e.x - n.lastX;
      const vy = e.y - n.lastY;
      n.lastX = e.x;
      n.lastY = e.y;
      // Heavy units (lean 0) do not skew — a hulking boss sheared by its own
      // velocity read as broken art, so the factor scales to zero with lean.
      const leanK = vis.lean / 0.1;
      const clampSkew = (v: number) => Math.max(-0.18, Math.min(0.18, v));
      const targetSkewX = clampSkew(vx * 0.028 * leanK);
      const targetSkewY = clampSkew(vy * 0.028 * leanK);
      const kS = Math.min(1, dt * 8);
      n.skewX += (targetSkewX - n.skewX) * kS;
      n.skewY += (targetSkewY - n.skewY) * kS;
      n.body.skew.set(n.skewX, n.skewY);

      n.body.rotation = Math.cos(n.walkPhase) * vis.lean;

      if (n.flashT > 0) {
        n.flashT -= dt;
        n.flash.alpha = Math.max(0, n.flashT / 0.09) * 0.9;
      } else {
        n.flash.alpha = 0;
      }

      // HP bar: shields show as a blue bar until broken; bosses always show.
      const shield = e.shield ?? 0;
      const maxShield = e.maxShield ?? 0;
      const hasShield = maxShield > 0 && shield > 0;
      const frac = hasShield
        ? Math.min(1, Math.max(0, shield / maxShield))
        : e.maxHp > 0
          ? Math.min(1, Math.max(0, e.hp / e.maxHp))
          : 0;
      const visible = vis.alwaysHpBar || hasShield || frac < 0.999;
      if (
        visible !== n.lastHpVisible ||
        hasShield !== n.lastHasShield ||
        Math.abs(frac - n.lastHpFrac) > 0.01
      ) {
        n.lastHpVisible = visible;
        n.lastHasShield = hasShield;
        n.lastHpFrac = frac;
        n.hpBar.visible = visible;
        if (visible) {
          const { barW: bw, barH: bh } = vis;
          const fill = hasShield
            ? 0x60a5fa
            : frac > 0.55
              ? 0x4ade80
              : frac > 0.28
                ? 0xfbbf24
                : 0xef4444;
          n.hpBar.clear();
          n.hpBar.roundRect(0, 0, bw, bh, bh / 2).fill({ color: 0x1f2937, alpha: 0.85 });
          n.hpBar.roundRect(1, 1, (bw - 2) * frac, bh - 2, (bh - 2) / 2).fill({ color: fill });
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

  private makeEnemy(vis: EnemyVisual): EnemyNode {
    const pooled = this.deadPool.pop();
    const root = pooled?.root ?? new PIXI.Container();
    root.eventMode = 'none';
    const body = pooled?.body ?? new PIXI.Sprite();
    body.texture = this.tex.get(vis.texture) ?? PIXI.Texture.WHITE;
    body.anchor.set(0.5);
    const flash = pooled?.flash ?? new PIXI.Sprite();
    flash.texture = this.tex.get(vis.flash) ?? PIXI.Texture.WHITE;
    flash.anchor.set(0.5);
    flash.alpha = 0;
    body.scale.set(vis.bodyScale);
    flash.scale.set(vis.bodyScale);
    const hpBar = pooled?.hpBar ?? new PIXI.Graphics();
    hpBar.visible = false;
    hpBar.eventMode = 'none';
    const shadow = pooled?.shadow ?? new PIXI.Sprite(this.tex.get('shadow'));
    shadow.anchor.set(0.5);
    // Sun from upper-left: soft cast shadow under the enemy.
    shadow.position.set(3, vis.shadowY + 2);
    const baseShadow = vis.shadowScale * SOFT_SHADOW;
    shadow.scale.set(baseShadow, baseShadow * 0.62);
    shadow.alpha = 0.95;
    // Green poison overlay sprite, tinted over the body.
    const poison = pooled?.poison ?? new PIXI.Sprite(this.tex.get('poison-overlay'));
    poison.anchor.set(0.5);
    poison.alpha = 0;
    // Fresh nodes get children mounted once; pooled nodes ensure order.
    if (!pooled) {
      root.addChild(shadow, body, flash, poison, hpBar);
    } else {
      if (shadow.parent !== root) root.addChild(shadow);
      if (body.parent !== root) root.addChild(body);
      if (flash.parent !== root) root.addChild(flash);
      if (poison.parent !== root) root.addChild(poison);
      if (hpBar.parent !== root) root.addChild(hpBar);
    }
    // HP bar geometry is per-type and must be reset even for pooled nodes.
    hpBar.position.set(-vis.barW / 2, vis.barY);
    return {
      root, shadow, body, flash, hpBar, poison,
      phase: Math.random() * Math.PI * 2,
      flashT: 0,
      lastHp: Number.POSITIVE_INFINITY,
      lastHpFrac: 1,
      lastHpVisible: false,
      lastHasShield: false,
      lastPoisoned: false,
      type: vis.key,
      textureName: vis.texture,
      popScale: 0.2,
      walkPhase: Math.random() * Math.PI * 2,
      hitPunch: 0,
      lastDist: 0,
      lastX: Number.NaN,
      lastY: Number.NaN,
      skewX: 0,
      skewY: 0,
    };
  }

  // ---------- towers ----------

  private syncTowers(list: RenderTower[], dt: number): void {
    const seen = new Set<string | number>();
    for (const t of list) {
      seen.add(t.id);
      const kind =
        t.kind === 'cannon'
          ? 'cannon'
          : t.kind === 'bomb'
            ? 'bomb'
            : t.kind === 'frost'
              ? 'frost'
              : t.kind === 'sniper'
                ? 'sniper'
                : t.kind === 'alchemist'
                  ? 'alchemist'
                  : t.kind === 'war-drums'
                    ? 'war-drums'
                    : 'crossbow';
      let n = this.towers.get(t.id);
      if (!n) {
        n = this.makeTower(kind, t.level);
        n.root.position.set(t.x, t.y);
        this.towers.set(t.id, n);
        this.towerLayer.addChild(n.root);
        n.root.scale.set(0.2); // placement bounce (Effects.place plays the glow)
      }
      n.root.position.set(t.x, t.y);
      n.root.zIndex = t.y; // 2.5D depth sort
      if (n.baseScale < 1) {
        const s = Math.min(1, n.baseScale + dt * 4);
        n.baseScale = s >= 1 ? 1 : s < 0.8 ? s : 1 + (s - 0.8) * 0.5;
      }
      n.hitPunch = Math.max(0, n.hitPunch - dt * 5);
      n.root.scale.set(n.baseScale * (1 + n.hitPunch * 0.07));
      if (n.level !== t.level || n.branch !== t.branch) {
        n.level = t.level;
        n.branch = t.branch;
        const branch = t.branch ? branchFor(t.kind as TowerId, t.branch) : undefined;
        n.badge.text = t.level > 1 ? `Lv${t.level}${branch ? ` ${branch.abbr}` : ''}` : '';
        n.badge.style.fill = branch ? branch.color : 0xffffff;
        n.base.tint = LEVEL_TINTS[Math.min(4, Math.max(0, t.level - 1))];
        this.drawPips(n);
      }
      // Rotate weapon toward target (spec §40) + recoil decay.
      if (t.angle !== undefined) n.angle = lerpAngle(n.angle, t.angle, dt * 10);
      n.recoil = Math.max(0, n.recoil - dt * 6);
      n.top.rotation = n.angle;
      const back = n.recoil * 7;
      // TOP_RISE keeps the weapon on the extruded drum's top face.
      n.top.position.set(-Math.cos(n.angle) * back, TOP_RISE - Math.sin(n.angle) * back);

      const auraRadius = t.auraRadius ?? 0;
      const buffed = !!t.buffed;
      if (auraRadius !== n.lastAuraRadius || buffed !== n.lastBuffed) {
        n.lastAuraRadius = auraRadius;
        n.lastBuffed = buffed;
        n.aura.clear();
        if (auraRadius > 0) {
          n.aura.circle(0, 0, auraRadius).stroke({ width: 2, color: 0xf59e0b, alpha: 0.45 });
        } else if (buffed) {
          n.aura.circle(0, 0, 22).stroke({ width: 3, color: 0x4ade80, alpha: 0.8 });
        }
      }
      n.aura.visible = n.lastAuraRadius > 0 || n.lastBuffed;
      n.buff.visible = buffed && !n.lastAuraRadius;
      // Hull bar: only while damaged (healed towers hide it again).
      const frac =
        t.maxHp !== undefined && t.maxHp > 0 && t.hp !== undefined
          ? Math.min(1, Math.max(0, t.hp / t.maxHp))
          : 1;
      const visible = frac < 0.999;
      if (visible !== n.lastHpVisible || Math.abs(frac - n.lastHpFrac) > 0.01) {
        n.lastHpVisible = visible;
        n.lastHpFrac = frac;
        n.hpBar.visible = visible;
        if (visible) {
          const bw = 44;
          const bh = 6;
          const fill = frac > 0.55 ? 0x4ade80 : frac > 0.28 ? 0xfbbf24 : 0xef4444;
          n.hpBar.clear();
          n.hpBar.roundRect(0, 0, bw, bh, bh / 2).fill({ color: 0x1f2937, alpha: 0.85 });
          n.hpBar.roundRect(1, 1, (bw - 2) * frac, bh - 2, (bh - 2) / 2).fill({ color: fill });
        }
      }
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
    // Sun from upper-left: soft cast shadow under the tower drum.
    shadow.position.set(5, 17);
    shadow.scale.set(1.15, 0.72);
    shadow.alpha = 0.95;
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
    const pips = new PIXI.Graphics();
    pips.eventMode = 'none';
    pips.position.y = 20;
    const hpBar = new PIXI.Graphics();
    hpBar.visible = false;
    hpBar.eventMode = 'none';
    hpBar.position.set(-22, -52);
    root.addChild(shadow, base, top, badge, pips, hpBar);
    const aura = new PIXI.Graphics();
    const buff = new PIXI.Graphics();
    root.addChildAt(aura, 0);
    root.addChild(buff);
    const node: TowerNode = { root, top, base, badge, pips, hpBar, aura, buff, angle: -Math.PI / 2, recoil: 0, level, kind, branch: undefined, baseScale: 0.2, hitPunch: 0, lastHpFrac: 1, lastHpVisible: false, lastAuraRadius: -1, lastBuffed: false };
    this.drawPips(node);
    return node;
  }

  /** Level pips under the base: filled gold = earned, hollow = remaining. */
  private drawPips(n: TowerNode): void {
    const g = n.pips;
    g.clear();
    const max = 5;
    for (let i = 0; i < max; i++) {
      const x = (i - (max - 1) / 2) * 11;
      if (i < n.level) {
        g.circle(x, 0, 4).fill({ color: 0xffc93c });
        g.circle(x, 0, 4).stroke({ width: 1.5, color: 0x7a5b00 });
      } else {
        g.circle(x, 0, 3.2).fill({ color: 0x2b2440, alpha: 0.35 });
      }
    }
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
        const shadow = reuse?.shadow ?? new PIXI.Sprite(this.tex.get('shadow'));
        shadow.eventMode = 'none';
        shadow.anchor.set(0.5);
        shadow.alpha = 0.4;
        n = { sprite, shadow, kind: p.kind };
        if (shadow.parent !== this.projectileLayer) this.projectileLayer.addChild(shadow);
        if (sprite.parent !== this.projectileLayer) this.projectileLayer.addChild(sprite);
        sprite.visible = true;
        shadow.visible = true;
        this.projectiles.set(p.id, n);
      }
      if (n.kind !== p.kind) {
        n.kind = p.kind;
        n.sprite.texture = this.tex.get(p.kind) ?? PIXI.Texture.WHITE;
      }
      n.sprite.position.set(p.x, p.y);
      n.sprite.rotation = p.angle;
      if (p.kind === 'bomb') n.sprite.scale.set(1 + Math.sin(p.x * 0.05 + p.y * 0.05) * 0.08);
      // Ground shadow tracks the shot: the vertical gap sells flight height.
      const sh = p.kind === 'arrow' || p.kind === 'bullet' ? 0.26 : 0.34;
      n.shadow.position.set(p.x + 2, p.y + 10);
      n.shadow.scale.set(sh, sh * 0.55);
    }
    for (const [id, n] of this.projectiles) {
      if (!seen.has(id)) {
        this.projectileLayer.removeChild(n.sprite);
        this.projectileLayer.removeChild(n.shadow);
        n.sprite.visible = false;
        n.shadow.visible = false;
        if (this.projPool.length < 256) this.projPool.push(n);
        this.projectiles.delete(id);
      }
    }
  }

  // ---------- procedural texture painters (chunky cartoon) ----------

  /**
   * Soft radial contact shadow baked from a canvas gradient (2.5D grounding).
   * Sprites squash it into a ground-plane ellipse and grow/shrink it with the
   * entity's hop height, so nothing ever floats without an anchor.
   */
  private softShadowTexture(): PIXI.Texture {
    const cached = this.tex.get('shadow');
    if (cached) return cached;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(16,24,12,0.62)');
    grad.addColorStop(0.5, 'rgba(16,24,12,0.3)');
    grad.addColorStop(0.82, 'rgba(16,24,12,0.08)');
    grad.addColorStop(1, 'rgba(16,24,12,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = PIXI.Texture.from(canvas);
    this.tex.set('shadow', tex);
    return tex;
  }

  /**
   * Radial "volume" fill: lit from the upper-left, shaded to the lower-right.
   * `local` texture space maps the gradient to each shape's own bounds, so a
   * single helper shades every body part without per-shape maths.
   */
  private volume(base: number, light = 0.5, dark = 0.34): PIXI.FillGradient {
    const c = { x: 0.36, y: 0.3 };
    return new PIXI.FillGradient({
      type: 'radial',
      center: c,
      innerRadius: 0,
      outerCenter: c,
      outerRadius: 0.82,
      colorStops: [
        { offset: 0, color: mixColor(base, 0xffffff, light) },
        { offset: 0.45, color: mixColor(base, 0xffffff, 0.06) },
        { offset: 1, color: mixColor(base, 0x000000, dark) },
      ],
      textureSpace: 'local',
    });
  }

  private gruntG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    const base = 0x4ade80;
    const edge = 0x1b6b33;
    const light = mixColor(base, 0xffffff, 0.7);
    // Feet + stub arms (behind the body).
    for (const fx of [15, 33]) {
      g.circle(fx, 43, 6).fill(this.volume(0x3bbf63));
      g.circle(fx, 43, 6).stroke({ width: 3, color: edge });
    }
    for (const ax of [6, 42]) {
      g.circle(ax, 30, 5.5).fill(this.volume(0x3bbf63));
      g.circle(ax, 30, 5.5).stroke({ width: 2.5, color: edge });
    }
    // Body.
    g.circle(24, 26, 18).fill(this.volume(base));
    g.circle(24, 26, 18).stroke({ width: 4, color: edge });
    g.ellipse(24, 33, 11, 7.5).fill({ color: mixColor(base, 0xffffff, 0.55), alpha: 0.95 });
    // Rim light (upper-left) + gloss.
    g.ellipse(18, 18, 6.5, 4.5).fill({ color: light, alpha: 0.55 });
    g.circle(21, 13.5, 2).fill({ color: 0xffffff, alpha: 0.8 });
    // Eyes.
    g.circle(17, 23, 6.5).fill({ color: 0xf7fee7 });
    g.circle(31, 23, 6.5).fill({ color: 0xf7fee7 });
    g.circle(17, 23, 6.5).stroke({ width: 2, color: edge });
    g.circle(31, 23, 6.5).stroke({ width: 2, color: edge });
    g.circle(18, 24, 3.1).fill({ color: 0x1f2937 });
    g.circle(32, 24, 3.1).fill({ color: 0x1f2937 });
    g.circle(19, 23, 1.3).fill({ color: 0xffffff });
    g.circle(33, 23, 1.3).fill({ color: 0xffffff });
    // Angry brows.
    g.poly([9, 13, 22, 17]).stroke({ width: 3.5, color: edge, cap: 'round' });
    g.poly([28, 17, 41, 13]).stroke({ width: 3.5, color: edge, cap: 'round' });
    // Grimace with a fang.
    g.roundRect(19, 33, 11, 4, 2).fill({ color: 0x14532d });
    g.poly([22, 33, 24, 38, 26, 33]).fill({ color: 0xffffff });
    return g;
  }

  private runnerG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    const base = 0xfb923c;
    const edge = 0xb45309;
    const light = mixColor(base, 0xffffff, 0.7);
    // Legs (behind).
    for (const lx of [13, 27]) {
      g.circle(lx, 35, 5).fill(this.volume(0xf97316));
      g.circle(lx, 35, 5).stroke({ width: 2.5, color: edge });
    }
    // Body.
    g.circle(20, 22, 13).fill(this.volume(base));
    g.circle(20, 22, 13).stroke({ width: 3.5, color: edge });
    g.ellipse(20, 27, 7.5, 5.5).fill({ color: mixColor(base, 0xffffff, 0.6), alpha: 0.95 });
    g.ellipse(15, 16, 5, 3.4).fill({ color: light, alpha: 0.55 });
    // Wide alert eyes.
    g.circle(15, 19, 5.5).fill({ color: 0xfffbeb });
    g.circle(26, 19, 5.5).fill({ color: 0xfffbeb });
    g.circle(15, 19, 5.5).stroke({ width: 2, color: edge });
    g.circle(26, 19, 5.5).stroke({ width: 2, color: edge });
    g.circle(16, 20, 2.7).fill({ color: 0x1f2937 });
    g.circle(27, 20, 2.7).fill({ color: 0x1f2937 });
    // Headband with trailing tail.
    g.roundRect(6, 10, 28, 5.5, 2.75).fill(this.volume(0xef4444));
    g.roundRect(6, 10, 28, 5.5, 2.75).stroke({ width: 2, color: 0x991b1b });
    g.poly([6, 12, -2, 17, 6, 15]).fill({ color: 0xdc2626 });
    // Speed streaks.
    g.poly([2, 16, 8, 16]).stroke({ width: 2.5, color: 0xfdba74, cap: 'round' });
    g.poly([0, 24, 7, 24]).stroke({ width: 2.5, color: 0xfdba74, cap: 'round' });
    return g;
  }

  private spearmanG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    const base = 0xef4444;
    const edge = 0x7f1d1d;
    const light = mixColor(base, 0xffffff, 0.7);
    // Spear (behind the body).
    g.poly([38, 46, 58, 8]).stroke({ width: 4.5, color: 0x7c4a1e, cap: 'round' });
    g.poly([38, 46, 58, 8]).stroke({ width: 2, color: 0xb98a52, cap: 'round' });
    g.poly([53, 3, 63, 13, 56, 10, 54, 12]).fill({ color: 0xe5e7eb });
    g.poly([53, 3, 63, 13]).stroke({ width: 2, color: 0x9ca3af, cap: 'round' });
    // Feet.
    for (const fx of [15, 33]) {
      g.circle(fx, 44, 5).fill(this.volume(0xdc2626));
      g.circle(fx, 44, 5).stroke({ width: 2.5, color: edge });
    }
    // Body.
    g.circle(24, 28, 16).fill(this.volume(base));
    g.circle(24, 28, 16).stroke({ width: 4, color: edge });
    g.ellipse(24, 34, 9.5, 6.5).fill({ color: mixColor(base, 0xffffff, 0.6), alpha: 0.95 });
    g.ellipse(18, 22, 5.5, 3.6).fill({ color: light, alpha: 0.5 });
    // Metal helm band with a rivet.
    g.roundRect(9, 12, 30, 6, 3).fill(this.volume(0x9ca3af, 0.4, 0.2));
    g.roundRect(9, 12, 30, 6, 3).stroke({ width: 2, color: 0x4b5563 });
    g.circle(24, 15, 3).fill({ color: 0xfbbf24 });
    // Eyes.
    g.circle(17, 26, 6).fill({ color: 0xfff1f2 });
    g.circle(31, 26, 6).fill({ color: 0xfff1f2 });
    g.circle(17, 26, 6).stroke({ width: 2, color: edge });
    g.circle(31, 26, 6).stroke({ width: 2, color: edge });
    g.circle(18, 27, 2.9).fill({ color: 0x1f2937 });
    g.circle(32, 27, 2.9).fill({ color: 0x1f2937 });
    g.poly([9, 17, 22, 21]).stroke({ width: 3.5, color: edge, cap: 'round' });
    g.poly([28, 21, 41, 17]).stroke({ width: 3.5, color: edge, cap: 'round' });
    return g;
  }

  private tankG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    const base = 0xa78bfa;
    const edge = 0x4c1d95;
    const metal = 0xd1d5db;
    const metalEdge = 0x6b7280;
    const light = mixColor(base, 0xffffff, 0.75);
    // Armor plates (behind the body).
    for (const [px, py] of [[8, 12], [40, 12], [22, 44]] as const) {
      g.roundRect(px, py, 16, 12, 4).fill(this.volume(metal, 0.4, 0.2));
      g.roundRect(px, py, 16, 12, 4).stroke({ width: 2.5, color: metalEdge });
    }
    // Body.
    g.circle(32, 34, 26).fill(this.volume(base));
    g.circle(32, 34, 26).stroke({ width: 5, color: edge });
    g.ellipse(32, 43, 13, 8).fill({ color: mixColor(base, 0xffffff, 0.6), alpha: 0.95 });
    g.ellipse(23, 24, 8, 5).fill({ color: light, alpha: 0.55 });
    // Rivets.
    g.circle(16, 18, 2.2).fill({ color: 0x9ca3af });
    g.circle(48, 18, 2.2).fill({ color: 0x9ca3af });
    // Menacing glowing eyes.
    g.circle(23, 28, 7).fill({ color: 0x111827 });
    g.circle(41, 28, 7).fill({ color: 0x111827 });
    g.circle(23, 29, 3.4).fill({ color: 0xf87171 });
    g.circle(41, 29, 3.4).fill({ color: 0xf87171 });
    g.circle(22, 28, 1.3).fill({ color: 0xffffff });
    g.circle(40, 28, 1.3).fill({ color: 0xffffff });
    g.poly([15, 20, 29, 24]).stroke({ width: 3.5, color: edge, cap: 'round' });
    g.poly([35, 24, 49, 20]).stroke({ width: 3.5, color: edge, cap: 'round' });
    // Battle crack across the armor.
    g.poly([45, 32, 39, 39, 43, 47]).stroke({ width: 2, color: 0x3b1580, cap: 'round' });
    return g;
  }

  private bossG(
    body = 0x9f1239,
    edge = 0x4c0519,
    belly = 0xfca5a5,
    spike = 0xd1d5db,
    spikeEdge = 0x6b7280,
    horn = 0xfef3c7,
    hornEdge = 0x7a5b00,
  ): PIXI.Graphics {
    const g = new PIXI.Graphics();
    const light = mixColor(body, 0xffffff, 0.5);
    const darkish = mixColor(body, 0x000000, 0.4);
    // Spiked pauldrons.
    g.circle(20, 42, 16).fill(this.volume(darkish));
    g.circle(20, 42, 16).stroke({ width: 5, color: edge });
    g.circle(84, 42, 16).fill(this.volume(darkish));
    g.circle(84, 42, 16).stroke({ width: 5, color: edge });
    g.poly([8, 30, 20, 12, 32, 30]).fill(this.volume(spike, 0.5, 0.25));
    g.poly([8, 30, 20, 12, 32, 30]).stroke({ width: 3, color: spikeEdge });
    g.poly([72, 30, 84, 12, 96, 30]).fill(this.volume(spike, 0.5, 0.25));
    g.poly([72, 30, 84, 12, 96, 30]).stroke({ width: 3, color: spikeEdge });
    // Hulking warlord body (palette swaps per variant).
    g.circle(52, 56, 40).fill(this.volume(body));
    g.circle(52, 56, 40).stroke({ width: 7, color: edge });
    g.ellipse(52, 70, 22, 15).fill({ color: belly, alpha: 0.95 });
    g.ellipse(38, 40, 13, 8).fill({ color: light, alpha: 0.5 });
    // Crown horns.
    g.poly([26, 24, 34, 2, 42, 26]).fill(this.volume(horn, 0.55, 0.2));
    g.poly([26, 24, 34, 2, 42, 26]).stroke({ width: 3, color: hornEdge });
    g.poly([62, 26, 70, 2, 78, 24]).fill(this.volume(horn, 0.55, 0.2));
    g.poly([62, 26, 70, 2, 78, 24]).stroke({ width: 3, color: hornEdge });
    // Glowing angry eyes.
    g.circle(38, 50, 9).fill({ color: 0x111827 });
    g.circle(66, 50, 9).fill({ color: 0x111827 });
    g.circle(39, 50, 4.5).fill({ color: 0xfde047 });
    g.circle(67, 50, 4.5).fill({ color: 0xfde047 });
    g.circle(39, 49, 1.8).fill({ color: 0xffffff });
    g.circle(67, 49, 1.8).fill({ color: 0xffffff });
    g.poly([26, 40, 44, 46]).stroke({ width: 5, color: edge, cap: 'round' });
    g.poly([60, 46, 78, 40]).stroke({ width: 5, color: edge, cap: 'round' });
    // Tusked maw.
    g.roundRect(38, 68, 28, 12, 5).fill({ color: 0x2a0606 });
    g.poly([40, 68, 44, 79, 48, 68]).fill({ color: 0xffffff });
    g.poly([56, 68, 60, 79, 64, 68]).fill({ color: 0xffffff });
    g.poly([70, 58, 76, 66, 72, 74]).stroke({ width: 2.5, color: edge, cap: 'round' });
    return g;
  }

  private flashCircleG(r: number, cx = 24, cy = 24): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(cx, cy, r * 0.8).fill({ color: 0xffffff });
    return g;
  }

  /**
   * 2.5D tower drum: an extruded cylinder with a visible side wall, a lit top
   * face and a stone contact plinth. Because the top rotates with the weapon
   * while the drum stays put, the base reads as a solid object standing on the
   * ground rather than a flat disc. Baked once per tower type.
   */
  private towerBaseG(fill: number, edge: number): PIXI.Graphics {
    const g = new PIXI.Graphics();
    const cx = 32;
    const topY = 24;
    const botY = 52;
    const rx = 24;
    const ry = 12;
    const side = mixColor(fill, edge, 0.45);
    const sideDark = mixColor(fill, edge, 0.82);
    const sideLight = mixColor(fill, 0xffffff, 0.32);

    // Contact plinth (stone ring) grounded on the grass.
    g.ellipse(cx, 55, 28, 10).fill({ color: 0xd9cfb8 });
    g.ellipse(cx, 55, 28, 10).stroke({ width: 4, color: 0x8a7f63 });
    // Drum bottom cap.
    g.ellipse(cx, botY, rx, ry).fill({ color: sideDark });
    // Side wall.
    g.roundRect(cx - rx, topY, rx * 2, botY - topY + 2, 6).fill({ color: side });
    // Left key-light band + right occlusion band (sun from upper-left).
    g.roundRect(cx - rx + 4, topY + 4, 9, botY - topY - 4, 4).fill({ color: sideLight, alpha: 0.5 });
    g.roundRect(cx + rx - 12, topY + 4, 8, botY - topY - 4, 4).fill({ color: 0x000000, alpha: 0.16 });
    // Top face cap (lit).
    g.ellipse(cx, topY, rx, ry).fill({ color: fill });
    g.ellipse(cx, topY, rx, ry).stroke({ width: 5, color: edge });
    g.ellipse(cx - 3, topY - 3, rx * 0.62, ry * 0.55).fill({ color: 0xffffff, alpha: 0.22 });
    // Bolts around the top rim (follow the ellipse).
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      g.circle(cx + Math.cos(a) * (rx - 4), topY + Math.sin(a) * (ry - 2.5), 2.4).fill({ color: edge });
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

  private frostTopG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    // Crystal shard cluster.
    g.poly([28, 4, 40, 28, 28, 52, 16, 28]).fill({ color: 0xbfdbfe });
    g.poly([28, 4, 40, 28, 28, 52, 16, 28]).stroke({ width: 3, color: 0x1e40af });
    g.poly([28, 10, 34, 28, 28, 44, 22, 28]).fill({ color: 0xffffff, alpha: 0.85 });
    g.circle(28, 28, 7).fill({ color: 0x60a5fa });
    g.circle(28, 28, 7).stroke({ width: 2.5, color: 0x1e40af });
    g.circle(26, 26, 2.5).fill({ color: 0xffffff });
    // Side shards.
    g.poly([12, 30, 18, 20, 22, 32]).fill({ color: 0xdbeafe });
    g.poly([34, 32, 38, 20, 44, 30]).fill({ color: 0xdbeafe });
    return g;
  }

  private sniperTopG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    // Long barrel.
    g.roundRect(16, 25, 38, 6, 3).fill({ color: 0x1f2937 });
    g.roundRect(16, 25, 38, 6, 3).stroke({ width: 2.5, color: 0x0b0f16 });
    g.roundRect(50, 25.5, 10, 5, 2).fill({ color: 0x111827 });
    // Stock.
    g.roundRect(2, 23, 16, 10, 3).fill({ color: 0x4b5563 });
    g.roundRect(2, 23, 16, 10, 3).stroke({ width: 2.5, color: 0x1f2937 });
    // Scope.
    g.circle(26, 28, 9).fill({ color: 0x374151 });
    g.circle(26, 28, 9).stroke({ width: 3, color: 0x0b0f16 });
    g.circle(26, 28, 4).fill({ color: 0x9ca3af });
    g.circle(26, 28, 2).fill({ color: 0xef4444 });
    return g;
  }

  private alchemistTopG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    // Alembics still bubbling with a greenish poison.
    g.circle(24, 28, 18).fill({ color: 0x7c3bed });
    g.circle(24, 28, 18).stroke({ width: 3, color: 0x4b0082 });
    g.circle(24, 26, 11).fill({ color: 0x8b5cf6, alpha: 0.85 });
    // Glass dome with a swirling drop.
    g.poly([20, 16, 28, 16]).stroke({ width: 2.5, color: 0xc4b5fd });
    g.circle(24, 20, 4).fill({ color: 0x4ade80, alpha: 0.9 });
    g.circle(22, 19, 1.5).fill({ color: 0xffffff });
    return g;
  }

  private warDrumsTopG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    // Tensioned drumhead over a rim.
    g.circle(24, 28, 18).fill({ color: 0x92400e });
    g.circle(24, 28, 18).stroke({ width: 6, color: 0x451a03 });
    g.circle(24, 28, 12).fill({ color: 0x000000, alpha: 0.25 });
    // Lugs + tension ropes.
    for (const a of [0.4, 2.7, 3.6, 5.9]) {
      const dx = Math.cos(a) * 14;
      const dy = Math.sin(a) * 14;
      g.poly([24, 28, 24 + dx, 28 + dy]).stroke({ width: 3, color: 0x451a03, cap: 'round' });
      g.circle(24 + dx, 28 + dy, 4).fill({ color: 0x451a03 });
    }
    return g;
  }

  private poisonOverlayG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    // Green translucent overlay tinted on top of the body sprite.
    g.circle(24, 24, 22).fill({ color: 0x4ade80, alpha: 0.3 });
    return g;
  }

  private vialG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    // Glass vial with a green poison core.
    g.poly([4, 2, 16, 2, 18, 14, 2, 14]).fill({ color: 0x4ade80, alpha: 0.35 });
    g.poly([4, 2, 16, 2, 18, 14, 2, 14]).stroke({ width: 2, color: 0x1f2937 });
    g.poly([6, 4, 14, 4, 15, 13, 5, 13]).fill({ color: 0x22c55e });
    g.poly([8, 6, 12, 6, 13, 12, 7, 12]).fill({ color: 0xffffff, alpha: 0.4 });
    // Dropper bulb.
    g.circle(16, 3, 4).fill({ color: 0x1f2937 });
    g.circle(16, 3, 4).stroke({ width: 1.5, color: 0x0f172a });
    return g;
  }

  private arrowG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.poly([0, 4, 16, 4]).stroke({ width: 5, color: 0x451a03, cap: 'round', alpha: 0.9 });
    g.poly([0, 4, 16, 4]).stroke({ width: 3, color: 0x92400e, cap: 'round' });
    g.poly([16, 0, 24, 4, 16, 8]).fill({ color: 0x9ca3af });
    g.poly([16, 0, 24, 4, 16, 8]).stroke({ width: 1.5, color: 0x4b5563 });
    g.poly([18, 2.5, 21, 4, 18, 5.5]).fill({ color: 0xf8fafc });
    g.poly([0, 2, 5, 4, 0, 6]).fill({ color: 0xef4444 });
    return g;
  }

  private cannonballG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(10, 8, 8).fill({ color: 0xf97316, alpha: 0.35 });
    g.circle(8, 8, 7).fill({ color: 0x1f2937 });
    g.circle(8, 8, 7).stroke({ width: 2, color: 0x0b0f16 });
    g.circle(6, 6, 2.5).fill({ color: 0x9ca3af });
    g.circle(5.2, 5.2, 1).fill({ color: 0xffffff });
    return g;
  }

  private bombProjG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(10, 11, 12).fill({ color: 0xfbbf24, alpha: 0.3 });
    g.circle(10, 11, 9).fill({ color: 0x134e4a });
    g.circle(10, 11, 9).stroke({ width: 2.5, color: 0x042f2e });
    g.circle(7, 8, 3).fill({ color: 0x5eead4 });
    g.poly([15, 5, 19, 1]).stroke({ width: 2.5, color: 0x92400e, cap: 'round' });
    g.circle(20, 1, 4).fill({ color: 0xfde047, alpha: 0.45 });
    g.circle(20, 1, 2.5).fill({ color: 0xfde047 });
    return g;
  }

  private frostshardG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(8, 8, 8).fill({ color: 0xbfdbfe, alpha: 0.45 });
    g.poly([8, 0, 13, 8, 8, 16, 3, 8]).fill({ color: 0xdbeafe });
    g.poly([8, 0, 13, 8, 8, 16, 3, 8]).stroke({ width: 1.5, color: 0x3b82f6 });
    g.circle(8, 8, 2.5).fill({ color: 0xffffff });
    return g;
  }

  private bulletG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    // Tracer streak + hot round.
    g.poly([0, 4, 18, 1, 22, 4, 18, 7]).fill({ color: 0xfde047, alpha: 0.5 });
    g.circle(20, 4, 4).fill({ color: 0xfbbf24 });
    g.circle(20, 4, 4).stroke({ width: 1.5, color: 0x92400e });
    g.circle(21, 3, 1.5).fill({ color: 0xffffff });
    return g;
  }
}
