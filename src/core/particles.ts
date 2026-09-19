export interface ParticleConfig {
  particleCount?: number;
  maxDistance?: number;
  mouseRadius?: number;
  fpsCap?: number;
}

export class ParticleEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private animFrameId: number | null = null;
  private isRunning = false;
  private lastFrameTime = 0;
  private frameIntervalMs: number;
  private activeCount: number;
  private primaryColor = 'rgba(255, 138, 101, 0.7)';
  private secondaryColor = 'rgba(167, 139, 250, 0.7)';
  private primaryRgb = '255, 138, 101';

  private mouse = { x: -1000, y: -1000, radius: 140 };
  private particleCount: number;
  private maxDistance: number;

  // Pre-allocated flat buffers to eliminate per-frame GC allocations
  private posX: Float64Array;
  private posY: Float64Array;
  private velX: Float64Array;
  private velY: Float64Array;
  private baseRadius: Float64Array;
  private currentRadius: Float64Array;
  private alpha: Float64Array;
  private isCyan: Uint8Array;
  private pulse: Float64Array;
  private pulseSpeed: Float64Array;

  private handleResize = () => this.resize();
  private handleMouseMove = (e: MouseEvent) => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  };
  private handleMouseLeave = () => {
    this.mouse.x = -1000;
    this.mouse.y = -1000;
  };
  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.pause();
    } else {
      this.resume();
    }
  };

  constructor(canvas: HTMLCanvasElement, config: ParticleConfig = {}) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context not supported');
    }
    this.ctx = context;
    this.particleCount = config.particleCount ?? 70;
    this.activeCount = this.particleCount;
    this.maxDistance = config.maxDistance ?? 95;
    this.mouse.radius = config.mouseRadius ?? 140;
    const fps = config.fpsCap ?? 60;
    this.frameIntervalMs = 1000 / fps;

    const count = this.particleCount;
    this.posX = new Float64Array(count);
    this.posY = new Float64Array(count);
    this.velX = new Float64Array(count);
    this.velY = new Float64Array(count);
    this.baseRadius = new Float64Array(count);
    this.currentRadius = new Float64Array(count);
    this.alpha = new Float64Array(count);
    this.isCyan = new Uint8Array(count);
    this.pulse = new Float64Array(count);
    this.pulseSpeed = new Float64Array(count);

    this.init();
  }

  private resetParticle(i: number, init = false): void {
    this.posX[i] = init ? Math.random() * this.width : (Math.random() > 0.5 ? 0 : this.width);
    this.posY[i] = Math.random() * this.height;
    const br = Math.random() * 2.2 + 0.8;
    this.baseRadius[i] = br;
    this.currentRadius[i] = br;
    this.velX[i] = (Math.random() - 0.5) * 0.45;
    this.velY[i] = (Math.random() - 0.5) * 0.45;
    this.alpha[i] = Math.random() * 0.5 + 0.25;
    this.isCyan[i] = Math.random() > 0.45 ? 0 : 1;
    this.pulse[i] = Math.random() * Math.PI * 2;
    this.pulseSpeed[i] = 0.02 + Math.random() * 0.02;
  }

  private init(): void {
    this.resize();
    for (let i = 0; i < this.particleCount; i++) {
      this.resetParticle(i, true);
    }

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseleave', this.handleMouseLeave);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.resume();
  }

  triggerBurst(originX?: number, originY?: number, count = 35): void {
    const ox = originX ?? this.width / 2;
    const oy = originY ?? this.height / 2;
    const burstCount = Math.min(count, this.particleCount);

    for (let i = 0; i < burstCount; i++) {
      this.posX[i] = ox;
      this.posY[i] = oy;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 5 + 2.5;
      this.velX[i] = Math.cos(angle) * speed;
      this.velY[i] = Math.sin(angle) * speed;
      this.alpha[i] = 0.95;
      this.currentRadius[i] = Math.random() * 4 + 2;
    }
  }

  setThemeColors(primary: string, secondary: string): void {
    this.primaryColor = primary;
    this.secondaryColor = secondary;
    const match = primary.match(/\d+,\s*\d+,\s*\d+/);
    if (match) {
      this.primaryRgb = match[0];
    }
  }

  setIntensity(intensity: 'off' | 'low' | 'balanced' | 'high'): void {
    if (intensity === 'off') {
      this.activeCount = 0;
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.pause();
      return;
    }
    switch (intensity) {
      case 'low':
        this.activeCount = 20;
        break;
      case 'balanced':
        this.activeCount = 45;
        break;
      case 'high':
      default:
        this.activeCount = this.particleCount;
        break;
    }
    this.resume();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private loop = (timestamp: number): void => {
    if (!this.isRunning) return;

    this.animFrameId = requestAnimationFrame(this.loop);

    const elapsed = timestamp - this.lastFrameTime;
    // Cap frame rate to ~60fps with a 1ms leeway for frame timestamp jitter
    if (elapsed < this.frameIntervalMs - 1) {
      return;
    }
    // Adjust lastFrameTime to maintain stable phase
    this.lastFrameTime = timestamp - (elapsed % this.frameIntervalMs);

    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    const count = this.activeCount;
    if (count === 0) {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    const mouseX = this.mouse.x;
    const mouseY = this.mouse.y;
    const mouseRadius = this.mouse.radius;
    const maxDist = this.maxDistance;
    const maxDistSq = maxDist * maxDist;

    ctx.clearRect(0, 0, width, height);

    // Batched render connection lines between nearby particles
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = `rgba(${this.primaryRgb}, 0.05)`;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const p1x = this.posX[i]!;
      const p1y = this.posY[i]!;
      for (let j = i + 1; j < count; j++) {
        const dx = p1x - this.posX[j]!;
        const dy = p1y - this.posY[j]!;
        const distSq = dx * dx + dy * dy;

        if (distSq < maxDistSq) {
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(this.posX[j]!, this.posY[j]!);
        }
      }
    }
    ctx.stroke();

    // Update positions and render particle dots
    for (let i = 0; i < count; i++) {
      const pSpeed = this.pulseSpeed[i] ?? 0.03;
      const currentPulse = (this.pulse[i] ?? 0) + pSpeed;
      this.pulse[i] = currentPulse;
      const pulseFactor = 1 + Math.sin(currentPulse) * 0.2;

      let vx = this.velX[i] ?? 0;
      let vy = this.velY[i] ?? 0;
      let px = this.posX[i] ?? 0;
      let py = this.posY[i] ?? 0;

      const dx = mouseX - px;
      const dy = mouseY - py;
      const dist = Math.hypot(dx, dy);

      if (dist < mouseRadius && dist > 0) {
        const force = (1 - dist / mouseRadius) * 1.6;
        const angle = Math.atan2(dy, dx);
        vx -= Math.cos(angle) * force * 0.25;
        vy -= Math.sin(angle) * force * 0.25;
      }

      vx *= 0.985;
      vy *= 0.985;
      px += vx;
      py += vy;

      if (px < -10) px = width + 10;
      if (px > width + 10) px = -10;
      if (py < -10) py = height + 10;
      if (py > height + 10) py = -10;

      this.velX[i] = vx;
      this.velY[i] = vy;
      this.posX[i] = px;
      this.posY[i] = py;
      const bRad = this.baseRadius[i] ?? 1.5;
      const rad = bRad * pulseFactor;
      this.currentRadius[i] = rad;

      // Draw particle
      ctx.globalAlpha = this.alpha[i] ?? 0.3;
      const isAltParticle = (this.isCyan[i] ?? 0) === 1;
      ctx.fillStyle = isAltParticle ? this.secondaryColor : this.primaryColor;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  pause(): void {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  resume(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.pause();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseleave', this.handleMouseLeave);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
