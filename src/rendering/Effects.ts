import * as PIXI from 'pixi.js';

interface Particle {
  sprite: PIXI.Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  baseScale: number;
  active: boolean;
}

interface Ring {
  sprite: PIXI.Sprite;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  active: boolean;
}

interface FloatText {
  text: PIXI.Text;
  life: number;
  maxLife: number;
  vy: number;
  active: boolean;
}

/**
 * Pooled juice (spec §41–43): death pops, arrow snaps, muzzle flashes,
 * cannon fire, splash explosions, placement poofs, base-hit flashes,
 * floating damage numbers.
 *
 * Zero per-frame allocation: fixed pools of Sprites/Text created once in
 * `init()` and recycled. Shake goes through `onShake` (Renderer trauma,
 * honors the shake setting). All entities stay inside PixiJS (spec §75–76).
 */
export class Effects {
  onShake: ((trauma: number) => void) | null = null;

  private fx: PIXI.Container;
  private overlay: PIXI.Container;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private numbers: FloatText[] = [];
  private flashes: { sprite: PIXI.Sprite; life: number; maxLife: number }[] = [];
  private dotTex: PIXI.Texture = PIXI.Texture.WHITE;
  private ringTex: PIXI.Texture = PIXI.Texture.WHITE;
  private starTex: PIXI.Texture = PIXI.Texture.WHITE;
  private shakeOn = true;
  private damageOn = true;

  constructor(fxLayer: PIXI.Container, overlayLayer: PIXI.Container) {
    this.fx = fxLayer;
    this.overlay = overlayLayer;
    this.overlay.eventMode = 'none';
  }

  /** Bake textures + allocate pools. Called from main.ts after create. Accepts Application or Renderer. */
  init(appOrRenderer: PIXI.Application | PIXI.Renderer): void {
    const renderer = (appOrRenderer as PIXI.Application).renderer ?? (appOrRenderer as PIXI.Renderer);
    if (!renderer?.generateTexture) throw new Error('[swarmguard] Pixi renderer not ready (Effects.init)');
    const bakeTex = (g: PIXI.Graphics): PIXI.Texture => {
      const t = renderer.generateTexture(g);
      g.destroy();
      return t;
    };
    this.dotTex = bakeTex(this.dotG());
    this.ringTex = bakeTex(this.ringG());
    this.starTex = bakeTex(this.starG());

    for (let i = 0; i < 420; i++) {
      const s = new PIXI.Sprite(this.dotTex);
      s.anchor.set(0.5);
      s.visible = false;
      s.eventMode = 'none';
      this.fx.addChild(s);
      this.particles.push({
        sprite: s, vx: 0, vy: 0, life: 0, maxLife: 1,
        gravity: 0, drag: 0, baseScale: 1, active: false,
      });
    }
    for (let i = 0; i < 24; i++) {
      const s = new PIXI.Sprite(this.ringTex);
      s.anchor.set(0.5);
      s.visible = false;
      s.eventMode = 'none';
      this.fx.addChild(s);
      this.rings.push({ sprite: s, life: 0, maxLife: 1, from: 8, to: 60, active: false });
    }
    for (let i = 0; i < 16; i++) {
      const s = new PIXI.Sprite(this.starTex);
      s.anchor.set(0.5);
      s.visible = false;
      s.eventMode = 'none';
      this.fx.addChild(s);
      this.flashes.push({ sprite: s, life: 0, maxLife: 0.12 });
    }
    for (let i = 0; i < 28; i++) {
      const t = new PIXI.Text({
        text: '',
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 20,
          fontWeight: '900',
          fill: 0xffffff,
          stroke: { color: 0x3a2b1f, width: 4 },
          align: 'center',
        },
      });
      t.anchor.set(0.5);
      t.visible = false;
      t.eventMode = 'none';
      this.fx.addChild(t);
      this.numbers.push({ text: t, life: 0, maxLife: 0.7, vy: -90, active: false });
    }
  }

  setShakeEnabled(enabled: boolean): void {
    this.shakeOn = enabled;
  }

  setDamageNumbersEnabled(enabled: boolean): void {
    this.damageOn = enabled;
  }

  // ---------- one-shot APIs (wired in main.ts to sim events + diffs) ----------

  /** Crossbow fire: tiny string snap + streak. */
  arrowSnap(x: number, y: number, angle: number): void {
    const p = this.spawn();
    if (!p) return;
    this.launch(p, {
      x, y,
      vx: Math.cos(angle) * 60,
      vy: Math.sin(angle) * 60,
      life: 0.12,
      color: 0xfef3c7,
      scale: 0.45,
      gravity: 0,
      drag: 0,
    });
  }

  /** Crossbow / bomb fire snap, or cannon smoke when big. */
  muzzle(x: number, y: number, angle: number, big = false): void {
    this.flash(x, y, big ? 40 : 26, 0xfde047, 0.09);
    const n = big ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      this.launch(p, {
        x: x - Math.cos(angle) * 6 + (Math.random() - 0.5) * 10,
        y: y - Math.sin(angle) * 6 + (Math.random() - 0.5) * 10,
        vx: -Math.cos(angle) * (40 + Math.random() * 60) + (Math.random() - 0.5) * 40,
        vy: -Math.sin(angle) * (40 + Math.random() * 60) - 40 - Math.random() * 40,
        life: 0.4 + Math.random() * 0.35,
        color: big ? 0xd6d3d1 : 0x99f6e4,
        scale: 0.8 + Math.random() * 0.8,
        gravity: -60,
        drag: 2,
      });
    }
  }

  /** Cannon fire: flash + smoke, no shake (shake lands on impact). */
  cannonFire(x: number, y: number, angle: number): void {
    this.muzzle(x, y, angle, true);
  }

  /** Enemy death: colored pop + white flash (spec §41). */
  deathPop(x: number, y: number, color = 0x4ade80): void {
    const big = color === 0xb06bd6;
    const n = big ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = (big ? 190 : 130) * (0.4 + Math.random() * 0.8);
      this.launch(p, {
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.35 + Math.random() * 0.3,
        color: Math.random() < 0.75 ? color : 0xffffff,
        scale: (big ? 0.9 : 0.6) * (0.7 + Math.random() * 0.7),
        gravity: 500,
        drag: 2.5,
      });
    }
    this.flash(x, y, big ? 46 : 30, 0xffffff, 0.1);
  }

  /** Boss death: huge pop, shockwave rings, debris and a strong shake. */
  bossDeath(x: number, y: number, color = 0x9f1239): void {
    for (let i = 0; i < 34; i++) {
      const p = this.spawn();
      if (!p) break;
      const a = Math.random() * Math.PI * 2;
      const sp = 260 * (0.3 + Math.random() * 1.1);
      this.launch(p, {
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 110,
        life: 0.5 + Math.random() * 0.5,
        color: Math.random() < 0.6 ? color : 0xffffff,
        scale: 1.1 * (0.7 + Math.random() * 0.9),
        gravity: 620,
        drag: 2,
      });
    }
    this.flash(x, y, 130, 0xffffff, 0.22);
    this.ring(x, y, 20, 240, 0xffffff, 0.55);
    this.ring(x, y, 10, 170, color, 0.7);
    this.ring(x, y, 6, 110, 0xfbbf24, 0.8);
    if (this.shakeOn) this.onShake?.(0.85);
  }

  /** Cannon impact: explosion + rings + tiny shake. */
  cannonBlast(x: number, y: number, radius = 60): void {
    this.blast(x, y, radius, [0xf97316, 0xfbbf24, 0x78716c], 14, 0.18);
  }

  /** Bomb impact: bigger debris + rings + stronger shake. */
  bombBlast(x: number, y: number, radius = 100): void {
    this.blast(x, y, radius, [0x2dd4bf, 0xfbbf24, 0xf97316, 0x57534e], 22, 0.32);
    this.flash(x, y, radius * 0.7, 0xffffff, 0.12);
  }

  /** Tower placement: rising ring + glow + sparkle (spec §41). */
  place(x: number, y: number): void {
    this.ring(x, y, 10, 70, 0x4ade80, 0.5);
    this.flash(x, y, 40, 0xbbf7d0, 0.18);
    for (let i = 0; i < 10; i++) {
      const p = this.spawn();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      this.launch(p, {
        x, y: y + 10,
        vx: Math.cos(a) * 90,
        vy: -60 - Math.random() * 120,
        life: 0.5 + Math.random() * 0.3,
        color: Math.random() < 0.5 ? 0x4ade80 : 0xfef9c3,
        scale: 0.55,
        gravity: 260,
        drag: 1.5,
      });
    }
  }

  /** Base hit: red flash + ring + shake. */
  baseHit(x: number, y: number): void {
    this.flash(x, y, 70, 0xef4444, 0.16);
    this.ring(x, y, 20, 110, 0xef4444, 0.4);
    if (this.shakeOn) this.onShake?.(0.4);
  }

  /** Floating damage number (spec §42). Short-lived, pooled Text. */
  damage(x: number, y: number, amount: number): void {
    if (!this.damageOn) return;
    const slot = this.numbers.find((n) => !n.active) ?? this.numbers[0];
    slot.active = true;
    slot.life = 0.7;
    slot.maxLife = 0.7;
    slot.vy = -90;
    slot.text.text = `-${Math.round(amount)}`;
    slot.text.style.fill = 0xffffff;
    slot.text.position.set(x + (Math.random() - 0.5) * 12, y - 18);
    slot.text.scale.set(1);
    slot.text.alpha = 1;
    slot.text.visible = true;
  }

  /** Floating gold reward on kill (0.2 juice). */
  gold(x: number, y: number, amount: number): void {
    if (!this.damageOn || amount <= 0) return;
    const slot = this.numbers.find((n) => !n.active) ?? this.numbers[0];
    slot.active = true;
    slot.life = 0.9;
    slot.maxLife = 0.9;
    slot.vy = -70;
    slot.text.text = `+${Math.round(amount)}g`;
    slot.text.style.fill = 0xfde047;
    slot.text.position.set(x + (Math.random() - 0.5) * 10, y - 30);
    slot.text.scale.set(0.9);
    slot.text.alpha = 1;
    slot.text.visible = true;
  }

  // ---------- frame ----------

  update(dt: number, _time: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const t = p.life / p.maxLife;
      p.vy += p.gravity * dt;
      const dragK = 1 - Math.min(0.9, p.drag * dt);
      p.vx *= dragK;
      p.vy *= dragK;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.rotation += dt * 4;
      p.sprite.scale.set(Math.max(0.01, p.baseScale * (t < 0.25 ? t / 0.25 : 1)));
      p.sprite.alpha = Math.min(1, t * 2.2);
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.sprite.visible = false;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const ease = 1 - (1 - t) * (1 - t);
      r.sprite.scale.set((r.from + (r.to - r.from) * ease) / 56);
      r.sprite.alpha = (1 - t) * 0.9;
    }
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.sprite.visible = false;
        continue;
      }
      f.sprite.alpha = (f.life / f.maxLife) * 0.95;
      f.sprite.rotation += dt * 6;
    }
    for (const n of this.numbers) {
      if (!n.active) continue;
      n.life -= dt;
      if (n.life <= 0) {
        n.active = false;
        n.text.visible = false;
        continue;
      }
      n.text.position.y += n.vy * dt;
      n.text.alpha = Math.min(1, (n.life / n.maxLife) * 2.5);
    }
  }

  // ---------- helpers ----------

  private blast(
    x: number, y: number, radius: number, palette: number[], count: number, shake: number,
  ): void {
    this.flash(x, y, radius * 0.55, 0xfde047, 0.1);
    this.ring(x, y, 12, radius * 1.25, 0xffffff, 0.38);
    this.ring(x, y, 6, radius * 0.8, 0xf97316, 0.45);
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = radius * (1.2 + Math.random() * 2.4);
      this.launch(p, {
        x: x + (Math.random() - 0.5) * 16,
        y: y + (Math.random() - 0.5) * 16,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 120,
        life: 0.4 + Math.random() * 0.45,
        color: palette[i % palette.length],
        scale: 0.7 + Math.random() * 0.9,
        gravity: 620,
        drag: 1.8,
      });
    }
    if (this.shakeOn) this.onShake?.(shake);
  }

  private spawn(): Particle | null {
    for (const p of this.particles) {
      if (!p.active) return p;
    }
    return null;
  }

  private launch(
    p: Particle,
    o: {
      x: number; y: number; vx: number; vy: number;
      life: number; color: number; scale: number; gravity: number; drag: number;
    },
  ): void {
    p.active = true;
    p.vx = o.vx;
    p.vy = o.vy;
    p.life = o.life;
    p.maxLife = o.life;
    p.gravity = o.gravity;
    p.drag = o.drag;
    p.baseScale = o.scale;
    p.sprite.position.set(o.x, o.y);
    p.sprite.tint = o.color;
    p.sprite.scale.set(o.scale);
    p.sprite.alpha = 1;
    p.sprite.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
  }

  private ring(x: number, y: number, from: number, to: number, color: number, life: number): void {
    const r = this.rings.find((k) => !k.active) ?? this.rings[0];
    r.active = true;
    r.life = life;
    r.maxLife = life;
    r.from = from;
    r.to = to;
    r.sprite.position.set(x, y);
    r.sprite.tint = color;
    r.sprite.visible = true;
  }

  private flash(x: number, y: number, size: number, color: number, life: number): void {
    const f = this.flashes.find((k) => !k.sprite.visible) ?? this.flashes[0];
    f.life = life;
    f.maxLife = life;
    f.sprite.position.set(x, y);
    f.sprite.tint = color;
    f.sprite.scale.set(size / 32);
    f.sprite.alpha = 0.95;
    f.sprite.visible = true;
  }

  private dotG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(8, 8, 7).fill({ color: 0xffffff });
    g.circle(6, 6, 2.5).fill({ color: 0xffffff, alpha: 0.9 });
    return g;
  }

  private ringG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.circle(64, 64, 56).stroke({ width: 10, color: 0xffffff });
    return g;
  }

  private starG(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.poly([32, 2, 37, 27, 62, 32, 37, 37, 32, 62, 27, 37, 2, 32, 27, 27]).fill({ color: 0xffffff });
    g.circle(32, 32, 9).fill({ color: 0xffffff });
    return g;
  }
}
